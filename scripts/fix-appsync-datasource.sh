#!/bin/bash
# Post-deployment script to fix AppSync Lambda data source
# This works around Amplify Gen 2's limitation with custom Lambda resolvers

set -e  # Exit on error

REGION="us-east-2"

echo "Finding AppSync API..."
API_ID=$(aws appsync list-graphql-apis --region $REGION --query "graphqlApis[?contains(name, 'amplifyData')] | [-1].apiId" --output text)
echo "Found API: $API_ID"

echo "Finding acceptInvitation Lambda function..."
LAMBDA_ARN=$(aws lambda list-functions --region $REGION --query "Functions[?contains(FunctionName, 'handler')] | [0].FunctionArn" --output text)
echo "Found Lambda: $LAMBDA_ARN"

echo "Finding AppSync service role..."
ROLE_ARN=$(aws iam list-roles --query "Roles[?contains(RoleName, 'AcceptInvitationLambdaDat')] | [-1].Arn" --output text)
echo "Found Role: $ROLE_ARN"

echo "Updating AppSync data source..."
aws appsync update-data-source \
    --api-id $API_ID \
    --name AcceptInvitationLambdaDataSource \
    --type AWS_LAMBDA \
    --service-role-arn $ROLE_ARN \
    --lambda-config "lambdaFunctionArn=$LAMBDA_ARN" \
    --region $REGION > /dev/null
echo "Data source updated"

echo "Adding Lambda invoke permission..."
FUNC_NAME=$(echo $LAMBDA_ARN | awk -F: '{print $NF}')
aws lambda add-permission \
    --function-name $FUNC_NAME \
    --statement-id AllowAppSyncInvoke \
    --action lambda:InvokeFunction \
    --principal appsync.amazonaws.com \
    --source-arn "arn:aws:appsync:${REGION}:*:apis/$API_ID" \
    --region $REGION 2>&1 > /dev/null || true  # Ignore if permission already exists
echo "Lambda permission added"

echo "Adding IAM role policy..."
ROLE_NAME=$(echo $ROLE_ARN | awk -F/ '{print $NF}')
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "$LAMBDA_ARN"
    }
  ]
}
EOF
)
aws iam put-role-policy \
    --role-name $ROLE_NAME \
    --policy-name AllowInvokeLambda \
    --policy-document "$POLICY_DOC" 2>&1 > /dev/null
echo "IAM policy added"

echo ""
echo "AppSync data source configuration complete!"
