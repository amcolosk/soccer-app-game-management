# Team Archive — Step 10: E2E Round-Trip Coverage + `docs/SHARING-PERMISSIONS.md` Update

Status: Draft plan — revised after architecture review round 1 (of max 2)
Date: 2026-08-20 (rev. 1)
Parent plan: [TEAM-ARCHIVE-PLAN.md](TEAM-ARCHIVE-PLAN.md) — "Next Steps (ordered)" item 10 (remaining Phase 7: E2E coverage + documentation).
Prior slices: [TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md](TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md) (owner/lifecycle backend, orphaned-owner reclaim condition — Decision 5; Required Follow-Ups #7: `revokeCoachAccess` still lacks an owner guard), [TEAM-ARCHIVE-STEP5-FRONTEND-UX.md](TEAM-ARCHIVE-STEP5-FRONTEND-UX.md) (Management UX, swipe-delete removal and its e2e fix pass, Sharing-tab active-team filtering — Minor 7), [TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md](TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md) (`deleteGameSafe`/`deletePlayerSafe` archived-team guards, transactional `accept-invitation`), [TEAM-ARCHIVE-STEP9-REPORTS-READONLY-BANNERS.md](TEAM-ARCHIVE-STEP9-REPORTS-READONLY-BANNERS.md) (Season Reports labeling, `ArchivedTeamBanner`, explicitly deferred E2E).

## Revision history

- **Rev 1 (this revision) — architecture review round 1 findings folded in.** Summary of what changed vs. the original draft:
  - **Major 1:** pulled `amplify/functions/assign-team-owner/handler.test.ts` into this slice's scope (it's a test file, but unlike the E2E specs it runs on every `npm run gate:commit`). This is the single biggest change — the slice is no longer purely E2E + docs.
  - **Major 2:** every E2E assertion that reads UI state written by the Lambda-backed lifecycle mutations (`archiveTeam`/`restoreTeam`/`assignTeamOwner`, none of which trigger an AppSync subscription) now reloads/re-navigates on each poll attempt instead of re-reading a DOM snapshot that can never change once stale.
  - **Major 3:** `docs/SHARING-PERMISSIONS.md`'s diff outline now corrects three existing, now-inaccurate statements (the "Delete team" and "Send invitations" table rows, and the "accept-invitation is the only path to add a user to `coaches`" sentence) instead of only adding new content around them.
  - **Major 4:** `revokeCoachAccess`'s failure to cascade to child-record `coaches` arrays is now documented as a residual risk and follow-up, with an optional, cheap E2E assertion added.
  - **Minor 5–14:** shared `logout` helper extracted to `e2e/helpers.ts`; redundant `logout()`/`loginUser()` pairs dropped; `.permission-item` identity guard added before the revoke click; an `afterAll` stale-data sweep added to the new ownership spec; invitation-expiry-on-archive now has E2E coverage (folded into the ownership spec rather than left untested); verification commands corrected to account for the `setup` project dependency; Decision 2's rationale corrected (a two-context Playwright pattern is not unprecedented — just not worth the complexity here); the smoke test's leading `cleanupTestData` call dropped; the E2E snippets now match the real files' actual structure (`test.describe` + `test.describe.configure({ mode: 'serial' })`, not `describe.serial`); Definition of Done corrected to describe the real `gate:commit` sequence; Step 1's still-open "guard `revokeCoachAccess` against revoking the owner" follow-up is now explicitly carried forward into both Part B and this slice's own Required Follow-Ups.

## Goal

Tests and documentation only — application code (`src/`, `amplify/functions/*/handler.ts`) is untouched. This slice does add one new **test** file under `amplify/functions/` (Major 1); that's still test-only, not application code.

- **Part A** — close the real E2E coverage gap: every prior slice's Playwright work was *defensive* (fixing specs broken by removing swipe-to-delete), never *additive* proof that the archive/restore/assign-owner lifecycle itself works end-to-end against the real deployed backend. Add the missing round-trip and the one identified safety-critical edge case that's UI-reachable; and, since the UI-reachable edge case structurally cannot cover the literal archived+orphaned-owner combination, close that specific gap with a backend unit test instead (Major 1), because that test — unlike the E2E specs — actually runs on every commit.
- **Part B** — bring `docs/SHARING-PERMISSIONS.md` up to date with the ownership/archive/restore rules and the actual (not originally-planned) server-side-vs-UI-only enforcement split, correcting several accuracy gaps found while reading the current file against the shipped code (expanded in this revision per Major 3/4).

**Definition of done:**
- `amplify/functions/assign-team-owner/handler.test.ts` (new) passes under `npm run test:run`.
- The two new/extended E2E specs pass locally against a real sandbox: `npm run test:e2e:smoke -- -g "archives and restores a team"` for the extended `team-management.spec.ts`, `npm run test:e2e -- -g "Team archive ownership edge cases"` for the new `team-archive-ownership.spec.ts` (runs under the `full` project).
- `docs/SHARING-PERMISSIONS.md` accurately reflects the shipped Step 1/5/8/9 behavior, including corrections to pre-existing inaccurate content (Major 3/4), with correct file cross-references.
- `npm run gate:commit` passes. This is **not** a lint-only no-op: it runs the full `lint → typecheck:amplify → test:run → build` sequence, and this slice's new `handler.test.ts` file is exercised by the `test:run` stage — so this is the first slice in a while where `gate:commit` is actually expected to catch something if the new test is wrong, not just confirm zero regressions.

## Scope

### In scope
1. **New:** `amplify/functions/assign-team-owner/handler.test.ts` — unit coverage for the one Lambda whose DynamoDB `ConditionExpression` this whole slice's E2E work is worried about (Major 1). Scoped narrowly to that single handler; see Decisions and Part A item 0.
2. **New:** a shared `logout` helper in `e2e/helpers.ts` (Minor 5).
3. One new test in `e2e/team-management.spec.ts` (smoke project): the archive → restore round trip, including Schedule-Game-dropdown exclusion and reappearance — the literal gap named in the task brief.
4. One new spec file, `e2e/team-archive-ownership.spec.ts` (full project only, two-coach): active/archived multi-coach visibility, the orphaned-owner revoke → reclaim → restore recovery flow (the safety-critical edge case), scoped to the variant that's actually reachable through the shipped UI (see Decision 2 below), plus invitation-expiry-on-archive coverage (Minor 8) and an optional revoked-coach-loses-Team-visibility assertion (Major 4).
5. `docs/SHARING-PERMISSIONS.md` — new "Team Lifecycle: Ownership, Archive, and Restore" section, an updated (and corrected) Permission Capabilities table, a correction to the Roles/invitation-role description, and corrected Security Model content reflecting Step 8's actual enforcement split, Step 8/9's recorded residual risks, and the two additional corrections from Major 3/4.

### Explicitly out of scope
- Phase 8 (`Game.create` conversion) — untouched.
- Any `src/` or `amplify/functions/*/handler.ts` application code change. (The one new file this slice adds under `amplify/functions/` is a `*.test.ts` file, not a handler change.)
- `aria-disabled` treatment, sticky-banner work, or other deferred UI polish.
- Fixing the `deletePlayerSafe` disclosure edge case, the banner-staleness limitation, or `revokeCoachAccess`'s missing owner guard / missing child-record cascade — all documented as residual risks/follow-ups, none fixed here.
- New E2E coverage for the `ArchivedTeamBanner` / Season Reports labeling (Step 9) — see Decision 4.
- New E2E coverage for `deleteGameSafe`/`deletePlayerSafe`'s archived-team rejection (Step 8) — see Decision 5.
- **Backend handler unit tests for `archive-team` and `restore-team`** (parent Phase 7 step 1) — genuinely still missing after this slice. Only `assign-team-owner` is picked up here (Major 1), because it's the handler whose condition expression this slice's whole ownership narrative is about; `archive-team`/`restore-team` coverage is deliberately left for the next slice rather than scope-creeping this one (see Decision 2 and Required Follow-Ups).

