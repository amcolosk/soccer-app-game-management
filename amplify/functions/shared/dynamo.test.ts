import { describe, expect, it, vi } from 'vitest';
import { scanAll } from './dynamo';

describe('scanAll', () => {
  it('returns all items from a single page', async () => {
    const send = vi.fn(async () => ({ Items: [{ id: 'a' }, { id: 'b' }] }));
    const docClient = { send } as unknown as Parameters<typeof scanAll>[0];
    const items = await scanAll(docClient, 'Table', 'gameId = :gameId', { ':gameId': 'g1' });
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('paginates using LastEvaluatedKey until exhausted', async () => {
    let call = 0;
    const send = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { Items: [{ id: 'a' }], LastEvaluatedKey: { id: 'a' } };
      }
      if (call === 2) {
        return { Items: [{ id: 'b' }], LastEvaluatedKey: { id: 'b' } };
      }
      return { Items: [{ id: 'c' }] };
    });
    const docClient = { send } as unknown as Parameters<typeof scanAll>[0];
    const items = await scanAll(docClient, 'Table', 'teamId = :teamId', { ':teamId': 't1' });
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array when there are no items', async () => {
    const send = vi.fn(async () => ({}));
    const docClient = { send } as unknown as Parameters<typeof scanAll>[0];
    const items = await scanAll(docClient, 'Table', 'teamId = :teamId', { ':teamId': 't1' });
    expect(items).toEqual([]);
  });

  it('passes expressionAttributeNames through when supplied', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so send.mock.calls[0][0] below isn't `never`
    const send = vi.fn(async (_command: unknown) => ({ Items: [] }));
    const docClient = { send } as unknown as Parameters<typeof scanAll>[0];
    await scanAll(docClient, 'Table', '#status = :s', { ':s': 'scheduled' }, { '#status': 'status' });
    const call = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(call.input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
  });
});
