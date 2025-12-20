import type { Schema } from "../../data/resource";
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const handler: Schema['acceptInvitation']['functionHandler'] = async (event) => {
  console.log('Accept invitation handler triggered');

  const { invitationId } = event.arguments;
  
  // Get user ID from Cognito identity
  const identity = event.identity as AppSyncIdentityCognito;
  const userId = identity?.sub;

  if (!userId) {
    throw new Error('User not authenticated');
  }

  console.log(`User ${userId} accepting invitation ${invitationId}`);

  // Get table names from environment
  const teamInvitationTable = process.env.TEAM_INVITATION_TABLE;
  const teamTable = process.env.TEAM_TABLE;

  if (!teamInvitationTable || !teamTable) {
    throw new Error('Required environment variables not set');
  }

  // 1. Get the invitation
  const invitationResponse = await docClient.send(new GetCommand({
    TableName: teamInvitationTable,
    Key: { id: invitationId }
  }));

  const invitation = invitationResponse.Item;

  if (!invitation) {
    throw new Error('Invitation not found');
  }

  console.log('Invitation found:', invitation);

  // 2. Validate invitation status
  if (invitation.status !== 'PENDING') {
    throw new Error(`Invitation is ${invitation.status}`);
  }

  // 3. Check if expired
  if (new Date(invitation.expiresAt) < new Date()) {
    await docClient.send(new UpdateCommand({
      TableName: teamInvitationTable,
      Key: { id: invitationId },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'EXPIRED' }
    }));
    throw new Error('Invitation has expired');
  }

  // 4. Add user to coaches array
  const currentCoaches = invitation.coaches || [];
  if (!currentCoaches.includes(userId)) {
    const newCoaches = [...currentCoaches, userId];

    console.log('Updating team with new coaches:', newCoaches);

    // Update Team
    await docClient.send(new UpdateCommand({
      TableName: teamTable,
      Key: { id: invitation.teamId },
      UpdateExpression: 'SET coaches = :coaches, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':coaches': newCoaches,
        ':updatedAt': new Date().toISOString()
      }
    }));

    console.log('Team updated successfully');
  }

  // 5. Update invitation status
  await docClient.send(new UpdateCommand({
    TableName: teamInvitationTable,
    Key: { id: invitationId },
    UpdateExpression: 'SET #status = :status, acceptedAt = :acceptedAt, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'ACCEPTED',
      ':acceptedAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString()
    }
  }));

  console.log('Invitation marked as accepted');

  // 6. Return the updated team
  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: invitation.teamId }
  }));
  
  return teamResponse.Item as any;
};
