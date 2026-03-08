# Debug Data Capture Specification

## 1. Overview

TeamTrack captures a structured debug snapshot for each major screen and stores it in the `HelpFabContext`. When a coach files a bug report, the snapshot is attached automatically — giving developers an accurate picture of app state at the moment of the report without requiring the coach to describe it manually.

**Transport chain:**

```
Screen component (useMemo) → HelpFabContext.debugContext → BugReport modal → GitHub Issue body
```

**Format:** Plain text, `key: value` pairs, framed with a `--- Title ---` header and `-----------------------------------` footer. Nested `Record<string, number>` values are serialized inline as `key1=N, key2=N`.

---

## 2. Architecture

Every wired screen uses the same three-component pattern:

### Pattern

```typescript
// 1. Build the typed context object — recomputes only when dependencies change
const myDebugContext = useMemo((): MyDebugContext => ({
  someCount: items.length,
  isLoading: loading,
  // ... other fields
}), [items, loading]);

// 2. Format the context into a human-readable snapshot string
const myDebugSnapshot = useMemo(
  () => buildFlatDebugSnapshot('My Screen Debug Snapshot', myDebugContext),
  [myDebugContext]
);

// 3. Register/clear the snapshot in HelpFabContext — SEPARATE useEffect
useEffect(() => {
  setDebugContext(myDebugSnapshot);
  return () => setDebugContext(null);
}, [myDebugSnapshot, setDebugContext]);
```

### Rules

- The `setDebugContext` effect **must be a standalone `useEffect`**, separate from the `setHelpContext` effect. Never merge them.
- The `setHelpContext` effect clears on unmount with `return () => setHelpContext(null)`. The debug effect does the same with `setDebugContext(null)`.
- `useMemo` ensures snapshot strings are only recomputed when underlying data changes — not on every render.

### Context and Utility Files

| File | Purpose |
|------|---------|
| `src/contexts/HelpFabContext.tsx` | Holds `debugContext: string \| null` and `setDebugContext` |
| `src/utils/debugUtils.ts` | `buildFlatDebugSnapshot` — generic flat formatter |
| `src/utils/gamePlannerDebugUtils.ts` | `buildDebugSnapshot` — custom formatter for GamePlanner (richer player/rotation detail) |
| `src/types/debug.ts` | All `*DebugContext` TypeScript interfaces |

---

## 3. Privacy Rules

These rules apply to all debug context fields. Violations must be fixed before merge.

| Data Class | Rule |
|------------|------|
| Player full names | **NEVER** include |
| Player jersey numbers | OK to include (no PII) |
| User UUIDs (Cognito sub) | Truncate to first 8 characters if included |
| Email — local-part (before @) | **NEVER** include |
| Email — domain (after @) | OK; use `emailDomain` pattern |
| Opponent team names | OK (coach-entered, not PII) |
| Game scores | OK (coach-entered) |
| Birth years — individual | **NEVER** include individual player birth years |
| Birth years — aggregate count | OK (e.g., `birthYearFilterCount: 2`) |
| Team names | OK (coach-entered) |
| Formation names | OK (coach-entered) |
| Record counts | OK |

---

## 4. Per-Screen Debug Contexts

### 4.1 Home

- **Interface:** `HomeDebugContext`
- **Utility:** `buildFlatDebugSnapshot`
- **File:** `src/components/Home.tsx`

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `teamCount` | `number` | Teams loaded for this coach |
| `gameCount` | `number` | Total games across all teams |
| `scheduledCount` | `number` | Games with `status === 'scheduled'` or no status |
| `inProgressCount` | `number` | Games with `status === 'in-progress'` or `'halftime'` |
| `completedCount` | `number` | Games with `status === 'completed'` |
| `isCreatingGame` | `boolean` | Whether the create-game form is open |

**Example snapshot:**

```
--- Home Debug Snapshot ---
teamCount: 2
gameCount: 8
scheduledCount: 3
inProgressCount: 1
completedCount: 4
isCreatingGame: false
-----------------------------------
```

---

### 4.2 Game Management

