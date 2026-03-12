# Implementation Plan: PWA Reliability
### Issues #31 (Background Timer) + #35 (Offline Game Management)

**Branch:** `feature/pwa-reliability`  
**Spec:** `docs/specs/Game-Management-Spec.md`

---

## 1. Overview

Two related problems that share a combined solution:

- **#31** — iOS Safari freezes `setInterval` when the PWA is backgrounded. The timer drifts because it accumulates ticks rather than deriving time from the wall clock.
- **#35** — All Amplify mutations fail when offline. No queuing, no retry — game events are silently lost.

### Solution Architecture

1. **Wall-clock derived timer**: Replace the 1-second accumulator in `useGameTimer.ts` with a formula that computes elapsed time from `Date.now()` on every 500ms UI refresh tick. Backgrounding becomes transparent — the formula self-corrects on foreground.
2. **Offline mutation queue**: Route all live-game write calls through a new `useOfflineMutations` hook. When offline, mutations are serialized to IndexedDB. On reconnect, they drain in order against the live API.

---

## 2. Dependency Changes

### `package.json`

Add one explicit dependency:

```json
"idb": "^8.0.0"
```

`idb` is **not** in `package.json` and is not available in application code (Workbox bundles its own copy internally). Install it explicitly: `npm install idb`.

---

## 3. New Files

### 3.1 `src/services/offlineQueueService.ts`

IndexedDB-backed mutation queue. **No React dependency — pure async functions.**

```typescript
// Database: 'teamtrack-offline', version 1
// Object store: 'pending-mutations' (keyPath: 'id')

export interface QueuedMutation {
  id: string;               // crypto.randomUUID()
  model: string;            // 'Game' | 'Goal' | 'PlayTimeRecord' etc.
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  enqueuedAt: number;       // Date.now()
  retryCount: number;       // starts at 0
}

// Opens/reuses the database connection
async function getDB(): Promise<IDBPDatabase>

// Appends a mutation to the queue
export async function enqueue(item: Omit<QueuedMutation, 'id' | 'enqueuedAt' | 'retryCount'>): Promise<void>

// Returns all queued mutations in enqueue order, then clears the store
export async function dequeueAll(): Promise<QueuedMutation[]>

// Re-inserts failed items (increments retryCount)
export async function requeueFailed(items: QueuedMutation[]): Promise<void>

// Returns count of pending mutations (for banner display)
export async function pendingCount(): Promise<number>

// Collapses multiple Game.update entries for the same gameId into one (latest wins).
// Called before draining to avoid replaying hundreds of 5-second timer-sync writes.
export async function deduplicateGameUpdates(): Promise<void>
```

**Deduplication logic for `Game.update`:**  
Scan the `pending-mutations` store; for each unique `gameId` in `Game.update` entries, keep only the item with the highest `enqueuedAt` value and delete the rest.

---

### 3.2 `src/hooks/useNetworkStatus.ts`

```typescript
interface UseNetworkStatusOptions {
  onReconnect?: () => void;
}

export function useNetworkStatus(options?: UseNetworkStatusOptions): {
  isOnline: boolean;
}
```

**Implementation notes:**
- Initial state from `navigator.onLine`
- Listens to `window` `'online'` / `'offline'` events
- Calls `options.onReconnect()` when transitioning from offline → online

---

### 3.3 `src/hooks/useOfflineMutations.ts`

Central offline-aware mutation wrapper. **All child components that currently call `client.models.*` directly are refactored to use these functions instead.**

**Fix #3 (Architect): Use specific payload types for each mutation function, not `Record<string, unknown>`.** Define an input type per mutation using the Amplify schema types so callers retain compile-time safety:

