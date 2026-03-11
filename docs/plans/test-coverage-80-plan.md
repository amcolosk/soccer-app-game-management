# Unit Test Coverage Plan: 35% → 80%
## TeamTrack PWA

**Status:** Approved with Changes — All blocking/major architect issues incorporated.  
**Target:** ≥80% overall statement coverage  
**Approach:** Behavior-driven tests touching real logic; no snapshot tests, no trivial line-pumping.

---

## Executive Summary

Add ~18 new test files and expand ~8 existing ones. Prioritized:
1. Hooks (high ROI, pure/mockable logic)
2. Services (fill service gaps)
3. Utilities (small gaps)
4. Contexts / small components
5. Route wrappers (smoke tests)
6. GameManagement components (LineupPanel, SubstitutionPanel, expand GameManagement)
7. Large components (Management, GamePlanner — smoke + reducer only, but reducers already covered in `managementReducers.test.ts`)

**Key exclusions:**
- `Management.tsx` (1672 lines) — smoke test only (tab nav, helpContext lifecycle). Reducers already covered in `managementReducers.test.ts`.
- `GamePlanner.tsx` (1786 lines) — smoke test only; utility functions already tested in `GamePlanner.test.ts`.
- `useGameSubscriptions.ts` — lifecycle/teardown tests only.

**Projected outcome:** ~82% overall; utils/services/hooks at 90%+, components at 65–70%.

---

## Mocking Conventions (Apply Throughout)

- Use `vi.hoisted` + module-level `vi.mock(...)` matching the pattern in `substitutionService.test.ts`
- For Amplify: `vi.mock('aws-amplify/data', () => ({ generateClient: vi.fn(() => mockClient) }))`
- For Router: `vi.mock('react-router-dom', () => ({ useParams: ..., useNavigate: ..., useLocation: ... }))`
- For contexts: wrap provider or mock the hook directly with `vi.mock`
- For `localStorage`: use `vi.stubGlobal` or spy on `localStorage.getItem/setItem`
- Always call `renderHook` (not direct function calls) for hooks
- Always `act(async () => { ... })` for async state updates

---

## Tier 1: Hooks (High ROI)

### 1. `src/hooks/useTeamData.ts` → `src/hooks/useTeamData.test.ts` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:**  
- `vi.mock('aws-amplify/data', ...)` with `observeQuery` returning controllable `next` callbacks
- NOTE: The inner `Player.observeQuery` subscription is created *inside* the roster `next` callback. The mock must set up the Player subscription before calling the roster `next` mock — use a two-stage mock: `TeamRoster.observeQuery` calls `next` with roster items, which triggers `Player.observeQuery` to call its own `next`.

**Test Cases:**
1. Returns `{ players: [], positions: [] }` when `teamId` is null
2. Returns `{ players: [], positions: [] }` when `formationId` is null and subscribes only to roster (no position sub)
3. **When `formationId` is null, no position subscription is created and cleanup runs without error** (unmount with null formationId)
4. Subscribes to `TeamRoster` with correct `teamId` filter
5. Subscribes to `FieldPosition` with correct `formationId` filter when provided
6. Merges roster data with player data — `playerNumber` and `preferredPositions` come from roster record
7. Filters out players whose IDs are not in the roster
8. Sorts roster entries by jersey number ascending
9. Updates `players` reactively when roster subscription fires new data
10. Updates `positions` reactively when position subscription fires new data
11. Unsubscribes all subscriptions on unmount (verifies unsubscribe was called)
12. Re-subscribes when `teamId` prop changes (old sub unsubscribed, new sub created)
13. Re-subscribes when `formationId` prop changes
14. Handles empty roster (subscription fires `[]` — produces `[]` players)
15. Handles roster entries with no matching player records (those entries omitted)

---

### 2. `src/hooks/useSwipeDelete.ts` → `src/hooks/useSwipeDelete.test.ts` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:** No module-level mocks needed. Test via `renderHook` from `@testing-library/react`.

