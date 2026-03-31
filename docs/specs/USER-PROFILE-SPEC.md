# User Profile Spec (Coach Profile for Note Attribution)

Status: Revised after architecture review
Date: 2026-03-29
Related Plan: docs/plans/COACH-PROFILE-PRE-GAME-NOTE-ATTRIBUTION-PLAN.md

## 1. Purpose and Scope

This spec defines app-level coach profiles used for pre-game note attribution, while preserving existing note authorship security.

In scope:
- app-level coach profile model
- same-team-only profile visibility
- attribution display using first name plus last initial when privacy allows
- fallback labels for missing or blank profiles
- deterministic duplicate disambiguation
- dynamic update with explicit freshness target and no manual refresh
- onboarding/profile completion step

Out of scope:
- public coach directory
- avatar/media profile fields
- modifying `GameNote.authorId`
- denormalizing author names into notes

## 2. Non-Negotiable Security Constraints

1. `GameNote.authorId` remains server-authoritative, immutable, and Cognito-sub based.
2. Secure note mutations remain unchanged for author spoof protection.
3. Coach name visibility is restricted to coaches on the same team.
4. Team membership checks are server-side.
5. Team coach profile query path must not use Scan operations.

## 3. Data Model

### 3.1 CoachProfile

Fields:
- `id: string` (required, equals Cognito sub)
- `firstName: string | null`
- `lastName: string | null`
- `shareLastNameWithCoaches: boolean` (default true)
- `displayNameFull: string | null` (optional optimization)
- `displayNamePrivacy: string | null` (optional optimization)
- `createdAt`, `updatedAt` (managed)

### 3.2 Canonical normalization rules

Normalization is required on all writes:
- trim leading/trailing whitespace from names
- persist blank post-trim values as `null`
- never persist empty string for name fields

## 4. Authorization and Query Path

### 4.1 Upsert authorization

- only authenticated coach can write own profile
- `identity.sub` is authoritative id, caller cannot override

### 4.2 Team query authorization

Custom query: `getTeamCoachProfiles(teamId: string)`

Required server path:
1. Read Team by id (`GetItem`).
2. Verify caller sub is in `Team.coaches`.
3. Read CoachProfile rows for `Team.coaches` via chunked `BatchGetItem`.
4. Build minimized attribution DTO.

Prohibited:
- DynamoDB Scan in this query path.

### 4.3 Visibility contract

- Coaches can see display names only for coaches who are currently on the same team.
- Removed coaches are not resolved via team profile query.
- No cross-team browse endpoint.

## 5. API Contracts

### 5.1 Mutation: upsertMyCoachProfile

Purpose:
- Create or update the caller profile.

Input:
- `firstName?: string | null`
- `lastName?: string | null`
- `shareLastNameWithCoaches?: boolean`
- `expectedUpdatedAt?: string` (optional optimistic concurrency token)

Server behavior:
- normalize names (trim, blank-to-null)
- create path when profile missing
- update path when profile exists
- enforce caller identity key

Concurrency semantics:
- if `expectedUpdatedAt` is provided, update must use conditional check on current `updatedAt`
- on mismatch, return conflict error
- if token is omitted, operation is last-write-wins

Return:
- updated `CoachProfile`

### 5.2 Query: getTeamCoachProfiles

Purpose:
- Return display-ready attribution data for all current coaches on team.

Input:
- `teamId: string`

Output DTO (PII-minimized):
- `coachId: string`
- `displayName: string | null`
- `isFallback: boolean`
- `disambiguationGroupKey: string | null`

PII rule:
- do not return full `lastName` when privacy is off
- prefer precomputed display fields or server-computed display values only

Error cases:
- team not found
- unauthorized (caller not in team coaches)

## 6. Attribution Rendering Rules

For each note author:
1. `authorId` null -> `Unknown Author`
2. `authorId === currentUserId` -> `You`
3. author id not in current team profile DTO -> `Former Coach`
4. DTO row with missing display -> `Coach`
5. DTO row with display -> use `displayName`

### 6.1 Display format

