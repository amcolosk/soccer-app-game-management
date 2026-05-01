# Goals & Assists by Position — Season Report
## Implementation Plan

**Feature:** "As a coach, I'd like to see what position a player was playing when they scored goals across the team, aggregated in the Season Report."
**Status:** Ready for implementation
**Last Updated:** 2026-04-26

---

## 1. Overview

Add a team-level "Goals by Position" table to the Season Report that shows how many goals and assists each field position contributed across all completed games in the season. No schema changes are required — position is inferred at goal-time by cross-referencing the scorer's `PlayTimeRecord` active at `goal.gameSeconds`.

**Example output:**

| Position | Goals | Assists |
|---|---|---|
| Striker | 15 | 3 |
| Right Wing | 4 | 8 |
| Left Wing | 2 | 6 |
| Offensive Mid | 1 | 9 |

---

## 2. Requirements Summary

| # | Requirement |
|---|---|
| R1 | Show a team-level table in the Season Report: Position / Goals / Assists |
| R2 | Position is inferred from the scorer's active `PlayTimeRecord` at `goal.gameSeconds` |
| R3 | Assists are attributed to the position the assisting player was occupying at the same game second |
| R4 | Only goals where `scoredByUs === true` are counted |
| R5 | Goals/assists with no matching `PlayTimeRecord` are silently omitted (no "Unknown" row) |
| R6 | Open-ended records (`endGameSeconds === null`) treat the player as still on the field |
| R7 | Table is sorted by Goals descending; ties broken by Assists descending |
| R8 | Table is only rendered when at least one position has goals or assists > 0 |
| R9 | No new data fetching — all required data (`allGoals`, `allPlayTimeRecords`, `allPositions`) is already loaded in `SeasonReport.tsx` |

---

## 3. Architecture Decisions

### 3.1 Where the Logic Lives
The position-inference algorithm belongs in `src/utils/playTimeCalculations.ts`. This module already owns all play-time and position-related calculations (`calculatePlayTimeByPosition`, `calculatePlayerPlayTime`, etc.), and the new function follows the same input/output pattern.

### 3.2 No Schema Change
The `Goal` model has no `positionId`. Rather than adding one (which would require a migration and backfill), position is inferred at query time using the cross-reference:

```
Goal.scorerId + Goal.gameId + Goal.gameSeconds
  → PlayTimeRecord where playerId = scorerId
                      AND gameId  = Goal.gameId
                      AND startGameSeconds <= gameSeconds
                      AND (endGameSeconds IS NULL OR endGameSeconds >= gameSeconds)
  → positionId → positionName
```

This is O(n×m) per game but the record counts are small (< 30 PTRs, < 20 goals per game), so no indexing is needed.

### 3.3 Open-Ended PlayTimeRecord Handling
A record with `endGameSeconds === null` means the player was still on the field when the game was completed or when the last snapshot was written. For purposes of position inference, any `goal.gameSeconds >= record.startGameSeconds` is treated as a match when `endGameSeconds` is null.

### 3.4 Scorer vs. Assister — Independent Lookups
The goal scorer and the assister may be playing different positions. Each is looked up independently using the same PTR cross-reference. A goal can therefore contribute one tally to the scorer's position and a separate tally to the assister's position (or none if no matching PTR).

### 3.5 Placement in SeasonReport
The new table is placed **between the summary cards and the player stats table** — it is team-level context, not per-player detail, so it belongs with the team summary content above the individual breakdown.

### 3.6 CSS Strategy
Add a scoped BEM block `.goals-by-position` to `App.css`, following the existing pattern used for `.season-report-summary` and `.stats-table`. The table should be consistent with the existing `.stats-table` styling.

---

## 4. File-by-File Change List

### 4.1 `src/utils/playTimeCalculations.ts`
**Add:** Export function `calculateGoalsByPosition`

```ts
export interface GoalsByPositionEntry {
  positionName: string;
  goals: number;
  assists: number;
}

export function calculateGoalsByPosition(
  goals: Goal[],
  playTimeRecords: PlayTimeRecord[],
  positionsMap: Map<string, { positionName: string }>
): GoalsByPositionEntry[]
```

