# TeamTrack — Comprehensive Architectural Analysis

**Generated:** June 2025  
**Stack:** React 19.2 · TypeScript 5.4 · Vite 7.3 · AWS Amplify Gen2 · Vitest 4.0 · Playwright

---

## 1 · File Size Inventory (source files only, sorted largest → smallest)

### Frontend — `src/`

| Lines | File | Category |
|------:|------|----------|
| 3 312 | `App.css` | Stylesheet |
| 1 532 | `components/Management.tsx` | Component |
| 1 260 | `components/GamePlanner.tsx` | Component |
| 566 | `components/GameManagement/GameManagement.tsx` | Component |
| 527 | `components/SeasonReport.tsx` | Component |
| 487 | `services/rotationPlannerService.ts` | Service |
| 434 | `components/GameManagement/SubstitutionPanel.tsx` | Component |
| 355 | `components/GameManagement/LineupPanel.tsx` | Component |
| 351 | `components/Home.tsx` | Component |
| 313 | `components/InvitationAcceptance.tsx` | Component |
| 309 | `components/InvitationManagement.tsx` | Component |
| 260 | `components/UserProfile.tsx` | Component |
| 253 | `components/GameManagement/RotationWidget.tsx` | Component |
| 228 | `components/GameManagement/hooks/useGameSubscriptions.ts` | Hook |
| 219 | `components/GameManagement/GameTimer.tsx` | Component |
| 214 | `components/managementReducers.ts` | State Logic |
| 199 | `App.tsx` | Component |
| 195 | `components/GameManagement/GoalTracker.tsx` | Component |
| 193 | `components/LineupBuilder.tsx` | Component |
| 180 | `components/GameManagement/PlayerNotesPanel.tsx` | Component |
| 174 | `components/LandingPage.tsx` | Component |
| 154 | `utils/playTimeCalculations.ts` | Utility |
| 154 | `components/BugReport.tsx` | Component |
| 140 | `services/invitationService.ts` | Service |
| 119 | `services/substitutionService.ts` | Service |
| 114 | `index.css` | Stylesheet |
| 102 | `components/PlayerAvailabilityGrid.tsx` | Component |
| 89 | `hooks/useTeamData.ts` | Hook |
| 81 | `components/GameManagement/hooks/useGameTimer.ts` | Hook |
| 76 | `components/UpdatePrompt.tsx` | Component |
| 66 | `main.tsx` | Entry Point |
| 48 | `components/PlayerSelect.tsx` | Component |
| 34 | `components/GameManagement/GameHeader.tsx` | Component |
| 33 | `utils/validation.ts` | Utility |
| 33 | `utils/gameCalculations.ts` | Utility |
| 29 | `contexts/AvailabilityContext.tsx` | Context |
| 27 | `utils/analytics.ts` | Utility |
| 25 | `constants/gameConfig.ts` | Constants |
| 21 | `utils/gameTimeUtils.ts` | Utility |
| 19 | `constants/ui.ts` | Constants |
| 18 | `components/GameManagement/types.ts` | Types |
| 8 | `utils/lineupUtils.ts` | Utility |
| 8 | `utils/playerUtils.ts` | Utility |
| 6 | `test/setup.ts` | Test Config |
| 1 | `components/GameManagement/index.ts` | Barrel |

**Frontend Total (excluding tests): ~9 700 lines of TypeScript/TSX + 3 426 lines of CSS = ~13 100 lines**

### Test Files