- **Interface:** `GameManagementDebugContext`
- **Utility:** `buildFlatDebugSnapshot`
- **File:** `src/components/GameManagement/GameManagement.tsx`

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `gameIdPrefix` | `string` | First 8 chars of `game.id` |
| `status` | `string` | `scheduled \| in-progress \| halftime \| completed` |
| `currentHalf` | `number` | `1` or `2` |
| `elapsedSeconds` | `number` | Current game clock in seconds |
| `halfLengthSeconds` | `number` | Configured half length in seconds |
| `isRunning` | `boolean` | Whether the timer is running |
| `activeTab` | `GameTab` | Active tab: `field \| bench \| goals \| notes` |
| `rosterSize` | `number` | Players loaded for this team |
| `lineupCount` | `number` | Total `LineupAssignment` records |
| `starterCount` | `number` | Starters (`isStarter === true`) |
| `openPlayTimeRecordCount` | `number` | Records with no `endGameSeconds` |
| `closedPlayTimeRecordCount` | `number` | Records with `endGameSeconds` set |
| `ourScore` | `number` | Team's current score |
| `opponentScore` | `number` | Opponent's current score |
| `goalCount` | `number` | Total `Goal` records for this game |
| `gameNoteCount` | `number` | Total `GameNote` records for this game |
| `availabilityByStatus` | `Record<string, number>` | Counts by status value (e.g. `available`, `absent`) |
| `planExists` | `boolean` | Whether a `GamePlan` record exists |
| `plannedRotationCount` | `number` | Number of `PlannedRotation` records |
| `planConflictCount` | `number` | Always `0` (simplified; conflict logic is complex) |
| `substitutionQueueLength` | `number` | Pending substitutions in the queue |

**Notes:** `availabilityByStatus` is serialized as `key=N` pairs inside the snapshot.

**Example snapshot:**

```
--- Game Management Debug Snapshot ---
gameIdPrefix: a1b2c3d4
status: in-progress
currentHalf: 1
elapsedSeconds: 847
halfLengthSeconds: 1800
isRunning: true
activeTab: field
rosterSize: 12
lineupCount: 7
starterCount: 7
openPlayTimeRecordCount: 7
closedPlayTimeRecordCount: 0
ourScore: 2
opponentScore: 1
goalCount: 3
gameNoteCount: 1
availabilityByStatus: available=10, absent=2
planExists: true
plannedRotationCount: 4
planConflictCount: 0
substitutionQueueLength: 0
-----------------------------------
```

---

### 4.3 Game Planner (existing, documented for completeness)

- **Interface:** `GamePlannerDebugContext`
- **Utility:** `buildDebugSnapshot` (custom, in `src/utils/gamePlannerDebugUtils.ts`)
- **File:** `src/components/GamePlanner.tsx`

This screen uses a richer, custom formatter that lists each player's availability status, window, and preferred positions, plus a full rotation plan with substitution details. It does **not** use `buildFlatDebugSnapshot` because the nested player/rotation data requires custom formatting.

**Fields:** See `GamePlannerDebugContext` interface in `src/types/debug.ts`.

**Notes:** Player data uses jersey numbers only — never names. Preferred position names are formation-position names (not player names).

---

### 4.4 Season Report

- **Interface:** `SeasonReportDebugContext`
- **Utility:** `buildFlatDebugSnapshot`
- **File:** `src/components/SeasonReport.tsx`

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `teamIdPrefix` | `string` | First 8 chars of `team.id` |
| `teamName` | `string` | Coach-entered team name |
| `rosterSize` | `number` | `TeamRoster` records for this team |
| `totalGames` | `number` | All games for this team |
| `completedGames` | `number` | Games with `status === 'completed'` |
| `scheduledGames` | `number` | Games with `status === 'scheduled'` or no status |
| `allSynced` | `boolean` | Whether all Amplify observeQuery subscriptions are synced |
| `loading` | `boolean` | Whether Phase 2 data (play time, goals, notes) is loading |
| `playerStatsCount` | `number` | Number of computed `PlayerStats` rows (0 while loading) |
| `hasSelectedPlayer` | `boolean` | Whether a player detail panel is open |

**Notes:** Use the `loading` flag to disambiguate `playerStatsCount: 0` (loading) from `playerStatsCount: 0` (no data).

**Example snapshot:**

```
--- Season Report Debug Snapshot ---
teamIdPrefix: f9e8d7c6
teamName: Eagles U10
rosterSize: 14
totalGames: 10
completedGames: 7
scheduledGames: 3
allSynced: true
loading: false
playerStatsCount: 14
hasSelectedPlayer: false
-----------------------------------
```

