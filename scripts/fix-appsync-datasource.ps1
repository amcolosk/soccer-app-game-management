# Post-deployment script to fix AppSync Lambda data source
# This works around Amplify Gen 2's limitation with custom Lambda resolvers

$region = "us-east-2"

Write-Host "Finding AppSync API..." -ForegroundColor Cyan
$apis = aws appsync list-graphql-apis --region $region --query "graphqlApis[?contains(name, 'amplifyData')]" | ConvertFrom-Json
$apiId = $apis[-1].apiId  # Get the most recent API
Write-Host "Found API: $apiId" -ForegroundColor Green

Write-Host "Finding acceptInvitation Lambda function..." -ForegroundColor Cyan
$functions = aws lambda list-functions --region $region --query "Functions[?contains(FunctionName, 'handler')]" | ConvertFrom-Json
$lambdaArn = ($functions | Where-Object { $_.FunctionName -match "acceptInvitation|handler" } | Select-Object -First 1).FunctionArn
Write-Host "Found Lambda: $lambdaArn" -ForegroundColor Green

Write-Host "Finding AppSync service role..." -ForegroundColor Cyan
$roles = aws iam list-roles --query "Roles[?contains(RoleName, 'AcceptInvitationLambdaDat')]" | ConvertFrom-Json
$roleArn = $roles[-1].Arn  # Get the most recent role
Write-Host "Found Role: $roleArn" -ForegroundColor Green

Write-Host "Updating AppSync data source..." -ForegroundColor Cyan
aws appsync update-data-source `
    --api-id $apiId `
    --name AcceptInvitationLambdaDataSource `
    --type AWS_LAMBDA `
    --service-role-arn $roleArn `
    --lambda-config "lambdaFunctionArn=$lambdaArn" `
    --region $region | Out-Null
Write-Host "Data source updated" -ForegroundColor Green

Write-Host "Adding Lambda invoke permission..." -ForegroundColor Cyan
$funcName = $lambdaArn.Split(":")[-1]
aws lambda add-permission `
    --function-name $funcName `
    --statement-id AllowAppSyncInvoke `
    --action lambda:InvokeFunction `
    --principal appsync.amazonaws.com `
    --source-arn "arn:aws:appsync:${region}:*:apis/$apiId" `
    --region $region 2>&1 | Out-Null
Write-Host "Lambda permission added" -ForegroundColor Green

Write-Host "Adding IAM role policy..." -ForegroundColor Cyan
$roleName = $roleArn.Split("/")[-1]
$tempPolicy = New-TemporaryFile
@{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Action = "lambda:InvokeFunction"
            Resource = $lambdaArn
        }
    )
} | ConvertTo-Json -Depth 10 | Set-Content $tempPolicy
aws iam put-role-policy `
    --role-name $roleName `
    --policy-name AllowInvokeLambda `
    --policy-document "file://$tempPolicy" 2>&1 | Out-Null
Remove-Item $tempPolicy -Force
Write-Host "IAM policy added" -ForegroundColor Green

Write-Host "`nAppSync data source configuration complete!" -ForegroundColor Green