## Findings from reading the codebase

**Finding 1 — `archive-team` and `restore-team` still have zero automated backend test coverage; `assign-team-owner` now does, per this revision.** Confirmed by `Glob`: no `handler.test.ts` exists in `amplify/functions/archive-team/` or `amplify/functions/restore-team/` (compare with `amplify/functions/delete-game-safe/handler.test.ts`, `delete-player-safe/handler.test.ts`, `accept-invitation/handler.test.ts`, all of which exist and were extended in Step 8). Step 1's own "Risks and Edge Cases" flagged this explicitly ("Handler logic has no automated coverage in this slice... Parent Phase 7 step 1 is where these get real tests") and it was never picked up in Steps 5, 8, or 9. Architecture review Major 1 established that this is the higher-priority half of the gap for `assign-team-owner` specifically, because it's the only layer that can cheaply and deterministically prove the widened `assignTeamOwner` DynamoDB `ConditionExpression` (`(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)`) against constructed fixtures (owner present/absent/orphaned, concurrent claim, etc.) without any UI-reachability constraint (see Finding 2) — and, critically, because it runs on `npm run gate:commit`, unlike anything in `e2e/`. **This slice now fixes that half.** `archive-team`/`restore-team` coverage remains a genuine, still-open gap and the next slice's most valuable target (see Required Follow-Ups).

