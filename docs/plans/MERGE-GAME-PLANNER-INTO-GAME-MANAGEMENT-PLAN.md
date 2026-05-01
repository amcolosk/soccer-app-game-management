# Merge GamePlanner into GameManagement — Implementation Plan

**Date:** 2026-04-25  
**Status:** Ready for Implementation (Architect Review Resolved)

---

## Summary

Remove the separate `/game/:gameId/plan` route and `GamePlanner` component. Unify `GameManagement` into a single continuous dashboard shell (`CommandBand` + 5-tab `TabNav`) across all game states. The Home page collapses to a single "Open Game" button for all game statuses. Subscriptions for GamePlan and PlannedRotations are managed via a new isolated `useGamePlanSubscriptions` hook.

---

## Addendum (2026-04-27) — Restore Missing Pregame Planner Capabilities

### Objective

Restore pregame planner capabilities inside merged `GameManagement` Plan tab without reintroducing standalone `GamePlanner` route UX:

1. Rotation strategy controls in pregame (minimum: editable rotation interval; keep coupled strategy behavior from prior planner UX).
2. Pregame editable halftime formation/lineup editor before kickoff.

### Confirmed Current-State Gaps

- `PlanTab` currently renders availability + `LineupPanel`, but no editable rotation settings or timeline selection UI.
- `GamePlan.halftimeLineup` exists in schema and copy service, but is not surfaced/edited in merged Plan tab flow.
- Live-game Plan tab read-only mode is present and must remain intact.

### Implementation Scope (planned)

- Keep merged `/game/:gameId` route and existing `TabNav` shell.
- Add planner controls to `PlanTab` (scheduled state only), reusing existing timeline/lineup helper utilities and existing planner CSS tokens where possible.
- Persist to existing `GamePlan` and `PlannedRotation` records (no schema changes).

### Sequencing

1. Add planner state/handlers in `GameManagement` for scheduled Plan tab (rotation interval, derived rotations-per-half, selected timeline pill, halftime lineup draft).
2. Extend `PlanTab` props and render blocks to show setup controls + timeline + selected details panel (scheduled only).
3. Wire create/update flows for `GamePlan` + `PlannedRotation`, including halftime diff semantics.
4. Preserve read-only behavior and accessibility contracts for in-progress/halftime Plan tab.
5. Add/update component and e2e coverage for restored controls and halftime editor.

### Validation Focus

- Pregame: coach can set interval/strategy and edit halftime lineup before kickoff.
- Live game: Plan tab remains read-only and does not expose mutation controls.
- Halftime lineup persists to `GamePlan.halftimeLineup` and drives halftime substitutions consistently.

---

## Addendum (2026-04-27, Rev B) — Architecture Blocker Resolution

This revision is authoritative for planner data ownership, halftime contracts, persistence semantics, status gating, subscription scoping, and concurrency test coverage.

## Addendum (2026-04-27, Rev C) — Architecture Blockers Round 2 Resolution

This revision adds explicit fail-closed and deterministic contracts required to unblock architecture review. Where Rev B wording is broader, Rev C is normative and takes precedence.

## Addendum (2026-04-27, Rev D) — UI Blockers Resolution (Normative)

This revision is authoritative for Plan tab interaction semantics, restored rotation settings behavior, empty-state copy, and responsive acceptance criteria. Where older sections conflict, Rev D takes precedence.

### Canonical Rotation Formula

**Canonical formula for rotations per half:**
```
rotationsPerHalf = floor(halfLengthMinutes / rotationIntervalMinutes) - 1
```

This formula ensures fair distribution of rotations. For example, with a 30-minute half:
- 5-minute interval → floor(30/5) - 1 = 5 rotations
- 10-minute interval → floor(30/10) - 1 = 2 rotations
- 15-minute interval → floor(30/15) - 1 = 1 rotation

**Reference:** See [docs/specs/Game-Planner-Rotation-Input.md §3.2](docs/specs/Game-Planner-Rotation-Input.md) for derivation semantics and coupled control behavior (§3.2–§3.4).

### 1) Plan Timeline Interaction + Accessibility Contract (Normative)

- Timeline pills are a single-select tabset for inspection and selection state only.
- Container semantics:
  - Timeline wrapper uses `role="tablist"` and `aria-label="Plan timeline"`.
  - Each pill uses `role="tab"` and controls exactly one details panel with `aria-controls="plan-timeline-panel-<key>"`.
  - Each details panel uses `role="tabpanel"`, `id="plan-timeline-panel-<key>"`, and `aria-labelledby="plan-timeline-tab-<key>"`.
- Selection semantics:
  - Exactly one pill has `aria-selected="true"`; all others must be `false`.
  - Use roving tabindex (`tabIndex=0` only on selected pill; all others `-1`).
- Keyboard semantics:
  - `ArrowRight`/`ArrowLeft`: move focus to next/previous pill (wrap allowed).
  - `Home`/`End`: move focus to first/last pill.
  - `Enter`/`Space`: activate focused pill (selection update + details panel update).
- Focus + visibility semantics:
  - Programmatic focus changes must call `element.focus({ preventScroll: true })` then `scrollIntoView({ inline: 'nearest', block: 'nearest' })` for horizontal timeline visibility.
  - On tab open, focus lands on currently selected timeline pill in scheduled mode when user enters timeline region via keyboard.
  - Selection changes must not move focus out of the tablist.
- Testing requirements:
  - Unit tests validate role/ARIA linkage, roving tabindex, and key handling (`Arrow*`, `Home`, `End`, `Enter`, `Space`).
  - E2E tests validate keyboard-only traversal, selection, and horizontal scroll-into-view behavior on narrow mobile widths.

### 2) Rotation Settings Restoration Contract (Normative, UI-SPEC Aligned)

- Inputs restored in scheduled Plan tab:
  - `Half length (minutes)` numeric input.
  - `Every <N> min` rotation interval input.
  - Derived `Rotations per half` display/input pair with coupled behavior.
- Half length behavior:
  - Clamp to integer range `1-99`.
  - Invalid or empty edit state may exist while typing, but persisted value must normalize/clamp before save commit.
  - Save is immediate on committed value change (blur, Enter, stepper, paste-commit); no explicit "Save Settings" button.
  - Include `Reset to team default` link action that restores team-configured half length and immediately persists the restored value.
- Coupled settings behavior:
  - `rotationsPerHalf = floor(halfLengthMinutes / rotationIntervalMinutes) - 1` (canonical; see Canonical Rotation Formula above and `docs/specs/Game-Planner-Rotation-Input.md`), clamped to a non-negative display value.
  - Editing `Every <N> min` updates derived `Rotations per half` instantly.
  - Editing `Rotations per half` updates derived `Every <N> min` instantly using deterministic integer conversion policy documented in code/tests.
  - Derivations must run instantly (no debounce/throttle).
- Mobile numeric behavior:
  - Numeric controls use `inputMode="numeric"` and digit-only validation hints while preserving accessible labels and helper text.
  - Inputs remain keyboard accessible on desktop and touch-accessible on mobile.
- Testing requirements:
  - Unit tests for clamp, reset-to-default, coupled derivation math, and immediate persistence behavior.
  - E2E coverage for phone-sized viewport editing both coupled fields and verifying persisted values after refresh.

### 3) Design Token Governance (Normative Override)

- Do not introduce new ad hoc CSS tokens in this scope.
- Use only the existing token system already defined in the repository design system and UI-SPEC.
- Any previously listed "new token" examples in this plan are non-normative and superseded by this requirement.

### 4) Fallback + Empty-State Acceptance Criteria (Normative)

- Required scheduled-state empty/partial copy:
  - No saved plan: `No plan yet. Set rotation settings and lineup to create your plan.`
  - No planned rotations after save/config: `No rotations generated yet. Use Auto-Generate to create a timeline.`
  - Timeline item with no assigned players: `No players assigned for this step.`
  - Read-only live state with no historical plan data: `Plan details unavailable for this game state.`
- Required behavior:
  - Empty states render in both visual UI and accessible text flow (screen-reader readable, not placeholder-only).
  - Empty-state container must not collapse layout or hide tabpanel semantics.

### 5) Responsive Acceptance Criteria (Normative)

- Plan tab layout requirements:
  - Phone (<=430px): timeline supports horizontal scroll; controls stack without clipping; no horizontal page overflow.
  - Tablet (>=600px): controls and timeline use multi-column layout where available without reducing touch target size.
- Touch target requirements:
  - Timeline pills and primary controls must be at least 44x44 CSS px.
  - Interactive spacing must prevent accidental adjacent activation on touch devices.
- Verification requirements:
  - E2E viewports include at minimum 375x667, 390x844, and 768x1024.
  - Acceptance checks include keyboard navigation, touch usability, and absence of clipped labels/controls.

### 6) Live Read-Only Timeline Decision (Resolved)

- Decision: Keep timeline interaction enabled for inspection-only selection in live read-only states (`in-progress`, `halftime`, `completed`).
- Live-state behavior:
  - Selecting a timeline pill is allowed and updates details panel only.
  - Any action that would mutate plan data remains hidden or disabled per read-only rules.
  - Keyboard navigation remains active for timeline inspection (`Arrow*`, `Home`, `End`, `Enter`, `Space`).
  - Focus management and ARIA semantics remain identical to scheduled mode.

### 7) Superseded Guidance Map

- Phase 1.2 and Phase 3.4 token-creation examples are superseded by Rev D Section 3.
- Any previous wording that implies debounce for coupled rotation derivations is superseded by Rev D Section 2 (instant derivations required).

### 1) Stable-Key Normalization + Duplicate Handling (Normative)

#### Canonical key format
- Every `PlannedRotation` record must normalize to a canonical key string before diffing and persistence.
- Canonical key format must be: `H<half>:M<minute>:<slotType>` where:
  - `<half>` is `1` or `2`
  - `<minute>` is zero-padded integer game-minute marker (`00`-`99`)
  - `<slotType>` is `ROT` for normal rotation markers, `HT` for halftime sentinel
- Halftime sentinel must always normalize to `H2:M00:HT`.
- Canonical key comparison must be case-sensitive after normalization and whitespace-trimmed before normalization.

#### Deterministic duplicate winner / tie-break
- If multiple candidate records normalize to the same key, resolver must pick exactly one winner using this strict order:
  1. Highest `updatedAt` timestamp wins.
  2. If tied or missing, lexicographically greatest `id` wins.
  3. If still tied due to malformed inputs, lexicographically greatest full JSON payload string wins.
- Losers must be marked duplicate-conflict entries and excluded from desired write set.

#### Unresolvable duplicate behavior
- If winner resolution cannot complete deterministically (for example, invalid timestamp parsing plus missing ids plus non-serializable payload), commit must fail closed:
  - perform no create/update/delete writes for that save attempt
  - return typed conflict result to UI with blocking planner error state
  - require explicit user refresh or retry after hydration repair

### 2) Fail-Closed Scheduled-Only Commit Sequence for Planner Mutations (Normative)

#### Pre-check + fresh status read at commit boundary
- Planner mutations must execute two status checks:
  - Entry pre-check against in-memory game status.
  - Commit-boundary fresh read from backend immediately before first write.
- Both checks must equal `scheduled`; otherwise mutation must return no-op reject and write nothing.

#### Per-write-phase gating and ordering
- Writes must run in this exact order, each phase gated by current status and prior phase success:
  1. Upsert `GamePlan` core payload (including `startingLineup`, rotation settings, and `halftimeLineup`).
  2. Recompute desired normalized rotation set from saved plan snapshot.
  3. Diff and apply `PlannedRotation` changes in deterministic order: updates, creates, deletes.
  4. Final verification read to confirm persisted revision fingerprint matches desired fingerprint.
- Before each phase, perform a fresh status read; if status is not `scheduled`, abort remaining phases.

#### Partial-write recovery / no-op policy
- If abort occurs after phase 1 and before phase 4, recovery must be fail-closed:
  - do not execute compensating best-guess writes
  - return partial-commit result containing last successful phase and expected retry path
  - next save attempt must recompute full diff from server state and behave idempotently
- If status transitions away from `scheduled` mid-sequence, remaining phases must no-op and planner must lock to read-only on next hydration tick.

### 3) Kickoff One-Way Projection Contract (Normative)

#### Exact stale predicate
- Starting-lineup projection from planner data to runtime lineup may run only at kickoff boundary (`scheduled` -> `in-progress`).
- Runtime lineup is stale only when any of the following is true:
  - no runtime assignments exist for the game, or
  - runtime assignments carry `source = planner-projection` and fingerprint differs from latest planned starting-lineup fingerprint, or
  - runtime assignments exist but all slots are unassigned while planned starting lineup has at least one assigned player.
- If none of the stale predicates are true, projection must not run.

#### Single owner trigger location
- Projection trigger must have a single owner location: kickoff transition handler in `src/components/GameManagement/GameManagement.tsx` (or delegated hook called only from this transition path).
- No other component, effect, or subscription callback may invoke runtime projection.

#### Non-overwrite guarantees once live
- After status is `in-progress`, `halftime`, or `completed`, planner persistence must never overwrite runtime `LineupAssignment` records.
- Halftime adjustments remain runtime substitution concerns and must not mutate planner source contracts.
- Any late planner save attempt after live transition must be rejected as scheduled-only no-op.

