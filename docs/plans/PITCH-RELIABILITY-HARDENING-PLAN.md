# Implementation Plan: Pitch Reliability Hardening

**Status:** Revised after architect review (two independent passes). The first draft was found to introduce a critical regression in Issue A and understated Issue C's real scope; both are corrected below. See "Revision history" at the bottom.

**Source:** Architecture review + independent verification by two model reviews (see conversation log; not checked into the repo), followed by two independent `architect-reviewer` passes against this plan itself. Findings below are the surviving, code-verified subset.

**Scope:** This plan addresses architectural weaknesses in live-game handling under poor sideline connectivity.

---

## Priority & Sequencing

| # | Issue | Priority | Risk of fix | Pipeline |
|---|---|---|---|---|
| A | Orphaned `PlayTimeRecord` silently over-credits play time (offline sub + offline halftime) | **P0 — active data-integrity bug** | Low-medium if built on the deterministic-id approach (below); the original reconciliation-pass design was higher risk and is dropped | Full dev-pipeline (touches offline architecture) |
| B | Game clock can't be stopped by a crash/forgotten pause; unstoppable drift feeds bad data into `PlayTimeRecord` | **P1 — data-integrity safety net** | Medium (new UX surface, must not race the two existing auto-triggers) | Full dev-pipeline (UI-impacting) |
| C | Ref-guard sprawl across three files patching races between local game state and the `observeQuery` subscription | **P2 — maintainability** | Medium — higher than originally scoped; see revision below | Defect-fix pipeline, refactor-only, staged |
| D | No transactional guarantee across `PlayTimeRecord`/`LineupAssignment`/`Substitution` writes | **P3 — structural, high value, high cost** | High | Own plan-writer + architect-reviewer pass; **not scoped for implementation here** |

**Revised order: A → B → C → D** (changed from A → C → B — see "Sequencing" revision note below).

A self-contained subset — the deterministic-id fix and the GSI query swap inside Issue A — is low-risk enough to land ahead of the rest of this plan if the team wants to unblock incrementally.

---

## Issue A — Orphaned PlayTimeRecord over-credits play time

### Root cause (verified chain)
1. `closeActivePlayTimeRecords` (`src/services/substitutionService.ts:67-69`, and a second, unmentioned-until-now instance at `:132-134`) does a `PlayTimeRecord.list()` read as a two-phase safety net for records not present in local state, and swallows a failed/offline read instead of surfacing it.
2. Because nothing throws, the caller believes closing succeeded and no retry is scheduled.
3. The subbed-in player's `PlayTimeRecord` (itself sitting in the offline queue, not yet in DynamoDB or React state) never gets `endGameSeconds` set at the halftime boundary.
4. At end-game, `closeActivePlayTimeRecords` runs again, finds the still-open record, and closes it using `endGameTime` — silently crediting the player for time they didn't play.
5. `SeasonReport.tsx:377-396` back-fills unclosed records for *display*, but this doesn't touch the live rotation math (`rotationPlannerService.ts`).

### Design — corrected after architect review

**The first draft's fix (throw on failed read + a bespoke post-drain reconciliation pass) is dropped.** Architect review found it would introduce a *worse* regression and reinvents a mechanism already in the codebase:

- **Would-be regression:** `handleStartSecondHalf` (`GameManagement.tsx:1661-1670`) already consumes `halftimePtrClosePendingRef`: on second-half start it re-runs `closeActivePlayTimeRecords`, and **on throw it calls `handleApiError` and `return`s** — meaning if a coach is still offline exactly at the moment they try to start the second half, making the read throw (as the original fix proposed) would leave them stuck unable to start the second half at all, with no connectivity to recover. Worse than the bug it fixes.
- **Reinvented mechanism:** `buildDeterministicStartPlayTimeRecordId` (`GameManagement.tsx:90`, used at `:1527` and `:1736`) already gives `PlayTimeRecord` creates client-side deterministic ids at game start and second-half start, and `executePlayTimeRecordCreate` (`useOfflineMutations.ts:232`) already treats a duplicate-id create as idempotent. Only the substitution-created record (`substitutionService.ts:~234-239`) omits an id.

