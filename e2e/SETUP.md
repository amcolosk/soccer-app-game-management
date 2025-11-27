# E2E Test Setup Guide

## Quick Start

### 1. Install Dependencies
```powershell
npm install
```

### 2. Start AWS Sandbox
In a separate terminal:
```powershell
npx ampx sandbox
```

Wait for the sandbox to fully deploy (you'll see a success message).


Generate policy
npx ampx sandbox seed generate-policy > seed-policy.json

Attach to policy and role
aws iam put-role-policy --role-name amplify_deploy_role --policy-name AmplifyBackendDeployFullAccess --policy-document seed-policy.json

Note: amplify_deploy_role is a service policy in IAM with admin rights

Run npx ampx sandbox seed