- privacy on and last name present: `FirstName LastInitial.`
- privacy off or no last name: `FirstName`

### 6.2 Duplicate disambiguation (non-sensitive)

Disambiguation must not expose id fragments.

Algorithm:
- group by normalized base display name
- for each collision group, sort coach ids lexicographically
- assign 1-based ordinal

## 7. Onboarding Integration

Profile completion is a required step in the QuickStartChecklist (Step #2) for first-time coaches.

**Completion signal:** First name is non-null after trim normalization (empty last name is allowed).

**UI guidance:** See `docs/specs/UI-SPEC.md` § 7.12 Onboarding for detailed layout, Welcome Modal content, and interaction patterns.

**Messaging:** Coaches are informed that their first name helps team coaches identify their notes during games, and that profile data is shared only with coaches on their teams.
- render suffix: `(Coach N)`

Example:
- `Alex P. (Coach 1)`
- `Alex P. (Coach 2)`

## 7. Dynamic Update and Freshness

Freshness target:
- attribution name data age must be at most 60 seconds during active usage

Client behavior:
- automatic background refetch every 60 seconds
- refetch on team switch
- refetch on notes view activation and window focus regain
- no manual refresh dependency

Result:
- profile edits are reflected on existing notes without note mutation and without manual refresh.

## 8. Removed Coach and Historical Notes Rule

Rule:
- if a coach is removed from team membership, remaining team coaches must no longer see that coach name in historical pre-game note attribution

Enforcement:
- because query resolves only current `Team.coaches`, removed coach ids are absent from DTO
- UI must render removed-author fallback label (`Former Coach`) for unmatched author ids

## 9. Onboarding / Welcome Requirements

- Add profile completion step to welcome/first-time checklist.
- Profile completion condition: normalized `firstName` is non-null and non-empty.
- Checklist counts and completion logic must be updated accordingly.
- Welcome Modal shown on first app load; dismissal persisted in localStorage and survives sign-out/sign-in.

## 9.1. Quick Start Checklist Persistence

**localStorage key:** `quickStartChecklistDismissed` (boolean)

**Behavior:**
- Checklist auto-hides when all 7 steps complete; shows completion state for 4 seconds then dismisses
- Remains hidden on subsequent visits unless reset (step unchecked, manual reopen, or localStorage cleared)
- Persists across sign-out/sign-in

## 9.2. Welcome Modal Persistence

**localStorage key:** `welcomeModalDismissed` (boolean)

**Behavior:**
- Shown on first app load only
- Dismissal persists across sign-out and sign-in (based on localStorage, not per-user backend state)
- New app install or cleared localStorage resets dismissal and shows modal on next login

## 10. Profile Form UX - Validation and Conflict Handling

### 10.1 Validation

**Save button state:**
- Disabled when normalized `firstName` (after trim + blank-to-null) is empty or null
- Enabled when `firstName` has non-whitespace content

**Inline validation caption:**
- Show below First Name field: "First name required" (`--text-secondary`, 0.85em)
- Caption clears as soon as field has non-whitespace text
- Last name and privacy toggle have no validation; both optional

### 10.2 Concurrent Edit Conflict Handling

**Conflict scenario:** When another browser session or client updates the same profile and optimistic concurrency token mismatches.

**UX Treatment:**
- Persistent inline alert (not auto-dismiss) above form: "Your profile was updated elsewhere."
- Provide two action buttons: **Retry** + **Discard**
- **Editing remains enabled** while conflict is shown (user can continue editing)
- **Retry behavior:** Fetches latest profile, repopulates form, clears alert, returns focus to First Name input
- **Discard behavior:** Clears alert without refetching; user abandons unsaved edits

### 10.3 Mobile Profile Layout

**Phone (< 768px):**
- Single-column vertical stack
- Save Profile button (full-width primary)
- Cancel button stacked below (full-width secondary)
- Cancel prompts "Discard changes?" confirmation if form is dirty; confirm clears unsaved edits

## 11. Attribution Rendering Clarifications

### 11.1 "You" Label Behavior

**Definition:** Render only when `authorId === currentUserId`

**Styling:** 0.9em, `--primary-green` bold

**Disambiguation:** Do NOT append `(Coach N)` suffix to the "You" label. Render "You" only.

### 11.2 Removed Coach Styling

**Definition:** Author formerly on team (removed from `Team.coaches`)

**Label:** `Former Coach`

**Styling:** 0.9em, `--text-secondary` italic — **same styling as Coach fallback** (when profile missing)

**No tooltip:** Unlike future "hover to see full name" patterns, removed coach styling is plain text with no disclosure controls.

### 11.3 Attribution Placement

**Format:** `Created by: [label]`

**Placement:** Footer caption line below note text and above action buttons

**Spacing:** 0.5em margin-top from note text, 0.5em margin-bottom from action row

### 11.4 Refresh Behavior—Silent 60s Cadence

**Freshness target:** Profile data no older than 60 seconds during active game-management session

**Refresh strategy:**
- Automatic background polling every 60 seconds
- Immediate refetch on: team change, notes tab focus entry, window focus regain

**User-facing behavior:**
- Refresh runs silently with **no staleness badge or indicator displayed**
- No manual refresh button; updates appear automatically in background
- Profile edits reflected within 60s without requiring note mutation

## 11. IAM Least Privilege Requirements

### 10.1 upsert-coach-profile lambda

- CoachProfile table only
- allowed actions: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`
- no wildcard table permissions

### 10.2 get-team-coach-profiles lambda

- Team table: `dynamodb:GetItem`
- CoachProfile table: `dynamodb:BatchGetItem`, `dynamodb:GetItem`
- read-only policy; no write actions

## 12. Migration and Backfill

- additive only; no destructive migration
- existing notes continue to render with fallback labels until profiles exist
- no historical note rewrite

## 13. Test Strategy

### 13.1 Backend

- no-scan query path test (assert GetItem + BatchGet usage)
- membership enforcement test
- DTO minimization and privacy test
- normalization test (trim and blank-to-null)
- upsert optimistic conflict and last-write-wins paths

### 13.2 Frontend

**Profile form UX:**
- First name validation: Save button disabled when firstName is blank; enabled when non-empty
- "First name required" caption appears and clears appropriately
- Concurrent edit conflict handling: persistent inline alert with Retry + Discard buttons
- Conflict Retry refetch: fetches latest, repopulates form, clears alert, focuses First Name input
- Conflict Discard: clears alert without refetch
- Editing remains enabled during conflict display
- Mobile Cancel button triggers dirty confirmation ("Discard changes?")
- Profile completion signal: non-null first name after trim normalization

**Attribution rendering:**
- Attribution rendering for You (no Coach N suffix), full format, privacy-off format, missing profile, removed coach
- removed coach styled as secondary italic (same as Coach fallback)
- "You" label rendered only for currentUserId (never with ordinal suffix)
- Duplicate disambiguation ordinal rendering for other coaches
- Attribution placement: `Created by: [label]` footer line below note text and above actions

**Refresh behavior:**
- Dynamic refresh cadence: 60-second polling with no staleness badge displayed
- Focus-triggered refetch (tab entry, window focus regain)
- Profile edits visible within 60s without manual refresh or note mutation

### 13.3 E2E

- same-team attribution visibility
- cross-team non-visibility
- profile update reflected within 60s without manual refresh
- removed coach historical notes render `Former Coach`

## 14. Acceptance Criteria

1. No-scan team query path is implemented and tested.
2. Name visibility remains same-team only.
3. Response DTO is PII-minimized and avoids full last-name leakage when privacy is off.
4. Attribution format and fallback rules are correct.
5. Duplicate disambiguation is deterministic and non-sensitive.
6. Name updates become visible within 60 seconds without manual refresh.
7. Name normalization persists blanks as null.
8. Upsert concurrency behavior is explicit and tested.
9. Removed coaches do not have names revealed in historical note attribution.
10. IAM policies for both lambdas satisfy least-privilege constraints.
