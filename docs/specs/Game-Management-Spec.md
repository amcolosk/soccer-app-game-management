# Game Management Specification

## 1. Overview

The Game Management screen is the live sideline interface coaches use during a match. It tracks the game clock, lineup, substitutions, play time, goals, and notes. It is designed for use on mobile devices (primarily iOS Safari PWA) in conditions with intermittent or no connectivity.

**Core design principles:**
- The game clock is always authoritative from the wall clock, not from accumulated JS intervals
- All game mutations survive backgrounding, app-switching, and temporary loss of connectivity
- Coaches can always make a substitution or record a goal, even offline — changes sync on reconnect

---

## 2. Game States

A game progresses through these states stored in `Game.status`:

| State | Description |
|-------|-------------|
| `scheduled` | Pre-game; availability grid and plan conflict banner shown |
| `in-progress` | Active half; CommandBand + Lineup/Bench/Notes tabs |
| `halftime` | Between halves; GameTimer with `hidePrimaryCta=true` |
| `completed` | Game over; read-only summary |

---

## 3. Game Timer

### 3.1 Authoritative Time Formula

The canonical game time is derived from wall clock at every render tick:

```
currentTime = elapsedSeconds + floor((now − lastStartTime) / 1000)   [when running]
currentTime = elapsedSeconds                                           [when paused]
```

- `lastStartTime`: ISO timestamp stored in `Game.lastStartTime`, set when the timer starts or resumes
- `elapsedSeconds`: accumulated seconds stored in `Game.elapsedSeconds`, updated every 5 seconds as a snapshot

A 500ms `setInterval` recalculates and sets `currentTime` locally using this formula. It is a **UI refresh tick only**, not an accumulator. Advancing the timer does not depend on any previous local state — the wall clock is always the source of truth.

**Why this matters:** iOS Safari freezes JavaScript timers when the PWA is backgrounded (screen lock or app switch). Because `currentTime` is re-derived from wall clock on every tick rather than accumulated, the timer automatically shows the correct elapsed time when the app is foregrounded — no catch-up code needed.

### 3.2 DynamoDB Sync

Every 5 seconds while the timer is running, the current formula output is persisted:

```typescript
await client.models.Game.update({
  id: game.id,
  elapsedSeconds: currentTime,         // snapshot of derived time
  lastStartTime: new Date().toISOString(),  // anchor for formula
});
```

This ensures that on any page reload or device switch, the formula can be re-anchored accurately.

### 3.3 Pause / Resume

Pause is a supported operation for legitimate stops (rain delays, accidentally starting the game timer before kickoff):

**Pause:**
```typescript
await client.models.Game.update({
  id: game.id,
  elapsedSeconds: currentTime,
  lastStartTime: null,  // null = paused; formula uses fixed elapsedSeconds
});
```

**Resume:**
```typescript
await client.models.Game.update({
  id: game.id,
  lastStartTime: new Date().toISOString(),  // re-anchor wall clock
  elapsedSeconds: currentTime,
});
```

When paused, the timer formula returns a fixed value. When resumed, `lastStartTime` is set to now and the formula begins advancing from `elapsedSeconds` again. The `manuallyPausedRef` flag prevents `observeQuery` from auto-resuming a deliberate pause.

Pause does **not** close active `PlayTimeRecord` entries — those remain open and accumulate game time when the timer resumes.

### 3.4 Halftime

**Automatic halftime** triggers when `currentTime >= halfLengthSeconds` while `Game.currentHalf === 1`. The `halftimeTriggeredRef` guard ensures it fires exactly once.

**If the app was backgrounded when half-time would have occurred**, the timer formula computes the correct elapsed time on the next foreground tick. If this value meets or exceeds `halfLengthSeconds`, `handleHalftime` fires immediately — no confirmation is shown to the coach, even if the resume gap is large (see §3.6 — a resume that crosses this boundary is explicitly excluded from the gap-confirmation modal, so the two features never race). Play time records are closed at `halfLengthSeconds` (the actual half-end game time, not the later wall time when the coach returned).

