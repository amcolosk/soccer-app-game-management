# Implementation Plan: Mark Player as Injured on Bench (Issue #45)

## Overview
Add ability for coaches to mark bench players as injured during active games. Injured players are removed from substitution suggestions and rotation planning, can be recovered and re-subbed, and display a visual injury indicator on the bench.

**Status:** Architecture locked (Option B FIFO trust, no schema/Lambda/resolver changes); UI-designer delta revisions incorporated
**Scope:** 1–2 day implementation
**Risk Level:** Medium (touches multiple filtering paths, but reuses existing patterns)

---

## Requirements Analysis

### Confirmed Requirements
1. ✅ Injury button/icon on each bench player row in BenchTab during active games
2. ✅ Confirmation dialog before marking (prevent accidental taps)
3. ✅ Visual injury indicator on bench rows
4. ✅ Injured players filtered from SubstitutionPanel suggestions
5. ✅ Injured players filtered from RotationWidget auto-generated suggestions
6. ✅ Ability to recover/unmark injured players
7. ✅ Injury status persists across re-renders and page refreshes
8. ✅ Offline queue & sync support (consistent with other mutations)
9. ✅ Fire existing `PLAYER_MARKED_INJURED` analytics event
10. ✅ Add inverse `PLAYER_RECOVERED_FROM_INJURY` event
11. ✅ Only affects bench players (lineups not affected)
12. ✅ Only during active games (`in-progress` or `halftime` status)

### Requirements Gaps & Assumptions
1. **Automatic Injury Expiration:** Spec says `availableUntilMinute` exists but doesn't clarify if injuries auto-expire based on game time or must be manually unmarked.
   - **Assumption Made:** Injuries must be manually unmarked (coach explicitly recovers player). `availableUntilMinute` is set to current game seconds for audit/logging purposes only (audit-only, not behavioral filtering).

2. **Injury Indicator in Queue:** Spec doesn't clarify if injury indicator should appear on players already in substitution queue.
   - **Assumption Made:** Yes—if a queued player gets injured mid-action, indicator should appear to provide real-time feedback.

3. **Injured Players in Rotation Suggestions:** Spec doesn't clarify if coach can override auto-suggestions and manually add injured players to queue.
   - **Assumption Made:** No override—injured players cannot be selected or suggested anywhere in the app. Strict filtering at service level.

4. **Injury Scope During Transitions:** Spec doesn't clarify if injury status persists across halftime or should be cleared.
   - **Assumption Made:** Injury status persists until coach manually recovers. Halftime does not auto-clear injuries.

5. **availableUntilMinute Semantics:** Field exists but usage unclear—is it behavioral (affects filtering) or audit-only (metadata)?
   - **Decision Made (Architect Required):** After reviewing RotationWidget.tsx (line ~119), recovery clears this field with `null` parameter. This indicates audit-only semantics. Filtering is by `status === 'injured'`, not time comparison. The field is set for audit trail, not for behavioral cutoff.

---

## Architecture & Design Decisions

### 1. Data Model (No Schema Changes Required)
- **PlayerAvailability** model already supports our needs:
  - `status`: string → set to `'injured'` when marking
  - `availableUntilMinute`: integer → set to `Math.floor(currentTime / 60)` for audit trail
  - `markAt`: datetime → automatically set to `now()`
  - `coaches`: string[] → already populated by GraphQL authorization
  
- **No backward-incompatible changes:** Existing code already checks `status === 'absent' | 'injured'` in plan conflict detection, so injuries are partially implemented at the model level.

### 2. UI/UX Pattern Reuse
- **Confirmation Dialog:** Reuse `ConfirmModal.tsx` via `useConfirm()` hook (existing pattern in SubstitutionPanel)
- **Injury Indicator:** CSS class `bench-tab__player-row--injured` with tokenized status badge and visible text label `Injured` (not color-only, no emoji-only indicator)
- **Offline Support:** Extend `useOfflineMutations` to queue `PlayerAvailability.update` mutations (no new mechanism needed)

### 3. Filtering Strategy
- **Central Filtering Utility:** Create `src/utils/availabilityUtils.ts` with predicate functions:
  - `isPlayerInjured(playerId, playerAvailabilities): boolean`
  - `isPlayerAvailable(playerId, playerAvailabilities): boolean`
  - Consumed by BenchTab, SubstitutionPanel, RotationWidget

- **Why separate utility:** Keeps filtering logic DRY and testable independently from component logic.

### 4. Offline & Authorization
- **Offline Queue:** PlayerAvailability mutations will be queued via `useOfflineMutations` like other game mutations.
- **Authorization:** PlayerAvailability records include `coaches` array—current user already has write access (no new auth rules needed).

### 5. UI-Designer Revisions Incorporated

#### Bench row interaction model (resolved)
- **Decision:** Use two distinct controls in each bench row to prevent nested interactive conflicts.
  - **Primary action:** Existing row-level substitution/select behavior remains unchanged.
  - **Secondary action:** Dedicated injury/recovery button rendered as a sibling control, never nested inside another interactive element.
- **Tap target:** Injury/recovery button must be at least 44x44 px hit area on touch devices.
- **Event handling:**
  - Secondary button uses explicit `onClick` and calls `event.stopPropagation()` so injury actions cannot trigger substitution selection.
  - Keyboard activation supports Enter/Space on both controls independently.
- **Focus order:** Tab order is deterministic per row: player row primary action first, then injury/recovery secondary button.

#### Halftime access decision (resolved)
- **Chosen approach:** **B) Shared modal reachable from halftime**.
- **Rationale:** Halftime layout intentionally minimizes on-screen density and currently relies on modal-driven workflows; adding a full bench list to halftime would introduce layout churn and reduce readability. A shared injury/recovery modal keeps interaction consistent across in-progress and halftime states while satisfying the requirement that active game includes halftime.
- **Implementation planning note:** Add a halftime entry point (button/CTA) in existing halftime controls to open the same injury/recovery modal used by BenchTab.

