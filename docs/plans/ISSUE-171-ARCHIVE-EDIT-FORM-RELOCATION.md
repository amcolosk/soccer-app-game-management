# Issue #171 — Move "Archive" from the Teams main list into Edit Team

Status: Done. Architecture review approved (round 2, 3 rounds total including revision). UI review (plan) approved with 3 minor notes folded in (round 3). Implemented by coding-agent. Stage-5 parallel review: validation-reviewer approved (empirically verified the `editingTeamMerged` regression test by temporarily reverting the fix and confirming it fails); security-reviewer approved (2 non-blocking notes); ui-reviewer approved-with-notes (1 non-blocking cosmetic note; live mobile-viewport render not reachable in this sandbox — app requires real Cognito sign-in). One additional fix applied post-review, self-directed: security-reviewer's Minor 1 (stale-closure race in the `RESET` guard) was cheap to fix outright, so `handleArchiveTeam`'s guard was replaced with a new `RESET_IF_EDITING` reducer action that re-checks current state at dispatch time (same pattern as the existing `REFRESH_EDITING` action), rather than left as accepted residual risk. `npm run gate:commit` green (lint, typecheck, 2338 tests, build). Committed and opened as a PR against `main`.
Date: 2026-09-12
Tracks: [GitHub issue #171](https://github.com/amcolosk/soccer-app-game-management/issues/171) ("Archive should be an option under editing a team, not sitting out on the main screen."), labels `bug`, `severity:low`.

## Revision history

- **Round 1:** initial plan, authored from direct reading of `src/components/Management.tsx`, `src/components/managementReducers.ts`, `src/App.css`, `src/components/Management.teamLifecycle.test.tsx`, `e2e/team-management.spec.ts`, `e2e/team-archive-ownership.spec.ts`, `e2e/helpers.ts`, and `docs/specs/UI-SPEC.md` §7.9.
- **Round 2 (this revision) — architecture review found 2 Major and 8 Minor issues, all addressed below:**
  - **Major 1 (the plan's own gating design was broken):** Decision 3 previously gated/dispatched Archive off raw `teamForm.editing`, relying on the `REFRESH_EDITING` effect (Management.tsx:267-273) to keep it fresh. That effect reads from the raw `teams` array, not `teamsForDisplay` (the override-merged list `applyLifecycleOverride`/`teamLifecycleOverrides` write to — used precisely because `archiveTeam`/`restoreTeam`/`assignTeamOwner` write via the DynamoDB SDK with no AppSync subscription push, per Management.tsx:211-217). Gating on raw `teamForm.editing` would show/hide Archive based on stale ownership data — e.g. right after Assign Owner, `REFRESH_EDITING` would overwrite `teamForm.editing` with the still-stale raw `teams` row, so Archive would not appear even though `teamsForDisplay` (what the main card already correctly uses) says the current user now owns it. This directly broke the plan's own proposed rewrite of the "orphaned owner" test (file #5). **Fixed:** introduced `editingTeamMerged`, an override-merged lookup, used for both the gate and the `handleArchiveTeam` call. Decision 3 rewritten below; the incorrect "REFRESH_EDITING already handles this" claim is removed — `REFRESH_EDITING` is the mechanism that *caused* the bug, not one that prevents it.
  - **Major 2 (missing e2e files):** three more e2e spec files have hard (non-`.catch()`-swallowed) card-scoped Archive `.click()` calls that would fail with locator timeouts and were omitted from round 1's blast-radius list: `e2e/safe-deletes.spec.ts` (lines 79, 141), `e2e/team-sharing.spec.ts` (lines 595-596, plus its stale comment at 566-568, and line 1371), `e2e/data-isolation.spec.ts` (line 61). Added as files #10-12 below with the same per-line specificity as #8-9.
  - **Minor 3 (CSS reuse):** the plan previously reused `.team-lifecycle-actions` unmodified inside the edit form. Changed to a distinct new class (`.form-lifecycle-actions`) appended to the bottom of `App.css`, so a future card-only tweak to `.team-lifecycle-actions` can't unintentionally reshape the in-form row. The stale `App.css:7258` comment (which lists "Archive / Restore / Assign Owner / Delete Permanently" for a class that will now only ever show Assign Owner/Owner Unassigned on the active card) is also corrected.
  - **Minor 4 (RESET dispatch too broad):** `handleArchiveTeam`'s added `RESET` dispatch is now guarded — `if (teamForm.editing?.id === team.id) teamDispatch({ type: 'RESET' })` — so a future second call site for `handleArchiveTeam` can't close an unrelated open edit form.
  - **Minor 5 (e2e Cancel-click ambiguity + redundant confirm):** `helpers.ts`'s defensive Cancel click is now scoped to `.create-form` to avoid Playwright strict-mode ambiguity with the confirm-dialog's own Cancel button; noted that `handleConfirmDialog` (helpers.ts:594-622) already auto-confirms the Archive confirm dialog as a background poller in the specs that use it, so no redundant confirm-click is added anywhere in the e2e fixes.
  - **Minor 6 (lost polling property in team-archive-ownership.spec.ts:218/224):** these lines used card-scoped Archive-visibility as a poll waiting for an Assign-Owner write to propagate. Fixed to keep the existing card-scoped poll on `Owner Unassigned` disappearing as the wait mechanism, then open Edit and assert Archive only once that resolves.
  - **Minor 7 (bare button needs context):** the in-form Archive control now ships with one line of helper text (exact wording below, flagged for `ui-reviewer` to confirm/adjust), not a bare unlabeled button.
  - **Minor 8 (UI-SPEC §7.9 tab-list line is now stale):** `docs/specs/UI-SPEC.md:610`'s Teams bullet ("create/edit/delete teams") is updated alongside the new subsection to reflect archive living only in the edit form and permanent delete only from Archived Teams.
  - Everything else from round 1 was explicitly approved as-is: Risk 1's div-wrapping fix, Decision 4 (Assign Owner stays on the card), Decision 5's success-only `RESET` placement structure, Decision 6, and the new UI-SPEC subsection itself (content, not the one line-610 addition above).
- **Round 3 — architecture re-review approved (round 2's `editingTeamMerged` fix and expanded e2e file list both confirmed correct, no new risk introduced). UI review approved with 3 non-blocking Minor notes, folded in here:**
  - **Minor — Archive button visual weight:** the plan previously kept `.btn-secondary` for the in-form Archive button, identical to Cancel directly above it, separated only by a thin border — risking it reading as a third peer of Update/Cancel (exactly what the issue complains about). Fixed: Archive now uses a new muted `.btn-archive-in-form` style modeled on the existing `.btn-signout` precedent (`src/index.css:194-203` — transparent background, `--text-secondary` text, `--hover-background`/`--text-primary` on hover) instead of `.btn-secondary`. Decision 2 and file #1/#2 updated below.
  - **Minor — no programmatic hint association:** added `aria-describedby` linking the hint `<p>` to the Archive button, matching the existing `CreateEditNoteModal.tsx`/`PlayerNotesPanel.tsx` hint-text convention. Decision 7 and file #1 updated below.
  - **Informational — "one line of helper text" phrasing:** corrected; the proposed sentence will wrap to 2-3 lines at the 402px mobile viewport this issue was reported at (`.create-form` padding leaves ~354px content width). This is fine visually (plain wrapping `<p>`, no truncation) but the plan's own wording is corrected so implementation doesn't try to force single-line. Also adopted UI review's optional wording tweak ("moves this team out of Active Teams" instead of "removes," to avoid conflating with the separate Delete Permanently action on archived cards).

## Goal

On the Manage > Teams screen, the **active** team card currently shows an always-visible "Archive" button (owner-only) in a `team-lifecycle-actions` row directly on the main list card, alongside "Assign Owner" / "Owner Unassigned". Issue #171 asks that Archive not "sit out on the main screen" — it should live under editing a team instead.

**Definition of done:**
- Archive no longer renders on the un-expanded active team card.
- Archive renders only inside that team's own open "Edit Team" form, gated the same as today by `isTeamOwner(team, currentUserId)`.
- "Assign Owner" / "Owner Unassigned" stay exactly where they are today, on the main active-team card (issue does not mention them; no behavior change).
- Archiving from inside the edit form still shows the existing confirm dialog, still calls `archiveTeam` unchanged, and additionally closes the edit form on success (since the team leaves `activeTeams` and there is nothing left to edit).
- The **archived** teams list (Restore Team / Assign Owner / Delete Permanently) is untouched — out of scope per the issue.
- No data model, GraphQL, or Lambda changes. Purely a client-side relocation of an existing action.

## Current behavior (confirmed by reading the code)

`src/components/Management.tsx`:
- Active-team card loop (`activeTeams.map(...)`, starting line 1248): each card is an `item-card` (name/meta, expand-roster toggle, `✎` Edit button calling `handleEditTeam(team)` at lines 1274-1280), followed — **outside** the roster-expansion block — by an always-rendered `<div className="team-lifecycle-actions">` (lines 1593-1615) containing the owner-gated Archive button and the `!isTeamOwnershipAssigned(team)` Assign-Owner/Owner-Unassigned fragment, in the same `<div>`.
- The Edit Team form (lines 1058-1144, `{teamForm.editing && (...)}`) is a **separate top-level block rendered above `.items-list`**, not inside any `team-card-wrapper`. It renders Team Name / Max Players / Half Length / Sport / Game Format / Formation fields, then a `form-actions` div with Update/Cancel (lines 1132-1142). `<CalendarFeedSettings team={teamForm.editing} .../>` (lines 1146-1151) renders immediately after it, also gated on `teamForm.editing`.
- `handleEditTeam` (line 353) dispatches `{ type: 'EDIT_TEAM', team }`; `handleUpdateTeam` and `handleCancelTeamEdit` both end by dispatching `{ type: 'RESET' }` (`managementReducers.ts` line 205-206: `{ ...initialTeamForm, expandedTeamId: state.expandedTeamId }`, closing the form).
- `handleArchiveTeam` (lines 404-424) shows a `confirm()` dialog, calls `archiveTeam(team.id)`, applies a local lifecycle override so the card moves to Archived immediately (independent of the DynamoDB-SDK write's lack of an AppSync subscription push), tracks an analytics event, and — in `finally` — clears `pendingTeamActionId` and bumps `teamRefreshKey`. **It does not currently dispatch `RESET`.**
- A `useEffect` (lines 267-273) keeps `teamForm.editing` in sync with the live, **raw** `teams` array whenever it refetches, dispatching `REFRESH_EDITING`.
- **Two different "current team" sources exist, and they are not interchangeable:** `teams` (raw `useAmplifyQuery` result) vs. `teamsForDisplay` (lines 275-282: `teams` merged with `teamLifecycleOverrides`, defined right after the override-reconciler effect). `activeTeams`/`archivedTeams` (line 283-284) are filtered from `teamsForDisplay`, **not** `teams` — this is why the main card's own `isTeamOwner`/`isTeamOwnershipAssigned` checks already reflect an in-flight archive/restore/assign-owner immediately. `teamForm.editing`, by contrast, is only ever set from `EDIT_TEAM`/`REFRESH_EDITING`, both of which read from raw `teams` — it is never merged with overrides. This gap is exactly what Major 1 (round 2 architecture review) found and Decision 3 below fixes.
- `isTeamOwner`, `isTeamOwnershipAssigned` — `src/utils/teamUtils.ts`, pure functions over a `Team`; no changes needed.

## Decisions

1. **Placement:** Archive moves inside the `{teamForm.editing && (...)}` block (the `<div className="create-form">`), as a new child rendered immediately after the existing `form-actions` (Update/Cancel) div and before that `<div>`'s closing tag — i.e. still inside `.create-form`, still above the separate `<CalendarFeedSettings>` block. It is **not** merged into `form-actions` itself, so it stays visually distinct from the primary Update/Cancel pair per the issue's intent and UI-SPEC's existing pattern of separating primary form actions from lifecycle/secondary actions.
2. **Dedicated CSS, not reused as-is (revised in round 2 — was Minor 3; button style revised in round 3 — was UI-review Minor 1):** the archive control gets its own class, `.form-lifecycle-actions`, appended to the bottom of `App.css` rather than reusing `.team-lifecycle-actions` (flex column, `gap: 0.5rem`, `margin-top: 0.75rem`, `padding-top: 0.75rem`, `border-top: 1px solid var(--border-color)`, plus a helper-text line — see Decision 7 below) so a future card-only styling change to `.team-lifecycle-actions` can't unintentionally reshape the in-form row. The main-card `team-lifecycle-actions` divs (active and archived) keep their existing class, untouched. **The button itself uses a new `.btn-archive-in-form` class, not `.btn-secondary`** — modeled on the existing `.btn-signout` precedent (`src/index.css:194-203`: transparent background, `--text-secondary` text; `--hover-background`/`--text-primary` on hover) rather than the filled `.btn-secondary` style Cancel uses directly above it. UI review flagged that an identically-styled Archive button sitting right under Cancel, separated only by a thin divider, risks reading as a third primary form action — which cuts against the issue's own complaint about Archive looking too prominent/peer-level. A muted, de-emphasized treatment (still fully clickable, still gated by the existing confirm dialog) fixes this with no test-query impact (accessible name stays "Archive").
3. **Owner gating (revised in round 2 — was Major 1):** gating and the archive call must use the **override-merged** team, not raw `teamForm.editing`. `teamForm.editing` is refreshed only from the raw `teams` array (the `REFRESH_EDITING` effect, lines 267-273) — it never picks up an in-flight `archiveTeam`/`restoreTeam`/`assignTeamOwner` override the way `teamsForDisplay` (and therefore the main card) already does. Gating directly on `teamForm.editing` would show stale ownership state inside the very form the issue asks Archive to move into — e.g. immediately after Assign Owner, Archive would fail to appear even though the main card's own `isTeamOwnershipAssigned`/ownership check (built on `teamsForDisplay`) already shows the assignment took effect.

   **Fix:** derive a merged lookup near where `teamsForDisplay` is already computed (Management.tsx, right after line 282):
   ```tsx
   const editingTeamMerged = teamForm.editing
     ? (teamsForDisplay.find(t => t.id === teamForm.editing!.id) ?? teamForm.editing)
     : null;
   ```
   Gate and call using `editingTeamMerged`, not `teamForm.editing`:
   ```tsx
   {editingTeamMerged && isTeamOwner(editingTeamMerged, currentUserId) && (
     <div className="form-lifecycle-actions">
       ...
       onClick={() => handleArchiveTeam(editingTeamMerged)}
       disabled={pendingTeamActionId === editingTeamMerged.id}
       ...
     </div>
   )}
   ```
   This is a read-only derived value (cheap `.find()` over a small array, computed every render like other simple derived values already in this file) — no new state, no new effect. The `REFRESH_EDITING` effect and `teamForm.editing` itself are unchanged; they still drive the rest of the edit form's fields (name/max players/etc.), which have no override-merge concern since only `archiveTeam`/`restoreTeam`/`assignTeamOwner` populate `teamLifecycleOverrides`.
4. **Assign Owner / Owner Unassigned:** left exactly where it is today, on the main active-team card, in its own now-narrower `team-lifecycle-actions` div. Issue #171 only calls out Archive; there is no reversibility/blast-radius reason to also move ownership assignment, and moving it would force a coach to open Edit just to see "Owner Unassigned," which is a status indicator as much as an action — worth surfacing without opening a form.
5. **Post-archive UX:** `handleArchiveTeam` gets two added lines — a guarded `RESET` dispatch — called on the success path only (after `applyLifecycleOverride`/`trackEvent`, inside the `try`, not in `finally` and not in `catch`):
   ```tsx
   if (teamForm.editing?.id === team.id) {
     teamDispatch({ type: 'RESET' });
   }
   ```
   The `teamForm.editing?.id === team.id` guard (added in round 2 — was Minor 4) prevents a future second call site for `handleArchiveTeam` (there is only one today, but nothing enforces that) from closing an unrelated open edit form. This closes the edit form automatically once the team being edited is the one just archived, mirroring `handleUpdateTeam`'s existing success-only `RESET` pattern. On failure, the form stays open (unchanged from today's implicit behavior, now made explicit) so the coach sees the error and can retry or Cancel manually.
6. **Confirm dialog, `archiveTeam` service call, analytics event, `pendingTeamActionId`/`teamRefreshKey` bookkeeping:** unchanged. Only the button's location and the added guarded `RESET` dispatch change.
7. **In-form label/helper text (new in round 2 — was Minor 7; wording and a11y revised in round 3 — was UI-review Minor 2/Informational 3):** the relocated control is not a bare button. It ships with helper text above the button, inside `.form-lifecycle-actions` (wraps to 2-3 lines at mobile widths — not literally "one line," corrected from round 2's phrasing):
   > "Archiving moves this team out of Active Teams. It's reversible — restore it anytime from Archived Teams."

   ("moves ... out of" instead of round 2's "removes ... from", per UI review — this screen also has a separate, real **Delete Permanently** action on archived cards, and "removes" risked a skimming coach conflating the two.)

   The hint `<p>` gets an `id` (e.g. `archive-team-hint`) and the button gets `aria-describedby="archive-team-hint"`, matching the existing hint-text-next-to-control convention already used in `CreateEditNoteModal.tsx:133` and `PlayerNotesPanel.tsx:574,696` — UI review noted this app has that pattern and the new hint should follow it so a screen-reader user tabbing straight to the button still hears the reversibility context.

   The button itself keeps the label **"Archive"** (not renamed to "Archive Team" or similar) specifically to avoid churning every existing unit/e2e test's `getByRole('button', { name: 'Archive' })` query — `ui-reviewer` confirmed this in their pass (no override). If a future pass ever changes the button's accessible name, every test-file change in this plan that queries `{ name: 'Archive' }` must be updated to match in the same pass.

## File-by-file changes

### 1. `src/components/Management.tsx`
- **New derived value, right after `teamsForDisplay`/`activeTeams`/`archivedTeams` (lines 275-284):**
  ```tsx
  const editingTeamMerged = teamForm.editing
    ? (teamsForDisplay.find(t => t.id === teamForm.editing!.id) ?? teamForm.editing)
    : null;
  ```
  See Decision 3 — this is required so the in-form Archive gate reflects `teamLifecycleOverrides`, the same source of truth the main card already uses via `teamsForDisplay`.
- **Edit-form block (~lines 1132-1144):** after the existing `<div className="form-actions">...Update/Cancel...</div>`, add a new sibling:
  ```tsx
  {editingTeamMerged && isTeamOwner(editingTeamMerged, currentUserId) && (
    <div className="form-lifecycle-actions">
      <p className="form-lifecycle-actions__hint" id="archive-team-hint">
        Archiving moves this team out of Active Teams. It's reversible — restore it anytime from Archived Teams.
      </p>
      <button
        className="btn-archive-in-form"
        aria-describedby="archive-team-hint"
        disabled={pendingTeamActionId === editingTeamMerged.id}
        onClick={() => handleArchiveTeam(editingTeamMerged)}
      >
        Archive
      </button>
    </div>
  )}
  ```
  (This sits inside the existing `{teamForm.editing && (...)}` guard, so `editingTeamMerged` is guaranteed non-null whenever this JSX evaluates — the `editingTeamMerged &&` prefix is defense-in-depth/TS-narrowing convenience, not reachable-as-null in practice.)
- **`handleArchiveTeam` (lines 404-424):** add the guarded reset —
  ```tsx
  if (teamForm.editing?.id === team.id) {
    teamDispatch({ type: 'RESET' });
  }
  ```
  — immediately after the existing `trackEvent(...)` call inside the `try` block (before `finally`). See Decision 5 for why the guard is needed.
- **Active-team card's `team-lifecycle-actions` (lines 1593-1615):** remove the `isTeamOwner(...) && (<button ... onClick={() => handleArchiveTeam(team)}>Archive</button>)` fragment. Keep the `!isTeamOwnershipAssigned(team) && (<>...Owner Unassigned / Assign Owner...</>)` fragment, but wrap the **entire** `<div className="team-lifecycle-actions">` in `{!isTeamOwnershipAssigned(team) && (...)}` (rather than the conditional living inside an always-rendered div) — see Risk 1. This means the div (and its `border-top`) no longer renders at all for a normally-owned team.
- **Archived-team card's `team-lifecycle-actions` (lines 1630-1660):** no change (out of scope — Restore Team / Assign Owner / Delete Permanently stay as-is).
- No changes to `handleEditTeam`, `handleUpdateTeam`, `handleCancelTeamEdit`, `managementReducers.ts` (`RESET` already does what's needed), `teamLifecycleService.ts`, or any import.

### 2. `src/App.css`
- **New section appended at the bottom** (per CLAUDE.md's "append new sections at the bottom" convention): a `.form-lifecycle-actions` rule (see Decision 2 — deliberately not a reuse of `.team-lifecycle-actions`), visually matching the card version's spacing/divider:
  ```css
  /* Team lifecycle actions inside the Edit Team form (Archive only — see
     docs/plans/ISSUE-171-ARCHIVE-EDIT-FORM-RELOCATION.md). Intentionally a
     separate rule from .team-lifecycle-actions (main-card Assign
     Owner/Owner Unassigned row) so the two can be restyled independently. */
  .form-lifecycle-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color);
  }

  .form-lifecycle-actions__hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  /* Muted treatment so Archive doesn't read as a third peer of the
     Update/Cancel form-actions row above it (UI review, round 3) — modeled
     on .btn-signout rather than reusing .btn-secondary. */
  .btn-archive-in-form {
    align-self: flex-start;
    background-color: transparent;
    color: var(--text-secondary);
    padding: 0.5em 1em;
    border: 1px solid var(--border-color);
    border-radius: 4px;
  }

  .btn-archive-in-form:hover {
    background-color: var(--hover-background);
    color: var(--text-primary);
  }

  .btn-archive-in-form:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  ```
- **Existing `.team-lifecycle-actions` comment at line 7258** ("Team lifecycle actions (Archive / Restore / Assign Owner / Delete Permanently)") is now inaccurate for the active-card usage (Archive moves out; that div will only ever show Assign Owner/Owner Unassigned going forward) — update to: `/* Team lifecycle actions: active card = Assign Owner/Owner Unassigned only (Archive moved to the Edit Team form, see .form-lifecycle-actions below); archived card = Restore / Assign Owner / Delete Permanently (unchanged) */`.

### 3. `docs/specs/UI-SPEC.md`
- **§7.9 "Manage" section-list, line 610:** currently `1. **Teams** — create/edit/delete teams; set name, formation, field size, max players`. Update to: `1. **Teams** — create/edit/archive teams (permanent delete only from Archived Teams); set name, formation, field size, max players` — this line was already stale before this plan (it says "delete" when active teams have required archive-first for some time) and this change makes the archive/edit relationship worth stating explicitly.
- §7.9 currently documents "Calendar Feed Settings (Manage > Teams > edit a team)" as its own subsection (lines 626-632) but has no equivalent subsection for team lifecycle actions at all (confirmed via search — no existing "Archive"/"team-lifecycle-actions" content in this file outside that one CalendarFeedSettings bullet). Add a new subsection, **"Team Lifecycle Actions (Manage > Teams)"**, placed directly above or below the existing Calendar Feed Settings subsection, documenting:
  - Active team card: shows only "Assign Owner" / "Owner Unassigned" when the team's owner is not in `coaches` (`isTeamOwnershipAssigned`); no Archive control on the card itself.
  - Edit Team form (owner only): a bordered secondary row (`.form-lifecycle-actions`) below Update/Cancel with helper text and a single, muted "Archive" button (`.btn-archive-in-form`, styled like Sign Out rather than a primary/secondary form action), gated on `isTeamOwner` (evaluated against the override-merged team, not a stale snapshot — see Decision 3). Reversible; shows the existing "Archive Team" confirm dialog before calling `archiveTeam`.
  - Archiving from inside the edit form closes the form automatically (the team leaves Active Teams, so there's nothing left open to edit).
  - Archived team card: unchanged — Restore Team / Assign Owner / Delete Permanently, no Edit affordance at all (cross-reference the existing Calendar Feed Settings bullet, which already states this).
- This is a required doc update per the app-wide-docs rule (this change alters a documented interaction pattern on a screen UI-SPEC covers), not optional polish.

### 4. `README.md`
- No change. Confirmed by search: README has no mention of "archive" anywhere (Features or Data Model sections), so it does not describe team-lifecycle button placement and is not made stale by this relocation.

### 5. `src/components/Management.teamLifecycle.test.tsx`
Existing tests that assert on/click Archive **directly on the main card** (found via the issue's line hints and confirmed by reading the file) must be changed to open the Edit Team form first (via the `✎`/"Edit team" button) and then locate Archive scoped to the edit form panel, not the card (Archive is not inside `.team-card-wrapper` — it's in the separate top-level edit-form block). Specific changes:

- **Lines 44-73, "shows Archive for the owner and archives the team...":** rename to reflect the new location. Add an assertion up front that Archive is **not** present before opening Edit (`expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()` right after `findByText('Owned FC')`). Then click "Edit team", assert the "Edit Team" heading is present, find/click Archive from there. After the existing archive-confirmation/`archiveTeam`-called assertions, add: `await waitFor(() => expect(screen.queryByRole('heading', { name: /edit team/i })).not.toBeInTheDocument())` — proving the form auto-closes on successful archive. Keep the existing "moves to Archived Teams list" assertions unchanged.
- **Lines 75-90, "does not show Archive or Owner Unassigned for an active team owned by a different coach":** keep the existing main-card assertion (still true — Archive never appears on the card for anyone now), and additionally open the Edit Team form for this non-owner coach and assert Archive is still absent there (proves the owner gate, not just "not on the card because nothing is").
- **Lines 92-118, "shows Owner Unassigned + Assign Owner for an orphaned-owner active team, and assigning replaces it with Archive":** the `Assign Owner` interaction and `Owner Unassigned` disappearance assertions are unaffected (still on the main card, still driven by `teamsForDisplay`). Replace the final assertion (`expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()` at line 115, which currently expects Archive to appear on the main card post-assignment) with: click "Edit team", then assert Archive is now present inside the opened form. **This is the test that exercises Decision 3/Major-1's fix directly** — opening Edit immediately after `assignTeamOwner` resolves means `teamForm.editing` would be set from a fresh `EDIT_TEAM` dispatch reading current `teams`/`teamsForDisplay` state at click-time in this specific flow, so this particular test would likely pass even with the round-1 bug (raw `teamForm.editing`, not `editingTeamMerged`). To actually catch a regression of Major 1 (not just this happy-path ordering), add a second variant to this same test: after Assign Owner resolves, **without re-opening Edit**, if an edit form for this team were already open before the assignment (a coach editing name/fields while a co-coach concurrently assigns ownership), Archive must appear once `applyLifecycleOverride` fires — i.e. render with the edit form already open (`Edit team` clicked *before* `Assign Owner`), then click Assign Owner from the main card while the form stays open, then assert Archive appears inside the still-open form without any re-open. This is the scenario that only passes if the gate reads `teamsForDisplay`/`editingTeamMerged`, not raw `teamForm.editing`.
- **Line 318 (inside "surfaces the real server error message on archive failure..."):** change `await user.click(await screen.findByRole('button', { name: 'Archive' }));` to first open the Edit Team form (`await user.click(await screen.findByRole('button', { name: 'Edit team' }))`) and then click Archive from within it. After the existing `showError` assertion, add a check that the edit form is **still open** (`expect(screen.getByRole('heading', { name: /edit team/i })).toBeInTheDocument()`), demonstrating `RESET` is only dispatched on the success path (Decision 5).
- **Lines 120-155 ("gates Assign Owner..."), 157-168 (swipe-to-delete), 170-272 (archived-card tests), 274-304 (Delete Permanently), 327-345 (create-team ownerId), 347-417 (tab-switch dirty-check), 419-440 (Sharing tab team picker):** no changes — none of these interact with Archive on the active list in a way this relocation affects. (The tab-switch tests already open "Edit team" via `findByRole('button', { name: 'Edit team' })` at lines 356/381 for unrelated reasons — worth a quick re-run to confirm the newly-added Archive button inside that form doesn't change any of their existing queries; no query in those two tests is ambiguous with "Archive".)
- **New test (recommended, not strictly required by an existing assertion):** add one assertion using `within(...)` scoped to the edit-form container (e.g. `screen.getByRole('heading', { name: /edit team/i }).closest('.create-form')`) to prove Archive renders *inside* that specific container element, not merely "somewhere in the document" — guards against a future regression where Archive is reintroduced elsewhere.

### 6. `src/components/Management.integration.test.tsx`
- Confirmed via search: no references to "Archive" in this file today. No changes required. (Verify after implementation that nothing in this file incidentally broke — e.g., if it snapshots the active-team card's DOM structure — but no such usage was found.)

### 7. `e2e/helpers.ts`
- The shared `cleanupTestData` cleanup routine (lines ~313-324) currently sweeps leftover active teams by clicking `Archive` scoped to each `.team-card-wrapper`:
  ```ts
  await activeCards.first().getByRole('button', { name: 'Archive' }).click().catch(() => {});
  ```
  This will silently no-op forever post-relocation (Archive is no longer inside the card), since the `.catch()` swallows the "element not found" error and the loop's `newCount === activeCount` check then simply `break`s on the first iteration — leaving leftover teams undeleted across test runs. Must change to open the card's Edit form first, then click Archive at the page level:
  ```ts
  await activeCards.first().getByRole('button', { name: 'Edit team' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Archive' }).click().catch(() => {});
  ```
  Edge case: if the first active card has no owner (legacy ownerless team — no Archive button will render in its opened edit form), the edit form is left open with no Archive to click; add a defensive Cancel click after the Archive attempt so a stuck-open edit form doesn't interfere with the next loop iteration's card lookup, before the existing `newCount === activeCount` break check. **Scope this Cancel click to the edit form specifically** — `page.locator('.create-form').getByRole('button', { name: 'Cancel' })`, not a bare `page.getByRole('button', { name: 'Cancel' })` — to avoid Playwright strict-mode ambiguity with the `ConfirmModal`'s own Cancel button, which can also be present/pending in the DOM at points during this sweep.

  Note: this loop does not need (and must not add) an explicit confirm-modal click for the Archive action itself — `handleConfirmDialog` (helpers.ts:594-622) is already running as a background poller in every caller of `cleanupTestData` that needs it, auto-clicking `.confirm-btn--confirm` whenever a `ConfirmModal` appears; adding a second explicit confirm click here would race it.

### 8. `e2e/team-management.spec.ts`
- Lines 79 and 84 (archive cancel-then-confirm flow) and lines 146 and 170 (archive-then-verify-dropdown-exclusion, and cleanup): all four `.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' })` call sites must instead: click that same card's "Edit team" button, then click `page.getByRole('button', { name: 'Archive' })` (page-scoped, since the edit form is not inside the card wrapper).
- Line 125, `expect(activeCard.getByRole('button', { name: 'Archive' })).toBeVisible()` — this assertion (proving the owner sees Archive right after creating a team) must move: open Edit Team first, then assert `page.getByRole('button', { name: 'Archive' })` is visible; the `Owner Unassigned` non-visibility check on `activeCard` stays as-is (still card-scoped, unaffected).

### 9. `e2e/team-archive-ownership.spec.ts`
- Line 111, `expect(sharedCard.getByRole('button', { name: 'Archive' })).not.toBeVisible()` (Coach B, non-owner, checked on the main card): strengthen by also opening the Edit Team form as Coach B and asserting Archive is absent there too (proves the owner gate, not just relocation — mirrors the equivalent unit-test strengthening in file #5).
- Line 131 (Coach A archives before checking invitation expiry) and the `test.afterAll` stale-sweep loop (lines 270-281): each `...getByRole('button', { name: 'Archive' })` call scoped to a `.team-card-wrapper`/`activeStale` locator must instead open that card's Edit Team form first, then interact with `page.getByRole('button', { name: 'Archive' })` at the page level.
- **Lines 216-228 (revised in round 2 — was Minor 6):** this sequence uses card-scoped Archive visibility as a **propagation poll** waiting for the preceding `assignTeamOwner` write to land (not merely a one-off check), so simply relocating the check to "open Edit, then assert" loses the retry/wait semantics of `.toBeVisible({ timeout: ... })` on a locator that starts absent and becomes present. Keep the existing card-scoped poll on `Owner Unassigned` disappearing (line 223, `await expect(lockedCard.getByText('Owner Unassigned')).not.toBeVisible();` — still card-based, unaffected by this relocation) as the actual wait mechanism; only *after* that resolves, open Edit Team and assert Archive:
  ```ts
  await expect(lockedCard.getByText('Owner Unassigned')).toBeVisible({ timeout: 15000 });
  // (Archive is never on the card itself anymore; the pre-assignment "not visible"
  // check that used to live here is dropped as uninformative post-relocation —
  // see the equivalent note for line 106/111 above.)

  await lockedCard.getByRole('button', { name: 'Assign Owner' }).click();
  await clickConfirmModalConfirm(page); // 'Assign Team Owner' confirm
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  await expect(lockedCard.getByText('Owner Unassigned')).not.toBeVisible(); // poll/wait mechanism, unchanged

  // Now that ownership has actually propagated, open Edit and confirm Archive appears.
  await lockedCard.getByRole('button', { name: 'Edit team' }).click();
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible({ timeout: 10000 });
  ```
  Line 228 (`Coach B archives after reclaiming ownership`) then simply clicks the already-visible page-level Archive button from the still-open form (no need to reopen Edit) — `await page.getByRole('button', { name: 'Archive' }).click();` — followed by the existing `clickConfirmModalConfirm(page)`.
- Line 241 (cleanup archive, later in the same test): open that card's Edit Team form first, then click `page.getByRole('button', { name: 'Archive' })`.
- Lines 172-173 (Restore Team) and all "Delete Permanently"/"Owner Unassigned"/"Assign Owner" interactions throughout this file: **unchanged** — none of those live on the active-team card's Archive control and none are affected by this relocation.

### 10. `e2e/safe-deletes.spec.ts` (new in round 2 — was Major 2)
- **Line 79** (cleanup after the formation-linked-team safe-delete test) and **line 141** (cleanup after the roster-linked-player safe-delete test): both are `await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();` used purely as deterministic-cleanup steps (not assertions). Both must become: open that card's Edit Team button first, then `await page.getByRole('button', { name: 'Archive' }).click();`, before the existing `clickConfirmModalConfirm(page)` call.

### 11. `e2e/team-sharing.spec.ts` (new in round 2 — was Major 2)
- **Lines 566-568 (comment) + 595-596 (code)**, inside the stale-"Shared Eagles FC"-team sweep: the comment currently reads "The Archive button in Management.tsx is owner-gated (isTeamOwner), so this cleanup must run as User 1, not User 2, or the Archive click below would target a button that never renders and time out" — this reasoning is still correct (owner-gating is unchanged) but the comment describes a **card-level** button, which is no longer where Archive lives; update the comment to say the Archive button now only renders inside that team's Edit Team form. The code at lines 595-596 —
  ```ts
  await page.locator('.team-card-wrapper').filter({ hasText: /Shared Eagles FC/ }).first()
    .getByRole('button', { name: 'Archive' }).click();
  ```
  — must become: open that same first-matching card's Edit Team button, then `await page.getByRole('button', { name: 'Archive' }).click();`.
- **Line 1371** (end-of-test cleanup, "Delete the shared team"): `await page.locator('.team-card-wrapper').first().getByRole('button', { name: 'Archive' }).click();` — same fix: open `.team-card-wrapper`'s first card's Edit Team button first, then click Archive at the page level. The preceding `handleConfirmDialog(page)` call at line 1367 already covers the resulting confirm dialog — no change needed there.

### 12. `e2e/data-isolation.spec.ts` (new in round 2 — was Major 2)
- **Line 61** (deterministic cleanup under the creating owner, after a cross-account isolation check): `await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();` — same fix: open that card's Edit Team button first, then click `page.getByRole('button', { name: 'Archive' })`, before the existing `clickConfirmModalConfirm(page)`.

## Data / API impact

None. No Amplify schema change, no new/changed GraphQL operation, no Lambda change, no `coaches[]` population concern (`archiveTeam` in `src/services/teamLifecycleService.ts` is called unchanged, with the same `team.id` argument as today). This is a pure client-side JSX/CSS-class-reuse relocation plus one added reducer dispatch call in an existing handler.

## Risks and edge cases

1. **Empty `team-lifecycle-actions` div left on a normally-owned active card.** Once Archive is removed from the main-card block, a team that is owned (not orphaned) has nothing left to render in that div. Fixed by moving the `{!isTeamOwnershipAssigned(team) && (...)}` condition to wrap the entire `<div className="team-lifecycle-actions">` (not just its inner fragment) so the div — and its `border-top` divider — doesn't render at all when there's no Owner-Unassigned content to show. Called out explicitly in file #1 above; must not be missed, or every normally-owned active card will show a stray horizontal rule with nothing under it.
2. **`RESET` firing on archive success while the coach has unsaved edits to other fields (name/max players/etc.) in the same open form.** Today, `handleArchiveTeam` and the Update/Cancel handlers are mutually exclusive user actions from the same form — a coach who has typed a new name and then clicks Archive instead of Update is choosing to archive, not save; discarding the unsaved name edit on successful archive is the correct behavior (the team is leaving the active list regardless) and matches `handleUpdateTeam`'s own unconditional `RESET` on success. No confirm-modal wording change needed since the existing "Archive Team" confirm dialog already covers this action.
3. **Archive button disabled state (`pendingTeamActionId === editingTeamMerged.id`) during the async archive call, while `RESET` closes the form once the call resolves.** Since `RESET` is dispatched inside the same `try` block right after the awaited `archiveTeam` call resolves, and `pendingTeamActionId` is only cleared in the subsequent `finally`, the button unmounts (via form close) slightly before `pendingTeamActionId` is cleared — this is a non-issue (no re-render ever shows an enabled-but-stale button) but worth a one-line code comment at the added `RESET` call to preempt a future reviewer wondering about ordering.
4. **`teamForm.editing` staleness/ownership races**, e.g. another coach assigns/changes ownership while this coach's edit form is open: **this is exactly what round 2's Major 1 fix addresses** — `teamForm.editing` itself is not kept override-aware by `REFRESH_EDITING` (that effect only re-syncs against raw `teams`, which is what caused the bug in the first place; see "Current behavior" and Decision 3). The fix is `editingTeamMerged` (a `teamsForDisplay` lookup), used for both the gate and the archive call, not a change to `REFRESH_EDITING` itself. The new round-2 unit test (file #5, "orphaned owner" rewrite, second variant) exercises this race directly: assign ownership while the edit form is already open, with no re-open, and confirm Archive appears without needing to close/reopen Edit.
5. **e2e suite breadth.** The relocation breaks e2e locator patterns in **six** files (`helpers.ts`, `team-management.spec.ts`, `team-archive-ownership.spec.ts`, and — added in round 2 after a broader search — `safe-deletes.spec.ts`, `team-sharing.spec.ts`, `data-isolation.spec.ts`) beyond what a first-pass grep for "Archive" limited to the two-file hint set in the issue's investigation notes suggested, because Archive moves from inside `.team-card-wrapper` to a page-level block — every `<card-locator>.getByRole('button', { name: 'Archive' })` call must become "open Edit, then `page.getByRole(...)`", not just a locator rename. This is real, non-mechanical rework; it is not covered by `npm run gate:commit` (no e2e step) and cannot be verified by the automated pipeline gate — it should be fixed in the same PR (per files #7-12 above) and manually run (`npm run test:e2e:smoke` at minimum, ideally the affected specs from `test:e2e`) before merging, since a stale e2e suite here would silently stop covering the archive flow at all rather than fail loudly (the swallowed `.catch(() => {})` calls in the sweep loops mean a broken locator degrades to a silent no-op, not a visible failure). Given six files needed correction after one architecture-review pass already caught three that a first-pass search missed, **implementation should re-grep the whole `e2e/` directory for `team-card-wrapper.*Archive` and `Archive.*team-card-wrapper` (both operand orders) before considering the e2e fix-up complete**, rather than trusting this enumerated list alone to be exhaustive.
6. **Severity/scope check:** issue is labeled `severity:low` and explicitly scoped to "Archive... under editing a team" — confirmed the plan does not touch Restore Team, Delete Permanently, or Assign Owner/Owner Unassigned anywhere, per the issue's own wording and the investigation notes.

## Test strategy

- **Unit (Vitest):** all changes enumerated in file #5 above, run via `npx vitest run src/components/Management.teamLifecycle.test.tsx`. No changes expected/needed in `Management.integration.test.tsx` (confirmed no Archive references), but re-run `npm run test:run` afterward regardless, per `gate:commit`.
- **New coverage:** the "form auto-closes on successful archive" assertion (file #5, test 1), the "form stays open on archive failure" assertion (file #5, "surfaces the real server error message..." test), and the "Archive appears in an already-open edit form once an override lands, with no re-open" assertion (file #5, "orphaned owner" test's new second variant, proving Decision 3/Major-1's `editingTeamMerged` fix) are the three behaviors net-new to this change (Decisions 3 and 5) and did not exist before — all three must be asserted, not just the relocation itself.
- **E2E (Playwright):** update `e2e/helpers.ts`, `e2e/team-management.spec.ts`, `e2e/team-archive-ownership.spec.ts`, `e2e/safe-deletes.spec.ts`, `e2e/team-sharing.spec.ts`, `e2e/data-isolation.spec.ts` per files #7-12. These are not part of `gate:commit` and require a deployed sandbox to execute — run `npm run test:e2e:smoke` (covers `team-management.spec.ts`'s archive smoke test) and, if feasible against the sandbox, the full suite of touched specs before considering this issue closed, since these are the only automated proof the relocated Archive button still works end-to-end against a real backend.
- **Manual/mobile check:** issue was reported on mobile Safari/iPhone from the Teams screen — worth a manual check (or `ui-reviewer`'s rendered-browser pass) that the new Archive row inside the edit form doesn't get visually cramped or clipped at narrow mobile widths, and that the `border-top` divider reads clearly as "separate from Update/Cancel" rather than as part of the same action group.
- **Lint/build:** `npm run lint` and `npm run build` unaffected in kind (no new type surfaces), run as part of `npm run gate:commit` once at the end per CLAUDE.md.

## Sequencing

1. ~~Architecture review~~ — **done, approved round 2.** `editingTeamMerged` fix and expanded e2e file list confirmed correct and complete; Risk 1's div-wrapping fix confirmed still sound.
2. ~~UI review~~ — **done, approved-with-notes round 3.** Findings folded into this plan: muted `.btn-archive-in-form` styling (not `.btn-secondary`), `aria-describedby` hint association, corrected helper-text wording/phrasing. Button label "Archive" confirmed unchanged — no test-file churn from label changes.
3. Implementation: `Management.tsx` (including the new `editingTeamMerged` derived value and guarded `RESET`) + `App.css` (new `.form-lifecycle-actions`/`.btn-archive-in-form` section + corrected `.team-lifecycle-actions` comment) + `docs/specs/UI-SPEC.md` (new subsection + line-610 edit), in one pass; then test files (#5, #7-12) in the same PR.
4. Parallel validation + security review (small surface — no new authz path, but validation review should confirm the enumerated test changes are complete, the new `editingTeamMerged`-race unit test actually fails against the round-1 gating design and passes against round-2's, and the "empty lifecycle-actions div" risk is actually fixed, not just described).
5. `npm run gate:commit`, then manual/e2e smoke check per Test strategy, before commit.
