# Goals & Assists by Position — Season Report
## Implementation Plan

**Feature:** "As a coach, I'd like to see what position a player was playing when they scored goals across the team, aggregated in the Season Report."
**Status:** Revised after architecture and UI review
**Last Updated:** 2026-05-22

---

## 1. Overview

Add a team-level "Goals by Position" table to the Season Report that shows how many goals and assists each field position contributed across all completed team goals in the season. No schema changes or new fetches are required. Position is inferred at goal-time by cross-referencing the scorer's or assister's `PlayTimeRecord` active at `goal.gameSeconds`.

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
| R2 | Infer scorer position from the active `PlayTimeRecord` at `goal.gameSeconds` |
| R3 | Infer assister position independently at the same `goal.gameSeconds` |
| R4 | Only goals where `scoredByUs === true` are counted |
| R5 | Omit scorer or assister events with no matching `PlayTimeRecord`; do not render an `Unknown` row |
| R6 | Treat `endGameSeconds === null` or `undefined` as an open-ended active interval |
| R7 | Sort rows by Goals descending, then Assists descending |
| R8 | Render the section only when at least one row remains after omission rules |
| R9 | No new data fetching; `SeasonReport.tsx` uses already-loaded `allGoals`, `allPlayTimeRecords`, and `allPositions` |
| R10 | If overlapping active intervals exist for the same player/game/second, choose the matching record with the greatest `startGameSeconds` |
| R11 | The change is additive; existing player-level `calculateGoalsAssistsByPosition` semantics stay unchanged unless separate targeted regression coverage justifies an explicitly approved fix |
| R12 | Add an explicit heading for the new team-level section and an explicit heading above the existing player stats table so the document outline remains correct after inserting the new table |
| R13 | Give both the new team-level table and the existing player stats table accessible names via `caption` or `aria-label`/`aria-labelledby` |
| R14 | In the new team-level table, column headers must use `scope="col"` and position-name cells must use `scope="row"` |
| R15 | Do not reuse the `.player-name` class for position cells; add a generic sticky first-column selector/class so the new table can share the sticky visual treatment without semantically mislabeling position cells |

---

## 3. Architecture Decisions

### 3.1 Utility Ownership
`src/utils/playTimeCalculations.ts` owns the full team-table calculation: active-position resolution, `scoredByUs` filtering for this table only, omission of missing or unmapped positions before aggregation, aggregation, and final sort order.

### 3.2 Thin SeasonReport Integration
`src/components/SeasonReport.tsx` should only:

1. Prepare team-scoped inputs from already-loaded data.
2. Memoize the derived table rows.
3. Conditionally render the section when rows exist.

It should not re-implement attribution rules.

### 3.3 No Schema or Fetch Changes
The `Goal` model has no `positionId`, and this feature should not add one. Position is inferred at render-time using existing `Goal`, `PlayTimeRecord`, and `FormationPosition` data already loaded by Season Report.

### 3.4 Deterministic Active-Record Resolution
Add one new private helper inside `playTimeCalculations.ts` that resolves the active `PlayTimeRecord` for a given `playerId`, `gameId`, and `gameSeconds`. It must:

1. Match records where `startGameSeconds <= gameSeconds`.
2. Treat `endGameSeconds == null` as open-ended and therefore still active.
3. Otherwise require `gameSeconds <= endGameSeconds`.
4. If multiple records match, choose the one with the greatest `startGameSeconds`.

This resolves overlapping intervals deterministically without changing the data model.

### 3.5 Additive Scope
The only new public API required for this feature is a team-level aggregation utility. Do not refactor the existing player-level `calculateGoalsAssistsByPosition` to share the new semantics during this feature unless targeted regression tests first prove there is no unintended outward behavior change beyond any separately approved open-ended interval fix.

### 3.6 Omission Rules
For the new team-level table only:

1. Filter to `scoredByUs === true` before attribution.
2. Omit scorer attribution when no active record matches, `positionId` is missing, or the `positionId` is not in the positions map.
3. Omit assister attribution under the same rules.
4. Do not synthesize an `Unknown` row.