| Lines | File |
|------:|------|
| 788 | `services/rotationPlannerService.test.ts` |
| 525 | `components/GamePlanner.test.ts` |
| 399 | `components/LineupBuilder.test.tsx` |
| 369 | `utils/playTimeCalculations.test.ts` |
| 274 | `components/GameManagement/GameTimer.test.tsx` |
| 265 | `components/managementReducers.test.ts` |
| 178 | `components/GameManagement/GoalTracker.test.tsx` |
| 164 | `components/GameManagement/PlayerNotesPanel.test.tsx` |
| 149 | `components/PlayerAvailabilityGrid.test.tsx` |
| 125 | `services/substitutionService.test.ts` |
| 99 | `utils/gameCalculations.test.ts` |
| 75 | `utils/validation.test.ts` |
| 75 | `components/PlayerSelect.test.tsx` |
| 62 | `components/PlayerAvailabilityGrid.test.ts` |
| 62 | `utils/gameTimeUtils.test.ts` |
| 47 | `components/GameManagement/GameHeader.test.tsx` |
| 38 | `utils/lineupUtils.test.ts` |

**Test Total: 3 694 lines across 17 files**

### Backend — `amplify/`

| Lines | File |
|------:|------|
| 320 | `data/resource.ts` (Schema — 16 DynamoDB models) |
| 186 | `functions/send-invitation-email/handler.ts` |
| 130 | `functions/get-user-invitations/handler.ts` |
| 100 | `functions/accept-invitation/handler.ts` |
| 67 | `backend.ts` |
| 50 | `seed/seed.ts` |
| 12 | `auth/resource.ts` |
| 10 | `functions/send-invitation-email/resource.ts` |

**Backend Total: ~875 lines**

---

## 2 · Component Analysis

### `generateClient<Schema>()` Instantiations — **15+ module-level singletons**

Every call creates a fresh GraphQL client at **module scope** (not inside a hook or component). Files:

| File | Context |
|------|---------|
| `App.tsx` | Game restore on mount |
| `Management.tsx` | 5× observeQuery + all CRUD |
| `GamePlanner.tsx` | Plans + rotations |
| `Home.tsx` | Games listing + creation |
| `SeasonReport.tsx` | 7× observeQuery for stats |
| `GameManagement.tsx` | Game state + lineup |
| `GoalTracker.tsx` | Goal CRUD |
| `LineupPanel.tsx` | Lineup assignments |
| `SubstitutionPanel.tsx` | Substitution execution |
| `PlayerNotesPanel.tsx` | Notes CRUD |
| `useGameSubscriptions.ts` | 7+ subscriptions |
| `useGameTimer.ts` | Timer save |
| `useTeamData.ts` | Roster/player/position load |
| `rotationPlannerService.ts` | Rotation plan CRUD |
| `substitutionService.ts` | PlayTimeRecord + LineupAssignment |
| `invitationService.ts` | Invitation workflow |
| `BugReport.tsx` | Bug report save |
| `InvitationManagement.tsx` | Invitation management |
| `InvitationAcceptance.tsx` | Invitation acceptance |
| `UserProfile.tsx` | Account operations |

> **Concern:** ~20 independent Amplify client instances exist simultaneously. While Amplify likely deduplicates internally, this is a maintenance burden — every file independently imports and calls `generateClient`. A shared singleton or hook would reduce boilerplate and centralise auth/error handling.

### `useState` / `useReducer` Counts Per Component

| Component | `useState` | `useReducer` | `useEffect` | `useRef` |
|-----------|:----------:|:------------:|:-----------:|:--------:|
| `Management.tsx` | 1 | **4** | 2 | 0 |
| `UserProfile.tsx` | 7 | 0 | 1 | 0 |
| `InvitationAcceptance.tsx` | 5 | 0 | 1 | 0 |
| `Home.tsx` | 5 | 0 | 1 | 0 |
| `GoalTracker.tsx` | 5 | 0 | 0 | 0 |
| `BugReport.tsx` | 4 | 0 | 0 | 0 |
| `InvitationManagement.tsx` | 3 | 0 | 1 | 0 |
| `GameManagement.tsx` | 3 | 0 | 1 | 0 |
| `PlayerNotesPanel.tsx` | 3 | 0 | 0 | 0 |
| `GamePlanner.tsx` | 3 | 0 | 3 | **2** |
| `SeasonReport.tsx` | 2 | 0 | 2 | 0 |
| `RotationWidget.tsx` | 2 | 0 | 0 | 0 |
| `LineupPanel.tsx` | 1 | 0 | 0 | 0 |
| `SubstitutionPanel.tsx` | 1 | 0 | 1 | 0 |
| `useGameSubscriptions.ts` | 1 | 0 | 3 | **2** |
| `useGameTimer.ts` | 0 | 0 | 1 | 0 |
| `App.tsx` | 1 | 0 | 2 | 0 |