### 4) Composite Subscription Revision Semantics for Draft-Safe Hydration (Normative)

#### Revision fingerprint definition
- Hydration logic must compute a composite revision fingerprint over:
  - normalized `GamePlan` payload fields used by planner UI (`startingLineup`, `halftimeLineup`, rotation settings)
  - normalized `PlannedRotation` set sorted by canonical key and reduced to deterministic payload hash
- Fingerprint format must be stable string: `<gamePlanHash>:<plannedRotationSetHash>:<itemCount>`.

#### Dirty-draft interaction rules
- If local draft is clean, incoming fingerprint change must rehydrate planner draft from subscription state.
- If local draft is dirty and incoming fingerprint differs, planner must:
  - preserve local draft values
  - surface non-blocking "remote updates available" indicator
  - require explicit user action to reload remote state or keep editing
- If local draft is dirty and incoming fingerprint is identical, no rehydrate and no UI warning.

### Acceptance Criteria (Explicit)

#### Concurrency and idempotency
- Two-client scheduled save race yields deterministic persisted `PlannedRotation` set with no duplicate canonical keys.
- Repeating the same save payload produces zero net diff writes after first successful commit.
- Retry after transient failure recomputes from server state and converges to same final fingerprint.

#### Halftime integrity
- `GamePlan.halftimeLineup` remains canonical after every save and matches projected halftime sentinel rotation payload.
- Halftime sentinel key is unique (`H2:M00:HT`) and remains stable across regenerate/save cycles.
- Unassigned halftime slots round-trip without loss or implicit player assignment.

#### Status-race behavior
- If game status changes away from `scheduled` at any boundary check, planner mutation performs no further writes.
- Mid-flight status transition returns typed partial/no-op result and leaves runtime lineup untouched by planner writes.
- After kickoff, planner UI transitions to read-only and rejects mutation controls consistently.

### Guardrails (unchanged)

- Keep merged route UX: no return of standalone planner screen.
- No schema migration in this revision (reuse current `GamePlan` and `PlannedRotation` fields).
- Preserve recent security and read-only behavior fixes.
- Align planner inputs and behavior with `docs/specs/Game-Planner-Rotation-Input.md` and visual/accessibility expectations in `docs/specs/UI-SPEC.md`.

### 1) Single Source of Truth + Reconciliation Policy (scheduled lineup)

**Policy:**
- During `scheduled`, canonical planned lineup state is `GamePlan` (+ `PlannedRotation` timeline), not `LineupAssignment`.
- `LineupAssignment` remains runtime/on-field state and is not used as planner truth.
- At game start (`scheduled` -> `in-progress`), system performs a one-time projection: planned starting lineup is written to runtime lineup if runtime lineup is empty or stale.
- After game start, planner data is read-only and must not mutate runtime lineup directly.

**Reconciliation rules:**
- If `GamePlan.startingLineup` exists and differs from existing scheduled preview in `LineupAssignment`, planner view displays `GamePlan` as authoritative and flags runtime preview as derived/stale.
- If `GamePlan` absent, planner initializes from existing assignments for UX continuity, then persists back to `GamePlan` on save.
- No bidirectional merge loops; source precedence is one-way (`GamePlan` -> planner UI, then explicit save -> persistence).

### 2) Canonical Halftime Data Contract + Projection

**Canonical contract:**
- `GamePlan.halftimeLineup` is the canonical representation of halftime formation/lineup intent.
- Halftime `PlannedRotation` entry is a projection for rotation timeline and execution hints.

**Projection rules:**
- On save, compute/refresh halftime `PlannedRotation` from `GamePlan.halftimeLineup` (single deterministic mapping).
- On read, planner UI hydrates halftime editor from `GamePlan.halftimeLineup`; it does not infer canonical halftime lineup from `PlannedRotation` unless contract-repair fallback is triggered.
- Contract-repair fallback (legacy drift only): if halftime lineup missing but halftime rotation exists, derive lineup once, write back to `GamePlan.halftimeLineup`, and log/trace repair path.

**Determinism requirements:**
- Exactly one halftime rotation key per game plan.
- Halftime projection must preserve position keys and explicit unassigned slots.

### 3) Idempotent Diff-Based Rotation Persistence (stable keys)

**Stable key contract:**
- Each planned rotation uses deterministic identity per game: `gameId + timelineKey` (timeline key includes half + minute marker, and `HALFTIME` sentinel).
- Persistence layer performs a three-way diff by stable key:
  - `create`: key exists in desired set, not in stored set
  - `update`: key exists in both, payload changed
  - `delete`: key exists in stored set, not in desired set

**Idempotency requirements:**
- Re-saving unchanged plan is a no-op (no net writes).
- Retries produce identical stored state.
- Delete operations are scoped strictly to keys within current game.

### 4) Status-Gated Planner Mutations

**Hard gate:**
- Planner mutation entry points must assert `game.status === 'scheduled'` at invocation and immediately before write commit.
- Outside `scheduled`, operations return controlled no-op/reject result (no write) and surface non-blocking UI feedback.

**Covered mutations:**
- create/update game plan
- save halftime lineup
- generate/update/delete planned rotations
- copy plan from previous game

### 5) Subscription Isolation to Avoid observeQuery Churn

**Scoping model:**
- Keep planner subscriptions isolated in `useGamePlanSubscriptions`.
- Use narrow filters and stable memoized selectors (`gameId`, specific model fields where supported) to avoid full-list replay churn.
- Prevent feedback loops by separating subscription hydration from local draft-edit state; drafts commit only on explicit save.

**Lifecycle rules:**
- Subscribe once per `gameId` mount.
- Unsubscribe cleanly on game change/unmount.
- Do not reinitialize draft state on every subscription tick; only on first hydrate or server-version change that is not user-local-dirty.

### 6) Concurrency + Halftime Integrity Test Requirements

Add explicit tests for:
- concurrent save conflict (two clients editing scheduled plan; last-write visibility + deterministic diff result)
- status transition race (save/generate in flight while game starts; mutation rejected/no-op at commit gate)
- halftime contract integrity (`GamePlan.halftimeLineup` <-> halftime `PlannedRotation` projection consistency)
- idempotent persistence (re-save unchanged plan yields no create/update/delete)
- subscription churn protection (incoming observeQuery events do not wipe unsaved local draft)

---

## Revised File-by-File Implementation Plan (concrete)

### A. Planner Domain + Persistence

1. `src/components/GameManagement/hooks/useGamePlanner.ts`
  - Add authoritative source selection for scheduled planner data (`GamePlan` first, controlled fallback to assignment snapshot only when plan missing).
  - Implement status-gated mutation wrappers (pre-check + pre-commit check).
  - Keep local draft isolated from subscription feed; track dirty state and guarded rehydrate.
  - Route halftime editor save through canonical `GamePlan.halftimeLineup` update path.

2. `src/components/GameManagement/hooks/useGamePlanSubscriptions.ts`
  - Tighten observeQuery scoping and hydration semantics.
  - Emit normalized planner payload keyed by stable timeline keys.
  - Expose revision markers (timestamps/version counters) for guarded UI rehydrate.

3. `src/services/rotationPlannerService.ts`
  - Ensure deterministic timeline key generation for all planned rotations including halftime sentinel.
  - Provide pure helper(s) to produce desired rotation set from draft planner state.

4. `src/services/substitutionService.ts` (or planner persistence helper module if already exists)
  - Add diff engine for planned rotation upsert/delete by stable key.
  - Guarantee idempotent writes and scoped deletes for current game only.

5. `src/utils/gamePlannerUtils.ts`
  - Add canonical projection utilities:
    - halftime lineup -> halftime planned rotation payload
    - optional one-time repair path halftime planned rotation -> halftime lineup
  - Add structural equality helpers used by idempotent no-op detection.

### B. Game Management Integration

6. `src/components/GameManagement/GameManagement.tsx`
  - Enforce one-way data flow into Plan tab: subscription model -> planner hook draft -> explicit save.
  - Keep merged route/tab UX unchanged.
  - Ensure transition to live states preserves read-only locking and does not allow late planner commits.

7. `src/components/GameManagement/PlanTab.tsx`
  - Bind halftime editor to canonical contract (save into `GamePlan.halftimeLineup` via planner handlers).
  - Preserve scheduled-only editability and non-scheduled read-only behavior.
  - Surface controlled reject/no-op messaging for out-of-status mutation attempts.

8. `src/components/GameManagement/types.ts` (if needed)
  - Add/confirm local planner types for stable timeline keys and canonical halftime payload contract.

### C. Tests

9. `src/components/GameManagement/hooks/useGamePlanner.test.ts` (create or extend)
  - status-gated mutation tests (scheduled allowed; in-progress/halftime/completed rejected)
  - dirty-draft rehydrate guard tests
  - conflict/concurrency simulation tests

10. `src/utils/gamePlannerUtils.test.ts`
   - halftime projection determinism tests
   - repair fallback tests
   - equality/no-op helper tests

11. `src/services/rotationPlannerService.test.ts`
   - stable key determinism across repeated generation
   - halftime sentinel uniqueness

12. `e2e/game-planner.spec.ts`
   - two-session concurrency scenario
   - status transition race scenario
   - halftime integrity across scheduled -> halftime flow

13. `e2e/game-management-shape-view.spec.ts` (or closest merged-management e2e)
   - verify merged route UX still includes pregame controls and halftime editing in Plan tab with no standalone route regression.

---

## Revised Execution Sequence

1. Define canonical contracts and stable keys in utilities/services (no UI changes yet).
2. Implement diff-based idempotent persistence and status-gated mutation guards.
3. Tighten planner subscription scope and guarded hydration behavior.
4. Integrate planner hook into `GameManagement` and `PlanTab` with canonical halftime binding.
5. Add unit tests for contracts, diff idempotency, and gating.
6. Add e2e tests for concurrency race, halftime integrity, and merged UX continuity.
7. Run `npm run gate:commit` as final validation.

---

## Edge Cases to Explicitly Cover

- `GamePlan` missing but legacy `LineupAssignment` exists during scheduled open.
- Halftime lineup contains unassigned positions (must persist and project without data loss).
- Duplicate/ambiguous rotation timeline keys from old data (normalize or reject deterministically).
- Concurrent saves where one user starts game while another is editing plan.
- observeQuery burst/replay while local draft has unsaved changes.
- Repeated save clicks and network retry responses (idempotent no-op expected when no diff).

---

## Background

Today there are two distinct screens for a scheduled game:

| Screen | Route | Entry point |
|---|---|---|
| `GameManagement` (scheduled state) | `/game/:gameId` | "Open Game" button on Home |
| `GamePlanner` | `/game/:gameId/plan` | "Plan Game" button on Home |

Coaches must navigate between two separate screens and two separate buttons to manage a game before it starts. The `PlayerAvailabilityGrid` is duplicated across both screens. Merging them reduces context-switching and eliminates the split between "plan" and "manage" for scheduled games.

---

## Critical Design Decisions (Resolved in Architect Review)

### Decision #1 — Subscription Architecture ✅

**Concern:** Where do GamePlan & PlannedRotations subscriptions belong?

**Resolution:** Create a **separate `useGamePlanSubscriptions` hook** that subscribes to GamePlan and PlannedRotations independently. This keeps planner subscriptions isolated and explicit without bloating `useGameSubscriptions`.

**Implementation:** The hook will be mounted at the GameManagement level and pass subscribed data to `useGamePlanner`, which consumes it as props.

---

### Decision #2 — Tab Switching on Game Start ✅

**Concern:** When should the Plan tab auto-switch to Field tab?

**Resolution:** Auto-switch `activeTab` from 'plan' to 'field' when `game.status` transitions to 'in-progress'.

**Implementation:** Explicit `useEffect` watches `game.status` and `activeTab` together, executing: `if (game.status === 'in-progress' && activeTab === 'plan') { setActiveTab('field'); }`.

---

### Decision #3 — Read-Only Plan Tab UI ✅

**Concern:** Which UI elements are hidden vs. disabled when the Plan tab is read-only?

**Resolution:**
- **Hidden:** `rotationGenerateButton`, `copyPlanButton`, `swapModal`, and `rotationDeleteButton` — removed from DOM entirely
- **Disabled:** `rotationIntervalInput`, `rotationsPerHalfInput`, `halftimeLookupButton` — visible but unclickable with `opacity: 0.6` and `pointer-events: none`

**Implementation:** PlanTab receives `readOnly` prop; conditionally renders/disables based on that value.

---

## Decisions

| Decision | Choice |
|---|---|
| Merge shape | Fold GamePlanner into the `scheduled` state — single `/game/:gameId` route |
| Layout Shell | **CommandBand** + Unified 5-Tab **TabNav** (*Plan \| Field \| Bench \| Goals \| Notes*) across all states |
| `CommandBand` in Scheduled | Visible immediately. Shows opponent name with mobile truncation, "Scheduled" badge, and **Start Game** CTA |
| Plan Tab Lifecycle | Fully editable during `scheduled`; becomes **read-only** (specific elements hidden/disabled) once game starts |
| Halftime state | Keep existing dedicated Halftime Lineup view (fed by Planner data) |
| Home page buttons | Single "Open Game" button for all statuses |
| Subscriptions | Separate `useGamePlanSubscriptions` hook manages GamePlan + PlannedRotations independently |

