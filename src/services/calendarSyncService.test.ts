import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const mockSyncTeamCalendarMutation = vi.hoisted(() => vi.fn());
const mockUnlinkTeamCalendarMutation = vi.hoisted(() => vi.fn());

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    mutations: {
      syncTeamCalendar: mockSyncTeamCalendarMutation,
      unlinkTeamCalendar: mockUnlinkTeamCalendarMutation,
    },
  }),
}));

import { syncTeamCalendar, unlinkTeamCalendar } from './calendarSyncService';

describe('calendarSyncService', () => {
  it('syncTeamCalendar calls the mutation with the given input and unwraps the result', async () => {
    mockSyncTeamCalendarMutation.mockResolvedValue({ data: { createdGames: [], updatedGames: [] }, errors: [] });
    const result = await syncTeamCalendar({ teamId: 'team-1', icsContent: 'BEGIN:VCALENDAR\nEND:VCALENDAR\n', dryRun: true });
    expect(mockSyncTeamCalendarMutation).toHaveBeenCalledWith({ teamId: 'team-1', icsContent: 'BEGIN:VCALENDAR\nEND:VCALENDAR\n', dryRun: true });
    expect(result).toEqual({ createdGames: [], updatedGames: [] });
  });

  it('syncTeamCalendar throws when the mutation returns errors', async () => {
    mockSyncTeamCalendarMutation.mockResolvedValue({ data: null, errors: [{ message: 'boom' }] });
    await expect(syncTeamCalendar({ teamId: 'team-1' })).rejects.toThrow('boom');
  });

  it('unlinkTeamCalendar calls the mutation with teamId and returns the boolean result', async () => {
    mockUnlinkTeamCalendarMutation.mockResolvedValue({ data: true, errors: [] });
    const result = await unlinkTeamCalendar('team-1');
    expect(mockUnlinkTeamCalendarMutation).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(result).toBe(true);
  });

  it('unlinkTeamCalendar throws when the mutation returns errors', async () => {
    mockUnlinkTeamCalendarMutation.mockResolvedValue({ data: null, errors: [{ message: 'nope' }] });
    await expect(unlinkTeamCalendar('team-1')).rejects.toThrow('nope');
  });
});

// round-2 architecture review Major A / test plan bullet ("CalendarFeed
// authorization tests"): CalendarFeed is Lambda-only (`allow.authenticated()
// .to([])`, no client grants at all). There is no direct
// `client.models.CalendarFeed` call anywhere in the frontend — the feed URL
// is only ever created/replaced/read via syncTeamCalendar/unlinkTeamCalendar.
// A generated Amplify client always has a `client.models.CalendarFeed`
// *property* in its TS type regardless of grants (grants are enforced by
// AppSync at runtime, not by codegen), so the real assertion this repo can
// make statically is "no source file calls it" — this scans every .ts/.tsx
// file under src/ for that string.
describe('CalendarFeed — no direct client access anywhere in the frontend (round-2 Major A)', () => {
  it('no file under src/ references client.models.CalendarFeed', () => {
    const srcDir = join(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is walked from a fixed, test-internal root (src/), not user input
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (/\.(ts|tsx)$/.test(entry) && fullPath !== __filename) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
          const content = readFileSync(fullPath, 'utf8');
          // Real usage looks like `client.models.CalendarFeed.<method>(...)`.
          // Doc comments describing the pattern (e.g. this file's own header,
          // calendarSyncService.ts's) legitimately mention the string without
          // calling it — only flag an actual property-access + call shape.
          if (/models\.CalendarFeed\s*\.\s*\w+\s*\(/.test(content)) {
            offenders.push(fullPath);
          }
        }
      }
    };

    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
