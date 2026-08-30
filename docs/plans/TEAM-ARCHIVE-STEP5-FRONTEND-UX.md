# Team Archive — Step 5: Frontend Service Layer + Testable Management UX

Status: UI review fix pass applied — architecture confirmed correct (twice), UI review findings resolved; ready for implementation, no further review rounds planned.
Date: 2026-08-19 (round 1 authored) — revised 2026-08-19 (round 2, architecture review) — mechanical fixes applied 2026-08-19 (post-round-2; locator/placement, lint, guard, typing, and mock-fixture corrections only, no design changes) — UI review fix pass applied 2026-08-19 (2 Major, 3 Minor UI findings resolved; no architecture changes)
Parent plan: [TEAM-ARCHIVE-PLAN.md](TEAM-ARCHIVE-PLAN.md) — "Next Steps (ordered)" items 5 and 6 (Phase 5, scoped down).
Prior slice: [TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md](TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md) — `archiveTeam`/`restoreTeam`/`assignTeamOwner` are declared, wired, and deployed to a sandbox (commit `8a4d867`).

## Revision history

- **Round 1** (2026-08-19): initial plan.
- **Round 2** (2026-08-19, this revision): architecture review found 3 Major and 9 Minor issues. All are addressed below. In summary: (1) added a client-side lifecycle-override mechanism so archive/restore/assign-owner reflect immediately and correctly in the UI, independent of the eventually-consistent re-list `teamRefreshKey` triggers; (2) fixed archived-card action gating (owner-only Restore, Assign-Owner affordance on archived cards, explicit ungated Delete Permanently) and documented a real lockout scenario it closes; (3) identified and scoped in three pre-existing tests/specs (plus a shared e2e cleanup helper) that this slice's swipe-delete removal breaks, with concrete fixes; folded in all nine Minor findings. This is the second and last revision round for this slice per the pipeline's loop cap — no further architecture review rounds are available after this one, so any residual concerns found during re-review must either be resolved in implementation directly or explicitly deferred as a Known Gap.
- **Mechanical fix pass** (2026-08-19, post-round-2): the design from round 2 was confirmed correct by architecture review; this pass only corrects five mechanical issues found in the round-2 text itself, with no design changes: (1) the new e2e locators for the Archive button (`e2e/team-management.spec.ts`, `e2e/data-isolation.spec.ts`, `e2e/helpers.ts`'s `cleanupTestData`) were scoped on `.item-card`, which resolves to zero elements given `.team-lifecycle-actions` is a sibling of `.item-card`, not nested inside it — rescoped to `.team-card-wrapper`; (2) the now-unused `swipeToDelete` import in the two e2e specs above is removed alongside the locator fix, to keep `gate:commit`'s zero-warnings e2e lint green; (3) `cleanupTestData`'s archived-team sweep is made to run unconditionally, independent of the pre-existing `teamCount > 0` active-team guard, so a prior interrupted run doesn't leave an archived team permanently uncleaned; (4) the `teamLifecycleService.ts` wrapper functions' return types are wrapped in `NonNullable<...>` to match their actual throw-on-null runtime behavior and satisfy `Management.tsx`'s non-null call sites; (5) the plan's example mock resolved values for `archiveTeam`/`restoreTeam`/`assignTeamOwner` are filled out to all four lifecycle fields (`status`, `ownerId`, `archivedAt`, `archivedBy`) plus `id`, instead of partial objects that would null out fields `applyLifecycleOverride` reads.
- **UI review fix pass** (2026-08-19, this revision): a UI review of the round-2 design (architecture already confirmed twice, not reopened here) found 2 Major and 3 Minor issues, all fixed below, with no change to the underlying override mechanism, gating logic, or scope: (1, Major) `.team-lifecycle-actions`' flat `gap: 0.5rem` (8px) let "Restore Team" and "Delete Permanently" sit only 8px apart on a 375px mobile viewport with no wrap fallback, risking an ordinary tap triggering irreversible deletion — the exact failure mode the parent plan's 12px/grouping requirement exists to prevent; fixed by raising the container's `gap` to `0.75rem` (12px) uniformly, so every adjacent action pair, including the one immediately before Delete Permanently, meets the parent spec's minimum. (2, Major) the planned tab-switch handler unconditionally dispatched `RESET` on any Active/Archived toggle click, silently discarding an in-progress create/edit form with no dirty check or confirmation — fixed by adding an `isTeamFormDirty` check and routing the switch through this codebase's existing `confirm({...})` discard pattern (`src/components/UserProfile.tsx`'s `handleDiscardChanges`), only resetting/switching immediately when the form is already clean. (3–5, Minor) added `align-items: center` to `.team-lifecycle-actions` (the plain-text "Owner Unassigned" span sat in the same flex row as taller buttons with no vertical alignment rule); added a subtle `border-top` to `.team-lifecycle-actions` so it visually reads as part of the card rather than a stray row of buttons, matching the "join with the card" intent already used for `.team-roster-section`; upgraded "Owner Unassigned" from plain `.item-meta` caption text to the existing `.archive-badge` amber-pill treatment, since it signals a real orphaned-owner lockout condition, not routine metadata.

## Goal

Reach a **testable vertical slice**: a coach can create a team, become its owner, archive it through the UI, see it move to an Archived Teams view, restore it, and confirm the "Schedule New Game" flow no longer offers an archived team — all through the running app, no raw GraphQL/console calls. This is frontend-only; the backend does not change in this slice.

**Definition of done:** `npm run gate:commit` passes; the manual verification checklist at the bottom of this doc passes against a real sandbox; the three pre-existing Playwright specs this slice touches (`e2e/team-management.spec.ts`, `e2e/data-isolation.spec.ts`) and the shared `cleanupTestData` helper (`e2e/helpers.ts`) continue to pass under `npm run test:e2e:smoke`/`npm run test:e2e` (these are not part of `gate:commit` itself, but are pre-existing green suites this slice must not silently break).

## Scope

