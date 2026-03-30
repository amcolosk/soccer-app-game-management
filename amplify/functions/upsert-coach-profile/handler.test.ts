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
  PutCommand: vi.fn(function (input) {
    return { __type: 'PutCommand', input };
  }),
  UpdateCommand: vi.fn(function (input) {
    return { __type: 'UpdateCommand', input };
  }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: {
      firstName: '  Alice ',
      lastName: ' Murphy ',
      shareLastNameWithCoaches: true,
      ...overrides,
    },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('upsertCoachProfile handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COACH_PROFILE_TABLE = 'CoachProfileTable';
  });

  it('creates a new profile with canonical normalization and computed display names', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    const result = await handler(createEvent({ lastName: '   ' }));

    const putCall = mockSend.mock.calls.find(([c]) => c.__type === 'PutCommand');
    expect(putCall?.[0].input.Item).toMatchObject({
      id: 'coach-1',
      firstName: 'Alice',
      lastName: null,
      shareLastNameWithCoaches: true,
      displayNameFull: 'Alice',
      displayNamePrivacy: 'Alice',
    });

    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBeNull();
  });

  it('updates with optimistic concurrency when expectedUpdatedAt is provided', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { id: 'coach-1', updatedAt: '2026-03-30T00:00:00Z' } })
      .mockResolvedValueOnce({
        Attributes: {
          id: 'coach-1',
          firstName: 'Alice',
          lastName: 'Murphy',
          shareLastNameWithCoaches: true,
          displayNameFull: 'Alice M.',
          displayNamePrivacy: 'Alice',
          createdAt: '2026-03-30T00:00:00Z',
          updatedAt: '2026-03-30T00:01:00Z',
        },
      });

    const result = await handler(createEvent({ expectedUpdatedAt: '2026-03-30T00:00:00Z' }));
    expect(result.displayNameFull).toBe('Alice M.');
  });

  it('throws a conflict sentinel on ConditionalCheckFailedException', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { id: 'coach-1', updatedAt: '2026-03-30T00:00:00Z' } })
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });

    await expect(handler(createEvent({ expectedUpdatedAt: '2026-03-30T00:00:00Z' }))).rejects.toThrow(
      'CONFLICT_PROFILE_UPDATED_ELSEWHERE'
    );
  });

  it('uses last-write-wins update when no concurrency token is provided', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { id: 'coach-1', updatedAt: '2026-03-30T00:00:00Z' } })
      .mockResolvedValueOnce({
        Attributes: {
          id: 'coach-1',
          firstName: 'Alice',
          lastName: 'Murphy',
          shareLastNameWithCoaches: false,
          displayNameFull: 'Alice M.',
          displayNamePrivacy: 'Alice',
          createdAt: '2026-03-30T00:00:00Z',
          updatedAt: '2026-03-30T00:01:00Z',
        },
      });

    const result = await handler(createEvent({ shareLastNameWithCoaches: false }));
    expect(result.shareLastNameWithCoaches).toBe(false);
  });

  it('rejects firstName values longer than 50 chars', async () => {
    await expect(handler(createEvent({ firstName: 'A'.repeat(51) }))).rejects.toThrow(
      'VALIDATION_FIRST_NAME_TOO_LONG'
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects lastName values longer than 50 chars', async () => {
    await expect(handler(createEvent({ lastName: 'B'.repeat(51) }))).rejects.toThrow(
      'VALIDATION_LAST_NAME_TOO_LONG'
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});