**Test Cases (all observing via `getSwipeStyle(itemId)` NOT internal state):**
1. Initial state: `swipedItemId` is null, `getSwipeStyle('any-id')` returns `translateX(0px)`
2. After `handleStart` fires for item `'a'`, `swipedItemId` equals `'a'`
3. After `handleStart` + `handleMove` (diff=50px), `getSwipeStyle('a')` returns `translateX(50px)` 
4. After `handleMove` with diff exceeding `MAX_DISTANCE_PX`, `getSwipeStyle` does NOT exceed `MAX_DISTANCE_PX` pixels (hook leaves value at previous, no clamping, but should cap visually — observe the final style value)
5. `handleMove` ignores moves in the negative direction (diff ≤ 0) — `getSwipeStyle` stays at 0
6. After `handleEnd` with swipe exceeding threshold, `getSwipeStyle('a')` returns `translateX(OPEN_WIDTH_PX px)`
7. After `handleEnd` with swipe below threshold, `getSwipeStyle('a')` returns `translateX(0px)`
8. `close()` resets `swipedItemId` to null and `getSwipeStyle('a')` returns 0
9. `getSwipeStyle` returns `0` for items other than the currently swiped one
10. `getSwipeStyle` includes a CSS `transition` when NOT actively swiping (swipeStartX === 0)
11. `getSwipeProps('a')` return value includes `onTouchStart`, `onTouchMove`, `onTouchEnd`
12. `getSwipeProps('a')` return value includes `onMouseDown`, `onMouseMove`, `onMouseUp`

---

### 3. `src/components/GameManagement/hooks/useGameTimer.ts` → `...hooks/useGameTimer.test.ts` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:**  
- `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`
- Mock `generateClient` to intercept `client.models.Game.update` and `client.models.PlannedRotation.update`
- Note `currentTime` is in the dep array — every tick causes the effect to re-run and intervals to be recreated. Test **interval creation** and **first-tick behavior**, not "fires every N seconds."

**Test Cases:**
1. Does not create interval when `isRunning` is false
2. Does not create interval when `isRunning` is true but `gameState.status` is not `'in-progress'` (e.g., `'halftime'`)
3. Creates a 1000ms interval when `isRunning=true` and `gameState.status='in-progress'`
4. Creates a 5000ms save interval when timer starts (verifies `setInterval` called with 5000ms)
5. Calling `setCurrentTime` after 1000ms increments current time by 1
6. Calls `onHalftime` when `currentTime` reaches `halfLengthSeconds` (in first half)
7. Does NOT call `onHalftime` when already triggered (`halftimeTriggeredRef` guard)
8. Does NOT call `onHalftime` when `currentHalf === 2`
9. Resets the halftime guard when `gameState.currentHalf` changes to 2
10. Calls `onEndGame` when `currentTime` reaches 7200
11. Does NOT call `onEndGame` multiple times when already triggered
12. Clears both intervals when `isRunning` becomes false
13. Clears both intervals on unmount
14. Marks `PlannedRotation` as viewed when timer reaches `rotationMinute - 1` and rotation is not yet viewed
15. Does not mark rotation as viewed if it is already viewed (`viewedAt` set)
16. Uses latest `onHalftime`/`onEndGame` via refs — updated callbacks are invoked, not stale ones

---

## Tier 2: Services

### 4. `src/services/invitationService.ts` → `src/services/invitationService.test.ts` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:** `vi.mock('aws-amplify/data', ...)` + `vi.mock('aws-amplify/auth', ...)`

**Test Cases:**
1. `sendTeamInvitation` creates invitation with correct `coaches` array and inviter info
2. `sendTeamInvitation` sets `expiresAt` to approximately +7 days from now
3. `sendTeamInvitation` lowercases the email address
4. `sendTeamInvitation` throws if the team record is not found
5. `acceptTeamInvitation` calls the `acceptInvitation` custom mutation with `invitationId`
6. `acceptTeamInvitation` throws if mutation returns an `errors` array
7. `declineTeamInvitation` updates invitation status to `'DECLINED'`
8. `revokeCoachAccess` removes the target `userId` from the team's `coaches` array
9. `revokeCoachAccess` throws if `userId` is not in the coaches array
10. `revokeCoachAccess` throws if the team is not found
11. `getUserPendingInvitations` calls the custom `getUserInvitations` query
12. `getUserPendingInvitations` returns `{ teamInvitations: [] }` when `result.data` is null
13. `getUserPendingInvitations` handles JSON parse errors gracefully (returns empty)