**`handleHalftime` sequence:**
1. Set `isRunning = false`
2. Call `mutations.closeAllOpenPlayTimeRecords(halfLengthSeconds)` — closes every `PlayTimeRecord` this device has locally opened, unconditionally (does not depend on subscription/DB visibility — this is what makes closing correct even for a record created moments earlier while offline)
3. Call `closeActivePlayTimeRecords(halfLengthSeconds)` as a **cross-device backstop** — catches a record opened on a *different* coach's device, via the `gameId` GSI
4. Update `Game.status = 'halftime'`, `Game.elapsedSeconds = halfLengthSeconds`
5. UI transitions to halftime layout

**`handleStartSecondHalf` sequence:**
1. Resolve starters from the live lineup subscription; if short of `team.maxPlayersOnField`, re-query `LineupAssignment` directly against the DB. This never falls back to the saved GamePlan halftime/starting-lineup snapshot — that snapshot predates halftime and can't reflect a removal the coach just made. If starters are still short, show "Assign N starters before starting the second half" and stop here — no state below has changed yet.
2. Set `Game.currentHalf = 2`, `Game.status = 'in-progress'`, `Game.lastStartTime = now`
3. Create new `PlayTimeRecord` entries for all resolved starters at `resumeTime`
4. Set `isRunning = true`; timer formula re-anchors to new `lastStartTime`

### 3.5 End Game

**Automatic end game** triggers when `currentTime >= MAX_GAME_SECONDS` (`src/constants/gameTimer.ts`, currently 7200 — a 2-hour safety cap). Can also be triggered manually. Like auto-halftime, a resume gap that crosses this boundary is silent — never intercepted by the gap-confirmation modal (§3.6).

**`handleEndGame` sequence:**
1. Set `isRunning = false`
2. Call `mutations.closeAllOpenPlayTimeRecords(endGameTime)` — primary close path, same as halftime
3. Call `closeActivePlayTimeRecords(endGameTime)` as the cross-device backstop

### 3.6 Unrecorded Stoppage / Timer Gap Confirmation

A crash, force-quit, or OS-level app eviction wipes all in-memory state (React state, `isRunning`) but not `Game.lastStartTime` in DynamoDB. On the next mount, `useGameSubscriptions`'s `observeQuery` handler sees `status: 'in-progress'` with a stale `lastStartTime` and must decide how much wall-clock time to credit — this is exactly the resume-gap computation in §3.1, and it has no way on its own to tell a genuine crash apart from an entirely normal case: **a second coach opening an already-running game for the first time**, which produces the identical large-gap computation. Naively confirming every large gap would nag every second coach who opens the app mid-half.

**The distinguishing signal is a per-device, per-user localStorage heartbeat** (`buildTimerHeartbeatStorageKey`, `src/constants/gameTimer.ts`), written by `useGameTimer` whenever `isRunning` transitions to `true` on this device. Its *presence* means this exact device (browser/profile) has had this game's timer running before — so a large gap on a subsequent mount means *this device* lost continuity. Its *absence* means this device is seeing the running game for the first time, and the gap must be applied silently, exactly as before this feature existed.

**Decision, computed in the `observeQuery` handler** for a `status: 'in-progress'` event with a set `lastStartTime`:
1. Compute `additionalSeconds` (the gap) and `proposedElapsed` as in §3.1.
2. If `additionalSeconds < ANOMALOUS_GAP_THRESHOLD_SECONDS` (600s) → apply silently (not anomalous).
3. If this device has no heartbeat for this game/user → apply silently (no local continuity to have lost).
4. If `proposedElapsed` would cross the auto-halftime boundary (half 1 only) or `MAX_GAME_SECONDS` → apply silently (the existing auto-trigger already owns this case — see §3.4/§3.5).
5. Otherwise → hold the jump. `currentTime`/`isRunning` stay at their prior values (`pendingGapCorrection` state is set instead) and `GameManagement` shows a confirmation dialog ("Was play stopped?", via the existing `useConfirm()` infrastructure — no new modal component): **"Yes, that's right"** applies `proposedElapsed` and resumes, exactly like the silent path would have; **"No, let me adjust"** (or dismissing the dialog) applies nothing — the coach's existing Resume button is the next natural action, re-anchoring from the un-jumped time.

