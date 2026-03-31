import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

interface CoachProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  shareLastNameWithCoaches: boolean;
  displayNameFull: string | null;
  displayNamePrivacy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TeamCoachProfileDTO {
  coachId: string;
  displayName: string | null;
  isFallback: boolean;
  disambiguationGroupKey: string | null;
}

interface Team {
  coaches?: string[];
}

interface GetTeamCoachProfilesEvent {
  arguments: {
    teamId: string;
  };
  identity: AppSyncIdentityCognito;
}

const GENERIC_ACCESS_ERROR = 'Unauthorized or team not found';

function createGenericAccessError(): Error {
  return new Error(GENERIC_ACCESS_ERROR);
}

/**
 * Fetch coach profiles in chunks via BatchGetItem
 */
async function batchGetCoachProfiles(
  coachIds: string[],
  tableName: string
): Promise<Map<string, CoachProfile | null>> {
  const result = new Map<string, CoachProfile | null>();

  // DynamoDB BatchGetItem max 100 items per request
  const chunkSize = 100;
  for (let i = 0; i < coachIds.length; i += chunkSize) {
    const chunk = coachIds.slice(i, i + chunkSize);

    let unprocessedKeys: Array<{ id: string }> = chunk.map((id) => ({ id }));
    do {
      const response = await docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [tableName]: {
              Keys: unprocessedKeys,
            },
          },
        })
      );

      const profiles = (response.Responses?.[tableName] || []) as CoachProfile[];
      profiles.forEach((p) => {
        result.set(p.id, p);
      });

      unprocessedKeys = (response.UnprocessedKeys?.[tableName]?.Keys as Array<{ id: string }> | undefined) ?? [];
    } while (unprocessedKeys.length > 0);

    // Mark missing profiles as null
    chunk.forEach((id) => {
      if (!result.has(id)) {
        result.set(id, null);
      }
    });
  }

  return result;
}

/**
 * Compute the display name for attribution based on privacy setting
 */
function getDisplayName(profile: CoachProfile | null): string | null {
  if (!profile) return null;
  if (!profile.firstName) return null;

  if (profile.shareLastNameWithCoaches && profile.lastName) {
    return profile.displayNameFull ?? `${profile.firstName} ${profile.lastName.charAt(0).toUpperCase()}.`;
  }

  return profile.displayNamePrivacy ?? profile.firstName;
}

/**
 * Normalize a display name for grouping (lowercase, trim)
 */
function normalizeDisplayName(name: string | null): string {
  if (!name) return '';
  return name.toLowerCase().trim();
}

/**
 * Build disambiguation group key from normalized display name
 */
function buildDisambiguationGroupKey(displayName: string | null): string | null {
  if (!displayName) return null;
  return normalizeDisplayName(displayName);
}

/**
 * Apply deterministic ordinal disambiguation to duplicate display names
 */
function applyDisambiguation(
  profileDTOs: TeamCoachProfileDTO[]
): TeamCoachProfileDTO[] {
  // Group by normalized display name
  const groups = new Map<string, TeamCoachProfileDTO[]>();

  profileDTOs.forEach((dto) => {
    const key = dto.disambiguationGroupKey || '';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(dto);
  });

  // Apply ordinal suffixes to collisions
  const result: TeamCoachProfileDTO[] = [];
  groups.forEach((groupDTOs) => {
    if (groupDTOs.length === 1) {
      // No collision, return as-is
      result.push(groupDTOs[0]);
    } else {
      // Collision: sort by coachId and apply ordinal
      const sortedByCoachId = groupDTOs.sort((a, b) =>
        a.coachId.localeCompare(b.coachId)
      );

      sortedByCoachId.forEach((dto, index) => {
        const ordinal = index + 1;
        if (dto.displayName) {
          result.push({
            ...dto,
            displayName: `${dto.displayName} (Coach ${ordinal})`,
          });
          return;
        }
        result.push(dto);
      });
    }
  });

  return result;
}

export async function handler(
  event: GetTeamCoachProfilesEvent
): Promise<TeamCoachProfileDTO[]> {
  const { teamId } = event.arguments;
  const callerId = (event.identity as AppSyncIdentityCognito).sub;

  const teamTableName = process.env.TEAM_TABLE || 'Team';
  const coachProfileTableName = process.env.COACH_PROFILE_TABLE || 'CoachProfile';

  try {
    if (!callerId) {
      throw createGenericAccessError();
    }

    // 1. GetItem Team to retrieve coaches array
    const teamResponse = await docClient.send(
      new GetCommand({
        TableName: teamTableName,
        Key: { id: teamId },
      })
    );

    const team = teamResponse.Item as Team | undefined;
    if (!team) {
      throw createGenericAccessError();
    }

    // 2. Verify caller is in team coaches
    const coaches = team.coaches || [];
    if (!coaches.includes(callerId)) {
      throw createGenericAccessError();
    }

    // 3. Fetch all coach profiles via chunked BatchGetItem
    const profileMap = await batchGetCoachProfiles(coaches, coachProfileTableName);

    // 4. Build minimized DTO
    const profileDTOs: TeamCoachProfileDTO[] = coaches.map((coachId) => {
      const profile = profileMap.get(coachId) ?? null;
      const displayName = getDisplayName(profile);
      const disambiguationGroupKey = buildDisambiguationGroupKey(displayName);

      return {
        coachId,
        displayName,
        isFallback: !displayName,
        disambiguationGroupKey,
      };
    });

    // 5. Apply deterministic disambiguation
    const disambiguatedDTOs = applyDisambiguation(profileDTOs);

    return disambiguatedDTOs;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === GENERIC_ACCESS_ERROR) {
      throw createGenericAccessError();
    }

    console.error('Error in getTeamCoachProfiles:', error);
    throw error;
  }
}