```typescript
import type { Schema } from '../../../amplify/data/resource';

// Derive input shapes from the Amplify-generated schema
type GameUpdateInput       = Partial<Schema['Game']['type']>;
type PlayTimeRecordInput   = Omit<Schema['PlayTimeRecord']['type'], 'id' | 'createdAt' | 'updatedAt'>;
type SubstitutionInput     = Omit<Schema['Substitution']['type'], 'id' | 'createdAt' | 'updatedAt'>;
type LineupAssignmentInput = Omit<Schema['LineupAssignment']['type'], 'id' | 'createdAt' | 'updatedAt'>;
type GoalInput             = Omit<Schema['Goal']['type'], 'id' | 'createdAt' | 'updatedAt'>;
type GameNoteInput         = Omit<Schema['GameNote']['type'], 'id' | 'createdAt' | 'updatedAt'>;

export interface GameMutationInput {
  updateGame:              (id: string, fields: GameUpdateInput) => Promise<void>;
  createPlayTimeRecord:    (fields: PlayTimeRecordInput) => Promise<void>;
  updatePlayTimeRecord:    (id: string, fields: Partial<PlayTimeRecordInput>) => Promise<void>;
  createSubstitution:      (fields: SubstitutionInput) => Promise<void>;
  createLineupAssignment:  (fields: LineupAssignmentInput) => Promise<void>;
  deleteLineupAssignment:  (id: string) => Promise<void>;
  updateLineupAssignment:  (id: string, fields: Partial<LineupAssignmentInput>) => Promise<void>;
  createGoal:              (fields: GoalInput) => Promise<void>;
  createGameNote:          (fields: GameNoteInput) => Promise<void>;
}
```

For serialization into `QueuedMutation.payload` (IndexedDB), cast to `Record<string, unknown>` only at the storage boundary inside `offlineQueueService.enqueue()`, not in the public interface.

**Fix #4 (Architect): `useOfflineMutations` creates its own Amplify client internally** (consistent with every other file in the codebase). It does not accept `client` as a parameter.

**Fix #1 (Architect): `useOfflineMutations` owns the full reconnect/drain lifecycle.** It uses `useNetworkStatus` internally and manages `isSyncing` state internally. The hook returns `{ mutations, isOnline, pendingCount, isSyncing }` — callers do not need to wire their own `onReconnect` callbacks for draining.

```typescript
export function useOfflineMutations(): {
  mutations: GameMutationInput;
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
}
```

Internal `useEffect` on `isOnline` transition (false → true) triggers the drain:

```typescript
useEffect(() => {
  if (isOnline && hadBeenOfflineRef.current) {
    void drainQueue();
  }
  hadBeenOfflineRef.current = !isOnline;
}, [isOnline]);
```

**Runtime routing strategy:**
- **Online**: call `client.models.[Model].[operation]()` directly; errors surface via `handleApiError` toast (unchanged)
- **Offline**: serialize to `offlineQueueService.enqueue()`; call `setPendingCount(await pendingCount())` to update badge; return immediately

**Drain sequence (`drainQueue()` — internal async function):**
1. `setIsSyncing(true)`
2. Call `fetchAuthSession({ forceRefresh: true })` — refreshes Cognito JWT before replaying
3. If token refresh fails → `showWarning('Please reconnect and refresh to sync changes')`; `setIsSyncing(false)`; stop — do NOT clear queue
4. Call `offlineQueueService.deduplicateGameUpdates()`
5. Call `offlineQueueService.dequeueAll()`
6. Execute mutations sequentially in order (not in parallel — order matters for substitutions)
7. On any individual failure → `requeueFailed([item])` for that item, continue rest
8. `setPendingCount(0)`, `setIsSyncing(false)`

---

### 3.4 `src/components/OfflineBanner.tsx`

Displayed inside the game management layout, between `CommandBand` and tab content. Only visible during active games when offline or draining.

```typescript
interface OfflineBannerProps {
  isOnline: boolean;
  pendingCount: number;    // from offlineQueueService.pendingCount()
  isSyncing: boolean;      // true during reconnect drain
}

export function OfflineBanner({ isOnline, pendingCount, isSyncing }: OfflineBannerProps)
```

**Display states:**

| Condition | Text |
|-----------|------|
| `!isOnline && pendingCount === 0` | "You're offline" |
| `!isOnline && pendingCount > 0` | "You're offline — {N} changes saved locally" |
| `isOnline && isSyncing` | "Syncing {N} changes…" |
| `isOnline && !isSyncing` | Hidden (renders null) |