**Finding 2 — the literal "orphaned owner on an already-archived team" scenario (Step 1 Decision 5 / Step 5 Major 2's worked example) is not reachable through the shipped UI in a single continuous coach session.** Two facts combine to close off the path:
- Management's Sharing & Permissions team picker is filtered to `activeTeams` only (Step 5, Minor 7 — confirmed still current: `src/components/Management.tsx` ~line 2044, `activeTeams.map((team) => ...)` under `{!sharingResourceType && (...)}`). An archived team cannot be *selected* into the "Manage Sharing" panel.
- Once `sharingResourceId`/`sharingResourceType` state is set (i.e., the panel is already open for a team), the panel keeps rendering regardless of that team's later status (`src/components/Management.tsx` ~line 2068, gated only on local component state, not on `activeTeams` membership) — so `revokeCoachAccess` *can* technically still run against an already-archived team, but only if the panel was opened *before* archiving and is still mounted (no navigation away) when the archive happens elsewhere.
- Reproducing that specific ordering in Playwright would require two *simultaneously* authenticated sessions (two `BrowserContext`s) — Coach B's Sharing panel open in one context while Coach A archives in another. **Corrected in this revision (Minor 10):** this is not literally unprecedented plumbing for this suite — `e2e/auth.setup.ts` already writes a `.auth/user2.json` storage-state file (`setup('authenticate as user2', ...)`) that nothing currently consumes, so `browser.newContext({ storageState: '.auth/user2.json' })` alongside the existing `.auth/user1.json`-backed default context would be a small, low-plumbing addition — not a novel pattern requiring new infrastructure. The decision below to skip it stands purely on "not worth the added complexity and runtime for this slice," not on infeasibility.

**Decision (see Decision 2 below): test the reachable "revoke while active" variant instead**, which exercises the *identical* backend authorization logic. Confirmed from Step 5's own review (Major 2): `assignTeamOwner`'s Lambda "has no archived-status check... it works fine on an archived team today on the backend" — the condition is status-agnostic. The only thing the reachable variant doesn't exercise is which Management sub-tab (Active vs. Archived) the locked card renders under while stuck — and that filtering (`isTeamArchived`/`isTeamActive`) is already covered by this slice's own restore round-trip test (Part A item 2) and exhaustively by `src/utils/teamUtils.test.ts`. The literal archived+orphaned combination is now covered instead by the new `assign-team-owner/handler.test.ts` (Major 1), which has no UI-reachability constraint at all.

**Finding 3 — "Assign Owner" ships with a confirmation dialog, contradicting Step 5's plan text.** `TEAM-ARCHIVE-STEP5-FRONTEND-UX.md` states "No confirmation dialog for Assign Owner — low-risk, reversible-by-nature." The shipped code (`src/components/Management.tsx` `handleAssignTeamOwner`, ~line 430) does show one: `title: 'Assign Team Owner'`, `confirmText: 'Assign Owner'`, `variant: 'warning'`. This is a real, shipped deviation from the plan doc (not a bug — arguably an improvement, since ownership claims are one-way). The new E2E tests below are written against the actual shipped behavior (confirm required), not the stale plan text. No action item beyond noting it here and in the docs update; flagging so a future reader of Step 5 doesn't write a test against the wrong assumption. **Confirmed accurate by architecture review — unchanged.**

**Finding 4 — `TeamInvitation.role` still types `'OWNER'` as a valid value, but the invite UI never offers it.** `src/services/invitationService.ts` declares `export type InvitationRole = 'OWNER' | 'COACH' | 'PARENT'`, but `InvitationManagement.tsx`'s role `<select>` only renders `<option value="COACH">` and `<option value="PARENT">` — `'OWNER'` is unreachable through the running app. This predates the archive feature and is a pre-existing (not newly introduced) inconsistency, but it's directly relevant to documenting ownership rules accurately: a reader of the current `docs/SHARING-PERMISSIONS.md` Roles table could reasonably conclude that inviting someone with an "Owner" role transfers `Team.ownerId` — it does not, and cannot, since `Team.ownerId` is a wholly separate field from `TeamInvitation.role`, set only at team creation or via `assignTeamOwner`. Folded into the Part B docs update (Decision 3). **Confirmed accurate by architecture review — unchanged.**

**Finding 5 — Sharing & Permissions is only reachable for active teams, which is itself a real, previously-undocumented product constraint worth recording.** A coach cannot manage sharing (invite or revoke) for an already-archived team without first restoring it. This is a direct, load-bearing consequence of Step 5 Minor 7's filter and is exercised naturally by the new E2E flow (Coach A must restore before Coach B can reach the panel to revoke). Folded into the Part B docs update. **Confirmed accurate by architecture review — unchanged.**

**Finding 6 — team creation does not require selecting a formation.** `resolveFormationId` (`Management.tsx` ~line 91) treats an empty `selectedFormation` as `undefined`, and the existing, currently-green `e2e/team-management.spec.ts` smoke test creates a team with no formation selected at all. The new tests below follow that same, already-proven-reliable pattern rather than `team-sharing.spec.ts`'s more defensive (and here unnecessary) formation-selection block. **Confirmed accurate by architecture review — unchanged.**

## Decisions

### Decision 1: extend `e2e/team-management.spec.ts` for the round trip; new file for the ownership edge case

The restore round trip is single-user, lightweight, and a direct sibling of the existing archive/delete-permanently test in the same file — added as a second `test()` in the same `test.describe` block (with `test.describe.configure({ mode: 'serial' })`, matching the file's actual structure), no new file. The ownership/revoke/reclaim scenario is two-coach, invitation-flow-dependent, and matches the weight of `team-sharing.spec.ts` (which lives outside the `smoke` project) — given its own file, `e2e/team-archive-ownership.spec.ts`, so it naturally lands in the `full` Playwright project (not matched by `smoke`'s explicit `testMatch` whitelist, not excluded from `full`'s `testIgnore` — no `playwright.config.ts` change needed). **Approved as-is by architecture review — unchanged.**

### Decision 2: cover the orphaned-owner recovery flow via the "revoke while active" E2E variant plus a dedicated backend unit test, not a two-context "revoke while archived" E2E variant

Per Finding 2, the literal archived-team variant requires two concurrent authenticated sessions. As corrected in this revision (Minor 10), that's not infrastructurally unprecedented for this suite (`.auth/user2.json` already exists, unused) — it's simply not worth the added complexity and CI runtime for what it would additionally prove, given that the identical backend condition is already covered two other ways: (a) the reachable "revoke while active" E2E variant below, which exercises the same `assignTeamOwner` Lambda condition and the same `isTeamOwnershipAssigned`/`isTeamOwner` UI gating helpers (the backend doesn't distinguish archived from active — Step 5's own review already established this), and (b) the new `assign-team-owner/handler.test.ts` (Major 1), which exercises the literal archived+orphaned combination directly against the condition expression with zero UI-reachability constraint at all. The E2E test additionally archives and restores the team *after* the reclaim, so the full lifecycle is proven for a team whose ownership changed hands mid-flight, closing most of the practical gap. **Ultimate conclusion (test the reachable variant, don't build the two-context version) approved as-is by architecture review; only the supporting rationale above was corrected.**

### Decision 3: do not add a truly-ownerless-legacy-team test; the orphaned-owner test already exercises the same UI branch

Since `Management.tsx: handleCreateTeam` and `demoDataService.ts` always stamp `ownerId: currentUserId` at create time (Step 5), a genuinely never-owned team cannot be produced through the running app at all post-Correction-1 — only a pre-existing database row from before the archive feature could be in that state, which is not reproducible without direct DB manipulation (out of scope: "no new application code," and this suite has no raw-seeding infrastructure). `isTeamOwnershipAssigned(team)` returns `false` for both the never-owned case (`!team.ownerId`) and the orphaned case (`ownerId` set but not in `coaches`) through the exact same boolean check and the exact same JSX branch (`Management.tsx`, both the active- and archived-card blocks). The orphaned-owner test below is therefore the only UI-reachable way to exercise the "Owner Unassigned + Assign Owner" affordance end-to-end, and is judged sufficient — both truth values of the underlying helper are separately unit-tested in `src/utils/teamUtils.test.ts` already. **Corrected citation (Minor 10):** the stronger, more precise evidence for "the UI-layer branch is already covered" is `src/components/Management.teamLifecycle.test.tsx`'s `'archived card with an orphaned owner shows Owner Unassigned + Assign Owner (no Restore Team) and Delete Permanently; assigning reveals Restore Team'` test, which already exercises exactly this branch — including the `assignTeamOwner` call and the resulting "Restore Team" reveal — against the real component (not mocked). Cited here as the primary reason, rather than the weaker `teamUtils.test.ts`-only citation used originally. **Ultimate conclusion approved as-is by architecture review.**

### Decision 4: no new E2E coverage for the `ArchivedTeamBanner` / Season Reports archived-team labeling

Step 9 built parameterized unit coverage across all four `GameManagement` states (`GameManagement.test.tsx`'s `it.each(['scheduled', 'in-progress', 'halftime', 'completed'])`) plus dedicated `SeasonReport.test.tsx` and `SeasonReportRoute.test.tsx` cases, all against the real `ArchivedTeamBanner` component (not mocked). The banner is a pure visibility feature — it gates no mutation and introduces no authorization surface — so an E2E test would mostly re-prove routing/rendering already proven at the component level, at Playwright's much higher cost per assertion. This is exactly the class of coverage the task brief asks to *not* duplicate. **Not added. Approved as-is by architecture review.**

### Decision 5: no new E2E coverage for `deleteGameSafe`/`deletePlayerSafe`'s archived-team rejection

Step 8 added thorough handler-level tests for both guards (fail-open on missing team, legacy-no-status handling, positive/negative cases, dedup-by-team-id for the player guard) plus a manual sandbox smoke-test checklist that explicitly exercises the delete-rejection UI passthrough. These are authorization-adjacent (a real, previously-missing guard), which would ordinarily argue for E2E proof — but the mechanism (a delete Lambda rejecting based on a joined team's status) is structurally identical to, and no riskier than, the already-well-covered `deleteFormationSafe` reference-check pattern, and the UI passthrough fix was already required to be hand-verified in Step 8's own manual checklist. Given the task's explicit prioritization instruction, this is judged lower-value than the ownership recovery flow and the restore round trip, and is **not added** in this slice. Flagged as a reasonable candidate for a future slice if these guards prove to regress in practice. **Approved as-is by architecture review.**

## Part A — File-by-File Changes

### 0. `amplify/functions/assign-team-owner/handler.test.ts` (new file) — Major 1

Follows `amplify/functions/accept-invitation/handler.test.ts`'s established mocking convention (`vi.mock('@aws-sdk/client-dynamodb'/'@aws-sdk/lib-dynamodb'/'@aws-sdk/util-dynamodb')`, a typed `invokeHandler` wrapper, `mockSend.mockImplementation` dispatching on `command.__type`). Scoped narrowly to `assignTeamOwner`'s `ConditionExpression` (`(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)`) — five cases, matching architecture review Major 1 exactly, no more:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

// Identity pass-through, matching accept-invitation/handler.test.ts's convention: lets
// tests hand plain-JS objects as the ConditionalCheckFailedException's `Item` directly.
vi.mock('@aws-sdk/util-dynamodb', () => ({
  unmarshall: vi.fn((item) => item),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

function invokeHandler(event: HandlerEvent) {
  const context = {} as HandlerContext;
  const callback: HandlerCallback = () => undefined;
  return handler(event, context, callback);
}

function callerEvent(teamId: string, callerSub: string): HandlerEvent {
  return {
    arguments: { teamId },
    identity: { sub: callerSub },
  } as HandlerEvent;
}

function conditionalCheckFailure(item: Record<string, unknown>) {
  const error = new Error('ConditionalCheckFailedException') as Error & { name: string; Item: unknown };
  error.name = 'ConditionalCheckFailedException';
  error.Item = item; // mocked unmarshall() above is an identity pass-through
  return error;
}

describe('assign-team-owner handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAM_TABLE = 'TeamTable';
  });

  it('claims a never-owned team for a coach on it (attribute_not_exists(ownerId) branch)', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', coaches: ['caller-sub'] } }); // no ownerId at all
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { id: 'team-1', ownerId: 'caller-sub', coaches: ['caller-sub'] } });
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    const result = await invokeHandler(callerEvent('team-1', 'caller-sub'));
    expect(result).toMatchObject({ ownerId: 'caller-sub' });
  });

  it('claims an orphaned-owner team — ownerId set but that owner is no longer in coaches (the archived+orphaned combination the E2E spec structurally cannot reach)', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', ownerId: 'revoked-owner', coaches: ['caller-sub'] } });
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { id: 'team-1', ownerId: 'caller-sub', coaches: ['caller-sub'] } });
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    const result = await invokeHandler(callerEvent('team-1', 'caller-sub'));
    expect(result).toMatchObject({ ownerId: 'caller-sub' });
  });

  it('rejects when a valid owner is already present and still in coaches', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', ownerId: 'existing-owner', coaches: ['existing-owner', 'caller-sub'] } });
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.reject(conditionalCheckFailure({ id: 'team-1', ownerId: 'existing-owner', coaches: ['existing-owner', 'caller-sub'] }));
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    await expect(invokeHandler(callerEvent('team-1', 'caller-sub'))).rejects.toThrow('Team already has an owner');
  });

  it('rejects a caller who is not in coaches, before ever attempting the write', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', coaches: ['someone-else'] } });
      }
      throw new Error('UpdateCommand should not be attempted when the JS pre-check fails');
    });

    await expect(invokeHandler(callerEvent('team-1', 'caller-sub')))
      .rejects.toThrow('Access denied: caller is not a coach on this team');
  });

  it('rejects the loser of a concurrent claim race even though it passed the JS pre-check', async () => {
    // Caller IS in `coaches` at GetCommand time (passes the pre-check), but a second,
    // concurrent caller's UpdateCommand won the DynamoDB conditional write first —
    // simulated via the ReturnValuesOnConditionCheckFailure payload already showing a
    // valid owner. This is the TOCTOU window the write-time `contains(coaches, :callerSub)`
    // clause exists to close, distinct from the JS pre-check case above.
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', coaches: ['caller-sub', 'winner-sub'] } });
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.reject(conditionalCheckFailure({ id: 'team-1', ownerId: 'winner-sub', coaches: ['caller-sub', 'winner-sub'] }));
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    await expect(invokeHandler(callerEvent('team-1', 'caller-sub'))).rejects.toThrow('Team already has an owner');
  });
});
```

Runs under `npm run test:run` (and therefore `npm run gate:commit`). No mock changes needed for `archive-team`/`restore-team` — those remain untouched and uncovered, per Decision 2 and the Explicitly-out-of-scope list.

### 1. `e2e/helpers.ts` — extract shared `logout` helper (Minor 5)

`e2e/team-sharing.spec.ts` currently defines a local `logout(page: Page)` helper (sign out via Profile tab, tolerant of it not being visible). The original draft of this plan copied that same function verbatim into the new ownership spec. Instead, add it once to `e2e/helpers.ts` and import it:

```ts
/**
 * Sign out via the Profile tab, if currently signed in. Tolerant of already
 * being signed out. Most call sites don't need this before `loginUser` — that
 * helper already signs out any existing session as part of logging in — this
 * is only needed when the next step is *not* an immediate `loginUser` call
 * (e.g., navigating to an unauthenticated `/invite/:id` link).
 */
