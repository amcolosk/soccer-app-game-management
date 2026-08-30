import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  PutCommand: vi.fn(function (input) { return { __type: 'PutCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
  ScanCommand: vi.fn(function (input) { return { __type: 'ScanCommand', input }; }),
}));

import { handler } from './handler';
import type { Schema } from '../../data/resource';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];
type SyncResult = NonNullable<Schema['syncTeamCalendar']['returnType']>;
const invoke = async (event: HandlerEvent): Promise<SyncResult> => {
  const result = await handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);
  if (!result) throw new Error('handler returned no result');
  return result as unknown as SyncResult;
};

function buildIcs(veventBlocks: string[], calProps: string[] = []): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...calProps,
    ...veventBlocks.flatMap((v) => ['BEGIN:VEVENT', ...v.split('\n'), 'END:VEVENT']),
    'END:VCALENDAR',
    '',
  ].join('\n');
}

function newEventIcs(uid: string, summary = 'Rivals FC', dtstart = '20260906T150000Z'): string {
  return `UID:${uid}\nSUMMARY:${summary}\nDTSTART:${dtstart}`;
}

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}, identity: unknown = { sub: 'coach-1' }): HandlerEvent {
  return {
    arguments: {
      teamId: 'team-1',
      feedUrl: undefined,
      icsContent: buildIcs([newEventIcs('Game_new_1')]),
      saveFeedUrl: undefined,
      dryRun: undefined,
      ...overrides,
    },
    identity,
  } as HandlerEvent;
}

const activeTeam = { id: 'team-1', coaches: ['coach-1', 'coach-2'], status: 'active' };

