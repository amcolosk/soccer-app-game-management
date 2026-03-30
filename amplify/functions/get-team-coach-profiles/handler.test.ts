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
  GetCommand: vi.fn(function (input) {
    return { __type: 'GetCommand', input };
  }),
  BatchGetCommand: vi.fn(function (input) {
    return { __type: 'BatchGetCommand', input };
  }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];

function createEvent(teamId = 'team-1', sub = 'coach-1'): HandlerEvent {
  return {
    arguments: { teamId },
    identity: { sub },
  } as HandlerEvent;
}

describe('getTeamCoachProfiles handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAM_TABLE = 'TeamTable';
    process.env.COACH_PROFILE_TABLE = 'CoachProfileTable';
  });

  it('uses Team GetItem plus BatchGet and returns disambiguated display labels', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { id: 'team-1', coaches: ['coach-1', 'coach-2', 'coach-3'] } })
      .mockResolvedValueOnce({
        Responses: {
          CoachProfileTable: [
            {
              id: 'coach-1',
              firstName: 'Alex',
              lastName: 'Moore',
              shareLastNameWithCoaches: false,
              displayNameFull: 'Alex M.',
              displayNamePrivacy: 'Alex',
            },
            {
              id: 'coach-2',
              firstName: 'Alex',
              lastName: 'Parker',
              shareLastNameWithCoaches: false,
              displayNameFull: 'Alex P.',
              displayNamePrivacy: 'Alex',
            },
          ],
        },
        UnprocessedKeys: {},
      });

    const result = await handler(createEvent());

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].__type).toBe('GetCommand');
    expect(mockSend.mock.calls[1][0].__type).toBe('BatchGetCommand');

    expect(result).toEqual([
      {
        coachId: 'coach-1',
        displayName: 'Alex (Coach 1)',
        isFallback: false,
        disambiguationGroupKey: 'alex',
      },
      {
        coachId: 'coach-2',
        displayName: 'Alex (Coach 2)',
        isFallback: false,
        disambiguationGroupKey: 'alex',
      },
      {
        coachId: 'coach-3',
        displayName: null,
        isFallback: true,
        disambiguationGroupKey: null,
      },
    ]);
  });

  it('rejects caller who is not on the team coaches array', async () => {
    mockSend.mockResolvedValueOnce({ Item: { id: 'team-1', coaches: ['coach-1'] } });

    await expect(handler(createEvent('team-1', 'coach-x'))).rejects.toThrow(
      'Unauthorized or team not found'
    );
  });

  it('returns the same generic error when team does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await expect(handler(createEvent('team-missing', 'coach-x'))).rejects.toThrow(
      'Unauthorized or team not found'
    );
  });

  it('chunks BatchGet requests when team has more than 100 coaches', async () => {
    const coaches = Array.from({ length: 101 }, (_, i) => `coach-${i + 1}`);

    mockSend
      .mockResolvedValueOnce({ Item: { id: 'team-1', coaches } })
      .mockResolvedValueOnce({ Responses: { CoachProfileTable: [] }, UnprocessedKeys: {} })
      .mockResolvedValueOnce({ Responses: { CoachProfileTable: [] }, UnprocessedKeys: {} });

    await handler(createEvent('team-1', 'coach-1'));

    const batchCalls = mockSend.mock.calls.filter(([c]) => c.__type === 'BatchGetCommand');
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0][0].input.RequestItems.CoachProfileTable.Keys).toHaveLength(100);
    expect(batchCalls[1][0].input.RequestItems.CoachProfileTable.Keys).toHaveLength(1);
  });
});
