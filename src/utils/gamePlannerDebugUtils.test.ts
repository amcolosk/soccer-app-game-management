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
});