#### Confirmation copy (resolved)
- **Mark injured modal:**
  - Title/Prompt includes explicit effect language: `Mark {PlayerName} as injured?`
  - Body copy: `This removes the player from substitution options and rotation suggestions until recovered.`
  - Actions: primary `Mark Injured`, secondary `Cancel`.
- **Recover modal:**
  - Title/Prompt: `Mark {PlayerName} available?`
  - Body copy: `This adds the player back to substitution options and rotation suggestions.`
  - Actions: primary `Mark Available`, secondary `Cancel`.

#### Empty and edge states (resolved)
- **SubstitutionPanel: all candidates injured**
  - Empty state copy: `No eligible substitutes. All bench players are marked injured.`
  - Action hint: `Recover a player to enable substitutions.`
- **RotationWidget: all planned-ins injured**
  - Warning copy: `No rotation changes available. Planned players are marked injured.`
  - Action hint: `Recover a player or update the plan.`
- **No bench players**
  - Existing empty state remains, with copy clarified to `No bench players available.`
- **Queued player becomes injured**
  - **Decision:** Auto-remove from substitution queue.
  - **Rationale:** Prevents accidental invalid substitutions and keeps queue state executable without additional coach intervention.
  - **UX feedback:** Show inline/toast message `Removed from queue: player marked injured.` and reflect change in SR announcement.

#### Accessibility acceptance criteria (resolved)
- **Aria labels:** Injury/recovery button includes player-specific label:
  - `aria-label="Mark {PlayerName} injured"`
  - `aria-label="Mark {PlayerName} available"`
- **Visible status text:** Bench row always shows explicit `Injured` text badge when status is injured.
- **Screen reader announcements:** Use `aria-live="polite"` status region to announce injury and recovery changes, including queue auto-removal when applicable.
- **Focus return:** After modal close (confirm or cancel), focus returns to the invoking injury/recovery button.
- **Keyboard path:** Full keyboard operation supported for opening modal, confirming/canceling, and continuing navigation without pointer input.

#### Responsive constraints (resolved)
- **Phone layout:** Prevent overlapping controls by reserving fixed action area for secondary button and allowing row text truncation/wrapping without covering actions.
- **Tablet layout:** Preserve current spacing rhythm and row density; avoid introducing new stacked controls that disrupt established bench alignment.

#### Visual consistency constraints (resolved)
- Reuse existing tokenized status/badge styles from current design system patterns.
- Do not use emoji-only injury indicators; icon usage is optional but must be paired with visible text.
- Ensure injury/recovery button styling matches existing secondary/icon button language.

### 6. UI-Designer Delta Revision (Issue #45)

#### Architecture lock reaffirmed (non-negotiable)
- Keep **Option B FIFO trust** for offline replay ordering.
- Keep **no schema changes, no Lambda changes, no resolver changes**.
- Keep **service-level filtering + frontend implementation** as the execution strategy.

#### Interaction-state matrix (BenchTab rows + halftime injury modal)

| State | Bench row behavior | Halftime modal behavior | Button disable rules | Row-level status messaging | Toast + live-region text |
|---|---|---|---|---|---|
| `idle` | Injury/recovery CTA enabled | Primary/secondary actions enabled | None disabled | No transient status | None |
| `confirming` | Row CTA opens confirm UI; no mutation yet | Confirm UI visible for selected player | Confirm CTA enabled unless no target player | `Awaiting confirmation` shown for selected row only | None |
| `submitting` | Selected row enters in-flight state | Confirm CTA shows progress text | Disable selected row injury/recovery CTA, modal confirm CTA, and repeated trigger controls | `Saving injury status...` or `Saving recovery status...` | Toast: `Saving change...`; Live region: `Submitting injury update for {PlayerName}.` |
| `queued-offline` | Row immediately reflects pending intent badge | Modal closes after enqueue success | Disable only until enqueue promise resolves, then re-enable | `Queued offline. Will sync when online.` | Toast: `Saved offline. Will sync automatically.`; Live region: `Injury update queued offline for {PlayerName}.` |
| `sync-success` | Row status settles to injured/available | No blocking modal | Controls enabled | `Synced` (short-lived, then removed) | Toast: `Player status updated.`; Live region: `Injury status updated for {PlayerName}.` |
| `sync-failure` | Row shows failure chip and retry affordance | Modal remains closed; failure surfaced inline | Re-enable controls after failure state set | `Sync failed. Change not applied.` | Toast: `Could not update player status.`; Live region: `Injury update failed for {PlayerName}.` |
| `retryable-failure` | Row exposes retry action | If retry launched from modal context, confirm action relaunches submit path | Retry CTA enabled; submit CTA disabled while retry in-flight | `Retry available.` | Toast: `Tap to retry.`; Live region: `Retry available for {PlayerName} injury update.` |

#### Explicit halftime modal accessibility criteria
- Modal uses `role="dialog"`; use `role="alertdialog"` only when presenting destructive/high-urgency confirm content.
- Modal has `aria-labelledby` wired to the visible title element and `aria-describedby` wired to the impact/help copy.
- Initial focus target is the primary confirm CTA in confirm mode; in non-confirm picker mode, initial focus is modal heading or first actionable control.
- Focus trap is strict: Tab/Shift+Tab cycles within modal until close.
- Escape closes modal only when not in non-interruptible submit state; during in-flight submit, Escape is ignored.
- Backdrop click closes modal in `idle`/`confirming`; backdrop click is ignored in `submitting`.
- On close (confirm, cancel, Escape, backdrop), focus returns deterministically to the invoking halftime CTA.