No persisted audit trail — both outcomes fire an analytics event (`TIMER_GAP_ACCEPTED` / `TIMER_GAP_ADJUSTED`) only. A second gap proposal is never raised while one is already pending.

---

## 4. Play Time Tracking

Play time is tracked at game-clock resolution via `PlayTimeRecord`:

```
PlayTimeRecord {
  gameId, playerId, positionId,
  startGameSeconds,   // game time when player entered field
  endGameSeconds,     // game time when player left (null = currently active)
}
```

| Event | Play Time Action |
|-------|-----------------|
| Game start | Open records for all starters at `currentTime` (usually 0) |
| Substitution | Close outgoing player's record; open incoming player's record at `currentGameSeconds` |
| Halftime | Close all active records at `halfLengthSeconds` |
| Second half start | Open records for all starters at `resumeTime` |
| End game | Close all active records at `endGameTime` |

Closing is two-tiered: `mutations.closeAllOpenPlayTimeRecords` (the primary path, `src/hooks/useOfflineMutations.ts`) closes every record this device has locally tracked as open, unconditionally — it works even for a record created moments earlier while offline, since it doesn't depend on subscription or DB visibility. `closeActivePlayTimeRecords` (`src/services/substitutionService.ts`) is a cross-device backstop for a record opened on a *different* coach's device, using the `gameId` GSI with a 500ms retry pass for DynamoDB eventual consistency.

---

## 5. Offline Game Management

### 5.1 Offline Mutation Queue

All live-game mutations are routed through `useOfflineMutations()`, which is offline-aware:

- **Online:** Execute mutation directly via Amplify client; return result immediately
- **Offline:** Serialize mutation into IndexedDB queue (via `offlineQueueService`); return a local optimistic result

On reconnect (`navigator.onLine` + `online` event), the queue drains in enqueue order:
1. Refresh Cognito token via `fetchAuthSession()` before replay (guards against >1hr offline)
2. Execute each queued mutation against the live API
3. If token refresh fails, surface a "Please reconnect and refresh" message — do not silently discard queued writes

**`Game.update` deduplication:** Multiple `Game.update` entries for the same `gameId` in the queue are collapsed to the latest (prevents hundreds of timer-sync entries accumulating during a long offline period).

### 5.2 Queued Mutation Types

All live-game mutations are queued when offline:

| Mutation | Source |
|----------|--------|
| `Game.update` | `GameManagement.tsx`, `useGameTimer.ts` |
| `PlayTimeRecord.create` | `GameManagement.tsx`, `substitutionService.ts` |
| `PlayTimeRecord.update` | `substitutionService.ts` |
| `Substitution.create` | `GameManagement.tsx`, `substitutionService.ts` |
| `LineupAssignment.create` | `GameManagement.tsx`, `SubstitutionPanel.tsx` |
| `LineupAssignment.delete` | `GameManagement.tsx`, `LineupPanel.tsx` |
| `LineupAssignment.update` | `LineupPanel.tsx` |
| `Goal.create` | `GoalTracker.tsx` |
| `GameNote.create` | `PlayerNotesPanel.tsx` |

### 5.3 Offline Queue Schema

```typescript
interface QueuedMutation {
  id: string;           // UUID
  model: string;        // e.g. 'Game', 'Goal'
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  enqueuedAt: number;   // Date.now()
  retryCount: number;
}
```

Stored in IndexedDB store `pending-mutations` (via `idb` package).

### 5.4 Offline UX

An `OfflineBanner` component is shown below the `CommandBand` when offline or draining:

| State | Banner text |
|-------|-------------|
| Offline, queue empty | "You're offline" |
| Offline, queue has writes | "You're offline — N changes saved locally" |
| Reconnected, draining | "Syncing N changes…" |
| Online, queue empty | Banner hidden |

