# Issue #203: Add Saves by Goalie to Reports

Status: **FINAL** — incorporates 2 rounds of architecture review, 1 round of UI review, and the repo owner's approved live-mockup UI decision (2026-09-27). No open decisions remain; every fork identified across review rounds has been resolved below. Ready for `coding-agent`.

Repo: `amcolosk/soccer-app-game-management`, issue #203, "Add saves by goalie to reports."

Risk tier: **Tier 1** (my judgment call — no `classify:risk-tier` output was handed to me for this pass, so per my scope I'm deciding only between Tier 0/Tier 1, not asserting a Tier 2). Reasoning: this touches 3+ files including two CLAUDE.md-flagged sensitive-derivation utilities (`playTimeCalculations.ts`, `gameCalculations.ts` — "Play time is derived from granular enter/exit records") and adds nontrivial new UI structure (a new tablist component, a new drill-down card, reordered sections) to `SeasonReport.tsx`. It is **not** Tier 2: no `amplify/data/resource.ts` schema change, no new Lambda, no new mutation, no new IAM/auth surface — this is a pure read/report feature layered on data (`Save`, `Shot`, `PlayTimeRecord`, `FormationPosition.role`) and derivations (`getCurrentGoalkeeperId`'s sibling concept) that already exist and are already exercised by the shipped Save Auto-Goalkeeper Attribution feature (`docs/plans/SAVE-AUTO-GOALKEEPER-ATTRIBUTION-PLAN.md`). If the orchestrating thread's own `classify:risk-tier` run disagrees, that output is authoritative over this paragraph for Tier 2 specifically.

## Confirmed scope (restated, not re-derived)

1. **Saves**: `Save` records where `byUs === true`. Not saves-against.
2. **Goals Against (GA)**: opponent `Goal` (`scoredByUs === false`) attributed to whichever player occupied the GOALKEEPER-role `FormationPosition` at that goal's `gameSeconds`, via time-window join against `PlayTimeRecord`.
3. **Save %**: `saves / (saves + GA)`, only for players who've logged any GOALKEEPER-role play time this season; dash otherwise, and dash even for a keeper-experienced player when `saves + GA === 0`.
4. **Shot stats** (Shots / On Target / Wide / Blocked): for shots WE took (`Shot.takenByUs === true`), attributed via `Shot.playerId` (the shooter — an attacking stat any field player can have). On Target = outcome `GOAL` or `SAVED`; Wide = outcome `WIDE`; Blocked = outcome `BLOCKED`; `outcome === null` counts toward `shots` only.

## Confirmed current-state facts (verified against source just now, 2026-09-27)

- `src/utils/playTimeCalculations.ts` is 587 lines. `PositionRoleLookup` is declared at lines 206–209, currently **not exported**. `getCurrentGoalkeeperId` (lines 249–270) is the shipped "currently open record" sibling this feature's `getGoalkeeperIdAtTime` deliberately does **not** copy the null-on-ambiguity behavior of. The private `getAttributedPlayTimeRecord` (lines 272–304) holds the exact tie-break sort (latest `startGameSeconds`, then earliest `endGameSeconds` with null→`+Infinity`, then `id` lexicographic) that needs extracting into `pickAttributedRecord`. `normalizeCompletedRecords` (single-game, already exported) is at lines 197–204.
- `src/utils/gameCalculations.ts` is 91 lines today — small, no goalkeeper/save/shot logic yet. `computeScoreFromGoals` (lines 65–70) is the nearest sibling in style/doc-comment convention to follow for the new exports.
- `src/components/SeasonReport.tsx` is 858 lines. Confirmed line anchors used below: `PlayerStats` interface (37–47), `PlayerDetails` interface (49–58), `effectivePositionsMap` memo (141–159), `teamGoalsAssistsByPosition` memo (162–168), Phase-2 fetch effect (174–359, single `Promise.all` at 326–330 for PlayTimeRecord/Goal/GameNote), `calculateStats` (373–441, its inline unclosed-record patch at 390–396), `loadPlayerDetails` (443–551, its own duplicate inline patch at 504–517), summary cards row (564–593), team Goals & Assists by Position section (596–623), Player Statistics table (625–677, 8-column header at 628–638), player detail cards (704–850: Play Time by Position 707–721, Goals & Assists by Position 724–753, Goals 756–772, Assists 775–791, Gold Stars 794–810, Yellow 813–829, Red 832–848).
- `amplify/data/resource.ts`: `Shot` (389–412) and `Save` (420–434) models already exist with everything this feature needs — `Shot.takenByUs`, `Shot.outcome` (`GOAL`/`SAVED`/`BLOCKED`/`WIDE`), `Shot.playerId`, `Shot.gameSeconds`; `Save.byUs`, `Save.playerId` (optional), `Save.gameSeconds`. Both already have `.secondaryIndexes((index) => [index('gameId').queryField('listShotsByGameId' | 'listSavesByGameId')])`. **No schema change of any kind is required by this plan.** `FormationPosition.role` (line 56) already carries the `GOALKEEPER` enum value used throughout.
- `src/types/schema.ts` lines 15–16 already export `Shot`/`Save` types from `Schema["Shot"|"Save"]["type"]`.
- No frontend code currently calls `listShotsByGameId`/`listSavesByGameId` (grep confirmed) — this plan is the first caller. The typed-client method shape (`client.models.Shot.listShotsByGameId({ gameId, limit, nextToken })`) is confirmed via `amplify/functions/delete-game-safe/handler.ts`'s comment on the transformer's queryField naming, and mirrors the exact shape `SeasonReport.tsx` already uses for `client.models.PlayTimeRecord.listPlayTimeRecordsByGameId`.
- Existing tab-nav idiom precedent for the new toggle: `src/components/GameManagement/StatsSubViewTabs.tsx` (`role="tablist"`/`role="tab"`, `aria-selected`, roving `tabIndex` via `-1`/`0`, arrow-key/Home/End handling, `data-*-key` attribute for post-navigation focus). This is the closer precedent than `TabNav.tsx` (that one is the top-level 5-tab game nav) — **this plan's new toggle follows `StatsSubViewTabs.tsx`'s shape exactly**, not `TabNav.tsx`'s.
- `SeasonReport.test.tsx`'s `aws-amplify/data` mock (lines 24–35) only stubs `PlayTimeRecord.listPlayTimeRecordsByGameId`, `Goal.list`, `GameNote.list` today — it needs `Shot.listShotsByGameId` and `Save.listSavesByGameId` stubs added or every existing test using this mock will throw on the new fetch calls.

## Settled data-layer design (final signatures)

### 1. `src/utils/playTimeCalculations.ts`