### In scope
1. `isTeamArchived`/`isTeamActive` helper (parent Correction 2), plus ownership-assignment helpers needed by the UI gating logic (parent Correction 1 consequence + Step 1's orphaned-owner follow-up obligation).
2. Service layer: `archiveTeam`/`restoreTeam`/`assignTeamOwner` wrappers (parent Phase 3 step 5), typed against the mutations' own inferred return types rather than hand-typed to `Team` (round 2, Minor 4).
3. `ownerId`-at-create wiring in `Management.tsx: handleCreateTeam` and `demoDataService.ts` (parent Correction 1's consequence).
4. Blocking safety fix: remove `useSwipeDelete` from active team cards — **and** fix the pre-existing tests/specs this removal breaks: `Management.integration.test.tsx`'s team-delete test, `e2e/team-management.spec.ts`, `e2e/data-isolation.spec.ts`, and the shared `cleanupTestData` helper in `e2e/helpers.ts` (round 2, Major 3 — newly in scope; see File-by-File items 10–13).
5. Minimal Management UX: Active/Archived sub-toggle, Archive/Restore/Assign Owner/Delete Permanently actions, confirmation modals, failure states. Round 2 additions: a client-side lifecycle-override mechanism for correct immediate rendering (Major 1), corrected archived-card action gating with an Assign-Owner affordance that closes a real lockout path (Major 2), and resetting in-progress create/edit form state when leaving the Active sub-tab (Minor 5). UI review fix pass addition: that Minor-5 reset is now gated behind a dirty-check-and-confirm step (UI review Major 2) instead of firing unconditionally and silently.
6. `Home.tsx` filtering: exclude archived teams from the "Schedule New Game" dropdown and onboarding progress calculation, while preserving historical game display for already-archived teams. Round 2 addition: an explicit test for the onboarding-checklist regression-reopen consequence of archiving a coach's only active team (Minor 9).
7. Sharing tab's team picker (`activeSection === 'sharing'`) filtered to active teams only — **now in scope** (round 2, Minor 7; was deferred in round 1).
8. Unit/component tests for all of the above, plus test-infrastructure fixes: `AnalyticsEvents` mock whitelist additions (Minor 1) and an explicit decision on what the archive/restore tests assert against given the mock harness ignores `useAmplifyQuery` deps (Minor 2).

### Explicitly out of scope (see parent plan for what's deferred and why)
- `aria-live="polite"` toggle announcements; exact 44px/12px touch-target audits.
- Archived-team read-only banners and `aria-disabled` treatment on `GameManagement.tsx`, `PlanTab.tsx`, report/history views, and the Management roster-expansion view (parent Phase 4/5/6 remainder — depends on Phase 4 UI-only-enforcement work not yet started).
- Season Reports archived-team selector changes (parent Phase 6).
- Remaining server-side Phase 4 checks (`*Safe` delete archived-team guard, `accept-invitation` transactionalization) — **with one added constraint, round 2 Minor 8**: when Phase 4 later adds an archived-team check to `deleteTeamSafe`, it must not block deletes for archived teams — see Known Gaps.
- `Game.create` Lambda conversion (parent Phase 8).
- **New** E2E/Playwright coverage of the archive/restore/assign-owner flow itself (parent Phase 7 step 4) remains a fast-follow gap, not required here. This is distinct from round 2's in-scope item 4 above, which only *fixes regressions* this slice causes in specs that already exist and already pass today — it does not add new archive/restore-specific E2E coverage.
- `docs/SHARING-PERMISSIONS.md` updates (parent Phase 7 step 6) — deferred with the rest of Phase 7.

## Findings from reading the codebase

### Round 1 findings
- Backend confirmed wired: `amplify/data/resource.ts` has `ownerId: a.string().authorization(...to(['create','read']))`, `status`/`archivedAt`/`archivedBy` (`read`-only), and `archiveTeam`/`restoreTeam`/`assignTeamOwner` mutations all returning `a.ref('Team')`. Nothing under `amplify/**` needs to change for this slice.
- `Management.tsx` already has a `teamRefreshKey` state variable, bumped in a `finally` block after `deleteTeamCascade` (see `handleDeleteTeam`), which tears down and re-establishes `useAmplifyQuery('Team', undefined, [teamRefreshKey])`'s subscription. **Round 2 correction (Major 1): this alone is not sufficient for correctness** — see the new Decision below. It is retained as a reconciling background refetch, not as the primary correctness mechanism.
- **`Home.tsx` needs no equivalent refresh mechanism.** Archive/restore/assign-owner controls exist only in `Management.tsx` (per parent plan: "Archive and restore controls are available from Team Management only"). `Home.tsx` and `Management.tsx` are different `<Route>` elements under a plain `react-router-dom` `<Routes>` tree (`src/App.tsx`) with no keep-alive/persistence — navigating away from `Management` after archiving, then into `Home`, unmounts/remounts `Home`, which runs `useAmplifyQuery('Team')`'s effect fresh and gets a real, current `list` query. The manual verification checklist below relies on this (navigate Management → Home after archiving, not a same-mount live update). **Confirmed still correct in round 2 review — no change.**
- **`getTeam` in `Home.tsx` must keep searching the full `teams` array, not just active teams.** It resolves the team object for every game card across in-progress/scheduled/completed groups. If archived teams were filtered out of the array it searches, every existing game belonging to an archived team would silently disappear from `Home.tsx` (`if (!team) return null`), which directly violates parent Acceptance Criterion 5 ("Archived teams remain available for reports and read-only historical game access"). Only the **"Schedule New Game" team `<select>` options** and the **onboarding checklist completion inputs** get the active-only filter. **Confirmed still correct in round 2 review — no change.**
- **`QuickStartChecklist` recomputes its own step-completion booleans internally** from whatever `teams` array it's given as a prop (`step1Complete = teams.length >= 1`, `step4Complete` via `formationId`) — it does not receive `Home.tsx`'s separately-computed `checklistStepCompletion` array (that array is used only for the dismissed/regression-reopen localStorage comparison). Passing `activeTeams` instead of `teams` into the `<QuickStartChecklist teams={...} />` prop keeps both consistent with one change, no edits needed inside `QuickStartChecklist.tsx`.
- **Orphaned-owner follow-up obligation is due now.** `TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md`'s Decision 5 widened `assignTeamOwner`'s backend condition to also allow reclaiming a team whose `ownerId` is set but that id is no longer in `coaches` (can happen via `revokeCoachAccess`, which has no owner guard). That doc explicitly flags: *"Phase 5's 'Owner Unassigned' warning-pill UI condition (currently gated on bare `!team.ownerId`) ... needs to also trigger when `ownerId` is set but that id is no longer present in `coaches`, or the reclaim affordance this slice enables on the backend will never be reachable from the UI... before Next Step 5/6 starts."* This is Step 5/6. The UI gating helper must check ownership validity, not just presence. **Round 2 extends this: the same orphaned-owner reachability problem exists on archived cards too, and is a real lockout, not just a UI nicety — see Major 2 below.**
- **CSS scaffolding for archived cards already exists and is unused.** `.item-card.archived` (opacity 0.7, muted gradient) and `.archive-badge` (orange pill) are already defined in `src/App.css` (landed in commit `5fcaff3`, never wired to any component). Reuse them as-is; no new archived-card CSS needed.
- **All three confirm-modal variants (`default`/`warning`/`danger`) are already styled** in `App.css` (`.confirm-modal--warning`, `.confirm-btn--confirm.confirm-btn--warning`, etc.), and `ConfirmModal.tsx`'s Cancel button **already unconditionally carries `autoFocus`** regardless of variant — the "Cancel gets `autoFocus`" requirement for Archive/Restore confirms is satisfied by the existing component with no changes needed there.
- **`.empty-message`, not `.empty-state`, is this codebase's actual "centered italic muted" convention** already used for "No teams yet. Create your first team!" in this exact list. The parent plan's phrase "existing `.empty-state` convention" refers to this pattern colloquially; the class to reuse is `.empty-message`.
- **`useSwipeDelete` is a single shared hook instance** in `Management.tsx` (`const { getSwipeProps, getSwipeStyle, close: closeSwipe, swipedItemId } = useSwipeDelete();`), reused across the Teams, Formations, and Players sections via one shared `swipedItemId`. Removing swipe wiring from team cards only means: stop calling `getSwipeProps`/`getSwipeStyle` and stop rendering the `swipeable-item-container`/`delete-action` wrapper for team cards specifically. Formation and Player cards are untouched — do not modify their swipe wiring.
- **`.btn-secondary` and `.btn-danger` already exist** as full labeled-button styles (not just the small 36×36 icon `.btn-edit`/`.btn-delete`). Reuse `.btn-secondary` for Archive/Restore/Assign Owner and `.btn-danger` for Delete Permanently; only a small new flex-container rule is needed to lay them out under the card (see File-by-File below).

### Round 2 findings (architecture review response)
- **`archiveTeam`/`restoreTeam`/`assignTeamOwner` write via the DynamoDB SDK directly inside their Lambda handlers** (confirmed by reading `amplify/functions/assign-team-owner/handler.ts` and `amplify/functions/restore-team/handler.ts`) — no `onUpdateTeam` GraphQL subscription event is ever published for these writes. `teamRefreshKey`'s bump re-triggers `useAmplifyQuery('Team', ...)`'s `observeQuery` from scratch, whose *initial* resolution is an AppSync `list` (Scan), which is eventually consistent. There is a real window where that re-list can return stale data (the just-archived team still shows `status: 'active'`), and — critically — nothing self-corrects it afterward, because no subscription event for this write will ever arrive to trigger a further re-render. See Major 1 below for the fix.
- **`assignTeamOwner`'s Lambda handler has no archived-status check** (confirmed by reading the handler) — its DynamoDB conditional write only checks `attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)` plus `contains(coaches, :callerSub)`. It works identically whether the team is active or archived. Combined with `revokeCoachAccess` (`src/services/invitationService.ts`) having no owner guard, this produces a real lockout: team is archived by owner A while owner A is still a valid coach; later, a co-coach calls `revokeCoachAccess(teamId, A)` (allowed today, no guard); the team is now archived with an orphaned `ownerId` and, without an Assign-Owner affordance reachable from the Archived view, is **permanently unrestorable and undeletable-via-the-intended-path** by anyone (Restore requires a valid owner per `restore-team/handler.ts`'s explicit check; Delete Permanently is still reachable independently, so this isn't a total dead end, but the *restore* path is closed off with no recovery). See Major 2 below.
- **`restoreTeam`'s Lambda handler requires `team.ownerId` to already be set and equal to the caller** (`if (!team.ownerId) throw ...`; `if (team.ownerId !== callerSub) throw ...`) — confirmed by reading `amplify/functions/restore-team/handler.ts`. This confirms archived cards need both a Restore path (owner-only) and an independent Assign-Owner path (any coach, for orphaned/ownerless teams) — they are not interchangeable.
- **`deleteTeamSafe` is confirmed to allow any current coach**, not just the owner (existing behavior, already documented in the round-1 Decision on swipe-delete removal) — this justifies leaving `Delete Permanently` ungated on archived cards.
- **Three pre-existing, currently-passing tests/specs break** once swipe-to-delete is removed from team cards, because they drive team deletion through `swipeToDelete`/`swipedItemId`:
  - `src/components/Management.integration.test.tsx` (~lines 134–155), `it('respects delete cancel and confirm decisions for team records', ...)` — sets `swipedItemId: 'team-delete'` in `renderWithProviders` options and queries `screen.getByRole('button', { name: /delete team/i })`, which today resolves to the swipe `delete-action` button's `aria-label="Delete team"`.
  - `e2e/team-management.spec.ts` (~lines 40–48) — the test's only delete assertion is `await swipeToDelete(page, '.item-card:has-text(...)')` for both the cancel and confirm paths.
  - `e2e/data-isolation.spec.ts` (~line 61) — uses `swipeToDelete` in its "deterministic cleanup under the creating owner" step at the end of the test.
- **Additional blast radius found beyond the three tests named in review: `e2e/helpers.ts`'s `cleanupTestData` function** (used at the top of 6 other spec files: `formation-management.spec.ts`, `game-planner.spec.ts`, `full-workflow.spec.ts`, `team-sharing.spec.ts`, `player-management.spec.ts`, `team-management.spec.ts`) has its own team-cleanup loop (~lines 284–304) that also uses `swipeToDelete(page, '.item-card')` in a `while` loop to clear out all team cards before a test run. After this slice, that loop will find no swipeable delete action on any team card; its own `try { ... } catch { break; }` guard means it won't hang or throw — it will just silently exit having deleted zero teams, leaving test data to accumulate across runs in the shared e2e sandbox. This wasn't in the reviewer's named list of three, but is directly caused by the same removal and is cheap to fix in the same pass — folded into File-by-File item 13 below. Flagging explicitly per the instruction to surface findings rather than narrowly satisfy only the letter of the named list.
- **`src/test/mockAmplifyClient.ts`'s `AnalyticsEvents` mock (~lines 140–151) is a hand-maintained whitelist** that does not include `TEAM_ARCHIVED`/`TEAM_RESTORED`. `trackEvent(AnalyticsEvents.TEAM_ARCHIVED.category, ...)` would throw (`Cannot read properties of undefined`) inside the archive/restore handlers' own `try`/`catch`, which would silently swallow the error and make tests pass while exercising a code path that never actually reaches `trackEvent` successfully. Confirmed by reading the mock file directly.
- **`src/test/mockAmplifyClient.ts`'s `useAmplifyQuery` mock ignores its `deps` argument entirely** (`vi.fn((modelName) => ({ data: state.queryData[modelName] ?? [] }))`, ~lines 85–89) — confirmed by reading the file. This means no test can observe a `teamRefreshKey` bump through the mock harness at all; round 1's plan already flagged this as unresolved ("exact assertion left to the implementer"). Round 2 resolves it by making the *lifecycle-override state* (Major 1) the thing tests assert against, since that state is real component state driven by the mutation's own resolved value, not by the mocked query.
- **`Home.test.tsx`'s existing mock for `QuickStartChecklist` discards all props** (~lines 146–148: `QuickStartChecklist: () => <div data-testid="quick-start-checklist" />`). Round 1's planned assertion ("assert checklist step 1 reads as incomplete... via `QuickStartChecklist` prop capture") is not implementable against this stub as written.
- **Team-card lifecycle-action placement is structurally constrained**, confirmed by reading the current JSX (~`Management.tsx` lines 1035–1086): `.team-card-wrapper` wraps `.swipeable-item-container` (containing `.item-card`) followed immediately by the `{isExpanded && (<div className="team-roster-section">...)}` block, with no wrapper in between. `.team-roster-section` relies on being visually adjacent to `.item-card` (existing CSS join between them). Inserting a new block between them would break that join; inserting it inside `.item-card`'s own flex row would put `.team-lifecycle-actions`'s `margin-top: 0.75rem` inside a flex container where it has no effect. The correct placement is as the last child of `.team-card-wrapper`, after the `{isExpanded && (...)}` block closes.
- **Sharing tab's team picker (`activeSection === 'sharing'`, ~lines 1789–1826) iterates raw `teams`**, confirmed by reading the JSX — a one-line change to `activeTeams` closes a real hole this slice is the first to make reachable (archived teams didn't exist as a concept before this slice; now that they do, an unfiltered picker lets a coach invite someone to a team that has no path to ever un-expire that invitation, since Phase 4's accept-invitation archived-guard doesn't exist yet).
- **`Team` type re-exported from `src/types/schema.ts` is `Schema['Team']['type']`**, confirmed by reading the file — this is the same generated-client type that carries lazy relationship-loader fields (`roster`, `positions`, `games`, `invitations`, `formation`) for a model that actually has them (`Team` does, per `amplify/data/resource.ts`). A Lambda-returned plain object (from `archiveTeam`/`restoreTeam`/`assignTeamOwner`, which write via raw DynamoDB SDK calls, not `client.models.Team.update`) will not have working versions of those loaders at runtime, even though the TypeScript shape nominally matches. `cascadeDeleteService.ts` avoids this by typing its Lambda-call results as `data?: unknown`; `invitationService.ts:acceptTeamInvitation` avoids it by not hand-annotating a return type at all and letting `result.data`'s inferred type flow through. Neither hand-types to the full `Team`/`Schema['Team']['type']`.

## Decisions

### Decision: swipe-delete removal + where permanent delete moves (task item 4)

**Choice: (b) — permanent delete moves immediately, reachable only from the Archived Teams view.** Not the interim "explicit button on active cards" compromise.

Justification: this slice builds the full Archived Teams sub-toggle in the same change, so there is no window where an intermediate state (active-card delete button, no archived view yet) would need to exist. Building the interim form and then removing it one slice later would be strictly more work for no user-facing benefit, and the parent plan's Phase 5 spec already states permanent delete's final position explicitly ("actions limited to `Restore Team` and ... `Delete Permanently`" on archived cards) — implementing that directly avoids a throwaway step.

**Consequence, called out explicitly (not a blocking question, a documented behavior change):** today, swipe-to-delete lets *any* coach on a team delete it directly (the underlying `deleteTeamSafe` Lambda checks `coaches.includes(callerSub)`, any coach — not owner-only). After this slice, deleting a team requires: (1) if ownerless, any coach calls Assign Owner; (2) the owner archives it; (3) any coach deletes it permanently from the Archived view. This is a real increase in the number of steps for the "just delete this team" workflow, but it is exactly the safety property the parent plan's Major/blocking risk item asks for (an ordinary swipe must never trigger irreversible cascade deletion once an `Archive` action exists on the same card), and it matches Phase 5's design as written. Not treated as a regression to fix — it's the intended tradeoff, now made concrete.

**Round 2 addition — `Delete Permanently` stays ungated for any coach, stated explicitly** (this closes a round-2 review question rather than leaving it implicit): `Delete Permanently` on an archived card renders unconditionally for every coach on the team, with no `isTeamOwner` check, matching `deleteTeamSafe`'s existing "any coach may delete" authorization exactly. This is intentional and consistent — the archive/restore steps are owner-gated (reversible, ownership-sensitive actions), but final, irreversible deletion keeps the pre-existing any-coach permission model. Restricting it to owner-only would be a scope-creep tightening of authorization this slice was not asked to make, and would conflict with the backend, which still allows any coach to call `deleteTeamSafe`.

### Decision (round 2, Major 1): lifecycle-override state, not `teamRefreshKey` alone, is what makes the UI correct immediately

**Problem restated:** `archiveTeam`/`restoreTeam`/`assignTeamOwner` write via the DynamoDB SDK with no corresponding subscription event. Bumping `teamRefreshKey` re-issues an eventually-consistent `list` Scan; there's a real window where that Scan doesn't yet reflect the write, and — since no subscription event follows — nothing retries or self-corrects afterward. A coach could archive a team and, on a slow/contended read, see it snap back into Active Teams with no further signal that anything is wrong.

**Fix:** all three service wrappers already return the full updated `Team` record (the Lambdas `.returns(a.ref('Team'))`, and the handlers construct and return the post-write item). `Management.tsx` consumes that return value directly and applies it as a local override, layered over the `useAmplifyQuery('Team', ...)`-sourced list, before deriving `activeTeams`/`archivedTeams`/the rendered card list.

```ts
// Near the other useState calls in Management():
type TeamLifecycleFields = Pick<Team, 'status' | 'ownerId' | 'archivedAt' | 'archivedBy'>;
const [teamLifecycleOverrides, setTeamLifecycleOverrides] =
  useState<Record<string, TeamLifecycleFields>>({});

function applyLifecycleOverride(updated: { id: string } & Partial<TeamLifecycleFields>) {
  setTeamLifecycleOverrides(prev => ({
    ...prev,
    [updated.id]: {
      status: updated.status ?? null,
      ownerId: updated.ownerId ?? null,
      archivedAt: updated.archivedAt ?? null,
      archivedBy: updated.archivedBy ?? null,
    },
  }));
}

// Reconciler: once the raw `teams` list (from useAmplifyQuery, refreshed by the
// existing teamRefreshKey bump) agrees with an override, drop the override —
// raw `teams` resumes being authoritative for that id. Runs whenever `teams`
// changes, so it self-heals with no further user action once the eventually-
// consistent list catches up.
useEffect(() => {
  setTeamLifecycleOverrides(prev => {
    if (Object.keys(prev).length === 0) return prev;
    let changed = false;
    const next: typeof prev = {};
    for (const [id, override] of Object.entries(prev)) {
      const raw = teams.find(t => t.id === id);
      const converged =
        !!raw &&
        raw.status === override.status &&
        raw.ownerId === override.ownerId &&
        raw.archivedAt === override.archivedAt &&
        raw.archivedBy === override.archivedBy;
      if (converged) {
        changed = true;
      } else {
        next[id] = override;
      }
    }
    return changed ? next : prev;
  });
}, [teams]);

// Merged list used for all lifecycle-dependent rendering:
const teamsForDisplay = useMemo(
  () => teams.map(t => {
    const override = teamLifecycleOverrides[t.id];
    return override ? { ...t, ...override } : t;
  }),
  [teams, teamLifecycleOverrides]
);
const activeTeams = teamsForDisplay.filter(isTeamActive);
const archivedTeams = teamsForDisplay.filter(isTeamArchived);
```

Each of `handleArchiveTeam`/`handleRestoreTeam`/`handleAssignTeamOwner` calls `applyLifecycleOverride(updated)` immediately after its `await archiveTeam(team.id)`/etc. resolves successfully (before the `finally` block), so the override is set in the same render pass that shows the success state — no wait for any refetch.

**Authoritative-source statement (required explicitly per review):**
- For the four lifecycle fields (`status`, `ownerId`, `archivedAt`, `archivedBy`): `teamLifecycleOverrides[team.id]`, when present, is authoritative and wins over the raw `teams` value from `useAmplifyQuery`. It is cleared automatically once raw `teams` converges to match it (via the reconciler effect above), at which point raw `teams` resumes being authoritative for those fields too.
- For every other field (`name`, `coaches`, `formationId`, roster counts derived from `TeamRoster`, etc.) and for **which team ids exist at all**, raw `teams` (from `useAmplifyQuery`) is authoritative at all times — the override never adds or removes an id from the list, it only overlays four fields on an id that's already present.
- `teamLifecycleOverrides` is intentionally local, non-persisted `Management`-component state — it does not survive an unmount/remount (consistent with `Home.tsx` relying on route remount for its own correctness, approved as-is).

**`teamRefreshKey` is kept, layered underneath this** (explicitly approved by the reviewer as a reconciling background refetch) — `handleArchiveTeam`/`handleRestoreTeam`/`handleAssignTeamOwner` still bump it in their `finally` blocks, same as `handleDeleteTeam` already does. Its job changes from "the correctness mechanism" to "a background self-heal that eventually replaces the override with confirmed server state, and is the only mechanism at all for any field the override doesn't cover."

**Test-assertion consequence (feeds Minor 2):** tests should assert against the *rendered effect* of `teamLifecycleOverrides`, not against `teamRefreshKey` being bumped (which the mock harness can't observe — `useAmplifyQuery`'s mock ignores `deps` entirely). Concretely: after confirming an Archive action in a test, assert that the team's card is no longer present under `teamsView === 'active'` and/or that it appears under `teamsView === 'archived'` with the "Archived" badge — both are driven purely by `teamLifecycleOverrides`, independent of whatever the static mock `teams` fixture says. This is a stronger, more meaningful assertion than round 1's punted "assert via a second `useAmplifyQuery` call," and is now fully specified rather than left to the implementer.

**Informational (round 2, "your call" item): whether to also drop the `teamRefreshKey` bump for archive/restore/assign-owner, since it also unnecessarily re-lists the whole `TeamRoster` table** (they share one key). Decision: **keep it as-is, do not split into a separate key.** Reasoning: `teamLifecycleOverrides` already resolves correctness end-to-end for these three mutations, so the `teamRefreshKey` bump is now purely a redundant background reconciler for them (not required for correctness) — but splitting `teamRefreshKey` into a Team-only key and a shared Team+TeamRoster key would add a second piece of state and a second effect dependency array to reason about, for the sole benefit of avoiding one extra lightweight `TeamRoster` list call per lifecycle action. That's not worth the added surface area or the risk of introducing a bug this late in the slice by touching a mechanism `handleDeleteTeam` already depends on correctly today. Kept as an accepted, minor inefficiency.

### Decision (round 2, Major 2): archived-card action gating, and the lockout it closes

Round 1's plan rendered `Restore Team` unconditionally on every archived card. That's wrong on two counts: it contradicts the plan's own stated rule ("hidden, not disabled, for non-owners") elsewhere in the same document, and it guarantees a caught, user-facing "Access denied: only the team owner can restore this team" error for any non-owner coach who clicks it, since `restore-team/handler.ts` is strictly owner-only.

**Fix, and the real scenario it's needed for (not a hypothetical):**
1. Team is active, owner A archives it (A is currently a valid coach and owner).
2. A co-coach B later calls `revokeCoachAccess(teamId, A)` — allowed today, `revokeCoachAccess` has no owner guard (this is an accepted, already-documented tradeoff from `TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md` Decision 5).
3. The team is now archived, with `ownerId` still set to A, but A is no longer in `coaches` — an orphaned owner. `isTeamOwnershipAssigned(team)` correctly returns `false` for this (already matches the deployed backend condition, confirmed correct and unchanged from round 1).
4. Without an Assign-Owner affordance reachable from the Archived view, this team is now **permanently unrestorable by anyone** — `restoreTeam` requires `team.ownerId === callerSub`, and no remaining coach is that id, and there is no UI path to fix `ownerId` on an archived card.
5. `assignTeamOwner`'s handler has no archived-status check (confirmed by reading it), so it works fine on an archived team today on the backend — the only missing piece is the UI affordance.

**Archived-card action row, corrected:**
```tsx
<div className="team-lifecycle-actions">
  {isTeamOwner(team, currentUserId) && (
    <button
      className="btn-secondary"
      disabled={pendingTeamActionId === team.id}
      onClick={() => handleRestoreTeam(team)}
    >
      Restore Team
    </button>
  )}
  {!isTeamOwnershipAssigned(team) && (
    <>
      <span className="archive-badge">Owner Unassigned</span>
      <button
        className="btn-secondary"
        disabled={pendingTeamActionId === team.id}
        onClick={() => handleAssignTeamOwner(team)}
      >
        Assign Owner
      </button>
    </>
  )}
  <button
    className="btn-danger"
    disabled={pendingTeamActionId === team.id}
    onClick={() => handleDeleteTeam(team.id)}
    aria-label="Delete team permanently"
  >
    Delete Permanently
  </button>
</div>
```
- `Restore Team` — gated on `isTeamOwner(team, currentUserId)`, same helper already used on active cards. Hidden (not disabled) for non-owners and for orphaned-owner teams (where the current user, even if a coach, is not the *valid* owner).
- `Owner Unassigned` + `Assign Owner` — gated on `!isTeamOwnershipAssigned(team)`, which is `true` for both never-owned legacy teams and orphaned-owner teams (the exact condition needed to close the lockout above). Any coach on the team sees this and can claim ownership, after which `Restore Team` becomes available to them on their next render (via the same `teamLifecycleOverrides` mechanism from Major 1). **(UI review fix pass, badge upgrade — distinct from round 2's "Minor 5," which was the form-reset item superseded by Major 2 below):** `Owner Unassigned` uses the `archive-badge` class (existing amber pill, already reused for the `Archived` badge on archived cards) rather than plain `.item-meta` caption text — this condition gates a real orphaned-owner lockout the plan documents above as significant, so it is visually signaled with the same weight as the `Archived` state, not under-signaled as routine metadata next to a same-weight button.
- `Delete Permanently` — **ungated**, renders for every coach unconditionally (see the Decision above). Carries `aria-label="Delete team permanently"` (round 2, Major 3 requirement) as a stable target distinct from the removed swipe button's `aria-label="Delete team"` (no collision with Formation's `"Delete formation"` or Player's `"Delete player"` swipe labels, confirmed by reading the surrounding JSX).

A team can show both `Restore Team` and the `Owner Unassigned`/`Assign Owner` pair simultaneously only if the current user is both the valid owner AND ownership is somehow unassigned — which is contradictory by `isTeamOwner`'s own definition (it requires `isTeamOwnershipAssigned` to be `true`), so in practice exactly one of the two blocks renders per user, never both, never neither (aside from the brief instant after either mutation resolves, at which point `teamLifecycleOverrides` immediately reflects the new state).

### Decision: archived-team roster expansion is not built in this slice

Parent Phase 5 step 1 lists archived-card actions as "limited to `Restore Team` and ... `Delete Permanently`" (no Expand Roster). A later bullet in the same step separately describes a read-only-banner + `aria-disabled` treatment *if* roster expansion exists on an archived card — but that treatment is explicitly trimmed for this slice per the task brief (bundled with the "aria-disabled on deep in-game controls" and "read-only banners" trims). Resolving this by **not adding an Expand Roster affordance to archived cards at all** removes the need for the trimmed read-only-banner machinery entirely, rather than half-building it. Editing an archived team's roster remains technically possible only if a coach edits an *active* team and it gets archived mid-session, which is an existing, documented, accepted UI-only-enforcement gap (parent Phase 4) — not introduced by this decision. **Confirmed unchanged in round 2 — approved as-is by the reviewer.**

### Decision: archivedBy display uses a simple label, not full coach-name resolution

Parent Phase 5 lists `archivedBy` (resolved coach name) as a "required, standard element." Full name resolution goes through `getTeamCoachProfiles` / `coachDisplayNameService.ts`'s `resolveAttributionLabel`, which needs a per-team coach-profile map fetched and built elsewhere — meaningful additional machinery for a single card label. This slice shows `archivedBy === currentUserId ? 'You' : 'another coach'` instead of a resolved display name, and states this explicitly as a scoped-down simplification (not a silent omission) so it isn't mistaken for the full spec. Fast-follow: swap in `resolveAttributionLabel` once a coach-profile map is available in `Management.tsx` (it isn't today). **Confirmed unchanged in round 2 — approved as-is by the reviewer.**

### Decision: error surfacing reuses the `handleDeleteFormation` pattern, not `handleApiError`

`handleApiError(error, userMessage)` always shows a fixed, generic `userMessage` and logs the real error to the console — appropriate when the backend error isn't user-actionable. Archive/restore/assign-owner throw specific, user-actionable messages ("Team has no assigned owner...", "Access denied: only the team owner can archive this team", "Team already has an owner"). `Management.tsx`'s existing `handleDeleteFormation` already has a precedent for this exact situation:
```ts
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to delete formation';
  showError(message);
}
```
Reuse this shape for archive/restore/assign-owner so the coach sees the real reason, not a generic failure toast. **Confirmed unchanged in round 2 — approved as-is by the reviewer.**

### Decision (round 2, Minor 4): service-layer return types reference the mutations' own inferred types, not hand-typed `Team`

`Schema['Team']['type']` carries lazy relationship-loader fields (`roster`, `positions`, `games`, `invitations`, `formation`) that a Lambda-returned plain object (written via raw DynamoDB SDK calls, not `client.models.Team.update`) will not actually have working versions of at runtime, even though the shape nominally type-checks. Matching this repo's existing precedent (`cascadeDeleteService.ts` types Lambda-call results as `data?: unknown`; `invitationService.ts:acceptTeamInvitation` lets `result.data`'s type flow through without a hand-typed annotation), the service wrappers are typed against `Schema['archiveTeam']['returnType']` / `Schema['restoreTeam']['returnType']` / `Schema['assignTeamOwner']['returnType']` instead of `Team`. **Mechanical fix:** that generated return type is itself nullable, but the wrapper functions already throw via `assertLifecycleResult` whenever `result.data` is falsy — so each wrapper's declared return type is `Promise<NonNullable<Schema['archiveTeam']['returnType']>>` (etc.), matching actual runtime behavior and satisfying `Management.tsx`'s call sites, which feed the result directly into `applyLifecycleOverride(updated)` (a non-null-typed parameter). See File-by-File item 2. (This is distinct from `Management.tsx`'s `teamLifecycleOverrides` state, which stays typed as `Pick<Team, 'status' | 'ownerId' | 'archivedAt' | 'archivedBy'>` — that Pick only touches scalar fields, never the lazy-loader fields, so it's safe regardless.)

### Decision (round 2, Minor 7): Sharing tab's team picker is filtered to active teams, in scope for this slice

Round 1 deferred this as a residual gap. Round 2 treats it as in scope: this slice is what introduces the concept of an archived team at all, so it is the first change that makes "send a new invitation to an archived team" reachable — it is not a pre-existing gap being newly documented, it is a new hole this slice would otherwise open. The fix is a one-line change (`teams.map(...)` → `activeTeams.map(...)` at the Sharing tab's team-picker list, since `activeTeams` already exists in the component from Major 1's derivation). See File-by-File item 3.

### Decision (round 2, Minor 9): archiving a coach's only active team reopening the onboarding checklist is an accepted, tested consequence, not a bug to fix

`Home.tsx`'s `checklistStepCompletion` memo (already filtered to `activeTeams` per this slice's design) will flip steps 1 ("has a team"), 3 ("has a roster"), and 4 ("has a formation assigned") from complete back to incomplete if a coach archives their only active team. The existing regression-reopen effect (`Home.tsx` ~lines 168–193) compares the last-dismissed snapshot against current `checklistStepCompletion` and calls `clearDismissed()` whenever any step regresses from complete to incomplete — so archiving a coach's only team will reopen a previously-dismissed onboarding checklist. This is accepted as correct, intended behavior (a coach with zero active teams genuinely hasn't completed onboarding in any actionable sense — their one team is now archived and unavailable for scheduling), not treated as a defect. It is called out explicitly here, and a test is added (File-by-File item 9) so this is asserted and understood rather than discovered later as an unexplained QA finding.

