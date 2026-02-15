# TODO: Architectural Improvements

This document tracks architectural improvements identified during code analysis. Items are prioritized by impact and effort.

---

## 🚨 PHASE 1: Critical Issues (Weeks 1-2)

### 1.1 Fix N+1 Query Problem ✅ COMPLETED
**Priority**: CRITICAL | **Effort**: 2-3 hours | **Impact**: 10x performance improvement

**File**: `src/components/GamePlanner.tsx` (lines 138-177)

**Problem**: When copying from previous games, code makes 1 query to get games, then N additional queries (one per game) to check if each has a plan.

**Current Code**:
```typescript
const gamesWithPlans = await Promise.all(
  previousGamesResult.data.map(async (g) => {
    const planResult = await client.models.GamePlan.list({
      filter: { gameId: { eq: g.id } },
    });
    return planResult.data.length > 0 ? g : null;
  })
);
```

**Solution**: Query all GamePlans once, create a Set of gameIds, then filter locally.

---

### 1.2 Refactor GameManagement.tsx (2,279 lines) ✅ COMPLETED
**Priority**: CRITICAL | **Effort**: 16-20 hours | **Impact**: Enables testing, improves maintainability

**Solution**: Decomposed into 12 files in `src/components/GameManagement/`:
- Orchestrator (609 lines) with cross-domain handlers and shared state
- 7 sub-components: GameHeader, GameTimer, GoalTracker, PlayerNotesPanel, RotationWidget, SubstitutionPanel, LineupPanel
- 2 custom hooks: useGameSubscriptions, useGameTimer
- Shared types.ts and index.ts re-export

---

### 1.3 Add Component Tests ✅ COMPLETED
**Priority**: CRITICAL | **Effort**: 8-10 hours | **Impact**: Prevents regressions

**Completed**: 228 total tests (up from 0 component tests)
- LineupBuilder.test.tsx (24 tests)
- PlayerAvailabilityGrid.test.tsx (12 tests) + PlayerAvailabilityGrid.test.ts (13 tests)
- PlayerSelect.test.tsx (9 tests)
- GameTimer.test.tsx (22 tests)
- GoalTracker.test.tsx (13 tests)
- PlayerNotesPanel.test.tsx (13 tests)
- GameHeader.test.tsx (6 tests)

---

## 🔥 PHASE 2: High Priority Issues (Weeks 3-4)

### 2.1 Convert Management.tsx to useReducer ✅ COMPLETED
**Priority**: HIGH | **Effort**: 6-8 hours | **Impact**: Cleaner state management

**File**: `src/components/Management.tsx` (lines 18-69)

**Problem**: 40 individual useState calls for form state makes it hard to reset forms and manage related state.

**Solution**: Created `src/components/managementReducers.ts` with 4 focused reducers:
- `playerFormReducer` (4 fields) — firstName, lastName, isCreating, editing
- `formationFormReducer` (6 fields) — name, playerCount, sport, positions, isCreating, editing
- `teamFormReducer` (9 fields) — name, maxPlayers, halfLength, sport, gameFormat, selectedFormation, expandedTeamId, isCreating, editing
- `rosterFormReducer` (7 fields) — playerNumber, selectedPlayer, preferredPositions, editFirstName, editLastName, isAdding, editing

**Result**: 40 useState → 4 useReducer + 14 useState (65% reduction). Duplicate reset patterns eliminated. 27 unit tests for reducers.

---

### 2.2 Eliminate Prop Drilling with Context ✅ COMPLETED
**Priority**: HIGH | **Effort**: 4-6 hours | **Impact**: Cleaner component tree

**Problem**: `getPlayerAvailability` drilled through 8 components across two parallel flows (GamePlanner and GameManagement), up to 3 levels deep.

**Solution**: Created `src/contexts/AvailabilityContext.tsx` with `AvailabilityProvider` and `useAvailability` hook.

**Changes**:
- Created context with `useCallback`/`useMemo` for stable references
- Updated 8 consumer components to use `useAvailability()` hook instead of props
- Both parent components (GameManagement, GamePlanner) wrap children with `<AvailabilityProvider>`
- Updated 3 test files to mock `useAvailability` instead of passing props
- Removed unused `PlayerAvailability` type import and `playerAvailabilities` prop from RotationWidget

