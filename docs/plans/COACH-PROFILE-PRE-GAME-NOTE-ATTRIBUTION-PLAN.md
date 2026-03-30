# Coach Profiles for Pre-Game Note Attribution (Option 2)

Status: Stage 1 revision after architecture findings
Date: 2026-03-29

## Goal
Implement app-level coach profiles so pre-game note attribution shows friendly coach names to same-team coaches only, while preserving existing spoof-proof note security where `GameNote.authorId` remains Cognito-sub based and immutable.

## Authoritative Requirements Included
- Names are visible only among coaches on the same team.
- Add app-level coach profile model.
- Blank profile fields are allowed and must use fallback labels.
- Attribution format is First Name + Last Initial when privacy allows.
- Dynamic update is required so profile edits are reflected without note mutation.
- Duplicate rendered names must be disambiguated.
- Last-name privacy option is required.
- Welcome/first-time setup includes profile completion.
- Include detailed feature spec in docs.
- If a coach is removed from a team, historical notes must no longer reveal that coach name to remaining coaches.

## Requirements Gaps and Assumptions

### Closed gaps from architect review
- Team coach profile query path will not use Scan.
- DTO will be minimized to only display-ready values; no full `lastName` leakage when privacy is off.
- Disambiguation will avoid raw id fragments.
- Name normalization is canonicalized (trim and blank-to-null).
- Upsert concurrency behavior is explicitly defined.
- Removed-coach historical note behavior is explicitly defined.
- IAM least privilege for both lambdas is explicitly defined.

### Assumptions carried into implementation
- `shareLastNameWithCoaches` defaults to `true` when profile is created without explicit value.
- Profile completion in onboarding is satisfied by non-empty normalized first name.
- Dynamic freshness target is at most 60 seconds.

## Architecture Decisions

### 1) Data model
Add `CoachProfile` keyed by Cognito sub:
- `id`: string (equals Cognito sub)
- `firstName`: string | null
- `lastName`: string | null
- `shareLastNameWithCoaches`: boolean (default true)
- optional optimization fields for DTO minimization:
  - `displayNameFull`: string | null (first + last initial form)
  - `displayNamePrivacy`: string | null (first only form)

Normalization is canonical on write:
- trim all name inputs
- persist blank strings as `null`

### 2) No-scan team query path
`getTeamCoachProfiles(teamId)` lambda logic:
1. Resolve caller `identity.sub`.
2. `GetItem` Team by `teamId`.
3. Verify caller sub is in `Team.coaches`.
4. Build profile key list from `Team.coaches`.
5. Use DynamoDB `BatchGetItem` on CoachProfile table in chunks (max 100 keys/request).
6. Compose response for all current team coach ids, including fallback-ready rows for missing profiles.

No scan operations are permitted in this path.

### 3) PII-minimized response DTO
Return only fields needed for attribution rendering:
- `coachId`
- `displayName`: string | null (already privacy-filtered)
- `isFallback`: boolean
- `disambiguationGroupKey`: string | null (server-computed normalized key)

Do not return full `lastName` when privacy is off. Prefer display-ready fields from profile storage or lambda computation and return only the selected display string.

### 4) Non-sensitive deterministic disambiguation
Replace id-fragment suffix with team-scoped deterministic ordinal:
- For each collision group (same normalized `displayName`), sort colliding coach ids lexicographically.
- Assign ordinal within group starting at 1.
- Render as `Display Name (Coach 1)`, `Display Name (Coach 2)`, etc.

This is deterministic, stable for a given team roster ordering rule, and reveals no raw id fragments.

### 5) Dynamic freshness target (no manual refresh)
Frontend profile lookup refresh strategy:
- target freshness: data no older than 60 seconds during active game-management session
- hook-level polling interval: 60s with jitter guard (for stampede reduction)
- immediate refetch triggers: team change, notes tab focus entry, window focus regain
- no manual refresh control required

### 6) Upsert concurrency semantics
`upsertMyCoachProfile` behavior:
- identity-sub is authoritative key
- create: `PutItem` with condition `attribute_not_exists(id)`
- update: `UpdateItem` with optimistic condition on `updatedAt` when client sends previous version; otherwise last-write-wins fallback is accepted
- if condition fails, return conflict error that prompts client refetch then retry