## File-by-File Changes

### 1. `src/utils/teamUtils.ts` (new)

Unchanged from round 1 — no findings affected this file.

```ts
import type { Team } from '../types/schema';

/**
 * Legacy teams predating the archive feature have no `status` attribute at all
 * — Amplify's `.default('active')` only applies to newly created records, and
 * nothing backfills existing rows. Every consumer must treat status == null as
 * active. See docs/plans/TEAM-ARCHIVE-PLAN.md, Correction 2.
 */
export function isTeamArchived(team: Pick<Team, 'status'>): boolean {
  return team.status === 'archived';
}

export function isTeamActive(team: Pick<Team, 'status'>): boolean {
  return !isTeamArchived(team);
}

/**
 * True only when `ownerId` is set AND that id is still present in `coaches`.
 * An owner can become orphaned — removed from `coaches` via
 * `revokeCoachAccess` (which has no owner guard) without `ownerId` ever being
 * cleared (it has no update grant). `assignTeamOwner`'s backend condition
 * already treats an orphaned owner as reclaimable by any current coach
 * (TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md, Decision 5) — this helper must match
 * that condition so the "Owner Unassigned" / "Assign Owner" UI stays reachable
 * for orphaned teams, not just never-owned ones. Confirmed (round 2 review)
 * to exactly match the deployed backend condition on both archiveTeam and
 * assignTeamOwner.
 */
export function isTeamOwnershipAssigned(team: Pick<Team, 'ownerId' | 'coaches'>): boolean {
  return !!team.ownerId && !!team.coaches?.includes(team.ownerId);
}

/** True only for the current user, and only when they are the *valid* owner (see isTeamOwnershipAssigned). */
export function isTeamOwner(
  team: Pick<Team, 'ownerId' | 'coaches'>,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return isTeamOwnershipAssigned(team) && team.ownerId === userId;
}

/** Formats an ISO datetime for the archived-team card, e.g. "Aug 19, 2026". Returns null for missing/invalid input. */
export function formatArchivedOn(archivedAt: string | null | undefined): string | null {
  if (!archivedAt) return null;
  const date = new Date(archivedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
```

