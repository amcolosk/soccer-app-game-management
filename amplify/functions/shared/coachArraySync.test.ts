import { describe, expect, it, vi } from 'vitest';
import {
  isConditionalCheckFailed,
  normalizeEmail,
  getRecordById,
  scanByField,
  queryByIndex,
  withBoundedConcurrency,
  updateRecordCoachesWithRetry,
  type CoachesStrategy,
} from './coachArraySync';

type FakeDocClient = Parameters<typeof scanByField>[0];

function conditionalCheckFailedError(): Error {
  const error = new Error('ConditionalCheckFailedException') as Error & { name: string };
  error.name = 'ConditionalCheckFailedException';
  return error;
}

describe('isConditionalCheckFailed', () => {
  it('returns true for a ConditionalCheckFailedException-named error', () => {
    expect(isConditionalCheckFailed(conditionalCheckFailedError())).toBe(true);
  });

  it('returns false for other errors and non-error values', () => {
    expect(isConditionalCheckFailed(new Error('boom'))).toBe(false);
    expect(isConditionalCheckFailed(null)).toBe(false);
    expect(isConditionalCheckFailed(undefined)).toBe(false);
    expect(isConditionalCheckFailed('nope')).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Coach@Example.COM  ')).toBe('coach@example.com');
  });

  it('returns empty string for null/undefined/empty input', () => {
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail('')).toBe('');
  });
});

describe('getRecordById', () => {
  it('returns the item when found, with no projection by default', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Item: { id: 'a', coaches: ['x'], name: 'Team A' } }));
    const docClient = { send } as unknown as FakeDocClient;

    const result = await getRecordById(docClient, 'Table', 'a');

    expect(result).toEqual({ id: 'a', coaches: ['x'], name: 'Team A' });
    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.ProjectionExpression).toBeUndefined();
    expect(call.input.ExpressionAttributeNames).toBeUndefined();
  });

  it('returns null when not found', async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as FakeDocClient;

    const result = await getRecordById(docClient, 'Table', 'missing', ['id', 'coaches']);
    expect(result).toBeNull();
  });

  it('applies a projection when projectionFields is supplied', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Item: { id: 'a', coaches: ['x'] } }));
    const docClient = { send } as unknown as FakeDocClient;

    await getRecordById(docClient, 'Table', 'a', ['id', 'coaches']);

    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.ProjectionExpression).toBe('id, coaches');
  });

  // Security review regression (issue #162 fix follow-up): a projection
  // with no extraExpressionAttributeNames must NOT send an empty
  // ExpressionAttributeNames map — DynamoDB rejects
  // `ExpressionAttributeNames: {}` with ValidationException:
  // ExpressionAttributeNames must not be empty. This is the common case
  // (e.g. accept-invitation's roster/formation backfill reads), so this
  // must stay `undefined`, not `{}`.
  it('omits ExpressionAttributeNames entirely when a projection is supplied but no extra names are needed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Item: { id: 'a', coaches: ['x'] } }));
    const docClient = { send } as unknown as FakeDocClient;

    await getRecordById(docClient, 'Table', 'a', ['id', 'coaches']);

    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.ProjectionExpression).toBe('id, coaches');
    expect(call.input.ExpressionAttributeNames).toBeUndefined();
    expect('ExpressionAttributeNames' in call.input).toBe(true);
  });

  // F1 (architecture review round 3): direct coverage of a reserved-word
  // projection field, asserting the #status alias and its
  // ExpressionAttributeNames entry are sent to DynamoDB exactly as required
  // to avoid ValidationException: Attribute name is a reserved keyword.
  it('projects a reserved word via the #status alias when extraExpressionAttributeNames is supplied', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Item: { id: 'a', status: 'PENDING' } }));
    const docClient = { send } as unknown as FakeDocClient;

    await getRecordById(
      docClient,
      'TeamInvitationTable',
      'inv-1',
      ['id', '#status'],
      { '#status': 'status' },
    );

    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.ProjectionExpression).toBe('id, #status');
    expect(call.input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
  });
});

