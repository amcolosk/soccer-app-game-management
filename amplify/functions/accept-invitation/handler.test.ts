import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  ScanCommand: vi.fn(function (input) { return { __type: 'ScanCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler, mergeCoachLists, shouldBackfillCoaches } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

function invokeHandler(event: HandlerEvent) {
  const context = {} as HandlerContext;
  const callback: HandlerCallback = () => undefined;

  return handler(event, context, callback);
}

describe('accept invitation coach backfill helpers', () => {
  it('merges coach lists without duplicates', () => {
    expect(mergeCoachLists(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('detects when backfill is needed', () => {
    expect(shouldBackfillCoaches(['owner-a'], ['owner-b'])).toBe(true);
    expect(shouldBackfillCoaches(['owner-a', 'owner-b'], ['owner-b'])).toBe(false);
  });
});

describe('accept invitation handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.TEAM_INVITATION_TABLE = 'TeamInvitationTable';
    process.env.TEAM_TABLE = 'TeamTable';
    process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';
    process.env.PLAYER_TABLE = 'PlayerTable';
    process.env.FORMATION_TABLE = 'FormationTable';
    process.env.FORMATION_POSITION_TABLE = 'FormationPositionTable';
  });

  it('backfills coaches to roster, players, formation, and formation positions', async () => {
    const updateInputs: Array<Record<string, unknown>> = [];
    let teamUpdated = false;

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        const table = command.input.TableName;
        const key = command.input.Key as { id: string };

        if (table === 'TeamInvitationTable') {
          return {
            Item: {
              id: 'invite-1',
              teamId: 'team-1',
              email: 'coach@example.com',
              status: 'PENDING',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          };
        }

        if (table === 'TeamTable') {
          return {
            Item: {
              id: 'team-1',
              formationId: 'formation-1',
              coaches: teamUpdated ? ['owner-a', 'coach-b'] : ['owner-a'],
            },
          };
        }

        if (table === 'PlayerTable' && key.id === 'player-1') {
          return { Item: { id: 'player-1', coaches: ['owner-a'] } };
        }

        if (table === 'PlayerTable' && key.id === 'player-2') {
          return { Item: { id: 'player-2', coaches: ['owner-a'] } };
        }

        if (table === 'FormationTable') {
          return { Item: { id: 'formation-1', coaches: ['owner-a'] } };
        }
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName;

        if (table === 'TeamRosterTable') {
          return {
            Items: [
              { id: 'roster-1', playerId: 'player-1', coaches: ['owner-a'] },
              { id: 'roster-2', playerId: 'player-2', coaches: ['owner-a'] },
            ],
          };
        }

        if (table === 'FormationPositionTable') {
          return {
            Items: [
              { id: 'position-1', coaches: ['owner-a'] },
            ],
          };
        }
      }

      if (command.__type === 'UpdateCommand') {
        if (command.input.TableName === 'TeamTable') {
          teamUpdated = true;
        }
        updateInputs.push(command.input);
        return {};
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'coach@example.com' } },
    };

    await invokeHandler(event as HandlerEvent);

    const updatedTables = updateInputs.map((update) => update.TableName);
    expect(updatedTables).toContain('TeamTable');
    expect(updatedTables).toContain('TeamRosterTable');
    expect(updatedTables).toContain('PlayerTable');
    expect(updatedTables).toContain('FormationTable');
    expect(updatedTables).toContain('FormationPositionTable');
    expect(updatedTables).toContain('TeamInvitationTable');

    const invitationClaimUpdate = updateInputs.find(
      (update) => update.TableName === 'TeamInvitationTable' && update.ConditionExpression === '#status = :pendingStatus'
    );
    expect(invitationClaimUpdate).toBeDefined();

    const teamMergeUpdate = updateInputs.find((update) => update.TableName === 'TeamTable');
    expect(teamMergeUpdate?.UpdateExpression).toContain('list_append(if_not_exists(coaches, :emptyCoaches), :coachToAdd)');
    expect(teamMergeUpdate?.ConditionExpression).toBe('attribute_not_exists(coaches) OR NOT contains(coaches, :coachId)');

    const coachUpdates = updateInputs.filter((update) => {
      const values = update.ExpressionAttributeValues as Record<string, unknown> | undefined;
      return Array.isArray(values?.[':coaches']);
    });

    for (const update of coachUpdates) {
      const values = update.ExpressionAttributeValues as { ':coaches'?: string[] };
      expect(values[':coaches']).toContain('owner-a');
      expect(values[':coaches']).toContain('coach-b');
    }
  });

  it('supports idempotent retries for invitations already accepted by the same user', async () => {
    const updateInputs: Array<Record<string, unknown>> = [];

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        const table = command.input.TableName;
        const key = command.input.Key as { id: string };

        if (table === 'TeamInvitationTable') {
          return {
            Item: {
              id: 'invite-1',
              teamId: 'team-1',
              email: 'coach@example.com',
              status: 'ACCEPTED',
              acceptedBy: 'coach-b',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          };
        }

        if (table === 'TeamTable') {
          return {
            Item: {
              id: 'team-1',
              formationId: null,
              coaches: ['owner-a', 'coach-b'],
            },
          };
        }

        if (table === 'PlayerTable' && key.id === 'player-1') {
          return { Item: { id: 'player-1', coaches: ['owner-a', 'coach-b'] } };
        }
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName;
        if (table === 'TeamRosterTable') {
          return {
            Items: [
              { id: 'roster-1', playerId: 'player-1', coaches: ['owner-a', 'coach-b'] },
            ],
          };
        }
      }

      if (command.__type === 'UpdateCommand') {
        if (command.input.TableName === 'TeamTable') {
          const error = new Error('conditional write failed');
          (error as Error & { name: string }).name = 'ConditionalCheckFailedException';
          throw error;
        }

        updateInputs.push(command.input);
        return {};
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'coach@example.com' } },
    };

    await expect(invokeHandler(event as HandlerEvent)).resolves.toBeTruthy();

    // No invitation status mutation or coach backfill updates should be needed.
    const invitationUpdates = updateInputs.filter((update) => update.TableName === 'TeamInvitationTable');
    expect(invitationUpdates).toHaveLength(0);

    const coachBackfillUpdates = updateInputs.filter((update) => {
      const values = update.ExpressionAttributeValues as Record<string, unknown> | undefined;
      return Array.isArray(values?.[':coaches']);
    });
    expect(coachBackfillUpdates).toHaveLength(0);
  });

  it('handles paginated roster scans and skips no-op player backfill entries', async () => {
    const scanInputs: Array<Record<string, unknown>> = [];
    const getPlayerKeys: string[] = [];
    const updateInputs: Array<Record<string, unknown>> = [];
    let teamUpdated = false;

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        const table = command.input.TableName;
        const key = command.input.Key as { id: string };

        if (table === 'TeamInvitationTable') {
          return {
            Item: {
              id: 'invite-1',
              teamId: 'team-1',
              email: 'coach@example.com',
              status: 'PENDING',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          };
        }

        if (table === 'TeamTable') {
          return {
            Item: {
              id: 'team-1',
              formationId: null,
              coaches: teamUpdated ? ['owner-a', 'coach-b'] : ['owner-a'],
            },
          };
        }

        if (table === 'PlayerTable') {
          getPlayerKeys.push(key.id);
          return { Item: { id: key.id, coaches: ['owner-a'] } };
        }
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName;

        if (table === 'TeamRosterTable') {
          scanInputs.push(command.input);
          if (!command.input.ExclusiveStartKey) {
            return {
              Items: [
                { id: 'roster-1', playerId: 'player-1', coaches: ['owner-a'] },
              ],
              LastEvaluatedKey: { id: 'roster-1' },
            };
          }

          return {
            Items: [
              { id: 'roster-2', playerId: 'player-1', coaches: ['owner-a'] },
              { id: 'roster-3', coaches: ['owner-a'] },
            ],
          };
        }
      }

      if (command.__type === 'UpdateCommand') {
        if (command.input.TableName === 'TeamTable') {
          teamUpdated = true;
        }
        updateInputs.push(command.input);
        return {};
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'coach@example.com' } },
    };

    await invokeHandler(event as HandlerEvent);

    expect(scanInputs).toHaveLength(2);
    expect(scanInputs[1].ExclusiveStartKey).toEqual({ id: 'roster-1' });

    // Duplicate player IDs from paginated scans should only trigger one player lookup.
    expect(getPlayerKeys).toEqual(['player-1']);

    const coachUpdates = updateInputs.filter(
      (update) => {
        const values = update.ExpressionAttributeValues as Record<string, unknown> | undefined;
        return Array.isArray(values?.[':coaches']);
      }
    );
    // Three roster records + one player record
    expect(coachUpdates).toHaveLength(4);
  });

  it('treats a conditional invitation-claim race as idempotent when same user already claimed it', async () => {
    let invitationGetCount = 0;

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        const table = command.input.TableName;

        if (table === 'TeamInvitationTable') {
          invitationGetCount += 1;
          if (invitationGetCount === 1) {
            return {
              Item: {
                id: 'invite-1',
                teamId: 'team-1',
                email: 'coach@example.com',
                status: 'PENDING',
                expiresAt: '2099-01-01T00:00:00.000Z',
              },
            };
          }

          return {
            Item: {
              id: 'invite-1',
              teamId: 'team-1',
              email: 'coach@example.com',
              status: 'ACCEPTED',
              acceptedBy: 'coach-b',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          };
        }

        if (table === 'TeamTable') {
          return {
            Item: {
              id: 'team-1',
              formationId: null,
              coaches: ['owner-a', 'coach-b'],
            },
          };
        }
      }

      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }

      if (command.__type === 'UpdateCommand' && command.input.TableName === 'TeamInvitationTable') {
        const error = new Error('conditional write failed');
        (error as Error & { name: string }).name = 'ConditionalCheckFailedException';
        throw error;
      }

      if (command.__type === 'UpdateCommand' && command.input.TableName === 'TeamTable') {
        const error = new Error('conditional write failed');
        (error as Error & { name: string }).name = 'ConditionalCheckFailedException';
        throw error;
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'coach@example.com' } },
    };

    await expect(invokeHandler(event as HandlerEvent)).resolves.toBeTruthy();
  });

  it('rejects when a pending invitation is concurrently claimed by a different user', async () => {
    let invitationGetCount = 0;

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamInvitationTable') {
        invitationGetCount += 1;
        if (invitationGetCount === 1) {
          return {
            Item: {
              id: 'invite-1',
              teamId: 'team-1',
              email: 'coach@example.com',
              status: 'PENDING',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          };
        }

        return {
          Item: {
            id: 'invite-1',
            teamId: 'team-1',
            email: 'coach@example.com',
            status: 'ACCEPTED',
            acceptedBy: 'coach-a',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        };
      }

      if (command.__type === 'UpdateCommand' && command.input.TableName === 'TeamInvitationTable') {
        const error = new Error('conditional write failed');
        (error as Error & { name: string }).name = 'ConditionalCheckFailedException';
        throw error;
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'coach@example.com' } },
    };

    await expect(invokeHandler(event as HandlerEvent)).rejects.toThrow('Invitation is ACCEPTED');
  });

  it('rejects idempotent retries when invitation was accepted by a different user', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamInvitationTable') {
        return {
          Item: {
            id: 'invite-1',
            teamId: 'team-1',
            email: 'coach@example.com',
            status: 'ACCEPTED',
            acceptedBy: 'coach-a',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        };
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'coach@example.com' } },
    };

    await expect(invokeHandler(event as HandlerEvent)).rejects.toThrow('Invitation is ACCEPTED');
  });

  it('rejects when authenticated caller email does not match invitation recipient', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamInvitationTable') {
        return {
          Item: {
            id: 'invite-1',
            teamId: 'team-1',
            email: 'target@example.com',
            status: 'PENDING',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        };
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'other@example.com' } },
    };

    await expect(invokeHandler(event as HandlerEvent)).rejects.toThrow('Invitation recipient mismatch');
  });

  it('rejects when authenticated email claim is missing', async () => {
    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: {} },
    };

    await expect(invokeHandler(event as HandlerEvent)).rejects.toThrow('Authenticated email claim missing');
  });

  it('normalizes expired invitation race condition errors to domain error', async () => {
    let invitationGetCount = 0;

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamInvitationTable') {
        invitationGetCount += 1;
        if (invitationGetCount === 1) {
          return {
            Item: {
              id: 'invite-1',
              teamId: 'team-1',
              email: 'coach@example.com',
              status: 'PENDING',
              expiresAt: '2000-01-01T00:00:00.000Z',
            },
          };
        }

        return {
          Item: {
            id: 'invite-1',
            teamId: 'team-1',
            email: 'coach@example.com',
            status: 'EXPIRED',
            acceptedBy: undefined,
            expiresAt: '2000-01-01T00:00:00.000Z',
          },
        };
      }

      if (command.__type === 'UpdateCommand' && command.input.TableName === 'TeamInvitationTable') {
        const error = new Error('conditional write failed');
        (error as Error & { name: string }).name = 'ConditionalCheckFailedException';
        throw error;
      }

      return {};
    });

    const event = {
      arguments: { invitationId: 'invite-1' },
      identity: { sub: 'coach-b', claims: { email: 'coach@example.com' } },
    };

    await expect(invokeHandler(event as HandlerEvent)).rejects.toThrow('Invitation has expired');
  });
});