---

### 2.3 Create useAmplifyQuery Hook ✅ COMPLETED
**Priority**: HIGH | **Effort**: 4-5 hours | **Impact**: DRY, consistent subscriptions

**Problem**: Subscription management code duplicated across GameManagement, GamePlanner, Management, Home, SeasonReport, InvitationManagement

**Solution**: Created `src/hooks/useAmplifyQuery.ts` — reusable hook with TypeScript generics, filter memoization via deps array, sort via ref (no re-subscription), and isSynced tracking.

**Result**: 17 observeQuery subscriptions replaced across 6 files. Also fixed a subscription leak bug in Home.tsx. 12 new unit tests. 291 total tests passing.

---

### 2.4 Add useMemo to Expensive Computations ✅ COMPLETED
**Priority**: HIGH | **Effort**: 2-3 hours | **Impact**: Performance improvement

**Files**:
- `src/components/GamePlanner.tsx` (lines 686-696, 699-713)

**Problem**: Expensive calculations run on every render

**To Memoize**:
- [ ] `calculatePlayTime` result (line 686-696)
- [ ] `startingLineupPlayers` filter (line 699-705)
- [ ] `rotationPlayers` filter (line 707-713)
- [ ] `getLineupAtRotation` cache (lines 650-682)

---

## 📊 PHASE 3: Medium Priority Issues (Weeks 5-6)

### 3.1 Consolidate Type Definitions ✅ COMPLETED
**Priority**: MEDIUM | **Effort**: 3-4 hours | **Impact**: Type safety, DRY

**Problem**: Same `type X = Schema["X"]["type"]` pattern repeated ~45 times across 22 files. `PlayerWithRoster` defined in 5 locations. `PlannedSubstitution` defined in 3 locations.

**Solution**: Created `src/types/schema.ts` as single source of truth with all 16 Schema type aliases + `PlayerWithRoster` and `PlannedSubstitution` domain interfaces. Updated 19 consumer files (15 source + 4 test) to import from the central file.

**Key decisions**:
- `src/components/GameManagement/types.ts` and `src/hooks/useTeamData.ts` re-export from `schema.ts` for backward compatibility
- `LineupBuilder.tsx` and `PlayerAvailabilityGrid.tsx` local interfaces left unchanged (intentionally minimal component-scoped contracts)
- `useAmplifyQuery.ts` left unchanged (uses `Schema[M]["type"]` generically)

---

### 3.2 Extract Duplicate Utility Functions ✅ COMPLETED
**Priority**: MEDIUM | **Effort**: 4-5 hours | **Impact**: Code reduction

**Problem**: Duplicate patterns across Management.tsx — swipe handlers (touch+mouse), delete confirmation, team/formation validation, formation template resolution, and position creation.

**Solution**:
- Created `src/hooks/useSwipeDelete.ts` — consolidated 3 state vars + 7 handler functions into reusable hook with `getSwipeProps()` and `getSwipeStyle()` API
- Extracted `confirmAndDelete()` helper — replaced 4 identical delete handlers (team, player, formation, roster removal)
- Extracted `validateTeamForm()` + `resolveFormationId()` — shared by team create/update handlers
- Extracted `validateFormationForm()` + `createFormationPositions()` — shared by formation create/update handlers

**Result**: ~150 lines removed from Management.tsx. Bundle size reduced ~1.7KB.

---

### 3.3 Implement Centralized Error Handling ✅ COMPLETED
**Priority**: MEDIUM | **Effort**: 3-4 hours | **Impact**: Consistent UX

**Problem**: 63 `console.error` calls but only 40 `showError` calls — ~23 locations where errors are logged but the user sees nothing. CRUD operations mostly showed toasts, but data loading, auto-saves, and auth operations failed silently.

**Solution**: Created `src/utils/errorHandler.ts` with two functions:
- `handleApiError(error, userMessage)` — logs + shows toast. For operations where user should know something failed.
- `logError(context, error)` — logs only. For non-critical failures (auth init, localStorage restore, JSON parse fallbacks).