> **Key insight:** Management.tsx uses 4 `useReducer` calls (one per entity form) via `managementReducers.ts` — a good extraction. Most other components rely on `useState` with data flowing through `observeQuery` callbacks.

### `alert()` Usage — **56 calls** (production code only)

| File | Count |
|------|:-----:|
| `Management.tsx` | **38** |
| `GamePlanner.tsx` | 11 |
| `Home.tsx` | 3 |
| `BugReport.tsx` | 2 |
| `SeasonReport.tsx` | 1 |
| `PlayerAvailabilityGrid.tsx` | 1 |

> **Critical Issue:** 56 native `alert()` calls block the main thread and cannot be styled. `Management.tsx` alone has 38 — nearly one per user action. Replace with toast notifications (e.g., `react-hot-toast`) or a modal system.

### `window.confirm()` Usage — **11 calls**

| File | Count |
|------|:-----:|
| `Management.tsx` | 4 |
| `UserProfile.tsx` | 3 |
| `InvitationManagement.tsx` | 2 |
| `GamePlanner.tsx` | 1 |
| `InvitationAcceptance.tsx` | 1 |

> Replace with a custom confirmation dialog for consistent UX and styling.

### `console.log` in Production Code — **44 statements**

| File | Count | Notes |
|------|:-----:|-------|
| `SeasonReport.tsx` | **14** | Debug logs for specific player names ("Diana Davis", "Hannah Harris") |
| `InvitationAcceptance.tsx` | **11** | Invitation flow debugging |
| `substitutionService.ts` | **10** | Step-by-step substitution logging |
| `UpdatePrompt.tsx` | 3 | PWA lifecycle events |
| `rotationPlannerService.ts` | 2 | Algorithm debugging |
| `invitationService.ts` | 3 | Invitation workflow logging |
| `Home.tsx` | 1 | "✓ Game created successfully" |

> **Action Required:** Remove all debug `console.log` calls before production. The 14 player-specific debug logs in `SeasonReport.tsx` are particularly concerning as they reference specific test user names.

---

## 3 · Data Flow: DynamoDB → UI

### Teams

```
DynamoDB [Team table]
  → AppSync GraphQL (ownersDefinedIn('coaches'))
    → Management.tsx: client.models.Team.observeQuery(…)
      → callback sets teams via setState
        → passed as props to Home.tsx, GamePlanner.tsx, SeasonReport.tsx
```

### Games

```
DynamoDB [Game table]
  → AppSync GraphQL (filtered by teamId)
    → Home.tsx: client.models.Game.observeQuery(…)
      → groups by status (active/scheduled/completed)
      → user selects game → App.tsx.setActiveGame()
        → GameManagement.tsx receives game via props
          → useGameSubscriptions.ts: 7 observeQuery subs for game data
```

### Players/Roster

```
DynamoDB [TeamRoster + Player + Position tables]
  → useTeamData.ts hook: 3 nested observeQuery subscriptions
    → Roster query → for each roster, loads Player by playerId
      → returns { rosters, players, positions }
        → consumed by GameManagement, GamePlanner, SeasonReport, etc.
```

> **N+1 Query Pattern:** `useTeamData.ts` subscribes to TeamRoster, then loops over each roster entry to load the associated Player. This creates N+1 subscription behaviour. Similarly, `UserProfile.tsx` loads team names individually for each pending invitation.

### Real-Time Subscription Architecture