Decision: explicit optimistic concurrency when version context exists; otherwise deterministic last-write-wins.

### 7) Removed coach and historical notes rule
When a coach is removed from a team:
- that coach id is no longer present in `Team.coaches`
- team profile query no longer returns that coach display row
- historical notes authored by removed coach must render fallback label (for example `Former Coach`) for remaining team coaches
- no historical note rewrites required

### 8) IAM least privilege
`upsert-coach-profile` lambda:
- DynamoDB actions: `GetItem`, `PutItem`, `UpdateItem`
- Resource: CoachProfile table ARN only
- Deny wildcard table access

`get-team-coach-profiles` lambda:
- Team table: `GetItem` only
- CoachProfile table: `BatchGetItem` and `GetItem` only
- Resources: Team table ARN and CoachProfile table ARN only
- No write permissions

## 9) Explicit UX Decisions Reference

The following UX behaviors and styling have been explicitly defined and must be implemented exactly as specified:

**Profile validation and conflict handling** (see `docs/specs/UI-SPEC.md` § 7.10):
- Save button disabled when normalized `firstName` is blank; show "First name required" caption
- Concurrent edit conflicts: persistent inline alert with Retry + Discard buttons
- Retry focus management: after successful refetch, focus returns to First Name input
- Editing remains enabled while conflict is shown

**Mobile profile layout** (see `docs/specs/UI-SPEC.md` § 7.10):
- Cancel button on mobile stacked below Save button
- Cancel triggers "Discard changes?" confirmation if form is dirty

**Attribution rendering** (see `docs/specs/UI-SPEC.md` § 7.11 and `docs/specs/USER-PROFILE-SPEC.md` § 11):
- `You` label: render only (no Coach N suffix); 0.9em, `--primary-green` bold
- `Former Coach` label: 0.9em, `--text-secondary` italic (same styling as Coach fallback; no tooltip)
- Placement: `Created by: [label]` footer caption below note text, above action buttons
- Font sizes: all attribution labels 0.9em

**Refresh behavior** (see `docs/specs/UI-SPEC.md` § 7.11):
- 60-second background polling with **no staleness badge or user-visible indicator**
- Immediate refetch on: team change, notes tab focus entry, window focus regain
- No manual refresh button required

**Onboarding/localStorage persistence** (see `docs/specs/UI-SPEC.md` § 7.12 and `docs/specs/USER-PROFILE-SPEC.md` § 9.1–9.2):
- Quick Start Checklist: `quickStartChecklistDismissed` (localStorage); auto-hides after all 7 steps complete
- Welcome Modal: `welcomeModalDismissed` (localStorage); persists across sign-out/sign-in

All details in the referenced UI and profile specs are authoritative.

## File-by-File Change Plan

### Planning/spec artifacts
- `docs/specs/USER-PROFILE-SPEC.md`
  - Revise contracts and rules to align with architecture findings and user requirement for removed coaches.
- `docs/plans/COACH-PROFILE-PRE-GAME-NOTE-ATTRIBUTION-PLAN.md`
  - Revise implementation sequence and guardrails for coding handoff.

### Backend schema and operations
- `amplify/data/resource.ts`
  - Add `CoachProfile` model.
  - Add custom mutation `upsertMyCoachProfile`.
  - Add custom query `getTeamCoachProfiles`.
  - Ensure query contract returns minimized DTO fields only.
- `amplify/backend.ts`
  - Register both lambdas.
  - Wire strict IAM policies listed above.
  - Provide env vars for Team and CoachProfile table names.
- `amplify/functions/upsert-coach-profile/resource.ts`
  - Define mutation resource and auth mode.
- `amplify/functions/upsert-coach-profile/handler.ts`
  - Implement normalization and explicit concurrency semantics.
- `amplify/functions/upsert-coach-profile/handler.test.ts`
  - Add tests for normalization, privacy flag, and concurrency cases.
