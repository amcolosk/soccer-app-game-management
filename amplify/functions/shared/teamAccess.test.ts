import { describe, expect, it, vi } from 'vitest';
import { assertTeamAccess } from './teamAccess';

function makeDocClient(item: unknown) {
  return {
    send: vi.fn(async () => ({ Item: item })),
  } as unknown as Parameters<typeof assertTeamAccess>[0];
}

describe('assertTeamAccess', () => {
  it('returns team + coaches for a coach on an active team', async () => {
    const docClient = makeDocClient({ id: 'team-1', coaches: ['coach-1', 'coach-2'], status: 'active' });
    const result = await assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1');
    expect(result.team.id).toBe('team-1');
    expect(result.coaches).toEqual(['coach-1', 'coach-2']);
  });

  it('uses a strongly consistent read', async () => {
    const docClient = makeDocClient({ id: 'team-1', coaches: ['coach-1'], status: 'active' });
    await assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1');
    const sendMock = docClient.send as unknown as ReturnType<typeof vi.fn>;
    const call = sendMock.mock.calls[0][0];
    expect(call.input.ConsistentRead).toBe(true);
  });

  it('throws "Team not found" when the team does not exist', async () => {
    const docClient = makeDocClient(undefined);
    await expect(assertTeamAccess(docClient, 'TeamTable', 'missing', 'coach-1')).rejects.toThrow('Team not found');
  });

  it('throws access denied when the caller is not in coaches', async () => {
    const docClient = makeDocClient({ id: 'team-1', coaches: ['someone-else'], status: 'active' });
    await expect(assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1'))
      .rejects.toThrow('Access denied: caller is not a coach on this team');
  });

  it('throws the archived-team message by default when the team is archived', async () => {
    const docClient = makeDocClient({ id: 'team-1', coaches: ['coach-1'], status: 'archived' });
    await expect(assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1'))
      .rejects.toThrow('archived team');
  });

  it('uses a custom archivedMessage when supplied', async () => {
    const docClient = makeDocClient({ id: 'team-1', coaches: ['coach-1'], status: 'archived' });
    await expect(assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1', { archivedMessage: 'Cannot sync a team calendar for an archived team.' }))
      .rejects.toThrow('Cannot sync a team calendar for an archived team.');
  });

  it('allows an archived team when requireActive is false', async () => {
    const docClient = makeDocClient({ id: 'team-1', coaches: ['coach-1'], status: 'archived' });
    const result = await assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1', { requireActive: false });
    expect(result.team.status).toBe('archived');
  });

  it('treats a missing status attribute as active (legacy team)', async () => {
    const docClient = makeDocClient({ id: 'team-1', coaches: ['coach-1'] });
    const result = await assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1');
    expect(result.team.id).toBe('team-1');
  });

  it('treats a missing coaches attribute as an empty array (denies access)', async () => {
    const docClient = makeDocClient({ id: 'team-1', status: 'active' });
    await expect(assertTeamAccess(docClient, 'TeamTable', 'team-1', 'coach-1'))
      .rejects.toThrow('Access denied');
  });
});