The app uses Amplify's `observeQuery` extensively for real-time data:
- **Management.tsx:** 5 subscriptions (teams, players, rosters, formations, positions)
- **SeasonReport.tsx:** 7 subscriptions (rosters, players, playTimeRecords, goals, notes, games, positions)
- **useGameSubscriptions.ts:** 7+ subscriptions (game, lineup, playTimeRecords, substitutions, goals, notes, availability)
- **GamePlanner.tsx:** 3 subscriptions (gamePlan, rotations, playerAvailability)

> **Total:** ~22+ active `observeQuery` subscriptions across the app (though not all active simultaneously due to tab-based navigation).

---

## 4 · State Management

### Architecture: **No Global State — Pure Local State + Prop Drilling**

- **No React Context** used for shared data (only `AvailabilityContext.tsx` exists but is a thin pass-through)
- **No Redux, Zustand, or Jotai**
- **No React Router** — tab navigation via `activeNav` useState in `App.tsx`
- Data flows downward via props from parent components
- Each major view (Home, GamePlanner, Management, SeasonReport) independently creates its own `observeQuery` subscriptions

### State Storage Locations

| Storage | Purpose |
|---------|---------|
| React `useState/useReducer` | All UI state, form state, loaded data |
| `localStorage` | Active game ID persistence, game timer state restoration |
| DynamoDB (via AppSync) | All persistent data, real-time sync |
| URL parameters | Invitation acceptance (`?invitation=ID`) |

### Implications

- ✅ Simple mental model — data flows are traceable per-component
- ❌ Duplicate data fetching — if two tabs need the same data, they subscribe independently
- ❌ No shared cache — navigating between tabs re-fetches everything
- ❌ Prop drilling through 3-4 levels (App → GameManagement → SubstitutionPanel → props)

---

## 5 · Navigation

### Architecture: **Custom Tab-Based SPA (No Router)**

```tsx
// App.tsx
const [activeNav, setActiveNav] = useState<string>('home');

// Renders one of:
activeNav === 'home'    → <Home />
activeNav === 'reports' → <SeasonReport />
activeNav === 'manage'  → <Management />
activeNav === 'profile' → <UserProfile />
// Plus: active game overrides → <GameManagement />
```

- **4 bottom tabs:** Games (home), Reports, Manage, Profile
- **No URL routing** — all navigation is state-driven
- **No deep linking** support (except invitation URLs via query params)
- **No browser back/forward** support
- **Active game state** stored in `localStorage` for persistence across refreshes

> **Concern:** Lack of URL routing means users can't bookmark specific views, share links to games, or use browser navigation. A lightweight router (e.g., TanStack Router, React Router) would add minimal overhead.

---

## 6 · CSS Analysis

### Methodology: **Single Global CSS File + Inline `<style>` Blocks**

| File | Lines | Description |
|------|------:|-------------|
| `App.css` | **3 312** | Global stylesheet — ALL component styles |
| `index.css` | 114 | CSS custom properties + resets |
| `LandingPage.tsx` (inline) | ~130 | `<style>` tag for landing page |
| `InvitationManagement.tsx` (inline) | ~100 | `<style>` tag for invitations |
| `InvitationAcceptance.tsx` (inline) | ~60 | `<style>` tag for acceptance flow |

**Total CSS: ~3 716 lines**

### Observations

- **No CSS Modules, Tailwind, or CSS-in-JS** — everything is global class names
- **No scoping mechanism** — all 3 312 lines of `App.css` are globally scoped
- `index.css` defines 10 CSS custom properties (design tokens) used consistently:
  - `--primary-green`, `--light-green`, `--accent-green`, `--background`, `--card-background`
  - `--text-primary`, `--text-secondary`, `--border-color`, `--danger-red`, `--hover-background`
- Class naming is descriptive but not systematic (no BEM, no utility classes)
- Three components inject inline `<style>` blocks — inconsistent with the global CSS approach
- **Mobile-first design** with responsive breakpoints (visible in swipe/gesture handling)