describe('scanByField', () => {
  it('paginates using LastEvaluatedKey until exhausted', async () => {
    let call = 0;
    const send = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { Items: [{ id: 'a' }], LastEvaluatedKey: { id: 'a' } };
      }
      return { Items: [{ id: 'b' }] };
    });
    const docClient = { send } as unknown as FakeDocClient;

    const items = await scanByField(docClient, 'Table', 'teamId', 't1', ['id']);
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('builds the #field alias from fieldName and filters on fieldValue', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Items: [] }));
    const docClient = { send } as unknown as FakeDocClient;

    await scanByField(docClient, 'Table', 'teamId', 't1', ['id', 'coaches']);

    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.FilterExpression).toBe('#field = :fieldValue');
    expect(call.input.ExpressionAttributeNames).toEqual({ '#field': 'teamId' });
    expect(call.input.ExpressionAttributeValues).toEqual({ ':fieldValue': 't1' });
    expect(call.input.ProjectionExpression).toBe('id, coaches');
  });

  // F1 (architecture review round 3): reserved-word projection coverage for
  // scanByField's own extraExpressionAttributeNames parameter (used by
  // revoke-coach-access's TeamInvitation scan, which projects #status).
  it('merges extraExpressionAttributeNames with the internal #field alias, #field always winning on collision', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Items: [] }));
    const docClient = { send } as unknown as FakeDocClient;

    await scanByField(
      docClient,
      'TeamInvitationTable',
      'teamId',
      'team-1',
      ['id', 'coaches', '#status', 'acceptedBy', 'email'],
      { '#status': 'status' },
    );

    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.ProjectionExpression).toBe('id, coaches, #status, acceptedBy, email');
    expect(call.input.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#field': 'teamId',
    });
  });
});

describe('queryByIndex', () => {
  it('queries the given GSI with a KeyConditionExpression on the #field alias', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Items: [{ id: 'roster-1', coaches: ['a'] }] }));
    const docClient = { send } as unknown as FakeDocClient;

    const items = await queryByIndex(docClient, 'TeamRosterTable', 'gsi-Team.roster', 'teamId', 'team-1', ['id', 'coaches']);

    expect(items).toEqual([{ id: 'roster-1', coaches: ['a'] }]);
    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.IndexName).toBe('gsi-Team.roster');
    expect(call.input.KeyConditionExpression).toBe('#field = :fieldValue');
    expect(call.input.ExpressionAttributeNames).toEqual({ '#field': 'teamId' });
    expect(call.input.ExpressionAttributeValues).toEqual({ ':fieldValue': 'team-1' });
    expect(call.input.ProjectionExpression).toBe('id, coaches');
  });

  it('paginates using LastEvaluatedKey until exhausted', async () => {
    let call = 0;
    const send = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { Items: [{ id: 'a' }], LastEvaluatedKey: { id: 'a' } };
      }
      return { Items: [{ id: 'b' }] };
    });
    const docClient = { send } as unknown as FakeDocClient;

    const items = await queryByIndex(docClient, 'GameTable', 'gsi-Team.games', 'teamId', 'team-1', ['id']);
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('merges extraExpressionAttributeNames with the internal #field alias for a reserved-word projection', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Items: [] }));
    const docClient = { send } as unknown as FakeDocClient;

    await queryByIndex(
      docClient,
      'TeamInvitationTable',
      'gsi-Team.invitations',
      'teamId',
      'team-1',
      ['id', 'coaches', '#status', 'acceptedBy', 'email'],
      { '#status': 'status' },
    );

    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.ProjectionExpression).toBe('id, coaches, #status, acceptedBy, email');
    expect(call.input.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#field': 'teamId',
    });
  });
});