---

### 5. `src/services/demoDataService.ts` → `src/services/demoDataService.test.ts` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:** Mock `generateClient`, `navigator.onLine`, `localStorage` via `vi.stubGlobal`

**Test Cases:**
1. `createDemoTeam` throws when `navigator.onLine` is false
2. `createDemoTeam` returns early (no API calls) when `demoTeamId` already in localStorage
3. `createDemoTeam` calls `Team.create` without a `formationId` field (not `null`, just omitted)
4. `createDemoTeam` creates 12 players with `firstName` only (empty `lastName`)
5. `createDemoTeam` creates 12 `TeamRoster` entries with jersey numbers 1–12
6. `createDemoTeam` creates 1 scheduled game dated ~3 days in the future
7. `createDemoTeam` stores the team ID in `localStorage` under `demoTeamId`
8. `createDemoTeam` tracks analytics event
9. `createDemoTeam` cleans up partial data (calls delete) on API error
10. `removeDemoData` calls `deleteTeamCascade` with the demo team ID
11. `removeDemoData` removes `demoTeamId` from localStorage
12. `removeDemoData` tracks analytics event
13. **`removeDemoData` throws and clears localStorage when target team name is not `'Eagles Demo'`** (safety guard)

---

## Tier 3: Utilities

### 6. `src/utils/errorHandler.ts` → `src/utils/errorHandler.test.ts` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:** `vi.spyOn(console, 'error')`, mock `toast`/`showError`

**Test Cases:**
1. `handleApiError` logs the error to `console.error`
2. `handleApiError` calls `showError` with the user-readable message
3. `logError` logs the error + context prefix to `console.error`
4. `logError` does NOT call `showError`

---

### 7. `src/utils/toast.ts` — EXPAND existing tests

**Current Coverage:** 50%  
**Test Cases (ADD):**
1. `showWarning` calls `toast` with amber/orange style and 3.5s duration
2. `showInfo` calls `toast` with blue style and ~3s duration

---

### 8. `src/utils/analytics.ts` — EXPAND existing tests

**Current Coverage:** 71%  
**Test Cases (ADD):**
1. `initGA` calls `ReactGA.initialize` with the provided measurement ID
2. `trackPageView` sends correct page path
3. All exported event constants have non-empty `category` and `action` strings

---

## Tier 4: Contexts

### 9. `src/contexts/AvailabilityContext.tsx` — EXPAND tests

**Current Coverage:** 8%  
**Mocking Strategy:** Render with Testing Library provider pattern

**Test Cases (ADD):**
1. Provider exposes `availabilities` array to consumers
2. `getPlayerAvailability` returns `'available'` when no record exists for player
3. `getPlayerAvailability` returns the correct status when a record exists
4. Consumer rendered outside provider throws (or returns fallback per implementation)
5. `getPlayerAvailability` callback is stable across re-renders with same data (memoized)

---

## Tier 5: Components (Small & Testable)

### 10. `src/components/HelpFab.tsx` → `src/components/HelpFab.test.tsx` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:**  
- Mock `react-router-dom` (useNavigate)
- Mock `HelpFabContext` (provides `helpContext`, null or a key)
- Mock `OnboardingContext` (provides `expand`, `dismissed`)
- Mock child modals: `BugReport`, `HelpModal` as no-op divs
- **`vi.useFakeTimers()` required in tests covering post-close modal open flows** (300ms timeout in `closeSheet`)

