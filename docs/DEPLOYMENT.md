# Deployment Process

## Sandbox Deployment

1. Start the sandbox:
```bash
npx ampx sandbox
```

2. After deployment completes, run the post-deployment script:
```powershell
.\scripts\fix-appsync-datasource.ps1
```

This script automatically configures the AppSync data source for the `acceptInvitation` Lambda function.

## Production Deployment

1. Deploy to production:
```bash
npx ampx pipeline-deploy --branch main --app-id <your-app-id>
```

2. After deployment, run the post-deployment script with production credentials:
```powershell
.\scripts\fix-appsync-datasource.ps1
```

## Why is the script needed?

Amplify Gen 2 has a known limitation where custom Lambda resolvers referenced via `a.handler.function()` don't get automatically wired to AppSync data sources correctly. The Lambda function is created with a CloudFormation-generated name, but AppSync expects a specific naming convention.

The post-deployment script:
- Finds the correct Lambda function ARN
- Updates the AppSync data source to point to the actual Lambda
- Adds necessary IAM permissions for AppSync to invoke the Lambda

This ensures the `acceptInvitation` custom mutation works correctly without requiring broad permissions on the Team model.