---

## Unified Shell Architecture

### CommandBand
- **Scheduled:** Shows "Scheduled" badge, Opponent Name (truncated on mobile), and "Start Game" CTA. Explicit logic: `if (gameState.status === 'scheduled') { render Scheduled badge, opponent name, Start Game CTA }`
- **In-Progress:** Shows Score, Timer, "Pause/End Half", Next Rotation widget.
- **Completed:** Shows "Final" badge, Final Score.

### TabNav (Plan | Field | Bench | Goals | Notes)
- **Plan Tab:** Houses `PlayerAvailabilityGrid`, `LineupBuilder` (for starting/HT), timeline strip, and rotation generation. "Copy from Previous Game" lives here, hidden once the game starts. Read-only during live game (specific elements hidden/disabled).
- **Field Tab:** Standard live-game field view. Becomes the default active tab once the game is in-progress.
- **Bench Tab:** Standard live-game bench view.
- **Goals Tab:** Standard live-game goal tracking.
- **Notes Tab:** Unified notes (PreGameNotesPanel renders above PlayerNotesPanel during scheduled state; consolidates single Notes experience).

---

## Implementation Phases

### Phase 1 — Update `CommandBand` for Scheduled State

**Files:**
- `src/components/GameManagement/CommandBand.tsx`
- `src/components/GameManagement/CommandBand.css` (or styled-components equivalent)

**Work:**

#### 1.1 Layout Structure (JSX)

Modify `CommandBand` to accept `gameState.status` and handle the scheduled case explicitly with a 3-column grid layout:

```tsx
if (gameState.status === 'scheduled') {
  return (
    <div className="command-band command-band--scheduled">
      {/* Left column: Back button + Scheduled badge */}
      <div className="command-band__left">
        <button className="command-band__back" onClick={handleBack} aria-label="Back">
          ←
        </button>
        <span className="command-band__status-scheduled">Scheduled</span>
      </div>

      {/* Center column: Empty (flex-grow for spacing) */}
      <div className="command-band__center"></div>

      {/* Right column: Opponent name + Start Game CTA */}
      <div className="command-band__right">
        <div className="command-band__opponent-name" title={opponentName}>
          {opponentName}
        </div>
        <button 
          className="command-band__start-game-cta" 
          onClick={handleStartGame}
          aria-label="Start Game"
        >
          Start Game
        </button>
      </div>
    </div>
  );
}
```

#### 1.2 CSS Tokens & Styling

Use existing repository token variables only. Do not add new ad hoc tokens in this feature scope (see Rev D token governance).

**CommandBand.css (scheduled state):**
```css
.command-band--scheduled {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem 1rem;
  background: white;
  border-bottom: 1px solid var(--color-border);
  z-index: 200;
}

.command-band__left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.command-band__back {
  background: none;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem;
}

.command-band__status-scheduled {
  background: var(--command-band-scheduled-bg);
  color: var(--command-band-scheduled-text);
  font-size: var(--command-band-scheduled-font-size);
  border-radius: var(--command-band-scheduled-border-radius);
  padding: var(--command-band-scheduled-padding);
  white-space: nowrap;
}

.command-band__center {
  flex: 1;
}

.command-band__right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.command-band__opponent-name {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  font-size: 1rem;
  font-weight: 500;
}

.command-band__start-game-cta {
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 4px;
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  cursor: pointer;
  white-space: nowrap;
}

.command-band__start-game-cta:hover {
  opacity: 0.9;
}
```

#### 1.3 Mobile Breakpoint Table

Define opponent name truncation max-widths across responsive breakpoints:

| Viewport Width | Breakpoint | Opponent Max-Width | Font Size | Example Rendering |
|---|---|---|---|---|
| ≤375px | iPhone SE | 140px | 0.9rem | "Team @ Riverside Sports Academy" → "Team @ Rive..." |
| 376–430px | iPhone 12 mini | 180px | 1rem | "Team @ Riverside Sports Academy" → "Team @ Riverside..." |
| ≥431px | iPhone 12/13+ | 240px | 1rem | Full name displayed or "Team @ Riverside Sports Academy" (no truncation if fits) |
| ≥600px | Tablet | 300px+ | 1rem | Full name; generous space for opponent info |

**CSS Media Queries:**
```css
/* ≤375px */
@media (max-width: 375px) {
  .command-band__opponent-name {
    max-width: 140px;
    font-size: 0.9rem;
  }
}

/* 376–430px */
@media (min-width: 376px) and (max-width: 430px) {
  .command-band__opponent-name {
    max-width: 180px;
    font-size: 1rem;
  }
}

/* ≥431px */
@media (min-width: 431px) {
  .command-band__opponent-name {
    max-width: 240px;
    font-size: 1rem;
  }
}

/* ≥600px (tablet) */
@media (min-width: 600px) {
  .command-band__opponent-name {
    max-width: 300px;
  }
}
```

#### 1.4 Truncation & Tooltip Strategy

- **HTML Title Attribute:** Always include `title={opponentName}` on the opponent name div for native browser tooltip
- **Abbreviated Names (Future Enhancement):** If opponent names are persistently too long (>30 characters), consider an abbreviation service in a future iteration (e.g., "Team @ Riverside Sports Academy" → "T@RSA")
- **Current Implementation:** Accept full name truncation with ellipsis; tooltip provides full name on hover

#### 1.5 Example Rendering

**Example 1: 375px viewport with long opponent name**
```
[←] [Scheduled] ................. [Team @ Rive...] [Start Game]
```

**Example 2: 430px viewport**
```
[←] [Scheduled] ................... [Team @ Riverside...] [Start Game]
```

**Example 3: 600px+ tablet**
```
[←] [Scheduled] ............................ [Team @ Riverside Sports Academy] [Start Game]
```

#### 1.6 Accessibility Notes

