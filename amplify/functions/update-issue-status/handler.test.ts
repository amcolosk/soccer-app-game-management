import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateStatus } from './handler';

// ---------------------------------------------------------------------------
// validateStatus (original tests preserved)
// ---------------------------------------------------------------------------

describe('validateStatus', () => {
  it('accepts valid statuses', () => {
    expect(validateStatus('OPEN')).toBe(true);
    expect(validateStatus('IN_PROGRESS')).toBe(true);
    expect(validateStatus('FIXED')).toBe(true);
    expect(validateStatus('DEPLOYED')).toBe(true);
    expect(validateStatus('CLOSED')).toBe(true);
  });

  it('rejects invalid statuses', () => {
    expect(validateStatus('INVALID')).toBe(false);
    expect(validateStatus('open')).toBe(false);
    expect(validateStatus('')).toBe(false);
    expect(validateStatus('PENDING')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DynamoDB mocking
// ---------------------------------------------------------------------------

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function() {}),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  QueryCommand: vi.fn(function(input) { this.input = input; this._type = 'QueryCommand'; }),
  UpdateCommand: vi.fn(function(input) { this.input = input; this._type = 'UpdateCommand'; }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cognitoEvent(opts: { issueNumber?: number; status?: string; resolution?: string | null; email?: string } = {}) {
  const { issueNumber = 1, status = 'IN_PROGRESS', resolution = undefined, email = 'dev@example.com' } = opts;
  return { arguments: { issueNumber, status, resolution }, identity: { sub: 'user-sub-123', claims: { email } } } as any;
}

function apiKeyEvent(opts: { issueNumber?: number; status?: string; resolution?: string | null } = {}) {
  const { issueNumber = 1, status = 'IN_PROGRESS', resolution = undefined } = opts;
  return { arguments: { issueNumber, status, resolution }, identity: undefined } as any;
}

function setEnvVars(vars: Record<string, string | undefined>) {
  const originals: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    originals[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

// ---------------------------------------------------------------------------
// handler – DEVELOPER_EMAILS enforcement
// ---------------------------------------------------------------------------

describe('handler – DEVELOPER_EMAILS enforcement', () => {
  beforeEach(() => { vi.resetModules(); mockSend.mockReset(); });
  afterEach(() => { delete process.env.DEVELOPER_EMAILS; delete process.env.ISSUE_TABLE_NAME; delete process.env.AGENT_API_SECRET; });

  it('allows an authenticated user whose email is in DEVELOPER_EMAILS', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'issue-id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    const result = await handler(cognitoEvent({ email: 'dev@example.com', status: 'IN_PROGRESS' }), {} as any, vi.fn());
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result as string).status).toBe('IN_PROGRESS');
  });

  it('throws "Unauthorized: developer access required" for authenticated user NOT in DEVELOPER_EMAILS', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    const { handler } = await import('./handler');
    await expect(
      handler(cognitoEvent({ email: 'coach@example.com', status: 'IN_PROGRESS' }), {} as any, vi.fn()),
    ).rejects.toThrow('Unauthorized: developer access required');
  });

  it('performs the email check case-insensitively', async () => {
    process.env.DEVELOPER_EMAILS = 'DEV@EXAMPLE.COM';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'issue-id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    const result = await handler(cognitoEvent({ email: 'dev@example.com', status: 'FIXED' }), {} as any, vi.fn());
    expect(JSON.parse(result as string).status).toBe('FIXED');
  });

  it('throws "Unauthorized: developer access is not configured" when DEVELOPER_EMAILS is absent (fail-closed)', async () => {
    delete process.env.DEVELOPER_EMAILS;
    process.env.ISSUE_TABLE_NAME = 'Issues';
    const { handler } = await import('./handler');
    await expect(
      handler(cognitoEvent({ email: 'anyone@example.com', status: 'OPEN' }), {} as any, vi.fn()),
    ).rejects.toThrow('Unauthorized: developer access is not configured');
  });
});

// ---------------------------------------------------------------------------
// handler – API key / agent caller
// ---------------------------------------------------------------------------

describe('handler – API key / agent caller', () => {
  beforeEach(() => { vi.resetModules(); mockSend.mockReset(); });
  afterEach(() => { delete process.env.AGENT_API_SECRET; delete process.env.DEVELOPER_EMAILS; delete process.env.ISSUE_TABLE_NAME; });

  it('allows API key caller with the correct AGENT_API_SECRET regardless of DEVELOPER_EMAILS', async () => {
    process.env.AGENT_API_SECRET = 'super-secret-token';
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'issue-id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    const result = await handler(
      apiKeyEvent({ status: 'FIXED', resolution: 'SECRET:super-secret-token|Fixed the crash' }),
      {} as any, vi.fn(),
    );
    expect(JSON.parse(result as string).status).toBe('FIXED');
  });

  it('strips the SECRET prefix from resolution before writing to DynamoDB', async () => {
    process.env.AGENT_API_SECRET = 'tok';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'issue-id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    await handler(apiKeyEvent({ status: 'CLOSED', resolution: 'SECRET:tok|Actual resolution text' }), {} as any, vi.fn());
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.input.ExpressionAttributeValues[':resolution']).toBe('Actual resolution text');
  });

  it('sets resolution to null when SECRET token has no pipe-delimited payload', async () => {
    process.env.AGENT_API_SECRET = 'tok';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'issue-id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    await handler(apiKeyEvent({ status: 'IN_PROGRESS', resolution: 'SECRET:tok' }), {} as any, vi.fn());
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.input.ExpressionAttributeValues[':resolution']).toBeUndefined();
  });

  it('throws "Unauthorized: agent access is not configured" when AGENT_API_SECRET is absent', async () => {
    delete process.env.AGENT_API_SECRET;
    process.env.ISSUE_TABLE_NAME = 'Issues';
    const { handler } = await import('./handler');
    await expect(handler(apiKeyEvent({ status: 'OPEN' }), {} as any, vi.fn()))
      .rejects.toThrow('Unauthorized: agent access is not configured');
  });

  it('throws "Unauthorized: invalid agent credentials" when resolution has wrong secret', async () => {
    process.env.AGENT_API_SECRET = 'correct-token';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    const { handler } = await import('./handler');
    await expect(handler(apiKeyEvent({ status: 'OPEN', resolution: 'SECRET:wrong-token' }), {} as any, vi.fn()))
      .rejects.toThrow('Unauthorized: invalid agent credentials');
  });

  it('throws when resolution is absent (no secret provided)', async () => {
    process.env.AGENT_API_SECRET = 'correct-token';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    const { handler } = await import('./handler');
    await expect(handler(apiKeyEvent({ status: 'OPEN', resolution: undefined }), {} as any, vi.fn()))
      .rejects.toThrow('Unauthorized: invalid agent credentials');
  });
});

