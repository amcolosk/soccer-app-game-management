# E2E Test Setup

## Quick Start

### 1. Install dependencies
```bash
npm install
npx playwright install --with-deps
```

### 2. Start the AWS Sandbox
In a dedicated terminal (keep it running):
```bash
npx ampx sandbox
```
Wait for the deployment success message. This creates a personal backend environment in your AWS account and writes `amplify_outputs.json` to the project root.

### 3. Seed test data (optional)
If you want a pre-populated database:
```bash
# Generate and attach the seed policy to your deploy role
npx ampx sandbox seed generate-policy > seed-policy.json
aws iam put-role-policy \
  --role-name amplify_deploy_role \
  --policy-name AmplifyBackendDeployFullAccess \
  --policy-document file://seed-policy.json

# Run the seed
npx ampx seed
```

### 4. Start the dev server
In a second terminal:
```bash
npm run dev
```

### 5. Run the tests
```bash
npm run test:e2e
```

## Resetting the Sandbox

If tests leave data in an unexpected state:
```bash
npx ampx sandbox delete
npx ampx sandbox
```

## AWS Credentials

The sandbox requires AWS credentials configured locally. If you haven't set these up:
```bash
aws configure
# or use a named profile:
export AWS_PROFILE=your-profile-name
```