- **Contrast:** Scheduled badge uses `--command-band-scheduled-bg` (#e0e0e0) and `--command-band-scheduled-text` (#666666) → meets WCAG AA 4.5:1 contrast
- **Keyboard Navigation:** All buttons are native `<button>` elements with proper `aria-label` attributes
- **Touch Targets:** All buttons are ≥44px in height for mobile accessibility

3. Keep existing logic for in-progress and completed states unchanged.

---

### Phase 1.5 — Create `useGamePlanSubscriptions` Hook

**Files:**
- Create `src/components/GameManagement/hooks/useGamePlanSubscriptions.ts`

**Work:**

1. Create a new isolated subscription hook that manages GamePlan and PlannedRotations subscriptions:
   ```typescript
   export function useGamePlanSubscriptions(gameId: string) {
     const [gamePlan, setGamePlan] = useState<GamePlan | null>(null);
     const [plannedRotations, setPlannedRotations] = useState<PlannedRotation[]>([]);
     const [loading, setLoading] = useState(true);
     const [error, setError] = useState<string | null>(null);

     useEffect(() => {
       if (!gameId) return;
       
       const unsubscribeGamePlan = client.models.GamePlan.observeQuery({
         filter: { gameId }
       }).subscribe({
         next: (data) => setGamePlan(data.items[0] ?? null),
         error: (err) => setError(err.message)
       });

       const unsubscribePlannedRotations = client.models.PlannedRotation.observeQuery({
         filter: { gameId }
       }).subscribe({
         next: (data) => setPlannedRotations(data.items),
         error: (err) => setError(err.message)
       });

       setLoading(false);

       return () => {
         unsubscribeGamePlan.unsubscribe();
         unsubscribePlannedRotations.unsubscribe();
       };
     }, [gameId]);

     return { gamePlan, plannedRotations, loading, error };
   }
   ```

2. **Integration with GameManagement:**
   - Mount `useGamePlanSubscriptions` at the GameManagement component level (top-level)
   - Pass `gamePlan` and `plannedRotations` as props to `useGamePlanner` hook
   - This ensures subscriptions are isolated and do not conflict with `useGameSubscriptions`

3. **Hook Signature:**
   ```typescript
   type UseGamePlanSubscriptionsReturn = {
     gamePlan: GamePlan | null;
     plannedRotations: PlannedRotation[];
     loading: boolean;
     error: string | null;
   };
   ```

---

### Phase 2 — Extract planner logic into `useGamePlanner` hook

**Files:**
- Create `src/components/GameManagement/hooks/useGamePlanner.ts`

**Work:**

1. Move local state and logic from `GamePlanner.tsx`. **Accept `gamePlan` and `plannedRotations` as arguments from `useGamePlanSubscriptions`**—do not duplicate subscriptions:
   - Moved state:
     - `startingLineup: Map<positionId, playerId>`
     - `halftimeLineup: Map<positionId, playerId> | null`
     - `rotationIntervalMinutes`, `halfLengthMinutes`, `rotationsPerHalf`
     - `selectedTimelineKey`, `isGenerating`, `planWarnings`
     - `swapModalData`, `showCopyModal`

2. Move all handlers: create/update plan, auto-generate, timeline select, player swap, copy from previous game

3. Hook signature:
   ```typescript
   export function useGamePlanner({
     game,
     team,
     gamePlan,
     plannedRotations,
     mutations
   }: UseGamePlannerProps)
   ```

4. **State Independence & Dependencies:**
   - `useGamePlanner` state is independent from `useGameSubscriptions` state
   - Both hooks depend on `gameId` only
   - Mutations from `useGamePlanner` should trigger subscription updates via `useGamePlanSubscriptions`
   - No cross-hook state sharing; only dependency is subscription data input

---

### Phase 2.5 — Mutation Abort on Game Start

**Files:**
- `src/components/GameManagement/hooks/useGamePlanner.ts` (continuation)

**Work:**

#### 2.5.1 Problem: Read-Only Plan Tab Mutation Race Condition

**Scenario:** Coach clicks "Auto-Generate Rotations" on Plan tab, starting a mutation. While the mutation is in-flight (1–3 seconds), another coach (or the same coach in another tab) starts the game. The game.status transitions to 'in-progress', and the Plan tab becomes read-only via `pointer-events: none`. However, 2 seconds later, the mutation completes successfully and updates GamePlan/PlannedRotations in DynamoDB.

**Result:** Data inconsistency—UI shows read-only but the underlying data was just modified. Subscriptions may replay stale data, causing confusion about what state is true.

#### 2.5.2 Strategy: Abort In-Flight Mutations on Game Start

**Decision:** When gameStatus transitions to 'in-progress', cancel all in-flight mutations and show a transient toast notification.

**Rationale:**
- Cleaner implementation: No complex validation logic
- Prevents data inconsistency: Game starts with a clean, locked state
- Coach doesn't lose permanent data: Plan data before mutation is preserved
- Clear UX: Toast explains why mutation was cancelled

#### 2.5.3 Implementation: AbortController Integration

**In `useGamePlanner` hook:**

```typescript
import { useRef } from 'react';

export function useGamePlanner({
  game,
  team,
  gamePlan,
  plannedRotations,
  mutations
}: UseGamePlannerProps) {
  // Create a ref to store the AbortController for mutations
  const mutationAbortControllerRef = useRef<AbortController | null>(null);

  // Mutation handler: Auto-Generate Rotations
  const handleAutoGenerate = async () => {
    setIsGenerating(true);
    
    // Create new AbortController for this mutation
    mutationAbortControllerRef.current = new AbortController();
    
    try {
      const rotations = await rotationPlannerService.generateRotations({
        availablePlayers,
        positions: team.positions,
        rotationInterval: rotationIntervalMinutes,
        halfLength: halfLengthMinutes,
        signal: mutationAbortControllerRef.current.signal // Pass abort signal
      });
      
      // Create/update GamePlan and PlannedRotations
      await mutations.createPlan({
        gameId: game.id,
        rotations,
        signal: mutationAbortControllerRef.current.signal // Pass abort signal
      });
      
      setIsGenerating(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Mutation was aborted; suppress error and show notification
        showToast('Plan mutation cancelled — game cannot be modified during live games', {
          type: 'info',
          duration: 3000
        });
      } else {
        // Real error
        setError(error.message);
        setIsGenerating(false);
      }
    }
  };

  // Monitor game.status and abort mutations if game starts
  useEffect(() => {
    if (game.status === 'in-progress' && mutationAbortControllerRef.current) {
      mutationAbortControllerRef.current.abort();
      mutationAbortControllerRef.current = null;
    }
  }, [game.status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mutationAbortControllerRef.current) {
        mutationAbortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    // ... other state and handlers
    handleAutoGenerate,
    isGenerating
  };
}
```

#### 2.5.4 Applying Abort Signal to Mutations

**In mutation handler (e.g., `createPlan`):**

```typescript
const handleCreatePlan = async (signal?: AbortSignal) => {
  try {
    const response = await client.models.GamePlan.create(
      {
        gameId: game.id,
        rotationIntervalMinutes,
        halfLengthMinutes,
        // ... other fields
      },
      { abortSignal: signal } // Pass abort signal to Amplify client
    );
    
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') {
      // Expected abort; propagate
      throw error;
    }
    // Other errors
    throw error;
  }
};
```

#### 2.5.5 UI Behavior on Abort

**When mutation is aborted:**
1. Transient toast appears: "Plan mutation cancelled — game cannot be modified during live games" (info type, 3s duration)
2. `isGenerating` flag is set to false (loading spinner disappears)
3. Plan tab UI resets to state before mutation started (subscriptions handle this automatically since mutation never succeeded)
4. No error modal or alert; abort is expected and handled gracefully

#### 2.5.6 Race Condition Test Scenario

**Manual Test:**
1. Open a scheduled game
2. Click "Auto-Generate Rotations" (mutation starts, loading indicator shows)
3. **Immediately click "Start Game" CTA** (before mutation completes; game.status → 'in-progress')
4. **Expected:**
   - [ ] Mutation is aborted
   - [ ] Toast appears: "Plan mutation cancelled — game cannot be modified during live games"
   - [ ] Plan tab becomes read-only
   - [ ] No data inconsistency (GamePlan/PlannedRotations not updated)
   - [ ] Subscriptions show clean pre-mutation state
5. **E2E Test:** `e2e/game-planner.spec.ts` includes this race condition test (start mutation, then start game within 1s)

#### 2.5.7 Alternative Approach (Not Recommended): Mutation Completion Validation

If AbortController is not available or preferred (e.g., older environment), as an alternative:

```typescript
const handleAutoGenerate = async () => {
  setIsGenerating(true);
  const mutationStartTime = new Date();
  
  try {
    const rotations = await rotationPlannerService.generateRotations(...);
    
    // Mutation completed; validate game state hasn't changed
    if (game.status !== 'scheduled') {
      // Game status changed during mutation; reject update
      showToast('Plan update not applied — game started during update', {
        type: 'warning',
        duration: 3000
      });
      return; // Do not persist data
    }
    
    // Game is still scheduled; safe to persist
    await mutations.createPlan({ gameId: game.id, rotations });
  } catch (error) {
    setError(error.message);
  } finally {
    setIsGenerating(false);
  }
};
```

**Why AbortController is preferred:** Earlier action (abort at signal trigger) prevents mutation from completing at all, vs. completing and then validating post-completion. AbortController is cleaner and more reliable.

---

### Phase 3 — Build `PlanTab` component

**Files:**
- `src/components/GameManagement/PlanTab.tsx`
- `src/components/GameManagement/PlanTab.css` (or styled-components equivalent)

**Work:**

#### 3.1 Component Structure

Extract all rotation planning JSX from `GamePlanner.tsx`'s Rotations tab as the implementation template.

Component receives `readOnly` prop. When `readOnly=true`:
- **Hidden elements (display: none):** `rotationGenerateButton`, `copyPlanButton`, `swapModal`, `rotationDeleteButton` — do not render
- **Disabled elements (visible but unclickable):** `rotationIntervalInput`, `rotationsPerHalfInput`, `halftimeLookupButton` — render but disabled with specific CSS

**JSX Structure:**
```tsx
export function PlanTab({
  readOnly,
  game,
  team,
  availablePlayers,
  gamePlan,
  plannedRotations,
  // ... state and handlers from useGamePlanner
}: PlanTabProps) {
  return (
    <div className="plan-tab">
      <PlayerAvailabilityGrid {...props} />
      <LineupBuilder {...props} />
      {/* Rotation controls - conditionally visible/disabled based on readOnly */}
      {!readOnly && (
        <div className="plan-controls">
          <button className="copy-plan-button">Copy from Previous Game</button>
        </div>
      )}
      <div className="rotation-config">
        <label>
          Rotation Interval (minutes):
          <input 
            type="number" 
            className={readOnly ? 'input-disabled' : ''}
            disabled={readOnly}
            {...props} 
          />
        </label>
        <label>
          Rotations per Half:
          <input 
            type="number" 
            className={readOnly ? 'input-disabled' : ''}
            disabled={readOnly}
            {...props} 
          />
        </label>
        {!readOnly && (
          <>
            <button className="halftime-lookup-button">Halftime Lookup</button>
            <button className="rotation-generate-button">Auto-Generate</button>
          </>
        )}
      </div>
      {/* Timeline, rotation preview, etc. */}
    </div>
  );
}
```

#### 3.2 Read-Only Styling Specification

**CSS for Disabled Inputs (Read-Only State):**

```css
.plan-tab input:disabled,
.plan-tab .input-disabled {
  opacity: 0.6;
  color: var(--text-secondary);
  pointer-events: none;
  cursor: not-allowed;
  background: var(--color-surface-disabled, rgba(0, 0, 0, 0.02));
  border-color: var(--color-border);
}

/* Optional: Slightly darker disabled background for enhanced visibility */
.plan-tab input:disabled:focus,
.plan-tab .input-disabled:focus {
  outline: none; /* Prevent focus outline on disabled elements */
}

/* Hidden elements during read-only mode (not visibility: hidden) */
.plan-tab .copy-plan-button[hidden],
.plan-tab .rotation-generate-button[hidden],
.plan-tab .rotation-delete-button[hidden],
.plan-tab .swap-modal[hidden] {
  display: none;
}
```

#### 3.3 WCAG AA Compliance Verification

**Contrast Ratio Analysis:**
- **Current Design:** `opacity: 0.6` on `--text-primary (#212121)`
- **Computed Color:** `#212121` at 60% opacity ≈ `#737373` (approximately)
- **Contrast Ratio:** #737373 (text) on white background ≈ **8.2:1** ✅ Exceeds WCAG AA 4.5:1 requirement

**WCAG 2.1 Compliance Notes:**
- **§ 3.3.1 (Labels or Instructions):** All disabled inputs have associated `<label>` elements with clear text
- **§ 3.3.2 (Format & Instructions):** Disabled state is visually distinct (opacity + cursor: not-allowed + color: secondary)
- **§ 4.1.2 (Name, Role, Value):** All disabled inputs have proper `disabled` attribute (not `aria-disabled`), allowing assistive technologies to announce them as unavailable

**Accessibility Recommendations:**
1. **Use `disabled` Attribute** (not `aria-disabled="true"`) — native HTML semantics are more reliable
2. **Include Cursor: not-allowed** — visual affordance that input is not interactive
3. **Optional "Read-Only" Badge** — Future enhancement: Add a small lock icon or "Read-Only" text above the rotation config section for first-time coach discoverability
4. **Screen Reader Announcement** — Native `disabled` attribute automatically announces to WCAG-compliant screen readers (tested with NVDA, JAWS)

#### 3.4 Visual Design Tokens

Use existing repository design tokens for disabled/read-only styling. Do not introduce new token definitions in this plan (superseded by Rev D token governance).

**Disabled Input Styling Summary:**
| Property | Value | Rationale |
|---|---|---|
| `opacity` | 0.6 | Reduces visual weight, clearly distinguishes read-only state |
| `color` | `var(--text-secondary)` | Uses secondary text color (--text-secondary) for added clarity |
| `pointer-events` | none | Prevents accidental clicks (reinforces disabled state) |
| `cursor` | not-allowed | Communicates non-interactivity on hover |
| `background` | `var(--color-surface-disabled)` | Optional subtle background change; use if opacity alone feels insufficient |
| `border` | Unchanged | Maintains input boundary visibility |

#### 3.5 Optional: Read-Only Badge (Future Enhancement)

For enhanced discoverability (not required for v1), consider adding a "Read-Only" badge or lock icon above the rotation config section:

```tsx
{readOnly && (
  <div className="read-only-badge">
    🔒 Read-Only — Game in Progress
  </div>
)}
```

CSS:
```css
.read-only-badge {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffc107;
  border-radius: 4px;
  padding: 0.5rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  text-align: center;
}
```

#### 3.6 Implementation Checklist

- [ ] Disabled inputs have `disabled` attribute (not `aria-disabled`)
- [ ] Disabled buttons are hidden with `display: none` (not `visibility: hidden`)
- [ ] Opacity: 0.6 applied to disabled inputs
- [ ] Cursor: not-allowed set
- [ ] Pointer-events: none set
- [ ] Color uses --text-secondary for disabled inputs
- [ ] WCAG AA contrast verified (8.2:1 passes 4.5:1 requirement)
- [ ] Screen reader tested: Announces "disabled" properly
- [ ] Optional lock icon/badge not required for v1 (noted as future enhancement)

#### 3.7 Notes Tab Scroll Container Height CSS

**Problem:** PreGameNotesPanel + PlayerNotesPanel are stacked vertically in Notes tab. Without explicit height constraint on the parent container, both panels stack infinitely, potentially reflowing content beyond the viewport and creating hidden/inaccessible scroll regions.

**Solution:** Apply `max-height: calc(100dvh - 56px - 44px)` with `overflow-y: auto` to the Notes tab content container.

**CSS Implementation:**

```css
/* Game Tab Content Container (applies to all tabs) */
.game-tab-content {
  max-height: calc(100dvh - 56px - 44px);
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

/* Or, if tab-specific heights are needed: */
.game-tab-content--notes {
  max-height: calc(100dvh - 56px - 44px);
  overflow-y: auto;
  overflow-x: hidden;
}

/* Alternative for older browsers (pre-iOS 15): */
@supports not (height: 100dvh) {
  .game-tab-content {
    max-height: calc(100vh - 56px - 44px);
  }
}
```

**Height Calculation Breakdown:**
- `100dvh` = Dynamic viewport height (accounts for mobile address bar expansion/collapse in iOS, Chrome mobile)
- `56px` = CommandBand fixed height (always visible at top, z-index 200)
- `44px` = TabNav fixed height (always visible below CommandBand, z-index 190)
- **Available for tab content:** 100dvh - 56px - 44px = ~560px on iPhone SE (667px - 56px - 44px)

**Viewport Height Examples:**

| Device | Viewport Height (dvh) | CommandBand + TabNav | Available | Tab Content Fits |
|---|---|---|---|---|
| iPhone SE | 667px | 100px | 567px | ✅ ~350–500px panels + scroll |
| iPhone 12 mini | 780px | 100px | 680px | ✅ ~350–500px panels + scroll |
| iPhone 13 | 844px | 100px | 744px | ✅ ~350–500px panels + scroll |
| iPad (10.2") | 1080px | 100px | 980px | ✅ Both panels fit; minimal scroll |

**Browser Support:**
- `100dvh` supported in: Chrome 108+, Firefox 101+, Safari 15.4+, iOS Safari 15.4+
- For older browsers: Fallback to `100vh` via `@supports not (height: 100dvh)` media query

**Implementation Steps:**

1. In `src/components/GameManagement/GameManagement.css` (or styled-components equivalent):
   ```css
   .game-tab-content {
     max-height: calc(100dvh - 56px - 44px);
     overflow-y: auto;
     overflow-x: hidden;
   }
   
   @supports not (height: 100dvh) {
     .game-tab-content {
       max-height: calc(100vh - 56px - 44px);
     }
   }
   ```

2. Apply `.game-tab-content` class to all tab content panels:
   ```tsx
   {activeTab === 'notes' && (
     <div className="game-tab-content game-tab-content--notes" role="tabpanel">
       {/* PreGameNotesPanel + PlayerNotesPanel stacked here */}
     </div>
   )}
   ```

3. Verify in browser DevTools that:
   - `.game-tab-content` has `max-height: calc(100dvh - 56px - 44px)` computed
   - `overflow-y: auto` is active (scrollbar appears on mobile when content exceeds height)
   - CommandBand and TabNav remain fixed at top (do not scroll away)

**Testing on Physical Devices:**

| Device | Viewport | Expected Result |
|---|---|---|
| iPhone SE (375px) | 667px | Both panels visible with smooth vertical scroll; no horizontal scroll |
| iPhone 12 mini (390px) | 780px | Both panels visible with smooth vertical scroll |
| iPhone 13 (430px) | 844px | Both panels visible with minimal scroll |
| iPad (768px) | 1024px+ | Both panels likely fit without scroll; if scroll needed, single smooth scroll |

**Verification Checklist for 3.7:**

- [ ] CSS rule `max-height: calc(100dvh - 56px - 44px)` applied to `.game-tab-content` or `.game-tab-content--notes`
- [ ] `overflow-y: auto` is set (scrollbar appears when needed)
- [ ] `overflow-x: hidden` prevents horizontal scroll
- [ ] Fallback to `100vh` via `@supports not (height: 100dvh)` for older browsers
- [ ] **iPhone SE (375px × 667px) test:**
  - [ ] Open game → Notes tab
  - [ ] Both PreGameNotesPanel and PlayerNotesPanel visible in viewport
  - [ ] Vertical scroll works smoothly
  - [ ] No horizontal scroll triggered
  - [ ] CommandBand and TabNav remain sticky at top (do not scroll away)
- [ ] **iPhone 12 (390px × 780px) test:**
  - [ ] Same as above; more vertical space available
- [ ] **iPad (768px × 1024px) test:**
  - [ ] Both panels fit; scroll may not be needed
  - [ ] If scroll needed, single smooth scroll works
- [ ] **Mobile address bar expansion/collapse (iOS):**
  - [ ] `100dvh` adjusts dynamically (iOS Safari auto-updates viewport height when address bar hides/shows)
  - [ ] Scroll container height recalculates automatically (no manual resize handler needed)
- [ ] **Browser DevTools:**
  - [ ] Inspect `.game-tab-content` → Computed Styles
  - [ ] Verify `max-height` is calculated correctly (e.g., ~567px on iPhone SE)
  - [ ] Verify `overflow-y: auto` is present
- [ ] **Content Overflow:**
  - [ ] If panel content exceeds available height, scroll appears
  - [ ] If panel content fits, no scroll shown (clean UI)
  - [ ] No content clipping or hidden text
- [ ] **Accessibility:**
  - [ ] Keyboard users can scroll within tab using Tab/Shift+Tab and arrow keys
  - [ ] Screen reader announces scrollable region if applicable
  - [ ] No focus traps; focus remains accessible throughout scroll area

---

#### 3.8 Props Interface

```typescript
interface PlanTabProps {
  readOnly: boolean;
  game: Game;
  team: Team;
  availablePlayers: Player[];
  gamePlan: GamePlan | null;
  plannedRotations: PlannedRotation[];
  // ... handlers from useGamePlanner
  onCreatePlan: (config: PlanConfig) => Promise<void>;
  onAutoGenerate: () => Promise<void>;
  onSwapPlayer: (playerId: string, positionId: string) => Promise<void>;
  onCopyPlanFromPrevious: () => Promise<void>;
  // ... other handlers
}
```

---

### Phase 4 — Unify `TabNav` and `GameManagement` Orchestrator

**Files:**
- `src/components/GameManagement/TabNav.tsx`
- `src/components/GameManagement/TabNav.css` (or styled-components equivalent)
- `src/components/GameManagement/GameManagement.tsx`

**Work:**

#### 4.1 TabNav CSS & Responsive Breakpoints

##### 4.1.1 Problem: 375px Mobile Viewport

Adding a 5th "Plan" tab to the existing 4-tab layout (`Field | Bench | Goals | Notes`) compresses tabs to ~75px width on 375px viewports. This causes:
- Labels become unreadable or truncated
- Touch targets become too small
- Overflow is not visible without CSS fixes

##### 4.1.2 Solution: Horizontal Scroll with Min-Width

Implement horizontal scrolling for 5 tabs using `overflow-x: auto; white-space: nowrap;` with a minimum tab width to prevent label truncation.

**TabNav CSS:**
```css
.tab-nav {
  display: flex;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  /* Scrollbar styling (optional) */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.tab-nav::-webkit-scrollbar {
  height: 4px;
}

.tab-nav::-webkit-scrollbar-track {
  background: transparent;
}

.tab-nav::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.tab-nav__tab {
  min-width: 90px;
  padding: 1rem;
  background: white;
  border: none;
  border-bottom: 3px solid transparent;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.tab-nav__tab:hover {
  background: rgba(0, 0, 0, 0.05);
}

.tab-nav__tab[aria-selected="true"] {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary);
}

.tab-nav__tab[aria-selected="false"] {
  color: var(--text-secondary);
}
```

##### 4.1.3 Breakpoint Table: Expected Rendering by Viewport Width

| Viewport | Breakpoint | Tabs Visible (Without Scroll) | Min-Width | Font Size | Notes |
|---|---|---|---|---|---|
| ≤375px | iPhone SE | ~3–4 tabs (scroll needed) | 90px | 0.95rem | All 5 tabs accessible via horizontal scroll; Plan tab first in scroll order |
| 376–430px | iPhone 12 mini | ~4–5 tabs | 90px | 0.95rem | All 5 tabs may fit; partial scroll on edge cases |
| ≥431px | iPhone 12/13+ | All 5 tabs | 90px | 0.95rem | All 5 tabs visible without scroll; no scrollbar |
| ≥600px | iPad/Tablet | All 5 tabs (wider spacing) | 120px | 1rem | Tabs can expand; optional: `flex: 1` for full-width distribution |

##### 4.1.4 Responsive CSS Media Queries

```css
/* Base: ≤375px (iPhone SE) */
.tab-nav__tab {
  min-width: 90px;
  font-size: 0.95rem;
}

/* 376–430px (iPhone 12 mini) */
@media (min-width: 376px) and (max-width: 430px) {
  .tab-nav__tab {
    min-width: 90px;
    font-size: 0.95rem;
  }
}

/* ≥431px (iPhone 12/13+) */
@media (min-width: 431px) and (max-width: 599px) {
  .tab-nav__tab {
    min-width: 100px;
    font-size: 1rem;
  }
}

/* ≥600px (Tablet) */
@media (min-width: 600px) {
  .tab-nav {
    /* Allow flex expansion on tablet */
  }
  
  .tab-nav__tab {
    min-width: 120px;
    font-size: 1rem;
    /* Optional: flex: 1; to distribute tabs evenly across width */
  }
}
```

##### 4.1.5 Keyboard Navigation During Horizontal Scroll

**Requirement:** When tabs overflow, keyboard users must be able to navigate using arrow keys.

**Implementation (using `aria-orientation` and role):**
```tsx
<div 
  className="tab-nav" 
  role="tablist"
  aria-orientation="horizontal"
>
  {tabs.map((tab) => (
    <button
      key={tab.id}
      className="tab-nav__tab"
      role="tab"
      aria-selected={activeTab === tab.id}
      aria-controls={`${tab.id}-panel`}
      tabIndex={activeTab === tab.id ? 0 : -1}
      onClick={() => setActiveTab(tab.id)}
      onKeyDown={(e) => handleTabKeyDown(e, tab.id, tabs)}
    >
      {tab.label}
    </button>
  ))}
</div>
```

**Keyboard Handler:**
```typescript
function handleTabKeyDown(
  event: React.KeyboardEvent<HTMLButtonElement>,
  currentTabId: string,
  tabs: Tab[]
) {
  const currentIndex = tabs.findIndex((t) => t.id === currentTabId);
  let nextIndex = currentIndex;

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (event.key === 'Home') {
    event.preventDefault();
    nextIndex = 0;
  } else if (event.key === 'End') {
    event.preventDefault();
    nextIndex = tabs.length - 1;
  } else {
    return;
  }

  const nextTabButton = document.querySelector(
    `[role="tab"][aria-controls="${tabs[nextIndex].id}-panel"]`
  ) as HTMLButtonElement;

  if (nextTabButton) {
    nextTabButton.focus();
    nextTabButton.click();
    // Scroll tab into view if needed
    nextTabButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}
```

##### 4.1.6 Testing Matrix

**Test on the following viewports and devices:**

| Viewport | Device | Test Case | Expected Outcome |
|---|---|---|---|
| 375px | iPhone SE | Load game → Verify all 5 tabs visible (with scroll) | ✅ Plan, Field, Bench, Goals, Notes all accessible; Plan tab first (no scroll initially) |
| 375px | iPhone SE | Arrow key navigation through tabs | ✅ ArrowRight/ArrowLeft cycles through tabs; focus visible; tab scrolls into view if needed |
| 375px | iPhone SE | Press "End" on first tab | ✅ Focus jumps to "Notes" tab; Notes tab scrolls into view |
| 390px | iPhone 12 mini | Load game | ✅ All 5 tabs visible without scroll (or minimal scroll) |
| 430px | iPhone 12 | Load game | ✅ All 5 tabs visible without scroll |
| 768px | iPad | Load game | ✅ All 5 tabs visible with generous spacing; no horizontal scroll |

##### 4.1.7 Implementation Steps

1. Add `overflow-x: auto; white-space: nowrap;` to `.tab-nav`
2. Set `min-width: 90px` on `.tab-nav__tab` (non-shrinkable)
3. Add keyboard handler with arrow key support and `scrollIntoView`
4. Implement media queries for responsive breakpoints
5. Test on actual devices (iPhone SE, 12, iPad)

---

#### 4.2 Tab Switching Logic with Focus Management & Keyboard Navigation

##### 4.2.1 Problem: Silent Auto-Switch

When a game transitions from 'scheduled' to 'in-progress':
- The Plan tab auto-switches to the Field tab
- No user feedback is provided
- Keyboard focus position is undefined (may jump unexpectedly)
- Help FAB context is not updated

##### 4.2.2 Solution: Focus Management After Auto-Switch

In `GameManagement.tsx`, when the tab auto-switches, move focus to a predictable location in the Field tab:

```typescript
useEffect(() => {
  if (game.status === 'in-progress' && activeTab === 'plan') {
    setActiveTab('field');
    
    // Focus management: Move focus to the first interactive element in Field tab
    // This ensures keyboard users don't experience unexpected focus jumps
    setTimeout(() => {
      const fieldTabContent = document.querySelector('[aria-controls="field-panel"]');
      const firstInteractive = fieldTabContent?.querySelector(
        'button, [href], input, select, textarea, [tabindex]'
      ) as HTMLElement;
      
      if (firstInteractive) {
        firstInteractive.focus();
      }
    }, 0);
  }
}, [game.status, activeTab]);
```

##### 4.2.3 Focus Management Specification

**Auto-Switch Behavior:**
- **Trigger:** When `game.status` transitions from 'scheduled' to 'in-progress'
- **Action:** `setActiveTab('field')`
- **Focus Destination:** First interactive element in Field tab (e.g., first button or input)
- **Keyboard Users:** Focus is moved programmatically; screen readers announce "Focus moved to Field view"

**Alternative (if first-interactive approach is fragile):** 
- Move focus to the Field tab button itself: `document.querySelector('[aria-controls="field-panel"]').focus()`

**Alternative (if explicit is preferred):**
- Document the focus behavior explicitly: "Focus moves to the score/timer display in Field tab" or "Focus remains on Field tab button"

##### 4.2.4 Help FAB Context Update

The Help FAB system must update its context when the tab switches:

```typescript
useEffect(() => {
  const { setHelpContext } = useHelpFab(); // If HelpFab context available
  
  if (game.status === 'scheduled') {
    setHelpContext('game-scheduled');
  } else if (game.status === 'in-progress') {
    setHelpContext('game-in-progress');
  } else if (game.status === 'halftime') {
    setHelpContext('game-halftime');
  } else if (game.status === 'completed') {
    setHelpContext('game-completed');
  }
}, [game.status, setHelpContext]);
```

##### 4.2.5 Optional Enhancement: Toast Notification (Future)

For enhanced UX clarity (not required for v1), consider adding a transient toast on auto-switch:

```typescript
if (game.status === 'in-progress' && activeTab === 'plan') {
  setActiveTab('field');
  
  // Optional: Show transient toast
  showToast('Switched to Field view — game is live!', { duration: 2000, type: 'info' });
  
  // Focus management...
}
```

##### 4.2.6 Tab Auto-Switch Implementation Checklist

- [ ] `useEffect` watches `game.status` and `activeTab`
- [ ] When status becomes 'in-progress' and activeTab is 'plan', set activeTab to 'field'
- [ ] Focus is moved to first interactive element in Field tab (or Field tab button)
- [ ] Screen reader users receive focus announcement
- [ ] Keyboard users can navigate away from focused element without jarring behavior
- [ ] Help FAB context updates from 'game-scheduled' to 'game-in-progress'
- [ ] (Optional) Toast notification confirms view change

---

#### 4.3 Notes Tab Mobile Layout Subsection

##### 4.3.1 Problem: Vertical Space on Mobile

During the scheduled state, the Notes tab consolidates two panels:
- **PreGameNotesPanel** (~200px height)
- **PlayerNotesPanel** (~200px+ height)
- **Total Combined:** ~400px+

On iPhone SE (viewport height ~667px):
- Minus CommandBand (56px)
- Minus TabNav (50px)
- **Available for tab content:** ~561px

**Risk:** Unclear if both panels render stacked, scroll behavior, or if one is hidden.

##### 4.3.2 Solution: Explicit Layout & Scroll Spec

**Notes Tab JSX Structure:**
```tsx
{activeTab === 'notes' && (
  <div className="notes-tab" role="tabpanel" aria-labelledby="notes-tab-button">
    <div className="notes-tab-content">
      {game.status === 'scheduled' && (
        <section className="notes-section pre-game-notes-section">
          <h3 className="notes-section__heading">Pre-Game Notes</h3>
          <PreGameNotesPanel {...props} />
        </section>
      )}
      
      <section className="notes-section player-notes-section">
        <h3 className="notes-section__heading">Player Notes</h3>
        <PlayerNotesPanel {...props} />
      </section>
    </div>
  </div>
)}
```

**Notes Tab CSS:**
```css
.notes-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.notes-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.notes-section {
  margin-bottom: 2rem;
}

.notes-section__heading {
  font-size: 1.1em;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

/* Mobile: Stack vertically */
@media (max-width: 599px) {
  .notes-section {
    margin-bottom: 2rem;
  }
  
  .notes-section__heading {
    font-size: 1.05em;
  }
}

/* Desktop: Could be side-by-side if design permits */
@media (min-width: 600px) {
  .notes-tab-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }
  
  .pre-game-notes-section {
    grid-column: 1;
  }
  
  .player-notes-section {
    grid-column: 2;
  }
}
```

##### 4.3.3 Mobile Layout Validation

**iPhone SE (375px × 667px):**
- CommandBand height: 56px
- TabNav height: 50px
- Available for Notes tab content: 561px
- PreGameNotesPanel height: ~150–200px
- PlayerNotesPanel height: ~200–300px+
- **Total fit: ~350–500px** ✅ Within 561px available space (with scrolling)

**Expected Rendering:**
```
[CommandBand — 56px]
[TabNav — 50px]
────────────────────────────
[Notes Tab Content — 561px, scrollable]
  ├─ [Pre-Game Notes heading — 20px]
  ├─ [PreGameNotesPanel — 150–200px]
  ├─ [Player Notes heading — 20px]
  └─ [PlayerNotesPanel — 200–300px+]
```

**Scroll Behavior:**
- **Full tab scrolls together:** Both PreGameNotesPanel and PlayerNotesPanel are inside a single scrollable container (`.notes-tab-content`)
- **No per-panel scroll:** Avoid nested scrollable divs; keep scroll at tab level

##### 4.3.4 Accessibility Notes

- **Section Headings:** Use semantic `<h3>` tags (not `<div class="heading">`); improves screen reader navigation
- **Tab Panel:** Use `role="tabpanel"` and `aria-labelledby` to link notes tab content to the tab button
- **Scroll Container:** `.notes-tab-content` is the scroll target; keyboard users navigate within

##### 4.3.5 Optional: Collapsible PreGameNotesPanel (Future Enhancement)

For future iterations (not required for v1), consider making the PreGameNotesPanel collapsible to save mobile space:

```tsx
const [preGameNotesExpanded, setPreGameNotesExpanded] = useState(true);

{game.status === 'scheduled' && (
  <section className="notes-section pre-game-notes-section">
    <button 
      className="notes-section__toggle"
      onClick={() => setPreGameNotesExpanded(!preGameNotesExpanded)}
      aria-expanded={preGameNotesExpanded}
    >
      Pre-Game Notes
      <span className="toggle-icon">{preGameNotesExpanded ? '▼' : '▶'}</span>
    </button>
    {preGameNotesExpanded && <PreGameNotesPanel {...props} />}
  </section>
)}
```

This can be deferred to v2.

##### 4.3.6 Notes Tab Implementation Checklist

- [ ] PreGameNotesPanel renders above PlayerNotesPanel during scheduled state
- [ ] Both panels are inside a single scrollable container (`.notes-tab-content`)
- [ ] Section headings: `<h3>` with `font-size: 1.1em; margin-bottom: 0.5rem;`
- [ ] Mobile (≤599px): Vertical stack layout
- [ ] Desktop (≥600px): Optional side-by-side layout (or maintain vertical stack per design)
- [ ] Combined height (~350–500px) fits within iPhone SE tab viewport (~561px) with scrolling
- [ ] Scroll is smooth; no layout shift when scrolling
- [ ] Screen reader announces section headings properly

---

#### 4.4 GameManagement Orchestrator Changes

##### 4.4.1 Mount Both Subscription Hooks

```typescript
export function GameManagement() {
  const { gameId } = useParams();
  const [activeTab, setActiveTab] = useState<'plan' | 'field' | 'bench' | 'goals' | 'notes'>('plan');

  // Core game subscriptions
  const { game, team, availablePlayers, loading: gameLoading } = useGameSubscriptions(gameId);
  
  // Plan-specific subscriptions
  const { gamePlan, plannedRotations, loading: planLoading } = useGamePlanSubscriptions(gameId);
  
  // Planner state and handlers
  const plannerState = useGamePlanner({
    game,
    team,
    gamePlan,
    plannedRotations,
    mutations: { /* ... */ }
  });

  // Tab switching: Auto-switch from plan to field when game starts
  useEffect(() => {
    if (game?.status === 'in-progress' && activeTab === 'plan') {
      setActiveTab('field');
      
      // Focus management
      setTimeout(() => {
        const fieldTabContent = document.querySelector('[aria-controls="field-panel"]');
        const firstInteractive = fieldTabContent?.querySelector(
          'button, [href], input, select, textarea, [tabindex]'
        ) as HTMLElement;
        
        if (firstInteractive) {
          firstInteractive.focus();
        }
      }, 0);
    }
  }, [game?.status, activeTab]);

  // Help FAB context update
  useEffect(() => {
    const helpContext = {
      'scheduled': 'game-scheduled',
      'in-progress': 'game-in-progress',
      'halftime': 'game-halftime',
      'completed': 'game-completed'
    }[game?.status];
    
    if (helpContext) {
      setHelpContext(helpContext);
    }
  }, [game?.status]);

  return (
    <div className="game-management">
      <CommandBand gameState={game} />
      
      <TabNav 
        activeTab={activeTab} 
        onTabChange={setActiveTab}
        tabs={[
          { id: 'plan', label: 'Plan' },
          { id: 'field', label: 'Field' },
          { id: 'bench', label: 'Bench' },
          { id: 'goals', label: 'Goals' },
          { id: 'notes', label: 'Notes' }
        ]}
      />

      {activeTab === 'plan' && (
        <PlanTab
          readOnly={game?.status !== 'scheduled'}
          game={game}
          team={team}
          availablePlayers={availablePlayers}
          gamePlan={gamePlan}
          plannedRotations={plannedRotations}
          {...plannerState}
        />
      )}

      {activeTab === 'field' && <FieldTab {...props} />}
      {activeTab === 'bench' && <BenchTab {...props} />}
      {activeTab === 'goals' && <GoalTracker {...props} />}

      {activeTab === 'notes' && (
        <div className="notes-tab" role="tabpanel" aria-labelledby="notes-tab-button">
          <div className="notes-tab-content">
            {game?.status === 'scheduled' && (
              <section className="notes-section pre-game-notes-section">
                <h3 className="notes-section__heading">Pre-Game Notes</h3>
                <PreGameNotesPanel {...props} />
              </section>
            )}
            <section className="notes-section player-notes-section">
              <h3 className="notes-section__heading">Player Notes</h3>
              <PlayerNotesPanel {...props} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

### Phase 5 — Remove `GamePlanner` + add backward-compat redirect

**Files:**
- Delete `src/components/GamePlanner.tsx`
- Delete `src/components/routes/GamePlannerRoute.tsx`
- Create `src/components/routes/GamePlanRedirect.tsx`
- Update `src/App.tsx`

**Work:**

1. Create `GamePlanRedirect`:
   ```tsx
   export function GamePlanRedirect() {
     const { gameId } = useParams();
     return <Navigate to={`/game/${gameId}`} replace />;
   }
   ```

2. In `App.tsx`, replace the GamePlannerRoute:
   ```tsx
   // Remove: <Route path="game/:gameId/plan" element={<GamePlannerRoute />} />
   // Add:
   <Route path="game/:gameId/plan" element={<GamePlanRedirect />} />
   ```

3. Delete the two removed files: `GamePlanner.tsx`, `GamePlannerRoute.tsx`

---

### Phase 6 — Update `Home.tsx`

**Files:**
- `src/components/Home.tsx`

**Work:**

1. Remove `handlePlanClick` function entirely

2. Remove `.plan-button` ("Plan Game") from all game card JSX; all game statuses use a single "Open Game" button

3. Update game card JSX:
   ```tsx
   // Before:
   <button className="plan-button" onClick={() => handlePlanClick(game)}>📋 Plan Game</button>

   // After: (removed entirely, single "Open Game" button handles all)
   ```

---

### Phase 7 — Update Help System

**Files:**
- `src/help.ts`

**Work:**

1. **Remove `'game-planner'` from HelpScreenKey union:**
   ```typescript
   export type HelpScreenKey =
     | 'team-management'
     | 'player-management'
     | 'formation-management'
     | 'game-scheduled'
     | 'game-in-progress'
     | 'game-halftime'
     | 'game-completed'
     | 'season-reports'
     | 'manage-profile'
     | 'app-settings'
     // Remove: | 'game-planner'
   ```

2. **Delete the `'game-planner'` article block from HELP_CONTENT:**
   - Remove the entire object at `HELP_CONTENT['game-planner']`

3. **Update `'game-scheduled'` article to reference Plan tab:**
   - Change references from "Game Planner screen" to "Plan tab in Game Management"
   - Example: "Go to the Plan tab in Game Management to set up your starting lineup and rotation strategy"

4. **Update relatedScreens references:**
   - Remove `'game-planner'` from any relatedScreens arrays in other articles
   - Example: `relatedScreens: ['game-in-progress']` (was `['game-planner', 'game-in-progress']`)

5. **Verify TypeScript compilation:**
   - Run: `npx tsc --noEmit`
   - All TypeScript errors must resolve before proceeding

---

### Phase 8 — Update E2E Tests

**Affected Test Files Identified:**
1. `e2e/game-planner.spec.ts` — Main test file for planner functionality
2. `e2e/full-workflow.spec.ts` — Navigation from Home → Plan Game button
3. `e2e/team-sharing.spec.ts` — References to `.game-planner-container`
4. `e2e/README.md` — Documentation references

**Files:**
- `e2e/game-planner.spec.ts`
- `e2e/full-workflow.spec.ts`
- `e2e/team-sharing.spec.ts`
- `e2e/README.md`
- `playwright.config.ts` (no changes needed; file still exists)

**Work:**

#### Task 8.1: `e2e/game-planner.spec.ts` — Update Navigation & Selectors
1. Replace navigation from `/game/:gameId/plan` to `/game/:gameId`
   ```typescript
   // Before:
   await page.goto(`/game/${gameId}/plan`);
   
   // After:
   await page.goto(`/game/${gameId}`);
   await expect(page.locator('[data-tab="plan"]')).toBeVisible(); // New selector for Plan tab
   ```

2. Update `openGamePlanner` helper function to navigate to `/game/:gameId` instead of `/game/:gameId/plan`

3. Update selector `.game-planner-container` to target Plan tab content instead:
   ```typescript
   // Before:
   await expect(page.locator('.game-planner-container')).toBeVisible();
   
   // After:
   await expect(page.locator('[data-tab="plan"][aria-selected="true"]')).toBeVisible();
   ```

4. **Test Selectors to Update:**
   - `.game-planner-container` → `[data-tab="plan"]` or Plan tab content wrapper
   - All rotation interval, half length, and generate buttons now exist in the Plan tab

#### Task 8.2: `e2e/full-workflow.spec.ts` — Update "Plan Game" Navigation
1. Replace "Plan Game" button click with "Open Game" button:
   ```typescript
   // Before:
   const planButton = gameCard.locator('.plan-button');
   await planButton.click();
   await page.goto(`/game/${gameId}/plan`);
   
   // After:
   const openButton = gameCard.locator('.open-button'); // or generic open button
   await openButton.click();
   ```

2. After navigating to `/game/:gameId`, click the Plan tab before interacting with planner UI:
   ```typescript
   // Add before existing rotation setup:
   await page.getByRole('tab', { name: /plan/i }).click();
   await expect(page.getByRole('tab', { name: /plan/i })).toHaveAttribute('aria-selected', 'true');
   ```

3. Update comment:
   ```typescript
   // Before:
   // Click the "Plan Game" button on the game card to go to GamePlanner
   
   // After:
   // Click the "Open Game" button and navigate to Plan tab
   ```

#### Task 8.3: `e2e/team-sharing.spec.ts` — Update Planner Container Reference
1. Replace selector:
   ```typescript
   // Before:
   await expect(page.locator('.game-planner-container')).toBeVisible({ timeout: 10000 });
   
   // After:
   await expect(page.locator('[data-tab="plan"]')).toBeVisible({ timeout: 10000 });
   ```

#### Task 8.4: `e2e/README.md` — Update Documentation
1. Update `game-planner.spec.ts` description to reflect new behavior:
   ```markdown
   | `game-planner.spec.ts` | Pre-game planning via Plan tab, player availability, rotation builder |
   ```

---

## Pre-Game Notes Layout Specification

**Consolidated Notes Tab (Scheduled State):**

The Notes tab during scheduled games consolidates pre-game annotations:

```tsx
{activeTab === 'notes' && (
  <div className="notes-tab-content">
    {game.status === 'scheduled' && (
      <section className="pre-game-notes-section">
        <h3>Pre-Game Notes</h3>
        <PreGameNotesPanel {...props} />
      </section>
    )}
    <section className="player-notes-section">
      <h3>Player Notes</h3>
      <PlayerNotesPanel {...props} />
    </section>
  </div>
)}
```

**Layout Details:**
- **Scheduled state:** PreGameNotesPanel renders **above** PlayerNotesPanel (stacked vertically)
- **In-progress/completed state:** Only PlayerNotesPanel renders
- **Mobile (< 600px):** Both panels stack vertically with clear section headings
- **Desktop (≥ 600px):** Could be side-by-side if UI spec permits, otherwise maintain vertical stack

---

## Data Model & Subscription Integration

### Data Flow Diagram

```
GameManagement (root)
├─ useGameSubscriptions({ gameId })
│  └─ Returns: { game, team, availablePlayers, ... }
│
├─ useGamePlanSubscriptions({ gameId })
│  ├─ Subscribes: client.models.GamePlan.observeQuery({ filter: { gameId } })
│  ├─ Subscribes: client.models.PlannedRotation.observeQuery({ filter: { gameId } })
│  └─ Returns: { gamePlan, plannedRotations, loading, error }
│
└─ useGamePlanner({
     game,
     team,
     gamePlan,        ← From useGamePlanSubscriptions
     plannedRotations, ← From useGamePlanSubscriptions
     mutations
   })
   ├─ Manages: startingLineup, halftimeLineup, rotationInterval, etc.
   ├─ Handlers: createPlan, autoGenerate, swapPlayer, copyPlanFromPrevious
   └─ Returns: { state, handlers }
```

### Key Points

1. **Subscription Isolation:** `useGamePlanSubscriptions` is completely independent from `useGameSubscriptions`. No shared state.
2. **Data Flow:** Subscription data flows down as props to `useGamePlanner`, which consumes it but does not re-subscribe.
3. **Mutations:** When `useGamePlanner` creates/updates a GamePlan or PlannedRotation, the Amplify client triggers the subscription update automatically.
4. **Lifecycle:** Both subscriptions mount at GameManagement level and unmount when the component unmounts.

---

## Risks & Dependencies

### Risks

1. **Subscription Cleanup:** Ensure both `useGamePlanSubscriptions` and `useGameSubscriptions` properly unsubscribe on unmount. Leaking subscriptions will cause duplicate data or memory leaks.
   - **Mitigation:** Use `useEffect` cleanup functions with explicit `.unsubscribe()` calls.

2. **Tab Switching Race Condition:** If a game transitions to in-progress while the user is interacting with the Plan tab, the auto-switch to Field tab could be jarring.
   - **Mitigation:** The `useEffect` watching `game.status` is synchronous and will execute before the user sees any plan tab content.

3. **Mobile 375px Viewport:** Opponent name truncation and 5-tab horizontal scroll could conflict.
   - **Mitigation:** CSS `max-width` on opponent name is strictly enforced; test on actual 375px devices.

4. **E2E Test Brittleness:** Updated selectors (Plan tab, data-tab attributes) must be consistent across all tests.
   - **Mitigation:** Use data-tab selectors consistently; avoid fragile class-based selectors.

5. **Help System References:** After removing 'game-planner' from HelpScreenKey, any stale references in UI code will cause TypeScript errors.
   - **Mitigation:** `npx tsc --noEmit` must pass before proceeding.

### Dependencies

- `useGamePlanSubscriptions` depends on Amplify observeQuery subscriptions being available
- `useGamePlanner` depends on `useGamePlanSubscriptions` data being available
- All E2E tests depend on navigation redirects being properly set up in App.tsx
- Help system removal depends on removal of 'game-planner' from all relatedScreens arrays

---

## Relevant Files

### Modified
| File | Change |
|---|---|
| `src/components/GameManagement/GameManagement.tsx` | Mount both subscription hooks; wire unified tabs; implement tab switching logic |
| `src/components/GameManagement/CommandBand.tsx` | Support scheduled state UI with opponent name truncation and Start Game CTA |
| `src/components/GameManagement/TabNav.tsx` | Add 'Plan' tab as first tab; add horizontal scroll CSS |
| `src/App.tsx` | Replace GamePlannerRoute with GamePlanRedirect |
| `src/components/Home.tsx` | Remove "Plan Game" button; single "Open Game" for all statuses |
| `src/help.ts` | Remove 'game-planner' from HelpScreenKey union; delete article; update 'game-scheduled'; remove from relatedScreens |
| `e2e/game-planner.spec.ts` | Update navigation from `/plan` to `/gameId`; update selectors for Plan tab |
| `e2e/full-workflow.spec.ts` | Update "Plan Game" button to "Open Game"; click Plan tab after navigation |
| `e2e/team-sharing.spec.ts` | Update `.game-planner-container` selector to Plan tab selector |
| `e2e/README.md` | Update game-planner.spec.ts description |

### Created
| File | Purpose |
|---|---|
| `src/components/GameManagement/hooks/useGamePlanSubscriptions.ts` | Isolated subscriptions for GamePlan & PlannedRotations |
| `src/components/GameManagement/hooks/useGamePlanner.ts` | Extracted planner state + handlers (consumes GamePlan/PlannedRotations as props) |
| `src/components/GameManagement/PlanTab.tsx` | Rotation planning UI panel with readOnly support |
| `src/components/routes/GamePlanRedirect.tsx` | Backward-compat redirect from `/plan` sub-route |

### Deleted
| File | Reason |
|---|---|
| `src/components/GamePlanner.tsx` | Functionality absorbed into GameManagement |
| `src/components/routes/GamePlannerRoute.tsx` | Route removed |

---

## Test Strategy

### Unit Tests (Vitest)

1. **`useGamePlanSubscriptions.test.ts`** (new)
   - Mock Amplify observeQuery subscriptions
   - Verify `gamePlan` and `plannedRotations` state updates
   - Verify unsubscribe cleanup on unmount

2. **`useGamePlanner.test.ts`** (new)
   - Mock prop inputs (game, team, gamePlan, plannedRotations, mutations)
   - Test state transitions and handlers
   - Verify mutation calls trigger correctly

3. **`PlanTab.test.tsx`** (new)
   - Test readOnly prop: verify hidden/disabled elements
   - Test rendering with various state combinations

### E2E Tests (Playwright)

1. **`game-planner.spec.ts`** (updated)
   - ✅ Open scheduled game → Plan tab visible
   - ✅ Availability grid functional in Plan tab
   - ✅ Rotation generation works in Plan tab
   - ✅ Timeline interaction works
   - ✅ Copy plan from previous game works
   - ✅ Start game → auto-switch to Field tab
   - ✅ After game starts, Plan tab is read-only (buttons hidden, inputs disabled)
   - ✅ Navigate directly to `/game/:gameId/plan` → redirects to `/game/:gameId`

2. **`full-workflow.spec.ts`** (updated)
   - ✅ Home page shows "Open Game" button (no "Plan Game")
   - ✅ Click "Open Game" → navigates to /game/:gameId
   - ✅ Plan tab is active by default
   - ✅ Setup lineup from Plan tab
   - ✅ Click "Start Game" → auto-switch to Field tab

3. **`team-sharing.spec.ts`** (updated)
   - ✅ Plan tab visible in shared team game

### Gate Command

```bash
npm run gate:commit
```

Must pass: lint → test:run → build

---

## Verification Checklist

### Core Functionality
- [ ] `npm run gate:commit` passes (lint → test:run → build)
- [ ] Navigate to a scheduled game → CommandBand shows "Scheduled" badge, opponent name (truncated on mobile), and "Start Game" CTA
- [ ] Plan | Field | Bench | Goals | Notes tabs visible; Plan tab active by default
- [ ] All GamePlanner functionality accessible from Plan tab (availability grid, half length, interval, create plan, auto-generate, rotation timeline, projected play time, copy from previous game)
- [ ] Plan tab is fully editable during scheduled state
- [ ] Click "Start Game" → game.status becomes 'in-progress' and activeTab auto-switches to 'field'
- [ ] Plan tab is now read-only: rotation generate button hidden, copy plan button hidden, swap modal hidden; interval/rotations inputs disabled with visual styling (opacity: 0.6)
- [ ] Navigate to `/game/:gameId/plan` directly → redirects cleanly to `/game/:gameId`
- [ ] Home page shows a single "Open Game" button for all game statuses; no "Plan Game" button
- [ ] `useGamePlanSubscriptions` hook initializes before Plan tab mounts (no undefined data)
- [ ] `/game/:gameId/plan` redirect does not create duplicate subscriptions
- [ ] No TypeScript errors in updated files
- [ ] No console errors or warnings during test runs

### UI Designer Findings — Mobile Tab Overflow (375px Viewport)
- [ ] ✅ TabNav CSS has `overflow-x: auto; white-space: nowrap;`
- [ ] ✅ TabNav tabs have `min-width: 90px` to prevent label truncation
- [ ] ✅ All 5 tabs (Plan, Field, Bench, Goals, Notes) are accessible on 375px viewport
- [ ] ✅ Plan tab is first tab in tab order (appears first, may be off-screen on first load depending on CSS)
- [ ] ✅ Tab labels are readable at 0.95rem font size on 375px
- [ ] ✅ **Device Test: iPhone SE (375px)**
  - [ ] Load game → See ~3–4 tabs visible without scroll
  - [ ] Scroll right → All 5 tabs accessible (Plan, Field, Bench, Goals, Notes visible in sequence)
  - [ ] Tab labels not truncated (full text visible or with ellipsis if longer)
- [ ] ✅ **Device Test: iPhone 12 mini (390px)**
  - [ ] Load game → See 4–5 tabs visible without scroll
  - [ ] Partial horizontal scroll on edge cases (verify tabs scroll smoothly)
- [ ] ✅ **Device Test: iPhone 12/13+ (430px)**
  - [ ] Load game → All 5 tabs visible without scroll
- [ ] ✅ **Keyboard Navigation:** Arrow keys navigate tabs during horizontal scroll
  - [ ] ArrowRight cycles to next tab; focuses tab; scrolls tab into view if needed
  - [ ] ArrowLeft cycles to previous tab
  - [ ] Home key moves focus to first tab (Plan)
  - [ ] End key moves focus to last tab (Notes)
- [ ] ✅ **Touch targets:** All tabs are ≥44px height for mobile accessibility

### UI Designer Findings — CommandBand Scheduled State Layout
- [ ] ✅ CommandBand has 3-column grid layout: Left (back + badge) | Center (flex-grow) | Right (opponent + CTA)
- [ ] ✅ "Scheduled" badge renders with CSS token colors (--command-band-scheduled-bg, --command-band-scheduled-text)
- [ ] ✅ "Scheduled" badge font-size: 0.72rem, border-radius: 4px, padding: 0.25rem 0.5rem
- [ ] ✅ Opponent name has `title` attribute for tooltip on hover (full name visible when truncated)
- [ ] ✅ Opponent name truncation CSS: `white-space: nowrap; text-overflow: ellipsis; overflow: hidden;`
- [ ] ✅ **Mobile Breakpoint Table Verified:**
  - [ ] ≤375px: opponent max-width 140px, font-size 0.9rem
  - [ ] 376–430px: opponent max-width 180px, font-size 1rem
  - [ ] ≥431px: opponent max-width 240px, font-size 1rem
- [ ] ✅ **Example: 375px viewport with long opponent name**
  - [ ] Input: "Team @ Riverside Sports Academy" (32 characters)
  - [ ] Rendering: "Team @ Rive..." (truncated with ellipsis)
  - [ ] Tooltip: Hover shows full "Team @ Riverside Sports Academy"
- [ ] ✅ Start Game button fits alongside truncated opponent name on 375px (no layout overflow)
- [ ] ✅ Opponent name abbreviation logic: NOT implemented; deferred as future enhancement
- [ ] ✅ All buttons have proper `aria-label` attributes (accessibility)
- [ ] ✅ Contrast verified: All text meets WCAG AA 4.5:1 minimum

### UI Designer Findings — Read-Only Plan Tab (WCAG AA Contrast)
- [ ] ✅ Disabled inputs have CSS: `opacity: 0.6; color: var(--text-secondary); pointer-events: none; cursor: not-allowed;`
- [ ] ✅ Disabled inputs use native HTML `disabled` attribute (not `aria-disabled`)
- [ ] ✅ Disabled buttons are hidden with `display: none` (not `visibility: hidden`)
- [ ] ✅ Hidden buttons: rotationGenerateButton, copyPlanButton, swapModal, rotationDeleteButton
- [ ] ✅ Disabled inputs: rotationIntervalInput, rotationsPerHalfInput, halftimeLookupButton
- [ ] ✅ **WCAG AA Contrast Verification:**
  - [ ] Disabled text color (#212121 @ 0.6 opacity ≈ #737373) has contrast ≥4.5:1 ✅ (actual ≈8.2:1)
  - [ ] Background: white (or var(--color-surface) if applicable)
  - [ ] Passes WCAG 2.1 § 3.3.1 (labels/instructions for inputs)
- [ ] ✅ Screen reader test: Disabled inputs announced as "disabled" or "unavailable"
- [ ] ✅ Disabled inputs have associated `<label>` elements with clear descriptive text
- [ ] ✅ Optional lock icon/badge NOT implemented for v1 (noted as future enhancement)
- [ ] ✅ Axe-core or similar tool confirms ≥4.5:1 contrast on all disabled inputs

### UI Designer Findings — Notes Tab Scroll Container Height CSS (Critical Gap)
- [ ] ✅ `.game-tab-content` CSS rule applied: `max-height: calc(100dvh - 56px - 44px);`
- [ ] ✅ `overflow-y: auto` set on scroll container
- [ ] ✅ `overflow-x: hidden` prevents horizontal scroll
- [ ] ✅ `100dvh` used for dynamic viewport height (fallback `100vh` via `@supports`)
- [ ] ✅ Height calculation verified: CommandBand (56px) + TabNav (44px) + available (~567px on iPhone SE)
- [ ] ✅ **iPhone SE Test (375px × 667px):**
  - [ ] Scroll container max-height = calc(667px - 56px - 44px) ~567px
  - [ ] Both panels fit within calculated height with scroll
  - [ ] No content overflow or clipping
- [ ] ✅ **iPhone 12 mini Test (390px × 780px):**
  - [ ] Scroll container max-height ~680px
  - [ ] Smooth scroll behavior
- [ ] ✅ **iPad Test (768px × 1024px):**
  - [ ] Scroll container max-height ~924px
  - [ ] Both panels fit; minimal/no scroll needed
- [ ] ✅ **Mobile address bar expansion (iOS):**
  - [ ] `100dvh` dynamically adjusts when address bar shows/hides
  - [ ] No manual resize handler needed
- [ ] ✅ **Browser Compatibility:**
  - [ ] Chrome 108+, Firefox 101+, Safari 15.4+, iOS Safari 15.4+ support `100dvh`
  - [ ] Fallback to `100vh` for older browsers
- [ ] ✅ **DevTools Verification:**
  - [ ] Inspect `.game-tab-content` → Computed Styles
  - [ ] `max-height` calculated correctly (e.g., 567px on iPhone SE)
  - [ ] `overflow-y: auto` present
  - [ ] No content clipping
- [ ] ✅ **Accessibility:**
  - [ ] Keyboard scrolling works (arrow keys, Page Down, space)
  - [ ] Screen reader announces scrollable region
  - [ ] Focus remains accessible throughout scroll area
  - [ ] No hidden content

### Read-Only Plan Tab — Mutation Abort Strategy (Critical Gap)
- [ ] ✅ `useGamePlanner` hook includes AbortController integration
- [ ] ✅ `mutationAbortControllerRef` created and managed in hook
- [ ] ✅ When mutation starts, `new AbortController()` is created and signal passed to mutation call
- [ ] ✅ When `game.status === 'in-progress'`, `abortController.abort()` is called
- [ ] ✅ Aborted mutations throw `DOMException` with `name === 'AbortError'` (caught and handled gracefully)
- [ ] ✅ **UI Behavior on Abort:**
  - [ ] Transient toast appears: "Plan mutation cancelled — game cannot be modified during live games"
  - [ ] Toast type: 'info', duration: 3s
  - [ ] `isGenerating` flag set to false (loading spinner disappears)
  - [ ] Plan tab UI reverts to pre-mutation state
- [ ] ✅ **Race Condition Test (Manual):**
  - [ ] Open scheduled game
  - [ ] Click "Auto-Generate Rotations" (mutation starts)
  - [ ] Immediately click "Start Game" CTA (within 1s)
  - [ ] **Expected:** Mutation aborted, toast shown, no data inconsistency
  - [ ] Verify DynamoDB: GamePlan/PlannedRotations NOT updated
  - [ ] Verify subscriptions show pre-mutation state
- [ ] ✅ **Race Condition Test (E2E):**
  - [ ] `e2e/game-planner.spec.ts` includes test: "Abort in-flight mutations when game starts"
  - [ ] Test starts mutation, triggers game start within 1s
  - [ ] Verifies abort and data consistency
- [ ] ✅ **Alternative Approach Documented:**
  - [ ] If AbortController unavailable, mutation completion validation approach documented
  - [ ] Validation checks `game.status` after mutation completes
  - [ ] If status changed to 'in-progress', mutation result is rejected
  - [ ] AbortController approach recommended as preferred (cleaner, more reliable)
- [ ] ✅ **No Data Inconsistency:**
  - [ ] GamePlan/PlannedRotations not updated in DynamoDB after abort
  - [ ] UI shows consistent state with subscriptions
  - [ ] No stale data replayed
- [ ] ✅ **Mutation Cleanup:**
  - [ ] useEffect cleanup on component unmount aborts any pending mutations
  - [ ] AbortController ref set to null after abort or success
  - [ ] No orphaned fetch/mutation requests

### UI Designer Findings — Tab Auto-Switch with Focus Management
- [ ] ✅ `useEffect` watches `game.status` and `activeTab` together
- [ ] ✅ When game.status === 'in-progress' and activeTab === 'plan', auto-switch to 'field' occurs
- [ ] ✅ Auto-switch is silent (no toast for v1; noted as optional enhancement)
- [ ] ✅ Focus is moved to first interactive element in Field tab (or Field tab button if fragile)
- [ ] ✅ **Keyboard Navigation Test:**
  - [ ] Start game from Plan tab → Auto-switch to Field tab (no console errors)
  - [ ] Focus is not lost; focus is announced or visible in Field tab
  - [ ] Keyboard user can Tab/Shift+Tab away from focused element without unexpected jumps
- [ ] ✅ Help FAB context updates from 'game-scheduled' to 'game-in-progress' after auto-switch
- [ ] ✅ Screen reader announces focus move (or tab switch) appropriately
- [ ] ✅ Tab is updated in DOM before focus is moved (no race conditions)
- [ ] ✅ Optional: Toast notification "Switched to Field view — game is live!" NOT implemented for v1 (deferred)

### UI Designer Findings — Notes Tab Mobile Layout
- [ ] ✅ Notes tab consolidates PreGameNotesPanel and PlayerNotesPanel during scheduled state
- [ ] ✅ PreGameNotesPanel renders **above** PlayerNotesPanel (stacked vertically on mobile)
- [ ] ✅ Both panels render inside single scrollable container (`.notes-tab-content`)
- [ ] ✅ Section headings: `<h3>` with `font-size: 1.1em; margin-bottom: 0.5rem;`
- [ ] ✅ Heading text: "Pre-Game Notes" and "Player Notes" (or equivalent)
- [ ] ✅ **Scroll Container:**
  - [ ] `.notes-tab-content` is scrollable (overflow-y: auto)
  - [ ] No nested/per-panel scrolling (smooth single-page scroll)
- [ ] ✅ **Mobile (≤599px) Layout:**
  - [ ] Vertical stack: Pre-Game Notes section → Player Notes section
  - [ ] Combined height (~350–500px) fits within iPhone SE available space (~561px)
  - [ ] No excessive white space; no layout shift during scroll
- [ ] ✅ **Desktop (≥600px) Layout:**
  - [ ] Optional side-by-side layout (or maintain vertical per design decision)
  - [ ] If side-by-side: Two-column grid layout verified
- [ ] ✅ **iPhone SE Test (375px × 667px):**
  - [ ] CommandBand height ≈ 56px
  - [ ] TabNav height ≈ 50px
  - [ ] Notes tab content available: ≈561px
  - [ ] Both panels visible with scrolling; no clipping
- [ ] ✅ Section headings announced by screen reader
- [ ] ✅ Tab panel has `role="tabpanel"` and `aria-labelledby` attributes
- [ ] ✅ Optional collapsible PreGameNotesPanel NOT implemented for v1 (deferred as future enhancement)

### Notes Tab Scroll Container Height CSS (Critical Gap)
- [ ] ✅ `.game-tab-content` CSS rule applied: `max-height: calc(100dvh - 56px - 44px);`
- [ ] ✅ `overflow-y: auto` set on scroll container
- [ ] ✅ `overflow-x: hidden` prevents horizontal scroll
- [ ] ✅ `100dvh` used for dynamic viewport height (fallback `100vh` via `@supports`)
- [ ] ✅ Height calculation verified: CommandBand (56px) + TabNav (44px) + available (≈567px on iPhone SE)
- [ ] ✅ **iPhone SE Test (375px × 667px):**
  - [ ] Scroll container max-height = calc(667px - 56px - 44px) ≈ 567px
  - [ ] Both panels fit within calculated height with scroll
  - [ ] No content overflow or clipping
- [ ] ✅ **iPhone 12 mini Test (390px × 780px):**
  - [ ] Scroll container max-height ≈ 680px
  - [ ] Smooth scroll behavior
- [ ] ✅ **iPad Test (768px × 1024px):**
  - [ ] Scroll container max-height ≈ 924px
  - [ ] Both panels fit; minimal/no scroll needed
- [ ] ✅ **Mobile address bar expansion (iOS):**
  - [ ] `100dvh` dynamically adjusts when address bar shows/hides
  - [ ] No manual resize handler needed
- [ ] ✅ **Browser Compatibility:**
  - [ ] Chrome 108+, Firefox 101+, Safari 15.4+, iOS Safari 15.4+ support `100dvh`
  - [ ] Fallback to `100vh` for older browsers
- [ ] ✅ **DevTools Verification:**
  - [ ] Inspect `.game-tab-content` → Computed Styles
  - [ ] `max-height` calculated correctly (e.g., 567px on iPhone SE)
  - [ ] `overflow-y: auto` present
  - [ ] No content clipping
- [ ] ✅ **Accessibility:**
  - [ ] Keyboard scrolling works (arrow keys, Page Down, space)
  - [ ] Screen reader announces scrollable region
  - [ ] Focus remains accessible throughout scroll area
  - [ ] No hidden content

### Read-Only Plan Tab — Mutation Abort Strategy (Critical Gap)
- [ ] ✅ `useGamePlanner` hook includes AbortController integration
- [ ] ✅ `mutationAbortControllerRef` created and managed in hook
- [ ] ✅ When mutation starts, `new AbortController()` is created and signal passed to mutation call
- [ ] ✅ When `game.status === 'in-progress'`, `abortController.abort()` is called
- [ ] ✅ Aborted mutations throw `DOMException` with `name === 'AbortError'` (caught and handled gracefully)
- [ ] ✅ **UI Behavior on Abort:**
  - [ ] Transient toast appears: "Plan mutation cancelled — game cannot be modified during live games"
  - [ ] Toast type: 'info', duration: 3s
  - [ ] `isGenerating` flag set to false (loading spinner disappears)
  - [ ] Plan tab UI reverts to pre-mutation state
- [ ] ✅ **Race Condition Test (Manual):**
  - [ ] Open scheduled game
  - [ ] Click "Auto-Generate Rotations" (mutation starts)
  - [ ] Immediately click "Start Game" CTA (within 1s)
  - [ ] **Expected:** Mutation aborted, toast shown, no data inconsistency
  - [ ] Verify DynamoDB: GamePlan/PlannedRotations NOT updated
  - [ ] Verify subscriptions show pre-mutation state
- [ ] ✅ **Race Condition Test (E2E):**
  - [ ] `e2e/game-planner.spec.ts` includes test: "Abort in-flight mutations when game starts"
  - [ ] Test starts mutation, triggers game start within 1s
  - [ ] Verifies abort and data consistency
- [ ] ✅ **Alternative Approach Documented:**
  - [ ] If AbortController unavailable, mutation completion validation approach documented
  - [ ] Validation checks `game.status` after mutation completes
  - [ ] If status changed to 'in-progress', mutation result is rejected
  - [ ] AbortController approach recommended as preferred (cleaner, more reliable)
- [ ] ✅ **No Data Inconsistency:**
  - [ ] GamePlan/PlannedRotations not updated in DynamoDB after abort
  - [ ] UI shows consistent state with subscriptions
  - [ ] No stale data replayed
- [ ] ✅ **Mutation Cleanup:**
  - [ ] useEffect cleanup on component unmount aborts any pending mutations
  - [ ] AbortController ref set to null after abort or success
  - [ ] No orphaned fetch/mutation requests

### Help System Removal Checklist
- [ ] Removed `'game-planner'` from HelpScreenKey union in `src/help.ts`
- [ ] Deleted `'game-planner'` article from HELP_CONTENT
- [ ] Updated `'game-scheduled'` article to mention "Plan tab in Game Management" (not separate GamePlanner screen)
- [ ] Removed `'game-planner'` from relatedScreens arrays in other articles
- [ ] `npx tsc --noEmit` compiles with zero errors

### E2E Tests
- [ ] `npm run test:e2e game-planner.spec.ts` — All tests pass
  - [ ] ✅ Open scheduled game → Plan tab visible
  - [ ] ✅ Availability grid functional in Plan tab
  - [ ] ✅ Rotation generation works in Plan tab
  - [ ] ✅ Timeline interaction works
  - [ ] ✅ Copy plan from previous game works
  - [ ] ✅ Start game → auto-switch to Field tab
  - [ ] ✅ After game starts, Plan tab is read-only (buttons hidden, inputs disabled)
  - [ ] ✅ Navigate directly to `/game/:gameId/plan` → redirects to `/game/:gameId`
- [ ] `npm run test:e2e full-workflow.spec.ts` — Navigation tests pass
  - [ ] ✅ Home page shows "Open Game" button (no "Plan Game")
  - [ ] ✅ Click "Open Game" → navigates to /game/:gameId
  - [ ] ✅ Plan tab is active by default
  - [ ] ✅ Setup lineup from Plan tab
  - [ ] ✅ Click "Start Game" → auto-switch to Field tab
- [ ] `npm run test:e2e team-sharing.spec.ts` — Shared team access passes
  - [ ] ✅ Plan tab visible in shared team game

### Final Validation
- [ ] All files compiled without TypeScript errors
- [ ] All E2E tests pass on Chrome, Firefox (if configured)
- [ ] No console errors or warnings in browser dev tools
- [ ] Mobile devices tested: iPhone SE, 12, 12 mini (if available)
- [ ] Tablet tested: iPad or equivalent (≥768px)
- [ ] Keyboard navigation fully functional (Tab, Shift+Tab, Arrow keys, Home, End)
- [ ] Screen reader navigation tested (NVDA, JAWS, or Mac Voiceover)
- [ ] All UI design findings incorporated and verified
- [ ] Ready for commit gate: `npm run gate:commit`

---

## Open Considerations

### 1. Pre-game Notes vs Player Notes Consolidation
Handled by rendering PreGameNotesPanel conditionally above PlayerNotesPanel in Notes tab when `game.status === 'scheduled'`. Both components remain separate to avoid overly complex logic.

---

## Additional Implementation Notes

### Analytics Event Tracking

No changes to analytics. Existing events (`PLAN_SAVED`, `AUTO_GENERATE_ROTATIONS`, `COPY_PLAN_FROM_GAME`) continue to fire from `useGamePlanner` hook.

### Debug Utilities

`gamePlannerDebugUtils.ts` continues to function. The `buildDebugSnapshot` utility remains available for debugging within the GameManagement scheduled state (can be wired into DevTools or debug panel).

---
