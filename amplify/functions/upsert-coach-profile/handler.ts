import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

interface CoachProfileInput {
  firstName?: string | null;
  lastName?: string | null;
  shareLastNameWithCoaches?: boolean;
  expectedUpdatedAt?: string;
}

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

interface UpsertCoachProfileEvent {
  arguments: CoachProfileInput;
  identity: AppSyncIdentityCognito;
}

const MAX_NAME_LENGTH = 50;

/**
 * Normalize a name string: trim and convert blank to null
 */
function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Compute display name for privacy mode (first name only)
 */
function computeDisplayNamePrivacy(firstName: string | null): string | null {
  return firstName ? firstName : null;
}

/**
 * Compute display name for full mode (first + last initial)
 */
function computeDisplayNameFull(
  firstName: string | null,
  lastName: string | null
): string | null {
  if (!firstName) return null;
  if (!lastName) return firstName;
  const lastInitial = lastName.charAt(0).toUpperCase();
  return `${firstName} ${lastInitial}.`;
}

export async function handler(
  event: UpsertCoachProfileEvent
): Promise<CoachProfile> {
  const coachId = (event.identity as AppSyncIdentityCognito).sub;
  if (!coachId) {
    throw new Error('Unauthorized: missing identity sub');
  }

  const { firstName: inFirstName, lastName: inLastName, shareLastNameWithCoaches, expectedUpdatedAt } =
    event.arguments;

  // Normalize inputs
  const firstName = normalizeName(inFirstName);
  const lastName = normalizeName(inLastName);
  const shareLastName = shareLastNameWithCoaches ?? true;

  if (firstName && firstName.length > MAX_NAME_LENGTH) {
    throw new Error('VALIDATION_FIRST_NAME_TOO_LONG');
  }

  if (lastName && lastName.length > MAX_NAME_LENGTH) {
    throw new Error('VALIDATION_LAST_NAME_TOO_LONG');
  }

  // Compute optimized display name fields
  const displayNamePrivacy = computeDisplayNamePrivacy(firstName);
  const displayNameFull = computeDisplayNameFull(firstName, lastName);

  const now = new Date().toISOString();
  const tableName = process.env.COACH_PROFILE_TABLE || 'CoachProfile';

  try {
    // First, check if profile exists
    const existingResponse = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { id: coachId },
      })
    );

    const existing = existingResponse.Item as CoachProfile | undefined;

    if (!existing) {
      // Create new profile
      const profile: CoachProfile = {
        id: coachId,
        firstName,
        lastName,
        shareLastNameWithCoaches: shareLastName,
        displayNameFull,
        displayNamePrivacy,
        createdAt: now,
        updatedAt: now,
      };

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: profile,
          ConditionExpression: 'attribute_not_exists(id)',
        })
      );

      return profile;
    }

    // Update existing profile
    // If expectedUpdatedAt is provided, use optimistic concurrency check
    if (expectedUpdatedAt) {
      try {
        const response = await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id: coachId },
            UpdateExpression:
              'SET firstName = :fn, lastName = :ln, shareLastNameWithCoaches = :s, displayNameFull = :dnf, displayNamePrivacy = :dnp, updatedAt = :upd',
            ConditionExpression: 'updatedAt = :expectedUpdatedAt',
            ExpressionAttributeValues: {
              ':fn': firstName,
              ':ln': lastName,
              ':s': shareLastName,
              ':dnf': displayNameFull,
              ':dnp': displayNamePrivacy,
              ':upd': now,
              ':expectedUpdatedAt': expectedUpdatedAt,
            },
            ReturnValues: 'ALL_NEW',
          })
        );

        return response.Attributes as CoachProfile;
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
          // Concurrency conflict: return error that client can handle
          throw new Error('CONFLICT_PROFILE_UPDATED_ELSEWHERE');
        }
        throw err;
      }
    } else {
      // No concurrency token: last-write-wins
      const response = await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { id: coachId },
          UpdateExpression:
            'SET firstName = :fn, lastName = :ln, shareLastNameWithCoaches = :s, displayNameFull = :dnf, displayNamePrivacy = :dnp, updatedAt = :upd',
          ExpressionAttributeValues: {
            ':fn': firstName,
            ':ln': lastName,
            ':s': shareLastName,
            ':dnf': displayNameFull,
            ':dnp': displayNamePrivacy,
            ':upd': now,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      return response.Attributes as CoachProfile;
    }
  } catch (error: unknown) {
    console.error('Error in upsertCoachProfile:', error);
    throw error;
  }
}