> **Risk:** Global CSS namespace collisions. As the app grows, selector conflicts become inevitable. Consider CSS Modules (zero-runtime, Vite-native) or component-scoped styles.

---

## 7 · Testing Coverage

### Unit Tests (Vitest + Testing Library)

| Source File | Test File | Lines | Type |
|-------------|-----------|------:|------|
| `rotationPlannerService.ts` (487) | `rotationPlannerService.test.ts` | 788 | Logic: fair rotation algorithm, play time calc, validation |
| `GamePlanner.tsx` (1 260) | `GamePlanner.test.ts` | 525 | Logic: lineup/sub algorithms (extracted, not component test) |
| `LineupBuilder.tsx` (193) | `LineupBuilder.test.tsx` | 399 | Component: render, select, drag-drop, availability |
| `playTimeCalculations.ts` (154) | `playTimeCalculations.test.ts` | 369 | Logic: play time, position breakdown, formatting |
| `GameTimer.tsx` (219) | `GameTimer.test.tsx` | 274 | Component: game states, button visibility, callbacks |
| `managementReducers.ts` (214) | `managementReducers.test.ts` | 265 | Logic: all 4 reducers (player, formation, team, roster) |
| `GoalTracker.tsx` (195) | `GoalTracker.test.tsx` | 178 | Component: buttons, modal, goals list |
| `PlayerNotesPanel.tsx` (180) | `PlayerNotesPanel.test.tsx` | 164 | Component: buttons, modal, notes list |
| `PlayerAvailabilityGrid.tsx` (102) | `PlayerAvailabilityGrid.test.tsx` | 149 | Component: status cycling, API calls |
| `substitutionService.ts` (119) | `substitutionService.test.ts` | 125 | Logic: close records, execute substitution |
| `gameCalculations.ts` (33) | `gameCalculations.test.ts` | 99 | Logic: goals, assists, cards counting |
| `validation.ts` (33) | `validation.test.ts` | 75 | Logic: player number uniqueness/validity |
| `PlayerSelect.tsx` (48) | `PlayerSelect.test.tsx` | 75 | Component: render, selection, exclude |
| `PlayerAvailabilityGrid.tsx` | `PlayerAvailabilityGrid.test.ts` | 62 | Logic: helper functions (getStatusColor, etc.) |
| `gameTimeUtils.ts` (21) | `gameTimeUtils.test.ts` | 62 | Logic: time formatting |
| `GameHeader.tsx` (34) | `GameHeader.test.tsx` | 47 | Component: render, scores, callbacks |
| `lineupUtils.ts` (8) | `lineupUtils.test.ts` | 38 | Logic: isPlayerInLineup |

### Coverage Gaps — **Untested Files (with logic)**

| File | Lines | Risk | Why It Matters |
|------|------:|------|----------------|
| **`Management.tsx`** | **1 532** | 🔴 Critical | Largest file. All CRUD, 38 alerts, 4 reducers inline |
| **`GameManagement.tsx`** | **566** | 🔴 Critical | Game orchestrator, localStorage restore, state machine |
| **`SeasonReport.tsx`** | **527** | 🟡 Medium | Complex data aggregation from 7 subscriptions |
| **`SubstitutionPanel.tsx`** | **434** | 🟡 Medium | Queue system, sub execution, bench/field logic |
| **`Home.tsx`** | **351** | 🟡 Medium | Game creation, status grouping, game options |
| **`RotationWidget.tsx`** | **253** | 🟡 Medium | Countdown timer, late arrival handling |
| **`LineupPanel.tsx`** | **355** | 🟡 Medium | Position picker, lineup management |
| **`InvitationAcceptance.tsx`** | **313** | 🟡 Medium | Complex invitation flow with fallbacks |
| **`InvitationManagement.tsx`** | **309** | 🟡 Medium | Coach management, invitation sending |
| **`UserProfile.tsx`** | **260** | 🟡 Medium | Account deletion, password change |
| **`invitationService.ts`** | **140** | 🟡 Medium | Cross-cutting invitation logic |
| **`useGameSubscriptions.ts`** | **228** | 🟡 Medium | 7+ subscriptions, state restoration |
| **`useTeamData.ts`** | **89** | 🟡 Medium | Core data loading hook |
| **`App.tsx`** | **199** | 🟢 Low | Thin orchestrator |

