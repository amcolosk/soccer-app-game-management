import { describe, it, expect } from 'vitest';
import { buildDebugSnapshot } from './gamePlannerDebugUtils';
import type { GamePlannerDebugContext } from '../types/debug';

describe('buildDebugSnapshot', () => {
  const baseCtx: GamePlannerDebugContext = {
    rotationIntervalMinutes: 10,
    halfLengthMinutes: 30,
    maxPlayersOnField: 7,
    availablePlayerCount: 9,
    players: [],
  };

  it('includes header and footer delimiters', () => {
    const result = buildDebugSnapshot(baseCtx);
    expect(result).toContain('--- Game Planner Debug Snapshot ---');
    expect(result).toContain('-----------------------------------');
  });

  it('includes rotation interval, half length, max players, and available count', () => {
    const result = buildDebugSnapshot(baseCtx);
    expect(result).toContain('Rotation interval: 10 min');
    expect(result).toContain('Half length: 30 min');
    expect(result).toContain('Max players on field: 7');
    expect(result).toContain('Available players: 9');
  });

  it('renders a player with no availability windows', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      players: [{ number: 7, status: 'available', availableFromMinute: null, availableUntilMinute: null }],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('#7 — available');
    expect(result).not.toContain('availFrom');
    expect(result).not.toContain('availUntil');
  });

  it('renders a player with both availability windows', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      players: [{ number: 12, status: 'late-arrival', availableFromMinute: 15, availableUntilMinute: 50 }],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('#12 — late-arrival (availFrom=15, availUntil=50)');
  });

  it('renders a player with only availableFromMinute', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      players: [{ number: 5, status: 'late-arrival', availableFromMinute: 10, availableUntilMinute: null }],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('#5 — late-arrival (availFrom=10)');
    expect(result).not.toContain('availUntil');
  });

  it('renders a player with only availableUntilMinute', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      players: [{ number: 9, status: 'available', availableFromMinute: null, availableUntilMinute: 45 }],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('#9 — available (availUntil=45)');
    expect(result).not.toContain('availFrom');
  });

  it('renders multiple players in order', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      players: [
        { number: 1, status: 'available', availableFromMinute: null, availableUntilMinute: null },
        { number: 2, status: 'absent', availableFromMinute: null, availableUntilMinute: null },
      ],
    };
    const result = buildDebugSnapshot(ctx);
    const idx1 = result.indexOf('#1 — available');
    const idx2 = result.indexOf('#2 — absent');
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(-1);
    expect(idx1).toBeLessThan(idx2);
  });

  it('handles empty players array', () => {
    const result = buildDebugSnapshot(baseCtx);
    expect(result).toContain('Player availability:');
  });

  it('renders preferred position names when present', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      players: [{ number: 7, status: 'available', availableFromMinute: null, availableUntilMinute: null, preferredPositionNames: ['GK', 'CB'] }],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('#7 — available [pref: GK, CB]');
  });

  it('omits pref suffix when preferredPositionNames is empty', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      players: [{ number: 3, status: 'available', availableFromMinute: null, availableUntilMinute: null, preferredPositionNames: [] }],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('#3 — available');
    expect(result).not.toContain('pref:');
  });

  it('omits rotation plan section when rotations field is absent', () => {
    const result = buildDebugSnapshot(baseCtx);
    expect(result).not.toContain('Rotation plan:');
  });

  it('renders rotation plan header with no-rotations message when array is empty', () => {
    const ctx: GamePlannerDebugContext = { ...baseCtx, rotations: [] };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('Rotation plan:');
    expect(result).toContain('(no rotations planned)');
  });

  it('renders rotation entries with player numbers, half, and position name', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      rotations: [
        {
          rotationNumber: 1,
          gameMinute: 10,
          half: 1,
          substitutions: [
            { playerOutNumber: 3, playerInNumber: 7, positionName: 'CB' },
          ],
        },
      ],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('R1 (min 10, H1): out #3→in #7 @CB');
  });

  it('renders "no subs" for a rotation with an empty substitutions array', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      rotations: [
        { rotationNumber: 2, gameMinute: 20, half: 1, substitutions: [] },
      ],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('R2 (min 20, H1): no subs');
  });

  it('renders multiple rotations across both halves', () => {
    const ctx: GamePlannerDebugContext = {
      ...baseCtx,
      rotations: [
        { rotationNumber: 1, gameMinute: 10, half: 1, substitutions: [{ playerOutNumber: 1, playerInNumber: 2, positionName: 'LW' }] },
        { rotationNumber: 2, gameMinute: 30, half: 2, substitutions: [{ playerOutNumber: 3, playerInNumber: 4, positionName: 'GK' }] },
      ],
    };
    const result = buildDebugSnapshot(ctx);
    expect(result).toContain('R1 (min 10, H1): out #1→in #2 @LW');
    expect(result).toContain('R2 (min 30, H2): out #3→in #4 @GK');
    expect(result.indexOf('R1')).toBeLessThan(result.indexOf('R2'));
  });
});