**Test Cases:**
1. Renders FAB button with accessible label/icon
2. FAB click opens the bottom sheet
3. Backdrop click closes the sheet (triggers close animation)
4. Escape key closes the sheet
5. "Report a Bug" button click closes sheet, then opens BugReport modal after 300ms
6. "Get Help" button is enabled when `helpContext` is set
7. "Get Help" button is disabled (or says "Coming soon") when `helpContext` is null
8. "Get Help" click closes sheet, then opens HelpModal after 300ms
9. HelpModal renders with the `helpContext` key as prop
10. "Quick Start" button calls `expand()` from OnboardingContext and navigates to `/`
11. "Quick Start" shows completion indicator when `dismissed` is true
12. `animationend` event on the sheet fires the close callback without the 300ms fallback
13. BugReport modal receives `debugContext` prop
14. Tracks analytics event when each button is clicked
15. Sheet unmounts cleanly (no memory leak from timeout)

---

### 11. `src/components/HelpModal.tsx` — EXPAND existing tests

**Current Coverage:** 73%  
**Test Cases (ADD):**
1. Focus trap: Tab from last focusable element wraps to first
2. Focus trap: Shift+Tab from first focusable element wraps to last
3. Focus trap: handles modal with no focusable elements (no error thrown)
4. Related-screen pill click calls `onNavigate` with the correct key when provided
5. Related-screen pill click calls `onClose` when `onNavigate` is not provided

---

### 12. `src/components/Home.tsx` — EXPAND existing tests

**Current Coverage:** 23%  
**Test Cases (ADD):**
1. "No teams" empty state shown when teams array is empty
2. Games are sorted: in-progress first, then scheduled, then completed
3. Game card click navigates to `/game/:id` with game+team in state
4. "Plan" button navigates to `/game/:id/plan`
5. Create game form submits with correct team ID and scheduled date
6. Demo team indicator shown when `demoTeamId` matches current team ID
7. `handleLoadDemoData` shows error toast when `navigator.onLine` is false
8. `handleLoadDemoData` calls `createDemoTeam` service when online
9. `handleRemoveDemoData` calls `removeDemoData` service
10. `setHelpContext('home')` called on mount, cleared on unmount
11. `handleNavigateFromChecklist` routes to create-game for step `'schedule-game'`
12. Debug snapshot DOM element updates when game state changes

---

### 13. `src/components/UserProfile.tsx` — EXPAND existing tests

**Current Coverage:** 44%  
**Test Cases (ADD):**
1. Password change form shows validation error when new passwords do not match
2. Password change form shows error when new password is too short
3. `updatePassword` is called with `oldPassword` and `newPassword`
4. Success message shown after successful password change
5. Error message shown if `updatePassword` throws
6. Delete account confirmation dialog shown on button click
7. `deleteUser` called after confirmation
8. `signOut` called after account deletion
9. Pending invitations are loaded on mount (from `getUserPendingInvitations`)
10. Accept invitation calls `acceptTeamInvitation` service
11. Decline invitation calls `declineTeamInvitation` service

---

## Tier 6: Route Wrappers

All follow the same render-without-crashing + key-behavior pattern.

### 14. `src/components/routes/GameManagementRoute.tsx` → `...test.tsx` *(NEW)*

**Test Cases:**
1. Renders `<GameManagement>` immediately when `game` + `team` are in `location.state`
2. Shows loading state when no state passed and game ID exists in URL params
3. Fetches game and team by ID when `location.state` is absent
4. Renders error state when game not found (API returns null)
5. Renders error state when team not found
6. "Back to Games" button navigates to `/`
7. Does NOT fetch when both game and team are already in state (no extra API calls)

---

### 15. `src/components/routes/GamePlannerRoute.tsx` → `...test.tsx` *(NEW)*

**Test Cases:** Same pattern as #14, substituting `<GamePlanner>` as the child.

1. Renders `<GamePlanner>` immediately when state provided
2. Shows loading state when no state
3. Fetches game and team by ID
4. Error state when game not found
5. Error state when team not found
6. Back navigation
7. No extra fetch when state is present

---

### 16. `src/components/routes/SeasonReportRoute.tsx` → `...test.tsx` *(NEW)*

**Test Cases:**
1. Fetches all teams on mount
2. Auto-selects the team if only one team exists
3. Renders team selector dropdown
4. `handleTeamChange` navigates to `/reports/:teamId`
5. Renders `<SeasonReport>` with the selected team
6. Renders loading state while teams are loading
7. Error when team fetch fails

---

### 17. `src/components/routes/InvitationRoute.tsx` → `...test.tsx` *(NEW)*

