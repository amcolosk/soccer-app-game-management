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
  PutCommand: vi.fn(function (input) { return { __type: 'PutCommand', input }; }),
  ScanCommand: vi.fn(function (input) { return { __type: 'ScanCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];
const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: {
      gameId: 'game-1',
      noteType: 'coaching-point',
      playerId: undefined,
      authorId: 'spoofed-author',
      gameSeconds: null,
      half: null,
      notes: 'Pre-game focus',
      timestamp: '2026-03-29T12:00:00.000Z',
      ...overrides,
    },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('create-game-note handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_NOTE_TABLE = 'GameNoteTable';
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'game-1',
            teamId: 'team-1',
            coaches: ['coach-1'],
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        return { Items: [{ id: 'roster-1' }] };
      }

      if (command.__type === 'PutCommand') {
        return {};
      }

      return {};
    });
  });

  it('ignores spoofed authorId and writes the authenticated user as authorId', async () => {
    await invoke(createEvent());

    const putCall = mockSend.mock.calls.find(([command]) => command.__type === 'PutCommand');
    const item = putCall?.[0].input.Item as { authorId?: string };
    expect(item.authorId).toBe('coach-1');
  });

  it('rejects coaching-point notes with non-null timing', async () => {
    await expect(invoke(createEvent({ gameSeconds: 15, half: 1 }))).rejects.toThrow(
      'coaching-point notes must have null gameSeconds and half'
    );
  });

  it('rejects non-coaching notes without both timing fields', async () => {
    await expect(invoke(createEvent({ noteType: 'gold-star', gameSeconds: 15, half: null }))).rejects.toThrow(
      'non-coaching notes must include both gameSeconds and half'
    );
  });

  it('rejects non-coaching notes with negative gameSeconds', async () => {
    await expect(invoke(createEvent({ noteType: 'gold-star', gameSeconds: -1, half: 1 }))).rejects.toThrow(
      'non-coaching notes must include a non-negative integer gameSeconds and half of 1 or 2'
    );
  });

  it('rejects non-coaching notes with an invalid half', async () => {
    await expect(invoke(createEvent({ noteType: 'gold-star', gameSeconds: 15, half: 3 }))).rejects.toThrow(
      'non-coaching notes must include a non-negative integer gameSeconds and half of 1 or 2'
    );
  });

  it('rejects playerId values that are not on the game team roster', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'game-1',
            teamId: 'team-1',
            coaches: ['coach-1'],
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }

      return {};
    });

    await expect(invoke(createEvent({ noteType: 'gold-star', gameSeconds: 15, half: 1, playerId: 'player-404' }))).rejects.toThrow(
      'playerId must belong to the game team roster'
    );
  });

  it('does not write playerId attribute to DynamoDB when playerId is absent', async () => {
    await invoke(createEvent({ playerId: undefined }));

    const putCall = mockSend.mock.calls.find(([command]) => command.__type === 'PutCommand');
    const item = putCall?.[0].input.Item as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(item, 'playerId')).toBe(false);
  });

  it('does not write playerId attribute to DynamoDB when playerId is null', async () => {
    await invoke(createEvent({ playerId: null }));

    const putCall = mockSend.mock.calls.find(([command]) => command.__type === 'PutCommand');
    const item = putCall?.[0].input.Item as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(item, 'playerId')).toBe(false);
  });
});