**Key principle:** Coaches can continue all game-day operations (substitutions, goals, notes, play time) while offline. The UI is not blocked. Write failures are never shown as errors during offline operation — only the banner state changes.

### 5.5 Subscription Reconnection Ordering

`observeQuery` subscriptions drop when offline. On reconnect:
1. Queue drain completes first
2. Amplify re-establishes subscriptions after drain

This ensures subscriptions reflect the post-replay state rather than a stale snapshot.

---

## 6. Screen Wake Lock

`useWakeLock(isActive)` is mounted in `GameManagement` with `isActive = (status === 'in-progress' || status === 'halftime')`. Also mounted independently in the public Sideline Stat Tracker (`StatTrackerView`, `isActive = viewState === 'LIVE'`) — see `docs/specs/UI-SPEC.md` §7.15.

- Acquires `navigator.wakeLock.request('screen')` to prevent the device from sleeping during active games
- Re-acquires on `visibilitychange → visible` (e.g., after a phone call or notification)
- Releases on unmount or when game is no longer active

---

## 7. Live Score Notification

`useGameNotification` shows a persistent notification in the device notification shade every 30 seconds while a game is active (status `in-progress` or `halftime`). Format: `"Eagles vs Lions · H1 25:30"`.

Requires notification permission (requested on game start). Uses `ServiceWorkerRegistration.showNotification()`.

---

## 8. Race Condition Guards

| Guard | Location | Purpose |
|-------|----------|---------|
| `halftimeTriggeredRef` | `useGameTimer.ts` | Prevents auto-halftime firing more than once |
| `endGameTriggeredRef` | `useGameTimer.ts` | Prevents auto-end-game firing more than once |
| `halftimeInProgressRef` | `GameManagement.tsx` | Prevents duplicate `handleHalftime` execution |
| `endGameInProgressRef` | `GameManagement.tsx` | Prevents duplicate `handleEndGame` execution |
| `manuallyPausedRef` | `useGameSubscriptions.ts` | Prevents `observeQuery` auto-resuming a deliberate pause |
| Two-phase record close | `substitutionService.ts` | Handles DynamoDB eventual consistency for `PlayTimeRecord` updates |

---

## 9. Layout Zones (z-index)

| Zone | z-index | Visibility |
|------|---------|------------|
| Bottom nav | 100 | All screens |
| Game tab nav | 190 | In-progress game only |
| Command band | 200 | In-progress + halftime |
| Offline banner | 210 | Offline during active game |
| Modal overlay | 1000 | RotationWidget, SubstitutionPanel, ConfirmModal |
| Notifications | 9999+ | Toast, system notifications |

---

## 10. Key Files

| File | Role |
|------|------|
| `src/components/GameManagement/GameManagement.tsx` | Orchestrator; state, handlers, layout |
| `src/components/GameManagement/hooks/useGameTimer.ts` | Wall-clock derived timer; halftime/end-game auto-trigger |
| `src/components/GameManagement/hooks/useGameSubscriptions.ts` | `observeQuery` for live DynamoDB sync; page-load restore |
| `src/components/GameManagement/CommandBand.tsx` | Sticky score + timer display; pause/resume controls |
| `src/components/GameManagement/SubstitutionPanel.tsx` | Substitution execution UI |
| `src/components/GameManagement/GoalTracker.tsx` | Goal recording |
| `src/components/GameManagement/PlayerNotesPanel.tsx` | In-game notes (gold-star, yellow-card, red-card) |
| `src/hooks/useWakeLock.ts` | Screen wake lock |
| `src/hooks/useGameNotification.ts` | Live score notification |
| `src/hooks/useOfflineMutations.ts` | Offline-aware mutation wrapper (routes to queue or API) |
| `src/hooks/useNetworkStatus.ts` | `isOnline` + reconnect callback |
| `src/services/offlineQueueService.ts` | IndexedDB-backed mutation queue |
| `src/services/substitutionService.ts` | Substitution + play time record logic |
| `src/components/OfflineBanner.tsx` | Offline state banner |
