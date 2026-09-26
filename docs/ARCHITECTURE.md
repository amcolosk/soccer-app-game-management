# TeamTrack Architecture

**Last Updated**: February 2026

## Table of Contents
- [System Overview](#system-overview)
- [Authorization Model](#authorization-model)
- [Data Architecture](#data-architecture)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [Key Design Decisions](#key-design-decisions)
- [Technology Stack](#technology-stack)
 
## System Overview

TeamTrack is a Progressive Web App (PWA) for soccer coaches to manage teams, track player participation, and run games from the sideline. The application uses a formation-based architecture with a global player pool, enabling efficient team management and fair play time distribution.

### Core Capabilities
- **Team & Roster Management**: Create teams, assign players with jersey numbers and preferred positions
- **Pre-Game Planning**: Mark player availability, build rotation plans, drag-and-drop lineup builder
- **Real-time Game Management**: Live lineup management, substitutions, and play time tracking
- **Statistics & Reporting**: Season reports with play time distribution by player and position
- **Multi-Coach Collaboration**: Invite other coaches to co-manage teams via email invitations

## Authorization Model

All data models use `allow.ownersDefinedIn('coaches')` — every record has a `coaches: string[]` field containing the user IDs of coaches who can access it. This enables multi-coach team sharing: when a second coach accepts an invitation, their user ID is appended to the `coaches` array on the team and all related records.

```typescript
// Pattern used on every model
.authorization((allow) => [allow.ownersDefinedIn('coaches')])
```

When creating any record, always populate `coaches` with the current user's ID:
```typescript
await client.models.Team.create({
  name: "Eagles",
  coaches: [currentUserId],
  // ...
});
```

**Guest-auth exception (Milestones B1/B2 — Fan Mode + Sideline Stat Tracker).** `getFanGameView` was the first genuinely public/unauthenticated operation in the app: it's reachable from a `/watch/:token` link with no Cognito session at all, and carries `allow.guest()` **and** `allow.authenticated('identityPool')` instead of `allow.ownersDefinedIn('coaches')`. Milestone B2 added two more operations with the identical dual-role grant: `getStatTrackerView` (reachable from a `/track/:token` link) and `submitStatEvent` — the app's first unauthenticated **write**. `allow.authenticated('identityPool')` refers to the Amplify **Identity Pool's** IAM "authenticated" role — a different thing from the Cognito user-pool `allow.authenticated()` used everywhere else in this schema; both grants are needed because a signed-in coach opening their own link still resolves to the Identity Pool's authenticated role via `fetchAuthSession()`, not the guest/unauthenticated one. `ShareLink` and `FanViewRateLimit` (the models backing all three operations) stay fully closed (`allow.authenticated().to([])`, the same `CalendarFeed`-style pattern below) — no client of any kind reads/writes them directly, only the three Lambdas do, via `amplify/functions/shared/shareLinkAccess.ts`.

**`submitStatEvent`'s write mechanism and its IAM grant.** Every other Lambda in this repo writes via the raw DynamoDB SDK — correct for those, since none of them need a live subscriber to see the write instantly. `submitStatEvent` does: the coach's `GameManagement.tsx` screen is subscribed to `Goal`/`Shot`/`Save` via `observeQuery`, and a raw DynamoDB write does **not** fire that subscription (the same hazard already documented at `src/components/Home.tsx:135-145`). So `submitStatEvent`'s handler configures Amplify with `getAmplifyDataClientConfig()` (from `@aws-amplify/backend/function/runtime`) and calls `generateClient<Schema>({ authMode: 'iam' })`, routing the write through AppSync's real resolver pipeline — confirmed live against a real deployed sandbox before this milestone was built (the mechanism had zero in-repo precedent and was previously evaluated and rejected for exactly that reason, in `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md`'s "Decision 0"; B2 is the case where the tradeoff flips). This requires a schema-level grant — `a.schema({...}).authorization((allow) => [allow.resource(submitStatEvent).to(['mutate'])])` in `amplify/data/resource.ts` — which is **schema-wide and mutate-verb-wide by construction**: this Amplify version's `allow.resource()` has no per-model or per-CRUD-verb scoping at any level (`resource` is only exposed at the schema level, and that level's verb vocabulary is `['query', 'mutate', 'listen']`, no create/update/delete distinction). The grant therefore covers every model and every mutate verb for this one Lambda's execution role, not just `Goal`/`Shot`/`Save`-create. The real narrowing lives in the handler's own fixed, reviewed code: its `.create()` call sites on `Goal`/`Shot`/`Save` are hardcoded, and nothing in `submitStatEvent`'s public arguments (`token`/`outcome`/`playerId`/etc.) lets a caller choose which underlying model or verb the handler's `generateClient` call targets — so IAM is coarser than the real access-control boundary here, the same class of accepted tradeoff already documented for `getFanGameView`'s privacy design (worst case from a handler bug is a write to an unintended model from this one Lambda's role, never an externally-triggerable arbitrary mutation).

Every other model/operation is untouched by this exception.

## Data Architecture

### Entity Relationship Model

```
Formation ──────< FormationPosition   (reusable position templates)
Formation <────── Team
                  Team ──────< TeamRoster >────── Player
                  Team ──────< FieldPosition      (team-specific positions)
                  Team ──────< Game
                                 │
                                 ├──< PlayerAvailability >────── Player
                                 ├──< GamePlan ──────< PlannedRotation
                                 ├──< LineupAssignment >──── Player, FieldPosition
                                 ├──< Substitution >──── Player (in/out), FieldPosition
                                 ├──< PlayTimeRecord >──── Player, FieldPosition
                                 ├──< Goal >──── Player (scorer, assist)
                                 ├──< Shot >──── Player (shooter, "Us" only)
                                 ├──< Save >──── Player (goalkeeper, "Us" only)
                                 └──< GameNote >──── Player
                  Team ──────< TeamInvitation
                  Team ──────< ShareLink            (public link, Lambda-only)
```

### Data Models

#### **Formation**
Reusable position template (e.g., "4-3-3", "3-3-1") that can be assigned to multiple teams.
- `name`: String — e.g., "4-3-3"
- `playerCount`: Int — number of field players
- `sport`: String — default "Soccer"
- `coaches`: String[] — user IDs with access

**Relationships**: Has many `FormationPosition`, has many `Team`

---

#### **FormationPosition**
Individual position within a formation template.
- `formationId`: ID (FK)
- `positionName`: String — e.g., "Left Forward"
- `abbreviation`: String — e.g., "LF"
- `sortOrder`: Int
- `coaches`: String[]

**Note**: This is the *template* position. `FieldPosition` (below) is the team-specific runtime position.

---

#### **Team**
A team with formation reference and configuration.
- `name`: String
- `formationId`: ID (FK, optional)
- `maxPlayersOnField`: Int
- `halfLengthMinutes`: Int — default 30
- `sport`: String — default "Soccer"
- `gameFormat`: String — default "Halves"
- `coaches`: String[] — all coaches with access

**Relationships**: Belongs to `Formation`, has many `TeamRoster`, `FieldPosition`, `Game`, `TeamInvitation`

---

#### **Player**
Global player pool — players are not scoped to a team, they're shared via `TeamRoster`.
- `firstName`, `lastName`: String
- `isActive`: Boolean — default true
- `birthYear`: Int — optional (used for age-group filtering on roster)
- `coaches`: String[]

**Relationships**: Has many `TeamRoster`, `LineupAssignment`, `Substitution` (in/out), `PlayTimeRecord`, `Goal` (scorer/assist), `Shot`, `Save`, `GameNote`, `PlayerAvailability`

---

#### **TeamRoster**
Junction table linking a `Player` to a `Team` with team-specific data.
- `teamId`, `playerId`: ID (FKs)
- `playerNumber`: Int — jersey number
- `preferredPositions`: String — comma-separated `FieldPosition` IDs
- `isActive`: Boolean
- `coaches`: String[]

---

#### **FieldPosition**
Team-specific positions used for lineups and play time tracking. Unlike `FormationPosition` (which is a reusable template), these are created per team.
- `teamId`: ID (FK)
- `positionName`: String — e.g., "Forward"
- `abbreviation`: String — e.g., "FW"
- `sortOrder`: Int
- `coaches`: String[]

**Relationships**: Has many `LineupAssignment`, `Substitution`, `PlayTimeRecord`

---

#### **Game**
Scheduled match with opponent info and live timer state.
- `teamId`: ID (FK)
- `opponent`: String
- `isHome`: Boolean
- `gameDate`: DateTime
- `status`: String — `scheduled | in-progress | halftime | completed`
- `currentHalf`: Int — 1 or 2
- `elapsedSeconds`: Int — paused elapsed game time
- `lastStartTime`: String — ISO timestamp when timer last started (null = paused)
- `ourScore`, `opponentScore`: Int
- `coaches`: String[]

**Timer logic**: Current game time = `elapsedSeconds + (now - lastStartTime)` when running; `elapsedSeconds` alone when paused.

---

#### **PlayerAvailability**
Records each player's availability status for a specific game.
- `gameId`, `playerId`: ID (FKs)
- `status`: String — `available | absent | injured | late-arrival`
- `markedAt`: DateTime
- `notes`: String (optional)
- `coaches`: String[]

---

#### **GamePlan**
Pre-game rotation strategy.
- `gameId`: ID (FK)
- `rotationIntervalMinutes`: Int
- `totalRotations`: Int
- `startingLineup`: JSON — array of `{playerId, positionId}`
- `coaches`: String[]

**Relationships**: Has many `PlannedRotation`

---

#### **PlannedRotation**
One planned substitution interval within a `GamePlan`.
- `gamePlanId`: ID (FK)
- `rotationNumber`: Int
- `gameMinute`: Int — when this rotation should occur
- `half`: Int — 1 or 2
- `plannedSubstitutions`: JSON — array of `{playerOutId, playerInId, positionId}`
- `viewedAt`: DateTime — when coach last viewed this during the game
- `coaches`: String[]

---

#### **LineupAssignment**
Tracks which player is assigned to which position in a game (active lineup).
- `gameId`, `playerId`, `positionId`: ID (FKs)
- `isStarter`: Boolean
- `coaches`: String[]

---

#### **Substitution**
Records an actual substitution event during a game.
- `gameId`: ID (FK)
- `playerOutId`, `playerInId`: ID (FKs to Player)
- `positionId`: ID (FK to FieldPosition)
- `gameSeconds`: Int
- `half`: Int
- `timestamp`: DateTime
- `coaches`: String[]

---

#### **PlayTimeRecord**
Granular tracking of when a player entered/exited a position. This is the source of truth for all play time calculations.
- `gameId`, `playerId`, `positionId`: ID (FKs)
- `startGameSeconds`: Int — game clock when player entered
- `endGameSeconds`: Int — game clock when player left (null if still playing)
- `coaches`: String[]

Secondary index: `gameId` → `listPlayTimeRecordsByGameId`

---

#### **Goal**
A goal scored during a game.
- `gameId`: ID (FK)
- `scoredByUs`: Boolean — true = our team scored, false = opponent
- `gameSeconds`: Int
- `half`: Int
- `scorerId`, `assistId`: ID (FKs to Player, both optional)
- `notes`: String
- `timestamp`: DateTime
- `loggedVia`: Enum (`COACH | HELPER`, optional) — absent/undefined on a historical row is treated as `COACH`
- `coaches`: String[]

**Note**: `Goal` also carries an explicit `gameId`-hash-key secondary index (`listGoalsByGameId`) so `delete-game-safe` can `Query` its rows by physical GSI name instead of scanning the table — see `Shot`/`Save` below, which carry the same index for the same reason.

---

#### **Shot**
A shot taken during a game (on goal, either team). Every shot outcome — Goal, Saved, Blocked, or Wide — is entered through one unified coach-side flow (`ShotOutcomeEntry.tsx`) and its public-helper twin (`StatTrackerView.tsx`), which always write a `Shot` and conditionally a linked `Goal` (outcome `GOAL`) or `Save` (outcome `SAVED`) in the same submission — see `src/utils/shotOutcomeMapping.ts` (and its Lambda-side twin `amplify/functions/shared/shotOutcome.ts`) for the shared outcome → records mapping both surfaces use.
- `gameId`: ID (FK)
- `playerId`: ID (FK to Player, optional — only set when `takenByUs` is true, and required by the client-side validation in that case)
- `takenByUs`: Boolean — true = our team took the shot, false = opponent (named `takenByUs`, not `scoredByUs`, since a shot isn't "scored")
- `outcome`: Enum (`GOAL | SAVED | BLOCKED | WIDE`) — what happened to the shot. Replaces the earlier `onTarget: Boolean` field; `GOAL`/`SAVED` are the "on target" outcomes (a shot that scored or forced a save reached the frame), `BLOCKED`/`WIDE` are "off target".
- `gameSeconds`, `half`: Int
- `timestamp`: DateTime
- `loggedVia`: Enum (`COACH | HELPER`, optional)
- `coaches`: String[]

**Relationships**: Belongs to `Game` and (optionally) `Player`. Secondary index `listShotsByGameId`. A `Shot` with `outcome: GOAL`/`SAVED` is linked to its sibling `Goal`/`Save` record only by shared `gameId` + `gameSeconds` (no foreign key either direction) — a deliberate design choice so the two lists (Goals tab, Shots/Saves tab) stay independently queryable and editable without a join, at the cost of the two rows only being loosely correlated by the moment they were written.

---

#### **Save**
A save made during a game, either by our goalkeeper or the opponent's.
- `gameId`: ID (FK)
- `playerId`: ID (FK to Player, optional — the goalkeeper, when known; stays optional even when `byUs` is true, since a save can be logged before anyone identifies the keeper)
- `byUs`: Boolean — true = our keeper made the save, false = the opponent's keeper did (symmetric with `Shot.takenByUs`)
- `gameSeconds`, `half`: Int
- `timestamp`: DateTime
- `loggedVia`: Enum (`COACH | HELPER`, optional)
- `coaches`: String[]

**Relationships**: Belongs to `Game` and (optionally) `Player`. Secondary index `listSavesByGameId`.

---

#### **GameNote**
A notable event during a game (gold star, card, etc.).
- `gameId`: ID (FK)
- `noteType`: String — `gold-star | yellow-card | red-card | other`
- `playerId`: ID (FK, optional)
- `gameSeconds`, `half`: Int
- `notes`: String
- `timestamp`: DateTime
- `coaches`: String[]

---

#### **TeamInvitation**
Email-based invitation for a coach to join a team.
- `teamId`: ID (FK)
- `teamName`: String — denormalized for display during acceptance
- `email`: String
- `role`: Enum — `OWNER | COACH | PARENT`
- `status`: Enum — `PENDING | ACCEPTED | DECLINED | EXPIRED`
- `invitedBy`: String — userId of sender
- `invitedAt`, `expiresAt`: DateTime — invitations expire after 7 days
- `acceptedAt`: DateTime, `acceptedBy`: String
- `coaches`: String[]

Secondary index: `email + status` → `listInvitationsByEmail`

---

#### **Issue** / **IssueCounter**
In-app bug/feature request tracking. `IssueCounter` is Lambda-only (no client access). `Issue` is read-only for authenticated users and allows public API key reads.

---

#### **ShareLink**
A public, unguessable token granting read-only (`FAN`) or write (`STAT_TRACKER`) access to a team, with no Cognito account required by the viewer/helper. Fully closed model — same rationale as `CalendarFeed` — no client (coach or guest) ever reads/writes it directly; every access goes through a Lambda.
- `token`: String — primary key (`identifier`), `crypto.randomBytes(18).toString('base64url')`, not nanoid (not a project dependency)
- `teamId`: ID (FK)
- `type`: Enum — `FAN | STAT_TRACKER`
- `createdBy`: String — coach Cognito sub
- `issuedAt`: DateTime
- `revokedAt`: DateTime — null = active

Secondary index: `teamId` → `listShareLinksByTeamId` (physical name `shareLinksByTeamId`, used by `delete-team-safe`'s cascade and `archive-team`'s revoke sweep).

One active link per team per `type` — `generate-share-link` creates the replacement before revoking the old one, so a mid-process failure never leaves zero active links.

---

#### **FanViewRateLimit**
Rate limiting shared by every guest-reachable operation (`getFanGameView`/`getStatTrackerView`/`submitStatEvent`), keyed on **two independent dimensions** per request rather than one shared bucket — a single `[token, minuteBucket]` key would throttle out most of a live game's actual audience within the first two minutes of normal polling.
- `limiterKey`: String — `identity#<cognitoIdentityId>` (per-viewer, ~30/min read ceiling) or `token#<token>` (per-team billing circuit-breaker, ~600/min read ceiling); Milestone B2's write dimension prefixes both with `write#` (`write#identity#...`, ~20/min; `write#token#...`, ~400/min) so a helper's tapping and a fan's polling of the same team never share a budget. `dimension` defaults to `'read'` in `shareLinkAccess.ts`, so `getFanGameView`'s original call site is unprefixed/unchanged; only `submitStatEvent` passes `'write'` explicitly. Also doubles as `submitStatEvent`'s `clientEventId` idempotency row (`dedup#<clientEventId>`, ceiling of 1), reusing this table instead of a new one — but unlike the simple counters above, this row is a resumable **state machine** (`status`: `pending` → `shot-written` → `succeeded`, plus a transient `resuming` guard against concurrent retries of the same id) rather than a flat "already seen" marker. A shot-outcome submission is up to two writes (`Shot`, then conditionally `Goal`/`Save`); if the second write fails after the first succeeded, a naive no-op-on-retry would silently drop the second record forever. Instead, the release rule is **progress-based, not exception-type-based**: once any model write has succeeded this invocation, the row is never deleted on a later error (only its TTL clears it) and a subsequent retry with the same `clientEventId` re-reads the row, trusts only what's persisted in it (never the retry's own request arguments, since a resumed write can't assume a helper resubmitted identical values), and resumes from `shot-written` straight to the second write — see `amplify/functions/submit-stat-event/handler.ts`.
- `minuteBucket`: String — e.g. `"2026-09-06T18:32"`
- `count`: Int
- `ttl`: Int — DynamoDB TTL, ~10 min

`identifier`: `[limiterKey, minuteBucket]`. Both dimensions are checked independently by the shared `amplify/functions/shared/shareLinkAccess.ts` module.

---

#### **StatTrackerPlayer** / **StatTrackerViewResult** / **SubmitStatEventResult** (custom types, not models)
Milestone B2's curated payloads — not `a.model()`s, since they back operations reachable by an untrusted public client and follow the same `CalendarSyncResult`-style custom-type precedent `FanGameViewResult` already established. `StatTrackerViewResult` (returned by `getStatTrackerView`) deliberately carries the **full active roster with `playerId`s** — a materially different payload from `FanGameViewResult`'s anonymized on-field-only lineup, since the Stat Tracker's player picker needs real ids and `FanGameViewResult`'s privacy design explicitly avoids leaking them (see the "getFanGameView stays FAN-only" decision — these stay two separate operations composing the same `shareLinkAccess.ts` pipeline, not one type-gated one). `SubmitStatEventResult` is a structured `{ ok, reason }` (not a plain boolean) so the UI can distinguish `INVALID_LINK` / `RATE_LIMITED` / `GAME_NOT_LIVE` / `GAME_CHANGED` / `VALIDATION_FAILED` / `PARTIAL_WRITE` rejections with different copy — `PARTIAL_WRITE` specifically means the `Shot` write succeeded but the linked `Goal`/`Save` write did not, and is the one reason both `StatTrackerView.tsx` and `ShotOutcomeEntry.tsx` treat as retry-steering (same `clientEventId`, resumed server-side) rather than a flat failure. `StatTrackerViewResult` also carries `activeGoalkeeperId` (Save Auto-Goalkeeper Attribution) — the id of the player currently occupying a GOALKEEPER-role position, per an open `PlayTimeRecord`, or `null` when not in-progress, ambiguous, or the team has no GOALKEEPER-role `FormationPosition`; see `getCurrentGoalkeeperId` (`src/utils/playTimeCalculations.ts`) and its Lambda-side pure twin `computeActiveGoalkeeperId` (`amplify/functions/shared/goalkeeper.ts`). Each `StatTrackerPlayer` also now carries `playerNumber` (echoed straight from `TeamRoster.playerNumber`, nullable at the GraphQL level as a defensive measure) and a nested `position: StatTrackerPosition` (a new customType — the full resolved `FormationPosition` for that player's open `PlayTimeRecord`: `id`/`positionName`/`abbreviation`/`role`/`sortOrder`/`xPct`/`yPct`, `role` as a plain string mirroring the Lambda-side `PositionRoleLike` pattern, not the schema's `FormationPosition` enum ref). Both fields are newly public but strictly read-only/additive — no new mutation, no new write path — consistent with this payload's existing exposure of names and position names; `position` is populated under the exact same "has an open `PlayTimeRecord`" condition as `positionName` (non-null if and only if `positionName` is non-null — see the invariant comment on `StatTrackerPlayer.position` in `amplify/data/resource.ts`), feeding the Sideline Stat Tracker's field-layout pitch view (`src/components/FanMode/TrackerFieldLineup.tsx`), which reuses the coach view's `SoccerPitchSurface`/`buildLineupShapeNodes` layout mechanics (via the retyped `LineupShapePositionInput`, see "Two position models" in CLAUDE.md) without its content mapping.

---

## Frontend Architecture

### Navigation Structure

**`App.tsx` is no longer the sole router owner (Milestone B1).** `main.tsx` now hoists the single app-wide `<BrowserRouter>` and adds two public routes that sit *outside* the authenticated shell entirely — no Cognito session, no `Authenticator.Provider` — ahead of a catch-all that falls through to the lazy-loaded `AppRoot` (`Authenticator.Provider` + `Root`'s configuring/landing/authenticator/app branches, moved out of `main.tsx` into `src/AppRoot.tsx` and `React.lazy`-loaded so the public routes' bundle never pulls in `App.css`/the amplify-ui stylesheet/`Authenticator`). `App.tsx` itself now renders only `<Routes>` (no router) for the authenticated shell:

```
main.tsx
└── <BrowserRouter> + <Suspense fallback="Loading...">
    ├── /watch/:token  → FanGameView (public, unauthenticated, no AppLayout, no App.css)
    ├── /track/:token  → StatTrackerView (public, unauthenticated, no AppLayout, no App.css — Milestone B2)
    └── *              → AppRoot (lazy-loaded chunk)
                           └── Authenticator.Provider
                               └── App.tsx
                                   └── Authenticator (AWS Cognito)
                                       └── Main Application
                                           ├── Games Tab (default)
                                           │   ├── Team selector
                                           │   ├── Game list (upcoming + completed)
                                           │   ├── Schedule new game
                                           │   └── [Click game] → GameManagement
                                           │
                                           ├── Reports Tab
                                           │   └── SeasonReport
                                           │
                                           ├── Manage Tab
                                           │   └── Management
                                           │       ├── Teams (expandable: roster, sharing)
                                           │       ├── Formations
                                           │       └── Players
                                           │
                                           └── Profile Tab
                                               ├── User settings
                                               └── Pending invitations
```

`FanGameView` (`src/components/FanMode/FanGameView.tsx`) imports its own dedicated `src/components/FanMode/FanMode.css`, not `App.css` — a deliberate, narrow exception to this repo's single-stylesheet convention (see "Styling and types" in CLAUDE.md): `App.css` is imported exactly once, by `App.tsx`, which now sits behind the lazy `AppRoot` chunk, so importing it from `FanGameView` would pull ~4500+ lines into the public, unauthenticated bundle and defeat the code-splitting this restructure exists to provide. `index.css` (the CSS custom-property theme tokens) stays available either way, since `main.tsx` imports it directly at module scope.

Active game state is persisted to `localStorage` so a page refresh returns to the open game.

### Component Overview

| Component | Description |
|---|---|
| `GameManagement.tsx` | Live game operations: timer, lineup, substitutions, goals, notes |
| `GamePlanner.tsx` | Pre-game rotation planning interface |
| `LineupBuilder.tsx` | Drag-and-drop lineup assignment for each rotation slot |
| `PlayerAvailabilityGrid.tsx` | Mark players available/absent/late before a game |
| `SeasonReport.tsx` | Team stats and play time reports |
| `Management.tsx` | Team/player/formation administration |
| `InvitationManagement.tsx` | Send and manage team sharing invitations |

### Services (Business Logic)

| Service | Description |
|---|---|
| `rotationPlannerService.ts` | Fair rotation algorithm based on player availability and preferred positions |
| `substitutionService.ts` | Manages substitutions and play time records |
| `invitationService.ts` | Team invitation workflow |

### Utility Functions

Pure functions in `src/utils/`, each with a colocated `.test.ts` file:

| File | Purpose |
|---|---|
| `gameCalculations.ts` | Game timer, half detection, score tracking |
| `playTimeCalculations.ts` | Aggregate play time per player |
| `lineupUtils.ts` | Lineup validation and transformations |
| `gameTimeUtils.ts` | Convert between real time and game seconds |
| `validation.ts` | Form validation helpers |
| `playerUtils.ts` | Player name formatting, jersey number sorting |
| `rosterFilterUtils.ts` | Filter players by birth year |

### State Management

- **Component state** (`useState`): Form inputs, UI toggles, ephemeral filter state
- **Reducers** (`useReducer`): Complex forms like roster management
- **Custom hooks**: `useTeamData.ts` loads team with roster, positions, and games
- **Amplify client**: `generateClient<Schema>()` for all data operations
- **`localStorage`**: Active game/team persistence across page refreshes

## Backend Architecture

### AWS Amplify Gen2

Infrastructure as code defined in the `amplify/` directory.

**Configuration files:**
- `amplify/backend.ts` — wires up all backend resources and Lambda functions
- `amplify/data/resource.ts` — complete GraphQL schema with all data models
- `amplify/auth/resource.ts` — Cognito authentication configuration

### Lambda Functions

| Function | Trigger | Purpose |
|---|---|---|
| `send-invitation-email` | DynamoDB Stream on `TeamInvitation` | Sends styled HTML invitation emails via SES |
| `accept-invitation` | Custom GraphQL mutation | Adds accepting user's ID to `coaches` array on team and all related records (requires elevated IAM permissions) |
| `get-user-invitations` | Custom GraphQL query | Returns all invitations for the current user's email |
| `send-bug-report` | Custom GraphQL mutation | Creates an `Issue` record and sends notification email |
| `update-issue-status` | Custom GraphQL mutation | Updates issue status (accessible to both authenticated users and public API key) |
| `sync-team-calendar` | Custom GraphQL mutation | Parses an uploaded `.ics` file or fetches+parses an SSRF-hardened feed URL, reconciles events against existing `Game` rows, and writes creates/updates via the DynamoDB SDK (see "Calendar Feed Import" below) |
| `unlink-team-calendar` | Custom GraphQL mutation | Deletes the team's `CalendarFeed` row and clears `Team` status fields; leaves already-imported `Game.external*` fields untouched |
| `generate-share-link` | Custom GraphQL mutation (coach-authenticated) | Verifies caller ∈ `team.coaches`, rejects archived teams, validates `type`, writes a new `ShareLink` (random token) then revokes any existing active link of that type (create-before-revoke ordering) |
| `revoke-share-link` | Custom GraphQL mutation (coach-authenticated) | Looks up `ShareLink` by token → resolves team → verifies caller membership → sets `revokedAt` |
| `list-team-share-links` | Custom GraphQL query (coach-authenticated) | Verifies caller membership, returns every `ShareLink` for the team as curated `ShareLinkSummary` records (Sharing & Permissions UI) |
| `get-fan-game-view` | Custom GraphQL query (**guest + authenticated identityPool**) | Composes `amplify/functions/shared/shareLinkAccess.ts`: token→team validation, dual-dimension rate limiting, the 4-branch game-selection algorithm, then assembles the anonymized `FanGameViewResult` payload |
| `get-stat-tracker-view` | Custom GraphQL query (**guest + authenticated identityPool**, Milestone B2) | Composes the same `shareLinkAccess.ts` pipeline (as `type: 'STAT_TRACKER'`), then batch-fetches the team's active roster (`TeamRoster.isActive`, via the `gsi-Team.roster` physical index + chunked `BatchGetItem` on `Player`) into a curated `StatTrackerViewResult` — full roster with `playerId`s, unlike `FanGameViewResult`'s anonymized payload. Save Auto-Goalkeeper Attribution: when `game.status === 'in-progress'`, also queries `PlayTimeRecord`'s `playTimeRecordsByGameId` GSI and batch-gets `FormationPosition` to derive `activeGoalkeeperId` (two new env vars/IAM grants — see `amplify/backend.ts`). Live score fix: also queries `Goal`'s `goalsByGameId` GSI (`GOAL_TABLE` env var + Query-only IAM grant on that one index, no `grantReadData`), gated on the broader `isLive` (in-progress OR halftime, unlike the narrower `isInProgress` above), and derives `ourScore`/`opponentScore` from those rows via `amplify/functions/shared/score.ts`'s `resolveScore` instead of the stale persisted `Game` row — see "Game timer is client-side" in CLAUDE.md for the parity-tested client twin |
| `submit-stat-event` | Custom GraphQL mutation (**guest + authenticated identityPool**, Milestone B2) | The app's first unauthenticated write: validates the token/rate-limit/game-liveness/`expectedGameId` echo (the wrong-game-race guard) and the event's own rules (roster-membership, assist≠scorer, valid `outcome`), derives `gameSeconds`/`half` server-side via the Lambda-side `gameClock.ts` mirror, then always writes a `Shot` row and — for `outcome: GOAL`/`SAVED` — a second, linked `Goal`/`Save` row, both derived from the shared `outcome` → records mapping (`amplify/functions/shared/shotOutcome.ts`, the Lambda-side twin of `src/utils/shotOutcomeMapping.ts`), through real AppSync mutations (`generateClient<Schema>({ authMode: 'iam' })`, not the DynamoDB SDK) so the coach's live subscription fires. The two-write sequence is protected by the resumable `FanViewRateLimit` dedup state machine described above, so a retried `clientEventId` resumes rather than double-writing the `Shot` or dropping the second write |

### GraphQL Operations

Standard CRUDL auto-generated by Amplify (`list`, `get`, `create`, `update`, `delete`) plus custom operations:
- `acceptInvitation` mutation — adds user to team coaches
- `getUserInvitations` query — fetches invitations by email
- `submitBugReport` mutation — creates issue with email notification
- `updateIssueStatus` mutation — updates issue status
- `syncTeamCalendar` mutation — imports/re-syncs a team's schedule from an `.ics` file or feed URL
- `unlinkTeamCalendar` mutation — removes a team's saved calendar feed
- `generateShareLink` mutation — creates (and rotates) a team's public share link for a given `type` (`FAN` or `STAT_TRACKER`)
- `revokeShareLink` mutation — revokes a share link by token
- `listTeamShareLinks` query — lists a team's share links (active and revoked) for the Sharing & Permissions UI
- `getFanGameView` query — the public, guest-reachable Fan Mode read
- `getStatTrackerView` query — the public, guest-reachable Stat Tracker read (roster + current-game state for the tap UI; Milestone B2)
- `submitStatEvent` mutation — the public, guest-reachable Stat Tracker write (Milestone B2); together with the two queries above, these are the only three operations in the schema carrying `allow.guest()`

### Calendar Feed Import

Lets a coach link an external team calendar (e.g. a PlayMetrics `.ics` feed)
to a TeamTrack team and have TeamTrack create/update the team's `Game` rows
automatically. Full design: `docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md`.
Provider adapter grammar: `docs/specs/CALENDAR-IMPORT-SPEC.md`.

- **Parsing is entirely server-side**, in `sync-team-calendar`, for both the
  file-upload and feed-URL entry points — the browser never parses an `.ics`
  file itself. `amplify/functions/shared/ical/parser.ts` is a generic
  RFC-5545 core (line unfolding, property parsing, `Intl`-based timezone
  resolution); `amplify/functions/shared/ical/adapters/` holds
  provider-specific interpretation (PlayMetrics description-prose parsing,
  plus a generic SUMMARY/LOCATION fallback for any other feed).
- **The feed URL is a bearer credential and is never client-readable.** It
  lives in its own `CalendarFeed` model, keyed directly by `teamId`, with
  `allow.authenticated().to([])` — no client grants at all. Non-secret status
  (`calendarFeedProvider`, `calendarFeedTeamAlias`, `calendarFeedHost` —
  display-only hostname, never the full URL — `calendarFeedLastSyncedAt`,
  `calendarFeedLastError`) lives on `Team`, coach-read-only.
- **`Game.external*` fields** (`externalUid`, `externalSource`,
  `externalSequence`, `externalContentHash`, `externalSyncedAt`,
  `externalCancelled`, `externalHomeAwayUnverified`, `externalAdoptedAt`) are
  coach-read-only, written only by the Lambda via the DynamoDB SDK.
  `locationName`/`locationAddress`/`arriveByTime` stay coach-writable but are
  overwritten on the next sync if the feed's content hash changes.
- **Reconciliation** matches by `(externalUid, externalSource)` first, then
  falls back to "adoption" — a hand-created game within ±3 hours of a feed
  event's `gameDate` is linked to that event (its `Game.id` unchanged)
  instead of being duplicated, so a coach's pre-existing hand-entered
  schedule survives linking a feed. Every write to an existing game carries a
  `ConditionExpression` on `status = 'scheduled'`; a game in any other status
  is left untouched (never overwritten mid-game or after completion), and a
  `ConditionalCheckFailedException` from a status-changed-mid-sync race is
  counted, not thrown. New games get a **deterministic id**
  (`sha256(teamId|externalSource|externalUid)`, UUIDv4-shaped) so a retried
  or double-tapped sync can't create duplicates.
- **SSRF hardening** (`amplify/functions/sync-team-calendar/fetchFeed.ts`):
  `https:`-only, a host allowlist (`calendar.playmetrics.com` to start) —
  the load-bearing control, since DNS rebinding defeats a pre-flight IP check
  alone — private/special-IP validation re-run after every redirect, a
  redirect cap, and response size/timeout/content-type caps. The file-upload
  path has no network fetch and therefore no SSRF surface.
- **DynamoDB SDK writes bypass AppSync subscriptions** (same gap
  `createGameSafe` already has — see Key Design Decision below), so
  `syncTeamCalendar` returns full `Game` objects in its `CalendarSyncResult`
  and `Home.tsx` absorbs `createdGames` via the same `pendingCreatedGames`
  overlay `createGameSafe` uses, while `updatedGames` (including adopted
  games) force a re-subscribe via `gameRefreshKey`, since an id already
  present in the live `games` list can't be overlaid.

### Data Consistency

DynamoDB uses eventual consistency. Mitigations in place:
- `observeQuery()` used in `GameManagement` and `SeasonReport` for reactive real-time updates
- `PlayTimeRecord` has a secondary index on `gameId` for efficient per-game queries
- E2E tests include wait times for data propagation

## Key Design Decisions

### 1. `coaches` Array for Multi-User Authorization
Every model carries a `coaches: string[]` field. This enables Amplify's `ownersDefinedIn` authorization to work for shared teams without a separate permission table. When a coach accepts an invitation, the `accept-invitation` Lambda appends their user ID to every relevant record.

### 2. Two Position Models: FormationPosition vs FieldPosition
- **`FormationPosition`**: Template positions in a reusable formation (e.g., the "GK" in the "4-3-3" template).
- **`FieldPosition`**: Team-specific runtime positions used for actual lineups, substitutions, and play time tracking.

This separation allows formation templates to be shared and reused while giving each team control over their actual playing positions.

### 3. Global Player Pool
Players are global entities linked to teams via `TeamRoster`. A player can appear on multiple teams without duplication. Team-specific data (jersey number, preferred positions) lives on the `TeamRoster` record.

### 4. Client-Side Timer
The game timer runs client-side and syncs to DynamoDB periodically:
- `lastStartTime` (ISO string) + `elapsedSeconds` = current game time when running
- `lastStartTime = null` = timer paused; `elapsedSeconds` is the ground truth
- Auto-pauses when `elapsedSeconds` reaches `halfLengthMinutes * 60`
- The conversion formula itself lives in `src/utils/gameClock.ts` (`computeCurrentGameSeconds`) — extracted from `useGameSubscriptions.ts` in Milestone B1 so the public `FanGameView` page (which runs the same formula locally on a 1-second tick, seeded from each poll) can't silently diverge from the authenticated app's timer logic
- Milestone B2 adds a **Lambda-side mirror** at `amplify/functions/shared/gameClock.ts` — a Lambda can't import from `src/`, so `submitStatEvent` derives a helper-submitted event's `gameSeconds`/`half` server-side from this parity-tested duplicate (never trusted from the untrusted public client); `gameClock.test.ts` in that same directory asserts both copies produce identical output for the same inputs

### 4a. Game-state race guards (`useGameSubscriptions.ts` / `useGameTimer.ts` / `GameManagement.tsx`)

The live-game screen holds two independent sources of truth for game state — local component state (driven by direct coach actions) and the `Game.observeQuery` subscription (driven by DynamoDB, including this device's own writes echoing back, another coach's device, and out-of-order/buffered AppSync events). Reconciling them needs a set of guard refs, each protecting against a specific race that has previously shipped as a bug (issues #49, #31, #177) or been caught in review while building the timer-gap-confirmation feature. As of this writing:

| Ref | File | Guards against |
|---|---|---|
| `manuallyPausedRef` | `useGameSubscriptions.ts` | The subscription auto-resuming a deliberate local pause; reset only when the confirmed-pause DB write (`lastStartTime: null`) echoes back |
| `isRunningRef` | `useGameSubscriptions.ts` | Re-entering auto-resume logic while this device is already running; lets the subscription effect skip re-subscribing on every timer tick |
| `gameStateRef` | `useGameSubscriptions.ts` | Reading stale local status/half inside the subscription closure without adding them to the effect's `[game.id]`-only deps |
| `pendingGapCorrectionRef` | `useGameSubscriptions.ts` | Re-proposing, or silently applying underneath, an already-open gap-confirmation dialog |
| `userIdRef` | `useGameSubscriptions.ts` | The same staleness problem as `gameStateRef` — `userId` loads asynchronously well after this effect's one-time subscribe |
| `lineupSyncInProgressRef` | `useGameSubscriptions.ts` | Concurrent execution of the game-plan → lineup sync effect (a separate concern from the `Game.observeQuery` guards above) |
| `halftimeTriggeredRef`, `endGameTriggeredRef` | `useGameTimer.ts` | Duplicate auto-halftime/auto-end firing from the 500ms tick |
| `startGameInProgressRef`, `halftimeInProgressRef`, `endGameInProgressRef` | `GameManagement.tsx` | Duplicate handler invocation from an auto-trigger and a manual button firing together |
| `halftimePtrClosePendingRef` | `GameManagement.tsx` | Tracking the cross-device `PlayTimeRecord` backstop retry needed before second-half start (see Data Consistency, PlayTimeRecord) |

**Why refs, not effect deps:** the `Game.observeQuery` subscription in `useGameSubscriptions.ts` intentionally has `[game.id]`-only deps — recreating it on every state change would mean a brief resubscribe window on every timer tick or coach action. Anything the subscription's `next` callback needs to read at call time, rather than at the moment the effect first ran, has to go through a ref kept in sync every render — not destructured directly from a hook param or `useState`. Skipping this for a new value is exactly how the `userId` bug happened (a dead feature for an entire session, caught in review): a value that's genuinely constant for the life of one `game.id` doesn't need this; a value that can change afterward (auth state loading in, local UI state, pending async results) does.

**Extending this safely:** `useGameSubscriptions.ts`'s `next` callback separates into (a) an early-return sequence with an explicit, load-bearing execution *order* (the `completed`-status short-circuit, the stale-event checks, the `manuallyPausedRef` reset, then the `isRunningRef` check — reordering any of these has broken this callback before) and (b) three extracted, pure, order-independent decision functions (`classifyIncomingGameEvent`, `mergeIncomingGameState`, `computeGapConfirmationDecision`) with no refs or side effects. A new race-guard almost always belongs in (a), read from a new ref; a new *pure* decision that doesn't need to mutate anything belongs in a new function like (b). Don't collapse the two into one shared shape — the distinct inputs each part needs (a functional-updater `prev`, a pre-update local snapshot, an already-dereferenced ref value) are what keep each piece testable in isolation.

### 5. Granular PlayTimeRecord
Individual enter/exit records rather than aggregated totals. This provides a complete audit trail, enables per-position breakdowns, and powers the fair play algorithm. Records store game clock seconds (not wall clock) for accuracy across pauses.

### 6. Pre-Game Rotation Planning
`GamePlan` and `PlannedRotation` store a complete rotation schedule before the game starts. The `rotationPlannerService` generates balanced rotations that equalize play time across available players while respecting preferred positions. Coaches can accept, modify, or ignore the plan during the game.

### 7. Progressive Web App
Installable on mobile and desktop. Service worker caching via Workbox enables offline access for in-progress games. Coaches often have limited connectivity on the sideline.

## Technology Stack

### Frontend
- **React 18** + **TypeScript**
- **Vite** — build tool with PWA plugin (Workbox)
- **AWS Amplify JS** — data client and authentication

### Backend
- **Amazon Cognito** — authentication
- **AWS AppSync** — GraphQL API
- **Amazon DynamoDB** — database (with Streams for Lambda triggers)
- **AWS Lambda** — custom business logic
- **Amazon SES** — transactional email
- **AWS Amplify Hosting** — CI/CD and hosting at coachteamtrack.com

### Testing
- **Vitest** — unit tests (colocated with source)
- **Playwright** — E2E tests (`e2e/` directory)
- **ESLint** — linting

---

**Last Review**: February 2026