- `amplify/functions/get-team-coach-profiles/resource.ts`
  - Define query resource and auth mode.
- `amplify/functions/get-team-coach-profiles/handler.ts`
  - Implement Team GetItem membership check plus chunked BatchGet.
  - Implement minimized DTO and deterministic ordinal disambiguation metadata.
- `amplify/functions/get-team-coach-profiles/handler.test.ts`
  - Add tests that assert no scan path, team scoping, chunking behavior, and removed-coach fallback behavior.

### Frontend profile and attribution
- `src/components/UserProfile.tsx`
  - Add/edit first name, last name, and privacy controls.
  - Send normalized values through mutation inputs.
- `src/components/UserProfile.test.tsx`
  - Cover trim, blank-to-null behavior, privacy toggle, conflict/retry UX.
- `src/hooks/useTeamCoachProfiles.ts` (new)
  - Polling and focus-driven refetch with 60s freshness target.
- `src/services/coachDisplayNameService.ts` (new)
  - Consume DTO and produce final labels including fallback and ordinal disambiguation display.
- `src/components/GameManagement/GameManagement.tsx`
  - Fetch team coach profiles through hook and pass map to notes UI.
- `src/components/GameManagement/PreGameNotesPanel.tsx`
  - Render dynamic attribution labels with removed-coach fallback rule.
- `src/components/GameManagement/PreGameNotesPanel.test.tsx`
  - Cover You label, first+initial, privacy-off display, duplicate ordinal labels, missing profile, removed coach.

### Onboarding updates
- `src/components/Onboarding/QuickStartChecklist.tsx`
  - Add profile completion step.
- `src/components/Onboarding/QuickStartChecklist.test.tsx`
  - Update step count and completion logic.
- `src/components/Onboarding/WelcomeModal.tsx`
  - Add profile setup guidance tied to note attribution.
- `src/components/Onboarding/WelcomeModal.test.tsx`
  - Validate updated onboarding copy and actions.
- `src/components/Home.tsx`
  - Wire profile completion state into checklist source data.

### Typing and generated artifacts
- `src/types/schema.ts`
  - Include generated CoachProfile and custom operation types.
- generated outputs as needed from Amplify tooling

## Data Model and API Impacts

### New model impact
- `CoachProfile` is app-level profile storage keyed by Cognito sub.
- `GameNote.authorId` remains unchanged and not denormalized.

### Custom operation contracts
- `upsertMyCoachProfile(firstName?: string | null, lastName?: string | null, shareLastNameWithCoaches?: boolean) -> CoachProfile`
- `getTeamCoachProfiles(teamId: string) -> TeamCoachProfileDTO[]`

`TeamCoachProfileDTO`:
- `coachId: string`
- `displayName: string | null`
- `isFallback: boolean`
- `disambiguationGroupKey: string | null`

### Authorization impact
- Direct profile CRUD remains owner-scoped.
- Team visibility only through membership-validated custom query.
- No broad list endpoint.

## Dependencies and Sequencing
1. Update spec and plan docs (this revision).
2. Implement backend model and operations with IAM constraints.
3. Implement frontend profile editing and dynamic team lookup hook.
4. Integrate attribution rendering and onboarding step.
5. Run full tests and `npm run gate:commit`.

## Risks and Edge Cases to Cover
- Privacy leakage if DTO returns more than display-ready fields.
- Collision instability if ordinal ordering rule is not deterministic.
- Stale attribution if refresh cadence slips beyond 60s target.
- Conflict handling UX for concurrent profile edits.
- Removed coach labels on historical notes.
- Legacy notes with null `authorId`.

## 10) Onboarding Integration

Profile completion is integrated into the QuickStartChecklist as Step #2, positioned right after team creation and before roster building.

**Checklist sequencing (7 total steps):**

| Step | Title | Completion Signal |
|------|-------|-------------------|
| 1 | Create your team | Team created |
| 2 | **Complete your profile** | **First name filled (non-null after trim)** |
| 3 | Add players to your roster | >= 1 player added |
| 4 | Set your formation | Formation assigned to team |
| 5 | Schedule a game | >= 1 game created |
| 6 | Plan your rotations | >= 1 game plan created |
| 7 | Manage a live game | Game with status in-progress or completed |

