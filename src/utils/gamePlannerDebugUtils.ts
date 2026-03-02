import type { GamePlannerDebugContext } from '../types/debug';

/**
 * Formats a Game Planner debug context into a human-readable snapshot string
 * suitable for inclusion in bug reports.
 */
export function buildDebugSnapshot(ctx: GamePlannerDebugContext): string {
  const lines = [
    '--- Game Planner Debug Snapshot ---',
    `Rotation interval: ${ctx.rotationIntervalMinutes} min`,
    `Half length: ${ctx.halfLengthMinutes} min`,
    `Max players on field: ${ctx.maxPlayersOnField}`,
    `Available players: ${ctx.availablePlayerCount}`,
    '',
    'Player availability:',
    ...ctx.players.map(p => {
      const from = p.availableFromMinute != null ? `availFrom=${p.availableFromMinute}` : '';
      const until = p.availableUntilMinute != null ? `availUntil=${p.availableUntilMinute}` : '';
      const window = [from, until].filter(Boolean).join(', ');
      return `  #${p.number} — ${p.status}${window ? ` (${window})` : ''}`;
    }),
    '-----------------------------------',
  ];
  return lines.join('\n');
}