describe('sync-team-calendar handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: activeTeam };
      }
      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }
      if (command.__type === 'PutCommand' || command.__type === 'UpdateCommand') {
        return { Attributes: { id: 'updated-1' } };
      }
      return {};
    });
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(invoke(createEvent({}, {}))).rejects.toThrow('User not authenticated');
  });

  it('rejects a caller who is not a coach on the team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: { id: 'team-1', coaches: ['someone-else'], status: 'active' } };
      if (command.__type === 'ScanCommand') return { Items: [] };
      return {};
    });
    await expect(invoke(createEvent())).rejects.toThrow('Access denied');
  });

  it('rejects syncing an archived team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: { ...activeTeam, status: 'archived' } };
      return {};
    });
    await expect(invoke(createEvent())).rejects.toThrow(/archived/i);
  });

  it('hard-rejects feedUrl in Phase 2 (not silently ignored)', async () => {
    await expect(invoke(createEvent({ feedUrl: 'https://calendar.playmetrics.com/x' })))
      .rejects.toThrow(/not available yet/i);
  });

  it('hard-rejects saveFeedUrl in Phase 2', async () => {
    await expect(invoke(createEvent({ saveFeedUrl: true }))).rejects.toThrow(/not available yet/i);
  });

  it('rejects when icsContent is missing', async () => {
    await expect(invoke(createEvent({ icsContent: undefined }))).rejects.toThrow('icsContent is required');
  });

  it('rejects icsContent larger than 512 KB (server-side enforcement of the advisory client cap)', async () => {
    const huge = 'a'.repeat(513 * 1024);
    await expect(invoke(createEvent({ icsContent: huge }))).rejects.toThrow(/too large/i);
  });

  it('rejects a malformed calendar file with a clear error', async () => {
    await expect(invoke(createEvent({ icsContent: 'not an ics file at all' })))
      .rejects.toThrow(/Could not parse calendar file/i);
  });

  it('creates a new game with a deterministic id, derives coaches from the team, and returns a complete Game object', async () => {
    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_new_1', 'Rivals FC')]) }));

    const putCall = mockSend.mock.calls.find(([c]) => c.__type === 'PutCommand');
    expect(putCall).toBeDefined();
    const item = putCall![0].input.Item as Record<string, unknown>;
    expect(item.teamId).toBe('team-1');
    expect(item.coaches).toEqual(['coach-1', 'coach-2']);
    expect(item.status).toBe('scheduled');
    expect(item.externalUid).toBe('Game_new_1');
    expect(item.__typename).toBe('Game');
    expect(typeof item.createdAt).toBe('string');
    expect(typeof item.updatedAt).toBe('string');
    expect(putCall![0].input.ConditionExpression).toBe('attribute_not_exists(id)');

    expect(result.createdGames).toHaveLength(1);
    expect(result.createdGames![0]!.id).toBe(item.id);
  });

  it('produces the same deterministic id across two separate invocations for the same event (idempotency setup)', async () => {
    const r1 = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_stable', 'Rivals FC')]) }));
    vi.clearAllMocks();
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_TABLE = 'TeamTable';
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') return { Items: [] };
      return {};
    });
    const r2 = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_stable', 'Rivals FC')]) }));
    expect(r1.createdGames![0]!.id).toBe(r2.createdGames![0]!.id);
  });

  it('double-invocation idempotency: a PutCommand collision on the deterministic id is counted as skipped, not failed', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') return { Items: [] };
      if (command.__type === 'PutCommand') {
        const err = new Error('conditional check failed');
        (err as Error & { name: string }).name = 'ConditionalCheckFailedException';
        throw err;
      }
      return {};
    });

    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_race')]) }));
    expect(result.createdGames).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('skips an unchanged event matched by externalUid + externalSource (same content hash)', async () => {
    // Build the ics first so we can compute the matching hash the same way the handler will.
    const ics = buildIcs([newEventIcs('Game_existing', 'Rivals FC', '20260906T150000Z')]);
    const { computeContentHash } = await import('../shared/ical/contentHash');
    const hash = computeContentHash({
      opponent: 'Rivals FC', isHome: false, gameDate: '2026-09-06T15:00:00.000Z',
      locationName: null, locationAddress: null, arriveByTime: null,
    });

    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') {
        return {
          Items: [{
            id: 'existing-game-1', teamId: 'team-1', status: 'scheduled',
            externalUid: 'Game_existing', externalSource: 'ics', externalContentHash: hash,
            gameDate: '2026-09-06T15:00:00.000Z',
          }],
        };
      }
      return {};
    });

    const result = await invoke(createEvent({ icsContent: ics }));
    expect(result.skippedCount).toBe(1);
    expect(result.updatedGames).toHaveLength(0);
    expect(mockSend.mock.calls.some(([c]) => c.__type === 'UpdateCommand')).toBe(false);
  });

  it('updates an existing matched game when the content hash has changed, using ALL_NEW and a scheduled-status guard', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') {
        return {
          Items: [{
            id: 'existing-game-1', teamId: 'team-1', status: 'scheduled',
            externalUid: 'Game_existing', externalSource: 'ics', externalContentHash: 'stale-hash',
            gameDate: '2026-09-06T15:00:00.000Z',
          }],
        };
      }
      if (command.__type === 'UpdateCommand') {
        return { Attributes: { id: 'existing-game-1', opponent: 'Rivals FC', updatedAt: 'now' } };
      }
      return {};
    });

    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_existing', 'Rivals FC')]) }));
    const updateCall = mockSend.mock.calls.find(([c]) => c.__type === 'UpdateCommand');
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.ReturnValues).toBe('ALL_NEW');
    expect(updateCall![0].input.ConditionExpression).toContain('#status = :scheduled');
    expect(result.updatedGames).toHaveLength(1);
  });

  it('protects a matched game whose status is not scheduled — no write attempted', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') {
        return {
          Items: [{
            id: 'in-progress-game', teamId: 'team-1', status: 'in-progress',
            externalUid: 'Game_existing', externalSource: 'ics',
            gameDate: '2026-09-06T15:00:00.000Z',
          }],
        };
      }
      return {};
    });

    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_existing', 'Rivals FC')]) }));
    expect(result.protectedCount).toBe(1);
    expect(mockSend.mock.calls.some(([c]) => c.__type === 'UpdateCommand')).toBe(false);
  });

  it('counts a ConditionalCheckFailedException race on update as protectedCount, not failedCount (Major 3)', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') {
        return {
          Items: [{
            id: 'existing-game-1', teamId: 'team-1', status: 'scheduled',
            externalUid: 'Game_existing', externalSource: 'ics', externalContentHash: 'stale-hash',
            gameDate: '2026-09-06T15:00:00.000Z',
          }],
        };
      }
      if (command.__type === 'UpdateCommand') {
        const err = new Error('conditional check failed');
        (err as Error & { name: string }).name = 'ConditionalCheckFailedException';
        throw err;
      }
      return {};
    });

    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_existing', 'Rivals FC')]) }));
    expect(result.protectedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('flags a cancelled feed event on a matched scheduled game — externalCancelled set, never deleted', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') {
        return {
          Items: [{
            id: 'existing-game-1', teamId: 'team-1', status: 'scheduled',
            externalUid: 'Game_existing', externalSource: 'ics', externalCancelled: false,
            gameDate: '2026-09-06T15:00:00.000Z',
          }],
        };
      }
      if (command.__type === 'UpdateCommand') return { Attributes: { id: 'existing-game-1', externalCancelled: true } };
      return {};
    });

    const ics = buildIcs(['UID:Game_existing\nSUMMARY:Rivals FC\nDTSTART:20260906T150000Z\nSTATUS:CANCELLED']);
    const result = await invoke(createEvent({ icsContent: ics }));
    expect(result.cancelledCount).toBe(1);
    const deleteCalled = mockSend.mock.calls.some(([c]) => c.__type === 'DeleteCommand');
    expect(deleteCalled).toBe(false);
    const updateCall = mockSend.mock.calls.find(([c]) => c.__type === 'UpdateCommand');
    expect(updateCall![0].input.ExpressionAttributeValues[':true']).toBe(true);
  });

  it('adopts a hand-created game within the ±3h window instead of duplicating it, keeping its original id', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') {
        return {
          Items: [{
            id: 'hand-created-1', teamId: 'team-1', status: 'scheduled',
            externalUid: null, gameDate: '2026-09-06T16:00:00.000Z', // 1h off from the feed event
          }],
        };
      }
      if (command.__type === 'UpdateCommand') {
        return { Attributes: { id: 'hand-created-1', externalAdoptedAt: '2026-01-01T00:00:00.000Z' } };
      }
      return {};
    });

    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_new_uid', 'Rivals FC', '20260906T150000Z')]) }));
    expect(result.adoptedCount).toBe(1);
    expect(result.updatedGames).toHaveLength(1);
    expect(result.createdGames).toHaveLength(0);
    const updateCall = mockSend.mock.calls.find(([c]) => c.__type === 'UpdateCommand');
    expect(updateCall![0].input.Key).toEqual({ id: 'hand-created-1' });
    expect(result.warnings?.some((w) => /to an existing game you entered by hand/i.test(w ?? ''))).toBe(true);
  });

  it('does not adopt a hand-created game outside the ±3h window — creates a new game instead', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') {
        return {
          Items: [{
            id: 'hand-created-1', teamId: 'team-1', status: 'scheduled',
            externalUid: null, gameDate: '2026-09-06T20:00:00.000Z', // 5h off — outside the window
          }],
        };
      }
      return {};
    });

    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_new_uid', 'Rivals FC', '20260906T150000Z')]) }));
    expect(result.adoptedCount).toBe(0);
    expect(result.createdGames).toHaveLength(1);
  });

  it('dryRun performs no writes but returns the same predicted counts as a real sync', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') return { Items: [] };
      return {};
    });

    const result = await invoke(createEvent({ icsContent: buildIcs([newEventIcs('Game_preview')]), dryRun: true }));
    expect(result.createdGames).toHaveLength(1);
    const writeCalled = mockSend.mock.calls.some(([c]) => c.__type === 'PutCommand' || c.__type === 'UpdateCommand');
    expect(writeCalled).toBe(false);
  });

  it('continues processing remaining events after a per-event write failure, counting it as failedCount', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      if (command.__type === 'ScanCommand') return { Items: [] };
      if (command.__type === 'PutCommand') {
        const item = command.input.Item as { externalUid: string };
        if (item.externalUid === 'Game_bad') {
          throw new Error('DynamoDB is on fire');
        }
        return {};
      }
      return {};
    });

    const ics = buildIcs([newEventIcs('Game_bad', 'Bad Team'), newEventIcs('Game_good', 'Good Team')]);
    const result = await invoke(createEvent({ icsContent: ics }));
    expect(result.failedCount).toBe(1);
    expect(result.createdGames).toHaveLength(1);
    expect(result.createdGames![0]!.externalUid).toBe('Game_good');
  });
});