> **Coverage Assessment:** ~4 500 of ~9 700 source lines (46%) have corresponding unit tests. The **most complex file** (`Management.tsx` at 1 532 lines) has **zero tests**. Test quality is generally high — tests are thorough and cover edge cases.

### E2E Tests (Playwright)

10 E2E spec files exist in `e2e/`:
- `auth.spec.ts`, `data-isolation.spec.ts`, `formation-management.spec.ts`
- `full-workflow.spec.ts`, `game-planner.spec.ts`, `player-management.spec.ts`
- `profile.spec.ts`, `team-management.spec.ts`, `team-sharing.spec.ts`

---

## 8 · Backend Analysis

### Schema Design (16 DynamoDB Models)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `Team` | Team definition | name, maxPlayersOnField, halfLengthMinutes, sport, gameFormat |
| `Player` | Player master record | firstName, lastName |
| `TeamRoster` | Player ↔ Team binding | teamId, playerId, playerNumber, preferredPositions, isActive |
| `Formation` | Field layout template | name, playerCount, sport |
| `Position` | Position within formation | formationId, positionName, abbreviation |
| `Game` | Game instance | teamId, opponent, gameDate, status, currentHalf, timerState |
| `GamePlan` | Pre-game rotation plan | gameId, formationId, rotationIntervalMinutes |
| `PlannedRotation` | Rotation within a plan | gamePlanId, rotationNumber, gameMinute, plannedSubstitutions (JSON) |
| `PlayerAvailability` | Pre-game availability | gameId, playerId, status |
| `LineupAssignment` | Current on-field positions | gameId, playerId, positionId |
| `PlayTimeRecord` | Time tracking | gameId, playerId, positionId, startGameSeconds, endGameSeconds |
| `Substitution` | Executed sub record | gameId, playerOutId, playerInId, positionId, gameSeconds, half |
| `Goal` | Goal event | gameId, scorerId, assistId, gameSeconds, scoredByUs |
| `GameNote` | Notes/cards/stars + **bug reports** | gameId, playerId, noteType, notes |
| `TeamInvitation` | Coach invitation | teamId, invitedEmail, status, invitedBy |
| `BugReport` | (unused — BugReport.tsx writes to GameNote) | — |

### Authorization Model

```typescript
authorization: (allow) => [allow.ownersDefinedIn('coaches')]
```

**Every model** uses `ownersDefinedIn('coaches')` — the `coaches` field (string array) on each record controls who can read/write it. This is the multi-tenancy mechanism:
- Creating a team → your userId goes into `coaches`
- Inviting a coach → their userId is appended to `coaches` on all team records
- **Implication:** Every record (games, players, goals, etc.) must have the `coaches` array populated correctly

### Lambda Functions

1. **`accept-invitation`** — Custom AppSync mutation handler
   - Uses raw DynamoDB `DocumentClient` (not Amplify client)
   - Validates invitation, adds user to team's `coaches` array
   - Updates invitation status to `accepted`

2. **`send-invitation-email`** — DynamoDB Stream trigger on `TeamInvitation` table
   - Fires on INSERT events only
   - Sends SES email with HTML template containing invitation link
   - Env vars: `APP_URL`, `SES_FROM_EMAIL`, `SES_REGION`

3. **`get-user-invitations`** — Custom AppSync query handler
   - **Uses `Scan` instead of `Query`** — scans the entire TeamInvitation table, filtered client-side by email
   - 4 fallback email resolution strategies (claims, CognitoIdentityServiceProvider, env var, requestContext)
   - Returns `debugInfo` in response (email source method) — **potential PII leak**

