import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDynamoSend, mockSesSend, mockCognitoSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
  mockSesSend: vi.fn(),
  mockCognitoSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend })),
  },
  GetCommand: vi.fn(function (input) {
    return { __type: 'GetCommand', input };
  }),
  QueryCommand: vi.fn(function (input) {
    return { __type: 'QueryCommand', input };
  }),
  BatchGetCommand: vi.fn(function (input) {
    return { __type: 'BatchGetCommand', input };
  }),
  UpdateCommand: vi.fn(function (input) {
    return { __type: 'UpdateCommand', input };
  }),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn(function () {
    return { send: mockSesSend };
  }),
  SendEmailCommand: vi.fn(function (input) {
    return { __type: 'SendEmailCommand', input };
  }),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(function () {
    return { send: mockCognitoSend };
  }),
  AdminGetUserCommand: vi.fn(function (input) {
    return { __type: 'AdminGetUserCommand', input };
  }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

const GAME_TABLE = 'GameTable';
const TEAM_TABLE = 'TeamTable';
const GOAL_TABLE = 'GoalTable';
const GAME_NOTE_TABLE = 'GameNoteTable';
const PLAYER_TABLE = 'PlayerTable';
const RATE_LIMIT_TABLE = 'RateLimitTable';
const CALLER_SUB = 'coach-1';
const RESOLVED_EMAIL = 'coach1@example.com';

function createEvent(gameId = 'game-1', sub: string | undefined = CALLER_SUB): HandlerEvent {
  return {
    arguments: { gameId },
    identity: { sub, username: `${sub}-uuid`, claims: {} },
  } as HandlerEvent;
}

interface MockGame {
  id: string;
  teamId?: string;
  opponent?: string;
  isHome?: boolean;
  gameDate?: string;
  status?: string;
  ourScore?: number;
  opponentScore?: number;
  coaches?: string[];
}

interface MockOptions {
  game?: MockGame | undefined;
  team?: { id: string; name: string } | undefined;
  goals?: Array<Record<string, unknown>>;
  gameNotes?: Array<Record<string, unknown>>;
  players?: Array<Record<string, unknown>>;
  rateLimitCount?: number;
  // null (explicit) = simulate no email attribute found; omitted = use RESOLVED_EMAIL.
  // (A destructuring default only kicks in for `undefined`, so `null` is used as the
  // "no email" sentinel to distinguish "not passed" from "explicitly no email".)
  cognitoEmail?: string | null;
}

function defaultGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    id: 'game-1',
    teamId: 'team-1',
    opponent: 'Rival FC',
    isHome: true,
    gameDate: '2026-09-10T18:00:00.000Z',
    status: 'completed',
    ourScore: 3,
    opponentScore: 1,
    coaches: [CALLER_SUB],
    ...overrides,
  };
}

function installMocks(options: MockOptions) {
  const {
    game,
    team,
    goals = [],
    gameNotes = [],
    players = [],
    rateLimitCount = 1,
  } = options;
  const cognitoEmail = options.cognitoEmail === null ? undefined : (options.cognitoEmail ?? RESOLVED_EMAIL);

  mockDynamoSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
    if (command.__type === 'GetCommand') {
      const tableName = command.input.TableName;
      if (tableName === GAME_TABLE) return { Item: game };
      if (tableName === TEAM_TABLE) return { Item: team };
      return { Item: undefined };
    }
    if (command.__type === 'UpdateCommand') {
      return { Attributes: { count: rateLimitCount } };
    }
    if (command.__type === 'QueryCommand') {
      const indexName = command.input.IndexName;
      if (indexName === 'gsi-Game.goals') return { Items: goals };
      if (indexName === 'gsi-Game.gameNotes') return { Items: gameNotes };
      return { Items: [] };
    }
    if (command.__type === 'BatchGetCommand') {
      return { Responses: { [PLAYER_TABLE]: players }, UnprocessedKeys: {} };
    }
    return {};
  });

  mockCognitoSend.mockImplementation(async () => {
    if (!cognitoEmail) {
      return { UserAttributes: [] };
    }
    return { UserAttributes: [{ Name: 'email', Value: cognitoEmail }] };
  });

  mockSesSend.mockResolvedValue({ MessageId: 'ses-message-id' });
}

