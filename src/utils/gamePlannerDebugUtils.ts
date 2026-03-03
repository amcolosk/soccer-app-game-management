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
      const pref = p.preferredPositionNames?.length ? ` [pref: ${p.preferredPositionNames.join(', ')}]` : '';
      return `  #${p.number} — ${p.status}${window ? ` (${window})` : ''}${pref}`;
    }),
  ];

  if (ctx.rotations !== undefined) {
    lines.push('', 'Rotation plan:');
    if (ctx.rotations.length === 0) {
      lines.push('  (no rotations planned)');
    } else {
      for (const rot of ctx.rotations) {
        const subsStr = rot.substitutions.length === 0
          ? 'no subs'
          : rot.substitutions.map(s => `out #${s.playerOutNumber}→in #${s.playerInNumber} @${s.positionName}`).join(', ');
        lines.push(`  R${rot.rotationNumber} (min ${rot.gameMinute}, H${rot.half}): ${subsStr}`);
      }
    }
  }

  lines.push('-----------------------------------');
  return lines.join('\n');
}
