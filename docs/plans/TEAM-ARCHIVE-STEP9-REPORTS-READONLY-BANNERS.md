# Team Archive — Step 9: Season Reports Archived-Team Selector + Read-Only Banners

Status: Draft plan — revised after architecture review round 1
Date: 2026-08-20 (revised 2026-08-20)
Parent plan: [TEAM-ARCHIVE-PLAN.md](TEAM-ARCHIVE-PLAN.md) — "Next Steps (ordered)" item 9 (Phase 6).
Prior slices: [TEAM-ARCHIVE-STEP5-FRONTEND-UX.md](TEAM-ARCHIVE-STEP5-FRONTEND-UX.md) (built `isTeamArchived`/`isTeamActive`/`isTeamOwner`/`isTeamOwnershipAssigned`/`formatArchivedOn` in `src/utils/teamUtils.ts`; confirmed the archived-team roster expansion was deliberately **not** built), [TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md](TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md) (added real server-side archived-team guards to `deleteGameSafe`/`deletePlayerSafe`, with an error-message passthrough fix at their `src/` call sites, but no proactive UI banner/disabled-state — this slice only partially mitigates that gap for game deletion: it adds visibility/awareness, not a disabled-state change; see "Known Gaps Carried Forward").

**Revision history:**
- 2026-08-20 round 1: Applied architecture review findings — fixed a `GameManagement.test.tsx` `it.each` test that drove state through the wrong prop (Major 1); fixed two timezone-dependent date fixtures (Major 2); corrected the banner CSS margin and the `.game-management` App.css rule-count claim (Minor 3); added "Known Gaps Carried Forward" entries for banner staleness under the no-subscription architecture and for non-sticky-during-scroll (Minor 4, 5); softened the Step 8 "closes the gap" claim to "partially mitigates" (Minor 6); noted the emoji/text markup as an open question for `ui-reviewer` and corrected the `OfflineBanner.css`/`SoccerPitchSurface.css` precedent claim (informational 7, 8).

## Goal

Frontend-only. Two independent pieces:

- **Part A** — `SeasonReportRoute.tsx`'s team selector includes archived teams, labeled `"{team.name} (Archived)"`, and continues to permit report generation and read-only historical access for them.
- **Part B** — a persistent, prominent read-only status banner (`🔒 Archived Team — Read-Only (Archived MMM D, YYYY)`) on every surface that displays an archived team's data: Season Reports, and `GameManagement.tsx` (all four game states — a game belonging to an archived team can be reached in any of them). "Persistent" here means the banner is present on entry to every mount site and self-heals on next entry; it is not a live, sticky-during-session guarantee — see "Known Gaps Carried Forward" for the two honest limits (staleness under the no-subscription architecture, and non-stickiness during a scrolled session).

**Definition of done:** `npm run gate:commit` passes; the manual verification checklist at the bottom passes against a real sandbox; no existing test in the touched files regresses.

## Scope

### In scope
1. `src/components/routes/SeasonReportRoute.tsx` — archived-team option labeling in the team `<select>`.
2. A new shared `ArchivedTeamBanner` component, reused (not reimplemented) across every surface that needs it.
3. `src/components/SeasonReport.tsx` (`TeamReport`) — banner mounted once at the top of the report view.
4. `src/components/GameManagement/GameManagement.tsx` — banner mounted once, above the state-machine's four branches, so it appears in `scheduled`/`in-progress`/`halftime`/`completed` without per-state duplication.
5. `src/App.css` — one new CSS section for the banner, appended at the bottom, reusing this codebase's existing amber "read-only" palette rather than inventing new visual language.
6. Unit tests for the new component and for each of the three mount sites.