### 3.7 Placement, Headings, and Styling
Render the new section between the summary cards and the player stats table. Add an explicit section heading for the new team-level table and a matching heading for the existing player stats table so the page outline remains correct after insertion. Add only the minimal section-level styling needed in `App.css`, reusing existing Season Report table styling where practical.

### 3.8 Table Accessibility
Both Season Report tables in the main content area must have explicit accessible names. The implementation may use either visible `caption` elements or `aria-label`/`aria-labelledby`, but the plan should prefer heading-linked labeling so the visible heading and table name stay aligned.

For the new team-level table specifically:

1. Mark each header cell in the header row with `scope="col"`.
2. Render the position name as a row header cell with `scope="row"`.
3. Keep the existing conditional render behavior so the section is absent when there are no rows.

### 3.9 Generic Sticky First Column
The existing player stats table uses `.player-name` for sticky first-column behavior. Do not extend that semantic class to position cells. Instead, extract the sticky-first-column presentation into a generic selector or class that both tables can use, while leaving `.player-name` available only for player-name-specific typography or content styling.

---

## 4. File-by-File Change List

### 4.1 `src/utils/playTimeCalculations.ts`
**Add:** One private active-record resolver and one exported team-level aggregation utility.

```ts
interface TeamPositionGoalAssistRow {
  position: string;
  goals: number;
  assists: number;
}

export function calculateTeamGoalsAssistsByPosition(
  goals: Goal[],
  playTimeRecords: PlayTimeRecord[],
  positions: Map<string, { positionName: string }>
): TeamPositionGoalAssistRow[]
```

**Planned logic:**
1. Keep the existing exported player-level helper unchanged for this feature.
2. Add a private resolver that returns the single active record for a player/game/second using the overlap rule above.
3. Filter goals to `scoredByUs === true`.
4. Resolve scorer and assister positions independently for each qualifying goal.
5. Skip any scorer or assister attribution when no active record is found, `positionId` is absent, or the `positionId` is unmapped.
6. Aggregate counts in a `Map<positionName, { goals, assists }>`.
7. Return only rows that received at least one goal or assist.
8. Sort by goals descending, then assists descending.

### 4.2 `src/utils/playTimeCalculations.test.ts`
**Add:** Focused tests for the new team-level utility, plus targeted regression coverage only if existing helper behavior is intentionally touched.

Test cases:

| Case | Description |
|---|---|
| Basic goal bucketing | Goal at second 30, scorer PTR covers the event, matching position gets one goal |
| Independent assist attribution | Scorer and assister are in different active positions, so separate rows increment |
| `scoredByUs === false` excluded | Opponent goals never affect the team table |
| Missing PTR omitted | Event with no active PTR produces no row |
| Missing or unmapped `positionId` omitted | Matching PTR exists but cannot map to a position row |
| Open-ended interval match | `endGameSeconds == null` still counts as active at the goal second |
| Overlap resolution | Two active records overlap and the one with the greatest `startGameSeconds` wins |
| Final sorting | Rows sort by goals desc, then assists desc |
| Existing helper regression guard | Only needed if implementation intentionally changes existing player-level helper behavior |

### 4.3 `src/components/SeasonReport.tsx`
**Add:** A memoized team-level table derivation using already-loaded data, plus explicit headings and accessible names for both main Season Report tables.

Planned shape:

```ts
const goalsByPosition = useMemo(() => {
  if (!allGoals.length || !allPlayTimeRecords.length || !allPositions.length) {
    return [];
  }

  const positionsMap = new Map(
    allPositions
      .filter(position => Boolean(position.positionName))
      .map(position => [position.id, { positionName: position.positionName! }])
  );

  const teamGoals = allGoals.filter(goal => teamGameIds.has(goal.gameId));
  const teamPlayTimeRecords = allPlayTimeRecords.filter(record => teamGameIds.has(record.gameId));

  return calculateTeamGoalsAssistsByPosition(teamGoals, teamPlayTimeRecords, positionsMap);
}, [allGoals, allPlayTimeRecords, allPositions, teamGameIds]);
```