**Tests: `src/utils/teamUtils.test.ts` (new)** — `isTeamArchived`/`isTeamActive` for `status: undefined`, `null`, `'active'`, `'archived'`; `isTeamOwnershipAssigned` for no `ownerId`, `ownerId` set + in `coaches`, `ownerId` set + not in `coaches` (orphaned), `coaches` undefined; `isTeamOwner` for owner match, non-owner, orphaned-owner-is-not-owner, `userId` undefined; `formatArchivedOn` for a valid ISO string, `null`, `undefined`, and a garbage string.

### 2. `src/services/teamLifecycleService.ts` (new)

**Revised (round 2, Minor 4)** — return types reference the mutations' own inferred return types (`Schema['archiveTeam']['returnType']`, etc.) instead of hand-typing to `Team`. Otherwise unchanged in shape from round 1: follows `cascadeDeleteService.ts`'s module shape (one `generateClient<Schema>()` at module scope) and `invitationService.ts:acceptTeamInvitation`'s error-checking shape (check `result.errors` explicitly rather than relying on a thrown rejection, since the Amplify client resolves Lambda-thrown errors into `result.errors`, not a rejected promise). **Mechanical fix:** each exported function's declared return type is wrapped in `NonNullable<...>`, and `assertLifecycleResult` itself is typed to return `NonNullable<T>` (not just `T`) so its body's runtime null-check and its type both agree — without this, `Schema['archiveTeam']['returnType']` (nullable) would flow through unchanged and mismatch `Management.tsx`'s non-null call sites.

```ts
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

function assertLifecycleResult<T>(
  result: { data?: T | null; errors?: Array<{ message?: string }> },
  fallbackMessage: string,
): NonNullable<T> {
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || fallbackMessage);
  }
  if (!result.data) {
    throw new Error(fallbackMessage);
  }
  return result.data as NonNullable<T>;
}

/** Owner-only. Marks the team archived and expires its pending invitations. Reversible via restoreTeam. */
export async function archiveTeam(teamId: string): Promise<NonNullable<Schema['archiveTeam']['returnType']>> {
  const result = await client.mutations.archiveTeam({ teamId });
  return assertLifecycleResult(result, 'Failed to archive team');
}

/** Owner-only. Reactivates an archived team. Does not revive invitations expired during archiving. */
export async function restoreTeam(teamId: string): Promise<NonNullable<Schema['restoreTeam']['returnType']>> {
  const result = await client.mutations.restoreTeam({ teamId });
  return assertLifecycleResult(result, 'Failed to restore team');
}

/** Any coach on the team. First-come-first-served claim for a legacy or orphaned-owner team. */
export async function assignTeamOwner(teamId: string): Promise<NonNullable<Schema['assignTeamOwner']['returnType']>> {
  const result = await client.mutations.assignTeamOwner({ teamId });
  return assertLifecycleResult(result, 'Failed to assign team owner');
}
```

Three separate exported functions (not one generic/dynamic dispatcher) to keep each `client.mutations.X` call statically typed — matches the flat, repetitive style already used across `cascadeDeleteService.ts`'s four cascade functions. `assertLifecycleResult` is now a small generic helper (`<T>`) rather than hard-coded to `Team`, so each exported function still gets its own precise, non-hand-typed, non-nullable return type.

**Tests: `src/services/teamLifecycleService.test.ts` (new)** — mirror `cascadeDeleteService.test.ts`'s mocking convention (`vi.hoisted` mock functions for `client.mutations.archiveTeam/restoreTeam/assignTeamOwner`, `vi.mock('aws-amplify/data', ...)`). Cases per function: success returns `result.data`; `result.errors` present → throws with the server's message; `result.data` falsy with no errors → throws the fallback message.

### 3. `src/components/Management.tsx`