#### Accidental-tap hardening criteria
- One-shot confirm behavior while in-flight: after first confirm activation, further confirm activations are ignored until enqueue/submit resolves.
- Duplicate-submit prevention with per-player action lock + short debounce window on confirm activation.
- Confirm CTA remains disabled with progress label (`Marking Injured...` / `Marking Available...`) until enqueue/submit promise settles.

#### Discoverability rules
- On phone breakpoints, injury/recovery action uses persistent text label (not icon-only).
- Action prominence must remain visually higher than row metadata (jersey/aux details) via placement, weight, and spacing.
- Halftime modal header includes helper hint text: `Mark injured players unavailable for substitutions and rotations until recovered.`

#### Injured indicator legibility acceptance criteria
- Minimum contrast target: badge/text achieves at least WCAG AA contrast for normal text (4.5:1).
- Minimum typography target: injured label renders at >= 12px equivalent and medium weight or stronger.
- Non-color cue is mandatory and remains visible in compact rows (explicit `Injured` text or equivalent text badge).

#### Responsive acceptance criteria expansion
- Validate at 320px portrait width.
- Validate narrow landscape (small-height viewport) with no clipped primary actions.
- Validate at 200% text zoom without overlap between injury/recovery action and row content.
- Long names/strings use truncation/wrapping strategy that preserves minimum action tap target (44x44) and keeps CTA discoverable.

#### Resolved decision log (this revision)
- **Halftime CTA copy chosen:** `Manage Injuries`.
- **Offline feedback pattern chosen:** row-level status **plus** global toast/live-region echo.
- **Recovery action label by breakpoint:**
  - Phone: `Mark Available` (full text label).
  - Tablet/desktop: `Mark Available` (full text; icon optional but never icon-only).

---

## File-by-File Change List

### 1. **New Files**

#### `src/utils/availabilityUtils.ts` (NEW)
- **Purpose:** Centralized filtering utilities for availability checks
- **Exports:**
  - `isPlayerInjured(playerId: string, playerAvailabilities: PlayerAvailability[]): boolean`
  - `isPlayerAvailable(playerId: string, playerAvailabilities: PlayerAvailability[]): boolean`
  - `getPlayerAvailabilityStatus(playerId: string, playerAvailabilities: PlayerAvailability[]): string`
- **Why new file:** Keeps filtering logic separate from component/service logic, enables unit testing in isolation

#### `src/utils/availabilityUtils.test.ts` (NEW)
- **Tests:**
  - `isPlayerInjured` with various statuses
  - `isPlayerAvailable` with missing/invalid records
  - Edge cases (undefined/null arrays)

### 2. **Modified Files - Core Components**