**Result**: 5 previously silent failures now show user-visible toasts (auto-save lineup, save timer, sync lineup, load game data, load teams). ~30 catch blocks simplified from 2-line `console.error` + `showError` to single-line `handleApiError`. Unused `showError` imports cleaned from 8 files. 15 files updated across the codebase.

---

### 3.4 Extract Magic Numbers to Constants ✅ COMPLETED
**Priority**: MEDIUM | **Effort**: 2-3 hours | **Impact**: Readability

**Magic Numbers Found**:
- GamePlanner.tsx: `100` (setTimeout delay), `"center"` (scroll behavior)
- Management.tsx: `50` (swipe threshold), `80` (swipe width), `100` (max distance)
- Multiple files: Default half length `30`, default max players `7`

**Solution**: Create constants file
```typescript
// constants/gameConfig.ts
export const GAME_CONFIG = {
  DEFAULT_HALF_LENGTH_MINUTES: 30,
  DEFAULT_MAX_PLAYERS: 7,
  ROTATION_SCROLL_DELAY_MS: 100,
  SWIPE_THRESHOLD_PX: 50,
  SWIPE_OPEN_WIDTH_PX: 80,
  SWIPE_MAX_DISTANCE_PX: 100,
};
```

**Steps**:
- [ ] Create constants/gameConfig.ts
- [ ] Extract game-related constants
- [ ] Create constants/ui.ts for UI-related constants
- [ ] Replace magic numbers in GamePlanner
- [ ] Replace magic numbers in Management
- [ ] Replace magic numbers in other components

---

## 🔧 PHASE 4: Quality Improvements (Ongoing)

### 4.1 Remove Unused Code
**Priority**: MEDIUM | **Effort**: 1-2 hours | **Impact**: Cleaner codebase

**Steps**:
- [ ] Run `npm run knip` to identify unused exports
- [ ] Review and confirm items are truly unused
- [ ] Run `npm run knip:fix` to auto-remove
- [ ] Manually remove identified dead code
- [ ] Test that nothing breaks

---

### 4.2 Add Integration/E2E Tests
**Priority**: MEDIUM | **Effort**: 10-12 hours | **Impact**: Confidence in flows

**Critical Flows to Test**:
- [ ] Game creation → planning → execution → completion
- [ ] Team setup → adding players → creating games
- [ ] Rotation planning → viewing during game
- [ ] Substitution → play time calculation

**Framework**: Playwright (already configured)

---

### 4.3 Improve TypeScript Strictness
**Priority**: LOW | **Effort**: 6-8 hours | **Impact**: Type safety

**Steps**:
- [ ] Enable stricter compiler options in tsconfig.json
  - `noImplicitAny: true`
  - `strictNullChecks: true`
  - `strictFunctionTypes: true`
- [ ] Fix resulting type errors
- [ ] Replace `any` types with proper types
- [ ] Add generic constraints where needed

---

### 4.4 Add List Virtualization
**Priority**: LOW | **Effort**: 4-5 hours | **Impact**: Performance for large lists

**Files**: Management.tsx (roster lists, player lists)

**Solution**: Use react-window or react-virtual

**Steps**:
- [ ] Install react-window
- [ ] Add virtualization to player list
- [ ] Add virtualization to roster list
- [ ] Test with large datasets

---

### 4.5 Fix Over-Fetching in useTeamData ✅ COMPLETED
**Priority**: MEDIUM | **Effort**: 2-3 hours | **Impact**: Performance, bandwidth

**File**: `src/hooks/useTeamData.ts` (lines 44-63)

**Problem**: Loads ALL players globally, then filters (O(n*m) complexity)

**Solution**: Filter at query level
```typescript
const rosterPlayerIds = rosters.map(r => r.playerId);
playerSub = client.models.Player.observeQuery({
  filter: { id: { in: rosterPlayerIds } }
}).subscribe({...});
```

---

### 4.6 Replace Console Logs with Logger
**Priority**: LOW | **Effort**: 2-3 hours | **Impact**: Professional logging

**Problem**: Debug console.logs left in production code