**Styling:** Amber/warning background, full-width, compact single-line. CSS class `.offline-banner`. z-index: 195 (between `.game-tab-nav` 190 and `.command-band` 200 — the banner scrolls with content, not sticky).

---

## 4. Modified Files

### 4.1 `src/components/GameManagement/hooks/useGameTimer.ts`

**What changes:** Replace the 1s accumulator `setInterval` with a 500ms formula-based refresh.

**What stays the same:** All external call sites, the hook's parameter interface, halftime guard logic, rotation notification logic, 5s DynamoDB sync.

#### Changed internal logic

**Old:** `setInterval(() => setCurrentTime(prev => prev + 1), 1000)`  
**New:** 500ms interval that derives time from wall clock anchored at the moment `isRunning` last became `true`.

Add two internal refs (no new params):
```typescript
const startMsRef   = useRef<number | null>(null);  // Date.now() at last timer start
const startElapsedRef = useRef<number>(0);         // currentTime at last timer start
```

Add an effect to capture the anchor whenever `isRunning` transitions:
```typescript
useEffect(() => {
  if (isRunning) {
    startMsRef.current = Date.now();
    startElapsedRef.current = currentTime;  // closed over from same render
  } else {
    startMsRef.current = null;
  }
  // Fix #5 (Architect): currentTime is intentionally excluded from the dep array.
  // We only want to capture the anchor value when isRunning TRANSITIONS to true,
  // using the currentTime from that exact same render batch (e.g. the paused value
  // on resume, or resumeTime on second-half start). Adding currentTime to deps would
  // re-anchor every tick, defeating the purpose of the formula.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isRunning]);
```

Replace the main timer `useEffect`:
```typescript
useEffect(() => {
  if (!isRunning || gameState.status !== 'in-progress') return;

  const interval = setInterval(() => {
    if (!startMsRef.current) return;

    const derived = startElapsedRef.current +
      Math.floor((Date.now() - startMsRef.current) / 1000);

    setCurrentTime(derived);

    // Rotation notification (unchanged logic, uses derived instead of prev+1)
    if (gamePlan && plannedRotations.length > 0) {
      const currentMinutes = Math.floor(derived / 60);
      const nextRotation = plannedRotations.find(r =>
        r.half === gameState.currentHalf &&
        currentMinutes === r.gameMinute - 1 &&
        !r.viewedAt
      );
      if (nextRotation) {
        void client.models.PlannedRotation.update({
          id: nextRotation.id,
          viewedAt: new Date().toISOString(),
        });
      }
    }

    // Auto-halftime (unchanged guard logic)
    if (gameState.currentHalf === 1 && derived >= halfLengthSeconds && !halftimeTriggeredRef.current) {
      halftimeTriggeredRef.current = true;
      setTimeout(() => void onHalftimeRef.current(), 0);
    }

    // Auto-end game
    if (derived >= 7200 && !endGameTriggeredRef.current) {
      endGameTriggeredRef.current = true;
      setTimeout(() => void onEndGameRef.current(), 0);
    }
  }, 500);

  // 5s DB sync — stays as direct client call (timer sync is low-priority;
  // formula self-corrects on foreground so missed syncs while offline are acceptable)
  const saveInterval = setInterval(() => {
    if (!startMsRef.current) return;
    const derived = startElapsedRef.current +
      Math.floor((Date.now() - startMsRef.current) / 1000);
    client.models.Game.update({
      id: game.id,
      elapsedSeconds: derived,
      lastStartTime: new Date().toISOString(),
    }).catch(err => handleApiError(err, 'Failed to save game time'));
  }, 5000);

  return () => {
    clearInterval(interval);
    clearInterval(saveInterval);
  };
}, [isRunning, gameState.status, gameState.currentHalf, halfLengthSeconds, game.id,
    gamePlan, plannedRotations]);
```

**Why the 5s sync stays as a direct client call:** The timer sync is not critical for offline. The formula self-corrects on foreground return. If the writes fail while offline, the `lastStartTime`/`elapsedSeconds` anchor from before going offline is still valid for page-reload recovery. Routing timer syncs through the offline queue would produce hundreds of `Game.update` entries unnecessarily.