**Revised fix:**
1. **Give the substitution-created `PlayTimeRecord` a deterministic id**, using the same helper/pattern as the other two creation sites. This makes the eventual halftime-close an ordinary queued `PlayTimeRecord.update` against a known id, which `dequeueAll()` (sorted by `enqueuedAt`, `offlineQueueService.ts:61`) replays in order after its own create — no bespoke reconciliation pass required.
2. **Do not change the throw/swallow behavior in `closeActivePlayTimeRecords`** unless step 1 alone is shown insufficient in testing — the existing `handleStartSecondHalf` retry becomes the natural place this resolves, once the queued update has a known id to target instead of depending on the read that currently gets swallowed.
3. **Fix the stale-comment performance issue found in review as part of the same change:** `closeActivePlayTimeRecords` currently paginates `PlayTimeRecord.list({filter})` (a Scan, `limit: 1000`) with a `setTimeout(500)` between two passes, with a comment claiming this is "without a GSI on gameId" (`substitutionService.ts:32`) — but `amplify/data/resource.ts:322` already defines `index('gameId').queryField('listPlayTimeRecordsByGameId')`. Switch to the GSI-backed query. This directly reduces the latency window that makes the offline race in this issue more likely on a weak connection, so it belongs in this issue's scope, not as a separate cleanup.
4. **Regression test the exact chain:** offline substitution → offline halftime → reconnect → assert the subbed-in player's `PlayTimeRecord.endGameSeconds` equals the halftime boundary. Also add the test review flagged as missing: offline substitution → coach attempts to start the second half **while still offline** → must not hard-block (this is exactly the A-1 regression scenario above; the fix must be verified not to reintroduce it).
5. **Do not add a second, independent reconciliation pass.** Architect review found the offline queue already has two separate drain loops over the same IndexedDB store — `useOfflineMutations.drainQueue` and `useOfflineQueueDrain.ts`'s own `drainQueue`, mounted separately (the latter app-wide in `AppLayout.tsx`), with **different model allowlists** (`useOfflineQueueDrain.ts`'s `DRAINABLE_MODELS` vs. `useOfflineMutations.ts`'s internal allowlist) and only one of the two has an `isDrainingRef` lock. This divergence is a real risk for *any* future reconciliation logic, not just this issue — track it separately (see "New: Issue E" below) rather than building Issue A's fix on top of it.

### Files
- `src/services/substitutionService.ts` — deterministic id on the substitution-created `PlayTimeRecord`; GSI query swap; remove stale comment
- `src/components/GameManagement/GameManagement.tsx` — verify `handleStartSecondHalf`'s existing retry path composes correctly with the now-idempotent update
- Tests: `substitutionService.test.ts`, `useOfflineMutations.test.ts`, `offlineQueueService.test.ts`, plus the offline-at-second-half-start case above

### Edge cases
- Multiple offline substitutions before an offline halftime — each needs its own deterministic id; verify no collision.
- Reconnect happens mid-drain and the app is closed again before the update settles — since this is now an ordinary queued mutation (not bespoke reconciliation state), it survives in IndexedDB like any other queued item, which is the point of this redesign.
- Coach never reconnects until well after the game — the queued update still targets the correct game-clock second (captured at halftime time, not "now"), since it was enqueued with that payload at the time.

---

## Issue B — Unstoppable clock drift during unrecorded stoppages

### Root cause (verified)
`lastStartTime` is a wall-clock anchor with no upper bound: if the coach doesn't tap pause before a crash, force-quit, or extreme backgrounding, elapsed wall-clock time keeps accruing with nothing to arrest it, and that number flows into `PlayTimeRecord.endGameSeconds`.

### Design — corrected after architect review

The first draft under-specified how the proposed confirmation modal interacts with **two existing silent auto-triggers**, both of which architect review confirmed in code:

1. **Auto-halftime is explicitly documented as silent.** `docs/specs/Game-Management-Spec.md:89`: *"If the app was backgrounded when half-time would have occurred... `handleHalftime` fires immediately — no confirmation is shown to the coach."* A modal that fires on any large gap, without excluding this case, directly contradicts shipped, documented behavior.
2. **Auto-end-game at 7200s has the same race, worse.** `useGameTimer.ts:109`: `if (derived >= 7200 && !endGameTriggeredRef.current)`. A crash gap over two hours fires `onEndGame` on the very first tick after resume — before any confirmation modal could ever render. The modal cannot be "a separate reaction to a detected gap" if a faster, silent auto-trigger already consumes that same tick.