export async function logout(page: Page) {
  const profileTab = page.getByRole('link', { name: /profile/i });
  if (await profileTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await profileTab.click();
    await page.waitForTimeout(500);
  }
  const signOutButton = page.getByRole('button', { name: /sign out/i });
  if (await signOutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await signOutButton.click();
    await waitForPageLoad(page);
  }
}
```

`e2e/team-sharing.spec.ts`'s local copy is left as-is (pre-existing, currently-green file; migrating it to the shared helper is optional cleanup, not required by this slice — noted here so it isn't mistaken for an oversight).

### 2. `e2e/team-management.spec.ts` — new test, same `test.describe` block

Add `waitForPageLoad` and `Page` (for a small local polling helper) to the existing helpers/Playwright imports. The real file (confirmed by reading it) uses `test.describe('Team Management Smoke', () => { test.describe.configure({ mode: 'serial' }); test.beforeEach(...) ... })`, **not** `describe.serial` — the new test is a second `test()` inside that same block, and already inherits `test.setTimeout(TEST_CONFIG.timeout.long)` from the existing `beforeEach`, so it needs no timeout call of its own.

Per Major 2, none of the three dropdown checks can safely poll the existing DOM — `archiveTeam`/`restoreTeam` write via the DynamoDB SDK directly and never trigger an AppSync subscription, so `Home.tsx`'s `observeQuery`-backed team list can be frozen on stale data indefinitely. Each check below does a fresh `page.goto('/')` + re-open of the Schedule Game form on every poll attempt, via a small local helper:

```ts
import { test, expect, Page } from '@playwright/test';
import {
  clickButton,
  clickConfirmModalCancel,
  clickConfirmModalConfirm,
  clickManagementTab,
  cleanupTestData,
  fillInput,
  navigateToApp,
  navigateToManagement,
  waitForPageLoad, // new
  UI_TIMING,
} from './helpers';
import { TEST_CONFIG } from '../test-config';

// ... existing describe/configure/beforeEach/first test unchanged ...

/**
 * Polls whether `teamName` appears in the Schedule Game team dropdown,
 * performing a fresh page load + form re-open on every attempt (not just a
 * re-read of the existing DOM). Required because `archiveTeam`/`restoreTeam`
 * write via the DynamoDB SDK directly and never trigger an AppSync
 * subscription (Step 1/Step 9), so a stale first read has no recovery path
 * other than a genuinely fresh query.
 */
async function pollScheduleDropdownForTeam(page: Page, teamName: string, expected: boolean) {
  await expect.poll(async () => {
    await page.goto('/');
    await waitForPageLoad(page);

    const scheduleButton = page.getByRole('button', { name: /\+\s*Schedule New Game/i }).first();
    await scheduleButton.click();
    const teamSelect = page.locator('.create-form select').first();
    let formVisible = await teamSelect.isVisible({ timeout: 2500 }).catch(() => false);
    if (!formVisible) {
      // Guard pattern borrowed from e2e/team-sharing.spec.ts: the schedule
      // form occasionally doesn't open on the first click.
      console.warn('Schedule form did not open on first try; retrying once');
      await scheduleButton.click();
      formVisible = await teamSelect.isVisible({ timeout: 2500 }).catch(() => false);
    }
    if (!formVisible) {
      return null; // will not equal `expected`; poll retries
    }

    const options = await teamSelect.locator('option').allTextContents();
    return options.some((o) => o.includes(teamName));
  }, {
    timeout: 15000,
    message: `Schedule Game dropdown should ${expected ? '' : 'not '}contain "${teamName}"`,
  }).toBe(expected);
}