function queryCalls(): Array<{ __type: string; input: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return mockDynamoSend.mock.calls
    .map(([c]) => c as { __type: string; input: Record<string, any> }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .filter((c) => c.__type === 'QueryCommand');
}

function sesCalls() {
  return mockSesSend.mock.calls;
}

describe('emailGameSummary handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_TABLE = GAME_TABLE;
    process.env.TEAM_TABLE = TEAM_TABLE;
    process.env.GOAL_TABLE = GOAL_TABLE;
    process.env.GAME_NOTE_TABLE = GAME_NOTE_TABLE;
    process.env.PLAYER_TABLE = PLAYER_TABLE;
    process.env.RATE_LIMIT_TABLE = RATE_LIMIT_TABLE;
    process.env.USER_POOL_ID = 'us-east-1_test';
    process.env.FROM_EMAIL = 'TeamTrack Support <admin@coachteamtrack.com>';
  });

  it('rejects a caller not in Game.coaches, with no Query/BatchGet/SES/rate-limit calls', async () => {
    installMocks({ game: defaultGame({ coaches: ['someone-else'] }) });

    await expect(invoke(createEvent())).rejects.toThrow('Access denied: caller is not a coach on this game');

    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend.mock.calls[0][0].__type).toBe('GetCommand');
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('rejects with a distinct "not found" message when the Game does not exist', async () => {
    installMocks({ game: undefined });

    await expect(invoke(createEvent())).rejects.toThrow('Game not found');

    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('rejects when the game is not completed, with no Query/GameNote/SES/rate-limit calls', async () => {
    installMocks({ game: defaultGame({ status: 'in-progress' }) });

    await expect(invoke(createEvent())).rejects.toThrow(
      'Game summary email is only available once the game is completed'
    );

    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend.mock.calls.filter(([c]) => c.__type === 'UpdateCommand')).toHaveLength(0);
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('rejects when the rate limit is exceeded, before any Query/BatchGet/SES call', async () => {
    installMocks({ game: defaultGame(), rateLimitCount: 11 });

    await expect(invoke(createEvent())).rejects.toThrow('Rate limit exceeded. Try again later.');

    // Game GetCommand + rate-limit UpdateCommand only.
    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
    expect(mockDynamoSend.mock.calls[1][0].__type).toBe('UpdateCommand');
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('queries Goal/GameNote with a row-level coaches filter targeting the confirmed relationship GSIs (not Scan)', async () => {
    installMocks({
      game: defaultGame(),
      team: { id: 'team-1', name: 'Thunder' },
      goals: [
        { id: 'goal-1', gameId: 'game-1', scoredByUs: true, gameSeconds: 600, half: 1, scorerId: 'player-1', assistId: null, timestamp: '2026-09-10T18:10:00.000Z', coaches: [CALLER_SUB] },
      ],
      gameNotes: [],
      players: [{ id: 'player-1', firstName: 'Alice', lastName: 'Smith' }],
    });

    await invoke(createEvent());

    const calls = queryCalls();
    expect(calls).toHaveLength(2);

    const goalQuery = calls.find((c) => c.input.IndexName === 'gsi-Game.goals');
    const noteQuery = calls.find((c) => c.input.IndexName === 'gsi-Game.gameNotes');

    expect(goalQuery).toBeDefined();
    expect(noteQuery).toBeDefined();
    expect(goalQuery!.input.TableName).toBe(GOAL_TABLE);
    expect(goalQuery!.input.FilterExpression).toBe('contains(coaches, :callerId)');
    expect(goalQuery!.input.ExpressionAttributeValues[':callerId']).toBe(CALLER_SUB);
    expect(goalQuery!.input.ExpressionAttributeValues[':gameId']).toBe('game-1');

    expect(noteQuery!.input.TableName).toBe(GAME_NOTE_TABLE);
    expect(noteQuery!.input.FilterExpression).toBe('contains(coaches, :callerId)');
    expect(noteQuery!.input.ExpressionAttributeValues[':callerId']).toBe(CALLER_SUB);
  });

  it('excludes a row the mocked Query never returns (row-level visibility parity, Major 2) from the email body', async () => {
    // The DynamoDB FilterExpression would exclude a row whose own `coaches`
    // doesn't include the caller before it ever reaches the handler -- this
    // simulates that by simply never returning it from the mocked Query.
    installMocks({
      game: defaultGame(),
      team: { id: 'team-1', name: 'Thunder' },
      goals: [
        { id: 'goal-visible', gameId: 'game-1', scoredByUs: true, gameSeconds: 100, half: 1, scorerId: 'player-1', assistId: null, timestamp: '2026-09-10T18:01:00.000Z', coaches: [CALLER_SUB] },
        // goal-hidden is intentionally omitted here -- it represents a row
        // whose coaches array does not include the caller and would never
        // be returned by the real FilterExpression.
      ],
      gameNotes: [],
      players: [{ id: 'player-1', firstName: 'Alice', lastName: 'Smith' }],
    });

    await invoke(createEvent());

    const [emailCall] = sesCalls();
    const htmlBody = emailCall[0].input.Message.Body.Html.Data as string;
    expect(htmlBody).toContain('Alice Smith');
    expect(htmlBody).not.toContain('goal-hidden');
  });

  it('sends a happy-path email with correct recipient, subject, goal/note content, and two-section note ordering', async () => {
    installMocks({
      game: defaultGame(),
      team: { id: 'team-1', name: 'Thunder' },
      goals: [
        { id: 'goal-2', gameId: 'game-1', scoredByUs: false, gameSeconds: 300, half: 2, scorerId: null, assistId: null, timestamp: '2026-09-10T18:05:00.000Z', coaches: [CALLER_SUB] },
        { id: 'goal-1', gameId: 'game-1', scoredByUs: true, gameSeconds: 600, half: 1, scorerId: 'player-1', assistId: 'player-2', timestamp: '2026-09-10T18:10:00.000Z', coaches: [CALLER_SUB] },
      ],
      gameNotes: [
        { id: 'note-pre', gameId: 'game-1', noteType: 'coaching-point', playerId: null, gameSeconds: null, half: null, notes: 'Focus on passing', timestamp: '2026-09-10T17:50:00.000Z', coaches: [CALLER_SUB] },
        { id: 'note-in', gameId: 'game-1', noteType: 'gold-star', playerId: 'player-3', gameSeconds: 500, half: 1, notes: 'Great hustle', timestamp: '2026-09-10T18:09:00.000Z', coaches: [CALLER_SUB] },
      ],
      players: [
        { id: 'player-1', firstName: 'Alice', lastName: 'Smith' },
        { id: 'player-2', firstName: 'Bob', lastName: 'Jones' },
        { id: 'player-3', firstName: 'Carla', lastName: 'Diaz' },
      ],
    });

    const result = await invoke(createEvent());

    expect(result).toEqual({ success: true, sentTo: RESOLVED_EMAIL });
    expect(mockSesSend).toHaveBeenCalledTimes(1);

    const [emailCall] = sesCalls();
    const { input } = emailCall[0];
    expect(input.Destination.ToAddresses).toEqual([RESOLVED_EMAIL]);
    expect(input.Message.Subject.Data).toBe('Game Summary: Thunder vs Rival FC');

    const htmlBody = input.Message.Body.Html.Data as string;
    const textBody = input.Message.Body.Text.Data as string;

    // Goal content (scorer + assist name).
    expect(htmlBody).toContain('Alice Smith');
    expect(htmlBody).toContain('Bob Jones');
    expect(textBody).toContain('Alice Smith');

    // Pre-game vs in-game note sections are ordered correctly.
    const preGameIndex = htmlBody.indexOf('Focus on passing');
    const inGameIndex = htmlBody.indexOf('Great hustle');
    expect(preGameIndex).toBeGreaterThan(-1);
    expect(inGameIndex).toBeGreaterThan(-1);
    expect(preGameIndex).toBeLessThan(inGameIndex);
  });

  it('escapes HTML-significant note text in the Html body while leaving the Text body raw (Major 3)', async () => {
    const maliciousNote = '<a href="evil.example">click</a>';
    installMocks({
      game: defaultGame(),
      team: { id: 'team-1', name: 'Thunder' },
      goals: [],
      gameNotes: [
        { id: 'note-pre', gameId: 'game-1', noteType: 'coaching-point', playerId: null, gameSeconds: null, half: null, notes: maliciousNote, timestamp: '2026-09-10T17:50:00.000Z', coaches: [CALLER_SUB] },
      ],
      players: [],
    });

    await invoke(createEvent());

    const [emailCall] = sesCalls();
    const htmlBody = emailCall[0].input.Message.Body.Html.Data as string;
    const textBody = emailCall[0].input.Message.Body.Text.Data as string;

    expect(htmlBody).not.toContain('<a href');
    expect(htmlBody).not.toContain('<script');
    expect(htmlBody).toContain('&lt;a href=&quot;evil.example&quot;&gt;click&lt;/a&gt;');
    expect(textBody).toContain(maliciousNote);
  });

  it('still sends with fallback copy when there are zero goals and zero notes', async () => {
    installMocks({
      game: defaultGame(),
      team: { id: 'team-1', name: 'Thunder' },
      goals: [],
      gameNotes: [],
      players: [],
    });

    await invoke(createEvent());

    const [emailCall] = sesCalls();
    const htmlBody = emailCall[0].input.Message.Body.Html.Data as string;
    expect(htmlBody).toContain('No goals recorded for this game.');
    expect(htmlBody).toContain('No pre-game notes recorded.');
    expect(htmlBody).toContain('No in-game notes recorded.');
  });

  it('throws when no email attribute can be resolved (all fallbacks miss), and never calls SES', async () => {
    installMocks({ game: defaultGame(), cognitoEmail: null });

    await expect(invoke(createEvent())).rejects.toThrow('Unable to resolve your account email address');

    expect(mockCognitoSend).toHaveBeenCalledTimes(1);
    expect(mockSesSend).not.toHaveBeenCalled();
    // Game GetCommand + rate-limit UpdateCommand only -- no Team GetCommand,
    // no Goal/GameNote Query, since email resolution fails before those.
    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
  });

  it('propagates an SES send failure rather than swallowing it', async () => {
    installMocks({
      game: defaultGame(),
      team: { id: 'team-1', name: 'Thunder' },
      goals: [],
      gameNotes: [],
      players: [],
    });
    mockSesSend.mockRejectedValueOnce(new Error('Throttling: rate exceeded'));

    await expect(invoke(createEvent())).rejects.toThrow('Throttling: rate exceeded');
  });
});