// ---------------------------------------------------------------------------
// handler – DynamoDB interactions
// ---------------------------------------------------------------------------

describe('handler – DynamoDB interactions', () => {
  beforeEach(() => { vi.resetModules(); mockSend.mockReset(); });
  afterEach(() => { delete process.env.DEVELOPER_EMAILS; delete process.env.ISSUE_TABLE_NAME; delete process.env.AGENT_API_SECRET; });

  it('throws when the queried issue is not found', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend.mockResolvedValueOnce({ Items: [] });
    const { handler } = await import('./handler');
    await expect(handler(cognitoEvent({ issueNumber: 999, status: 'OPEN' }), {} as any, vi.fn()))
      .rejects.toThrow('Issue #999 not found');
  });

  it('throws before DynamoDB query when status is invalid', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    const { handler } = await import('./handler');
    await expect(handler(cognitoEvent({ status: 'NOPE' }), {} as any, vi.fn()))
      .rejects.toThrow('Invalid status: NOPE');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sets closedAt when status is CLOSED', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    await handler(cognitoEvent({ status: 'CLOSED', resolution: 'done' }), {} as any, vi.fn());
    const exprValues = mockSend.mock.calls[1][0].input.ExpressionAttributeValues;
    expect(exprValues[':closedAt']).toBeDefined();
  });

  it('does NOT set closedAt when status is FIXED', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    await handler(cognitoEvent({ status: 'FIXED' }), {} as any, vi.fn());
    const exprValues = mockSend.mock.calls[1][0].input.ExpressionAttributeValues;
    expect(exprValues[':closedAt']).toBeUndefined();
  });

  it('does NOT set closedAt when status is DEPLOYED', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    await handler(cognitoEvent({ status: 'DEPLOYED' }), {} as any, vi.fn());
    const exprValues = mockSend.mock.calls[1][0].input.ExpressionAttributeValues;
    expect(exprValues[':closedAt']).toBeUndefined();
  });

  it('does not set closedAt when status is OPEN', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    await handler(cognitoEvent({ status: 'OPEN' }), {} as any, vi.fn());
    const exprValues = mockSend.mock.calls[1][0].input.ExpressionAttributeValues;
    expect(exprValues[':closedAt']).toBeUndefined();
  });

  it('does not set closedAt when status is IN_PROGRESS', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'id-1', issueNumber: 1 }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    await handler(cognitoEvent({ status: 'IN_PROGRESS' }), {} as any, vi.fn());
    const exprValues = mockSend.mock.calls[1][0].input.ExpressionAttributeValues;
    expect(exprValues[':closedAt']).toBeUndefined();
  });

  it('returns JSON with issueNumber, status, and resolution', async () => {
    process.env.DEVELOPER_EMAILS = 'dev@example.com';
    process.env.ISSUE_TABLE_NAME = 'Issues';
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 'id-1', issueNumber: 1, resolution: null }] })
      .mockResolvedValueOnce({});
    const { handler } = await import('./handler');
    const result = await handler(cognitoEvent({ issueNumber: 1, status: 'OPEN' }), {} as any, vi.fn());
    const parsed = JSON.parse(result as string);
    expect(parsed).toHaveProperty('issueNumber', 1);
    expect(parsed).toHaveProperty('status', 'OPEN');
    expect(parsed).toHaveProperty('resolution');
  });
});