**Test Cases:**
1. Renders error if `invitationId` URL param is missing
2. Renders `<InvitationAcceptance>` with correct `invitationId` prop
3. `onComplete` navigates to `/`
4. Renders `<ConfirmProvider>` wrapper (children can use `useConfirm`)
5. Renders app header with branding

---

## Tier 7: GameManagement Components

### 18. `src/components/GameManagement/LineupPanel.tsx` → `...LineupPanel.test.tsx` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:**  
- `vi.mock('../LineupBuilder', () => ({ LineupBuilder: () => <div data-testid='lineup-builder' /> }))`
- Mock `generateClient` for `LineupAssignment.create/delete`, `PlayTimeRecord.create`
- Mock `useConfirm` to resolve `true` for confirmation flows

**Test Cases:**
1. Renders `<LineupBuilder>` in scheduled mode
2. `onLineupChange` creates `LineupAssignment` records for new assignments
3. `onLineupChange` deletes `LineupAssignment` records for removed assignments
4. Renders position grid in in-progress mode
5. Shows substitution button (⇄) for each assigned player in in-progress mode
6. `handleRemoveFromLineup` deletes the `LineupAssignment`
7. `handleClearAllPositions` shows confirm dialog, then deletes all assignments on confirm
8. `handleClearAllPositions` is a no-op when confirm is cancelled
9. `handlePlayerClick` removes player from lineup if already assigned
10. `handlePlayerClick` shows position picker modal when player is not in lineup
11. `handlePlayerClick` shows warning if max starters limit is reached
12. `handleEmptyPositionClick` calls the `onSubstitute` prop callback
13. `handleAssignPosition` creates a `LineupAssignment` with correct `positionId`
14. `handleAssignPosition` creates a `PlayTimeRecord` when game status is `'in-progress'`
15. Position picker shows occupied positions as disabled
16. Available players list is hidden when `hideAvailablePlayers` prop is true
17. Shows play time indicator for players currently in a `PlayTimeRecord`
18. Halftime hint text rendered when `gameState.status` is `'halftime'`

---

### 19. `src/components/GameManagement/SubstitutionPanel.tsx` → `...SubstitutionPanel.test.tsx` *(NEW)*

**Current Coverage:** 0%  
**Mocking Strategy:**  
- Mock `generateClient`
- Mock `executeSubstitution` from `../../services/substitutionService`
- Mock `useAvailability`: `vi.mock('../../contexts/AvailabilityContext', () => ({ useAvailability: () => ({ getPlayerAvailability: vi.fn().mockReturnValue('available') }) }))`
- Mock `useConfirm`: `vi.fn().mockResolvedValue(true)` for "execute all" confirm

**Test Cases:**
1. Renders substitution queue with correct pending count
2. Queue item added when `handleQueueSubstitution` is called with a valid player/position pair
3. Shows warning when same player is already in queue
4. Shows warning when player is queued for a different position
5. Queue item removed via `handleRemoveFromQueue`
6. "Execute All" shows confirm dialog before calling `executeSubstitution`
7. "Execute All" calls `executeSubstitution` for each queued item
8. "Execute All" clears the queue after successful completion
9. Single substitution (execute one) calls `executeSubstitution` and removes item from queue
10. Immediate substitution modal opens when `substitutionRequest` prop changes
11. Substitution modal shows players with preferred positions first
12. Substitution modal excludes `absent` and `injured` players
13. Handling empty squad case (no available players) shows appropriate message
14. `handleAssignPosition` creates `LineupAssignment` for empty positions
15. `handleAssignPosition` creates `PlayTimeRecord` when game is `in-progress`
16. Tracks analytics event when substitution is executed
17. Error toast shown if `executeSubstitution` throws
18. Queue badge count shown in parent component header (passed via props)

---

### 20. `src/components/GameManagement/GameManagement.tsx` — EXPAND existing test

**Current Coverage:** 34%  
**Note:** New lifecycle tests must override `mockUseGameSubscriptions.mockReturnValue(...)` per test with the specific `gameState.status` they need, independent of the shared `defaultSubscription` constant. Do not share state between lifecycle tests.