- **Export** the currently-private `PositionRoleLookup` interface unchanged (just add `export`).
- **Extract** `pickAttributedRecord` (new, private) from `getAttributedPlayTimeRecord`'s existing inline `.sort(...)[0]` — same three-key tie-break, byte-for-byte behavior:
  ```ts
  function pickAttributedRecord(candidates: PlayTimeRecord[]): PlayTimeRecord | null {
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => {
      if (a.startGameSeconds !== b.startGameSeconds) return b.startGameSeconds - a.startGameSeconds;
      const aEnd = a.endGameSeconds ?? Number.POSITIVE_INFINITY;
      const bEnd = b.endGameSeconds ?? Number.POSITIVE_INFINITY;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return a.id.localeCompare(b.id);
    })[0];
  }
  ```
  `getAttributedPlayTimeRecord` keeps its exact existing signature/filter/return behavior, just delegates its final pick to this helper. **No existing test for `getAttributedPlayTimeRecord`'s callers (`calculateTeamGoalsAssistsByPosition`, `calculateGoalsAssistsByPosition`, `calculateGoalsByPosition` in `gameCalculations.ts`... wait, `calculateGoalsByPosition` lives in this same file) may change behavior.**
- **New export** `getGoalkeeperIdAtTime`:
  ```ts
  /**
   * Determine which single player occupied a GOALKEEPER-role position at a
   * specific instant (gameId, gameSeconds), via time-window join against
   * PlayTimeRecord. Filters to gameId itself (does its OWN gameId filtering,
   * unlike getCurrentGoalkeeperId, whose precondition requires pre-scoped
   * records) + GOALKEEPER-role positionId + a covering interval
   * (startGameSeconds <= gameSeconds <= endGameSeconds, open-ended records
   * treated as covering to +Infinity), then delegates tie-break to
   * pickAttributedRecord.
   *
   * Unlike sibling getCurrentGoalkeeperId, this function does NOT null out on
   * multi-candidate ambiguity -- it always picks a candidate when any covers
   * the instant. Reason: normalizer-stretched unclosed records (see
   * normalizeCompletedGamesRecords) can legitimately overlap the real current
   * keeper's record at a boundary instant, and "latest start wins" resolves
   * that correctly, whereas returning null on any overlap would make every
   * keeper-handover-boundary-second goal/save unattributable by construction.
   *
   * This is explicitly NOT a Lambda-parity-tested twin (no amplify/functions/
   * shared counterpart) -- it's report-only, coach-side-only logic; nothing
   * on the guest-auth path needs it.
   */
  export function getGoalkeeperIdAtTime(
    playTimeRecords: PlayTimeRecord[],
    positions: PositionRoleLookup[],
    gameId: string,
    gameSeconds: number
  ): string | null {
    const goalkeeperPositionIds = new Set(
      positions.filter(p => p.role === 'GOALKEEPER').map(p => p.id)
    );
    if (goalkeeperPositionIds.size === 0) return null;

    const candidates = playTimeRecords.filter(r => {
      if (r.gameId !== gameId || r.positionId == null || !goalkeeperPositionIds.has(r.positionId)) {
        return false;
      }
      const end = r.endGameSeconds ?? Number.POSITIVE_INFINITY;
      return r.startGameSeconds <= gameSeconds && gameSeconds <= end;
    });

    const picked = pickAttributedRecord(candidates);
    return picked ? picked.playerId : null;
  }
  ```
- **New export** `calculateGoalsAgainst`:
  ```ts
  /**
   * Map of playerId -> count of opponent goals (scoredByUs === false)
   * attributed to that player via getGoalkeeperIdAtTime. Goals with a null
   * gameSeconds, or that resolve to no covering GOALKEEPER-role record, are
   * silently omitted (not counted against anyone) -- same "omit, don't guess"
   * convention as calculateGoalsByPosition in gameCalculations.ts.
   */
  export function calculateGoalsAgainst(
    goals: Array<Pick<Goal, 'scoredByUs' | 'gameId' | 'gameSeconds'>>,
    playTimeRecords: PlayTimeRecord[],
    positions: PositionRoleLookup[]
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const goal of goals) {
      if (goal.scoredByUs !== false || goal.gameSeconds == null) continue;
      const keeperId = getGoalkeeperIdAtTime(playTimeRecords, positions, goal.gameId, goal.gameSeconds);
      if (keeperId == null) continue;
      result.set(keeperId, (result.get(keeperId) ?? 0) + 1);
    }
    return result;
  }
  ```
- **New export** `normalizeCompletedGamesRecords` (null-safe multi-game wrapper, replaces BOTH inline unclosed-record patch blocks in `SeasonReport.tsx`):
  ```ts
  /**
   * Multi-game wrapper around the existing single-game normalizeCompletedRecords:
   * groups records by gameId and normalizes each completed game's group against
   * its own end time; any game not present in completedGameEndSeconds (still
   * scheduled/in-progress/halftime, or simply unknown) passes through untouched.
   * Does not mutate the input array; returns a new array in no particular order
   * (callers that need original ordering must re-sort).
   */
  export function normalizeCompletedGamesRecords(
    records: PlayTimeRecord[],
    completedGameEndSeconds: Map<string, number>
  ): PlayTimeRecord[] {
    const byGame = new Map<string, PlayTimeRecord[]>();
    for (const r of records) {
      const group = byGame.get(r.gameId);
      if (group) group.push(r); else byGame.set(r.gameId, [r]);
    }
    const result: PlayTimeRecord[] = [];
    for (const [gameId, group] of byGame) {
      const endSeconds = completedGameEndSeconds.get(gameId);
      result.push(...(endSeconds != null ? normalizeCompletedRecords(group, endSeconds) : group));
    }
    return result;
  }
  ```