Then render the section between the summary cards and player stats table only when `goalsByPosition.length > 0`.

UI-specific markup requirements:
1. Add a visible heading for the new team-level section, for example `Goals & Assists by Position`.
2. Add a visible heading immediately above the existing player stats table, for example `Player Statistics`.
3. Ensure the new team-level table has an explicit accessible name tied to its heading via `aria-labelledby` or a visible `caption`.
4. Ensure the existing player stats table also has an explicit accessible name tied to its heading via `aria-labelledby` or a visible `caption`.
5. Use `scope="col"` on the new table's header row and `scope="row"` on the position-name cells.
6. Apply the new generic sticky first-column class or selector to the new table's first column instead of reusing `.player-name`.

### 4.4 `src/components/SeasonReport.test.tsx`
**Add:** Integration-style rendering checks for the new team table, plus accessibility assertions for the revised headings and table names.

Test cases:

| Case | Description |
|---|---|
| Section renders with rows | Team-scoped goal + matching PTR + mapped position renders the section and counts |
| Section hidden when all events are omitted | Missing PTR, unmapped position, or only opponent goals leaves no section |
| Assists count independently in UI | Different scorer and assister positions render on separate rows |
| Overlap rule reflected in UI | Fixture with overlapping PTRs renders counts on the row chosen by the greatest `startGameSeconds` |
| Main table headings present | New team section heading and existing player stats heading both render in the correct order |
| Main tables have accessible names | Tests query both tables by accessible name rather than only by text content |
| New table header scopes | Column headers expose `scope="col"` and position cells expose `scope="row"` |

### 4.5 `src/App.css`
**Add:** Minimal `.goals-by-position` wrapper and heading styles consistent with nearby Season Report sections. Reuse existing table styling where practical, but extract the sticky first-column behavior from `.player-name` into a generic selector or class shared by the player stats table and the new team table.

CSS-specific expectations:
1. Keep `.player-name` for player-name-specific styling only.
2. Introduce a generic sticky first-column hook such as `.stats-table__first-column` or an equivalent scoped selector.
3. Update hover and mobile rules so they target the generic sticky first-column hook, with any player-name-specific typography left on `.player-name`.
4. Avoid introducing a separate visual system for the new table when the existing stats-table styles can be reused with minimal additions.

---

## 5. Out of Scope

- Adding `positionId` directly to the `Goal` model
- Any schema, subscription, or fetch changes
- Refactoring existing player-level `calculateGoalsAssistsByPosition` onto the new resolver or new semantics without separate approval and regression coverage
- Fixing the pre-existing `scoredByUs` mismatch in existing player totals or player-detail attribution beyond this new team table
- Position breakdown for opponent goals conceded

---

## 6. Test Strategy

| Layer | What | Where |
|---|---|---|
| Unit | `calculateTeamGoalsAssistsByPosition` with omission rules, open-ended intervals, overlap resolution, and final sorting | `src/utils/playTimeCalculations.test.ts` |
| Regression | Existing player-level helper only if implementation intentionally changes it | `src/utils/playTimeCalculations.test.ts` |
| Integration | `SeasonReport` renders or hides the team table based on memoized rows from already-loaded data, with explicit headings and accessible table names | `src/components/SeasonReport.test.tsx` |
| Gate | `npm run gate:commit` | Before commit |

---

## 7. Verification Steps

1. `npm run test:run` passes with new unit and Season Report tests.
2. `npm run gate:commit` passes.
3. Manual: open Season Report for a team with qualifying goals and mapped positions -> the table appears with correct counts sorted by goals desc then assists desc.
4. Manual: validate a fixture with overlapping active PTRs -> attribution follows the record with the greatest `startGameSeconds`.
5. Manual: validate a fixture where all events are omitted -> the section is absent and no `Unknown` row appears.
