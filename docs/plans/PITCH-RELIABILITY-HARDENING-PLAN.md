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
| F | Pre-release testing has no real-world/field-conditions coverage — Desktop Chrome only, offline/network testing is unit-mocked only | **P1 — release-readiness gate, parallel track** | Low for F1/F3/F6 (additive test infra); process cost for F2/F7 | F3/F6 land alongside A/B as their regression coverage; F1/F2/F7 independent; F4/F5 lower urgency |

**Revised order: A → B → C → D**, with **F run as a parallel track**, not a blocking predecessor — F3 and F6 specifically are the regression tests that prove A and B actually work, so they land alongside those issues rather than before or after them (changed from v1's A → C → B order — see "Sequencing" revision note below).

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

**Revised fix (v3 — corrected again after a second architect-review round found the v2 design still didn't close the gap):**

v2's "just add a deterministic id" was necessary but not sufficient. Architect review traced the actual mechanism and found it still doesn't work: `playTimeRecords` in `GameManagement.tsx` is subscription-only (no local setter exists anywhere in the file) — offline, a substitution's `createPlayTimeRecord` call only enqueues to IndexedDB (`useOfflineMutations.ts:487-501`); the record exists in neither React state nor DynamoDB yet. `closeActivePlayTimeRecords` only updates records it can *see* (`substitutionService.ts:72-98`), so at halftime it finds nothing to close for that player, **does not throw**, and therefore never sets `halftimePtrClosePendingRef` (`GameManagement.tsx:1622-1627`) — so the retry in `handleStartSecondHalf` (`:1666-1674`) never runs either. A deterministic id makes the record *addressable*, but nothing was actually going to compute that id and enqueue an update against it.

1. **Give the substitution-created `PlayTimeRecord` a deterministic id** at creation time (`buildDeterministicStartPlayTimeRecordId`-style, keyed on `gameId`/`playerId`/half/`startGameSeconds`), matching the pattern at the other two creation sites.
2. **Track currently-open records locally, independent of the subscription.** Maintain a lightweight local map (playerId → open record id + start time) built purely from local substitution/lineup actions as they happen client-side — not from `playTimeRecords` subscription state, which won't have offline-created records yet. At halftime/end-game, **unconditionally enqueue** `mutations.updatePlayTimeRecord(id, { endGameSeconds })` for every id in that local map, rather than depending on a DB read finding the record first. This sidesteps the read-visibility problem for the common single-device case instead of working around it after the fact.
3. **Keep the existing DB list-based two-phase scan in `closeActivePlayTimeRecords`, but as a cross-device backstop only** — it still matters for the case where a *different* coach's device opened the record (so it isn't in this device's local map), which the local-map mechanism can't cover. Switch its query from a `.list({filter})` Scan to the existing GSI (`amplify/data/resource.ts:322`, `listPlayTimeRecordsByGameId`) — the stale comment at `substitutionService.ts:32` claiming "without a GSI on gameId" is simply wrong, the GSI exists. This also shrinks the latency window that makes the underlying race more likely on a weak connection.
4. **Fix the silent error-swallow in the app-wide drain — this is now in Issue A's scope, not just tracked as Issue E.** `useOfflineQueueDrain.ts`'s `executeQueuedMutation` (`:34-46`) calls `await m.update(item.payload)` and never inspects `result.errors` — Amplify's data client returns GraphQL errors in the result rather than throwing, so a failed replay of exactly the PTR-close update this fix relies on would be silently treated as a success and dropped from the queue. Since this specific failure mode is now load-bearing for Issue A's correctness, fix the error check here as part of this issue (checking for a non-empty `result.errors` and treating it as a failure to retry). The broader dual-drain-path unification stays deferred under Issue E.
5. **Regression test the exact chain:** offline substitution → offline halftime → reconnect → assert the subbed-in player's `PlayTimeRecord.endGameSeconds` equals the halftime boundary, via the local-map path (not the DB-read backstop). Also: offline substitution → coach attempts to start the second half **while still offline** → must not hard-block. Also: the cross-device backstop case (record opened on a different, still-connected coach's device) still resolves via the GSI-backed scan.

### Files
- `src/services/substitutionService.ts` — deterministic id on the substitution-created `PlayTimeRecord`; GSI query swap; remove stale comment
- `src/components/GameManagement/GameManagement.tsx` — local open-record tracking map; unconditional enqueue of the halftime/end-game close against it; verify `handleStartSecondHalf`'s existing retry path still composes correctly as the cross-device backstop's retry path
- `src/hooks/useOfflineQueueDrain.ts` — check `result.errors` on `create`/`update`/`delete` instead of treating any non-throwing call as success
- Tests: `substitutionService.test.ts`, `useOfflineMutations.test.ts`, `useOfflineQueueDrain.test.ts`, `offlineQueueService.test.ts`, plus the offline-at-second-half-start case and the cross-device backstop case above

### Edge cases
- Multiple offline substitutions before an offline halftime — each needs its own deterministic id; verify no collision.
- Reconnect happens mid-drain and the app is closed again before the update settles — since this is now an ordinary queued mutation (not bespoke reconciliation state), it survives in IndexedDB like any other queued item, which is the point of this redesign.
- Coach never reconnects until well after the game — the queued update still targets the correct game-clock second (captured at halftime time, not "now"), since it was enqueued with that payload at the time.

---

## Issue B — Unstoppable clock drift during unrecorded stoppages

### Root cause (verified)
`lastStartTime` is a wall-clock anchor with no upper bound: if the coach doesn't tap pause before a crash, force-quit, or extreme backgrounding, elapsed wall-clock time keeps accruing with nothing to arrest it, and that number flows into `PlayTimeRecord.endGameSeconds`.

### Design — corrected after architect review

The first draft under-specified how the proposed confirmation modal interacts with **two existing silent auto-triggers**, and a second architect-review round found the v2 fix location was structurally wrong and the boundary logic broken for the second half. Both corrected below.

1. **Auto-halftime is explicitly documented as silent** (`docs/specs/Game-Management-Spec.md:89`) but **only fires when `currentHalf === 1`** (`useGameTimer.ts:103`) — there is no equivalent boundary in the second half below the 7200s auto-end.
2. **Auto-end-game at 7200s** (`useGameTimer.ts:109`) fires on the very first tick after a resume with a large-enough gap, before any modal could render.
3. **v2's fix location was wrong.** The resume gap is absorbed **before** `useGameTimer.ts` ever sees it: `useGameSubscriptions.ts:234-238` computes `additionalSeconds = now - lastStart` and folds it straight into `setCurrentTime(...)` on reconnect/subscription-update. `useGameTimer.ts`'s anchor effect then captures `startElapsedRef.current = currentTime` at that already-jumped value — by the first 500ms tick, the gap is indistinguishable from normal elapsed time. Detecting it inside `useGameTimer.ts`'s tick, as v2 proposed, is too late; the gap has already been silently absorbed one layer up.
4. **v2's boundary-exclusion wording ("suppress when elapsed crosses `halfLengthSeconds`") is wrong for the second half.** `elapsedSeconds`/`currentTime` is cumulative across the whole game (the second half continues from the halftime value, per `handleStartSecondHalf`), so it is *always* above `halfLengthSeconds` once the second half starts — a literal implementation of v2's rule would suppress the modal for the entire second half, which is exactly where an unrecorded stoppage does the most damage (no boundary below 7200s to catch it).

**Revised design:**
1. **Move gap detection to `useGameSubscriptions.ts`**, at the point the resume jump is computed (`:234-238`), not into `useGameTimer.ts`'s tick.
2. **Reframe the suppression rule around actual trigger conditions, not a static elapsed-time comparison:** suppress the modal only when, as a direct result of *this* resume, an auto-trigger will actually fire on the next tick — i.e. `gameState.currentHalf === 1 && newElapsed >= halfLengthSeconds` (auto-halftime will fire), or `newElapsed >= 7200` (auto-end will fire). Any other large gap — including the entire second half below 7200s — is eligible for the modal.
3. **This now shares a file with Issue C's refactor of the same callback.** B and C can no longer be strictly sequenced as fully independent, isolated landings as v2 assumed — either land C's characterization-test/refactor first with the gap-detection hook point designed in from the start, or explicitly fold B's new logic into the same characterization-test net C is already building, and state which order was chosen before implementation starts.
4. **Audit-trail mechanism must be decided before implementation, not left as "GameNote or a dedicated field."** `GameNote` creates now route through a `createSecureGameNote` custom mutation that strips `coaches`/`authorId` server-side and uses a closed `noteType` enum (needs a schema + Lambda change to add a type); a dedicated `Game` field is a schema change following the `coaches[]` authorization pattern, which brings this into CLAUDE.md's authorization-pattern warning. **Recommendation for v1: skip a persisted audit trail** — log the correction as an analytics event (`trackEvent`) only, and revisit once there's a decided owner for the schema/Lambda cost.
5. Threshold stays a named constant, conservative starting point unchanged from the first draft.

### Files
- `src/components/GameManagement/hooks/useGameSubscriptions.ts` — gap detection at the resume-jump computation site (`:234-238`); shared with Issue C's refactor of the same callback, sequence explicitly
- New confirmation modal component under `src/components/GameManagement/`
- `src/components/GameManagement/GameManagement.tsx` — wiring
- `docs/specs/Game-Management-Spec.md` — **required update**: the modal does not apply when the gap would trigger auto-halftime (half 1 only) or auto-end (either half); the existing "no confirmation" language for those specific cases is preserved, not the whole "crosses `halfLengthSeconds`" framing
- `docs/specs/UI-SPEC.md` — required for the new modal
- Tests: gap-detection unit tests with mocked `Date.now()` covering: half-1 gap crossing `halfLengthSeconds` (must stay silent), any-half gap crossing 7200s (must stay silent), a large half-2 gap that does **not** cross 7200s (must show the modal — this is the case v2's wording would have missed), modal component test, integration test for the correction flow

### Edge cases
- A gap in the second half large enough to feel "anomalous" but nowhere near 7200s is the primary case this issue exists for — confirm the test suite actually covers it, not just the two silent-boundary cases.
- Coach dismisses the modal without choosing — default to "needs review," not either extreme.
- `page.clock`-based E2E tests for this (see Issue F6) should install the fake clock narrowly around the timer/subscription window — faking `Date.now()` broadly can conflict with the AppSync WebSocket keepalive and Amplify token refresh.

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

## Issue F — Pre-release real-world/field-conditions testing

### Motivation (verified gap)
`playwright.config.ts` runs **Desktop Chrome only** across both the `smoke` and `full` projects — no WebKit/Safari engine, no mobile viewport, no device emulation. Every offline/network-condition test in the repo today is a **unit-level mock** of `navigator.onLine` (`useOfflineMutations.test.ts`, `useNetworkStatus.test.ts`); there is no E2E spec that drives the real UI through an actual offline/reconnect cycle, a backgrounding event, or two coaches touching the same game concurrently. This is exactly the gap two real production bugs (#31 iOS backgrounding, #35 offline mutation loss) already came from, and it's where Issues A and B's fixes above currently have no integration-level regression coverage — only the unit tests each issue's "Files" section lists.

### Sub-items
1. **F1 — WebKit + mobile-viewport Playwright project.** Cheap addition: `devices['iPhone 13']` (or similar) plus a WebKit-engine project. Catches non-iOS-lifecycle-specific mobile/Safari-engine issues in ordinary CI. Independent of A-E.
2. **F2 — Real-device pass for iOS PWA standalone-mode lifecycle.** Not CI-automatable with Playwright alone — desktop WebKit doesn't fully replicate real iOS backgrounding/memory-pressure behavior, which is exactly where #31 originated. A release-gate process step: install-to-homescreen → background via home button → wait 5+ minutes → reopen, on BrowserStack/Sauce Labs or physical devices. Independent of A-E; needs a vendor/budget decision (see Open questions).
3. **F3 — E2E specs that drive real offline/reconnect cycles** via `context.setOffline(true/false)`. Direct regression coverage for **Issue A**: offline substitution → offline halftime → reconnect → assert `PlayTimeRecord.endGameSeconds` lands on the halftime boundary through the real UI + real IndexedDB + real drain, not mocked pieces. Also the natural place to catch **Issue E**'s dual-drain-path divergence if it manifests as a real race. **Land alongside Issue A**, not before or after — it's A's regression test.
4. **F4 — Degraded-connectivity simulation** via `context.route()` with injected latency/jitter/random failure, rather than the binary online/offline F3 covers. A sideline is usually "one bar of LTE," not airplane mode — this exercises mutations that hang or time out mid-flight, which is closer to what produces the partial-write states **Issue D** is concerned with. Lower urgency than F3/F6; most useful once/if Issue D's follow-up plan proceeds.
5. **F5 — Multi-browser-context concurrency specs.** Two authenticated coach contexts against the same team/game, driving genuinely concurrent actions (one subs a player while the other logs a goal; one goes offline mid-action while the other stays online). Currently zero coverage of this — `data-isolation.spec.ts` tests *different*-team isolation, not same-team concurrent-edit races. Directly exercises the last-write-wins risk from the original architecture review and gives **Issue C**'s refactor a regression safety net for exactly the class of race it's consolidating guards against. Lower urgency than F3/F6; useful ahead of Issue C's refactor landing.
6. **F6 — Clock/lifecycle fault injection at the E2E level**, via Playwright's `page.clock` API plus dispatched `visibilitychange`/`pagehide` events, driving the real render tree (not a mocked hook). Direct regression coverage for **Issue B**: verifies the gap-detection modal doesn't race the two silent auto-triggers (halftime, 7200s auto-end) through the actual subscription + timer + modal stack. **Land alongside Issue B**, same reasoning as F3/A.
7. **F7 — Formal field-beta gate.** Process change, not a test suite: a small cohort of real coaches runs a release candidate for a few live games before general promotion, using the existing `send-bug-report` Lambda / `Issue` model as the structured feedback channel instead of ad hoc dogfooding. No amount of automated testing replaces this for conditions like sun glare, gloves, or genuinely rural coverage. Independent of A-E; needs a process owner (see Open questions).

### Sequencing within F
F3 and F6 are regression tests for Issues A and B respectively — they land with those issues, not as separate follow-on work. F1, F2, and F7 are independent infrastructure/process additions that can start anytime, including before A-E. F4 and F5 are lower urgency and best timed against Issue D and Issue C respectively.

### Files
- `playwright.config.ts` — **new, dedicated project with its own `testMatch`** for the field-conditions specs (not just relying on `full`'s `testIgnore` list) — `full` currently has no `testMatch`, only `testIgnore` (`:66-74`), so any new spec file silently auto-joins the per-commit `full` lane (45-minute `globalTimeout`, 2 retries) by default. Without an explicit `testMatch`-scoped project, F's stated goal — pre-release-only, not blocking every PR — silently fails to hold.
- `.github/workflows/ci.yml` — **required, previously missing from this list.** CI currently installs `npx playwright install --with-deps chromium` only (both CI jobs, `:294` and `:420`); WebKit (F1) will not run in CI until its browser binary is also installed. Add a separate CI step/job for the field-conditions project, gated to run pre-release rather than on every push.
- New specs: an offline/reconnect spec (F3), a concurrent-coaches spec (F5), a backgrounding/lifecycle spec (F6), a degraded-connectivity spec (F4)
- `package.json` — a new script (e.g. `test:e2e:field-conditions`)
- `e2e/README.md` and `README.md`'s E2E command list — both currently document the existing `smoke`/`full` split only; add the new lane
- A release-process doc or checklist recording F2 and F7 as gates (location TBD — see Open questions)

### Sequencing dependency
F3 must be written against Issue A's **revised** mechanism (the local open-record map, not a bare deterministic id) — Issue A's design needs to be settled and landed before F3 can meaningfully test it, not written speculatively against the id alone.

### F5 prerequisite (previously understated)
A second authenticated identity already exists (`.auth/user2.json`, `e2e/auth.setup.ts`), so two coach identities are available, but the spec still needs the two coaches to actually share the *same* team first — an invite-and-accept flow (see `team-sharing.spec.ts`) as a fixture or setup step before the concurrent actions, not just "open two contexts." Also note `workers: 1` / `fullyParallel: false` (`playwright.config.ts:16,19`) serialize test *files*, not what happens inside one test — both contexts still run concurrently within a single F5 test, which is what it needs.

### Additional real-world conditions this issue should cover (surfaced in review, not in the original draft)
- **iOS/WebKit IndexedDB eviction** — Safari can evict IndexedDB under storage pressure, which would silently empty the offline queue this entire plan's offline handling depends on. Worth at least one test asserting graceful behavior (not data corruption) if the queue is unexpectedly empty on reconnect.
- **Device clock skew / manual clock changes / DST transitions** against the wall-clock `lastStartTime` anchor — relevant both for a single device and, more subtly, between two co-coaches' devices with slightly different clocks.
- **iOS low-power mode** throttling JS timer frequency, which interacts with the 500ms tick this whole timer design is built on.
- **Service-worker update prompt** (`UpdatePrompt.tsx`) firing mid-game — what happens if a coach is offered an app update while a game is live.

### Edge cases
- F3/F6 specs are inherently more flake-prone (real timers, real IndexedDB, real network toggling) — budget for retries and treat occasional flakes as a signal to investigate, not silence, per the repo's existing stance against skipping/disabling tests to get green.
- F5's concurrency specs need deterministic ordering assertions (which action "wins") documented explicitly, since the current architecture is last-write-wins by design in places — the test should assert the *actual* documented behavior, not an idealized one, until/unless that behavior changes.

---

## Open questions for human sign-off

1. **Issue B's gap threshold and audit-trail decision** (recommend: no persisted audit trail in v1, per the revision above — confirm).
2. **Issue D** — confirm the team wants to invest in the transactional-Lambda path at all, versus accepting Issue A's targeted fix as sufficient.
3. **Issue E** — confirm this should be tracked as its own short follow-up rather than folded into Issue A or D.
4. **Sequencing** — confirm the revised A → B → C → D ordering, with F run as a parallel track.
5. **Issue F2/F7** — who owns the device-farm vendor/budget decision (BrowserStack vs. Sauce Labs vs. physical devices) and the field-beta process (where it lives, who recruits the coach cohort)? Both are process/budget calls, not engineering ones.
6. **Issue F** CI cost — should the new `field-conditions` suite block release, or start as informational-only given its higher flake surface?
7. **Issue B/C sequencing** — confirm whether Issue C's refactor lands first (with B's gap-detection hook point designed in) or B's logic is folded into C's characterization-test net, since both now touch the same `useGameSubscriptions.ts` callback.

---

## Revision history

- **v1** — initial plan, four issues, order A → C → B → D.
- **v2** — after the first `architect-reviewer` round: dropped v1's Issue A design (would have introduced a critical regression blocking second-half start while offline; also reinvented an existing deterministic-id/idempotent-create mechanism) in favor of a deterministic-id fix; added the GSI query fix to Issue A's scope; corrected Issue B's design to not race the two existing silent auto-triggers (halftime, 7200s auto-end) and to make the audit-trail mechanism an explicit decision; corrected Issue C's scope from one file to three and dropped the "collapse to one predicate" approach in favor of preserving distinct decision inputs; re-sequenced to A → B → C → D; added Issue E (tracked, out of scope) for the divergent drain-path finding.
- **v3** — folded in a pre-release field-conditions testing strategy as Issue F (real device/browser matrix, real offline/reconnect E2E specs, degraded-connectivity simulation, multi-coach concurrency specs, clock/lifecycle fault injection, formal field-beta gate), tied F3/F6 explicitly to Issues A/B as their regression coverage, and added two new open questions for vendor/process ownership. Sent out for a second `architect-reviewer` round (two independent passes) against the full v3 plan, explicitly instructed not to trust v1→v2's corrections at face value.
- **v4 (this version)** — one of the two v3 reviews (Haiku) had significant accuracy problems and was discounted: it treated the plan (pre-implementation) as though the code should already reflect it, and made two factually wrong claims (that `UI-SPEC.md` was missing from Issue B's file list, and that a `setOffline()` helper existed in `e2e/helpers.ts` — neither true, both checked directly against the file/repo). The other review (Opus) found substantive, verified problems: **v2's Issue A fix was still incomplete** — a deterministic id alone doesn't get computed/enqueued at halftime for a record that was never visible locally or in DynamoDB, so the close still wouldn't happen; fixed by adding a local open-record tracking map that enqueues the close unconditionally, with the DB-scan path demoted to a cross-device backstop, and by fixing a silent-error-swallow in `useOfflineQueueDrain.ts` that would have dropped a failed replay of exactly this update. **v2's Issue B fix was in the wrong file** — the resume gap is absorbed in `useGameSubscriptions.ts` before `useGameTimer.ts` ever sees it — and its boundary-suppression rule was wrong for the second half (elapsed time is always past `halfLengthSeconds` once half 2 starts, which would have silently suppressed the modal for the entire second half); both corrected, and B now shares a file with Issue C's refactor, requiring explicit sequencing. **Issue F gained a real CI-wiring fix** (new specs would otherwise silently join the per-commit `full` lane; CI never installs WebKit) plus F5's shared-team fixture prerequisite and four app-specific real-world conditions (IndexedDB eviction, clock skew/DST, iOS low-power timer throttling, mid-game service-worker updates) that weren't in the original draft.
