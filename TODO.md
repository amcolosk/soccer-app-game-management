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

**File**: `src/components/GamePlanner.tsx` (lines 65-70, 186-190)

**Problem**: Player availability data passed through 3+ component levels

**Solution**: Create AvailabilityContext
```typescript
const AvailabilityContext = createContext<{
  getPlayerAvailability: (id: string) => string;
  playerAvailabilities: PlayerAvailability[];
}>(null);
```

**Steps**:
- [ ] Create AvailabilityContext in contexts/AvailabilityContext.tsx
- [ ] Wrap GamePlanner children with provider
- [ ] Convert LineupBuilder to use useContext
- [ ] Remove availability props from component signatures
- [ ] Test that availability still works

---

### 2.3 Create useAmplifyQuery Hook
**Priority**: HIGH | **Effort**: 4-5 hours | **Impact**: DRY, consistent subscriptions

**Problem**: Subscription management code duplicated across GameManagement, GamePlanner, Management

**Solution**: Extract to custom hook
```typescript
export function useAmplifyQuery<T>(
  model: string,
  filter?: Record<string, any>,
  dependencies: any[] = []
) {
  const [data, setData] = useState<T[]>([]);

  useEffect(() => {
    const sub = client.models[model].observeQuery({ filter }).subscribe({
      next: (data) => setData([...data.items]),
    });
    return () => sub.unsubscribe();
  }, dependencies);

  return data;
}
```

**Steps**:
- [ ] Create hooks/useAmplifyQuery.ts
- [ ] Implement with proper TypeScript generics
- [ ] Add error handling
- [ ] Replace subscription code in GameManagement
- [ ] Replace subscription code in GamePlanner
- [ ] Replace subscription code in Management
- [ ] Add tests for hook

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

### 3.1 Consolidate Type Definitions
**Priority**: MEDIUM | **Effort**: 3-4 hours | **Impact**: Type safety, DRY

**Problem**: Same types defined in multiple files
- `PlayerWithRoster` defined in useTeamData.ts, GameManagement.tsx, GamePlanner.tsx
- `PlannedSubstitution` defined inline multiple places

**Solution**: Create types directory
```
src/types/
  ├── domain.ts          (PlayerWithRoster, etc.)
  ├── api.ts             (GraphQL type extensions)
  └── forms.ts           (Form data types)
```

**Steps**:
- [ ] Create types/ directory structure
- [ ] Move PlayerWithRoster to types/domain.ts
- [ ] Move PlannedSubstitution to types/domain.ts
- [ ] Update imports across codebase
- [ ] Remove duplicate type definitions

---

### 3.2 Extract Duplicate Utility Functions
**Priority**: MEDIUM | **Effort**: 4-5 hours | **Impact**: Code reduction

**Duplicates Found**:
- Form reset logic (5+ occurrences in Management.tsx)
- Create/Update handler patterns (80+ duplicate lines in Management.tsx)
- Swipe/drag handlers (Management.tsx lines 696-748)

**Steps**:
- [ ] Extract resetTeamForm, resetFormationForm, resetPlayerForm functions
- [ ] Create saveTeam function combining create/update logic
- [ ] Create saveFormation function combining create/update logic
- [ ] Create hooks/useSwipeDelete.ts for swipe handling
- [ ] Replace duplicate code with extracted functions

---

### 3.3 Implement Centralized Error Handling
**Priority**: MEDIUM | **Effort**: 3-4 hours | **Impact**: Consistent UX

**Problem**: Inconsistent error handling patterns
- Some places: try/catch with generic alert
- Some places: Only console.error
- Some places: Silent failures

**Solution**: Create error handling utility
```typescript
// utils/errorHandler.ts
export const handleError = (error: any, context: string) => {
  console.error(`[${context}]`, error);

  if (error instanceof NetworkError) {
    showNotification('Network error. Please check your connection.');
  } else if (error instanceof AuthError) {
    // Handle auth
  }
};
```

**Steps**:
- [ ] Create utils/errorHandler.ts
- [ ] Define error categories
- [ ] Implement user-friendly messages
- [ ] Replace error handling in GameManagement
- [ ] Replace error handling in GamePlanner
- [ ] Replace error handling in Management
- [ ] Replace error handling in useTeamData

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

## 📈 Progress Tracking

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

### Next Up
- [ ] Eliminate prop drilling with Context (2.2)
- [ ] Create useAmplifyQuery hook (2.3)

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