**Logic:**
1. Filter `goals` to `g.scoredByUs === true`.
2. Build an accumulator `Map<positionName, {goals, assists}>`.
3. For each qualifying goal:
   - Lookup scorer's position: find PTR where `playerId === g.scorerId && gameId === g.gameId && startGameSeconds <= g.gameSeconds && (endGameSeconds === null || endGameSeconds >= g.gameSeconds)`. If found and `positionId` is in `positionsMap`, increment `goals`.
   - If `g.assistId` is set, run the same lookup for `g.assistId`; if found, increment `assists`.
4. Convert accumulator to array, sort by `goals` desc then `assists` desc.
5. Return the sorted array (omit rows where both `goals === 0 && assists === 0`).

**Inputs use types already imported in the file:** `Goal`, `PlayTimeRecord` from `src/types/schema.ts`.

---

### 4.2 `src/utils/playTimeCalculations.test.ts`
**Add:** Test suite for `calculateGoalsByPosition`

Test cases:
| Case | Description |
|---|---|
| Basic goal bucketing | Goal at gameSeconds=30, PTR covers 0–60, correct positionName incremented |
| Assist in different position | Scorer at Left Wing, assister at Offensive Mid — two separate rows updated |
| `scoredByUs === false` excluded | Opponent goals ignored regardless of scorer/assister |
| No matching PTR — omitted | Goal exists but no PTR covers that second; row not created |
| Open-ended PTR (`endGameSeconds === null`) | Goal at second 70, PTR starts at 45 with null end — correctly matched |
| Sorting | Two positions with different goal counts produce correct descending order |
| Tie-breaking | Equal goals sorted by assists descending |

---

### 4.3 `src/components/SeasonReport.tsx`
**Add 1:** Import `calculateGoalsByPosition` and `GoalsByPositionEntry` from `playTimeCalculations`.

**Add 2:** `useMemo` for `goalsByPosition`:
```ts
const goalsByPosition = useMemo(() => {
  if (!allGoals.length || !allPlayTimeRecords.length) return [];
  const positionsMap = new Map(
    allPositions.map(p => [p.id, { positionName: p.positionName ?? 'Unknown' }])
  );
  const teamGoals = allGoals.filter(g => teamGameIds.has(g.gameId));
  const teamPTRs  = allPlayTimeRecords.filter(r => teamGameIds.has(r.gameId));
  return calculateGoalsByPosition(teamGoals, teamPTRs, positionsMap);
}, [allGoals, allPlayTimeRecords, allPositions, teamGameIds]);
```

**Add 3:** Render new section between summary cards and player stats table:
```tsx
{goalsByPosition.length > 0 && (
  <section className="goals-by-position">
    <h3>Goals by Position</h3>
    <table className="stats-table">
      <thead>
        <tr>
          <th>Position</th>
          <th>Goals</th>
          <th>Assists</th>
        </tr>
      </thead>
      <tbody>
        {goalsByPosition.map(row => (
          <tr key={row.positionName}>
            <td>{row.positionName}</td>
            <td>{row.goals}</td>
            <td>{row.assists}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
)}
```

---

### 4.4 `src/App.css`
**Add:** Styles for `.goals-by-position` section header, consistent with existing season report card/section styling. Reuse `.stats-table` for the table itself — no new table styles needed.

---

## 5. Out of Scope

- Adding `positionId` directly to the `Goal` model (schema change not needed)
- Per-player goals-by-position breakdown in the player detail panel
- Fixing the pre-existing `scoredByUs` filtering gap in the per-player stats table (separate bug)
- Position breakdown for opponent goals conceded

---

## 6. Test Strategy

| Layer | What | Where |
|---|---|---|
| Unit | `calculateGoalsByPosition` — all 7 cases above | `playTimeCalculations.test.ts` |
| Integration | `SeasonReport` renders table when data present; hidden when no data | `SeasonReport.test.tsx` (if it exists) or new test file |
| Gate | `npm run gate:commit` (lint + test:run + build) | Before commit |

---

## 7. Verification Steps

1. `npm run test:run` — new unit tests pass
2. `npm run gate:commit` — full gate green
3. Manual: open Season Report for a team with game history → "Goals by Position" table appears with correct position names, goal counts, and assist counts, sorted goals-descending
4. Manual: open Season Report for a team with no game data → table is absent (no empty section rendered)
