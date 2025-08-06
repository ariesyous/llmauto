import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export class OpenWebUIStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      ]
    });

    // Security Groups
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS database',
      allowAllOutbound: false,
    });

    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      description: 'Security group for ECS services',
    });

    dbSecurityGroup.addIngressRule(
      serviceSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from ECS services'
    );

    // Secrets
    const adminPasswordSecret = new secretsmanager.Secret(this, 'AdminPassword', {
      description: 'Open WebUI admin password',
      generateSecretString: {
        length: 16,
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    const dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      description: 'RDS database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    const webuiSecret = new secretsmanager.Secret(this, 'WebUISecret', {
      description: 'Open WebUI secret key',
      generateSecretString: {
        length: 32,
      },
    });

    // RDS Database
    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_3,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'openwebui',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,
    });

    // Service Discovery Namespace
    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
      name: 'openwebui.local',
      vpc,
    });

    // Task Execution Role
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        adminPasswordSecret.secretArn,
        dbSecret.secretArn,
        webuiSecret.secretArn,
      ],
    }));

    // Bedrock Task Role
    const bedrockTaskRole = new iam.Role(this, 'BedrockTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      inlinePolicies: {
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
                'bedrock:ListFoundationModels',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Log Groups
    const bedrockLogGroup = new logs.LogGroup(this, 'BedrockLogGroup', {
      logGroupName: '/ecs/bedrock-gateway',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const webuiLogGroup = new logs.LogGroup(this, 'WebUILogGroup', {
      logGroupName: '/ecs/open-webui',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Bedrock Gateway Task Definition
    const bedrockTaskDef = new ecs.FargateTaskDefinition(this, 'BedrockGatewayTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole,
      taskRole: bedrockTaskRole,
    });

    const bedrockContainer = bedrockTaskDef.addContainer('bedrock-gateway', {
      image: ecs.ContainerImage.fromAsset('./docker/bedrock-gateway'),
      environment: {
        AWS_REGION: this.region,
        PORT: '8000',
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'bedrock-gateway',
        logGroup: bedrockLogGroup,
      }),
      portMappings: [{
        containerPort: 8000,
        protocol: ecs.Protocol.TCP,
      }],
    });

    // Bedrock Gateway Service
    const bedrockService = new ecs.FargateService(this, 'BedrockGatewayService', {
      cluster,
      taskDefinition: bedrockTaskDef,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [serviceSecurityGroup],
      serviceRegistries: [{
        registry: servicediscovery.Service.fromServiceAttributes(this, 'BedrockServiceDiscovery', {
          namespace,
          serviceName: 'bedrock-gateway',
          dnsRecordType: servicediscovery.DnsRecordType.A,
        }),
      }],
    });

    // Open WebUI Task Definition
    const webuiTaskDef = new ecs.FargateTaskDefinition(this, 'OpenWebUITaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole: new iam.Role(this, 'WebUITaskRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      }),
    });

    // Init Container
    const initContainer = webuiTaskDef.addContainer('init', {
      image: ecs.ContainerImage.fromAsset('./docker/open-webui', {
        file: 'Dockerfile.init',
      }),
      essential: false,
      environment: {
        DATABASE_HOST: database.dbInstanceEndpointAddress,
        DATABASE_PORT: database.dbInstanceEndpointPort,
        DATABASE_NAME: 'openwebui',
        DATABASE_USER: dbSecret.secretValueFromJson('username').unsafeUnwrap(),
        BEDROCK_GATEWAY_URL: 'http://bedrock-gateway.openwebui.local:8000',
      },
      secrets: {
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminPasswordSecret),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'open-webui-init',
        logGroup: webuiLogGroup,
      }),
    });

    // Main App Container
    const appContainer = webuiTaskDef.addContainer('app', {
      image: ecs.ContainerImage.fromAsset('./docker/open-webui'),
      essential: true,
      environment: {
        DATABASE_URL: `postgresql://postgres:${dbSecret.secretValueFromJson('password').unsafeUnwrap()}@${database.dbInstanceEndpointAddress}:${database.dbInstanceEndpointPort}/openwebui`,
        WEBUI_AUTH: 'true',
        ENABLE_SIGNUP: 'false',
        DEFAULT_USER_ROLE: 'pending',
        OPENAI_API_BASE_URL: 'http://bedrock-gateway.openwebui.local:8000/v1',
        OPENAI_API_KEY: 'bedrock',
      },
      secrets: {
        WEBUI_SECRET_KEY: ecs.Secret.fromSecretsManager(webuiSecret),
      },
      portMappings: [{
        containerPort: 8080,
        protocol: ecs.Protocol.TCP,
      }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'open-webui',
        logGroup: webuiLogGroup,
      }),
      dependsOn: [{
        container: initContainer,
        condition: ecs.ContainerDependencyCondition.SUCCESS,
      }],
    });

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
        vpc,
        allowAllOutbound: true,
      }),
    });

    alb.connections.allowFromAnyIpv4(ec2.Port.tcp(80));

    // Open WebUI Service
    const webuiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'OpenWebUIService', {
      cluster,
      taskDefinition: webuiTaskDef,
      desiredCount: 2,
      assignPublicIp: false,
      loadBalancer: alb,
      securityGroups: [serviceSecurityGroup],
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    webuiService.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
    });

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerURL', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'URL to access Open WebUI',
    });

    new cdk.CfnOutput(this, 'AdminPasswordSecretName', {
      value: adminPasswordSecret.secretName,
      description: 'AWS Secrets Manager secret containing admin password',
    });

    new cdk.CfnOutput(this, 'AdminEmail', {
      value: 'admin@example.com',
      description: 'Admin email address',
    });
  }
}