### Schema Concerns

- **`PlannedRotation.plannedSubstitutions` is stored as a JSON string**, requiring manual `JSON.parse()` everywhere it's consumed. Consider an embedded type.
- **Bug reports sent via SES email** — `BugReport.tsx` calls a `submitBugReport` AppSync mutation backed by a Lambda that sends a formatted email via SES. No DynamoDB storage needed.
- A `BugReport` model exists in the schema but is **not used** — `BugReport.tsx` writes to `GameNote` instead.

---

## 9 · Code Duplication

### Pattern: Repeated `generateClient<Schema>()` + `observeQuery` Boilerplate

Every component that reads data repeats this pattern:
```typescript
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
const client = generateClient<Schema>();

// In component:
useEffect(() => {
  const sub = client.models.SomeModel.observeQuery({
    filter: { teamId: { eq: teamId } },
    authMode: 'userPool',
  }).subscribe({
    next: ({ items }) => setSomeState(items),
    error: (err) => console.error(err),
  });
  return () => sub.unsubscribe();
}, [teamId]);
```

This pattern appears **22+ times** across the codebase.

### Pattern: `coaches` Array Threading

Every `create` call must include `coaches` from the parent team:
```typescript
await client.models.SomeModel.create({
  ...data,
  coaches: team.coaches,
}, { authMode: 'userPool' });
```

This is repeated across Management.tsx, GamePlanner.tsx, GoalTracker.tsx, LineupPanel.tsx, SubstitutionPanel.tsx, PlayerNotesPanel.tsx, etc. If any call omits `coaches`, that record becomes inaccessible to shared coaches.

### Pattern: Player Name Formatting

`#${roster.playerNumber} ${player.firstName} ${player.lastName}` formatting is repeated inline across 8+ components.

### Pattern: Alert-Based Error Handling

```typescript
try { ... }
catch (err) { alert('Failed to do X'); console.error(err); }
```

This pattern appears in nearly every data mutation function across the app.

---

## 10 · Security Concerns

### 🔴 High Priority

| Issue | Location | Detail |
|-------|----------|--------|
| **Debug info in API response** | `get-user-invitations/handler.ts` | Returns `debugInfo.emailSource` revealing how email was resolved |
| **Full table SCAN** | `get-user-invitations/handler.ts` | Scans entire `TeamInvitation` table instead of querying by index; could be abused for enumeration |
| **`navigator.userAgent` collection** | `BugReport.tsx` | Collects and stores user agent string in DynamoDB |
| **PII in console.log** | `SeasonReport.tsx` | Logs player names ("Diana Davis", "Hannah Harris") to browser console |
| **Invitation IDs in UI** | `InvitationManagement.tsx` | Displays raw invitation IDs and shareable links with IDs |

### 🟡 Medium Priority

| Issue | Location | Detail |
|-------|----------|--------|
| **`window.location.reload()`** | `App.tsx`, `Home.tsx` | Full page reloads after actions — can cause auth state loss |
| **No input sanitization** | `Management.tsx` | Team/player/formation names go directly to DynamoDB |
| **Missing CSRF** | General | Relies entirely on Cognito tokens; no additional CSRF protection |
| **`coaches` array trust** | Schema design | If a record's `coaches` array is corrupted, data access is lost with no recovery mechanism |
| **No rate limiting** | Lambda functions | Invitation functions have no throttling |

### 🟢 Positive Security Patterns

- Cognito authentication required for all data access
- `ownersDefinedIn('coaches')` provides per-record authorization
- SES email sending restricted to verified identities
- Lambda functions have scoped IAM policies
- TypeScript strict mode catches many type-safety issues at build time

---

## 11 · Error Handling

### Current Pattern: `try/catch → alert() → console.error()`

```
Component calls Amplify API
  → Success: setState() or alert("Success!")
  → Failure: catch(err) → alert("Failed to ...") → console.error(err)
```