test('archives and restores a team, verifying it is excluded from and re-included in the Schedule Game dropdown', async ({ page }) => {
  const teamName = `Restore Smoke Team ${Date.now()}`;

  // No leading cleanupTestData() call (Minor 11): the preceding test in this
  // same serial block already cleans up, and this team's name is
  // timestamp-unique, so a redundant sweep here only costs smoke-lane budget.
  await navigateToApp(page);
  await navigateToManagement(page);

  await clickManagementTab(page, 'Teams');
  await clickButton(page, '+ Create New Team');
  await fillInput(page, 'input[placeholder*="team name"]', teamName);
  await fillInput(page, 'input[placeholder*="max players"]', '7');
  await fillInput(page, 'input[placeholder*="half length"]', '25');
  await clickButton(page, 'Create');
  await expect(page.locator('.item-card').filter({ hasText: teamName })).toBeVisible();

  // Owner is stamped implicitly at create time (Correction 1): Archive is
  // visible, no "Owner Unassigned" pill.
  const activeCard = page.locator('.team-card-wrapper').filter({ hasText: teamName });
  await expect(activeCard.getByRole('button', { name: 'Archive' })).toBeVisible();
  await expect(activeCard.getByText('Owner Unassigned')).not.toBeVisible();

  // Sanity: present in the Schedule Game dropdown while active. (Team.create
  // is a normal AppSync mutation and *does* trigger a subscription push, so
  // this check would likely pass without the reload-poll treatment too — but
  // it's applied uniformly across all three checks for consistency.)
  await pollScheduleDropdownForTeam(page, teamName, true);

  // Archive, then confirm exclusion from the dropdown.
  await navigateToManagement(page);
  await clickManagementTab(page, 'Teams');
  await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
  await clickConfirmModalConfirm(page);
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).not.toBeVisible();

  await pollScheduleDropdownForTeam(page, teamName, false);

  // Restore, then confirm reappearance in Active Teams and the dropdown.
  await navigateToManagement(page);
  await clickManagementTab(page, 'Teams');
  await page.getByRole('button', { name: /Archived Teams/ }).click();
  const archivedCard = page.locator('.team-card-wrapper').filter({ hasText: teamName });
  await expect(archivedCard.getByRole('button', { name: 'Restore Team' })).toBeVisible();
  await archivedCard.getByRole('button', { name: 'Restore Team' }).click();
  await clickConfirmModalConfirm(page);
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  await page.getByRole('button', { name: /Active Teams/ }).click();
  await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).toBeVisible();

  await pollScheduleDropdownForTeam(page, teamName, true);

  // Cleanup: archive + delete permanently (matches the existing test's pattern).
  await navigateToManagement(page);
  await clickManagementTab(page, 'Teams');
  await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
  await clickConfirmModalConfirm(page);
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  await page.getByRole('button', { name: /Archived Teams/ }).click();
  await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Delete team permanently' }).click();
  await clickConfirmModalConfirm(page);
  await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
  await expect(page.locator('.item-card').filter({ hasText: teamName })).not.toBeVisible();
});
```

Runs under `npm run test:e2e:smoke` (file already whitelisted in `playwright.config.ts`'s `smoke` project).

### 3. `e2e/team-archive-ownership.spec.ts` (new file, `full` project)

Follows `team-sharing.spec.ts`'s conventions: `test.describe.serial`, the now-shared `logout` helper (item 1 above), `TEST_USERS`, `TEST_CONFIG.timeout.long`, invitation-link extraction via `.invitation-item .invitation-link[data-invitation-id]`.

Per Minor 5, `logout()` is only called where the next step is *not* an immediate `loginUser(...)` call — `loginUser` already signs out any existing session internally, so `logout(); loginUser();` pairs are dropped throughout. Per Major 2, the one assertion reading Lambda-written state without an intervening `loginUser` (Coach B's archived-card visibility check) uses a reload-based poll. Per Minor 6, a `.permission-item` count guard precedes the revoke click. Per Minor 7, an `afterAll` sweep guards against a mid-sequence failure orphaning the team. Per Minor 8, invitation-expiry-on-archive gets its own assertion (folded into test 1, next to the existing archive step, rather than left untested). Per Major 4, an optional assertion after the revoke step confirms Coach A loses `Team` visibility, with a comment noting child records are not swept.

```ts
import { test, expect, Page } from '@playwright/test';
import {
  clickButton,
  clickButtonByText,
  clickConfirmModalConfirm,
  clickManagementTab,
  fillInput,
  logout, // new shared helper (item 1)
  loginUser,
  navigateToManagement,
  waitForPageLoad,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

const TEST_RUN_SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const TEAM_NAME = `Ownership Lockout FC ${TEST_RUN_SUFFIX}`;
const THROWAWAY_INVITE_EMAIL = `throwaway-${TEST_RUN_SUFFIX}@example.com`;

/**
 * Polls whether TEAM_NAME's archived card is visible for the current user,
 * reloading and re-navigating on every attempt (not just re-reading the
 * existing DOM). Required for the same reason as
 * team-management.spec.ts's pollScheduleDropdownForTeam (Major 2).
 */
async function pollArchivedCardVisible(page: Page, teamName: string) {
  await expect.poll(async () => {
    await page.reload();
    await waitForPageLoad(page);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    const card = page.locator('.team-card-wrapper').filter({ hasText: teamName });
    return card.locator('.item-card.archived').isVisible().catch(() => false);
  }, {
    timeout: 15000,
    message: `Archived state for "${teamName}" should sync for the current user`,
  }).toBe(true);
}

test.describe.serial('Team archive ownership edge cases', () => {
  let invitationId = '';

  test('Coach A creates and shares a team; Coach B sees correct active/archived visibility; a pending invitation expires on archive', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);

    // --- Coach A: create + invite ---
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await clickButton(page, '+ Create New Team');
    await fillInput(page, 'input[placeholder*="team name"]', TEAM_NAME);
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');
    await clickButton(page, 'Create');
    await expect(page.locator('.item-card').filter({ hasText: TEAM_NAME })).toBeVisible({ timeout: 30000 });

    await clickManagementTab(page, 'Sharing');
    const manageSharingButton = page.locator('.resource-item')
      .filter({ has: page.getByText(TEAM_NAME, { exact: true }) })
      .first()
      .getByRole('button', { name: /manage sharing/i });
    await manageSharingButton.click();
    await fillInput(page, 'input[type="email"]', TEST_USERS.user2.email);
    await clickButtonByText(page, /send invitation/i);
    await expect(page.locator('.sharing-section, .invitations-list')).toContainText(TEST_USERS.user2.email, { timeout: 5000 });

    const invitationItem = page.locator('.invitation-item').filter({ hasText: TEST_USERS.user2.email }).first();
    invitationId = (await invitationItem.locator('.invitation-link').first().getAttribute('data-invitation-id')) ?? '';
    expect(invitationId).toBeTruthy();

    // logout() (not loginUser()) is required here: the next step navigates to
    // an unauthenticated /invite/:id link and does its own inline login, not
    // via the loginUser() helper.
    await logout(page);

    // --- Coach B: accept ---
    await page.goto(`/invite/${invitationId}`);
    await waitForPageLoad(page);
    const loginButton = page.getByRole('banner').getByRole('button', { name: 'Log In' });
    if (await loginButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loginButton.click();
      await waitForPageLoad(page);
    }
    const emailInput = page.locator('input[name="username"], input[type="email"]');
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await fillInput(page, 'input[name="username"], input[type="email"]', TEST_USERS.user2.email);
      await fillInput(page, 'input[name="password"], input[type="password"]', TEST_USERS.user2.password);
      await clickButton(page, 'Sign in');
      await waitForPageLoad(page);
      await page.goto(`/invite/${invitationId}`);
      await waitForPageLoad(page);
    }
    await page.getByRole('button', { name: /accept/i }).click();
    await expect(page.getByText(/Successfully joined/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(3000);
    await waitForPageLoad(page);

    // Coach B, non-owner: active card shows neither Archive nor Owner Unassigned.
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    const sharedCard = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(sharedCard).toBeVisible({ timeout: 20000 });
    await expect(sharedCard.getByRole('button', { name: 'Archive' })).not.toBeVisible();
    await expect(sharedCard.getByText('Owner Unassigned')).not.toBeVisible();

    // --- Coach A: send a throwaway invitation, then archive; the throwaway
    // invitation should be expired (removed from Pending Invitations) as a
    // side effect of archiving (Minor 8 — previously untested). loginUser()
    // signs out Coach B's session itself; no explicit logout() needed.
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Sharing');
    const manageSharingButtonForExpiry = page.locator('.resource-item')
      .filter({ has: page.getByText(TEAM_NAME, { exact: true }) })
      .first()
      .getByRole('button', { name: /manage sharing/i });
    await manageSharingButtonForExpiry.click();
    await fillInput(page, 'input[type="email"]', THROWAWAY_INVITE_EMAIL);
    await clickButtonByText(page, /send invitation/i);
    await expect(page.locator('.invitations-list')).toContainText(THROWAWAY_INVITE_EMAIL, { timeout: 5000 });

    await clickManagementTab(page, 'Teams');
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Re-enter the Sharing tab rather than re-selecting the team from its
    // picker: sharingResourceId/sharingResourceType are Management-level
    // state (Finding 2), so switching tabs and back re-renders the same
    // already-open panel directly, skipping the (now active-teams-only,
    // archived-team-excluding) picker entirely — this is what makes the
    // check below possible at all post-archive. It also, incidentally,
    // remounts <InvitationManagement>, which re-runs its `useAmplifyQuery`
    // hook and issues a genuinely fresh query rather than relying on a
    // subscription push — necessary because archiveTeam's TeamInvitation
    // expiry write goes through the DynamoDB SDK directly and, like the
    // other lifecycle Lambdas, never triggers an AppSync subscription
    // (Major 2's staleness concern, satisfied here via remount instead of
    // a page reload).
    await clickManagementTab(page, 'Sharing');
    await expect(page.locator('.invitations-list')).not.toContainText(THROWAWAY_INVITE_EMAIL, { timeout: 10000 });

    // --- Coach B, re-entering after a full logout/login (no live subscription
    // for lifecycle Lambdas, per Step 1/Step 9): sees the archived state
    // correctly, cannot Restore (not owner), can still Delete Permanently.
    // This is the one assertion in this test that reads Lambda-written state
    // without an intervening fresh loginUser() call producing a fresh page
    // load on its own — pollArchivedCardVisible reloads/re-navigates on every
    // attempt rather than re-reading a DOM snapshot that can never change if
    // stale (Major 2). ---
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await pollArchivedCardVisible(page, TEAM_NAME);
    const archivedForCoachB = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(archivedForCoachB.getByRole('button', { name: 'Restore Team' })).not.toBeVisible();
    await expect(archivedForCoachB.getByRole('button', { name: 'Delete team permanently' })).toBeVisible();
  });

  test('Coach A restores; Coach B revokes Coach A, reclaims ownership, and completes an archive/restore round trip', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);

    // Sharing & Permissions only lists active teams (Step 5, Minor 7) — Coach A
    // must restore before Coach B can reach "Manage Sharing" to revoke at all.
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Restore Team' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Coach B revokes Coach A's (the owner's) access.
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Sharing');
    const manageSharingButtonB = page.locator('.resource-item')
      .filter({ has: page.getByText(TEAM_NAME, { exact: true }) })
      .first()
      .getByRole('button', { name: /manage sharing/i });
    await manageSharingButtonB.click();

    // Minor 6: guard against ever clicking "Remove" on the wrong coach if the
    // permission list ever contains more than the expected single entry
    // (Coach A — the current user, Coach B, is filtered out of this list by
    // InvitationManagement.tsx).
    await expect(page.locator('.permission-item')).toHaveCount(1);
    const removeCoachA = page.locator('.permission-item').first().getByRole('button', { name: 'Remove' });
    await expect(removeCoachA).toBeVisible({ timeout: 10000 });
    await removeCoachA.click();
    await clickConfirmModalConfirm(page); // 'Revoke Access' confirm
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Major 4 (optional, cheap): confirm the revoked coach actually loses
    // Team visibility. NOTE — this only proves Team-level revocation.
    // revokeCoachAccess (src/services/invitationService.ts) removes the user
    // from Team.coaches only; it does NOT cascade to the coaches arrays on
    // TeamRoster/Player/Game/Formation/FormationPosition that accept-invitation
    // backfilled when Coach A originally joined. Those child records are NOT
    // swept by this test (or by the app) — see docs/SHARING-PERMISSIONS.md's
    // Known Residual Risks and this plan's Required Follow-Ups.
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await expect(page.locator('.item-card').filter({ hasText: TEAM_NAME })).not.toBeVisible({ timeout: 10000 });

    // Coach B reclaims ownership.
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    const lockedCard = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(lockedCard.getByText('Owner Unassigned')).toBeVisible({ timeout: 15000 });
    await expect(lockedCard.getByRole('button', { name: 'Archive' })).not.toBeVisible();

    await lockedCard.getByRole('button', { name: 'Assign Owner' }).click();
    await clickConfirmModalConfirm(page); // 'Assign Team Owner' confirm
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(lockedCard.getByText('Owner Unassigned')).not.toBeVisible();
    await expect(lockedCard.getByRole('button', { name: 'Archive' })).toBeVisible({ timeout: 10000 });

    // Proves the reclaim is a *real* ownership transfer, not just a UI flag:
    // Coach B (the new owner) can now archive and restore the team.
    await lockedCard.getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    const archivedByCoachB = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(archivedByCoachB.getByRole('button', { name: 'Restore Team' })).toBeVisible();
    await archivedByCoachB.getByRole('button', { name: 'Restore Team' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Active Teams/ }).click();
    await expect(page.locator('.item-card:not(.archived)').filter({ hasText: TEAM_NAME })).toBeVisible();

    // Cleanup.
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Delete team permanently' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: TEAM_NAME })).not.toBeVisible();
  });

  // Minor 7: stale-data safety net. If the revoke step (test 2) succeeds but a
  // later step in the same test fails, the team could be left orphaned on
  // Coach B and unreachable from Coach A's own cleanup sweeps in other specs.
  // Runs as Coach B specifically, matching e2e/team-sharing.spec.ts's
  // stale-team-sweep convention: Coach B is guaranteed to still be a coach on
  // the team even if the reclaim step never completed (Coach A may be
  // permanently locked out post-revoke), so cleanup must not assume Coach A
  // still has access.
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
      await navigateToManagement(page);
      await clickManagementTab(page, 'Teams');

      const activeStale = page.locator('.team-card-wrapper').filter({ hasText: /Ownership Lockout FC/ });
      let activeCount = await activeStale.count();
      while (activeCount > 0) {
        const archiveButton = activeStale.first().getByRole('button', { name: 'Archive' });
        if (!(await archiveButton.isVisible({ timeout: 1000 }).catch(() => false))) break;
        await archiveButton.click();
        await clickConfirmModalConfirm(page);
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
        const newCount = await page.locator('.team-card-wrapper').filter({ hasText: /Ownership Lockout FC/ }).count();
        if (newCount === activeCount) break;
        activeCount = newCount;
      }

      await page.getByRole('button', { name: /Archived Teams/ }).click().catch(() => {});
      let archivedStale = await page.locator('.team-card-wrapper').filter({ hasText: /Ownership Lockout FC/ }).count();
      while (archivedStale > 0) {
        await page.locator('.team-card-wrapper').filter({ hasText: /Ownership Lockout FC/ }).first()
          .getByRole('button', { name: 'Delete team permanently' }).click();
        await clickConfirmModalConfirm(page);
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
        const newCount = await page.locator('.team-card-wrapper').filter({ hasText: /Ownership Lockout FC/ }).count();
        if (newCount === archivedStale) break;
        archivedStale = newCount;
      }
    } finally {
      await context.close();
    }
  });
});
```

No `playwright.config.ts` change: the new file is not matched by `smoke`'s explicit `testMatch` whitelist and is not listed in `full`'s `testIgnore`, so it runs under `full` (i.e., `npm run test:e2e`) automatically.

## Part B — `docs/SHARING-PERMISSIONS.md` Diff Outline

Section-by-section; full prose is implementation work, not planning. **Per Major 3/4, this section now describes corrections to existing content, not just additions** — items 1, 3, and 4 below each include an explicit "Correct existing text" instruction, not only new material.

1. **Roles table (existing, ~line 9)** — add a footnote/sentence directly under the table: `OWNER` in this table (and in `TeamInvitation.role`) is a legacy invitation-role label, not the same thing as `Team.ownerId`. The invite UI (`InvitationManagement.tsx`) only ever offers `COACH`/`PARENT` — `OWNER` is not reachable via invitation and does not transfer team ownership. (Finding 4.)

2. **New section, inserted after "How the Authorization Model Works" and before "What Shared Users Can See": `## Team Lifecycle: Ownership, Archive, and Restore`.**
   - **Ownership (`Team.ownerId`).** Field-level authorization: coaches get `create` + `read` only (`amplify/data/resource.ts`), no `update` — ownership can be stamped once at team creation (`Management.tsx: handleCreateTeam`, `src/services/demoDataService.ts`) or claimed via the `assignTeamOwner` mutation; it can never change through a plain `Team.update()` call.
   - **Claiming an unowned or orphaned team.** `assignTeamOwner` (`amplify/functions/assign-team-owner/handler.ts`) is first-come-first-served among the team's current `coaches`, resolved by a conditional DynamoDB write: `(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)`. The second clause exists because `revokeCoachAccess` (`src/services/invitationService.ts`) has no owner guard — any coach can revoke any other coach, including the current owner — so an owner can become "orphaned" (still recorded as `ownerId`, no longer in `coaches`). Without this clause, an orphaned team could never be archived, restored, or reclaimed by anyone. **Named, accepted tradeoff:** this also means a co-coach can revoke the owner and immediately self-claim ownership — availability is chosen over hijack-resistance for this trusted, multi-coach context (see `docs/plans/TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md`, Decision 5, for the full reasoning). Automated coverage: `amplify/functions/assign-team-owner/handler.test.ts` (added in Step 10) exercises this condition directly, including the never-owned, orphaned-owner, valid-owner-present, non-coach-caller, and concurrent-claim-race cases.
   - **Archive/restore are owner-only, Lambda-backed operations.** `archiveTeam`/`restoreTeam` (`amplify/functions/archive-team/`, `amplify/functions/restore-team/`) verify `team.ownerId === callerSub` and that the caller is still in `coaches`. Archiving sets `status: 'archived'`, `archivedAt`, `archivedBy`, and expires every `PENDING` `TeamInvitation` for the team (the sweep runs on every call, including idempotent no-ops, so a retried or raced call always catches stragglers). Restoring sets `status: 'active'` and **clears** `archivedAt`/`archivedBy` (`REMOVE`, not retained) — they're only meaningful while archived; a stale value on an active team would mislead. There is no separate audit-history log today; if archive history is wanted later, add append-only records rather than retaining last-archive fields.
   - **Invitations do not survive archiving.** Pending invitations expire on archive and are **not** revived on restore — resend if needed. (E2E-covered as of Step 10 — see `e2e/team-archive-ownership.spec.ts`.)
   - **Legacy teams have no `status` attribute at all.** `.default('active')` only applies to newly created rows; nothing backfills existing ones. Every consumer must go through `isTeamArchived`/`isTeamActive` (`src/utils/teamUtils.ts`), never a direct `status ===`/`!==` comparison.
   - **Sharing & Permissions is reachable for active teams only.** The team picker in `Management.tsx`'s Sharing tab is filtered to active teams — a coach must restore an archived team before they can invite or revoke access on it. (Finding 5.)
   - **Archived teams remain fully readable.** Child records (games, roster, players, formations) are untouched by archiving; reports and historical game views keep working (see the Security Model update below for what's actually blocked).

3. **Permission Capabilities table (existing, ~line 52) — correct two existing rows and add two new ones.**
   - **Correct existing text:** the current "Delete team | OWNER ✅ | COACH ❌ | PARENT ❌" row is factually wrong — `deleteTeamSafe` (`amplify/functions/delete-team-safe/handler.ts`) performs no owner check (any coach on the team may call it), and `Management.tsx` renders "Delete Permanently" unconditionally on archived-team cards for any coach (`Management.tsx` ~line 1627–1634, no `isTeamOwner` gate, unlike the adjacent `Restore Team` button at ~line 1606 which *is* gated). Rename the row to **"Delete team permanently (Archived Teams tab)"** and correct COACH to ✅.
   - **Correct existing text:** the current "Send invitations | OWNER ✅ | COACH ❌ | PARENT ❌" row is also wrong — neither the Sharing tab's team picker (`Management.tsx` ~line 2044) nor `InvitationManagement.tsx`'s send/revoke actions are gated by ownership; any coach in `activeTeams` can reach "Manage Sharing" and send or revoke invitations. Rename the row to **"Send / revoke invitations (Manage Sharing)"** and correct COACH to ✅.
   - **New rows** (from the original draft, unchanged):
     | Action | OWNER | COACH | PARENT |
     |---|---|---|---|
     | Archive / Restore team | ✅ | ❌ | ❌ |
     | Claim ownership of an unowned/orphaned team | ✅ (any current coach) | ✅ (any current coach) | ❌ |

4. **Security Model section (existing, ~line 121) — rewrite "Backend-enforced" / "UI-only" lists to match Step 8's actual shipped split, and correct one existing sentence:**
   - **Correct existing text:** the current sentence "The `accept-invitation` Lambda is the only path to add a new user to a team (direct writes to `coaches` are blocked by the authorization rule for non-owners)" is only half true and must be rewritten. `accept-invitation` genuinely is the only path to *add* a coach — its elevated IAM role exists precisely because the invitee isn't yet in `coaches` at accept time, so the standard model-level grant would reject a client-side write. But *removing* a coach is different: `revokeCoachAccess` (`src/services/invitationService.ts`) performs a plain client-side `Team.update({ coaches: updatedCoaches })`, and `coaches` carries **no** field-level lockdown in `amplify/data/resource.ts` (only `ownerId`/`status`/`archivedAt`/`archivedBy` are locked down there) — any existing coach can call it directly against any team they're on, including to revoke the owner. There is no server-side guard against that today (see Known residual risks below and Required Follow-Ups).
   - **Backend-enforced:**
     - Authentication (Cognito), `coaches`-array scoping (unchanged).
     - Team lifecycle fields (`ownerId`, `status`, `archivedAt`, `archivedBy`) — field-level lockdown, writable only via `archiveTeam`/`restoreTeam`/`assignTeamOwner`.
     - `deleteGameSafe` (`amplify/functions/delete-game-safe/handler.ts`) — rejects deleting a game whose team is archived.
     - `deletePlayerSafe` (`amplify/functions/delete-player-safe/handler.ts`) — rejects deleting a player with roster history on any archived team.
     - `accept-invitation` (`amplify/functions/accept-invitation/handler.ts`) — atomic `TransactWriteCommand` across `TeamInvitation` + `Team`; rejects accepting into an archived team with no partial state possible; the only path to *add* a coach to `coaches` (see correction above).
   - **Deliberately not archived-team-guarded (documented exceptions, not oversights):**
     - `deleteTeamSafe` (`amplify/functions/delete-team-safe/handler.ts`) — must stay unguarded; it's also the rollback/cleanup path for demo-team seeding and removal (`src/services/demoDataService.ts`), which always targets active teams. The Management UI's "Delete Permanently" being reachable only from the Archived Teams view is a UI restriction, not a backend one, and (per the corrected table above) is not owner-gated either.
     - `deleteFormationSafe` (`amplify/functions/delete-formation-safe/handler.ts`) — the existing "referenced by any team" check already subsumes an archived-team check; a Formation isn't scoped to one team.
   - **UI-only enforced (no server-side backstop — explicit, accepted residual risk):**
     - Game creation, until Phase 8's `Game.create` Lambda conversion lands (still not done). Archived teams are filtered from the Schedule Game dropdown (`src/components/Home.tsx`) with a defensive client-side re-check in `handleCreateGame`, but a raw GraphQL call is not blocked.
     - Deep in-game mutations: lineup, rotation, substitutions, goals, notes, availability, roster/player edits — no team-status check anywhere in these resolvers.
     - Since Step 9, every surface showing archived-team data displays a persistent read-only banner (`src/components/shared/ArchivedTeamBanner.tsx`, mounted in Season Reports and `GameManagement.tsx`) — visibility only, not enforcement; no `aria-disabled` treatment exists yet on any control.
     - Removing a coach: `revokeCoachAccess` (see Known residual risks below).
   - **Known residual risks (record permanently — moved out of plan-doc-only status):**
     - `deletePlayerSafe` can disclose the *name* of an archived team the deleting coach doesn't otherwise have visibility into, when a player is rostered on two teams and only one is shared with that coach — pre-existing `Player.coaches` union behavior, first surfaced as literal team-name disclosure by Step 8's new guard. Low priority, tracked, not fixed.
     - The archived-team read-only banner and the Management team-card lifecycle badges can be stale for a coach mid-session: `archiveTeam`/`restoreTeam`/`assignTeamOwner` write via the DynamoDB SDK directly and never trigger an AppSync subscription event, so a co-coach already viewing the affected team/game won't see the change until they leave and re-enter. `Management.tsx` has a component-local workaround (`teamLifecycleOverrides`, self-reconciling against the next list refetch); `GameManagement.tsx`'s banner has no equivalent.
     - **New (Major 4): `revokeCoachAccess` does not cascade to child records.** It removes the revoked user from `Team.coaches` only. `accept-invitation`'s backfill adds `coaches` across `TeamRoster`, `Player`, `Game`, `Formation`, and `FormationPosition` when a coach joins — nothing reverses that when they're revoked. `Home.tsx` queries `Game` with no team filter, so a revoked coach keeps seeing that team's games and, via the still-present `Game.coaches` entry, retains write access to lineups, substitutions, goals, and play-time records indefinitely after "revocation." Revocation today reliably blocks only the `Team` record itself (Management → Teams) and further Sharing-tab actions — it is not a complete access-removal operation. Tracked; not fixed in this slice (see Required Follow-Ups).
     - **New (Major 4 / carried forward from Step 1): `revokeCoachAccess` has no server-side guard against revoking the team's current owner.** Any coach — not just the owner — can revoke any other coach, including the owner, producing the orphaned-owner state this whole Team Lifecycle section describes. `TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md`'s Required Follow-Ups (#7) already named this as a needed fix; it remains open. A client-side check alone would not be sufficient, since `coaches` is a plain client-writable model field — the fix needs a server-side home (its own Lambda-backed mutation, mirroring `assignTeamOwner`, or a condition expression on the field).

5. **Troubleshooting section (existing, ~line 136)** — add one entry: *"Archived team missing from Sharing & Permissions"* — expected; restore it first, invitations/revocation are only manageable for active teams.

## What's Deliberately NOT Being Added to E2E Coverage, and Why

| Candidate | Already covered | Why not added here |
|---|---|---|
| `ArchivedTeamBanner` on Season Reports / all 4 `GameManagement` states | Unit-tested exhaustively, real component, all states parameterized (Step 9) | Pure visibility, no auth surface — Decision 4 |
| `deleteGameSafe`/`deletePlayerSafe` archived-team rejection | Handler-level tests + manual sandbox checklist (Step 8) | Structurally identical risk profile to already-covered `deleteFormationSafe`; lower priority than the ownership recovery flow — Decision 5 |
| Truly ownerless (never-owned) legacy team | Not reproducible via the running UI at all post-Correction-1 | Same UI branch as the orphaned-owner case, which *is* covered — Decision 3 (see `Management.teamLifecycle.test.tsx` citation) |
| "Revoke while archived" (the literal Step 1/5 worked example) | Covered instead by `amplify/functions/assign-team-owner/handler.test.ts`'s orphaned-owner case (Major 1) | The literal combination requires two concurrent authenticated sessions to reproduce via E2E — feasible in principle (`.auth/user2.json` already exists), just not worth the added complexity given the backend condition it would exercise is already covered by a unit test with no UI-reachability constraint — Decision 2 |
| `archive-team`/`restore-team` backend unit tests (parent Phase 7 step 1) | Not covered anywhere | Genuinely still out of scope for this slice — `assign-team-owner` was the one handler whose condition this slice's E2E work was specifically worried about (Major 1); `archive-team`/`restore-team` remain the next slice's most valuable target (Required Follow-Ups) |

## Verification Checklist

1. `npx vitest run amplify/functions/assign-team-owner/handler.test.ts` — all five cases pass.
2. `npm run test:e2e:smoke -- -g "archives and restores a team"` — the new restore round trip passes. **Note:** always use the npm script (or otherwise ensure the `setup` Playwright project has run first) rather than `npx playwright test e2e/team-management.spec.ts --project=smoke` directly — passing a file path alongside `--project` can cause Playwright to skip the `setup` project's dependency resolution because `setup`'s own `testMatch` (`**/auth.setup.ts`) doesn't match that file, leaving `.auth/user1.json`/`.auth/user2.json` stale or missing on a clean checkout (Minor 9). If `.auth/*.json` is already known-fresh, `npx playwright test e2e/team-management.spec.ts --project=smoke` is fine as a faster local iteration loop.
3. `npm run test:e2e -- -g "Team archive ownership edge cases"` — both tests in the new spec pass end-to-end against a real sandbox, including the revoke → reclaim → archive → restore sequence and the invitation-expiry-on-archive assertion. Same `setup`-dependency caveat as above applies to any direct `npx playwright test e2e/team-archive-ownership.spec.ts --project=full` invocation.
4. `npm run test:e2e:smoke` — full smoke lane still green (no regression from the new test's added runtime).
5. `npm run lint` — new/edited `e2e/*.ts` and `amplify/functions/assign-team-owner/handler.test.ts` files pass zero-warnings lint.
6. Manual read-through of the updated `docs/SHARING-PERMISSIONS.md`: every new file path cited resolves to a real file; the Permission Capabilities table and Security Model lists match the actual current code (re-verify against `amplify/data/resource.ts` and the five `amplify/functions/*/handler.ts` files cited, in case anything shifts between this plan and implementation); specifically confirm the two corrected table rows and the corrected `accept-invitation`/`revokeCoachAccess` sentence no longer contradict this slice's own new test coverage (Major 3).
7. `npm run gate:commit` — must be green. This is the real `lint → typecheck:amplify → test:run → build` sequence (Minor 13), and — unlike prior E2E-only slices — this one has a new file (`amplify/functions/assign-team-owner/handler.test.ts`) actually exercised by the `test:run` stage, so this is a genuine gate, not a no-op check.
8. After merge, update `docs/plans/TEAM-ARCHIVE-PLAN.md`'s "Implementation Status" to record Step 10 as landed, following the same pattern as the "docs: update TEAM-ARCHIVE-PLAN status after Step N" commits for Steps 1/5/8/9 — not done as part of this plan (that update happens post-implementation, per established convention), but recorded here so it isn't missed. **When writing that update, note precisely which parent-plan Phase 7 items remain open:** Phase 7 steps 2 (schema-policy test extensions), 3 (`Management.teamLifecycle.test.tsx` component coverage), and 7 (the `typecheck:amplify` gate stage in `scripts/commit-gate.mjs`) already landed in prior slices, before this one. This slice (Step 10) closes out steps 4 (Playwright coverage), 5 (active-team regression / multi-coach authorization behavior), and 6 (`docs/SHARING-PERMISSIONS.md`), and partially closes step 1 (only the `assign-team-owner` portion — Major 1). So after this slice lands, Phase 7's **only** remaining open item is the rest of step 1: full `archive-team`/`restore-team` handler coverage.

## Required Follow-Ups (not in this slice)

1. **Backend handler unit tests for `archive-team` and `restore-team`** (parent Phase 7 step 1 — the remaining half after this slice picks up `assign-team-owner`). Should cover: owner authorization, non-owner rejection, the `coaches`-membership guard added in Step 1 Major 2, archive/restore idempotency (including the pending-invitation sweep running on every call, not just the transition), and direct-write rejection of the four locked fields via a plain `Team.update()`. This is the natural next slice, likely ahead of or alongside Phase 8.
2. **Phase 8 (`Game.create` conversion)** — unchanged, still deferred, still gates nothing.
3. **`revokeCoachAccess` needs a server-side guard against revoking the team's current owner** (carried forward from `TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md`, Required Follow-Ups #7 — still open, not touched by this slice). Today any coach, including a non-owner, can revoke the owner; that's precisely what makes the orphaned-owner scenario reachable in the first place. A client-side check alone is insufficient since `coaches` is a plain client-writable field; needs a Lambda-backed mutation (mirroring `assignTeamOwner`) or a condition expression on the field.
4. **`revokeCoachAccess` does not cascade to child-record `coaches` arrays** (Major 4, new in this revision). A revoked coach keeps read/write access to the team's games, roster, players, formations, and formation positions until those records' `coaches` arrays are separately swept — `accept-invitation`'s add-side backfill has no revoke-side mirror. Fixing this is an application-code change (likely a new Lambda-backed `revokeCoachAccess` mutation doing a similar multi-table sweep to `accept-invitation`'s, or reusing the repair script's table list as a starting point) and is out of scope for this docs+tests slice.
5. The residual risks now permanently documented in `docs/SHARING-PERMISSIONS.md` per this slice — `deletePlayerSafe` disclosure, banner staleness, and the two `revokeCoachAccess` gaps above — remain tracked there, still not fixed.