#### `src/components/GameManagement/BenchTab.tsx` (MODIFY)
- **Changes:**
  - Add `playerAvailabilities: PlayerAvailability[]` prop
  - Add `currentTime: number` prop (already passed, used for availableUntilMinute calc)
  - Add `mutations: GameMutationInput` prop (for offline queue support)
  - Add `gameId: string` prop (for creating/updating PlayerAvailability)
  - Add `team: { coaches: string[] }` prop fragment (for coaches array)
  
  - For each bench player row:
    - Keep existing primary row interaction for substitution/select action
    - Add separate secondary injury/recovery button next to player name/action area (min 44x44 tap target)
    - Add `onClick` handler that triggers confirmation dialog
    - Secondary button handler must stop propagation to avoid triggering row substitution action
    - Add `--injured` CSS class modifier if player status is "injured"
    - Add injury indicator UI badge/text with explicit visible label `Injured`
  
  - New `handleMarkInjured` function (implements Blocker #1 - create vs update):
    - Call `confirm()` with explicit effect copy and actions: `Mark Injured` / `Cancel`, variant='warning'
    - On confirm:
      1. Check if PlayerAvailability record exists for (gameId, playerId) pair
      2. **IF NO existing record:** Call `mutations.createPlayerAvailability({gameId, playerId, status: 'injured', markedAt: new Date().toISOString(), coaches: team.coaches, availableUntilMinute: Math.floor(currentTime / 60)})`
      3. **IF existing record found:** Call `mutations.updatePlayerAvailability(record.id, {status: 'injured', availableUntilMinute: Math.floor(currentTime / 60), markedAt: new Date().toISOString()})`
      4. Fire `PLAYER_MARKED_INJURED` event
    - On cancel: Do nothing
  
  - New `handleRecoverInjured` function (if already injured):
    - Call `confirm()` with explicit effect copy and actions: `Mark Available` / `Cancel`
    - On confirm: 
      1. Get existing PlayerAvailability record for (gameId, playerId)
      2. Call `mutations.updatePlayerAvailability(record.id, {status: 'available', availableUntilMinute: null})`
      3. Fire `PLAYER_RECOVERED_FROM_INJURY` event
    - On cancel: Do nothing

- **Tests:** Update `BenchTab.test.tsx`
  - Test injury button renders only during active games
  - Test row primary action and injury/recovery button are independent (no accidental substitution on injury click)
  - Test tab/focus order is deterministic and modal focus returns to invoking button
  - Test confirmation dialog appears
  - Test mutation called with correct payload
  - Test injury indicator displays for injured players
  - Test unmark flow

#### `src/components/GameManagement/SubstitutionPanel.tsx` (MODIFY)
- **Changes:**
  - Props already include `game` (for status check), need to add clear reference
  - Add prop check: only allow filtering when game is `'in-progress'` or `'halftime'`
  
  - In the player selection modal/list (where bench candidates are shown):
    - Filter out any player with status === 'injured'
    - Use: `players.filter(p => !isPlayerInjured(p.id, playerAvailabilities))`
  
  - Display disabled state or remove injured player options entirely
  - Add empty state messaging if all candidates are injured: `No eligible substitutes. All bench players are marked injured.`
  - If a queued player becomes injured, auto-remove from queue and announce reason in UI feedback

- **Tests:** Update `SubstitutionPanel.test.tsx`
  - Test injured players are excluded from suggestion list
  - Test uninjured players still appear
  - Test all-injured scenario

#### `src/components/GamePlanner.tsx` (REFERENCE - No Changes Required)
- **Note (Blocker #3 - Implicit Dependency):**
  - GamePlanner component indirectly uses `calculateFairRotations` when coach regenerates rotation plan
  - With service-level filtering implemented (see rotationPlannerService), GamePlanner automatically benefits
  - If coach marks a player injured during halftime, then switches to GamePlanner tab to regenerate rotations, the service will exclude the injured player
  - **No code changes to GamePlanner needed** — dependency is automatically satisfied by service-level filtering
  - **Assumption:** GamePlanner passes `playerAvailabilities` to `calculateFairRotations` options (verify during code review)

#### `src/components/GameManagement/RotationWidget.tsx` (MODIFY)
- **Changes (Secondary Filtering - Primary happens in service per Blocker #2):**
  - RotationWidget already calls `calculateFairRotations` to generate auto-suggestions
  - With service-level filtering now active (see rotationPlannerService), injured players are excluded by the service
  - RotationWidget can optionally apply secondary call-site filtering before calling service (for UI optimization):
    - Filter `availablePlayers` array to exclude injured:
      ```typescript
      const nonInjuredPlayers = availablePlayers.filter(p => {
        const availability = playerAvailabilities.find(a => a.playerId === p.playerId);
        return availability?.status !== 'injured';
      });
      ```
    - Pass `nonInjuredPlayers` (not `availablePlayers`) to `calculateFairRotations`
    - Add comment: "Secondary call-site filtering for performance; service also filters injured players (defense-in-depth)"
  
  - Ensure `playerAvailabilities` prop is passed to `calculateFairRotations` via options
  
  - Update `handleQueueAll` to skip injured players:
    - Current logic already checks `getPlayerAvailability(sub.playerInId) === 'available'` before queueing
    - Injured players will have status='injured', so condition naturally fails
    - No changes needed

  - Add explicit all-injured planned-ins warning copy:
    - `No rotation changes available. Planned players are marked injured.`

- **Tests:** Update `RotationWidget.test.ts`
  - Test rotation suggestions exclude injured players (even without service filtering)
  - Test secondary filtering works independently

#### `src/components/GameManagement/types.ts` (MODIFY if needed)
- **Changes:**
  - Verify `PlayerWithRoster` includes id, firstName, lastName, playerNumber
  - Add `GameMutationInput` reference if not already there
  - No major changes expected

### 3. **Modified Files - Services & Hooks**

#### `src/hooks/useOfflineMutations.ts` (MODIFY)
- **Critical Changes (Blocker #1 - createPlayerAvailability):**
  - Add to `ALLOWED_MODELS` set: `'PlayerAvailability'` (currently: `['Game', 'PlayTimeRecord', 'Substitution', 'LineupAssignment', 'Goal', 'GameNote']`)
  
  - Add two new interfaces for both create and update operations:
    ```typescript
    export interface PlayerAvailabilityCreateFields {
      gameId: string;
      playerId: string;
      status: string;
      markedAt: string;
      coaches?: string[] | null;
      availableUntilMinute?: number | null;
      notes?: string | null;
    }
    
    export interface PlayerAvailabilityUpdateFields {
      id: string;  // id is required for update
      status?: string | null;
      availableUntilMinute?: number | null;
      markedAt?: string | null;
      notes?: string | null;
    }
    ```
  
  - Add to `GameMutationInput` interface:
    ```typescript
    createPlayerAvailability: (fields: PlayerAvailabilityCreateFields) => Promise<void>
    updatePlayerAvailability: (id: string, fields: PlayerAvailabilityUpdateFields) => Promise<void>
    ```
  
  - **Implementation sequence (critical for injury marking):**
    1. BenchTab calls `handleMarkInjured(playerId)`
    2. Check if PlayerAvailability record exists for (gameId, playerId) pair via query
    3. If NO existing record: call `mutations.createPlayerAvailability(...)` with status='injured'
    4. If existing record: call `mutations.updatePlayerAvailability(record.id, { status: 'injured', ... })`
    5. Both operations routed through `enqueueOrRun` → queued or executed immediately
  
  - Implement both functions (follow existing pattern for Goal, PlayTimeRecord):
    ```typescript
    const createPlayerAvailability = useCallback(
      async (fields: PlayerAvailabilityCreateFields): Promise<void> => {
        await enqueueOrRun(
          'PlayerAvailability', 'create',
          fields as unknown as Record<string, unknown>,
          () => client.models.PlayerAvailability.create(fields).then(() => undefined)
        );
      },
      [enqueueOrRun]
    );

    const updatePlayerAvailability = useCallback(
      async (id: string, fields: PlayerAvailabilityUpdateFields): Promise<void> => {
        await enqueueOrRun(
          'PlayerAvailability', 'update',
          { id, ...fields },
          () => client.models.PlayerAvailability.update({ id, ...fields }).then(() => undefined)
        );
      },
      [enqueueOrRun]
    );
    ```

- **Offline Handling:**
  - When offline, both create and update enqueued in IndexedDB with `ownerSub` captured
  - On reconnect, queue drained in FIFO order; mutations replayed against GraphQL API
  - If create fails (network error), mutation retried on next sync with existing retry logic

- **No new tests required** (existing offline queue tests cover this pattern)

#### `src/services/rotationPlannerService.ts` (MODIFY)
- **Critical Changes (Blocker #2 - Defense-in-Depth Filtering):**
  - Move injury filtering **into** `calculateFairRotations` itself; do NOT rely on call-site filtering alone
  - This ensures injured players are excluded whether called from RotationWidget, GamePlanner, or future components
  
  - Update function signature:
    ```typescript
    export function calculateFairRotations(
      availablePlayers: SimpleRoster[],
      startingLineup: ...,
      ...,
      options?: RotationOptions & { playerAvailabilities?: PlayerAvailability[] }
    ): RotationResult
    ```
  
  - **Add filtering logic at start of function (before main rotation loop, around line ~80):**
    ```typescript
    // Filter out injured players - defense in depth: filtering happens here,
    // not just at call sites, to ensure injured players are never suggested
    // regardless of where calculateFairRotations is invoked from.
    const filteredAvailablePlayers = availablePlayers.filter(p => {
      const availability = options?.playerAvailabilities?.find(
        a => a.playerId === p.playerId
      );
      return availability?.status !== 'injured';
    });
    
    if (filteredAvailablePlayers.length === 0) {
      warnings.push('No available players—all have been marked injured.');
      return { rotations: [], warnings };
    }
    
    // Use filteredAvailablePlayers in place of availablePlayers for rest of algorithm
    const workingPlayers = filteredAvailablePlayers;
    ```
  
  - **Update JSDoc to document this:**
    ```typescript
    /**
     * Calculate fair team rotations based on player availability.
     * 
     * IMPORTANT: Injuries are filtered at service level (not call-site only).
     * Any player with status='injured' in playerAvailabilities is excluded
     * from rotation suggestions, regardless of where this function is called from.
     * This provides defense-in-depth: BenchTab and RotationWidget apply
     * secondary call-site filtering for UI feedback, but service-level filtering
     * is the primary control.
     */
    ```

- **Call Site Filtering (Secondary, for UI feedback):**
  - RotationWidget and GamePlanner should still filter at call site (as noted in BenchTab/RotationWidget sections)
  - This is secondary validation and UI performance optimization, not primary control
  - Example: RotationWidget filters before calling service, service filters again, resulting in double-validation
  
- **No algorithm changes** — filtering only removes players from candidate pool, algorithm logic unchanged

- **Tests:** Update `rotationPlannerService.test.ts`
  - Add test: `calculateFairRotations` excludes all players with status='injured'
  - Add test: warning generated if all players injured ("No available players...")
  - Add test: service filtering works independently (even if call site doesn't filter)

#### `src/utils/analytics.ts` (MODIFY)
- **Changes:**
  - Add new event to `AnalyticsEvents`:
    ```typescript
    PLAYER_RECOVERED_FROM_INJURY: { category: 'GameDay', action: 'Player Recovered From Injury' }
    ```
  - `PLAYER_MARKED_INJURED` already exists—no change needed

- **No tests required** (analytics module tested via component integration tests)

### 4. **Modified Files - State & Context**

#### `src/contexts/AvailabilityContext.tsx` (REVIEW - No Code Changes Required)
- **Critical Analysis (Blocker #7 - Update Mechanism):**
  - **Current Implementation:** AvailabilityContext is a simple wrapper providing `getPlayerAvailability(playerId): string`
  - **Update Mechanism (via subscriptions):**
    - `playerAvailabilities` array is managed in `GameManagement` component
    - `useGameSubscriptions` hook (in GameManagement) subscribes to PlayerAvailability changes via GraphQL
    - When a mutation completes (locally or after sync), GraphQL subscription automatically updates the `playerAvailabilities` state
    - AvailabilityContext wraps this state and provides access to components
  
  - **Flow (when coach marks injured):**
    1. BenchTab calls `mutations.updatePlayerAvailability(...)` or `mutations.createPlayerAvailability(...)`
    2. If online: mutation sent to server immediately; GraphQL subscription receives update; `playerAvailabilities` state updated in GameManagement
    3. If offline: mutation queued in IndexedDB; on reconnect, queue drained; mutation sent; subscription receives update; state updated
    4. AvailabilityContext automatically reflects new state (no manual refetch needed)
  
  - **Conclusion:** Real-time subscription mechanism already in place. No changes needed to AvailabilityContext.
  
  - **Test Coverage:**
    - E2E test: Mark player injured → verify PlayerAvailability record created in DB → verify UI reflects change
    - E2E test: Mark injured offline → go online → verify mutation synced → verify UI updated from subscription

- **Note:** This is re-confirmation of existing architecture—no implementation work needed

#### `src/components/GameManagement/GameManagement.tsx` (MODIFY)
- **Critical Changes (Blocker #6 - Prop Plumbing):**
  - BenchTab needs four additional props to support injury marking:
    - `playerAvailabilities: PlayerAvailability[]` — already available in component state (from useGameSubscriptions hook)
    - `mutations: GameMutationInput` — already available (from useOfflineMutations hook)
    - `currentTime: number` — already available (from useGameTimer)
    - `team: Team` — already available (from props)
  
  - **Changes to BenchTab call site (around line ~600):**
    ```typescript
    // Before:
    <BenchTab 
      players={players}
      lineup={lineup}
      playTimeRecords={playTimeRecords}
      currentTime={currentTime}
      halfLengthSeconds={...}
      onSelectPlayer={handleSelectPlayer}
    />
    
    // After:
    <BenchTab 
      players={players}
      lineup={lineup}
      playTimeRecords={playTimeRecords}
      currentTime={currentTime}
      halfLengthSeconds={...}
      onSelectPlayer={handleSelectPlayer}
      playerAvailabilities={playerAvailabilities}           // NEW
      mutations={mutations}                                  // NEW
      gameId={game.id}                                       // NEW (needed for creating PA records)
      team={team}                                            // NEW
    />
    ```
  
  - **Estimated line changes:** ~15 lines (prop additions + threading through component)

  - **Halftime access update:**
    - Add halftime CTA to open shared injury/recovery modal (same logic surface used by BenchTab)
    - Ensure this CTA is available in `halftime` state to satisfy active-game requirement parity
  
- **Dependency Chain:**
  - GameManagement already has `playerAvailabilities` from `useGameSubscriptions` hook (no new subscription needed)
  - GameManagement already has `mutations` from `useOfflineMutations` hook (no new mechanism needed)
  - BenchTab cannot function without these props—dependency is hard

- **No changes to other GameManagement logic** — only prop threading to BenchTab

### 5. **Test Files**

#### `src/components/GameManagement/BenchTab.test.tsx` (MODIFY)
- **Add tests:**
  - Injury button renders only during active games (in-progress/halftime)
  - Injury button does NOT render during scheduled/completed
  - Confirmation dialog appears on injury button click
  - Correct message displayed in dialog
  - On confirm: mutation called with correct payload (gameId, playerId, status='injured', availableUntilMinute=gameSeconds, markedAt=now())
  - On cancel: no mutation called
  - Injured player row displays CSS class `--injured` and visual indicator
  - Unmark button appears on injured player, triggers recovery flow
  - Recovery flow calls mutation with status='available'

#### `src/components/GameManagement/SubstitutionPanel.test.tsx` (MODIFY)
- **Add tests:**
  - Injured players filtered from available candidates list
  - Uninjured players still available for substitution
  - Empty state message if all candidates injured
  - Queued player auto-removed when injury status changes to injured

#### `src/components/GameManagement/RotationWidget.test.ts` (MODIFY)
- **Add tests:**
  - Auto-generated rotation suggestions exclude injured players
  - All-planned-ins-injured warning copy renders
  - Rotation recalculation triggered by injury state changes

#### Accessibility & Responsive Tests (MODIFY/ADD)
- **BenchTab accessibility tests:**
  - Verify player-specific aria-labels for injury/recovery buttons
  - Verify visible `Injured` text renders when status is injured
  - Verify keyboard activation path (open modal, confirm/cancel, focus return)
  - Verify SR live region announcements for injury/recovery and queue auto-removal
- **Responsive UI tests (component/integration):**
  - Phone breakpoint snapshot/assertion: no overlap between primary row action and secondary injury/recovery control
  - Tablet breakpoint snapshot/assertion: spacing rhythm preserved versus current baseline

#### `src/services/rotationPlannerService.test.ts` (MODIFY)
- **Add tests:**
  - `calculateFairRotations` excludes injured players
  - Warning generated if insufficient uninjured players remain

#### `src/utils/availabilityUtils.test.ts` (NEW)
- **Tests:**
  - `isPlayerInjured(playerIdWithStatus, array) === true`
  - `isPlayerInjured(playerIdWithoutRecord, array) === false`
  - `isPlayerAvailable()` opposite cases
  - Edge cases (empty array, undefined, null)

#### E2E Tests Extension
- **File:** `e2e/issue-tracking.spec.ts` (or create `e2e/injury-marking.spec.ts`)
- **New test scenario:**
  1. Login and navigate to active game
  2. Open BenchTab
  3. Click injury button on bench player
  4. Confirm in dialog
  5. Verify:
     - Player shows injury indicator
     - Player not selectable in SubstitutionPanel
     - Player not in RotationWidget suggestions
  6. Click recover/unmark button
  7. Verify player available again in all lists
  8. Refresh page and verify injury state persisted

---

## Data Model & API Impacts

### GraphQL Schema Changes
**None required.** PlayerAvailability model already supports:
- ✅ `status: string` (can be 'available', 'absent', 'injured', 'late-arrival')
- ✅ `availableUntilMinute: integer` (for injury timestamp storage — audit-only, not behavioral)
- ✅ `markedAt: datetime` (for audit/tracking)
- ✅ `coaches: string[]` (for authorization)

### Clarification: availableUntilMinute Field (Blocker #4)
- **Semantic Decision:** `availableUntilMinute` is **AUDIT-ONLY**, NOT behavioral
- **Reasoning:** Review of RotationWidget.tsx (line ~119) shows recovery clears this field with `null` parameter regardless of game time. Filtering is strictly by `status === 'injured'`, not by time comparison.
- **Implication:** No time-based cutoff logic needed. Once marked injured (status='injured'), player remains filtered until explicitly recovered (status='available').
- **Usage:** 
  - When marking injured: set `availableUntilMinute = Math.floor(currentGameSeconds / 60)` for audit trail
  - When recovering: set `availableUntilMinute = null` to clear audit marker
  - Filtering code checks only: `if (status !== 'injured')` — does NOT check availableUntilMinute value

### API Operations
**New Mutations (via useOfflineMutations):**
- `mutations.createPlayerAvailability({ gameId, playerId, status, markedAt, coaches, availableUntilMinute })`
- `mutations.updatePlayerAvailability(id, { status, availableUntilMinute, markedAt })`

**No New Endpoints:** Existing GraphQL mutations handle both create and update.

### Authorization Impact
- ✅ No changes needed—current `coaches` array field already provides authorization
- ✅ All users with current access to PlayerAvailability can mark/recover

---

## Dependencies & Sequencing

### Build Order (Must Implement in This Order)

| Phase | Files | Reason |
|-------|-------|--------|
| **1** | `src/utils/availabilityUtils.ts` (+ tests) | Foundation—other files depend on utilities |
| **2** | `src/hooks/useOfflineMutations.ts` | Needed by BenchTab for mutations |
| **3** | `src/utils/analytics.ts` | Add new event (lightweight dependency) |
| **4** | `src/components/GameManagement/BenchTab.tsx` | Core UI for marking injury—can test in isolation with mocks |
| **5** | `src/components/GameManagement/SubstitutionPanel.tsx` | Reuses availabilityUtils—depends on BenchTab working first |
| **6** | `src/services/rotationPlannerService.ts` | Filtering logic—integrates with RotationWidget |
| **7** | `src/components/GameManagement/RotationWidget.tsx` | Integrates rotation service updates |
| **8** | E2E tests | Validates full end-to-end flow |

### External Dependencies
- ✅ `useConfirm()` — already available
- ✅ `ConfirmModal` — already implemented
- ✅ `PlayerAvailability` model — already in schema
- ✅ `useOfflineMutations` pattern — already established

---

## Edge Cases & Error Scenarios

### 1. **Race Condition: Mark Injured, Offline, Then Recover While Offline (Blocker #5)**
- **Scenario:** 
  1. Coach marks Player A injured (mutation queued → queued)
  2. Coach goes offline
  3. Coach marks Player A recovered while offline (mutation queued → queued)
  4. Coach goes back online; queue drained in FIFO order
  
- **Chosen Mitigation Strategy (Option B - FIFO Trust):**
  - Rely on existing `useOfflineMutations` queue replay behavior.
  - In `useOfflineMutations`, queued mutations drain in FIFO order, so offline injury/recovery actions replay in the exact order performed by the coach.
  - No mutation precondition field is added.
  - No new resolver/Lambda/schema validation is introduced.

  - **Why this is acceptable for this scope:**
    - This feature already uses existing frontend mutation flow and offline queue infrastructure.
    - Typical same-device offline sequences (mark injured then recover) maintain correct final state when replayed FIFO.

  - **Known limitation:**
    - Concurrent edits by multiple coaches on the same player may still produce last-write ambiguity.

- **Test Coverage for Race Condition:**
  - Unit test: Verify queued injury then recovery replays in FIFO order and final status is `available`
  - E2E test (optional): Simulate offline → mark injured → mark recovered → go online → verify final state correct

### 2. **Multiple Injury Marks (No Race Condition)**
- **Scenario:** Coach marks player injured twice rapidly
- **Handling:** useOfflineMutations queues both updates; second update overwrites first (idempotent)
- **Outcome:** Safe—last write wins (both set same status anyway)

### 2. **Offline During Injury Mark**
- **Scenario:** Coach marks player injured while offline
- **Handling:** Mutation queued in IndexedDB; syncs on reconnect
- **Outcome:** Status eventually reaches server; safe

### 3. **Player Marked Injured, Then Queue Gets Cleared Server-Side**
- **Scenario:** Injury persists but queued substitutions removed externally
- **Handling:** Injury status independent of queue—player still marked injured
- **Outcome:** Correct—injury is persistent until explicitly recovered

### 4. **All Players Injured During Game (Edge Case)**
- **Scenario:** Entire bench gets injured mid-game
- **Handling:** 
  - SubstitutionPanel shows empty state: "No eligible substitutes. All bench players are marked injured."
  - RotationWidget shows warning: "No rotation changes available. Planned players are marked injured."
- **Outcome:** Coach cannot perform substitutions—expected behavior

### 9. **No Bench Players (Edge Case)**
- **Scenario:** Team has no bench players in current game state
- **Handling:** Bench/Substitution surfaces show `No bench players available.`
- **Outcome:** Injury/recovery controls are not rendered; no confusing empty actions

### 10. **Queued Player Becomes Injured (Edge Case)**
- **Scenario:** Player is in substitution queue and is then marked injured
- **Handling:** Player is automatically removed from queue and user gets explicit message: `Removed from queue: player marked injured.`
- **Outcome:** Queue remains valid and executable; accidental injured substitution prevented

### 5. **Injury Marked at Exact Halftime**
- **Scenario:** availableUntilMinute set to 30 (if halftime is 30 min), injury visible second half?
- **Handling:** availableUntilMinute is audit field only—injury status persists until manual recovery
- **Outcome:** Correct—audit trail preserved, injury continues second half

### 6. **Late-Arrival Player Gets Injured Before Arrival Time**
- **Scenario:** PlayerAvailability has status='late-arrival' with availableFromMinute=15, coach marks injured at 5min
- **Handling:** Injury creates new or updates existing record; status='injured' overrides late-arrival
- **Outcome:** Player remains marked injured; late-arrival window ignored

### 7. **Network Failure During Offline Drain**
- **Scenario:** Coach marks injured offline, then goes back online, but drain fails
- **Handling:** useOfflineMutations retry logic (MAX_RETRIES) handles it; user sees warning
- **Outcome:** Mutation preserved in queue for next sync attempt

### 8. **Refresh Page During Pending Injury Mutation**
- **Scenario:** Coach marks player injured, page refreshes before mutation completes
- **Handling:** Offline queue persisted in IndexedDB; query subscriptions pick up confirmed status
- **Outcome:** Injury status restored from query on page reload

---

## Test Strategy

### Unit Tests (Vitest)
| Component/Module | New Tests | Updated Tests |
|---|---|---|
| `availabilityUtils` | `isPlayerInjured()`, `isPlayerAvailable()`, edge cases | N/A |
| `BenchTab` | Injury button, confirmation, mutation calls, visual indicator | Entire component |
| `SubstitutionPanel` | Injured player filtering, empty state | Candidate selection logic |
| `RotationWidget` | Rotation exclusion, recalc on injury | Suggestion generation |
| `rotationPlannerService` | Injured player exclusion from fair rotation | Availability filtering |
| `useOfflineMutations` | PlayerAvailability mutations | Existing mutation patterns |
| `analytics` | N/A | Verify new event added |

### Component Integration Tests
- BenchTab + AvailabilityContext: confirm context provides injury status correctly
- SubstitutionPanel + BenchTab: ensure filtering works when both visible
- GameManagement orchestrator: verify all props threaded correctly

### E2E Tests (Playwright)
- Full workflow: login → open active game → mark player injured → verify filtered from all suggestion UI → recover → verify re-added

### Manual Regression Testing
- Verify offline functionality: mark injured → go offline → go online → verify synced
- Verify plan conflicts: create plan with injured player, verify plan conflict UI shows "injured" status
- Verify halftime transition: mark injured in first half → halftime → second half → verify still injured

---

## Success Criteria Checklist

- [ ] Bench player injury button renders only during active games
- [ ] Confirmation dialog appears, can be confirmed/cancelled
- [ ] Confirmation copy explicitly states substitution/rotation impact with actions `Mark Injured`/`Cancel` and `Mark Available`/`Cancel`
- [ ] PlayerAvailability updated in database after confirmation
- [ ] Injured players show visual indicator on bench
- [ ] Bench row primary substitution action and injury/recovery action do not conflict
- [ ] Injured players excluded from SubstitutionPanel suggestions
- [ ] Injured players excluded from RotationWidget auto-suggestions
- [ ] Halftime surface provides injury/recovery access via shared modal entry point
- [ ] Unmark/recover action works and fires correct event
- [ ] Queued player auto-removed when marked injured
- [ ] Offline queue & sync works for injury mutations
- [ ] `PLAYER_MARKED_INJURED` event fired on mark
- [ ] `PLAYER_RECOVERED_FROM_INJURY` event fired on recovery
- [ ] Accessibility criteria met (aria-labels, visible `Injured` text, SR announcements, focus return, keyboard path)
- [ ] Responsive criteria met on phone (no overlap) and tablet (visual rhythm preserved)
- [ ] Interaction-state matrix implemented for BenchTab + halftime injury modal (`idle`, `confirming`, `submitting`, `queued-offline`, `sync-success`, `sync-failure`, `retryable-failure`)
- [ ] Modal accessibility criteria met (role, labels/descriptions, initial focus, focus trap, Escape/backdrop behavior, deterministic focus return)
- [ ] Accidental-tap hardening active (one-shot in-flight confirm, duplicate-submit prevention, progress-label disabling)
- [ ] Discoverability rules met (persistent text label on phone, action prominence, halftime helper hint)
- [ ] Injured indicator legibility targets met (contrast, size/weight, non-color cue in compact rows)
- [ ] Expanded responsive checks pass (320px portrait, narrow landscape, 200% zoom, long-string overflow strategy preserving tap targets)
- [ ] Decision lock applied: halftime CTA copy `Manage Injuries`; offline feedback row + global echo; recovery label strategy by breakpoint
- [ ] Visual consistency uses tokenized status patterns and avoids emoji-only indicators
- [ ] All unit tests pass for modified components/services
- [ ] E2E test covers full workflow (mark → detect filtering → recover)
- [ ] Page refresh preserves injury state
- [ ] Plan conflict detection shows "injured" status as it already does for "absent"

---

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Race condition: duplicate injury marks | Low (updates idempotent) | Medium | useOfflineMutations handles deduplication |
| Filtering logic omitted in one component | High (UX inconsistency) | Medium | Centralized utility + service-level filtering + E2E test validates all three points (BenchTab, SubPanel, RotWidget) |
| Offline sync fails, injury state lost | Medium | Low | IndexedDB persists queue; retry logic attempts sync until MAX_RETRIES |
| Coach cannot undo injury accidentally | Low | Low | Confirmation dialog + recovery action mitigate |
| Performance: filtering arrays on every render | Low | Low | Filter happens in useEffect/useMemo; no on-render filtering overhead |

---

## Artifacts & Documentation

### Plan Documents Created
- ✅ This file: `docs/plans/injury-marking-feature-plan.md`

### Code Comments/Documentation to Add
- Comment in rotationPlannerService: "Injuries filter happens before rotation algo — see availabilityUtils.isPlayerInjured()"
- Comment in BenchTab: "Injury status managed via PlayerAvailability model — changes propagate via AvailabilityContext"
- JSDoc on availabilityUtils functions: "Returns true if player status is 'injured' in current game"

### Specs to Reference
- None new—existing PlayerAvailability & offline queue patterns apply

---

## Handoff Notes for UI-Designer Verification

1. **Interaction model confirmation:**
  - Bench row primary substitution action and secondary injury/recovery button are separate, non-nested controls.
  - Secondary control has minimum 44x44 tap target and explicit propagation handling to prevent accidental substitutions.

2. **Halftime access confirmation:**
  - Approach B (shared modal reachable from halftime) is acceptable within existing halftime layout patterns.
  - Halftime CTA placement and discoverability meet active-game requirement intent.

3. **Copy and state language confirmation:**
  - Modal copy includes explicit effect language for both injury and recovery.
  - Button labels are exactly `Mark Injured`, `Mark Available`, and `Cancel`.
  - Empty/edge state copy for all-injured, no-bench, and queue auto-removal is clear and actionable.

4. **A11y and responsive confirmation:**
  - Accessibility acceptance criteria are complete (aria-labels, visible text indicator, SR announcements, focus return, keyboard path).
  - Phone/tablet constraints preserve readability and visual rhythm.

---

## Timeline & Effort Estimate

| Phase | Effort | Notes |
|---|---|---|
| Phase 1: Utilities + Hooks | 1–2 hours | availabilityUtils, useOfflineMutations update |
| Phase 2: BenchTab Implementation | 2–3 hours | UI, confirmation, injury button logic |
| Phase 3: Filtering in SubPanel + RotWidget | 1–2 hours | Straightforward array filtering |
| Phase 4: rotationPlannerService Update | 30–60 min | Minimal algorithm change |
| Phase 5: Unit Tests | 2–3 hours | Comprehensive test coverage |
| Phase 6: E2E Tests | 1–2 hours | Full workflow validation |
| Phase 7: Integration Testing | 1–2 hours | Cross-component interaction |
| **Total Estimate** | **9–15 hours** | Includes review + debug |

