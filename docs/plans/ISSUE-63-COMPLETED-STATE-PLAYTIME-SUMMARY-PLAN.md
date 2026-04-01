# Issue #63 — Completed State Play Time Summary
## Implementation Plan

**Issue:** "As a coach, I'd like to be able to see what the play times ended up being for the game for each player after it is completed."  
**Status:** Ready for implementation  
**Last Updated:** 2025

---

## 1. Overview

Add a `CompletedPlayTimeSummary` component to `src/components/GameManagement/` and insert it into the `completed` state block of `GameManagement.tsx`. Also add a "View Full Report" navigation link per UI-SPEC §7.6. No new data fetching or schema changes are required.

---

## 2. Requirements Summary

| # | Requirement | Source |
|---|---|---|
| R1 | Show each roster player's total play time after game is completed | Issue #63, UI-SPEC §7.6 |
| R2 | Display: player name (number + first + last) and formatted play time | AC #2 |
| R3 | Players with 0 seconds are shown but visually differentiated | AC #3 |
| R4 | Null `endGameSeconds` records use `game.elapsedSeconds` as end time | AC #4 |
| R5 | Component lives in the existing completed-state section | AC #5 |
| R6 | "View Full Report" link navigates to `/reports/:teamId` | AC #6, UI-SPEC §7.6 |
| R7 | Reuse `calculatePlayerPlayTime` + `formatPlayTime` — no new data fetch | AC #7 |

---

## 3. Architecture Decisions

### 3.1 New Component vs. Inline JSX
A **new dedicated component** `CompletedPlayTimeSummary` is the right approach because:
- It follows the existing pattern (each section in completed state = its own component: `PreGameNotesPanel`, `GoalTracker`)
- It gets its own test file
- It keeps `GameManagement.tsx` from growing further

### 3.2 Null-endGameSeconds Fix Location
The fix-up (null `endGameSeconds` → `game.elapsedSeconds`) must happen **inside `CompletedPlayTimeSummary`**, not in `GameManagement.tsx`. This mirrors the pattern SeasonReport.tsx uses in `calculateStats()`. The component receives both `playTimeRecords` and `game.elapsedSeconds` as props and does a local normalization before passing to `calculatePlayerPlayTime`.

### 3.3 "View Full Report" Link
Use React Router `<Link to={`/reports/${team.id}`}>` since the app uses `BrowserRouter` and all game routes are inside `AppLayout`. The `team.id` is already available in `GameManagement`.

### 3.4 Sort Order
Sort players by roster number (ascending), matching the SeasonReport pattern. Use the existing `sortRosterByNumber` utility from `src/utils/playerUtils.ts` or simply sort by `p.playerNumber` since `players` is `PlayerWithRoster[]` (which already includes roster number).

### 3.5 CSS Strategy
Add a new scoped BEM block `.completed-playtime-summary` to `App.css`. Do not reuse the existing `.playtime-bar-container` / `.playtime-bar-wrapper` classes (those are for the progress-bar style used in `BenchTab`). The completed view is a static summary table/list — simpler and more scannable on mobile.

---

## 4. File-by-File Change List

### 4.1 NEW: `src/components/GameManagement/CompletedPlayTimeSummary.tsx`
**Purpose:** Renders the per-player play time summary table for the completed state.

**Props interface:**
```ts
interface CompletedPlayTimeSummaryProps {
  players: PlayerWithRoster[];           // full roster
  playTimeRecords: PlayTimeRecord[];     // raw records (may have null endGameSeconds)
  gameElapsedSeconds: number;            // game.elapsedSeconds — used to close open records
}
```

**Logic:**
1. Build `normalizedRecords` by mapping `playTimeRecords`: if `endGameSeconds` is null/undefined, replace with `gameElapsedSeconds`.
2. For each player in `players`, compute `totalSeconds = calculatePlayerPlayTime(player.id, normalizedRecords)`.
3. Sort by `playerNumber` ascending (nulls last).
4. Render a `<ul>` (or `<table>`) with one row per player. Rows where `totalSeconds === 0` get a CSS modifier class (e.g., `completed-playtime-summary__row--no-time`) for visual differentiation (muted text, italic).
5. Format time with `formatPlayTime(totalSeconds, 'long')` — produces "23m", "1h 5m", or "0m".

**Empty state:** If `players.length === 0`, render a subtle "No roster players found." message.

**No imports of Amplify client or hooks** — pure display component.

---

### 4.2 NEW: `src/components/GameManagement/CompletedPlayTimeSummary.test.tsx`
**Purpose:** Unit tests for the new component.