**Rationale:** Coaches should complete their profile early so their names are immediately available on the team for note attribution. Early positioning drives quicker completion and ensures attribution display is fully seeded before game execution.

**Checklist localStorage persistence:**
- Key: `quickStartChecklistDismissed` (boolean)
- Behavior: Auto-hides after all 7 steps complete; remains hidden on subsequent visits unless reset (step unchecked, manual reopen, or localStorage cleared)
- Persists across sign-out/sign-in

**Welcome Modal behavior:**
- Key: `welcomeModalDismissed` (boolean)
- Behavior: Shown on first app load; dismissal persists across sign-out and sign-in (localStorage-based, not per-user backend)
- New app install or cleared localStorage resets dismissal

**Welcome Modal callout:**

WelcomeModal (shown on first app load) introduces the concept:
- Brief greeting message
- **Profile callout:** Your first name helps teammates identify your notes during games.
- **Privacy assurance:** Your profile is shared only with coaches on your teams. You control what others see (first name only, or with last initial).
- CTA: Get Started button navigates to Profile tab

**Completion behavior:**

- Profile step completes when `CoachProfile.firstName` is non-null after normalization (trim + blank-to-null)
- Empty last name is allowed; step still completes if first name is filled
- Checklist shows completion state for 4 seconds then auto-dismisses, remaining hidden until reset condition is met

## 11. Test Strategy

## 11. Test Strategy

### Backend tests
- Query path asserts Team `GetItem` + chunked `BatchGetItem` and no scan usage.
- Membership enforcement and unauthorized access behavior.
- DTO minimization checks for privacy-off profiles.
- Upsert normalization (trim + blank-to-null).
- Upsert concurrency: create, optimistic update success, optimistic conflict.

### Frontend tests

**Profile form UX:**
- Save button disabled when firstName blank; enabled when non-empty
- "First name required" caption appears/clears appropriately
- Concurrent edit conflict handling: persistent inline alert with Retry + Discard buttons
- Conflict Retry refetch: fetches latest, repopulates form, clears alert, focuses First Name input
- Conflict Discard: clears alert without refetch
- Editing remains enabled during conflict display
- Mobile Cancel button triggers dirty confirmation ("Discard changes?")

**Attribution rendering:**
- `You` label renders only (no Coach N suffix); 0.9em, `--primary-green` bold
- `Former Coach` label: 0.9em, `--text-secondary` italic (same as Coach fallback; no tooltip)
- Placement: `Created by: [label]` footer line below note text, above actions
- Private/privacy-off display formats render correctly
- Duplicate disambiguation ordinals applied to other coaches only (not You)
- Missing profile renders `Coach`
- Removed coach renders `Former Coach`

**Refresh and lifecycle:**
- Attribution rendering matrix for You, full format, privacy-off format, missing profile, removed coach
- Dynamic refresh cadence: 60-second polling with no staleness badge displayed
- Focus-triggered refetch (tab entry, window focus regain)
- Profile edits visible within 60s without manual refresh or note mutation

**localStorage persistence:**
- `quickStartChecklistDismissed` key saves and restores across page navigation
- `welcomeModalDismissed` key persists across sign-out/sign-in
- Checklist auto-hides after all 7 steps and remains hidden unless reset
- Welcome modal shows on first app load; hidden on revisits if dismissed

### E2E tests
- Same-team attribution name visibility.
- Cross-team attribution denial (names not visible to other teams).
- Dynamic update reflects within 60s freshness target without manual refresh.
- Removed coach historical notes render `Former Coach` label.
- **Onboarding:** Quick Start Checklist step progression, profile step #2 completion behavior, Welcome Modal display and navigation, localStorage persistence across sign-out/sign-in.
- Conflict handling: concurrent edits trigger persistent alert, Retry refetches and succeeds, Discard clears alert.

### Commit gate
- Execute `npm run gate:commit` before commit.

## Out of Scope
- Public profile directory.
- Avatar/media profile fields.
- Rewriting historical notes.