### Explicitly out of scope (confirmed by reading the current code, not assumed)
- **`aria-disabled` treatment on individual mutation controls** (lineup drag-drop, substitution buttons, goal/note forms, availability toggles, rotation editing, half-length editing, "Edit Game," "Start Game," etc.). This slice adds visibility/awareness (the banner) only, not interaction prevention. Explicitly deferred per the parent plan's own phrasing and per this slice's task brief — not to be blurred together during implementation.
- **`src/components/GameManagement/PlanTab.tsx`** gets no separate banner mount. See "Decision: PlanTab does not need its own banner mount" below — it is always rendered nested inside `GameManagement.tsx` in the running app, so `GameManagement.tsx`'s single mount already covers it. (The parent plan's file list bundles `PlanTab.tsx` into the same sentence as the banner *and* the deferred `aria-disabled` work; the `aria-disabled` half of that sentence is what actually lives inside `PlanTab.tsx`, and is out of scope per the point above.)
- **Management.tsx's archived-team roster expansion.** Confirmed by re-reading the current `Management.tsx` (not just trusting the Step 5 doc): archived team cards (`teamsView === 'archived'` branch, ~line 1594) render `.item-card.archived` with name/badge/archived-date/lifecycle-actions only — there is no `Expand Roster` affordance and no roster-expansion container on archived cards. Step 5's explicit decision not to build one is still current. Nothing to bannerize here; not invented in this slice.
- **A "read-only historical game view reachable from Season Reports."** Confirmed by reading `SeasonReportRoute.tsx` and `SeasonReport.tsx` (`TeamReport`) in full: neither renders a `<Link>`/`navigate()` call to `/game/:gameId` or any other game-detail view. Clicking a player row in `TeamReport` opens an inline, in-place details panel (goals/assists/cards list), not a navigation. **There is no such surface today**, so this bullet of Phase 6 step 3 is trivially satisfied — there is nothing to add a guard or banner to. (The reverse link exists — `GameManagement.tsx`'s `completed` state has a `"View Full Season Report →"` link to `/reports/${team.id}` — which is unaffected by, and unrelated to, this non-existent forward link.) The actual "read-only historical game view" in this app is `GameManagement.tsx` in its `completed` state, reached from `Home.tsx` or a direct URL — already in scope as its own item above.
- **Game creation/edit affordances reachable from `SeasonReportRoute.tsx`.** Confirmed by reading both files: neither renders any game-creation or game-edit control. Phase 6 step 4 ("ensure archived teams cannot be used to create or edit games through report or route entry points... every mutation affordance reachable from this path uses the same visible-but-`aria-disabled` treatment") is trivially satisfied — there is no such affordance on this path to guard. Not inventing one.
- **`Home.tsx`.** Not named in the parent plan's file list for this slice. Its game-history cards are a navigation list, not a "read-only game view" themselves; the actual game content is `GameManagement.tsx`, which this slice covers regardless of entry point (Home.tsx click, direct URL, or the reverse link from Season Reports). Left untouched.
- Any backend/schema change.
- Sort/reorder logic in the Season Reports team `<select>` (active-first, etc.) — not requested by the parent plan (only the `"(Archived)"` label is), and no existing precedent for it in this single-dropdown selector (Management.tsx's Active/Archived split uses separate sub-tabs, not applicable here). Adding one would be unrequested scope creep.
- `aria-live` announcements, pixel-level touch-target audits — explicitly deferred by the parent plan and by this slice's own task brief.

## Findings from reading the codebase

- **`SeasonReportRoute.tsx` already lists archived teams in its selector today** — its `useEffect` calls `client.models.Team.list()` unfiltered and maps every team into an `<option>`. The only missing piece is the archived-team label suffix; no new fetch, filter, or query-shape change is needed. (Confirms the parent plan's own framing: this file "does a direct `client.models.Team.list()` call, not `useAmplifyQuery`" — unchanged in this slice, not a target for conversion.)
- **`TeamReport` (`SeasonReport.tsx`) already receives a `team: Team` prop directly** from `SeasonReportRoute.tsx` — no extra fetch needed to know if it's archived; `isTeamArchived(team)` and `formatArchivedOn(team.archivedAt)` can be called immediately.
- **`GameManagement.tsx` already receives a full `team: Team` prop** (from `GameManagementRoute.tsx`, either via `location.state` on in-app navigation or a fresh `client.models.Team.get()` on a direct URL/refresh) — same story, no new fetch needed. `PlanTab.tsx` also already receives `team: Team` as a prop, but per the Decision below, doesn't need its own banner render.
- **`GameManagement.tsx`'s render tree already has exactly one place that's unconditionally mounted across all four `Game.status` states**: `<div className="game-management">` wraps a single always-rendered `<CommandBand>` (plus the always-mounted `RotationWidget`/`SubstitutionPanel` modals), followed by four mutually exclusive state blocks (`gameState.status === 'scheduled' | ...`). Mounting the banner once, as the first child of `.game-management` (before `<CommandBand>`), covers all four states with zero duplication — matching CLAUDE.md's guidance not to duplicate cross-cutting UI per state block (the codebase's own `OfflineBanner` is duplicated three times across the `scheduled`/`in-progress`/`halftime` blocks — an existing pattern, not one to imitate here).
- **`.command-band` is `position: sticky; top: 0; z-index: 200`**, and `.game-tab-nav` is `position: sticky; top: 56px; z-index: 190` (stacked directly beneath it, offset by CommandBand's own height). Making the new banner *also* sticky would require it to sit in this same stack — either above CommandBand (pushing `.command-band`'s effective sticky `top` down, which nothing in the codebase currently parameterizes) or between CommandBand and the tab nav (requiring `.game-tab-nav`'s hardcoded `top: 56px` to become conditional on whether a team is archived). Both are real, non-trivial sticky-layout changes and exactly the kind of pixel-perfect stacking work this slice's task brief says not to do. **Decision: the banner is not sticky** — it renders once, in normal document flow, at the very top of the container, and scrolls away with the rest of the content once the user scrolls past it, same as the "top of the container" language already used for the (unbuilt) Management roster-expansion banner in the parent plan. This is a deliberate, documented scope boundary, not an oversight.
- **This codebase already has an established "read-only" amber visual convention** distinct from `.archive-badge`'s solid-fill pill: `.ht-edit-link` (`GameManagement`'s halftime read-only lock indicator) uses `color: #e65100; background: #fff3e0; border: 1px solid #ffcc80;`. This is the closest existing semantic analog to what this slice needs (a "this is currently read-only" indicator inside the same `GameManagement` subsystem) and is reused directly rather than inventing new colors. The banner's *shape* (padded card, left-accent border, rounded corners) mirrors `.plan-conflict-banner` — this codebase's one other component actually named "banner" in `App.css`.
- **`src/components/shared/` already exists** as the home for small, cross-cutting presentational components reused from multiple places (`SoccerPitchSurface.tsx`, imported from both `FormationVisualEditor.tsx` and `GameManagement/shape/LineupShapeView.tsx` via relative paths). The new banner component follows this precedent rather than living under `GameManagement/` (which would misleadingly suggest it's game-management-specific) or duplicating markup at each of the three call sites.
- **CLAUDE.md's CSS convention is "all CSS lives in `src/App.css`."** `OfflineBanner.css` is one pre-existing exception to that rule, but not the only one — `src/components/shared/SoccerPitchSurface.css` also exists as a separate stylesheet, and it lives in the very `src/components/shared/` directory this new component is being added to, making it the better-matched (if still non-conforming) precedent for this specific location. Neither changes the conclusion: this new component still gets no separate stylesheet, per CLAUDE.md's explicit instruction, which overrides local-directory precedent.
- **`isTeamArchived`/`formatArchivedOn` are structurally reusable against every `Team`-shaped object already in play**: `GameManagement/types.ts`'s `Team` is a literal re-export of `../../types/schema`'s `Team` (`export type { Team, ... } from "../../types/schema"`), so no cast or type friction exists calling `isTeamArchived(team)` from inside `GameManagement.tsx`.
- **The one-way link `GameManagement.tsx`'s `completed` state → `/reports/${team.id}`** (`"View Full Season Report →"`) means a coach viewing a completed archived-team game can click through into the now-correctly-labeled, now-bannered Season Reports view for the same team — the two halves of this slice reinforce each other along that one existing navigation path, even though there's no reverse link.

## Decisions

### Decision: one shared `ArchivedTeamBanner` component, not copy-pasted JSX

Three consumers (`SeasonReport.tsx`, `GameManagement.tsx`, and implicitly any future surface) need byte-identical copy, formatting, and null-handling (archived-but-no-`archivedAt` legacy edge case). A shared component in `src/components/shared/ArchivedTeamBanner.tsx` keeps the copy and the `formatArchivedOn`-missing fallback in exactly one place, consistent with how `OfflineBanner` is already factored out as its own component rather than inlined three times. The component takes a minimal `Pick<Team, 'status' | 'archivedAt'>` (matching `isTeamArchived`'s own minimal-`Pick` convention), self-guards (`return null` when not archived) so every call site can mount it unconditionally with no caller-side `isTeamArchived(...) &&` check duplicated three times.

### Decision: PlanTab does not need its own banner mount

`PlanTab.tsx` is only ever rendered inside `GameManagement.tsx`'s tab content (confirmed by reading `App.tsx`'s routes — the only route that reaches `PlanTab` is `/game/:gameId`, handled by `GameManagementRoute` → `GameManagement`; the legacy `/game/:gameId/plan` route is a bare `<Navigate>` redirect to the same place, not a separate render path). Since `GameManagement.tsx` already mounts the banner once, above all four state branches (which include the tabbed layout that renders `PlanTab`), a second banner render inside `PlanTab` itself would be a literal on-screen duplicate, not an additional surface. The parent plan's file list names `PlanTab.tsx` in the same breath as the banner *and* the `aria-disabled` mutation-control treatment; the banner half is satisfied transitively through `GameManagement.tsx`, and the `aria-disabled` half (which does live inside `PlanTab.tsx`'s rotation/half-length/availability controls) is out of scope for this slice per the task brief.

### Decision: banner is non-sticky, mounted once per container, at the top

See "Findings" above for the z-index/sticky-stacking reasoning. Applies identically at all three mount sites: `.season-report`'s first child, and `.game-management`'s first child (before `<CommandBand>`).

### Decision: no reordering/grouping change to the Season Reports team `<select>`

Only the label changes (`"{team.name} (Archived)"` for archived teams). No sort, no `<optgroup>` split. This is a minimal, additive change matching exactly what the parent plan asks for; introducing a new sort order is unrequested and has no existing precedent to match in this specific single-dropdown selector.

## File-by-File Changes

### 1. `src/components/shared/ArchivedTeamBanner.tsx` (new)

```tsx
import { isTeamArchived, formatArchivedOn } from '../../utils/teamUtils';
import type { Team } from '../../types/schema';

interface ArchivedTeamBannerProps {
  team: Pick<Team, 'status' | 'archivedAt'>;
}

/**
 * Persistent, prominent read-only indicator for every surface that displays
 * an archived team's data (Season Reports, in-game management). Renders
 * nothing for active teams — safe to mount unconditionally at every call
 * site. See docs/plans/TEAM-ARCHIVE-PLAN.md Phase 5 step 4 / Phase 6 for the
 * canonical copy. Intentionally not sticky/CSS-position-locked — see
 * docs/plans/TEAM-ARCHIVE-STEP9-REPORTS-READONLY-BANNERS.md, "Decision:
 * banner is non-sticky."
 */
export function ArchivedTeamBanner({ team }: ArchivedTeamBannerProps) {
  if (!isTeamArchived(team)) return null;

  const archivedOn = formatArchivedOn(team.archivedAt);

  return (
    <div className="archived-team-banner" role="status" aria-live="polite">
      <span aria-hidden="true">🔒</span>
      {' '}Archived Team — Read-Only{archivedOn ? ` (Archived ${archivedOn})` : ''}
    </div>
  );
}
```
`role="status" aria-live="polite"` matches `OfflineBanner.tsx`'s existing precedent for a lightweight, non-scripted a11y announcement — not the deferred "full `aria-live` pass" (which would mean scripting announcements for state *transitions*, e.g. mid-session archival by another coach; this is just the same static-role convention already used elsewhere in this codebase).

**Open question for `ui-reviewer`:** the emoji is split into its own `aria-hidden="true"` span (rather than one contiguous text run) so that (a) the container's `display: flex; gap: 0.5rem` actually has two flex items to apply a gap between instead of being inert against a single anonymous text node, and (b) a screen reader doesn't announce the literal word "lock" before "Archived Team — Read-Only". This is the plan's best-guess implementation, not a unilateral final decision — flag it explicitly during UI review in case there's a preferred alternative treatment.

### 2. `src/components/shared/ArchivedTeamBanner.test.tsx` (new)

- Renders nothing for `{ status: undefined }` (legacy-active) and `{ status: 'active' }`.
- Renders `"🔒 Archived Team — Read-Only (Archived Aug 1, 2026)"` for `{ status: 'archived', archivedAt: '2026-08-01T12:00:00.000Z' }`.
- Renders `"🔒 Archived Team — Read-Only"` (no parenthetical) for `{ status: 'archived', archivedAt: null }` and for `{ status: 'archived', archivedAt: 'not-a-date' }`, proving the `formatArchivedOn`-returns-`null` fallback works.
- Asserts `role="status"` is present.

### 3. `src/App.css` (append at bottom, new section)

```css
/* ===== Archived Team Read-Only Banner ===== */
.archived-team-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #fff3e0;
  border: 1px solid #ffcc80;
  border-left: 4px solid #ffa726;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin: 0 0 0.75rem;
  color: #e65100;
  font-size: 0.9rem;
  font-weight: 600;
}
```
Reuses `.ht-edit-link`'s exact "read-only" amber palette (`#e65100` / `#fff3e0` / `#ffcc80`) and `.plan-conflict-banner`'s left-accent-border card shape — no new colors introduced, and `margin: 0 0 0.75rem` (vertical-only, matching `.plan-conflict-banner`'s own `margin-bottom: 1rem` with no horizontal margin) rather than a symmetric `0.75rem` on all sides. This matters because the shared ancestor `.app-container` (`App.css` lines 1-9) applies `padding: 1rem`, which every other in-flow element (report header, command band, etc.) sits flush against; a horizontal margin on the banner itself would make it sit visibly narrower than its siblings on a phone viewport. Works identically at both mount sites: `.season-report` has no horizontal padding of its own, and `.game-management` is declared twice in `App.css` — once around line 1669 (`margin: 2rem 0; padding-bottom: 5rem;`) and once around line 5893 in the "Mobile Game Management Redesign" section (`margin: 0;`, the one that wins in practice) — neither adds horizontal padding either way, so no per-consumer CSS override is needed.

### 4. `src/components/routes/SeasonReportRoute.tsx`

Add the import and change the `<option>` label:
```tsx
import { isTeamArchived } from "../../utils/teamUtils";
```
```tsx
{teams.map((t) => (
  <option key={t.id} value={t.id}>
    {isTeamArchived(t) ? `${t.name} (Archived)` : t.name}
  </option>
))}
```
No other change in this file. Auto-select-when-only-one-team, `handleTeamChange`, and the `teamId`-not-found fallback fetch are all unaffected and already work correctly for an archived team (they operate on `team.id`, not on any active/archived distinction).

### 5. `src/components/routes/SeasonReportRoute.test.tsx`

Add:
- `'labels archived teams with (Archived) suffix in the selector'` — `mockTeamList` resolves `[teamA, { ...teamB, status: 'archived' }]`; assert `screen.getByRole('option', { name: 'Hawks (Archived)' })` and `screen.getByRole('option', { name: 'Eagles' })` (unsuffixed) both resolve.
- `'permits selecting and generating a report for an archived team'` — select the archived team via the existing `handleTeamChange` interaction path (`userEvent.selectOptions`), assert `screen.getByTestId('team-report')` renders with the archived team's data (the existing `TeamReport` mock in this file already just echoes `team.name`, so this proves selection isn't blocked, not the banner itself — banner behavior is asserted in `SeasonReport.test.tsx` against the real component, since this file mocks `TeamReport` out entirely).

### 6. `src/components/SeasonReport.tsx` (`TeamReport`)

Add the import and mount the banner as the first child of `.season-report`, before `<div className="report-header">`:
```tsx
import { ArchivedTeamBanner } from './shared/ArchivedTeamBanner';
```
```tsx
return (
  <div className="season-report">
    <ArchivedTeamBanner team={team} />
    <div className="report-header">
      <h1>Season Report: {team.name}</h1>
    </div>
    ...
```
Rendered unconditionally (before the `loading` check) so it appears immediately, even while `"Loading season statistics..."` is still showing — the archived-ness is already known synchronously from the `team` prop, unlike the stats themselves.

### 7. `src/components/SeasonReport.test.tsx`

Add:
- `'shows the archived-team read-only banner when the team is archived'` — pass `team={{ id: 'team-1', name: 'Tigers', coaches: [], status: 'archived', archivedAt: '2026-08-01T12:00:00.000Z' } as never}` (midday-UTC, matching the precedent in `src/utils/teamUtils.test.ts` line 73 and the plan's own `ArchivedTeamBanner.test.tsx` case above — a midnight-UTC timestamp rolls back to the previous local day and fails deterministically on any UTC-negative machine, since neither `formatArchivedOn` nor this repo's test config pins `TZ`); assert `screen.getByText(/Archived Team — Read-Only \(Archived Aug 1, 2026\)/)` (date string unaffected by the midday shift).
- `'does not show the read-only banner for an active team'` — existing fixtures (no `status` field) already cover this implicitly; add one explicit assertion (`expect(screen.queryByText(/Archived Team/)).not.toBeInTheDocument()`) to an existing active-team test rather than adding a whole new test, to avoid duplicating setup.

### 8. `src/components/GameManagement/GameManagement.tsx`

Add the import:
```tsx
import { ArchivedTeamBanner } from "../shared/ArchivedTeamBanner";
```
Mount once, as the first child of `.game-management`, before `<CommandBand>`:
```tsx
return (
  <AvailabilityProvider availabilities={playerAvailabilities}>
    <div className="game-management">
      <ArchivedTeamBanner team={team} />

      {/* Always-visible sticky command band */}
      <CommandBand
        ...
```
No other change — this single mount covers `scheduled` (pregame-layout), `in-progress`/`halftime` (tabbed/halftime layouts), and `completed` (completed-layout), since all four are downstream of this point in the tree, and `PlanTab` (rendered inside the tabbed layout) is covered transitively per the Decision above.

### 9. `src/components/GameManagement/GameManagement.test.tsx`

**Correction from architecture review round 1 (Major 1):** `GameManagement.tsx` does not branch its four state layouts on the `game` prop directly — it branches on `gameState`, which comes from the mocked `useGameSubscriptions` hook (`vi.mock("./hooks/useGameSubscriptions", () => ({ useGameSubscriptions: mockUseGameSubscriptions }))`, hoisted at the top of this file). Every existing test in this file that needs a specific state sets it via `mockUseGameSubscriptions.mockReturnValue({ ...defaultSubscription, gameState: { ...defaultSubscription.gameState, status: '<status>' } })` (see e.g. lines 437-439, 494-496, 611-613 of the current file) — never by passing a differently-shaped `game` prop. `defaultSubscription.gameState` is `mockGame`, whose own `status` is hardcoded to `"halftime"` (line 278); a test that only varies the `game` prop passed to `<GameManagement>` while leaving `mockUseGameSubscriptions` on its default return value would render the `halftime` layout every time regardless of what `status` was passed, silently proving nothing. The original draft of this test made exactly that mistake. The corrected version below drives state the same way every other test in this file does.

Add a new `describe` block using the existing `mockTeam`/`mockGame` fixtures and `renderWithRouter` helper already defined in this file, following this file's own per-`describe` convention of re-establishing `mockUseGameSubscriptions`'s return value in a local `beforeEach`:
```ts
describe("GameManagement – archived team banner", () => {
  const archivedTeam = { ...mockTeam, status: 'archived', archivedAt: '2026-07-01T12:00:00.000Z' };
  // Midday-UTC timestamp — a midnight-UTC value rolls back to the previous
  // local day under toLocaleDateString on any UTC-negative machine (no TZ
  // pinning in this repo's test config). Matches the precedent in
  // src/utils/teamUtils.test.ts line 73.

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
    mockUseGameSubscriptions.mockReturnValue(defaultSubscription);
  });

  it.each(['scheduled', 'in-progress', 'halftime', 'completed'])(
    'shows the archived-team banner when game.status is %s',
    (status) => {
      // Drive the rendered state through the mocked hook's `gameState`, not
      // through the `game` prop — see correction note above. `game={mockGame}`
      // is still passed because GameManagement requires a `game` prop to
      // render at all; it plays no role in which state layout appears once
      // useGameSubscriptions is mocked.
      mockUseGameSubscriptions.mockReturnValue({
        ...defaultSubscription,
        gameState: { ...defaultSubscription.gameState, status },
      });
      renderWithRouter(
        <GameManagement game={mockGame} team={archivedTeam} onBack={vi.fn()} />
      );
      expect(
        screen.getByText(/Archived Team — Read-Only \(Archived Jul 1, 2026\)/)
      ).toBeInTheDocument();
    }
  );

  it('does not show the archived-team banner for an active team', () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'scheduled' },
    });
    renderComponent(); // uses the unmodified mockTeam — no `status` field
    expect(screen.queryByText(/Archived Team/)).not.toBeInTheDocument();
  });
});
```
This directly proves the single-mount-point design actually covers all four `gameState.status` branches, rather than assuming it from reading the JSX or (as the original draft did) exercising the same branch four times under a false appearance of coverage.

No mock is needed for `ArchivedTeamBanner` itself — it's a small, dependency-free component (only imports `teamUtils`, no hooks, no Amplify calls), and this test file does not mock `CommandBand`/`TabNav` either, so the real banner renders naturally alongside them.

## Test Strategy Summary

| File | Change | New/updated tests |
|---|---|---|
| `src/components/shared/ArchivedTeamBanner.tsx` | new | `ArchivedTeamBanner.test.tsx` (new, 4 cases) |
| `src/App.css` | new CSS section | none (no CSS unit tests in this repo) |
| `src/components/routes/SeasonReportRoute.tsx` | `<option>` label | 2 new cases in `SeasonReportRoute.test.tsx` |
| `src/components/SeasonReport.tsx` | banner mount | 1 new case + 1 added assertion in `SeasonReport.test.tsx` |
| `src/components/GameManagement/GameManagement.tsx` | banner mount | new `describe` block in `GameManagement.test.tsx`: 1 parameterized test (`it.each`, 4 `gameState.status` values, each driven through the mocked `useGameSubscriptions` hook) + 1 standalone active-team negative-case test |

No changes needed to `PlanTab.test.tsx`, `Management.tsx`/`Management.*.test.tsx`, or any e2e spec — none of the touched surfaces have existing e2e coverage that asserts on the DOM structure being changed here (Phase 7's E2E work, including any new archive-specific e2e coverage, remains explicitly deferred per the parent plan).

## Manual Verification Checklist (through the real running app)

1. Archive a team (Manage → Teams → Active Teams → Archive, per Step 5's flow). Go to Home → the reports icon/nav → confirm the archived team appears in the "📊 Team Reports" dropdown as `"{name} (Archived)"`, distinguishable from active teams in the same list.
2. Select the archived team in that dropdown. Confirm the report still generates (record, goals, assists, player stats table all populate normally) and that the `🔒 Archived Team — Read-Only (Archived <date>)` banner appears at the top of the report, above the "Season Report: {name}" heading, visible even momentarily during the "Loading season statistics…" state.
3. Confirm the banner's date matches the actual archive date shown on the team's card in Manage → Teams → Archived Teams (same `formatArchivedOn` output, same source field).
4. From Home, open a **completed** game belonging to the archived team (games remain visible in Home's history list per Step 5's existing design). Confirm the same read-only banner appears at the top of the game screen, above the sticky command band, in the `completed` state.
5. From Home, open a **scheduled** game belonging to the archived team, if one exists from before archiving (or archive a team with a still-scheduled game). Confirm the banner appears in the pregame/scheduled layout too.
6. Start that scheduled game (if reachable) and step through `in-progress` and `halftime` — confirm the banner persists across all state transitions, still non-sticky (scrolls away with page content, does not fight the sticky CommandBand/tab-nav for space).
7. Restore the team (Manage → Teams → Archived Teams → Restore Team). Re-open the same game and confirm the banner is now gone, and the Season Reports dropdown option no longer shows `"(Archived)"` for that team.
8. Confirm an **active** team's report view and an active team's game view show no banner at all, in every state.
9. From a completed archived-team game's `"View Full Season Report →"` link, confirm it lands on the same bannered, correctly-labeled Season Reports view for that team (the one existing report↔game navigation path in the app).
10. Confirm no lineup/rotation/note/goal/availability control anywhere in an archived-team's game screen was hidden, disabled, or visually altered by this change — this slice adds only the banner, not any control-level treatment (spot-check: buttons that were clickable before archiving are still clickable — this is the accepted, unchanged, documented UI-only-enforcement gap, not a regression).

## Known Gaps Carried Forward (not fixed in this slice)

- **The banner can be stale for a coach already mid-session when another coach archives (or restores) the team.** `GameManagement.tsx`'s `team` prop is a one-time snapshot — seeded from `location.state` on in-app navigation, from `Home.tsx`'s `useAmplifyQuery('Team')` list, or from a fresh `Team.get()` on direct URL entry — with no live `Team` subscription inside the game screen itself. The archive/restore Lambdas write via the DynamoDB SDK directly and do not trigger AppSync subscriptions (established in Step 1's review), so a coach already viewing a game when a co-coach archives that team won't see the banner appear (or, on restore, won't see it disappear) until they leave and re-enter the game screen — it self-heals on next entry since `Home.tsx`'s `useAmplifyQuery` re-subscribes per mount. This is inherited from Step 1's architecture, not introduced here. `Management.tsx` already has a component-local workaround for the equivalent staleness problem in its own team list — the `teamLifecycleOverrides` mechanism (~lines 195-227, applied via `applyLifecycleOverride` and reconciled in the `useEffect` at ~lines 234-255) — but that shim is scoped to `Management.tsx`'s own state and is not extended to `GameManagement.tsx` by this slice. A future slice that wants a genuinely live banner should start there.
- **The non-sticky banner only partially satisfies the parent plan's "persistent" language.** The decision to keep the banner non-sticky (see "Decision: banner is non-sticky" above) is the right scope boundary for this slice, but it means a coach scrolling through a long `in-progress`/`halftime` session loses sight of the banner after the first scroll, with no ambient read-only signal remaining at the point of interaction — compounded by the deferred `aria-disabled` work meaning nothing on screen is actually inert either. The banner satisfies "prominent" (it's the first thing shown on entry) but not "persistent" through a scrolled session. A sticky-stack integration (folding the banner into the `.command-band`/`.game-tab-nav` z-index stack) or a compact lock indicator inside `CommandBand` itself would be the natural companion to the deferred `aria-disabled` slice — not built now, just recorded so it isn't quietly forgotten.
- **No `aria-disabled` treatment on any in-game mutation control for archived-team games** — remains exactly as documented in the parent plan (Phase 4/5 "UI-only enforcement... not full server-side coverage"). This slice makes the read-only state *visible*; it does not make any control *inert*. A coach can still, for example, click "Start Game" on a scheduled game belonging to an archived team, or edit rotations/availability/notes on one in progress — those mutations still succeed against the backend exactly as before this slice (per Step 8, only `deleteGameSafe`/`deletePlayerSafe`/lifecycle-fields/invitation-acceptance are server-enforced; everything else in the deep in-game surface is not).
- **`GameManagement.tsx`'s "Edit Game" affordance** (visible in the `scheduled` pregame layout) is unaffected by this slice — editing a scheduled game's opponent/date for an archived team remains possible, same UI-only-enforcement gap as above, not newly introduced or newly closed here.
- **No E2E coverage added** for the banner or the selector labeling — Phase 7 remains its own deferred slice per the parent plan.
- **The Season Reports team `<select>` is not reordered** — archived teams remain interleaved with active teams in whatever order `client.models.Team.list()` returns, distinguished only by the `"(Archived)"` suffix.