**Solution**: Create logger utility
```typescript
// utils/logger.ts
export const logger = {
  debug: (msg: string, data?: any) => {
    if (isDevelopment) console.log(`[DEBUG] ${msg}`, data);
  },
  error: (msg: string, error?: any) => console.error(`[ERROR] ${msg}`, error),
  info: (msg: string, data?: any) => console.info(`[INFO] ${msg}`, data),
};
```

**Steps**:
- [ ] Create utils/logger.ts
- [ ] Replace console.log calls in App.tsx
- [ ] Replace console.log calls in Home.tsx
- [ ] Replace console.log calls in GameManagement.tsx
- [ ] Replace console.log calls in other components

---

## � PHASE 5: Architecture (Performance & UX)

### 5.1 Add React Router + Code Splitting
**Priority**: HIGH | **Effort**: 6-8 hours | **Impact**: Back/forward navigation, deep linking, lazy loading

**Problem**: `App.tsx` uses `useState<NavigationTab>` with conditional rendering instead of a router.
- No browser back/forward — pressing back exits the installed PWA entirely
- No deep linking — coaches can't share URLs to specific games
- No code splitting — the entire app (1,000 KB) is bundled and loaded upfront
- `activeGame` localStorage hack needed to restore state across refreshes

**Library**: `react-router-dom` v7 (React 19 compatible, standard for Vite+React PWA)

**Route structure**:
| Current state | URL | Component |
|---|---|---|
| `activeNav='home'` | `/` | `Home` |
| `selectedGame` set | `/game/:gameId` | `GameManagement` |
| `planningGame` set | `/game/:gameId/plan` | `GamePlanner` |
| `activeNav='reports'` | `/reports/:teamId` | `SeasonReport` |
| `activeNav='manage'` | `/manage` | `Management` |
| `activeNav='profile'` | `/profile` | `UserProfile` |
| `invitationId` param | `/invite/:invitationId` | `InvitationAcceptance` |

**Key design decision — `location.state` for instant navigation**:

Route wrapper components for `/game/:gameId`, `/game/:gameId/plan`, and `/reports/:teamId` use a two-tier loading strategy:
1. **From in-app navigation**: `navigate('/game/abc', { state: { game, team } })` passes the already-loaded objects via router state → component renders instantly, no fetch, no spinner
2. **From direct URL** (bookmark, shared link, refresh): Route wrapper reads `:gameId` from `useParams()`, fetches Game + Team from DynamoDB, shows loading state

This avoids the data-fetching regression where clicking a game in Home would need to re-fetch data it already had.

**Steps**:
- [x] Install `react-router-dom`
- [x] Create `src/components/AppLayout.tsx` — shared shell (header, bottom nav with `<NavLink>`, `<Outlet>`, `<Toaster>`, `<Suspense>` fallback)
- [x] Create route wrapper components (`src/components/routes/GameManagementRoute.tsx`, `GamePlannerRoute.tsx`, `SeasonReportRoute.tsx`) — read `location.state` first, fetch by param ID as fallback
- [x] Rewrite `src/App.tsx` — replace state machine with `<BrowserRouter>` + `<Routes>`
- [x] Update `Home.tsx` — remove `onGameSelect`/`onPlanGame` props, use `useNavigate()` with state
- [x] Update `GameManagement.tsx` — remove `activeGame` localStorage persistence
- [x] Update `GamePlanner.tsx` — `onBack` kept (passed from route wrapper)
- [x] Update invitation flow — `/invite/:invitationId` route, `useParams()` instead of `URLSearchParams`
- [x] Add `React.lazy()` for large components (Management, UserProfile, SeasonReportRoute)
- [x] Update `vite.config.ts` — widen `navigateFallbackAllowlist` to `[/^\/(?!api\/).*/]`
- [x] Update analytics — `trackPageView` in `AppLayout` via `useLocation()` listener
- [x] Update `e2e/team-sharing.spec.ts` — `/?invitationId=xxx` → `/invite/xxx`
- [x] Verify `npm run build` shows multiple chunks (UserProfile 6.6KB, SeasonReport 13.3KB, Management 43.4KB)
- [x] Verify all 291 tests pass