**No changes to:** `UseGameTimerParams` interface, `halftimeTriggeredRef`, `endGameTriggeredRef`, `halftimeInProgressRef` guard in owner component, hook export signature.

---

### 4.2 `src/components/GameManagement/GameManagement.tsx`

**What changes (incorporating all architect fixes):**
1. Add `useOfflineMutations` — returns `{ mutations, isOnline, pendingCount, isSyncing }`. No separate `useNetworkStatus` call needed in this file (it's internal to the hook).
2. Replace all direct `client.models.*` calls (except in `useGameSubscriptions` / `useGameTimer` which remain unchanged) with `mutations.*` calls
3. Pass `mutations` as a new prop to `SubstitutionPanel`, `LineupPanel`, `GoalTracker`, `PlayerNotesPanel`
4. Render `OfflineBanner` in the in-progress and halftime layouts
5. Remove the `const client = generateClient<Schema>()` module-level call from `GameManagement.tsx` — all direct write calls now route through `mutations`

**Detailed changes:**

```typescript
// Add new imports
import { useOfflineMutations, type GameMutationInput } from '../../hooks/useOfflineMutations';
import { OfflineBanner } from '../OfflineBanner';

// Remove: const client = generateClient<Schema>();

// Destructure from the all-in-one hook:
const { mutations, isOnline, pendingCount: pendingMutationCount, isSyncing } = useOfflineMutations();
```

**Handler call replacements** (exact mapping):

| Old call | New call |
|---|---|
| `client.models.Game.update({ id: game.id, status: 'in-progress', lastStartTime })` | `await mutations.updateGame(game.id, { status: 'in-progress', lastStartTime })` |
| `client.models.Game.update({ id: game.id, elapsedSeconds, lastStartTime: null })` | `await mutations.updateGame(game.id, { elapsedSeconds, lastStartTime: null })` |
| `client.models.Game.update({ id: game.id, lastStartTime, elapsedSeconds })` | `await mutations.updateGame(game.id, { lastStartTime, elapsedSeconds })` |
| `client.models.Game.update({ id: game.id, status: 'halftime', elapsedSeconds })` | `await mutations.updateGame(game.id, { status: 'halftime', elapsedSeconds })` |
| `client.models.Game.update({ id: game.id, status: 'in-progress', currentHalf: 2, lastStartTime, elapsedSeconds })` | `await mutations.updateGame(game.id, { status: 'in-progress', currentHalf: 2, lastStartTime, elapsedSeconds })` |
| `client.models.Game.update({ id: game.id, status: 'completed', elapsedSeconds })` | `await mutations.updateGame(game.id, { status: 'completed', elapsedSeconds })` |
| `client.models.PlayTimeRecord.create(...)` | `await mutations.createPlayTimeRecord(...)` |
| `client.models.LineupAssignment.delete({ id })` | `await mutations.deleteLineupAssignment(id)` |
| `client.models.LineupAssignment.create(...)` | `await mutations.createLineupAssignment(...)` |
| `client.models.Substitution.create(...)` | `await mutations.createSubstitution(...)` |

The `deleteGameCascade(...)` call (non-live-game, management operation) stays as a direct client call — cascade delete is intentionally excluded from the offline queue.

**New props passed to children:**

```typescript
// SubstitutionPanel — add mutations prop
<SubstitutionPanel
  // ...existing props...
  mutations={mutations}
/>

// LineupPanel — add mutations prop
<LineupPanel
  // ...existing props...
  mutations={mutations}
/>

// GoalTracker — add mutations prop  
<GoalTracker
  // ...existing props...
  mutations={mutations}
/>

// PlayerNotesPanel — add mutations prop
<PlayerNotesPanel
  // ...existing props...
  mutations={mutations}
/>
```

**OfflineBanner placement in render:**

```tsx
// In-progress layout — rendered between CommandBand and TabNav
<CommandBand ... />
<OfflineBanner
  isOnline={isOnline}
  pendingCount={pendingMutationCount}
  isSyncing={isSyncing}
/>
<TabNav ... />

// Halftime layout — rendered after CommandBand / before halftime content
<OfflineBanner ... />
```

---

### 4.3 `src/services/substitutionService.ts`

**What changes:**
- `executeSubstitution` and `closeActivePlayTimeRecords` accept a `mutations` parameter for their write operations
- DB **read** operations inside these functions (`PlayTimeRecord.list`) stay as direct `client` calls — reads are fine offline (Workbox serves cached responses or they fail gracefully)
- Remove `const client = generateClient<Schema>()` from this file if all writes are moved out; keep it only for the read portions

**New signature — `executeSubstitution`:**
```typescript
export async function executeSubstitution(
  gameId: string,
  oldPlayerId: string,
  newPlayerId: string,
  positionId: string,
  currentGameSeconds: number,
  currentHalf: number,
  playTimeRecords: PlayTimeRecord[],
  oldAssignmentId: string,
  coaches: string[],
  mutations: GameMutationInput  // NEW — replaces direct client write calls
): Promise<void>
```

Internal write calls replaced:
- `client.models.PlayTimeRecord.update(...)` → `await mutations.updatePlayTimeRecord(id, { endGameSeconds })`
- `client.models.LineupAssignment.delete(...)` → `await mutations.deleteLineupAssignment(oldAssignmentId)`
- `client.models.LineupAssignment.create(...)` → `await mutations.createLineupAssignment(...)`
- `client.models.PlayTimeRecord.create(...)` → `await mutations.createPlayTimeRecord(...)`
- `client.models.Substitution.create(...)` → `await mutations.createSubstitution(...)`

**New signature — `closeActivePlayTimeRecords`:**
```typescript
export async function closeActivePlayTimeRecords(
  playTimeRecords: PlayTimeRecord[],
  endGameSeconds: number,
  playerIds?: string[],
  gameId?: string,
  mutations?: GameMutationInput  // NEW — optional to preserve backward compat
): Promise<void>
```

When `mutations` is provided, use `mutations.updatePlayTimeRecord(...)` for the write calls. When not provided (fallback), use direct client call (supports callers that aren't yet wired — can be removed once all callers pass mutations). All console.log statements and retry scan logic are unchanged.

**Call sites to update:**
- `GameManagement.tsx` passes `mutations` to `closeActivePlayTimeRecords(playTimeRecords, time, undefined, game.id, mutations)` in `handleHalftime` and `handleEndGame`
- `SubstitutionPanel.tsx` passes `mutations` to `executeSubstitution(..., mutations)`

---

### 4.4 `src/components/GameManagement/SubstitutionPanel.tsx`

**What changes:**
- Add `mutations: GameMutationInput` to `SubstitutionPanelProps`
- Remove `const client = generateClient<Schema>()` from module level
- Pass `mutations` to `executeSubstitution(...)` call
- Replace any direct `client.models.LineupAssignment.create/delete` calls with `mutations.*`

```typescript
interface SubstitutionPanelProps {
  // ...all existing props...
  mutations: GameMutationInput;  // ADD
}
```

---

### 4.5 `src/components/GameManagement/LineupPanel.tsx`

**What changes:**
- Add `mutations: GameMutationInput` to `LineupPanelProps`
- Remove `const client = generateClient<Schema>()` from module level
- Replace `client.models.LineupAssignment.*` calls with `mutations.createLineupAssignment / deleteLineupAssignment / updateLineupAssignment`
- Replace `client.models.PlayTimeRecord.create` calls with `mutations.createPlayTimeRecord`

```typescript
interface LineupPanelProps {
  // ...all existing props...
  mutations: GameMutationInput;  // ADD
}
```

---

### 4.6 `src/components/GameManagement/GoalTracker.tsx`

**What changes:**
- Add `mutations: GameMutationInput` to `GoalTrackerProps`
- Remove `const client = generateClient<Schema>()` from module level
- Replace `client.models.Goal.create(...)` with `await mutations.createGoal(...)`

```typescript
interface GoalTrackerProps {
  // ...all existing props...
  mutations: GameMutationInput;  // ADD
}
```

---

### 4.7 `src/components/GameManagement/PlayerNotesPanel.tsx`

**What changes:**
- Add `mutations: GameMutationInput` to `PlayerNotesPanelProps`
- Remove `const client = generateClient<Schema>()` from module level
- Replace `client.models.GameNote.create(...)` with `await mutations.createGameNote(...)`

```typescript
interface PlayerNotesPanelProps {
  // ...all existing props...
  mutations: GameMutationInput;  // ADD
}
```

---

### 4.8 `src/constants/ui.ts`

Add z-index constants for the new banner:

```typescript
export const Z_INDEX = {
  BOTTOM_NAV: 100,
  GAME_TAB_NAV: 190,
  OFFLINE_BANNER: 195,
  COMMAND_BAND: 200,
  MODAL_OVERLAY: 1000,
  NOTIFICATIONS: 9999,
} as const;
```

---

## 5. Schema / Data Model Changes

**None.** No changes to `amplify/data/resource.ts`. All DynamoDB models remain unchanged. The offline queue is client-side only (IndexedDB).

---

## 6. Preserved Behaviors

| Behavior | How it's preserved |
|---|---|
| Page-load timer restore | `useGameSubscriptions` sets `currentTime = elapsedSeconds + (now - lastStartTime)` then `setIsRunning(true)`. The new hook captures anchor at `isRunning = true`, starting correctly from the restored value. |
| Pause / resume | `handlePauseTimer` sets `isRunning = false` → hook captures `startMsRef = null`. `handleResumeTimer` sets `isRunning = true` → hook captures anchor at current `currentTime` (paused value). Formula returns fixed value when paused. Unchanged semantics. |
| Halftime auto-trigger | Guards `halftimeTriggeredRef`, `halftimeInProgressRef` unchanged. Formula produces the same logical `derived >= halfLengthSeconds` check. |
| DynamoDB 5s sync | Stays in `useGameTimer` as direct client call. Writes `elapsedSeconds = derived` and `lastStartTime = now` every 5s. |
| `manuallyPausedRef` | Unchanged in `useGameSubscriptions`. Prevents observeQuery from auto-resuming deliberate pauses. |
| Two-phase record close | Unchanged in `substitutionService.ts`. Only write calls are rerouted through mutations. |
| Analytics events | All `trackEvent` calls unchanged. |

---

## 7. Edge Cases

### Timer backgrounded at halftime moment
**Scenario:** Timer reaches `halfLengthSeconds` while phone is locked. Coach returns 5+ minutes later.  
**Behavior:** On first 500ms tick after foreground, formula computes `derived >= halfLengthSeconds`. `halftimeTriggeredRef` fires `handleHalftime` via `setTimeout(..., 0)`. `handleHalftime` closes play time records at `halfLengthSeconds` (not the later wall time). No confirmation shown.

### Long offline period (>1 hour — Cognito token expiry)
**Scenario:** Coach uses app offline for >60 minutes then reconnects.  
**Behavior:** `onReconnect` drain calls `fetchAuthSession({ forceRefresh: true })`. If refresh fails (no network), drain is aborted, queue retained, toast: "Please reconnect and refresh to sync changes". If refresh succeeds, drain proceeds.

### Game.update deduplication
**Scenario:** Coach is offline for 30 minutes. The 5s timer sync in `useGameTimer` makes direct client calls (which fail silently offline). This means NO `Game.update` timer syncs accumulate in the queue — only the explicit game-state updates (start, pause, resume, halftime, end) go through `mutations.updateGame`. The deduplication step in `deduplicateGameUpdates` handles the case where multiple pause/resume cycles produce multiple `Game.update` entries — the last one wins.

### Subscription reconnect ordering
**Scenario:** `observeQuery` subscription drops while offline, Amplify re-establishes on reconnect.  
**Behavior:** Queue drain completes before Amplify re-establishes subscriptions (network reconnect triggers drain → drain is `await`-based → Amplify subscription re-establishment is a separate async process that begins after). In practice, subscriptions re-establish within 1–3 seconds; drain may complete concurrently. This is acceptable: the subscription will receive the latest state post-drain via the normal observeQuery update cycle.

### Substitution playback ordering during drain
**Scenario:** 3 substitutions made offline; played back in enqueue order.  
**Behavior:** Drain is sequential (not parallel). Each substitution's mutations execute in the same relative order they were performed live: `updatePlayTimeRecord` → `deleteLineupAssignment` → `createLineupAssignment` → `createPlayTimeRecord` → `createSubstitution`. Because ordering is preserved and each item executes before the next starts, referential integrity is maintained.

### Component receives optimistic result while offline
**Scenario:** Coach makes a substitution while offline. `executeSubstitution` enqueues mutations and returns immediately. React state updates optimistically from `observeQuery` subscription? No — the subscription won't update until the write reaches DynamoDB. The lineup won't visually update.  
**Decision for this plan:** Optimistic UI updates are **out of scope**. The offline banner informs the coach that changes are queued. The UI will update once connectivity is restored and the queue drains. This keeps the implementation scope manageable and avoids complex rollback logic.

---

## 8. Testing Plan

### 8.1 `src/services/offlineQueueService.test.ts` (new)

| Test | Description |
|---|---|
| `enqueue adds item to store` | Enqueue one item, `pendingCount()` returns 1 |
| `dequeueAll returns items in order and clears store` | Enqueue 3, dequeue all, verify order and count |
| `deduplicateGameUpdates retains latest per gameId` | Enqueue 5 `Game.update` for same gameId, dedup, verify 1 remains |
| `deduplicateGameUpdates preserves non-Game.update items` | Mixed queue, dedup only collapses Game.update |
| `requeueFailed increments retryCount` | Dequeue, requeue failed items, verify retryCount = 1 |

Mock `idb` using a fake in-memory implementation (or `fake-indexeddb` package — check if already available, else mock manually).

### 8.2 `src/hooks/useNetworkStatus.test.ts` (new)

| Test | Description |
|---|---|
| `returns true when navigator.onLine is true` | Mock `navigator.onLine = true`, verify initial state |
| `returns false when navigator.onLine is false` | — |
| `calls onReconnect when online event fires` | Fire `online` event, verify callback called |
| `does not call onReconnect when already online` | Stays online → online, no callback |

### 8.3 `src/hooks/useOfflineMutations.test.ts` (new)

| Test | Description |
|---|---|
| `calls client directly when online` | `isOnline = true`, call `mutations.createGoal`, verify client mock called |
| `enqueues when offline` | `isOnline = false`, call `mutations.createGoal`, verify `enqueue` called, client not called |
| `drain executes queued mutations on reconnect` | Pre-populate queue, trigger reconnect, verify client calls in order |
| `drain deduplicates Game.update before executing` | 3 `Game.update` in queue → after drain, client receives 1 |
| `drain aborts if token refresh fails` | Mock `fetchAuthSession` to throw, verify queue not cleared |
| `onQueueChange called with 0 after successful drain` | Verify callback with 0 when queue is empty post-drain |

### 8.4 `src/components/GameManagement/hooks/useGameTimer.test.ts` (update)

Update existing tests to use `Date.now()` mocking rather than `setInterval` tick counting:

| Test | Description |
|---|---|
| `derives currentTime from wall clock on each tick` | Mock `Date.now()` advancing by 30s, verify `setCurrentTime` called with 30 |
| `timer backgrounded 3 minutes: corrects on foreground` | Start timer with `Date.now()` = T, mock `Date.now()` = T+180s on next tick, verify `setCurrentTime(180)` |
| `halftime triggers when derived time reaches halfLengthSeconds` | Mock time to exceed `halfLengthSeconds`, verify `onHalftime` called exactly once |
| `halftime triggered while backgrounded: fires on first tick` | Anchor at T, mock `Date.now()` = T + halfLength + 300s, verify halftime fires |
| `halftime not triggered twice` | Two ticks both past `halfLengthSeconds`, verify `onHalftime` called once |
| `pause: setCurrentTime not called when isRunning false` | Verify no calls when `isRunning = false` |
| `anchor resets when isRunning transitions to true` | Resume from 600s, verify formula uses new anchor |

### 8.5 `src/components/OfflineBanner.test.tsx` (new)

| Test | Description |
|---|---|
| `renders null when online and not syncing` | — |
| `shows offline text when offline with no queue` | — |
| `shows queued count when offline with mutations` | — |
| `shows syncing text when online and syncing` | — |

---

## 9. Acceptance Criteria

### #31 — Background Timer

- [ ] Start a game in the PWA on an iPhone; lock the phone for 2+ minutes; unlock → game clock shows correct elapsed time (within ±1 second of wall clock minus any deliberate pause)
- [ ] Lock phone exactly at halftime → unlock → halftime state is shown immediately
- [ ] Pause the game; lock phone for 1 minute; unlock → clock is still paused at the paused value (not advanced)

### #35 — Offline Game Management

- [ ] Enable airplane mode mid-game; the offline banner appears with no error toasts
- [ ] Make a substitution while offline → substitution panel closes normally (optimistic); banner shows "N changes saved locally"
- [ ] Record a goal while offline → goal count updates in local state visually... or does not update until sync (per decision in edge cases — no optimistic UI). Banner count increments.
- [ ] Re-enable network → banner shows "Syncing…" then disappears; DynamoDB reflects all queued changes
- [ ] Console log or network tab shows queued mutations replayed in correct order
- [ ] Offline for 3 minutes, game clock continues advancing accurately on foreground

### General

- [ ] `npm run test:run` — all tests pass
- [ ] `npm run build` — clean TypeScript + Vite build
- [ ] `npm run lint` — no new lint errors

---

## 10. File Change Summary

| File | Change Type |
|---|---|
| `package.json` | Modify — add `idb` |
| `src/services/offlineQueueService.ts` | **New** |
| `src/hooks/useNetworkStatus.ts` | **New** |
| `src/hooks/useOfflineMutations.ts` | **New** |
| `src/components/OfflineBanner.tsx` | **New** |
| `src/components/OfflineBanner.css` | **New** |
| `src/components/GameManagement/hooks/useGameTimer.ts` | Modify — wall-clock formula |
| `src/components/GameManagement/GameManagement.tsx` | Modify — useOfflineMutations, pass mutations, render banner |
| `src/components/GameManagement/SubstitutionPanel.tsx` | Modify — accept mutations prop |
| `src/components/GameManagement/LineupPanel.tsx` | Modify — accept mutations prop |
| `src/components/GameManagement/GoalTracker.tsx` | Modify — accept mutations prop |
| `src/components/GameManagement/PlayerNotesPanel.tsx` | Modify — accept mutations prop |
| `src/services/substitutionService.ts` | Modify — accept mutations param |
| `src/constants/ui.ts` | Modify — add Z_INDEX constants |
| `src/services/offlineQueueService.test.ts` | **New** |
| `src/hooks/useNetworkStatus.test.ts` | **New** |
| `src/hooks/useOfflineMutations.test.ts` | **New** |
| `src/components/GameManagement/hooks/useGameTimer.test.ts` | Modify — update for formula-based timer |
| `src/components/OfflineBanner.test.tsx` | **New** |

**Total: 5 new source files, 9 modified source files, 5 new/updated test files**

---

## 11. Out of Scope (Explicit Exclusions)

- Optimistic UI updates for offline mutations (lineup/score don't update until sync)
- Conflict resolution for concurrent multi-coach edits during offline periods (last-write-wins)
- Offline support for Game Planner (`/game/:id/plan` route) — fail-with-toast as today
- Amplify DataStore migration
- Background sync via Service Worker Push API
- **Offline sub + offline halftime correctness** *(known limitation, deferred)*: If a substitution AND halftime both occur while offline, `closeActivePlayTimeRecords` at halftime cannot see the `createPlayTimeRecord` item for the newly-subbed-in player (it's in the IndexedDB queue, not yet in DynamoDB or React state). The new player's play time record will not have `endGameSeconds` set at halftime. On reconnect, the existing two-phase DB scan in `closeActivePlayTimeRecords` (called during halftime drain) should catch this orphan, but this path is not explicitly tested. Track as a follow-up defect after initial release.