**a. `handleCreateTeam`** — add `ownerId: currentUserId` to the `client.models.Team.create({...})` call (the `create` field grant from Step 1's Correction 1 makes this possible now). Unchanged from round 1.

**b. Imports** — add (**revised, UI review fix pass, Major 2**: `DEFAULT_FORM_VALUES` and `TeamFormState` are added here too — confirmed by reading `Management.tsx`'s current imports, neither is already present; `DEFAULT_FORM_VALUES` lives in `../constants/gameConfig` (not re-exported from `managementReducers.ts`), and `TeamFormState` is a named export of `managementReducers.ts` alongside `teamFormReducer`/`initialTeamForm`, which are already imported there):
```ts
import { archiveTeam, restoreTeam, assignTeamOwner } from '../services/teamLifecycleService';
import { isTeamArchived, isTeamActive, isTeamOwner, isTeamOwnershipAssigned, formatArchivedOn } from '../utils/teamUtils';
import type { Team } from '../types/schema'; // already imported today — no change, noted for reference
import { DEFAULT_FORM_VALUES } from '../constants/gameConfig';
import type { TeamFormState } from './managementReducers'; // add to the existing `import { teamFormReducer, initialTeamForm, ... } from './managementReducers'` block
```

**c. New state**, alongside `rosterView` (**revised, round 2**: adds `teamLifecycleOverrides` for Major 1, plus a guarded tab-switch path to reset in-progress team form state when leaving the Active sub-tab for Minor 5; **revised again, UI review fix pass, Major 2**: the round-2 text below unconditionally reset the form on every tab switch with no dirty check, silently discarding an in-progress create/edit — see the corrected `handleTeamsViewChange` below, which replaces the bare `useEffect`):
```ts
const [teamsView, setTeamsView] = useState<'active' | 'archived'>('active');
const [pendingTeamActionId, setPendingTeamActionId] = useState<string | null>(null);

type TeamLifecycleFields = Pick<Team, 'status' | 'ownerId' | 'archivedAt' | 'archivedBy'>;
const [teamLifecycleOverrides, setTeamLifecycleOverrides] =
  useState<Record<string, TeamLifecycleFields>>({});
```
`pendingTeamActionId` disables the in-flight team's action buttons and prevents double-submission; cleared in a `finally`. **Round 2 addition:** `handleDeleteTeam` (item f below) is now also covered by `pendingTeamActionId`, so Restore and Delete Permanently on the same archived card can't race each other mid-flight (informational finding, folded in as cheap and directly relevant).

**UI review fix pass, Major 2 — tab switch must not silently discard an in-progress create/edit form.** The Active/Archived toggle sits directly below "+ Create New Team," so a coach mid-create who taps (or mis-taps) "Archived Teams" would otherwise lose all typed input instantly with no recourse. This codebase already has a resolved pattern for exactly this: `src/components/UserProfile.tsx`'s `handleDiscardChanges` (~lines 130–148) gates a discard behind an `isDirty` memo and calls `confirm({ title: 'Discard changes?', message: 'You have unsaved profile changes. Discard them?', confirmText: 'Discard', variant: 'warning' })`, only proceeding with the discard if the coach confirms or if there was nothing to lose. Reuse that shape here, adapted for the team form, instead of the unconditional `useEffect` reset:
```ts
// Mirrors UserProfile.tsx's isDirty memo: START_CREATE resets every field to
// initialTeamForm before setting isCreating, so "dirty while creating" is any
// field differing from its initial/default value; "dirty while editing" is
// simply editing != null (EDIT_TEAM always populates real, non-default values
// from the team being edited, so there is no meaningful "clean edit" state).
function isTeamFormDirty(form: TeamFormState): boolean {
  if (form.editing) return true;
  if (!form.isCreating) return false;
  return (
    form.name.trim() !== '' ||
    form.maxPlayers !== DEFAULT_FORM_VALUES.maxPlayers ||
    form.halfLength !== DEFAULT_FORM_VALUES.halfLength ||
    form.sport !== DEFAULT_FORM_VALUES.sport ||
    form.gameFormat !== DEFAULT_FORM_VALUES.gameFormat ||
    form.selectedFormation !== ''
  );
}

const handleTeamsViewChange = async (nextView: 'active' | 'archived') => {
  if (nextView === teamsView) return;
  if (isTeamFormDirty(teamForm)) {
    const confirmed = await confirm({
      title: 'Discard changes?',
      message: 'You have unsaved team changes. Discard them?',
      confirmText: 'Discard',
      variant: 'warning',
    });
    if (!confirmed) return;
  }
  teamDispatch({ type: 'RESET' });
  setTeamsView(nextView);
};
```
`isTeamFormDirty` is a plain module- or component-scoped helper (not a `useMemo` — it's only evaluated on the toggle click, not on every render, so memoization buys nothing here); `TeamFormState` and `DEFAULT_FORM_VALUES` are pulled in via the two new imports added in item **b** above (`TeamFormState` from `managementReducers.ts`, `DEFAULT_FORM_VALUES` from `../constants/gameConfig`). `handleTeamsViewChange` fully replaces the round-2 `useEffect` — there is no longer a bare `useEffect` keyed on `teamsView` for this purpose; the reset now happens synchronously with the tab-switch action itself (after any confirm resolves), which is also what makes it interceptable/cancelable in the first place. See item **h** below for where this wires into the toggle buttons' `onClick`.

**d. Derived lists** (**revised, round 2** — Major 1's override merge, and the reconciler effect that clears an override once raw `teams` converges):
```ts
function applyLifecycleOverride(updated: { id: string } & Partial<TeamLifecycleFields>) {
  setTeamLifecycleOverrides(prev => ({
    ...prev,
    [updated.id]: {
      status: updated.status ?? null,
      ownerId: updated.ownerId ?? null,
      archivedAt: updated.archivedAt ?? null,
      archivedBy: updated.archivedBy ?? null,
    },
  }));
}

useEffect(() => {
  setTeamLifecycleOverrides(prev => {
    if (Object.keys(prev).length === 0) return prev;
    let changed = false;
    const next: typeof prev = {};
    for (const [id, override] of Object.entries(prev)) {
      const raw = teams.find(t => t.id === id);
      const converged =
        !!raw &&
        raw.status === override.status &&
        raw.ownerId === override.ownerId &&
        raw.archivedAt === override.archivedAt &&
        raw.archivedBy === override.archivedBy;
      if (converged) {
        changed = true;
      } else {
        next[id] = override;
      }
    }
    return changed ? next : prev;
  });
}, [teams]);

const teamsForDisplay = useMemo(
  () => teams.map(t => {
    const override = teamLifecycleOverrides[t.id];
    return override ? { ...t, ...override } : t;
  }),
  [teams, teamLifecycleOverrides]
);
const activeTeams = teamsForDisplay.filter(isTeamActive);
const archivedTeams = teamsForDisplay.filter(isTeamArchived);
```
See the "Decision (round 2, Major 1)" section above for the full authoritative-source rationale. Every place in this component that renders team-card lifecycle fields (Teams tab list, both branches) must read from `teamsForDisplay`/`activeTeams`/`archivedTeams`, not raw `teams`. Non-lifecycle usages of `teams` elsewhere in the component (e.g. the `teamIds = new Set(teams.map(...))` membership check around line 785, used for filtering formations/players by team association) are unaffected by these three mutations and can keep reading raw `teams`.

**e. New handlers**, near `handleDeleteTeam` (**revised, round 2** — each now calls `applyLifecycleOverride` on success, before its `finally`):
```ts
const handleArchiveTeam = async (team: Team) => {
  const confirmed = await confirm({
    title: 'Archive Team',
    message: 'Archiving is reversible — you can restore this team anytime from the Archived Teams view. All players, games, and other data are preserved. Any pending team invitations will be expired.',
    confirmText: 'Archive Team',
    variant: 'warning',
  });
  if (!confirmed) return;
  setPendingTeamActionId(team.id);
  try {
    const updated = await archiveTeam(team.id);
    applyLifecycleOverride(updated);
    trackEvent(AnalyticsEvents.TEAM_ARCHIVED.category, AnalyticsEvents.TEAM_ARCHIVED.action); // new event, see step 7a
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to archive team';
    showError(message);
  } finally {
    setPendingTeamActionId(null);
    setTeamRefreshKey(k => k + 1);
  }
};

const handleRestoreTeam = async (team: Team) => {
  const confirmed = await confirm({
    title: 'Restore Team',
    message: 'This team will become active again. Invitations that expired while archived are not automatically revived — re-send them if needed.',
    confirmText: 'Restore Team',
    variant: 'default',
  });
  if (!confirmed) return;
  setPendingTeamActionId(team.id);
  try {
    const updated = await restoreTeam(team.id);
    applyLifecycleOverride(updated);
    trackEvent(AnalyticsEvents.TEAM_RESTORED.category, AnalyticsEvents.TEAM_RESTORED.action);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to restore team';
    showError(message);
  } finally {
    setPendingTeamActionId(null);
    setTeamRefreshKey(k => k + 1);
  }
};

const handleAssignTeamOwner = async (team: Team) => {
  setPendingTeamActionId(team.id);
  try {
    const updated = await assignTeamOwner(team.id);
    applyLifecycleOverride(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign team owner';
    showError(message);
  } finally {
    setPendingTeamActionId(null);
    setTeamRefreshKey(k => k + 1);
  }
};
```
No confirmation dialog for Assign Owner — low-risk, reversible-by-nature (any coach can still see who owns it and it doesn't destroy anything), consistent with not being listed among the parent plan's specified confirmation dialogs. **Unchanged from round 1.**

**f. `handleDeleteTeam`** (**revised, round 2** — `confirmText` matches the parent plan's specified label, and the delete itself is now covered by `pendingTeamActionId`, closing the informational "Restore and Delete Permanently aren't mutually exclusive during an in-flight delete" finding):
```ts
const handleDeleteTeam = (id: string) => confirmAndDelete(confirm, {
  title: 'Delete Team',
  message: 'Are you sure you want to delete this team? This will also delete all players, positions, and games.',
  confirmText: 'Delete Permanently',
  deleteFn: async () => {
    setPendingTeamActionId(id);
    try {
      await deleteTeamCascade(id);
      trackEvent(AnalyticsEvents.TEAM_DELETED.category, AnalyticsEvents.TEAM_DELETED.action);
    } finally {
      setPendingTeamActionId(null);
      setTeamRefreshKey(k => k + 1);
    }
  },
  entityName: 'team',
});
```

**g. `src/utils/analytics.ts`** — add `TEAM_ARCHIVED` and `TEAM_RESTORED` to `AnalyticsEvents`, matching the existing `TEAM_CREATED`/`TEAM_DELETED` shape (`{ category: 'Team', action: '...' }`). (Read the file first; this is a small, mechanical addition following the established pattern.) Unchanged from round 1.

**h. Teams tab JSX — sub-toggle**, inserted between the "+ Create New Team" button and the edit/create forms (**revised, UI review fix pass, Major 2**: both toggle buttons now call `handleTeamsViewChange` instead of `setTeamsView` directly, so a dirty form is caught before the switch happens):
```tsx
{!teamForm.isCreating && !teamForm.editing && teamsView === 'active' && (
  <button onClick={() => teamDispatch({ type: 'START_CREATE' })} className="btn-primary">
    + Create New Team
  </button>
)}

<div className="view-toggle" style={{ margin: '0.75rem 0' }}>
  <button
    className={teamsView === 'active' ? 'active' : ''}
    onClick={() => handleTeamsViewChange('active')}
  >
    Active Teams ({activeTeams.length})
  </button>
  <button
    className={teamsView === 'archived' ? 'active' : ''}
    onClick={() => handleTeamsViewChange('archived')}
  >
    Archived Teams ({archivedTeams.length})
  </button>
</div>
```
(`+ Create New Team`'s existing guard already excludes it while creating/editing; add `&& teamsView === 'active'` so it also hides under the Archived sub-tab, per parent plan. Because `handleTeamsViewChange` only flips `teamsView` — and therefore only reaches the `teamDispatch({ type: 'RESET' })` inside it — after confirming there's nothing to lose or the coach explicitly agreed to discard, this button's guard and the actual form-open state stay in sync in every case, including the previously-silent mid-edit tab switch.)

**i. Teams list rendering** — replace the single `teams.map(...)` block with a branch on `teamsView`, iterating `teamsForDisplay`-derived `activeTeams`/`archivedTeams` (not raw `teams`):

*Active branch* (`teamsView === 'active'`): iterate `activeTeams`. Per card:
- Drop the `swipeable-item-container` wrapper, `getSwipeStyle`/`getSwipeProps` spread, and the `isSwiped`/`delete-action` block entirely — render `<div className="item-card"> ... </div>` directly inside the existing `team-card-wrapper` div. (`useSwipeDelete`'s `getSwipeProps`/`getSwipeStyle`/`swipedItemId`/`closeSwipe` stay imported and used unchanged for the Formations and Players sections below — do not touch those.)
- Keep the existing Show/Hide-roster (▼/▶) and Edit (✎) buttons in `card-actions`.
- **Placement pinned explicitly (round 2, Minor 6 — no longer "implementer's call"):** the lifecycle-action row is the **last child of `.team-card-wrapper`, after the `{isExpanded && (<div className="team-roster-section">...</div>)}` block closes**, i.e. immediately before `.team-card-wrapper`'s own closing `</div>`. It must **not** be nested inside `.item-card`'s flex row (its `margin-top` would have no effect inside that flex container) and must **not** sit between `.item-card` and `.team-roster-section` (breaking the visual join those two rely on being adjacent, confirmed by reading the current JSX structure).
  ```tsx
  <div className="team-lifecycle-actions">
    {isTeamOwner(team, currentUserId) && (
      <button
        className="btn-secondary"
        disabled={pendingTeamActionId === team.id}
        onClick={() => handleArchiveTeam(team)}
      >
        Archive
      </button>
    )}
    {!isTeamOwnershipAssigned(team) && (
      <>
        <span className="archive-badge">Owner Unassigned</span>
        <button
          className="btn-secondary"
          disabled={pendingTeamActionId === team.id}
          onClick={() => handleAssignTeamOwner(team)}
        >
          Assign Owner
        </button>
      </>
    )}
  </div>
  ```
  (If the team has an owner who is *not* the current user, neither branch renders — no lifecycle actions shown, matching "hidden, not disabled, for non-owners." **(UI review fix pass, badge upgrade)**: `Owner Unassigned` uses `.archive-badge`, not `.item-meta` — see the Decision above for the full rationale; applies identically here on the active-card branch.)

*Archived branch* (`teamsView === 'archived'`): iterate `archivedTeams`. No Show/Hide-roster or Edit affordance (Decision above). Per card — **revised, round 2 (Major 2): `Restore Team` gated on `isTeamOwner`, `Owner Unassigned`/`Assign Owner` added, `Delete Permanently` explicitly ungated and carries a stable `aria-label`:**
```tsx
<div className="team-card-wrapper">
  <div className="item-card archived">
    <div className="item-info">
      <h3>{team.name} <span className="archive-badge">Archived</span></h3>
      <p className="item-meta">
        {formatArchivedOn(team.archivedAt) ? `Archived ${formatArchivedOn(team.archivedAt)}` : 'Archived'}
        {team.archivedBy && (team.archivedBy === currentUserId ? ' by you' : ' by another coach')}
      </p>
    </div>
  </div>
  <div className="team-lifecycle-actions">
    {isTeamOwner(team, currentUserId) && (
      <button
        className="btn-secondary"
        disabled={pendingTeamActionId === team.id}
        onClick={() => handleRestoreTeam(team)}
      >
        Restore Team
      </button>
    )}
    {!isTeamOwnershipAssigned(team) && (
      <>
        <span className="archive-badge">Owner Unassigned</span>
        <button
          className="btn-secondary"
          disabled={pendingTeamActionId === team.id}
          onClick={() => handleAssignTeamOwner(team)}
        >
          Assign Owner
        </button>
      </>
    )}
    <button
      className="btn-danger"
      disabled={pendingTeamActionId === team.id}
      onClick={() => handleDeleteTeam(team.id)}
      aria-label="Delete team permanently"
    >
      Delete Permanently
    </button>
  </div>
</div>
```
**(UI review fix pass, badge upgrade)**: `Owner Unassigned` uses `.archive-badge`, not `.item-meta` — same rationale as the active-card branch above, applied here on the archived-card branch where the lockout scenario actually plays out.

*Empty states*, per branch (unchanged from round 1):
```tsx
{teamsView === 'active' && activeTeams.length === 0 && (
  <p className="empty-message">No teams yet. Create your first team!</p>
)}
{teamsView === 'archived' && archivedTeams.length === 0 && (
  <p className="empty-message">No archived teams. Teams you archive will appear here for historical reference and can be restored anytime.</p>
)}
```

**j. Sharing tab team picker (round 2, Minor 7 — newly in scope)**, ~lines 1789–1826: change `teams.length === 0 ? ... : teams.map((team) => {...})` to `activeTeams.length === 0 ? ... : activeTeams.map((team) => {...})`. One-line change, `activeTeams` already exists in-component from item **d** above. Prevents sending a new invitation to an archived team, which nothing currently expires (Phase 4's `accept-invitation` archived-guard doesn't exist yet).

### 4. `src/App.css` — one small addition

**Revised (UI review fix pass, Major 1 + Minor 3/4):** the round-1 rule used a flat `gap: 0.5rem` (8px) between every action button, which the parent plan's spacing requirement (`TEAM-ARCHIVE-PLAN.md`: archive and permanent-delete actions "separated by at least 12px ... so archive and permanent delete are never adjacent or confusable, especially on mobile") does not meet — on a 375px viewport, "Restore Team" and "Delete Permanently" sit only 8px apart with `flex-wrap` never triggering a stacking fallback. Fixed by raising `gap` to `0.75rem` (12px) uniformly, so **every** adjacent action pair — not just the one before Delete Permanently — meets the 12px minimum, including on any wrapped row. `align-items: center` is added (Minor 3) so the plain-text "Owner Unassigned" span vertically centers against the taller `<button>` elements in the same row instead of top-aligning/stretching. A subtle `border-top` is added (Minor 4) so the action row visually reads as part of its card rather than a stray row of buttons floating below it — the same "joined to the card" intent `.team-roster-section` already uses (dashed top border there; solid here since this row isn't a dashed-optional expansion, it's a permanent part of every card):
```css
.team-lifecycle-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color);
}
```
`.item-card.archived`, `.archive-badge`, `.view-toggle`, `.btn-secondary`, `.btn-danger`, `.empty-message` all already exist — reused as-is, no changes. (`.archive-badge` additionally gets a second consumer in this revision — see item 3i/Decision Major 2 below, "badge upgrade.")

### 5. `src/services/demoDataService.ts`

`createDemoTeam` — add `ownerId: currentUserId` to the `client.models.Team.create({...})` call (line ~33-40). Unchanged from round 1.

### 6. `src/components/Home.tsx`

**a. Import** — add `import { isTeamActive } from '../utils/teamUtils';`.

**b. Derived active list**, immediately after the `teams`/`games` `useAmplifyQuery` calls (~line 65):
```ts
const activeTeams = useMemo(() => teams.filter(isTeamActive), [teams]);
```

**c. `checklistStepCompletion` memo (~lines 118-135)** — replace the two raw-`teams` references with `activeTeams`:
```ts
const checklistStepCompletion = useMemo(
  () => [
    activeTeams.length >= 1,
    profileComplete,
    (teamRosters as { teamId: string }[]).some((r) =>
      (activeTeams as { id: string }[]).some((t) => t.id === r.teamId)
    ),
    (activeTeams as { id: string; formationId?: string | null }[]).some(
      (t) => t.formationId != null && t.formationId !== ''
    ),
    games.length >= 1,
    gamePlans.length >= 1,
    (games as { status?: string }[]).some(
      (g) => g.status === 'in-progress' || g.status === 'completed'
    ),
  ],
  [activeTeams, profileComplete, teamRosters, games, gamePlans]
);
```
**Round 2 note (Minor 9):** this change is what causes the onboarding-regression-reopen consequence documented in the Decisions section above — archiving a coach's only active team will flip steps 1/3/4 back to incomplete, and the existing regression-reopen effect (~lines 168–193, unchanged) will reopen a dismissed checklist as a result. This is accepted, intended behavior; see File-by-File item 9 for the test that documents it.

**d. `<QuickStartChecklist>` prop (~line 502)** — pass `teams={activeTeams}` instead of `teams={teams}`. `QuickStartChecklist` recomputes its own step-completion booleans internally from whatever `teams` it's given (confirmed by reading `QuickStartChecklist.tsx`); this one-line swap keeps its rendered checklist consistent with `checklistStepCompletion` without touching that component.

**e. `getTeam` (~line 315) — do NOT change.** Keep searching the full `teams` array. This is what keeps completed/in-progress/scheduled games for an archived team visible (Acceptance Criterion 5). Call this out with an inline comment when editing nearby code, so a future pass doesn't "fix" it by mistake:
```ts
// Intentionally searches the full `teams` list, not activeTeams — historical
// games for an archived team must still resolve their team name/info here.
// See docs/plans/TEAM-ARCHIVE-STEP5-FRONTEND-UX.md.
const getTeam = (teamId: string) => {
  return teams.find(t => t.id === teamId);
};
```

**f. `handleCreateGame` (~line 330)** — two changes:
1. Keep the `teams.find(...)` lookup as-is (unchanged — needs to resolve whichever team was actually selected).
2. Add a defensive archived-team guard right after the existing "Team not found" check, since the dropdown (change `g` below) is UI-only enforcement and a stale `selectedTeamForGame` could theoretically still reference a team archived by another coach mid-session:
   ```ts
   if (!isTeamActive(team)) {
     showError('Cannot schedule a game for an archived team.');
     return;
   }
   ```
   This is a cheap strengthening of the existing UI-only enforcement gap (full server-side enforcement is parent Phase 8, still deferred) and directly serves this slice's "confirm mutations are blocked" verification goal.

**g. Schedule Game team `<select>` (~line 534)** — change `{teams.map((team) => (` to `{activeTeams.map((team) => (`.

**h. Line 104 (auto-welcome-skip check) and line 196 (`homeDebugContext.teamCount`) are left unchanged (full `teams`), intentionally** — not "onboarding progress," they answer "has this account ever had a team" and "raw debug count" respectively, both of which should still count an archived team.

*(Items a–h all unchanged from round 1 — `Home.tsx`'s own logic was not the subject of any round-2 finding beyond the note added to item **c**.)*

### 7. Test infrastructure updates

**a. `src/test/mockAmplifyClient.ts`** — add a `teamLifecycle` mock group (mirrors the existing `cascade` group) and mock the new service module. **Mechanical fix:** resolved values include all four lifecycle fields (`status`, `ownerId`, `archivedAt`, `archivedBy`) plus `id` — not partial objects. `applyLifecycleOverride` in `Management.tsx` reads all four fields from the mutation's resolved value and writes them into `teamLifecycleOverrides` as a unit; a partial mock resolved value would null out the fields it omits (via `updated.ownerId ?? null`, etc.), causing an archived test card to render "Owner Unassigned" instead of the correct owner and giving false confidence in tests that never actually exercise the real card state:
```ts
teamLifecycle: {
  archiveTeam: vi.fn().mockResolvedValue({
    id: 'team-1',
    status: 'archived',
    ownerId: 'test-user-id',
    archivedAt: '2026-08-19T00:00:00.000Z',
    archivedBy: 'test-user-id',
  }),
  restoreTeam: vi.fn().mockResolvedValue({
    id: 'team-1',
    status: 'active',
    ownerId: 'test-user-id',
    archivedAt: null,
    archivedBy: null,
  }),
  assignTeamOwner: vi.fn().mockResolvedValue({
    id: 'team-1',
    status: 'active',
    ownerId: 'test-user-id',
    archivedAt: null,
    archivedBy: null,
  }),
},
```
Individual test cases that need a different starting shape (e.g. `assignTeamOwner` resolving on an *archived* team for the Major 2 lockout scenario) override the relevant call with `.mockResolvedValueOnce({...})` supplying the full four-field shape appropriate to that case — never a partial object.
```ts
vi.mock('../services/teamLifecycleService', () => ({
  archiveTeam: state.teamLifecycle.archiveTeam,
  restoreTeam: state.teamLifecycle.restoreTeam,
  assignTeamOwner: state.teamLifecycle.assignTeamOwner,
}));
```
Export `teamLifecycle` from `managementUiMocks`; reset the three mocks' resolved values in `resetManagementHarness`.

**Round 2 addition (Minor 1) — required, not optional:** add `TEAM_ARCHIVED` and `TEAM_RESTORED` to the existing hand-maintained `AnalyticsEvents` mock (~lines 140–151):
```ts
vi.mock('../utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    TEAM_CREATED: { category: 'test', action: 'test' },
    TEAM_DELETED: { category: 'test', action: 'test' },
    TEAM_ARCHIVED: { category: 'test', action: 'test' },   // new
    TEAM_RESTORED: { category: 'test', action: 'test' },   // new
    PLAYER_ADDED: { category: 'test', action: 'test' },
    PLAYER_ADDED_TO_ROSTER: { category: 'test', action: 'test' },
    PLAYER_DELETED: { category: 'test', action: 'test' },
    FORMATION_CREATED: { category: 'test', action: 'test' },
    FORMATION_DELETED: { category: 'test', action: 'test' },
  },
}));
```
Without this, `trackEvent(AnalyticsEvents.TEAM_ARCHIVED.category, ...)` throws inside the archive/restore handlers' own `try`/`catch`, and archive/restore tests would silently exercise the failure path (caught, `showError` called with a generic `TypeError` message) instead of the success path they're meant to cover.

**Round 2 note (Minor 2):** `useAmplifyQuery`'s mock (~lines 85–89) ignores its `deps` argument entirely, so no test can observe a `teamRefreshKey` bump through this harness. Per the Major 1 decision above, tests assert against the *rendered effect* of `teamLifecycleOverrides` instead (e.g., the team card moving sections / the Active-Archived counts changing after a mutation resolves) — this is real, observable component behavior through the mock harness, unlike `teamRefreshKey`.

**b. `src/test/fixtures/managementFixtures.ts`** — `teamFixture` already spreads `overrides`, so `teamFixture({ status: 'archived', ownerId: 'coach-a', archivedAt: '...', archivedBy: 'coach-a' })` works with no fixture changes needed. No change required here. Unchanged from round 1.

### 8. New test file: `src/components/Management.teamLifecycle.test.tsx`

Follows `Management.integration.test.tsx`'s harness (`renderWithProviders`, `managementModelMocks`, `managementUiMocks`, fixtures). Cases (**revised, round 2** — items marked):
- Active/Archived sub-toggle renders with correct counts from a mixed fixture set; clicking "Archived Teams" switches the visible list and hides "+ Create New Team".
- **(Round 2, Major 1 — now fully specified, not punted)** Active team owned by `test-user-id` (the mocked `getCurrentUser` id) shows an "Archive" button; clicking it opens the confirm modal with `title: 'Archive Team'`, then confirming calls `archiveTeam('team-1')`. After it resolves, assert the **rendered effect of `teamLifecycleOverrides`**: the team's card is no longer present in the Active Teams list (`teamsView === 'active'`), and switching to "Archived Teams" shows it there with the "Archived" badge — driven purely by component state, not by the (deps-ignoring) mocked `useAmplifyQuery`.
- Active team owned by a different coach: no Archive button, no Owner-Unassigned indicator.
- Active team with no `ownerId` (or `ownerId` not in `coaches`, to cover the orphaned case): shows "Owner Unassigned" + "Assign Owner"; clicking it calls `assignTeamOwner('team-1')`, and (round 2) after resolving, the same team's card shows "Archive" instead of "Owner Unassigned" (proving the override applied).
- **No `useSwipeDelete` wiring remains on team cards, corrected (round 2, "Also fold in" note):** first switch to the Formations tab (`clickManagementTab`/equivalent) and confirm a Formation card's swipe still works (getSwipeProps/getSwipeStyle called with a formation id, or the swipe delete action renders) — only one section's list renders at a time (`activeSection` state), so this assertion is not reachable without switching tabs. Then switch back to Teams and assert no `.btn-delete-swipe`/`delete-action` renders for a team card regardless of `swipedItemId`.
- **(Round 2, Major 2 — corrected gating)** Archived team card **owned by `test-user-id`** shows the "Archived" badge, a formatted `archivedAt` line, and both "Restore Team" and "Delete Permanently" buttons (no "Owner Unassigned"); clicking Restore opens a `variant: 'default'` confirm titled "Restore Team" and calls `restoreTeam('team-1')` on confirm; after resolving, assert the override moves the card back to the Active Teams list.
- **(Round 2, Major 2 — new case)** Archived team card **owned by a different coach** shows only "Delete Permanently" (no "Restore Team", no "Owner Unassigned"/"Assign Owner").
- **(Round 2, Major 2 — new case, the lockout scenario)** Archived team card with an **orphaned owner** (`ownerId` set to an id not present in `coaches`) shows "Owner Unassigned" + "Assign Owner" (no "Restore Team", since the current user isn't the valid owner), and "Delete Permanently"; clicking "Assign Owner" calls `assignTeamOwner('team-1')`, after which the override makes "Restore Team" appear in its place.
- **(Round 2, Major 2 — explicit)** Archived team card, regardless of ownership state, always renders "Delete Permanently" — assert this holds for the owned, other-owner, and orphaned-owner cases above (no case hides it).
- Clicking "Delete Permanently" opens a confirm with `confirmText: 'Delete Permanently'` and calls the existing `deleteTeamCascade` mock on confirm; assert the button carries `aria-label="Delete team permanently"`.
- Error path: `archiveTeam` mock rejects with `new Error('Access denied: only the team owner can archive this team')` → `showError` is called with that exact message (not a generic fallback).
- `handleCreateTeam` passes `ownerId: 'test-user-id'` in the `Team.create` call (extend the existing create-team integration test or add a new one).
- **(Round 2, Minor 5; corrected UI review fix pass, Major 2 — now two cases, not one)**
  - Start editing an active team (open the edit form, so `teamForm.editing` is set — dirty by definition), click "Archived Teams", and assert a confirm dialog opens with `title: 'Discard changes?'` and `variant: 'warning'`. Resolve it with **cancel**: assert `teamsView` did not change (still on Active Teams / the toggle's `active` class stays on "Active Teams"), the edit form is still rendered, and its fields still hold the previously-typed values (i.e., `RESET` was **not** dispatched).
  - Click "Archived Teams" again and resolve the same confirm with **confirm** this time: assert the edit form is no longer rendered and `teamsView` is now `'archived'`; switch back to "Active Teams" and assert the form stays closed (i.e., `RESET` actually fired exactly once, on confirm, not on the earlier cancel, and the form doesn't silently reappear).
  - **(New case)** With no form open (`teamForm.isCreating === false`, `teamForm.editing === null`), click "Archived Teams": assert the tab switches immediately with **no** confirm dialog invoked — the dirty check must not add friction when there is nothing to discard. Also cover the "just opened create form, nothing typed yet" case (`isCreating: true`, all fields still default) the same way, since `isTeamFormDirty` treats that as clean too.
- **(Round 2, Minor 7 — new case)** Sharing tab's team picker lists only active teams from a mixed fixture set (an archived team's name does not appear in the "Select a team to share" list).

### 9. `src/components/Home.test.tsx` additions

- Team fixture set with one active and one archived team, plus a completed `Game` belonging to the archived team: assert the game still renders in the "Past Games" group (proves `getTeam` correctness was preserved).
- Schedule Game `<select>` options list only the active team's name, not the archived one, when `isCreatingGame` is opened.
- **(Round 2, Minor 3 — corrected)** The existing `QuickStartChecklist` mock stub (~lines 146–148) discards its props (`() => <div data-testid="quick-start-checklist" />`), so round 1's planned prop-capture assertion is not implementable as written. **Fix: change the stub to capture its props** (e.g. `QuickStartChecklist: (props: unknown) => <div data-testid="quick-start-checklist" data-teams={JSON.stringify((props as { teams: unknown[] }).teams)} />`, or a `vi.fn()`-backed mock that records the last call's `teams` prop) so a test can assert only the active team was passed when both an active and archived team exist. **Round 1's bullet about asserting checklist step 1 completion via "whatever externally-observable signal the existing tests already use" is replaced by this concrete fix** rather than dropped.
- **(Round 2, Minor 9 — new, required)** With only an archived team present (no active team) and `dismissed: true` in the mocked onboarding state (matching the existing "suppress QuickStartChecklist in all tests" default) plus a `localStorage` snapshot under `onboarding:lastCompletedSteps` recorded as if step 1 (and 3/4, if also seeded) were previously complete: assert the regression-reopen effect fires — `clearDismissed()` is called (or, if `clearDismissed` isn't independently mockable/observable, assert the equivalent externally-visible effect the existing regression-reopen tests already use, e.g. the checklist becoming visible again) — proving that archiving a coach's only active team correctly reopens a dismissed checklist rather than silently leaving it dismissed against a now-incomplete state. This documents the Decision (round 2, Minor 9) above as tested, accepted behavior.

### 10. `src/components/Management.integration.test.tsx` (round 2, Major 3 — required fix)

The existing `it('respects delete cancel and confirm decisions for team records', ...)` test (~lines 134–155) drives deletion through `swipedItemId: 'team-delete'` passed to `renderWithProviders`, and a `screen.getByRole('button', { name: /delete team/i })` query that today resolves to the swipe `delete-action` button. Both assumptions break once team-card swipe wiring is removed. Fix:
- Build the fixture already archived, since this test only needs to exercise the Archived-view delete path, not the archive step itself: `teamFixture({ id: 'team-delete', name: 'Delete Me FC', status: 'archived', coaches: ['test-user-id'] })`.
- Drop `swipedItemId: 'team-delete'` from the `renderWithProviders` options — it no longer does anything for team cards.
- Before querying for the delete button, switch to the Archived Teams sub-tab: `await user.click(screen.getByRole('button', { name: /archived teams/i }));`.
- The `screen.getByRole('button', { name: /delete team/i })` query can be left as-is — `/delete team/i` is a substring `RegExp` match against the accessible name, and the new button's `aria-label="Delete team permanently"` still contains "delete team" case-insensitively, so the existing query continues to resolve correctly to the one, now-unambiguous button. (Confirmed: Testing Library's `RegExp` name matching is `.test()`-based substring matching, not exact-match, so this is not a false assumption.) Optionally tighten it to `/delete team permanently/i` for clarity, but not required for the test to pass.
- The rest of the test (cancel path calls `confirm` but not `deleteTeamCascade`; confirm path calls `deleteTeamCascade('team-delete')`) is unchanged.

The parallel player-delete test in the same file (~lines 157–180) is unaffected — Player cards keep their existing swipe wiring untouched.

### 11. `e2e/team-management.spec.ts` (round 2, Major 3 — required fix)

`test('creates a team and verifies delete cancel/confirm', ...)` (~lines 23–49) currently swipes the newly-created team's card directly to delete it, for both the cancel and confirm paths. Since the test creates the team itself, it is the team's owner and will see an "Archive" button on the card. Revise the flow to go through the new lifecycle. **Mechanical fix: the Archive button locator must scope on `.team-card-wrapper`, not `.item-card`** — the Archive button lives in `.team-lifecycle-actions`, which is the last child of `.team-card-wrapper`, a *sibling* of `.item-card`, not nested inside it (see File-by-File item 3i). Scoping `getByRole('button', { name: 'Archive' })` on `.item-card` resolves to zero elements:
```ts
// Archive: cancel, then confirm.
await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
await clickConfirmModalCancel(page);
await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).toBeVisible();

await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
await clickConfirmModalConfirm(page);
await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).not.toBeVisible();

// Switch to Archived Teams; verify the card moved there; then permanent-delete: cancel, then confirm.
await page.getByRole('button', { name: /Archived Teams/ }).click();
await expect(page.locator('.item-card.archived').filter({ hasText: teamName })).toBeVisible();

const archivedCard = page.locator('.item-card').filter({ hasText: teamName }).locator('..');
await archivedCard.getByRole('button', { name: 'Delete team permanently' }).click();
await clickConfirmModalCancel(page);
await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
await expect(page.locator('.item-card.archived').filter({ hasText: teamName })).toBeVisible();

await archivedCard.getByRole('button', { name: 'Delete team permanently' }).click();
await clickConfirmModalConfirm(page);
await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
await expect(page.locator('.item-card').filter({ hasText: teamName })).not.toBeVisible();
```
(The exact locator for the archived card's action row — here approximated as walking up to the `.team-card-wrapper` parent — should be adjusted by the implementer to match the actual rendered structure from File-by-File item 3i; the important assertions are unchanged: cancel leaves the item present, confirm removes it, and the round-trip now goes through Archive before Delete Permanently is reachable at all.) Consider renaming the test to `'creates a team and verifies archive + delete permanently cancel/confirm'` to match what it now exercises; not required, but keeps the name accurate.

**Mechanical fix — unused import:** once both `swipeToDelete` calls above are replaced, `swipeToDelete` is no longer referenced anywhere in this file. Remove `swipeToDelete` from the destructured `import { ... } from './helpers'` block at the top of the file as part of this same change — `e2e/**/*.ts` is linted with zero warnings allowed under `gate:commit`, and a leftover unused import would fail that lint step.

### 12. `e2e/data-isolation.spec.ts` (round 2, Major 3 — required fix)

The "deterministic cleanup under the creating owner" step at the end of `'switching users wires visibility to owner-scoped data'` (~line 61) swipes the team to delete it directly. User1 created the team, so they are its owner. Replace:
```ts
await swipeToDelete(page, `.item-card:has-text("${teamName}")`);
const confirmOverlay = page.locator('.confirm-overlay');
if (await confirmOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
  await clickConfirmModalConfirm(page);
}
await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
await expect(page.locator('.item-card').filter({ hasText: teamName })).toHaveCount(0);
```
with (**mechanical fix: the Archive button locator scopes on `.team-card-wrapper`, not `.item-card`** — same reasoning as item 11 above, the button lives in `.team-lifecycle-actions`, a sibling of `.item-card`, not nested inside it):
```ts
await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
await clickConfirmModalConfirm(page);
await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

await page.getByRole('button', { name: /Archived Teams/ }).click();
await page.locator('.item-card.archived').filter({ hasText: teamName })
  .locator('..').getByRole('button', { name: 'Delete team permanently' }).click();
await clickConfirmModalConfirm(page);
await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
await expect(page.locator('.item-card').filter({ hasText: teamName })).toHaveCount(0);
```
This is cleanup code, not the test's actual assertion (the isolation check itself, lines 34–54, is untouched) — only the teardown mechanism changes.

**Mechanical fix — unused import:** once the `swipeToDelete` call above is replaced, `swipeToDelete` is no longer referenced anywhere in this file. Remove `swipeToDelete` from the destructured `import { ... } from './helpers'` block at the top of the file as part of this same change, for the same zero-warnings-lint reason given in item 11.

### 13. `e2e/helpers.ts` — `cleanupTestData`'s team-cleanup loop (round 2 — found during this revision, not in the reviewer's original three; folded in per the instruction to surface findings rather than narrowly satisfy only the named list)

`cleanupTestData` (~lines 264–304) is called at the start of most e2e specs (confirmed used in 6 spec files beyond `team-management.spec.ts` itself: `formation-management.spec.ts`, `game-planner.spec.ts`, `full-workflow.spec.ts`, `team-sharing.spec.ts`, `player-management.spec.ts`). Its team-cleanup block (~lines 284–304) repeatedly calls `swipeToDelete(page, '.item-card')` in a loop to clear all team cards before a run. Its own `try { ... } catch { break; }` guard means it will not hang or throw once swipe stops working on team cards — it will simply exit the loop having deleted nothing, silently leaving team test data to accumulate across e2e runs in the shared sandbox. This is not one of the three tests the reviewer named directly, but is the same root cause and is cheap to fix in the same pass. Replace the team-cleanup block with an archive-then-permanently-delete loop.

**Mechanical fix — locator scope:** the "which teams are active" check and the Archive-button click must scope on `.team-card-wrapper`, not bare `.item-card`. The Archive button lives in `.team-lifecycle-actions`, a sibling of `.item-card` inside `.team-card-wrapper`, not nested inside `.item-card` — `activeCards.first().getByRole('button', { name: 'Archive' })` scoped on a bare `.item-card:not(.archived)` locator resolves to zero elements. Use `.team-card-wrapper:has(.item-card:not(.archived))` instead, for both the count query and the click target.

**Mechanical fix — unconditional archived sweep:** the pre-existing outer guard (`if (teamCount > 0) { ... }`, where `teamCount` counts `.item-card` on the Active sub-tab) must gate only the first loop (archiving currently-active leftover teams). The second loop — switching to the Archived Teams sub-tab and permanently deleting everything found there — must run unconditionally, every time `cleanupTestData` is called, regardless of `teamCount`. If the archived sweep stayed nested inside `if (teamCount > 0)`, a prior run that archived a team but failed before deleting it permanently would leave that archived team uncleaned forever on any later run that happens to find zero active teams (the guard would skip the whole block, including the archived sweep).
```ts
// Teams no longer support swipe-to-delete (archive-first lifecycle — see
// docs/plans/TEAM-ARCHIVE-STEP5-FRONTEND-UX.md). Archive every active card
// left over from a previous run, then permanently delete everything under
// the Archived Teams sub-tab. The archived-team sweep below runs
// unconditionally, independent of `teamCount` (the active-team guard), so a
// prior run that archived a team but crashed before deleting it still gets
// cleaned up even when zero active teams remain.
const cleanupTeamDialog = handleConfirmDialog(page, false);

if (teamCount > 0) {
  console.log(`Found ${teamCount} team(s), archiving...`);
  let activeCards = page.locator('.team-card-wrapper:has(.item-card:not(.archived))');
  let activeCount = await activeCards.count();
  while (activeCount > 0) {
    await activeCards.first().getByRole('button', { name: 'Archive' }).click().catch(() => {});
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    const newCount = await page.locator('.team-card-wrapper:has(.item-card:not(.archived))').count();
    if (newCount === activeCount) break; // no Archive button (ownerless legacy team) or stuck; stop to avoid hanging
    activeCount = newCount;
  }
}

// Unconditional archived-team sweep — see note above; does not depend on teamCount.
await page.getByRole('button', { name: /Archived Teams/ }).click().catch(() => {});
let archivedCount = await page.locator('.item-card.archived').count();
while (archivedCount > 0) {
  await page.getByRole('button', { name: 'Delete team permanently' }).first().click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  const newCount = await page.locator('.item-card.archived').count();
  if (newCount === archivedCount) break;
  archivedCount = newCount;
}

cleanupTeamDialog();
console.log('✓ Teams archived and deleted');
```
The `activeCount === newCount` break condition means an ownerless legacy team (no "Archive" button to click) still won't be auto-cleaned — flagged as an accepted, low-probability residual gap under Known Gaps, since teams created via this suite's own `createTeam` helper always get an owner (this slice's `handleCreateTeam` change wires `ownerId: currentUserId` at create time).

## Manual Verification Checklist (through the real running app)

Run against the sandbox this backend is deployed to (per `TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md`, this has not yet been sandbox-validated end-to-end — this checklist doubles as that validation):

1. Sign in, go to Manage → Teams, create a new team. Confirm it appears under "Active Teams" with an "Archive" button visible (you are the creator/owner).
2. Confirm no "Owner Unassigned" text appears on this new team's card.
3. Click "Archive". Confirm the modal title is "Archive Team", the confirm button reads "Archive Team", variant styling is the warning (amber) treatment, and Cancel is focused by default (Enter/Space on load should Cancel, not Archive).
4. Confirm. The team should disappear from "Active Teams" and appear under "Archived Teams" with the "Archived" badge and an "Archived <date>" line — **and this should happen immediately, with no visible flicker back to Active Teams even on a slow connection** (round 2, Major 1 — this step now exercises the lifecycle-override mechanism specifically, not just eventual list consistency).
5. Go to Home. Click "+ Schedule New Game" — confirm the archived team does **not** appear in the team dropdown.
6. Go back to Manage → Teams → Archived Teams. Confirm the archived card shows both "Restore Team" (you are the owner) and "Delete Permanently". Click "Restore Team" (confirm `variant: 'default'`, confirm button "Restore Team"). Confirm the team moves back to "Active Teams" immediately.
7. Go to Home → "+ Schedule New Game" again — confirm the restored team is back in the dropdown.
8. (Requires a second coach account or a manually-seeded legacy team with no `ownerId`.) Confirm a team with no owner shows "Owner Unassigned" + "Assign Owner" instead of "Archive"; clicking "Assign Owner" as a coach on that team claims ownership and "Archive" appears afterward.
9. (Requires a second coach account sharing a team.) As a non-owner coach, confirm the team card shows neither "Archive" nor "Owner Unassigned"/"Assign Owner" once an owner is assigned.
10. **(Round 2, Major 2 — new, exercises the lockout fix)** With a second coach account: Coach A creates a team (becomes owner) and archives it. Coach B (already sharing the team) revokes Coach A's access via Sharing & Permissions (`revokeCoachAccess` — no owner guard exists, this is expected to succeed). As Coach B, go to Manage → Teams → Archived Teams: confirm the card now shows "Owner Unassigned" + "Assign Owner" (not "Restore Team", since Coach B isn't the valid owner) and "Delete Permanently". Click "Assign Owner" as Coach B; confirm "Restore Team" now appears in its place, and clicking it successfully restores the team. This proves the archived-team lockout scenario is actually closed, not just gated correctly in isolation.
11. Archive a team, then click "Delete Permanently" on its Archived-view card — confirm the danger-variant modal, confirm button "Delete Permanently", and that confirming actually removes the team (existing cascade-delete behavior, now only reachable from here).
12. Confirm swiping left on an **active** team card no longer reveals a delete action (compare against a Formation or Player card, where swipe-to-delete should be unaffected).
13. **(Round 2, Minor 7 — new)** Go to Manage → Sharing & Permissions. Confirm an archived team does not appear in the "Select a team to share" list, even though it still appears under Manage → Teams → Archived Teams.
14. **(Round 2, Minor 5; corrected UI review fix pass, Major 2)** Start editing an active team (click ✎), then click the "Archived Teams" sub-tab without cancelling. Confirm a "Discard changes?" confirmation appears (warning styling, Cancel focused by default) instead of the tab silently switching. Click Cancel on that confirmation: confirm you remain on "Active Teams" with the edit form still open and your typed changes intact. Click "Archived Teams" again and this time confirm the discard: confirm the tab switches, the edit form is no longer visible, and switching back to "Active Teams" shows the form stays closed (state was actually reset, not just visually hidden). Repeat briefly for an in-progress **create** (open "+ Create New Team," type a name, switch tabs) to confirm the same discard-confirmation behavior applies there too. Finally, with no form open (or an untouched, just-opened create form with no typed input), confirm switching tabs happens immediately with no confirmation prompt — the dirty check must not add friction to the common case.

## Known Gaps Carried Forward (not fixed in this slice)

- No **new** E2E/Playwright coverage of the archive/restore/assign-owner flow itself (parent Phase 7 step 4) — recommend as the next fast-follow once this slice is validated manually. (This is distinct from the round-2 in-scope fixes to `e2e/team-management.spec.ts`, `e2e/data-isolation.spec.ts`, and `cleanupTestData`, which only repair regressions this slice causes in pre-existing, non-archive-specific specs.)
- Archived-team read-only banners / `aria-disabled` treatment on in-game surfaces, Season Reports selector, and Management's own roster-expansion view remain entirely unbuilt (parent Phase 4/5/6 remainder).
- `archivedBy` shows "you" / "another coach" rather than a resolved coach display name (see Decision above).
- `aria-live` announcements on the toggle and pixel-level touch-target audits are not done (explicitly trimmed).
- **(Round 2, Minor 8 — new, required note)** When parent Phase 4 later adds an archived-team check to `deleteTeamSafe` (and any other `*Safe` Lambda), **that check must not block deletes for archived teams.** After this slice, `Delete Permanently` is reachable *only* from the Archived Teams view — every path to `deleteTeamSafe` in the UI now requires the team to already be archived. A naive "reject delete if `status === 'archived'`" guard (the pattern used elsewhere for *other* archived-team protections) would make permanent team deletion completely unreachable through the UI. Any future archived-team guard on `deleteTeamSafe` specifically must be the inverse of the usual pattern (reject if *not* archived, or omit the guard on this one Lambda entirely) — flagged here so Phase 4 doesn't apply its general rule mechanically to this one exception.
- **(Round 2, informational)** `teamRefreshKey` still gates `useAmplifyQuery('TeamRoster', ...)` in the same component, so every archive/restore/assign-owner action re-lists the whole `TeamRoster` table unnecessarily. Accepted as a minor inefficiency now that `teamLifecycleOverrides` (Major 1) provides correctness independent of this refetch — see the "Informational" paragraph under the Major 1 Decision above for the full reasoning on why this wasn't split out.
- **(Round 2, informational)** `cleanupTestData` in `e2e/helpers.ts` still has no automated cleanup path for a leftover **ownerless** legacy team (one with no `ownerId` at all) — its revised team-cleanup logic (File-by-File item 13) archives owned teams and then permanently deletes everything in the Archived view, but an ownerless active team has no "Archive" button to click and would need an Assign-Owner step first to be cleanable. This is expected to be rare in practice (teams created via the e2e suite's own `createTeam` helper always get an `ownerId` from `handleCreateTeam`'s Correction-1 wiring), and is not fixed here to avoid gold-plating a cleanup helper beyond what this slice's own test data can produce.