**Revised design:**
1. **The modal applies only when the resumed elapsed time does not cross either auto-trigger boundary** (`halfLengthSeconds` for auto-halftime, `7200` for auto-end). Both existing auto-triggers keep their current silent behavior unchanged — this plan does not touch them. The gap-detection check must run in the same tick/resume-detection path that already decides whether to fire those triggers (`useGameTimer.ts`'s 500ms tick), not as an independently-scheduled effect that could lose the race to `setTimeout(..., 0)`-scheduled auto-triggers.
2. **Audit-trail mechanism must be decided before implementation, not left as "GameNote or a dedicated field."** Architect review found both options have real cost: `GameNote` creates now route through a `createSecureGameNote` custom mutation that strips `coaches`/`authorId` server-side and uses a closed `noteType` enum (would need a schema + Lambda change to add a new type); a dedicated `Game` field is a schema change following the `coaches[]` authorization pattern in `amplify/data/resource.ts`, which brings this squarely into CLAUDE.md's authorization-pattern warning ("any new mutation that creates a record must populate `coaches`... omitting this is the most common way to accidentally lock a co-coach out"). **Recommendation for v1: skip a persisted audit trail.** Log the correction as an analytics event (`trackEvent`, already used elsewhere in this file) only. Revisit a persisted audit trail as a follow-up once there's a decided owner for the schema/Lambda cost.
3. Threshold stays a named constant (not a magic number), conservative starting point unchanged from the first draft.

### Files
- `src/components/GameManagement/hooks/useGameTimer.ts` — gap detection integrated into the existing 500ms tick / auto-trigger decision point, not a separate effect
- New confirmation modal component under `src/components/GameManagement/`
- `src/components/GameManagement/GameManagement.tsx` — wiring
- `docs/specs/Game-Management-Spec.md` — **required update**, not optional: document that the modal explicitly does not apply when the gap crosses either auto-trigger boundary, preserving the existing "no confirmation" language for those cases
- `docs/specs/UI-SPEC.md` — required for the new modal (the plan's own text already said this needed a UI review pass; the file list didn't reflect it)
- Tests: gap-detection unit tests with mocked `Date.now()` covering both boundary-crossing cases (must confirm silent/unchanged) and the non-crossing case (must confirm modal fires), modal component test, integration test for the correction flow

### Edge cases
- Gap spans exactly one of the two boundaries — must fall through to the existing silent auto-trigger, not the modal.
- Coach dismisses the modal without choosing — default to "needs review," not either extreme.
- Threshold tuning stays a named constant per the original draft.

---

## Issue C — Consolidate the ref-guard race-patching pattern

### Root cause — corrected scope after architect review

The first draft claimed the guards lived in one file and could collapse into one predicate. Architect review found both claims wrong:

- **The refs span three files, not one:** `halftimeTriggeredRef`/`endGameTriggeredRef` are in `useGameTimer.ts:39-40`; `halftimeInProgressRef`/`endGameInProgressRef`/`halftimePtrClosePendingRef`/`startGameInProgressRef` are in `GameManagement.tsx:395-400`; only `manuallyPausedRef`/`isRunningRef`/`gameStateRef`/`lineupSyncInProgressRef` are in `useGameSubscriptions.ts`. A fix scoped to `useGameSubscriptions.ts` alone addresses at most half of what it claims to.
- **The `observeQuery` callback in `useGameSubscriptions.ts` is not reducible to one predicate.** It makes three decisions with different inputs: the state merge uses the functional updater's `prev` (`:169-200`), the timer-skip decision uses a pre-`setGameState` snapshot `localStatus` (`:137`, `:204-211`), and one line (`:223`) mutates `manuallyPausedRef` mid-callback with an explicit ordering dependency on the `isRunningRef` check that follows it. There is also a known behavioral asymmetry — `:143`'s `completed`-status branch does **not** preserve local score the way `:199`'s branch does — that a "collapse to one helper" refactor would likely tidy away as an inconsistency, when it needs to be pinned by characterization tests and preserved deliberately (or fixed as a conscious decision, not incidentally).

### Revised fix
1. **Correct the inventory first:** document all ~10 guard refs across the three files (not just the four in `useGameSubscriptions.ts`), what race each guards, and which past issue introduced it (#49, #31, #177).
2. **Characterization tests before any change**, covering every guarded transition including the `:143` vs `:199` score-preservation asymmetry — that asymmetry must be an explicit, tested decision in the refactored code, not lost.
3. **Do not collapse to a single predicate.** Given the three distinct decision inputs (functional-updater `prev`, pre-update `localStatus` snapshot, and the ordering-dependent ref mutation), extract into clearly named, separately-scoped helpers that preserve those distinct inputs rather than forcing them into one shared shape — a "collapse" is a behavior change dressed as a refactor.
4. Document the guard inventory in one place (`docs/ARCHITECTURE.md` or a comment block) so future contributors extend it deliberately instead of adding an eleventh ref.
5. **`CLAUDE.md` changes go through explicit human sign-off**, not folded into the implementation PR for this refactor.
6. Land this in isolation, not combined with Issue B's changes, so any regression in this load-bearing state machine is easy to bisect.

### Files
- `src/components/GameManagement/hooks/useGameSubscriptions.ts`, `useGameTimer.ts`, `GameManagement.tsx` — extraction, no intended behavior change (see caveat above on the score-asymmetry)
- `docs/ARCHITECTURE.md` — documentation
- Tests: characterization tests in `useGameSubscriptions.test.ts`, `useGameTimer.test.ts`, and `GameManagement.tsx`'s existing test coverage before the refactor; same suites re-run after to prove equivalence

---

## Issue D — No transactional guarantee across substitution writes (deferred)

### Root cause (verified)
`executeSubstitution` issues five sequentially awaited mutations with no compensation. The repo already has a working `TransactWriteItems` pattern (`accept-invitation` Lambda, IAM wired in `amplify/backend.ts:152`).

### Why this remains deferred
Confirmed sound by both architect reviews: a transactional path needs a new Lambda, a new offline-queue entry shape (the queue's per-model allowlists, already shown in Issue A's review to diverge between the two drain paths, cannot express one atomic custom mutation without a contract change), and independent Lambda-side authorization since it would bypass AppSync's per-model `ownersDefinedIn('coaches')` checks.

**New:** the repo already ships a partial precedent worth starting from — the `QueuedSubstitution` model (`amplify/data/resource.ts:708`) with client-generated deterministic ids. D's follow-up plan should build on that pattern rather than designing from scratch. Issue A's deterministic-id fix also shrinks D's eventual blast radius, strengthening the case for doing A first.

---

## New: Issue E — Divergent offline-queue drain paths (tracked, not in scope here)

Surfaced during Issue A's review, not part of the original four findings: there are two independent consumers of the offline mutation queue — `useOfflineMutations.drainQueue` and `useOfflineQueueDrain.ts`'s own `drainQueue` (mounted app-wide in `AppLayout.tsx`) — with different model/operation allowlists and only one holding an `isDrainingRef` lock. This is a real architectural risk for anything built on top of the queue (including Issue D's eventual design) but is out of scope for this plan. Recommend a short, focused follow-up: audit why two drain paths exist, whether they can be unified, and whether the missing lock on one of them is itself a latent bug (concurrent drains racing on the same IndexedDB store).

---

## Open questions for human sign-off

1. **Issue B's gap threshold and audit-trail decision** (recommend: no persisted audit trail in v1, per the revision above — confirm).
2. **Issue D** — confirm the team wants to invest in the transactional-Lambda path at all, versus accepting Issue A's targeted fix as sufficient.
3. **Issue E** — confirm this should be tracked as its own short follow-up rather than folded into Issue A or D.
4. **Sequencing** — confirm the revised A → B → C → D ordering.

---

## Revision history

- **v1** — initial plan, four issues, order A → C → B → D.
- **v2 (this version)** — after two independent `architect-reviewer` passes: dropped v1's Issue A design (would have introduced a critical regression blocking second-half start while offline; also reinvented an existing deterministic-id/idempotent-create mechanism) in favor of the deterministic-id fix; added the GSI query fix to Issue A's scope; corrected Issue B's design to not race the two existing silent auto-triggers (halftime, 7200s auto-end) and to make the audit-trail mechanism an explicit decision; corrected Issue C's scope from one file to three and dropped the "collapse to one predicate" approach in favor of preserving distinct decision inputs; re-sequenced to A → B → C → D; added Issue E (tracked, out of scope) for the divergent drain-path finding.