describe('withBoundedConcurrency', () => {
  it('processes all items and preserves result order', async () => {
    const results = await withBoundedConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('never runs more than `concurrency` items at once', async () => {
    let active = 0;
    let maxActive = 0;

    await withBoundedConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return n;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe('updateRecordCoachesWithRetry', () => {
  const removeStrategy = (targetId: string): CoachesStrategy => (current) => {
    if (!current?.includes(targetId)) {
      return { action: 'skip' };
    }
    return { action: 'write', next: current.filter((id) => id !== targetId) };
  };

  it('writes on the first attempt when there is no conflict', async () => {
    const send = vi.fn(async () => ({ Attributes: { id: 'roster-1', coaches: ['a'] } }));
    const docClient = { send } as unknown as FakeDocClient;

    const result = await updateRecordCoachesWithRetry(
      docClient,
      'TeamRosterTable',
      { id: 'roster-1', coaches: ['a', 'b'] },
      removeStrategy('b'),
      '2026-01-01T00:00:00.000Z',
      ['id', 'coaches'],
    );

    expect(result).toEqual({ action: 'write', record: { id: 'roster-1', coaches: ['a'] } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns skip without writing when the strategy skips', async () => {
    const send = vi.fn();
    const docClient = { send } as unknown as FakeDocClient;

    const result = await updateRecordCoachesWithRetry(
      docClient,
      'TeamRosterTable',
      { id: 'roster-1', coaches: ['a'] },
      removeStrategy('missing-target'),
      '2026-01-01T00:00:00.000Z',
      ['id', 'coaches'],
    );

    expect(result).toEqual({ action: 'skip', record: { id: 'roster-1', coaches: ['a'] } });
    expect(send).not.toHaveBeenCalled();
  });

  it('re-reads and retries on ConditionalCheckFailedException, then succeeds', async () => {
    let attempt = 0;
    const send = vi.fn(async (command: { __proto__: { constructor: { name: string } } }) => {
      const type = command.constructor.name;
      if (type === 'UpdateCommand') {
        attempt += 1;
        if (attempt === 1) {
          throw conditionalCheckFailedError();
        }
        return { Attributes: { id: 'roster-1', coaches: ['a'] } };
      }
      // GetCommand retry re-read
      return { Item: { id: 'roster-1', coaches: ['a', 'b'] } };
    });
    const docClient = { send } as unknown as FakeDocClient;

    const result = await updateRecordCoachesWithRetry(
      docClient,
      'TeamRosterTable',
      { id: 'roster-1', coaches: ['a', 'b'] },
      removeStrategy('b'),
      '2026-01-01T00:00:00.000Z',
      ['id', 'coaches'],
    );

    expect(result).toEqual({ action: 'write', record: { id: 'roster-1', coaches: ['a'] } });
    expect(attempt).toBe(2);
  });

  // The specific case that motivated Critical 2: a strategy that would
  // 'write' on attempt 1 but 'abort's on attempt 2 once the retry re-read
  // reflects a changed record (e.g. the caller was concurrently revoked).
  it('re-evaluates the strategy fresh on every retry attempt, allowing a later abort', async () => {
    const send = vi.fn(async (command: { __proto__: { constructor: { name: string } } }) => {
      const type = command.constructor.name;
      if (type === 'UpdateCommand') {
        throw conditionalCheckFailedError();
      }
      // Retry re-read shows the caller ('caller-1') has been concurrently
      // removed from coaches.
      return { Item: { id: 'team-1', coaches: ['someone-else'], name: 'Team' } };
    });
    const docClient = { send } as unknown as FakeDocClient;

    const strategy: CoachesStrategy = (current) => {
      if (!current?.includes('caller-1')) {
        return { action: 'abort', reason: 'Access denied: caller is not a coach on this team' };
      }
      return { action: 'write', next: current.filter((id) => id !== 'target-1') };
    };

    await expect(
      updateRecordCoachesWithRetry(
        docClient,
        'TeamTable',
        { id: 'team-1', coaches: ['caller-1', 'target-1'], name: 'Team' },
        strategy,
        '2026-01-01T00:00:00.000Z',
      )
    ).rejects.toThrow('Access denied: caller is not a coach on this team');
  });

  it('throws an abort reason immediately without ever writing', async () => {
    const send = vi.fn();
    const docClient = { send } as unknown as FakeDocClient;

    const strategy: CoachesStrategy = () => ({ action: 'abort', reason: 'Cannot revoke the team\'s last coach. Invite another coach first.' });

    await expect(
      updateRecordCoachesWithRetry(
        docClient,
        'TeamTable',
        { id: 'team-1', coaches: ['only-coach'], name: 'Team' },
        strategy,
        '2026-01-01T00:00:00.000Z',
      )
    ).rejects.toThrow("Cannot revoke the team's last coach. Invite another coach first.");
    expect(send).not.toHaveBeenCalled();
  });

  it('throws after exhausting all retry attempts on persistent conflicts', async () => {
    const send = vi.fn(async (command: { __proto__: { constructor: { name: string } } }) => {
      const type = command.constructor.name;
      if (type === 'UpdateCommand') {
        throw conditionalCheckFailedError();
      }
      return { Item: { id: 'roster-1', coaches: ['a', 'b'] } };
    });
    const docClient = { send } as unknown as FakeDocClient;

    await expect(
      updateRecordCoachesWithRetry(
        docClient,
        'TeamRosterTable',
        { id: 'roster-1', coaches: ['a', 'b'] },
        removeStrategy('b'),
        '2026-01-01T00:00:00.000Z',
        ['id', 'coaches'],
      )
    ).rejects.toThrow('Failed to update coaches for record roster-1 in TeamRosterTable after concurrent update retries');
  });

  // F2 (architecture review round 3): retryReadProjection coverage.
  it('re-reads with the given projection when retryReadProjection is supplied', async () => {
    const send = vi.fn(async (command: { __proto__: { constructor: { name: string } }; input: Record<string, unknown> }) => {
      const type = command.constructor.name;
      if (type === 'UpdateCommand') {
        throw conditionalCheckFailedError();
      }
      expect(command.input.ProjectionExpression).toBe('id, coaches');
      return { Item: { id: 'roster-1', coaches: ['a'] } };
    });
    const docClient = { send } as unknown as FakeDocClient;

    await updateRecordCoachesWithRetry(
      docClient,
      'TeamRosterTable',
      { id: 'roster-1', coaches: ['a', 'b'] },
      removeStrategy('b'),
      '2026-01-01T00:00:00.000Z',
      ['id', 'coaches'],
    );
  });

  it('re-reads the full, unprojected record when retryReadProjection is omitted', async () => {
    const send = vi.fn(async (command: { __proto__: { constructor: { name: string } }; input: Record<string, unknown> }) => {
      const type = command.constructor.name;
      if (type === 'UpdateCommand') {
        throw conditionalCheckFailedError();
      }
      expect(command.input.ProjectionExpression).toBeUndefined();
      return { Item: { id: 'team-1', coaches: ['a'], name: 'Team A' } };
    });
    const docClient = { send } as unknown as FakeDocClient;

    const result = await updateRecordCoachesWithRetry(
      docClient,
      'TeamTable',
      { id: 'team-1', coaches: ['a', 'b'], name: 'Team A' },
      removeStrategy('b'),
      '2026-01-01T00:00:00.000Z',
    );

    // 'skip' because the re-read shows 'b' is already absent — the
    // returned record must be the FULL re-read result (has `name`), not an
    // ['id','coaches']-limited stub.
    expect(result).toEqual({ action: 'skip', record: { id: 'team-1', coaches: ['a'], name: 'Team A' } });
  });

  // F2: newly-specified no-record-found case.
  it('throws a specific error when the retry re-read finds no record at all', async () => {
    const send = vi.fn(async (command: { __proto__: { constructor: { name: string } } }) => {
      const type = command.constructor.name;
      if (type === 'UpdateCommand') {
        throw conditionalCheckFailedError();
      }
      return {};
    });
    const docClient = { send } as unknown as FakeDocClient;

    await expect(
      updateRecordCoachesWithRetry(
        docClient,
        'TeamRosterTable',
        { id: 'roster-1', coaches: ['a', 'b'] },
        removeStrategy('b'),
        '2026-01-01T00:00:00.000Z',
        ['id', 'coaches'],
      )
    ).rejects.toThrow('Failed to re-read record during concurrent update retry — record no longer exists');
  });

  it('handles the attribute_not_exists(coaches) branch for a record with no coaches yet', async () => {
    const send = vi.fn(async (command: { __proto__: { constructor: { name: string } }; input: Record<string, unknown> }) => {
      expect(command.input.ConditionExpression).toBe('attribute_not_exists(coaches)');
      return { Attributes: { id: 'roster-1', coaches: ['a'] } };
    });
    const docClient = { send } as unknown as FakeDocClient;

    const strategy: CoachesStrategy = () => ({ action: 'write', next: ['a'] });

    const result = await updateRecordCoachesWithRetry(
      docClient,
      'TeamRosterTable',
      { id: 'roster-1' },
      strategy,
      '2026-01-01T00:00:00.000Z',
      ['id', 'coaches'],
    );

    expect(result).toEqual({ action: 'write', record: { id: 'roster-1', coaches: ['a'] } });
  });
});