---

### 4.5 Management

- **Interface:** `ManagementDebugContext`
- **Utility:** `buildFlatDebugSnapshot`
- **File:** `src/components/Management.tsx`

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `activeSection` | `string` | Active tab: `teams \| formations \| players \| sharing \| app` |
| `teamCount` | `number` | Teams loaded |
| `playerCount` | `number` | Players in global pool |
| `rosterCount` | `number` | `TeamRoster` junction records |
| `formationCount` | `number` | Formation templates |
| `formationPositionCount` | `number` | Formation positions across all formations |
| `editingTeamId` | `string \| null` | First 8 chars of the team being edited, or `null` |
| `editingFormationId` | `string \| null` | First 8 chars of the formation being edited, or `null` |
| `birthYearFilterCount` | `number` | Active birth year filter count |

**Notes:** `editingTeamId` and `editingFormationId` use the `(null)` sentinel when not editing.

**Example snapshot:**

```
--- Management Debug Snapshot ---
activeSection: players
teamCount: 2
playerCount: 24
rosterCount: 18
formationCount: 3
formationPositionCount: 22
editingTeamId: (null)
editingFormationId: (null)
birthYearFilterCount: 1
-----------------------------------
```

---

### 4.6 User Profile

- **Interface:** `UserProfileDebugContext`
- **Utility:** `buildFlatDebugSnapshot`
- **File:** `src/components/UserProfile.tsx`

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `emailDomain` | `string` | Domain part of the user's email (after `@`); `'(loading)'` if not yet fetched |
| `pendingInvitationCount` | `number` | Number of pending team invitations |
| `invitationTeamCount` | `number` | Teams fetched to display invitation names (NOT the coach's own teams) |
| `isChangingPassword` | `boolean` | Whether a password change is in flight |
| `isDeletingAccount` | `boolean` | Whether account deletion is in flight |

**Notes:** Only the domain part of the email is captured. The local-part (before `@`) is never included per privacy rules.

**Example snapshot:**

```
--- User Profile Debug Snapshot ---
emailDomain: gmail.com
pendingInvitationCount: 1
invitationTeamCount: 1
isChangingPassword: false
isDeletingAccount: false
-----------------------------------
```

---

## 5. Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Interface name | `{ScreenName}DebugContext` | `HomeDebugContext` |
| Context variable | `{camelScreen}DebugContext` | `homeDebugContext` |
| Snapshot variable | `{camelScreen}DebugSnapshot` | `homeDebugSnapshot` |
| Snapshot title | `'{Screen Name} Debug Snapshot'` | `'Home Debug Snapshot'` |
| Utility file (generic) | `src/utils/debugUtils.ts` | (shared) |
| Utility file (custom) | `src/utils/{screen}DebugUtils.ts` | `gamePlannerDebugUtils.ts` |

All interfaces are defined in `src/types/debug.ts`.

---

## 6. Testing Requirements

### `buildFlatDebugSnapshot` (in `src/utils/debugUtils.test.ts`)

Tests must cover:

- Empty entries object: only header and footer lines produced
- String value: rendered as `key: value`
- Number value: rendered as `key: N`
- Boolean `true`: rendered as `key: true`
- Boolean `false`: rendered as `key: false`
- `null` value: rendered as `key: (null)`
- `undefined` value: rendered as `key: (null)`
- `Record<string, number>` with entries: rendered as `key: k1=N, k2=N`
- `Record<string, number>` empty: rendered as `key: (none)`
- Title appears in header line
- Footer line is always `-----------------------------------`
- Multiple entries appear in insertion order

### Screen components

Screen-level wiring does not require dedicated unit tests beyond verifying the build compiles (TypeScript strict mode catches type errors). Integration behavior is verified through the existing E2E test suite.

---

## 7. Out of Scope

These screens are intentionally not wired for debug context capture:

| Screen | Reason |
|--------|--------|
| `LineupBuilder` | Sub-screen launched from GamePlanner; GamePlanner already captures all relevant state including lineup data |
| `PlayerAvailabilityGrid` | Sub-component embedded in GameManagement and GamePlanner; parent screens capture availability data |
| `InvitationManagement` | Sub-component inside Management; Management captures invitation-relevant counts |
| `LandingPage` | Unauthenticated screen; no meaningful app state to capture; bug reports require auth |
