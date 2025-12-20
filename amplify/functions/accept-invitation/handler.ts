import type { Schema } from "../../data/resource";
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';

const env = {
  AMPLIFY_DATA_GRAPHQL_ENDPOINT: process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT || '',
  AWS_REGION: process.env.AWS_REGION || '',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN || '',
};

// Configure Amplify for Lambda execution with elevated permissions
Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT,
        region: env.AWS_REGION,
        defaultAuthMode: 'identityPool'
      }
    }
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN,
          },
        }),
        clearCredentialsAndIdentityId: () => {
          /* noop */
        },
      },
    },
  }
);

const client = generateClient<Schema>();

export const handler: Schema['acceptInvitation']['functionHandler'] = async (event) => {
  console.log('Accept invitation handler triggered:', JSON.stringify(event, null, 2));

  const { invitationId } = event.arguments;
  
  // Get user ID from Cognito identity
  const identity = event.identity as AppSyncIdentityCognito;
  const userId = identity?.sub;

  if (!userId) {
    throw new Error('User not authenticated');
  }

  console.log(`User ${userId} accepting invitation ${invitationId}`);

  // 1. Get the invitation
  const invitationResponse = await client.models.TeamInvitation.get({ id: invitationId });
  const invitation = invitationResponse.data;

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
    await client.models.TeamInvitation.update({
      id: invitationId,
      status: 'EXPIRED',
    });
    throw new Error('Invitation has expired');
  }

  // 4. Add user to coaches array using the invitation's stored coaches
  const coaches = invitation.coaches || [];
  if (!coaches.includes(userId)) {
    const newCoaches = [...coaches, userId];

    console.log('Updating team with new coaches:', newCoaches);

    // Update Team (Lambda has elevated permissions)
    await client.models.Team.update({
      id: invitation.teamId,
      coaches: newCoaches,
    });

    console.log('Team updated successfully');

    // Propagate permissions to all related records
    await grantCoachAccessToTeamData(invitation.teamId, newCoaches);

    console.log('Permissions propagated to related data');
  } else {
    console.log('User already in coaches array');
  }

  // 5. Update invitation status
  await client.models.TeamInvitation.update({
    id: invitationId,
    status: 'ACCEPTED',
    acceptedAt: new Date().toISOString(),
  });

  console.log('Invitation marked as accepted');

  // 6. Return the updated team
  const teamResponse = await client.models.Team.get({ id: invitation.teamId });
  
  return teamResponse.data;
};

async function grantCoachAccessToTeamData(teamId: string, newCoaches: string[]) {
  console.log(`Granting access to team ${teamId} for coaches:`, newCoaches);

  try {
    // 1. Update TeamRosters
    const rosters = await client.models.TeamRoster.list({
      filter: { teamId: { eq: teamId } }
    });

    const playerIds = new Set<string>();

    for (const roster of rosters.data) {
      await client.models.TeamRoster.update({
        id: roster.id,
        coaches: newCoaches
      });
      if (roster.playerId) playerIds.add(roster.playerId);
    }

    console.log(`Updated ${rosters.data.length} rosters`);

    // 2. Update Players
    for (const playerId of playerIds) {
      const player = await client.models.Player.get({ id: playerId });
      if (player.data) {
        const existingCoaches = player.data.coaches || [];
        const mergedCoaches = Array.from(new Set([...existingCoaches, ...newCoaches]));
        await client.models.Player.update({
          id: playerId,
          coaches: mergedCoaches
        });
      }
    }

    console.log(`Updated ${playerIds.size} players`);

    // 3. Update FieldPositions
    const positions = await client.models.FieldPosition.list({
      filter: { teamId: { eq: teamId } }
    });

    for (const position of positions.data) {
      await client.models.FieldPosition.update({
        id: position.id,
        coaches: newCoaches
      });
    }

    console.log(`Updated ${positions.data.length} field positions`);

    // 4. Update Games
    const games = await client.models.Game.list({
      filter: { teamId: { eq: teamId } }
    });

    for (const game of games.data) {
      await client.models.Game.update({
        id: game.id,
        coaches: newCoaches
      });
    }

    console.log(`Updated ${games.data.length} games`);

    console.log('Successfully propagated access to all related data');
  } catch (error) {
    console.error('Error granting coach access:', error);
    throw error;
  }
}
