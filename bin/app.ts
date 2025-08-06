#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OpenWebUIStack } from '../lib/open-webui-stack';

const app = new cdk.App();

// Get configuration from context or environment
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};

// Validate environment
if (!env.account) {
  console.error('❌ AWS account not specified. Please run "aws configure" or set AWS_ACCOUNT_ID');
  process.exit(1);
}

new OpenWebUIStack(app, 'OpenWebUIStack', {
  env,
  description: 'Open WebUI with AWS Bedrock Integration',
  
  // Stack tags
  tags: {
    Application: 'OpenWebUI',
    Environment: 'production',
    ManagedBy: 'CDK',
  },
});

app.synth();