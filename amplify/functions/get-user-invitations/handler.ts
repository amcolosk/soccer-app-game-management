import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient({});

type Handler = Schema['getUserInvitations']['functionHandler'];

export const handler: Handler = async (event) => {
  console.log('Get user invitations request:', JSON.stringify(event, null, 2));

  // Get user email from Cognito identity
  const identity = event.identity as AppSyncIdentityCognito;
  let userEmail = identity?.claims?.email;
  
  // Debug identity
  if (identity) {
    console.log('Identity claims keys:', Object.keys(identity.claims || {}));
    console.log('Identity username:', identity.username);
    console.log('Identity sub:', identity.sub);
  }

  // Fallback: if username looks like an email, use it
  if (!userEmail && identity?.username && identity.username.includes('@')) {
    console.log('Using username as email:', identity.username);
    userEmail = identity.username;
  }

  // Fallback 2: check claims.username
  if (!userEmail && identity?.claims?.username) {
    console.log('Using claims.username as email fallback:', identity.claims.username);
    userEmail = identity.claims.username as string;
  }

  // Fallback 3: check claims['cognito:username']
  if (!userEmail && identity?.claims && identity.claims['cognito:username']) {
    console.log('Using claims.cognito:username as email fallback:', identity.claims['cognito:username']);
    userEmail = identity.claims['cognito:username'] as string;
  }

  // Fallback 4: Fetch from Cognito User Pool
  if ((!userEmail || !userEmail.includes('@')) && process.env.USER_POOL_ID && (identity?.username || identity?.sub)) {
    try {
      console.log('Attempting to fetch email from Cognito User Pool...');
      const command = new AdminGetUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: identity.username || identity.sub
      });
      const response = await cognitoClient.send(command);
      const emailAttr = response.UserAttributes?.find(attr => attr.Name === 'email');
      if (emailAttr?.Value) {
        console.log('Fetched email from Cognito:', emailAttr.Value);
        userEmail = emailAttr.Value;
      }
    } catch (error) {
      console.error('Error fetching user from Cognito:', error);
    }
  }
  
  if (!userEmail) {
    console.error('No email found in user claims');
    // Return empty list instead of throwing to avoid breaking UI
    return {
      teamInvitations: [],
      debug: {
        message: 'No email found in user claims',
        claimsKeys: Object.keys(identity?.claims || {}),
        usernameClaim: identity?.claims?.username,
        sub: identity?.sub
      }
    };
  }

  const tableName = process.env.TEAMINVITATION_TABLE_NAME;
  
  if (!tableName) {
    console.error('TEAMINVITATION_TABLE_NAME environment variable not set');
    throw new Error('Configuration error');
  }

  try {
    // Scan the table with filter expression
    // Note: In a production environment with many invitations, a GSI on email would be more efficient
    // But for this use case, a Scan with filter is acceptable as the table volume is expected to be low
    // and we're filtering by a specific user's email.
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: '(#email = :email OR #email = :email_lower) AND #status = :status',
      ExpressionAttributeNames: {
        '#email': 'email',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':email': userEmail,
        ':email_lower': userEmail.toLowerCase(),
        ':status': 'PENDING',
      },
    });

    const result = await docClient.send(command);
    const invitations = result.Items || [];

    console.log(`Found ${invitations.length} valid invitations for ${userEmail}`);

    // DEBUG: If no invitations found, scan a few items to see what's in the table
    let debugInfo: any = {
      identityDebug: {
        username: identity?.username,
        sub: identity?.sub,
        claimsKeys: Object.keys(identity?.claims || {})
      }
    };

    if (invitations.length === 0) {
      const debugCommand = new ScanCommand({
        TableName: tableName,
        Limit: 5
      });
      const debugResult = await docClient.send(debugCommand);
      debugInfo = {
        ...debugInfo,
        message: 'No invitations found with filter',
        userEmailQuery: userEmail.toLowerCase(),
        totalItemsInTableSample: debugResult.Items?.length,
        sampleItems: debugResult.Items,
        tableName
      };
    }

    return {
      teamInvitations: invitations,
      debug: debugInfo
    };
  } catch (error) {
    console.error('Error querying invitations:', error);
    throw error;
  }
};
