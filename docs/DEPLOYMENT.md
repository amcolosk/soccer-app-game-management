# Deployment Process

## Overview

This project uses AWS Amplify Gen 2 with a custom Lambda function for team invitation acceptance. Due to Amplify Gen 2's limitations with custom Lambda resolvers, a post-deployment script is required to properly wire the AppSync data source.

## Required AWS Permissions

The post-deployment script requires AWS credentials with the following permissions:
- `appsync:ListGraphqlApis`
- `appsync:UpdateDataSource`
- `lambda:ListFunctions`
- `lambda:AddPermission`
- `iam:ListRoles`
- `iam:PutRolePolicy`

These are typically available to AWS administrators or users with appropriate IAM policies.

## Sandbox Deployment

1. Start the sandbox:
```bash
npx ampx sandbox
```

2. After deployment completes, run the post-deployment script:

**Windows (PowerShell):**
```powershell
.\scripts\fix-appsync-datasource.ps1
```

**Linux/Mac:**
```bash
chmod +x ./scripts/fix-appsync-datasource.sh
./scripts/fix-appsync-datasource.sh
```

## Production Deployment via Amplify Hosting

1. Push your changes to the repository branch configured in Amplify Hosting

2. Amplify will automatically build and deploy the backend/frontend

3. **After the build completes**, manually run the post-deployment script from your local machine with AWS credentials:

**Windows:**
```powershell
.\scripts\fix-appsync-datasource.ps1
```

**Linux/Mac:**
```bash
./scripts/fix-appsync-datasource.sh
```

**Note:** The script cannot run automatically in the Amplify build pipeline because the build role doesn't have the elevated permissions required to modify AppSync, Lambda, and IAM resources.

## Manual Production Deployment

If deploying manually (not through Amplify Hosting):

1. Deploy to production:
```bash
npx ampx pipeline-deploy --branch main --app-id <your-app-id>
```

2. After deployment, run the post-deployment script:
```bash
./scripts/fix-appsync-datasource.sh  # or .ps1 on Windows
```

## Why is the script needed?

Amplify Gen 2 has a known limitation where custom Lambda resolvers referenced via `a.handler.function()` don't get automatically wired to AppSync data sources correctly. The Lambda function is created with a CloudFormation-generated name, but AppSync expects a specific naming convention.

The post-deployment script:
- Finds the correct Lambda function ARN
- Updates the AppSync data source to point to the actual Lambda
- Adds necessary IAM permissions for AppSync to invoke the Lambda

This ensures the `acceptInvitation` custom mutation works correctly without requiring broad permissions on the Team model.