### Issues

| Category | Count | Problem |
|----------|:-----:|---------|
| `alert()` for errors | ~30 | Blocks UI thread, cannot be styled, poor UX |
| `alert()` for success | ~26 | Unnecessary confirmation for routine operations |
| `console.error` without recovery | ~20 | Errors logged but no retry or fallback |
| Swallowed errors | ~5 | `catch(err) {}` with no user feedback |
| No error boundaries | 0 | A single unhandled error crashes the entire app |

### Missing

- **No React Error Boundary** — any unhandled exception kills the whole app
- **No retry logic** — failed API calls are not retried
- **No offline handling** — despite being a PWA with service worker
- **No structured error logging** — all errors go to `console.error`
- **No user-friendly error display** — only `alert()` dialogs

---

## 12 · Performance Concerns

### 🔴 Critical

| Issue | Location | Impact |
|-------|----------|--------|
| **DynamoDB SCAN** | `get-user-invitations` Lambda | Scans entire table on every invocation; scales O(n) with total invitations |
| **N+1 subscription pattern** | `useTeamData.ts` | Subscribes to roster, then individually loads each player; creates cascade of queries |
| **22+ concurrent observeQuery subscriptions** | Multiple components | WebSocket connections accumulate; SeasonReport alone holds 7 |
| **3 312-line global CSS** | `App.css` | Entire stylesheet parsed even if only one view is visible; no code-splitting |

### 🟡 Medium

| Issue | Location | Impact |
|-------|----------|--------|
| **Client-side data filtering** | `observeQuery` usage | Many queries fetch ALL records then filter by teamId/gameId client-side |
| **No React.memo** | All components | No component memoization despite deep prop trees |
| **No useMemo/useCallback** | Most components | GamePlanner.tsx has some `useMemo`, but most components recalculate on every render |
| **No virtualization** | Management.tsx lists | Player/team lists rendered fully; fine for <50 items but doesn't scale |
| **`window.location.reload()`** | `App.tsx`, `Home.tsx` | Full app re-bootstrap instead of state update |
| **No code splitting** | Single bundle | All views in one chunk; no `React.lazy()` for large views |
| **No image optimization** | Assets | PNG icons (soccer_app_192.png, soccer_app_512.png) served raw |

### 🟢 Positive Performance Patterns

| Pattern | Location |
|---------|----------|
| `useRef` for pending saves | `GamePlanner.tsx` — buffers writes to avoid excessive DB calls |
| 5-second DB save interval | `useGameTimer.ts` — throttles timer persistence |
| `observeQuery` subscriptions | Real-time updates without polling |
| `useMemo` for rotation calculations | `GamePlanner.tsx` — caches expensive computations |
| Subscription cleanup | Most `useEffect` blocks properly return `sub.unsubscribe()` |

---

## Summary: Top 10 Priorities

| # | Action | Files Affected | Effort |
|:-:|--------|---------------|:------:|
| 1 | **Split Management.tsx** (1 532 lines) into TeamManager, PlayerManager, FormationManager, RosterManager | 1 → 4+ files | Large |
| 2 | **Replace `alert()`/`confirm()`** with toast/modal system | 15+ files | Medium |
| 3 | **Remove 44 `console.log` statements** | 7 files | Small |
| 4 | **Add React Error Boundary** | App.tsx | Small |
| 5 | **Fix `getUserInvitations` Lambda** — replace Scan with Query using the existing secondary index | 1 file | Small |
| 6 | **Centralise `generateClient`** into a shared singleton | 15+ files | Medium |
| 7 | **Add unit tests for Management.tsx** | 1 new file | Large |
| 8 | **Fix BugReport to use BugReport model** instead of GameNote | 1 file | Small |
| 9 | **Introduce CSS Modules** or component-scoped CSS | All components | Large |
| 10 | **Add React Router** for deep linking and browser navigation | App.tsx + routes | Medium |
