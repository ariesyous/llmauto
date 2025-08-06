#!/bin/bash
set -e

echo "🚀 Deploying Open WebUI to AWS..."

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI not installed. Please install it first."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js not installed. Please install it first."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker not installed. Please install it first."; exit 1; }

# Check AWS credentials
aws sts get-caller-identity >/dev/null 2>&1 || { echo "❌ AWS credentials not configured. Run 'aws configure' first."; exit 1; }

echo "✅ Prerequisites check passed"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Bootstrap CDK (if needed)
echo "🔧 Bootstrapping CDK..."
npx cdk bootstrap

# Deploy
echo "🏗️  Deploying stack..."
npx cdk deploy --require-approval never

echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Check the CloudFormation outputs for the ALB URL"
echo "2. Retrieve admin password from AWS Secrets Manager"
echo "3. Login with admin@example.com"