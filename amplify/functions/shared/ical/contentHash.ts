import { createHash } from 'crypto';

export interface ContentHashInput {
  opponent: string;
  isHome: boolean;
  gameDate: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  arriveByTime?: string | null;
}

/**
 * sha256 over the import-owned fields, used to detect a real change in a
 * feed event between syncs. `externalSequence` is NOT the change-detection
 * signal — SEQUENCE is optional in RFC 5545 and many producers never
 * increment it (architecture review Major 7b) — this hash is.
 */
export function computeContentHash(input: ContentHashInput): string {
  const canonical = JSON.stringify({
    opponent: input.opponent,
    isHome: input.isHome,
    gameDate: input.gameDate ?? null,
    locationName: input.locationName ?? null,
    locationAddress: input.locationAddress ?? null,
    arriveByTime: input.arriveByTime ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Deterministic `Game.id` for a purely-new externally-sourced game
 * (architecture review Major 4), so two concurrent sync invocations converge
 * on the same id instead of creating duplicates.
 *
 * Exact derivation, pinned (round-2 Minor 2 — this is a persisted wire
 * contract; changing this recipe orphans every previously-imported game and
 * re-creates it as a duplicate): sha256 hex digest of
 * `teamId + '|' + externalSource + '|' + externalUid`, first 32 hex
 * characters, formatted as `8-4-4-4-12` with the version nibble forced to
 * `4` and the variant nibble forced into `8`-`b` (standard UUIDv4 shaping,
 * applied to hash output rather than random bytes).
 *
 * See `contentHash.test.ts` for the golden test pinning the exact output for
 * a fixed input triple.
 */
export function deriveDeterministicGameId(teamId: string, externalSource: string, externalUid: string): string {
  const hex = createHash('sha256').update(`${teamId}|${externalSource}|${externalUid}`).digest('hex');
  const chars = hex.slice(0, 32).split('');

  // Version nibble: first character of the third group (index 12 in the
  // flat 32-char string) forced to '4'.
  chars[12] = '4';

  // Variant nibble: first character of the fourth group (index 16) forced
  // into the 8-b range by fixing the top two bits to '10'.
  const variantNibble = parseInt(chars[16], 16);
  const forcedVariant = (variantNibble & 0x3) | 0x8;
  chars[16] = forcedVariant.toString(16);

  const joined = chars.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
}
