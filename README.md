# llmauto
Automated OpenWebUI on AWS

# Open WebUI AWS Deployment

## Prerequisites
1. AWS CLI configured
2. Docker installed
3. CDK installed (`npm install -g aws-cdk`)

## Steps
1. Clone repository
2. Install dependencies: `npm install`
3. Bootstrap CDK: `cdk bootstrap`
4. Deploy stack: `cdk deploy`

## Post-Deployment
- Get URL from stack output
- Login with admin@example.com and generated password

What Gets Deployed

VPC with public/private subnets
RDS PostgreSQL database
ECS Fargate cluster
Open WebUI service (auto-scaling)
Bedrock Gateway service
Application Load Balancer
All necessary IAM roles and policies