**Files changed**:
| File | Change |
|---|---|
| `package.json` | Add `react-router-dom` |
| `src/components/AppLayout.tsx` | **NEW** — shared shell with `<Outlet>` |
| `src/components/routes/GameManagementRoute.tsx` | **NEW** — state-first param loader |
| `src/components/routes/GamePlannerRoute.tsx` | **NEW** — state-first param loader |
| `src/components/routes/SeasonReportRoute.tsx` | **NEW** — state-first param loader |
| `src/App.tsx` | Replace state machine with `<BrowserRouter>` + `<Routes>` |
| `src/components/Home.tsx` | Remove nav callback props, use `useNavigate()` |
| `src/components/GameManagement/GameManagement.tsx` | Remove `onBack` + localStorage, use `useNavigate()` |
| `src/components/GamePlanner.tsx` | Remove `onBack`, use `useNavigate()` |
| `src/components/InvitationAcceptance.tsx` | `useParams()` instead of URLSearchParams |
| `src/components/InvitationManagement.tsx` | Update invitation link format |
| `vite.config.ts` | Widen PWA `navigateFallbackAllowlist` |
| `e2e/team-sharing.spec.ts` | Update invitation URL pattern |

**NOT changed**: `main.tsx` (Authenticator.Provider stays), `Management.tsx` (no nav props), `UserProfile.tsx` (no nav props), `BugReport.tsx` (`window.location.href` for report data is fine)

**PWA considerations**:
- Code splitting improves parse/execute time but not download time (service worker precaches all chunks via `globPatterns`)
- `navigateFallback: 'index.html'` already set — all routes fall through to SPA entry point
- `navigateFallbackAllowlist` must be widened from `[/^\/(?:\?.*)?$/]` to allow new route paths

---

## �📈 Progress Tracking

### Completed
- [x] Architectural analysis
- [x] TODO.md creation
- [x] N+1 query fix (GamePlanner.tsx)
- [x] Run knip (no unused code found)
- [x] Extract magic numbers to constants
- [x] Add useMemo to expensive computations
- [x] Fix over-fetching in useTeamData
- [x] Refactor GameManagement.tsx into sub-components (1.2)
- [x] Add component tests — 228 total tests (1.3)
- [x] Convert Management.tsx to useReducer — 4 reducers, 27 tests (2.1)
- [x] Eliminate prop drilling with AvailabilityContext — 8 components, 3 test files updated (2.2)
- [x] Create useAmplifyQuery hook — 17 subscriptions replaced across 6 files, fixed Home.tsx leak, 12 new tests (2.3)

- [x] Consolidate type definitions — `src/types/schema.ts` with 16 Schema types + 2 domain interfaces, 19 files updated (3.1)

- [x] Extract duplicate utility functions — useSwipeDelete hook, confirmAndDelete, team/formation validation helpers (3.2)
- [x] Implement centralized error handling — `handleApiError` + `logError`, 15 files updated, 5 silent failures fixed (3.3)
- [x] Add React Router + code splitting — `react-router-dom` v7, 4 route wrappers, `location.state` for instant nav, lazy-loaded routes, `navigateFallbackAllowlist` widened, 291 tests passing (5.1)

### Next Up
- [ ] (no items — consider Phase 4: Testing gaps or Phase 5 remaining items)

---

## 📝 Notes

- **Testing Strategy**: Add tests BEFORE major refactors to ensure behavior doesn't change
- **Incremental Approach**: Each phase can be completed independently
- **Branch Strategy**: Consider creating feature branches for large refactors (Phase 1.2)
- **Review Points**: After each phase, review impact and adjust priorities

---

## 🎯 Quick Wins (Can Do Today)

These are low-risk, high-impact items that can be completed quickly:

1. ✅ **Fix N+1 Query** - 2 hours, 10x speedup (STARTING NOW)
2. **Run knip** - `npm run knip` to find unused exports (30 min)
3. **Extract constants** - Move magic numbers to constants file (2 hours)
4. **Add useMemo** - Wrap expensive calculations (1 hour)
5. **Fix over-fetching** - Filter queries at source (2 hours)

---

*Generated from architectural analysis on 2026-02-12*