**Test cases:**
1. ✅ Renders a row for each player in the roster
2. ✅ Displays formatted play time from closed records (`endGameSeconds` set)
3. ✅ Correctly uses `gameElapsedSeconds` for records with `null` endGameSeconds
4. ✅ Player with 0 seconds play time is rendered with the "no-time" CSS modifier class
5. ✅ Player with 0 seconds is NOT excluded from the list
6. ✅ Players are sorted by player number ascending
7. ✅ Shows empty state message when `players` array is empty
8. ✅ Handles a mix of closed and open records for the same player (partial game)
9. ✅ `formatPlayTime(..., 'long')` output is shown (e.g., "23m")

**Mocking strategy:** No mocks needed — pure component with no side effects. Import and call `calculatePlayerPlayTime` / `formatPlayTime` directly (or let the real implementations run; they are pure functions).

---

### 4.3 MODIFIED: `src/components/GameManagement/GameManagement.tsx`

**Changes:**
1. **Import** `CompletedPlayTimeSummary` from `./CompletedPlayTimeSummary`.
2. **Import** `Link` from `react-router-dom` (already a project dependency; verify it's used elsewhere).
3. **In the `completed` state block** (lines 1140–1156), insert `<CompletedPlayTimeSummary>` between `<PreGameNotesPanel>` and `<GoalTracker>`, and add a "View Full Report" `<Link>` after `<GoalTracker>`:

**Before (line 1141–1156):**
```tsx
{gameState.status === 'completed' && (
  <div className="completed-layout">
    <PreGameNotesPanel ... />
    <GoalTracker {...sharedGoalTrackerProps} />
    {deleteGameButton}
  </div>
)}
```

**After:**
```tsx
{gameState.status === 'completed' && (
  <div className="completed-layout">
    <PreGameNotesPanel ... />
    <CompletedPlayTimeSummary
      players={players}
      playTimeRecords={playTimeRecords}
      gameElapsedSeconds={gameState.elapsedSeconds ?? 0}
    />
    <GoalTracker {...sharedGoalTrackerProps} />
    <div className="completed-report-link">
      <Link to={`/reports/${team.id}`} className="btn-secondary">
        View Full Season Report →
      </Link>
    </div>
    {deleteGameButton}
  </div>
)}
```

**Note on `gameState.elapsedSeconds ?? 0`:** `gameState` is `Game` which has `elapsedSeconds: number | null | undefined`. The `?? 0` guard handles the (unlikely for completed games) null case — a completed game should always have `elapsedSeconds` set by `handleEndGame`.

---

### 4.4 MODIFIED: `src/components/GameManagement/index.ts`
**Change:** Export `CompletedPlayTimeSummary` if it is re-exported from this barrel file. Inspect current exports; if other new components are not re-exported here, no change needed.

---

### 4.5 MODIFIED: `src/App.css`
**Add new CSS block for the summary component and report link:**

```css
/* ─── Completed State — Play Time Summary ─── */
.completed-playtime-summary {
  background: var(--card-background);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  padding: 1rem;
  margin-bottom: 1rem;
}

.completed-playtime-summary__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.completed-playtime-summary__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.completed-playtime-summary__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.95rem;
}

.completed-playtime-summary__row:last-child {
  border-bottom: none;
}

.completed-playtime-summary__player-name {
  color: var(--text-primary);
  font-weight: 500;
}

.completed-playtime-summary__time {
  font-weight: 600;
  color: var(--primary-green);
  font-variant-numeric: tabular-nums;
}

/* Visually differentiate players who did not play */
.completed-playtime-summary__row--no-time .completed-playtime-summary__player-name {
  color: var(--text-secondary);
  font-style: italic;
}

.completed-playtime-summary__row--no-time .completed-playtime-summary__time {
  color: var(--text-secondary);
  font-weight: 400;
}

.completed-playtime-summary__empty {
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-style: italic;
}

/* View Full Report link in completed state */
.completed-report-link {
  display: flex;
  justify-content: center;
  margin: 0.5rem 0 1rem;
}
```

---

### 4.6 MODIFIED: `src/components/GameManagement/GameManagement.test.tsx`
**Add test cases in a new `describe` block: `"GameManagement – completed state play time summary"`**

Test cases:
1. ✅ `CompletedPlayTimeSummary` is rendered when `gameState.status === 'completed'`
2. ✅ `CompletedPlayTimeSummary` is NOT rendered when `gameState.status !== 'completed'` (in-progress, halftime, scheduled)
3. ✅ "View Full Season Report" link is present in completed state and points to `/reports/${team.id}`
4. ✅ `CompletedPlayTimeSummary` receives correct props: `players`, `playTimeRecords`, `gameElapsedSeconds`

**Mocking:** Add `vi.mock('./CompletedPlayTimeSummary', ...)` following the same pattern as `GoalTracker`, `PreGameNotesPanel`, etc. Capture props via `mockCaptures`.

---

## 5. Data Model Impacts

**None.** No schema changes, no new GraphQL operations, no new DynamoDB access patterns. All data is already fetched by `useGameSubscriptions` via `listPlayTimeRecordsByGameId`.

---

## 6. API / Routing Impacts

- The "View Full Report" link uses the already-registered route `path="reports/:teamId"` in `App.tsx` (line 42). No new route is needed.
- `react-router-dom` is already a dependency. The `Link` component may need to be imported into `GameManagement.tsx` — verify it is not already imported.

---

## 7. Edge Cases & Risks

| # | Edge Case | Handling |
|---|---|---|
| EC1 | `game.elapsedSeconds` is null on a completed game | `?? 0` guard in prop. A 0-second game will show 0m for all players. In practice `handleEndGame` always sets `elapsedSeconds`. |
| EC2 | All players have 0 play time (game was ended immediately or no substitutions ever happened) | All rows render with `--no-time` modifier. No "nobody played" special case needed beyond the visual diff. |
| EC3 | A player was added to roster mid-season and never appeared in this game | They appear with 0m in the `--no-time` style. This is correct per AC #3. |
| EC4 | `playTimeRecords` is empty (no tracking was done) | All players show 0m. Valid — same as EC2. |
| EC5 | Player appears in `playTimeRecords` but NOT in `players` array | Not rendered — the loop is over `players` (the roster), not over records. |
| EC6 | Very large rosters (20+ players) | List simply scrolls. No pagination required — in-game rosters are typically 10–20 players max. |
| EC7 | `gameState.elapsedSeconds` differs from actual sum of play records | `elapsedSeconds` is the authoritative game clock. The same normalization is used in SeasonReport; it is the established pattern. |
| EC8 | `react-router-dom` `Link` used in a test context without a Router | `GameManagement.test.tsx` tests will need a `MemoryRouter` wrapper, OR the `Link` can be tested only at the `CompletedPlayTimeSummary` level where it doesn't exist (the link is in `GameManagement.tsx`). The existing test's `render(<GameManagement ...>)` call needs `MemoryRouter` if it isn't already wrapped. **Check:** The existing tests use `render(...)` directly. Since `Link` is new to `GameManagement.tsx`, a `MemoryRouter` wrapper may need to be added to `renderComponent()`. This is the highest-risk test change. |

---

## 8. Dependencies & Sequencing

```
Step 1: Create CompletedPlayTimeSummary.tsx           (no deps)
Step 2: Create CompletedPlayTimeSummary.test.tsx      (depends on Step 1)
Step 3: Add CSS to App.css                            (no deps)
Step 4: Modify GameManagement.tsx                     (depends on Step 1)
Step 5: Update GameManagement.test.tsx                (depends on Step 4; check MemoryRouter need)
Step 6: Update index.ts export (if applicable)        (depends on Step 1)
```

Steps 1, 2, 3 can be done in parallel. Steps 4 and 5 must follow Step 1.

---

## 9. Test Strategy

### Unit Tests (Vitest + React Testing Library)
- **`CompletedPlayTimeSummary.test.tsx`** — 9 cases as described in §4.2. Pure rendering tests, no mocks needed.
- **`GameManagement.test.tsx`** — 4 integration-level cases as described in §4.6. Component-under-test is `GameManagement`; `CompletedPlayTimeSummary` is mocked.

### Manual Smoke Test Checklist
1. Open a completed game with play time records (including at least one with null `endGameSeconds`)
2. Confirm each roster player appears exactly once
3. Confirm player who didn't play shows muted/italic styling
4. Confirm time format is "23m" (long format), not "23:00" (short)
5. Confirm "View Full Season Report →" link navigates to `/reports/:teamId`
6. Confirm the link opens the SeasonReport for the correct team

### Regression Tests to Re-Run
- Full existing `GameManagement.test.tsx` suite (no behavior change, only additions)
- `SeasonReport.tsx` tests (unchanged, but same calculation utilities are used)

---

## 10. Out of Scope

- Position breakdown within this game (e.g., "15m as Forward, 8m as Midfielder") — SeasonReport already shows this; the completed state only needs the total.
- Sortable columns (by name / by time) — YAGNI; simple roster-number sort is sufficient.
- Playtime progress bar visualization — the bar style (BenchTab) is for live comparisons; a completed summary only needs a number.
- Editing or correcting play time records from this screen.

---

## 11. Open Questions (Resolved)

| Question | Resolution |
|---|---|
| Should we show 0-time players? | Yes — AC #3 explicitly requires it with visual differentiation |
| What time format? | `'long'` — matches SeasonReport ("23m", "1h 5m") which is what coaches are familiar with |
| Where does the "View Full Report" link go? | `/reports/${team.id}` — already a registered route, per UI-SPEC §7.6 |
| Does the list need to be sorted? | Yes — by player number ascending, matching SeasonReport sort |
| Should the component close open PTRs in the DB? | No — `closeActivePlayTimeRecords` is already called by `handleEndGame`. The normalization here is purely display-side, same as SeasonReport. |