**Test Cases (ADD):**
1. `handleStartGame` updates game status to `'in-progress'`
2. `handleStartGame` creates `PlayTimeRecord` for each player in the starting lineup
3. `handlePauseTimer` sets `lastStartTime` to null (pauses the clock)
4. `handleResumeTimer` sets `lastStartTime` to current ISO timestamp
5. `handleHalftime` closes all active play time records
6. `handleHalftime` sets game status to `'halftime'`
7. `handleStartSecondHalf` sets `currentHalf` to 2 and status to `'in-progress'`
8. `handleStartSecondHalf` creates new `PlayTimeRecord` for all current lineup players
9. `handleEndGame` closes all active play time records
10. `handleEndGame` sets game status to `'completed'`
11. Switching tabs updates the active tab (field → bench → notes → goals)
12. Rotation modal opens when the rotation button is clicked
13. Rotation modal closes via `onCloseRotationModal`
14. Mark injured flow creates a `GameNote` and updates player availability
15. Halftime guard prevents double-calling `handleHalftime`
16. End game guard prevents double-calling `handleEndGame`

---

## Tier 8: Large Components (Smoke Tests Only)

### 21. `src/components/Management.tsx` → `src/components/Management.test.tsx` *(NEW — SMOKE ONLY)*

**Current Coverage:** 0%  
**NOTE:** All reducer coverage is already in `src/components/managementReducers.test.ts`. Do NOT re-test reducers here.  
**Mocking Strategy:** Mock all Amplify queries to return empty arrays, mock router

**Test Cases (SMOKE / LIFECYCLE ONLY):**
1. Renders without crashing (with empty teams/players/formations)
2. Default section rendered on mount (Teams tab)
3. Clicking "Players" tab updates `helpContext` to `'management-players'`
4. Clicking "Formations" tab updates `helpContext` to `'management-formations'`
5. Clicking "Sharing" tab updates `helpContext` to `'management-sharing'`
6. `helpContext` is cleared on unmount

---

### 22. `src/components/GamePlanner.tsx` — EXPAND existing `GamePlanner.test.ts`

**Current Coverage:** 0% (component), utilities already fully tested  
**Mocking Strategy:** Mock Amplify, `useTeamData`, router

**Test Cases (SMOKE + KEY FLOWS):**
1. Component renders without crashing
2. Default tab shown on mount (availability or lineup depending on data)
3. `setHelpContext('game-planner')` called on mount, cleared on unmount
4. `handleSavePlan` creates a `GamePlan` record when none exists
5. `handleSavePlan` updates an existing `GamePlan` record
6. `handleGenerateRotations` calls `calculateFairRotations` service
7. "Copy Plan" button click opens the copy modal
8. Rotation timeline renders rotation cards

---

## Coverage Projection

| Area | Before | After |
|------|--------|-------|
| **Overall** | 35% | **~82%** |
| src/utils/ | 93% | 97% |
| src/services/ | 76% | 92% |
| src/contexts/ | 79% | 92% |
| src/hooks/ | 51% | 88% |
| src/components/GameManagement/ | 41% | 72% |
| src/components/ (other) | 15% | 48% |
| routes/ | 0% | 85% |

**NOTE:** `useGameSubscriptions.ts` (202 lines, 0%) is the biggest remaining cap. Lifecycle-only tests will contribute ~15%. If actual coverage is lower, overall may land at ~80% instead of 82% — still within target.

---

## Risks

1. **`useGameTimer.ts` save interval**: The `saveInterval` (5000ms) is cleared and recreated every second because `currentTime` is in the effect dep array. Tests must verify interval *creation* and *first-tick behavior*, not "fires every 5 seconds."
2. **`useGameSubscriptions.ts`**: DynamoDB real-time; lifecycle tests only.
3. **React 19 concurrent rendering**: Use `act()` for all async state updates.
4. **`useTeamData` nested subscriptions**: Inner `Player.observeQuery` is created inside the `TeamRoster.next` callback — mock setup must be two-staged.
5. **Amplify client must be mocked at module level** (`vi.hoisted` pattern).