- **New export** `hasGoalkeeperPlayTime` (final call — needed for the Goalkeeper-tab omission rule and the drill-down breakout-card gate; not spelled out verbatim in prior rounds' notes, but required by the settled dash/omission rule, so making the call here rather than leaving it open):
  ```ts
  /**
   * True if this player has logged any play time at a GOALKEEPER-role
   * FormationPosition, anywhere in the given (already team-scoped) records.
   * Used to decide Goalkeeper-tab row inclusion and the player-detail keeper
   * breakout card -- a player with zero GOALKEEPER-role play time this season
   * gets neither, regardless of any stray Save.playerId pointing at them.
   */
  export function hasGoalkeeperPlayTime(
    playerId: string,
    playTimeRecords: PlayTimeRecord[],
    positions: PositionRoleLookup[]
  ): boolean {
    const goalkeeperPositionIds = new Set(
      positions.filter(p => p.role === 'GOALKEEPER').map(p => p.id)
    );
    if (goalkeeperPositionIds.size === 0) return false;
    return playTimeRecords.some(
      r => r.playerId === playerId && r.positionId != null && goalkeeperPositionIds.has(r.positionId)
    );
  }
  ```
- No changes to any other existing export's signature or behavior in this file.

### 2. `src/utils/gameCalculations.ts`

- **New export** `resolveSaveKeeperId` — the *only* place a save's keeper is ever resolved:
  ```ts
  import type { Save, PlayTimeRecord } from "../types/schema";
  import { getGoalkeeperIdAtTime, type PositionRoleLookup } from "./playTimeCalculations";

  /**
   * Resolve which player gets credit for a save: the save's own explicit
   * playerId when present (never second-guessed by a fallback lookup, even if
   * that lookup would disagree or find nothing), else a time-window fallback
   * via getGoalkeeperIdAtTime. This is the single source of truth for save
   * attribution -- the team card, the per-player Saves column, and the player
   * drill-down's Saves list all consume calculateSavesByKeeper's output,
   * which calls this function once per save, rather than each re-resolving
   * independently.
   */
  export function resolveSaveKeeperId(
    save: Pick<Save, 'playerId' | 'gameId' | 'gameSeconds'>,
    playTimeRecords: PlayTimeRecord[],
    positions: PositionRoleLookup[]
  ): string | null {
    if (save.playerId) return save.playerId;
    if (save.gameSeconds == null) return null;
    return getGoalkeeperIdAtTime(playTimeRecords, positions, save.gameId, save.gameSeconds);
  }
  ```
- **New export** `calculateSavesByKeeper` (team-wide single resolution pass — drill-down MUST reuse `byKeeperForSaveId` rather than re-resolving against a narrowed per-player record set):
  ```ts
  export function calculateSavesByKeeper(
    saves: Array<Pick<Save, 'id' | 'playerId' | 'gameId' | 'gameSeconds' | 'byUs'>>,
    playTimeRecords: PlayTimeRecord[],
    positions: PositionRoleLookup[]
  ): { byKeeper: Map<string, number>; byKeeperForSaveId: Map<string, string>; unattributedCount: number } {
    const byKeeper = new Map<string, number>();
    const byKeeperForSaveId = new Map<string, string>();
    let unattributedCount = 0;

    for (const save of saves) {
      if (save.byUs !== true) continue;
      const keeperId = resolveSaveKeeperId(save, playTimeRecords, positions);
      if (keeperId == null) {
        unattributedCount += 1;
        continue;
      }
      byKeeperForSaveId.set(save.id, keeperId);
      byKeeper.set(keeperId, (byKeeper.get(keeperId) ?? 0) + 1);
    }

    return { byKeeper, byKeeperForSaveId, unattributedCount };
  }
  ```
  Total Saves summary card = `sum(byKeeper.values())`, always — never independently computed from raw `Save.length`.
- **New export** `calculatePlayerShotStats`:
  ```ts
  export function calculatePlayerShotStats(
    playerId: string,
    shots: Array<Pick<Shot, 'playerId' | 'takenByUs' | 'outcome'>>
  ): { shots: number; onTarget: number; wide: number; blocked: number } {
    const playerShots = shots.filter(s => s.takenByUs === true && s.playerId === playerId);
    return {
      shots: playerShots.length,
      onTarget: playerShots.filter(s => s.outcome === 'GOAL' || s.outcome === 'SAVED').length,
      wide: playerShots.filter(s => s.outcome === 'WIDE').length,
      blocked: playerShots.filter(s => s.outcome === 'BLOCKED').length,
    };
  }
  ```
  (needs `import type { Shot } from "../types/schema";` added alongside the existing `Goal, GameNote, Game` import at line 1.)

### 3. `amplify/data/resource.ts`

**No changes.** Confirmed above: `Shot`/`Save` already carry every field this feature reads, and both GSIs (`listShotsByGameId`/`listSavesByGameId`) already exist. This is purely a read-side reporting feature.

### 4. New file `src/components/SeasonReportStatsTabs.tsx` (+ colocated test)

A dedicated small component, mirroring `StatsSubViewTabs.tsx`'s exact interaction pattern (role/aria/roving-tabIndex/arrow-key nav), for the Field/Goalkeeper toggle. Kept as its own file (not inlined in the already-858-line `SeasonReport.tsx`) so it gets its own colocated unit test, matching this codebase's existing precedent of one small tablist component per distinct tablist instance.

```ts
export type SeasonReportStatsView = "field" | "goalkeeper";

interface SeasonReportStatsTabsProps {
  activeView: SeasonReportStatsView;
  onChange: (view: SeasonReportStatsView) => void;
}

const VIEWS: Array<{ key: SeasonReportStatsView; label: string }> = [
  { key: "field", label: "Field" },
  { key: "goalkeeper", label: "Goalkeeper" },
];

export function SeasonReportStatsTabs({ activeView, onChange }: SeasonReportStatsTabsProps) { /* ... */ }
```
Behavior: identical arrow-key/Home/End roving-focus semantics to `StatsSubViewTabs.tsx`; `role="tablist"` with `aria-label="Player statistics view"`; each `role="tab"` with `aria-selected`, `tabIndex={isActive ? 0 : -1}`, `id`/`aria-controls` pair (`season-report-stats-tab-{key}` / `season-report-stats-panel-{key}`); `className="season-report-stats-tabs"` / `"season-report-stats-tab"` / `"season-report-stats-tab--active"` (new CSS, appended to the bottom of `src/App.css` per CLAUDE.md's single-stylesheet convention — no new per-component stylesheet).

**Test file** `src/components/SeasonReportStatsTabs.test.tsx` (new): renders both tabs, asserts `aria-selected` reflects `activeView`, clicking the inactive tab calls `onChange` with the right key, `ArrowRight`/`ArrowLeft`/`Home`/`End` move focus and call `onChange` (mirror `StatsSubViewTabs.test.tsx`'s existing case shapes).

### 5. `src/components/SeasonReport.tsx` — the integration

**New imports:**
```ts
import type { Save, Shot } from '../types/schema';
import {
  calculatePlayerPlayTime,
  calculatePlayTimeByPosition,
  calculateGoalsAssistsByPosition,
  calculateTeamGoalsAssistsByPosition,
  calculateGoalsAgainst,
  normalizeCompletedGamesRecords,
  hasGoalkeeperPlayTime,
  formatPlayTime,
  countGamesPlayed,
  type PositionGoalAssistRow,
  type PositionRoleLookup,
} from "../utils/playTimeCalculations";
import {
  calculatePlayerGoals,
  calculatePlayerAssists,
  calculatePlayerGoldStars,
  calculatePlayerYellowCards,
  calculatePlayerRedCards,
  calculateRecord,
  calculateSavesByKeeper,
  calculatePlayerShotStats,
} from "../utils/gameCalculations";
import { SeasonReportStatsTabs, type SeasonReportStatsView } from "./SeasonReportStatsTabs";
```

**New state:**
```ts
const [statsView, setStatsView] = useState<SeasonReportStatsView>('field');
const [allShots, setAllShots] = useState<Shot[]>([]);
const [allSaves, setAllSaves] = useState<Save[]>([]);
```

**`PlayerStats` interface — new fields:**
```ts
interface PlayerStats {
  // ...existing fields unchanged...
  shots: number;
  shotsOnTarget: number;
  shotsWide: number;
  shotsBlocked: number;
  hasGoalkeeperTime: boolean;
  saves: number;          // meaningful only when hasGoalkeeperTime
  goalsAgainst: number;   // meaningful only when hasGoalkeeperTime
  savePercent: number | null; // null when saves+goalsAgainst === 0, even if hasGoalkeeperTime
}
```

**`PlayerDetails` interface — new fields:**
```ts
interface PlayerDetails {
  // ...existing fields unchanged...
  keeperStats: { saves: number; goalsAgainst: number; savePercent: number | null } | null; // null when !hasGoalkeeperTime
  saves: Array<{ game: Game; minute: number; half: number }>;
  shots: Array<{ game: Game; minute: number; half: number; outcome: Shot['outcome'] }>;
}
```

**Phase-2 fetch effect (currently lines 174–359):** add `fetchShotsForGame`/`fetchSavesForGame`, structurally identical to the existing `fetchGoalsForGame`/`fetchNotesForGame` paginated-`list()` helpers but calling `client.models.Shot.listShotsByGameId({ gameId, limit: 1000, nextToken })` / `client.models.Save.listSavesByGameId(...)` instead (same page-shape as `listPlayTimeRecordsByGameId` — a plain `{ data, nextToken }`, simpler than the multi-shape `parseIndexPage` needed for the `queries`-vs-`models` ambiguity that PlayTimeRecord's helper handles, since Shot/Save's GSI is only ever called via `client.models.*`, never `client.queries.*`).

**Critical: do not fold these into the existing `Promise.all`.** Per settled design, run them as their own `Promise.allSettled` group so a Shot/Save fetch failure never blanks the whole report:
```ts
const [playTimeResults, goalResults, noteResults] = await Promise.all([
  Promise.all(gameIds.map(fetchPlayTimeForGame)),
  Promise.all(gameIds.map(fetchGoalsForGame)),
  Promise.all(gameIds.map(fetchNotesForGame)),
]);
// unchanged above; new block below, independent failure domain
const [shotSettled, saveSettled] = await Promise.allSettled([
  Promise.all(gameIds.map(fetchShotsForGame)),
  Promise.all(gameIds.map(fetchSavesForGame)),
]);
const allShotsData = shotSettled.status === 'fulfilled' ? shotSettled.value.flat() : [];
const allSavesData = saveSettled.status === 'fulfilled' ? saveSettled.value.flat() : [];
if (shotSettled.status === 'rejected') handleApiError(shotSettled.reason, 'Failed to load shot data');
if (saveSettled.status === 'rejected') handleApiError(saveSettled.reason, 'Failed to load save data');
setAllShots(allShotsData);
setAllSaves(allSavesData);
```
(placed alongside the existing `setAllPlayTimeRecords`/`setAllGoals`/`setAllNotes` calls in `loadGameData`).

**New memoized derivations** (component-level, alongside existing `effectivePositionsMap`/`teamGoalsAssistsByPosition`):
```ts
// GOALKEEPER-role lookup sourced ONLY from FormationPosition -- FieldPosition
// has no role field, and adding one to effectivePositionsMap would conflate
// the legacy/current-era position-id merge with role semantics that only
// ever apply to current-era FormationPosition ids.
const positionRoleLookup = useMemo((): PositionRoleLookup[] =>
  formationPositions.map(p => ({ id: p.id, role: p.role ?? null })),
  [formationPositions]
);

const completedGameEndTimes = useMemo(() => {
  const map = new Map<string, number>();
  allGames.forEach(g => {
    if (g.status === 'completed' && g.elapsedSeconds != null) map.set(g.id, g.elapsedSeconds);
  });
  return map;
}, [allGames]);

const normalizedPlayTimeRecords = useMemo(
  () => normalizeCompletedGamesRecords(allPlayTimeRecords, completedGameEndTimes),
  [allPlayTimeRecords, completedGameEndTimes]
);

const teamGameIds = useMemo(() => new Set(allGames.map(g => g.id)), [allGames]);
const teamGoals = useMemo(() => allGoals.filter(g => g && teamGameIds.has(g.gameId)), [allGoals, teamGameIds]);
const teamNotes = useMemo(() => allNotes.filter(n => n && teamGameIds.has(n.gameId)), [allNotes, teamGameIds]);
const teamShots = useMemo(() => allShots.filter(s => s && teamGameIds.has(s.gameId)), [allShots, teamGameIds]);
const teamSaves = useMemo(() => allSaves.filter(s => s && teamGameIds.has(s.gameId)), [allSaves, teamGameIds]);
const teamPlayTimeRecords = useMemo(
  () => normalizedPlayTimeRecords.filter(r => r && teamGameIds.has(r.gameId)),
  [normalizedPlayTimeRecords, teamGameIds]
);

const savesResolution = useMemo(
  () => calculateSavesByKeeper(teamSaves, teamPlayTimeRecords, positionRoleLookup),
  [teamSaves, teamPlayTimeRecords, positionRoleLookup]
);
const goalsAgainstByKeeper = useMemo(
  () => calculateGoalsAgainst(teamGoals, teamPlayTimeRecords, positionRoleLookup),
  [teamGoals, teamPlayTimeRecords, positionRoleLookup]
);
```
These replace the ad hoc `teamGoals`/`teamNotes` filters currently re-computed inline inside both `calculateStats` (lines 403–404) and `loadPlayerDetails` (lines 449, 472), and the two duplicate unclosed-record patch blocks (lines 390–396 and 504–517) collapse into the single `normalizedPlayTimeRecords` memo above — satisfies the settled "hoist filtering outside the per-player loop" and "build savesByKeeper/goalsAgainstByKeeper maps once per calculateStats() call" directives (now built once per *render*, upstream of `calculateStats` entirely, which is strictly better than once-per-call since `calculateStats` itself no longer needs to know about Saves/Goals-against internals at all).

**`calculateStats()` body changes:** replace its own `fixedPlayTimeRecords` computation with `teamPlayTimeRecords` (already normalized+team-filtered above); replace inline `teamGoals`/`teamNotes` filters with the memoized versions; for each player, add:
```ts
const shotStats = calculatePlayerShotStats(player.id, teamShots);
const keeperEligible = hasGoalkeeperPlayTime(player.id, teamPlayTimeRecords, positionRoleLookup);
const saves = savesResolution.byKeeper.get(player.id) ?? 0;
const goalsAgainst = goalsAgainstByKeeper.get(player.id) ?? 0;
const savePercent = (saves + goalsAgainst) > 0 ? saves / (saves + goalsAgainst) : null;
```
and populate the new `PlayerStats` fields (`shots: shotStats.shots, shotsOnTarget: shotStats.onTarget, shotsWide: shotStats.wide, shotsBlocked: shotStats.blocked, hasGoalkeeperTime: keeperEligible, saves, goalsAgainst, savePercent`).

**`loadPlayerDetails(player)` changes:** drop its own inline `completedGameEndTimes`/patch computation (lines 504–517) in favor of `teamPlayTimeRecords` (already normalized); build:
```ts
const keeperEligible = hasGoalkeeperPlayTime(player.id, teamPlayTimeRecords, positionRoleLookup);
const keeperStats = keeperEligible
  ? (() => {
      const saves = savesResolution.byKeeper.get(player.id) ?? 0;
      const goalsAgainst = goalsAgainstByKeeper.get(player.id) ?? 0;
      return { saves, goalsAgainst, savePercent: (saves + goalsAgainst) > 0 ? saves / (saves + goalsAgainst) : null };
    })()
  : null;

const savesList = teamSaves
  .filter(s => savesResolution.byKeeperForSaveId.get(s.id) === player.id)
  .map(s => ({
    game: allGames.find(g => g.id === s.gameId)!,
    minute: Math.floor((s.gameSeconds || 0) / 60),
    half: s.half || 1,
  }))
  .sort((a, b) => (a.game.gameDate || '').localeCompare(b.game.gameDate || ''));

const shotsList = teamShots
  .filter(s => s.takenByUs === true && s.playerId === player.id)
  .map(s => ({
    game: allGames.find(g => g.id === s.gameId)!,
    minute: Math.floor((s.gameSeconds || 0) / 60),
    half: s.half || 1,
    outcome: s.outcome,
  }))
  .sort((a, b) => (a.game.gameDate || '').localeCompare(b.game.gameDate || ''));
```
Both use the SAME `savesResolution` object built once at the component level — this is what guarantees the save-appears-in-exactly-one-drill-down invariant (a save id maps to at most one keeper in `byKeeperForSaveId`, so at most one player's `savesList` filter matches it). Set these plus `keeperStats` on the `playerDetails` state object.

**`useEffect` dependency array (line 371)** — add `allShots`, `allSaves`, `formationPositions`:
```ts
}, [allSynced, allPlayTimeRecords, teamRosters, players, allGames, allGoals, allNotes, allShots, allSaves, formationPositions]);
```

**JSX changes:**

1. Summary cards row (564–593): add a 5th card after "Gold Stars":
   ```tsx
   <div className="summary-card">
     <div className="summary-label">🧤 Total Saves</div>
     <div className="summary-value">
       {Array.from(savesResolution.byKeeper.values()).reduce((sum, n) => sum + n, 0)}
     </div>
     {savesResolution.unattributedCount > 0 && (
       <div className="summary-sublabel">
         +{savesResolution.unattributedCount} save{savesResolution.unattributedCount === 1 ? '' : 's'} with no keeper on record
       </div>
     )}
   </div>
   ```
   (never renders "+0" — the `> 0` guard already matches the settled rule.)

2. Between "Player Statistics" `<h2>` (625) and the table (626), insert:
   ```tsx
   <SeasonReportStatsTabs activeView={statsView} onChange={setStatsView} />
   ```

3. Replace the single 8-column table (627–677) with two conditionally-rendered tables sharing the existing row-click/keyboard-select wiring (`lastSelectedRowRef`, `setSelectedRoster`, `loadPlayerDetails`, `selectedPlayer?.id === stat.player.id` selected/aria-selected state — extract the shared `<tr>` body into one local helper, e.g. a `renderPlayerRow(stat, cells: ReactNode)` function, so both tables reuse identical click/keyboard/ref/selected-state logic rather than duplicating it):
   - **Field tab** (`statsView === 'field'`): `aria-label="Player season statistics"` (unchanged), header row gains 4 columns after Red: `<th>🎯<span className="col-label"> Shots</span></th><th>On Target</th><th>Wide</th><th>Blocked</th>`; each row appends `<td>{stat.shots || '-'}</td><td>{stat.shotsOnTarget || '-'}</td><td>{stat.shotsWide || '-'}</td><td>{stat.shotsBlocked || '-'}</td>` (dash-for-zero matches the existing convention already used for Goals/Assists/Stars/Yellow/Red in this table).
   - **Goalkeeper tab** (`statsView === 'goalkeeper'`): `aria-label="Goalkeeper season statistics"`, header `Player, GP, Time, 🧤 Saves, 🥅 Goals Against, Save %`, **rows filtered to `playerStats.filter(s => s.hasGoalkeeperTime)`** (explicit decision, restated: omit non-keeper rows entirely rather than showing an all-dash row, since the whole point of a separate tab is avoiding that). GP/Time columns reuse the player's existing overall `gamesPlayed`/`totalPlayTimeSeconds` (not goalkeeper-specific minutes) — **explicit call made here**: computing keeper-only minutes/appearances was not part of the confirmed scope and would need a new derivation nobody asked for; the existing overall figures are what's shown, consistent with the Field tab. Saves/GA render as real numbers including literal `0` (no dash-for-zero on these two columns — a shutout is notable and must be visibly `0`, not `-`). Save % renders `savePercent == null ? '—' : `${Math.round(savePercent * 100)}%``.
   - `{playerStats.length === 0 && ...}` empty-state (679–681) stays under the Field tab only; add a Goalkeeper-tab-specific empty state when the filtered list is empty: `"No players have logged goalkeeper time yet."`.

4. Player detail cards (704–850): insert the keeper breakout card **first**, above "Play Time by Position", only when `playerDetails.keeperStats` is non-null:
   ```tsx
   {playerDetails.keeperStats && (
     <div className="details-card keeper-breakout-card">
       <h3>🧤 Goalkeeper Stats</h3>
       <div className="keeper-breakout-row">
         <div className="keeper-breakout-stat">
           <span className="keeper-breakout-value">{playerDetails.keeperStats.saves}</span>
           <span className="keeper-breakout-label">Saves</span>
         </div>
         <div className="keeper-breakout-stat">
           <span className="keeper-breakout-value">{playerDetails.keeperStats.goalsAgainst}</span>
           <span className="keeper-breakout-label">Goals Against</span>
         </div>
         <div className="keeper-breakout-stat">
           <span className="keeper-breakout-value">
             {playerDetails.keeperStats.savePercent == null ? '—' : `${Math.round(playerDetails.keeperStats.savePercent * 100)}%`}
           </span>
           <span className="keeper-breakout-label">Save %</span>
         </div>
       </div>
     </div>
   )}
   ```
   Then, immediately after the existing "Goals & Assists by Position" card (753) and before "Goals" (756), insert two new event-list cards in this order — **Saves, then Shots** — matching the existing `details-card details-card--full-width` / `event-list` / `event-item` markup shape used by Goals/Assists/Gold Stars/Yellow/Red:
   ```tsx
   {playerDetails.saves.length > 0 && (
     <div className="details-card details-card--full-width">
       <h3>🧤 Saves ({playerDetails.saves.length})</h3>
       <div className="event-list">
         {playerDetails.saves.map((save, idx) => (
           <div key={idx} className="event-item">
             <span className="event-game">vs {save.game.opponent} ({save.game.gameDate ? new Date(save.game.gameDate).toLocaleDateString() : 'N/A'})</span>
             <span className="event-time">{save.minute}' (Half {save.half})</span>
           </div>
         ))}
       </div>
     </div>
   )}
   {playerDetails.shots.length > 0 && (
     <div className="details-card details-card--full-width">
       <h3>🎯 Shots ({playerDetails.shots.length})</h3>
       <div className="event-list">
         {playerDetails.shots.map((shot, idx) => (
           <div key={idx} className="event-item">
             <span className="event-game">vs {shot.game.opponent} ({shot.game.gameDate ? new Date(shot.game.gameDate).toLocaleDateString() : 'N/A'})</span>
             <span className="event-time">
               {shot.minute}' (Half {shot.half}) — {SHOT_OUTCOME_LABEL[shot.outcome ?? 'UNKNOWN']}
             </span>
           </div>
         ))}
       </div>
     </div>
   )}
   ```
   with a small local lookup (module scope, above the component): `const SHOT_OUTCOME_LABEL: Record<string, string> = { GOAL: 'Goal', SAVED: 'On Target (Saved)', WIDE: 'Wide', BLOCKED: 'Blocked', UNKNOWN: 'Outcome not recorded' };`. This yields the final drill-down order: keeper breakout (if applicable) → Play Time by Position → Goals & Assists by Position → Saves → Shots → Goals → Assists → Gold Stars → Yellow Cards → Red Cards — matching the settled "group all performance stats together ahead of discipline notes" ordering.

**CSS**: append new rules to the bottom of `src/App.css` (per CLAUDE.md's single-stylesheet convention) for `.season-report-stats-tabs`/`.season-report-stats-tab`/`.season-report-stats-tab--active` (can visually reuse `.stats-subview-tab`'s existing look-and-feel, but needs its own class names since it's a different component/context) and `.keeper-breakout-card`/`.keeper-breakout-row`/`.keeper-breakout-stat`/`.keeper-breakout-value`/`.keeper-breakout-label` (a 3-up flex/grid row, styled like the existing `.summary-card` mini-card idiom but compact/inline within a `details-card`).

## Sequencing / dependency order for implementation

1. `src/utils/playTimeCalculations.ts` — export `PositionRoleLookup`, extract `pickAttributedRecord`, add `getGoalkeeperIdAtTime`, `calculateGoalsAgainst`, `normalizeCompletedGamesRecords`, `hasGoalkeeperPlayTime`. Run existing suite to confirm zero regressions in `getAttributedPlayTimeRecord`'s callers.
2. `src/utils/gameCalculations.ts` — add `resolveSaveKeeperId`, `calculateSavesByKeeper`, `calculatePlayerShotStats` (depends on step 1's export of `getGoalkeeperIdAtTime`/`PositionRoleLookup`).
3. `src/components/SeasonReportStatsTabs.tsx` (+ test) — independent of 1/2, can be built in parallel.
4. `src/components/SeasonReport.tsx` — integrate 1–3 (depends on all three).
5. `src/components/SeasonReport.test.tsx` — update mock (`Shot`/`Save` GSI stubs) and add new cases (depends on 4 being functionally complete).
6. Docs: `README.md`, `docs/specs/UI-SPEC.md` §7.8 (can be written any time after scope is final — no code dependency, but sequenced last here since exact column/label wording should match the shipped UI).

No backend/`amplify/` changes at all, so no deploy-order concerns beyond normal `npm run gate:commit`.

## Full test list per file

### `src/utils/playTimeCalculations.test.ts` (existing file — new cases)
- `getAttributedPlayTimeRecord`'s existing test cases must keep passing unmodified after the `pickAttributedRecord` extraction (regression guard for the refactor itself — no behavior change).
- `getGoalkeeperIdAtTime`:
  - No GOALKEEPER-role position defined at all → `null`.
  - Single covering record → that player's id.
  - **No covering record** (gameSeconds outside every record's interval) → `null`.
  - **Mid-game keeper substitution**: player A's record ends at t=1000, player B's record starts at t=1000; query at t=999 → A; query at t=1001 → B.
  - **Goal/save during a keeper gap**: no record covers the instant at all (e.g., a data gap between two closed records) → `null`, not a crash.
  - **Overlapping records at the same instant, two different players** (data anomaly / normalizer-stretched record overlapping a real one) → does NOT return `null`; picks the record with the later `startGameSeconds` (proves the documented "always picks a candidate" divergence from `getCurrentGoalkeeperId`).
  - **Keeper-handover boundary second**: A's record `endGameSeconds === 1000`, B's record `startGameSeconds === 1000`, query at exactly `gameSeconds === 1000` (both intervals cover it inclusively) → picks B (later `startGameSeconds` tie-break).
  - **Zero-length record tie**: two records for two different players with identical `startGameSeconds` AND identical `endGameSeconds` (or both null/open), both covering the queried instant → deterministic pick by lexicographically smaller `id` (third tie-break tier).
  - `positionId` null/undefined on a candidate record → excluded, no crash.
  - Records from a different `gameId` are excluded even if their interval numerically covers the queried `gameSeconds`.
- `calculateGoalsAgainst`:
  - Opponent goal with a resolvable keeper → counted for that player.
  - `scoredByUs: true` (our goal) → never counted as GA for anyone.
  - Opponent goal with `gameSeconds: null` → silently omitted (not counted, no crash).
  - Opponent goal with no covering GOALKEEPER-role record → silently omitted.
  - Multiple opponent goals across multiple games, correctly bucketed per resolved keeper per game (gameId-scoped resolution, not leaking across games).
- `normalizeCompletedGamesRecords`:
  - Records across 2+ different completed games each normalize against their OWN game's end time, not another game's.
  - A game not present in `completedGameEndSeconds` (e.g., `in-progress`) passes its records through with `endGameSeconds` untouched, including already-open ones.
  - Empty `records` array / empty `completedGameEndSeconds` map → returns `[]` / passes everything through, no crash.
  - Original input array is not mutated (spot-check one input record's identity/shape unchanged after the call).
- `hasGoalkeeperPlayTime`:
  - Player with a record at a GOALKEEPER-role position (open or closed) → `true`.
  - Player with only non-GOALKEEPER-role records → `false`.
  - No GOALKEEPER-role position defined on the team at all → `false` for every player.
  - Player with zero play-time records at all → `false`.

### `src/utils/gameCalculations.test.ts` (existing file — new cases)
- `resolveSaveKeeperId`:
  - **Explicit-playerId-vs-fallback**: `save.playerId` set → returned directly, verified by passing `playTimeRecords`/`positions` that would resolve to a DIFFERENT player via the fallback path (or an empty/ambiguous set that would resolve to `null`) — proves the explicit id always wins and the fallback is never even consulted for its own disagreement.
  - `save.playerId` absent, `gameSeconds` present, resolvable fallback → fallback player's id.
  - `save.playerId` absent, `gameSeconds: null` → `null` without crashing / without calling into `getGoalkeeperIdAtTime` with a bad value.
  - `save.playerId` absent, fallback unresolvable (no covering record) → `null`.
- `calculateSavesByKeeper`:
  - `byUs: false` saves are excluded entirely (not counted, not unattributed).
  - A save with an explicit `playerId` populates `byKeeper` and `byKeeperForSaveId` for that id.
  - A save with no explicit `playerId` and a resolvable fallback populates both maps identically to the explicit case.
  - A save with no explicit `playerId` and no resolvable fallback increments `unattributedCount` and is absent from `byKeeperForSaveId`.
  - **Save-appears-in-exactly-one-drill-down invariant**: given N saves resolving to 2+ distinct keepers, `byKeeperForSaveId` has exactly one entry per attributed save id, and summing `byKeeper.values()` equals the count of entries in `byKeeperForSaveId` (no double-counting, no save attributed to two players).
  - Empty `saves` array → `{ byKeeper: empty, byKeeperForSaveId: empty, unattributedCount: 0 }`.
- `calculatePlayerShotStats`:
  - **Shot outcome bucketing including null outcome**: a shot with `outcome: null` counts toward `shots` only (not `onTarget`/`wide`/`blocked`).
  - `outcome: 'GOAL'` and `outcome: 'SAVED'` both count toward `onTarget` (and `shots`).
  - `outcome: 'WIDE'` → `wide` (and `shots`) only.
  - `outcome: 'BLOCKED'` → `blocked` (and `shots`) only.
  - `takenByUs: false` shots (opponent shots) are excluded even if `playerId` matches (shouldn't normally happen, but the filter must be explicit, not incidental).
  - Shots for a different `playerId` are excluded.
  - Empty `shots` array → all-zero result object.

### `src/components/SeasonReportStatsTabs.test.tsx` (new)
- Renders both "Field" and "Goalkeeper" tabs with correct `role`/`aria-selected` reflecting `activeView`.
- Clicking the inactive tab calls `onChange` with that tab's key.
- `ArrowRight`/`ArrowLeft` moves roving focus and calls `onChange` in both directions, wrapping at the ends (2-tab wraparound).
- `Home`/`End` move to first/last tab respectively.

### `src/components/SeasonReport.test.tsx` (existing file — mock updates + new cases)
- **Mock update (required, breaks every existing test otherwise)**: add `Shot: { listShotsByGameId: (...args) => mockShotList(...args) }` and `Save: { listSavesByGameId: (...args) => mockSaveList(...args) }` to the `aws-amplify/data` mock, defaulting to an empty-page response in `beforeEach` so existing tests (which know nothing about Saves/Shots) keep passing unmodified.
- Field tab renders 12 columns including the 4 new Shot columns with dash-for-zero, and `aria-label="Player season statistics"`.
- Switching to the Goalkeeper tab via `SeasonReportStatsTabs` changes `aria-label` to `"Goalkeeper season statistics"` and shows only players with `hasGoalkeeperTime`.
- A player who has logged GOALKEEPER-role play time this season, with 3 saves and 1 GA, shows Saves=3, GA=1, Save%=75% in the Goalkeeper tab, real zeros (not dashes) when saves/GA are legitimately 0 for a shutout.
- A player who has NEVER logged GOALKEEPER-role play time is entirely absent from the Goalkeeper tab's rows (not shown with dashes).
- A keeper-experienced player with `saves + goalsAgainst === 0` shows `—` for Save % (not `0%`/`NaN%`).
- Goalkeeper tab empty state ("No players have logged goalkeeper time yet.") when no roster player has ever played keeper.
- Total Saves summary card sums across all keepers; shows no "+N with no keeper on record" line when `unattributedCount === 0`; shows the line (correctly pluralized for `1` vs `2+`) when `unattributedCount > 0`.
- Player drill-down for a keeper-experienced player shows the keeper breakout card (Saves/GA/Save%) above "Play Time by Position".
- Player drill-down for a non-keeper player shows NO keeper breakout card.
- Player drill-down section ordering: keeper breakout (if present) → Play Time by Position → Goals & Assists by Position → Saves list → Shots list → Goals → Assists → Gold Stars → Yellow → Red (assert via DOM order, e.g. `querySelectorAll('.details-card')` sequence).
- Saves list in one player's drill-down never includes a save attributed (via `byKeeperForSaveId`) to a different player — cross-player isolation regression guard, backing the invariant tested at the util level.
- Shots list shows the correct outcome label per `SHOT_OUTCOME_LABEL`, including the `outcome: null` → "Outcome not recorded" case.
- A Shot/Save fetch failure (mock rejects) does not blank the rest of the report — Goals/PlayTime/Notes-derived sections still render (regression guard for the `Promise.allSettled` isolation).

## Data / API impact summary

- **Schema**: none. `Shot`/`Save` models and their `listShotsByGameId`/`listSavesByGameId` GSIs already exist and already carry every field this feature reads.
- **`coaches[]` authorization**: not applicable — this feature adds zero new mutations and zero new record types; it only reads existing `Save`/`Shot`/`Goal`/`PlayTimeRecord`/`FormationPosition` records, all already correctly owner-scoped via their existing `allow.ownersDefinedIn('coaches')` grants.
- **New client-side GraphQL calls**: two new query-field calls (`listShotsByGameId`, `listSavesByGameId`), one per game, run in parallel via `Promise.all` inside a `Promise.allSettled` pair — same call volume/shape pattern as the existing `listPlayTimeRecordsByGameId` calls, just isolated into their own failure domain.
- **No Lambda changes.** No IAM changes. No new guest-auth surface.

## Edge cases (explicit, consolidated)

- No GOALKEEPER-role `FormationPosition` defined at all → every derivation (`getGoalkeeperIdAtTime`, `calculateGoalsAgainst`, `hasGoalkeeperPlayTime`) returns the empty/null/false answer uniformly; Goalkeeper tab is empty with its dedicated empty-state message; no player gets a keeper breakout card; Total Saves card still sums any explicit-`playerId` saves correctly (attribution doesn't require the role system when `Save.playerId` is already set).
- Mid-game keeper substitution mid-way through a goal/save event → resolved correctly via the time-window join, independent of whichever player is "currently" in goal at report-viewing time (this is the whole reason `getGoalkeeperIdAtTime` is a point-in-time lookup, not a reuse of `getCurrentGoalkeeperId`).
- Goal/save logged during a genuine keeper gap (no PlayTimeRecord covers that instant, e.g., missing lineup data) → silently omitted from GA/saves counts, never crashes, never guesses.
- Keeper-handover boundary second (sub happens at the exact `gameSeconds` of the event) → deterministic pick via `pickAttributedRecord`'s tie-break (documented above), same tie-break logic already trusted by `calculateGoalsByPosition`/`calculateTeamGoalsAssistsByPosition`.
- Explicit `Save.playerId` always wins over the fallback derivation, even when they'd disagree — coach/helper-entered attribution is authoritative.
- Legacy `FieldPosition`-id-keyed `PlayTimeRecord`s (pre-`FormationPosition` era) → `positionRoleLookup` is built only from `FormationPosition`, so a legacy record's `positionId` simply never matches a GOALKEEPER-role id; the player degrades to `hasGoalkeeperTime: false` — harmless, matches the existing precedent in `SAVE-AUTO-GOALKEEPER-ATTRIBUTION-PLAN.md`'s equivalent edge case.
- A Save with neither an explicit `playerId` nor a resolvable fallback keeper → counts toward `unattributedCount`, surfaced only in the team-level "+N save(s) with no keeper on record" line, never silently dropped without a trace.

## Docs impact (required, not optional)

- **`README.md`** — Season Reports feature bullets (lines 65–70): add two bullets after "Goals & Assists":
  ```
  - **Field / Goalkeeper Toggle**: switch the player statistics table between attacking stats (Goals, Assists, Shots, On Target, Wide, Blocked) and goalkeeper stats (Saves, Goals Against, Save %) — the Goalkeeper view lists only players who've logged goalkeeper time this season
  - **Saves & Goals Against**: a save is credited to its explicit goalkeeper when logged, or derived from who occupied the goalkeeper position at that moment otherwise; opponent goals are attributed to the goalkeeper on the field the same way, feeding a per-player Save % and a team-wide Total Saves summary card
  ```
- **`docs/specs/UI-SPEC.md` §7.8** (Season Reports) — replace the current terse "Layout" bullet list with:
  - A new "Player Statistics Toggle" subsection documenting the Field/Goalkeeper `role="tablist"` toggle (component: `SeasonReportStatsTabs.tsx`), its two tabs' exact column sets (Field: Player, GP, Time, Goals, Assists, Stars, Yellow, Red, Shots, On Target, Wide, Blocked — 12 columns; Goalkeeper: Player, GP, Time, Saves, Goals Against, Save % — 6 columns), the per-tab `aria-label`s ("Player season statistics" / "Goalkeeper season statistics"), and the explicit omission rule (a player with zero GOALKEEPER-role play time this season is omitted from the Goalkeeper tab's rows entirely, not shown with dashes).
  - A note on the dash/zero convention: keeper-experienced players show real numbers including literal `0` for Saves/Goals Against (a shutout is a real stat); Save % shows `—` specifically when `saves + goalsAgainst === 0`, even for a keeper-experienced player.
  - A "Player Detail Drill-down" addition documenting the new keeper breakout card (3-up Saves/Goals Against/Save % mini-stat row, shown only for players who've logged goalkeeper time this season, positioned above "Play Time by Position") and the new Saves/Shots event-list sections, with the full drill-down ordering spelled out: keeper breakout (conditional) → Play Time by Position → Goals & Assists by Position → Saves → Shots → Goals → Assists → Gold Stars → Yellow Cards → Red Cards.
  - Icon note: 🧤 Saves, 🎯 Shots, 🥅 Goals Against; Save %, On Target, Wide, Blocked stay plain-text headers (matching the existing GP/Time precedent).
  - Keep existing Empty States / Tablet Adaptation subsections; add one Empty State row: "No player has logged goalkeeper time" → "No players have logged goalkeeper time yet." (Goalkeeper tab only).
- **`docs/ARCHITECTURE.md` / `CLAUDE.md`**: not required. No sensitive-derivation-pairing precedent is being introduced (this plan is explicit that `getGoalkeeperIdAtTime` is NOT a Lambda-parity-tested twin — it's coach-side-report-only), and no new model/Lambda/auth pattern is introduced that CLAUDE.md's index paragraphs need to reference.

## Test strategy summary

New unit coverage lands in two already-existing, well-covered files (`playTimeCalculations.test.ts`, `gameCalculations.test.ts`) plus one new small component test (`SeasonReportStatsTabs.test.tsx`) and an extension of the existing `SeasonReport.test.tsx` integration suite. No existing test's asserted behavior changes except: (1) the mandatory `aws-amplify/data` mock addition in `SeasonReport.test.tsx` (existing tests must keep passing once `Shot`/`Save` stubs return empty pages by default), and (2) `getAttributedPlayTimeRecord`'s existing tests, which must keep passing byte-for-byte after the `pickAttributedRecord` extraction (pure refactor, no behavior change intended — this is the regression guard proving that). No E2E coverage is being added in this plan (Season Reports has no existing Playwright coverage to extend, and this is a Tier 1, non-safety-critical reporting feature); if the validation reviewer disagrees, that's a fair Minor finding for the review stage, not a plan gap being silently deferred.

## Next step

Implementation (`coding-agent`). This document is final: architecture concerns are answered by verified-in-source facts above (no schema change needed, correct GSI names/shapes confirmed, no `FieldPosition`/`FormationPosition` drift risk since `positionRoleLookup` is sourced only from `FormationPosition`), the UI structure matches the repo owner's approved live mockup exactly, and every fork this plan's own drafting surfaced (GP/Time column source in the Goalkeeper tab, the need for a `hasGoalkeeperPlayTime` export, Saves-vs-Shots list ordering, dash-vs-omission for non-keeper players) has been resolved with an explicit, stated decision rather than left open.
