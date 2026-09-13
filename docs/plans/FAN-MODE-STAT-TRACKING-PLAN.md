# Fan Mode + Sideline Stat Tracking Mode

## Context

Coaches currently run games solo through `GameManagement.tsx`, and every collaborator — including a "read-only" parent invitee — ends up with full Cognito-authenticated, coach-level data access (`allow.ownersDefinedIn('coaches')` on every model). Two gaps prompted this feature:

1. **Parents/fans have no lightweight way to follow a live game.** The existing `TeamInvitation` `PARENT` role requires a full Cognito signup and, despite being UI-labeled "read-only," grants unrestricted read/write access once accepted — there's no actual read-only enforcement anywhere in the app.
2. **There's no way to capture shot/save stats, or to offload live stat entry to a non-coaching helper** (parent/assistant) standing on the sideline while the coach focuses on subs and lineup.

Both features need genuinely public access — no Cognito account for the viewer/helper — which is new territory for this app: `defineData` today has only `defaultAuthorizationMode: "userPool"` (confirmed `amplify/data/resource.ts:744-749`, zero `allow.guest()`/`allow.publicApiKey()` anywhere in the schema), and `src/main.tsx` gates the whole app behind `authStatus === 'authenticated'`. The team has already been burned by underscoping exactly this kind of exposure once — see the `CalendarFeed` model's hardening comment (`amplify/data/resource.ts:586-594`), added after an architecture review found the first draft let "a caller who knows a teamId... plant a row the real coaches couldn't see or remove." This plan follows that same hardened pattern deliberately.

**Confirmed product decisions** (from user Q&A):
- Fan Mode: live score/clock/lineup/events, via **one persistent public link per team** (no login).
- Stat Tracking: **Goals, Assists, Shots (on/off target), Saves** — logged by a **non-coach helper via a public link with write access** (no login).
- New event data lives in **new linked models**, additive to `Game`/`PlayTimeRecord`/`Substitution`.

**This plan has been through two rounds of independent review.** Round 1 (informal, pre-branch) caught: a nested-`BrowserRouter` crash in the original routing sketch, and a critical gap where Lambda→DynamoDB-SDK writes never fire AppSync subscriptions, verified against the exact same hazard already hit and documented in this codebase at `src/components/Home.tsx:135-145`. Round 2 (formal `architect-reviewer` + `ui-reviewer` passes, on this branch) caught, and this revision folds in: two build-breaking gaps in Milestone A's data model (missing reciprocal `hasMany` relations; an incomplete file list that omitted `useOfflineMutations.ts`/`useGameSubscriptions.ts`), a `Save`/`Shot` data-model naming/completeness gap, a measured tab-bar-width regression from the originally-proposed 6th tab, a missing duplicate-tap guard for the public write flow, an incorrect claim about where the game-clock formula lives, and several documentation-completeness gaps. All findings below are folded in; the design decisions and file paths reflect the corrected version. `ui-reviewer` asked for one more look at Milestone A's revised UI section specifically before implementation starts — see that milestone's UI Review Follow-up note.

## Key existing precedents to reuse (not reinvent)

- **`Goal` model** (`amplify/data/resource.ts:318-335`) is the template shape for a per-event game stat (`gameId`, `gameSeconds`, `half`, optional player refs, `timestamp`, `coaches[]`) — template for new `Shot`/`Save` models.
- **`Game.goals: a.hasMany('Goal','gameId')`** (`resource.ts:182`) and **`Player.goalsScored`/`Player.assists`** (`resource.ts:122-123`) — this codebase declares **both sides** of every relationship; Gen2 rejects a one-sided `belongsTo` at schema-build time. New `Shot`/`Save` models need the same reciprocal `hasMany` treatment (see Milestone A below) — this was missed in the first draft and would have failed `npm run build` on the first commit.
- **`CalendarFeed` model** (`amplify/data/resource.ts:595-601`) is the template for any model reachable by a non-coach: `allow.authenticated().to([])` (or `allow.guest().to([])`) — **zero direct client grants**, all access via Lambda IAM.
- **`BugReportRateLimit` model** (`amplify/data/resource.ts:432-443`, keyed `[userId, hourBucket]`, DynamoDB TTL) is the template for rate-limiting.
- **`createGameSafe`/`deleteGameSafe`/`archiveTeam`** Lambda-mutation pattern — authenticated custom mutations that do their own authorization check inside the handler — template for coach-side "generate/revoke share link" mutations. `createGameSafe` also has an archived-team guard (`amplify/data/resource.ts:568-572`) the new coach-side mutations should mirror.
- **`CalendarSyncResult`-style custom type** (`amplify/data/resource.ts:603-654`) is precedent for returning a curated custom type instead of `a.ref('Game')`/`a.ref('Team')` from a query — this codebase already hit and solved "cannot `.ref()` a model from a custom type" here, and already paid the cost of getting model-vs-custom-type returns wrong (at deploy time, not `tsc`/test time). Any operation whose model has zero client grants (like `ShareLink`) must return a custom type for the same reason — see Milestone B1.
- **`coachArraySync.ts`** (`amplify/functions/shared/coachArraySync.ts:126-160`) is the in-repo precedent for a Lambda querying a GSI by its **physical** index name (not its GraphQL `queryField` name) via the raw DynamoDB SDK, including the "confirmed index name" evidence standard (inspecting `.amplify/artifacts/cdk.out`). Any lifecycle-cascade handler using `QueryCommand` against a new `gameId` GSI needs this same pattern, not the GraphQL `queryField`.
- Score is **derived, not stored, during play**: `GoalTracker.tsx:87-93,145-153` shows `ourScore`/`opponentScore` are computed live from `Goal` records and only written back to `Game` at completion-time reconciliation.
- **Lambda writes via the DynamoDB SDK do not fire AppSync subscriptions** — this is a known, previously-hit, already-documented hazard in this exact codebase (`src/components/Home.tsx:135-145`, referencing `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md` Decision 0/3). Any new Lambda write that a coach's live screen needs to see in real time must go through AppSync (IAM-signed), not a raw `PutCommand`.
- **`LineupPanel.tsx`'s `pendingRemovalIds` pattern** (`LineupPanel.tsx:71-132`, added in PR #172) — a client-side "in flight" id set that hides/disables a just-tapped item immediately, before its mutation round-trips back through the subscription, specifically to stop a user from re-tapping something that already fired. This is the direct precedent for the duplicate-tap guard the public Stat Tracker page needs (see Milestone B2) — arguably more urgently there, since an unauthenticated helper has no other way to confirm a tap landed.
- `isReadOnly` props exist on `LineupPanel.tsx`, `PlannerLineupView.tsx`, `PreGameNotesPanel.tsx`, `shape/LineupShapeView.tsx` — **not directly reused here**: those components are typed against coach-scoped model shapes that the curated Fan Mode payload won't satisfy, so Fan Mode gets new standalone read-only components instead. Noted explicitly so a future reviewer doesn't re-ask.

## Recommended phasing

Three milestones, each its own full `dev-pipeline` cycle (squarely "Larger: 3+ files, architecture/security-relevant" per CLAUDE.md):

- **Milestone A — Stats data model + coach-only UI.** New `Shot`/`Save` models, `loggedVia` field on `Goal`/`Shot`/`Save`, a new tab in `GameManagement.tsx` for the coach to log them directly. Stays entirely inside the existing `ownersDefinedIn('coaches')` pattern.
- **Milestone B1 — Fan Mode (public read only).** `ShareLink` model, the 3 authenticated coach-side link-management mutations, `getFanGameView`, the routing restructure, the Fan Mode page. This lands the guest-auth mechanism and the routing change with **zero unauthenticated write exposure** — if the guest IAM scoping turns out wrong, the blast radius is a curated read payload, not a write into game records.
- **Milestone B2 — Sideline Stat Tracker (public write).** `ShareLinkRateLimit`, `submitStatEvent` (writing through AppSync, not raw DynamoDB, per the subscription finding above), the Stat Tracker page. This is the first unauthenticated write path in the app's history — it gets its own review cycle rather than riding along with Fan Mode.

---

## Milestone A — Stat models + coach UI

### UI Review Follow-up

`ui-reviewer` reviewed this milestone's UI section twice: once against the original "6th tab" sketch (no-go — see rationale below) and this revision replaces that with a segmented sub-view. Per the pipeline's own instructions, re-run `ui-reviewer` once more against this specific revised section before `coding-agent` starts, since the reviewer asked to see the corrected approach, not just take the writeup's word for it.

### Data model (`amplify/data/resource.ts`)

```ts
Shot: a.model({
  gameId: a.id().required(),
  game: a.belongsTo('Game', 'gameId'),
  playerId: a.id(),
  player: a.belongsTo('Player', 'playerId'),
  takenByUs: a.boolean().required(),   // renamed from an earlier `scoredByUs` draft — a shot
                                        // isn't "scored"; this reads correctly next to
                                        // Goal.scoredByUs and Save.byUs (below) instead of
                                        // colliding in meaning with either.
  onTarget: a.boolean().required(),
  gameSeconds: a.integer().required(),
  half: a.integer().required(),
  timestamp: a.datetime().required(),
  loggedVia: a.enum(['COACH', 'HELPER']),   // absent/undefined == COACH (legacy-safe default)
  coaches: a.string().array(),
})
  .secondaryIndexes((index) => [index('gameId').queryField('listShotsByGameId')])
  .authorization((allow) => [allow.ownersDefinedIn('coaches')]),

Save: a.model({
  gameId: a.id().required(),
  game: a.belongsTo('Game', 'gameId'),
  playerId: a.id(),           // goalkeeper, when known
  player: a.belongsTo('Player', 'playerId'),
  byUs: a.boolean().required(),   // symmetric with Shot.takenByUs — without this, "our keeper
                                   // saved a shot" and "the opponent's keeper saved our shot"
                                   // are indistinguishable, which breaks any season-report
                                   // split of saves-for vs. saves-against. `playerId` stays
                                   // optional (a save can be logged before anyone identifies
                                   // the keeper), but `byUs` is always required.
  gameSeconds: a.integer().required(),
  half: a.integer().required(),
  timestamp: a.datetime().required(),
  loggedVia: a.enum(['COACH', 'HELPER']),
  coaches: a.string().array(),
})
  .secondaryIndexes((index) => [index('gameId').queryField('listSavesByGameId')])
  .authorization((allow) => [allow.ownersDefinedIn('coaches')]),
```

**Reciprocal relationships — required, not optional.** Add to the existing `Game` model: `shots: a.hasMany('Shot', 'gameId')`, `saves: a.hasMany('Save', 'gameId')` (alongside its existing `goals: a.hasMany('Goal', 'gameId')` at `resource.ts:182`). Add to the existing `Player` model: `shots: a.hasMany('Shot', 'playerId')`, `saves: a.hasMany('Save', 'playerId')` (alongside its existing `goalsScored`/`assists` at `resource.ts:122-123`). Without these, Gen2 rejects the one-sided `belongsTo` at schema-build time and `npm run build` fails on the first commit.

Add `loggedVia: a.enum(['COACH', 'HELPER'])` to `Goal` too. **Contract**: `a.enum()` can't be `.required()` (see existing precedent/comment at `resource.ts:344`) — every write path (client `GoalTracker.tsx`, the new coach-side Shot/Save UI, and Milestone B2's `submitStatEvent`) must explicitly set this field; a record with it unset/absent is treated as `COACH` everywhere it's read (UI badge logic, any future filtering).

**Also add `index('gameId')` to `Goal`** (it currently has none — `delete-game-safe/handler.ts:142` falls back to a table `scanAll` for goals today). This removes an existing scan and keeps all three stat models consistent — see Lifecycle wiring below for how the cascade handlers actually use it.

**Known gap this milestone introduces (record it here, since these tables start existing here, even though it isn't fully addressed until later):** `accept-invitation`'s `coaches[]` backfill covers `Team`/`TeamRoster`/`Player`/`Formation`/`FormationPosition`/`Game` only, not `Goal` — a co-coach accepting an invitation after a game can't see its goals. `Shot`/`Save` inherit the same gap the moment they exist. Likewise `revoke-coach-access` cascades five tables, not `Goal` — a revoked coach retains read access to `Goal` rows, and will to `Shot`/`Save`. Not fixed by this plan (pre-existing, unrelated scope), but flagged here rather than left to be re-discovered later.

### Lifecycle wiring (do not skip — these tables don't exist yet, but the moment they do, every place that currently cascades `Goal` needs the same treatment)

- `amplify/functions/delete-game-safe/handler.ts` — add `Shot`/`Save` to the `Promise.all([...scanAll/query...])` block (~line 140) and the delete loops (~line 166). This handler uses the raw DynamoDB SDK with no GraphQL client, so it **cannot** call the `listGoalsByGameId`/`listShotsByGameId`/`listSavesByGameId` GraphQL `queryField`s directly — it needs `QueryCommand` against the GSI's **physical** name, resolved the same way `coachArraySync.ts:126-160` already does (inspect `.amplify/artifacts/cdk.out` to confirm the synthesized index name, same evidence standard used elsewhere in this repo). Note as an accepted tradeoff: a GSI read has higher propagation lag than a table scan, so a game deleted within seconds of a goal being logged could theoretically miss it where the old scan wouldn't — acceptable, but state it rather than let it be a silent behavior change.
- `amplify/functions/delete-team-safe/` and `amplify/functions/delete-player-safe/` — both already cascade `Goal` (`amplify/backend.ts:287,313`); add `Shot`/`Save` alongside, plus the matching table grants and `*_TABLE` env vars in `amplify/backend.ts`, plus entries in each handler's rollback-snapshot stack.
- `src/utils/e2eCleanup.ts:14-17` — add `'Shot'`, `'Save'` to the cleanup model list so E2E runs don't leak rows.

### Frontend

- **No new top-level tab.** `TabNav.tsx` currently ships 5 tabs at `flex: 0 0 auto; min-width: 90px` below the 600px breakpoint (`App.css:6279-6305`) — 5×90px already exceeds a 375px viewport (the tab bar already horizontally scrolls today, by design — see the fade-gradient/scrollbar rules at `App.css:6330-6343`). A 6th tab would push total width ~44% past viewport, landing "Stats" almost entirely off-screen — directly against UI-SPEC §1's "sideline-first, glanceable" principles for the one screen where that matters most. Instead: add a **segmented control** (Goals / Shots / Saves) inside the existing "Goals" tab's content area, reusing the tablist/pill interaction and `aria-selected`/arrow-key semantics UI-SPEC §7.7 already specifies for the Game Planner timeline (its `planner-timeline-pill` sizing comfortably fits 3 segments inside 375px — verified against `App.css:7412-7476`). `GoalTracker.tsx` keeps owning the Goals sub-view; `ShotSaveTracker.tsx` (new) owns Shots and Saves, selected by the same segmented control. `GameManagement.tsx` only needs local component state for which sub-view is active — no `GameTab` union change, no `TabNav.tsx` change. Two small decisions to pin down rather than leave to improvisation: (1) whether the outer `TabNav` label stays "Goals" or becomes "Stats" now that it can show Shots/Saves too — a pure text change either way, no width cost; (2) the inner segmented control needs its own distinguishing `aria-label` (e.g. `"Goals sub-view"`) so it doesn't collide with the outer `TabNav`'s existing `aria-label="Game management tabs"` (`TabNav.tsx:63`) for a screen-reader user landmark-navigating the page.
- `ShotSaveTracker.tsx` — same interaction shape as `GoalTracker.tsx`: modal-driven create, `GameActionRow`/`actionContract` for edit/delete, explicitly sets `loggedVia: 'COACH'` on every write. **Every entry starts with an Us/Opponent choice**, mirroring how `GoalTracker.tsx` already asks this for `Goal.scoredByUs` — a shot or save is exactly as often the opponent's as ours (`Shot.takenByUs`/`Save.byUs` exist specifically for this). Selecting "Us" proceeds to our player picker as normal; selecting "Opponent" skips the player picker entirely and logs an aggregate event with no `playerId` — this app doesn't track an opposing roster, so an opponent shot/save is a count, not an attributed one.
- **`src/hooks/useOfflineMutations.ts`** (modify, not new — this was missing from the original file list) — `GameMutationInput` (`:135-153`) needs `createShot`/`deleteShot`/`updateShot` and `createSave`/`deleteSave`/`updateSave` callbacks, matching the existing `createGoal`/`deleteGoal`/`updateGoal` shape; add `ShotCreateFields`/`ShotUpdateFields`/`SaveCreateFields`/`SaveUpdateFields` interfaces mirroring `GoalCreateFields`/`GoalUpdateFields` (`:73-89`); add the new mutation names to the `ALLOWED_MODELS` allowlist (`executeSingleMutation`, `:342-345`) and the hook's `useMemo` dependency list (`:798`); and **add `loggedVia` to `GoalCreateFields`** — without this, `GoalTracker.tsx:75-85`'s existing `createGoal` call has no way to set the field this plan says every write path must set.
- **`src/components/GameManagement/hooks/useGameSubscriptions.ts`** (modify, not new — also missing from the original file list) — this is where the existing `Goal` subscription actually lives (`useAmplifyQuery('Goal', {filter:{gameId}})`, `:84-87`), not in `GameManagement.tsx` directly. Add matching `Shot`/`Save` subscriptions here and thread them through the hook's return shape into `GameManagement.tsx` and down into `ShotSaveTracker.tsx`.
- `src/types/schema.ts` / `src/components/GameManagement/types.ts` — re-export `Shot`/`Save` types.
- **Test-surface consequence**: widening `GameMutationInput` touches every mock `mutations` object across the `GameManagement` test suite — budget for that churn rather than treating it as incidental.

### Docs (part of this milestone, not deferred)

- `README.md` — Data Model section: add `Shot`, `Save`. Features section: add shot/save tracking.
- `docs/ARCHITECTURE.md` — update the entity diagram (`:59`), the `Player` relationships line (`:110`, which currently enumerates `Goal`), and add `#### Shot`/`#### Save` sections mirroring the existing `#### Goal` section (`:218`). Missed in the first draft, which only scheduled this doc for Milestone B1 — but Milestone A is where the entities and relationships actually change.
- `docs/specs/UI-SPEC.md` — two things, not one: (1) the §7.4 game-tab table (`:388-394`) is **already** two tabs behind `TabNav.tsx` (it lists only Lineup/Bench/Notes against the shipped Plan/Field/Bench/Goals/Notes) — backfill the missing Plan and Goals rows in the same edit that documents the new Goals-tab segmented control, rather than editing a table that's already wrong; (2) extend §13 "Note And Goal Actions (Post-Game)" (`:1117-1145`) — `ShotSaveTracker` reuses the same `GameActionRow`/`actionContract` unified-action contract, so §13.2/§13.3 need Shot/Save entries and the section title needs updating to reflect it's no longer Goal-only.

### Tests

- `ShotSaveTracker.test.tsx` (mirrors `GoalTracker.test.tsx`).
- New tests for the Goals-tab segmented control (keyboard/ARIA nav between Goals/Shots/Saves sub-views) — in `GameManagement.test.tsx` or a dedicated test file, whichever the existing Goals-tab test coverage pattern favors.
- `useOfflineMutations.test.ts` / `useGameSubscriptions.test.ts` — new Shot/Save coverage, plus updates to every existing mock `mutations` object the widened `GameMutationInput` interface touches.
- `delete-game-safe` / `delete-team-safe` / `delete-player-safe` handler tests — new cascade coverage, including a test that exercises the physical-GSI-name query path.

---

## Milestone B1 — Fan Mode (public read-only)

### Data model (`amplify/data/resource.ts`)

```ts
// Fully closed model, same rationale as CalendarFeed. No client (coach or guest)
// ever reads/writes this table directly; every access goes through a Lambda that
// does its own authorization/validation. Token is the primary key for O(1) lookups.
// Field named `issuedAt`, not `createdAt` — avoids colliding with Amplify's
// auto-managed createdAt/updatedAt timestamps (same reason Goal uses `timestamp`
// instead of `createdAt`, resource.ts:330).
ShareLink: a.model({
  token: a.string().required(),        // nanoid(24), unguessable
  teamId: a.id().required(),
  type: a.enum(['FAN', 'STAT_TRACKER']),
  createdBy: a.string().required(),    // coach Cognito sub
  issuedAt: a.datetime().required(),
  revokedAt: a.datetime(),             // null = active
})
  .identifier(['token'])
  .secondaryIndexes((index) => [index('teamId').queryField('listShareLinksByTeamId')])
  .authorization((allow) => [allow.authenticated().to([])]), // no client grants at all
```

(No `lastUsedAt` — a per-poll write to a single hot item on every fan-page refresh is pure cost with no product value yet; drop it for v1, revisit if usage analytics become a real ask.)

**`Game` needs a queryable index for "this team's current game."** Today `Game` has no `secondaryIndexes` at all (confirmed — only the implicit `belongsTo('Team')` relationship index, which has no sort key). The chronological field is `gameDate` (`resource.ts:169`) — but it's declared `a.datetime()` **without** `.required()`, and `create-game-safe/handler.ts:83` writes `gameDate: gameDate ?? null`. A sort-key GSI on an optional attribute **omits every item where that attribute is absent** — a `sortKeys(['gameDate'])` index would make a dateless in-progress game invisible to `getFanGameView`, which would report "team hasn't started a game yet" while the coach is mid-game. Add a partition-key-only index instead, which has no such gap:

```ts
// on Game:
.secondaryIndexes((index) => [
  index('teamId').queryField('listGamesByTeamId'),
])
```

`get-fan-game-view` queries this (every one of the team's games — a season's worth, dozens not thousands, so this is cheap) and picks in this order, in Lambda memory rather than via DynamoDB sort: (1) any game with `status` `in-progress` or `halftime`; (2) else the most recent by `gameDate` among games that have one; (3) else the most recently created among the rest (fall back to whatever ordering is available — creation order or `updatedAt` — since `gameDate` isn't guaranteed present). State this selection algorithm explicitly in the handler's own code comments, since it's the one piece of business logic in this Lambda that isn't just plumbing.

### Custom operations

`ShareLink` is `allow.authenticated().to([])` — **zero client grants**. Returning `a.ref('ShareLink')` directly from `generateShareLink`/`listTeamShareLinks` doesn't work with that: the in-repo precedent that *does* return a model ref (`createSecureGameNote` → `a.ref('GameNote')`) only works because `GameNote` retains `.to(['read'])`. The actual zero-grant precedent, `CalendarFeed`, is never returned from an operation at all — `syncTeamCalendar` returns a `CalendarSyncResult` custom type instead. Follow that: define a `ShareLinkSummary` custom type (`token`, `type`, `issuedAt`, `revokedAt`) and return that, not `a.ref('ShareLink')`.

```ts
generateShareLink: a.mutation()
  .arguments({ teamId: a.string().required(), type: a.string().required() })
  .returns(a.ref('ShareLinkSummary'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(generateShareLink)),

revokeShareLink: a.mutation()
  .arguments({ token: a.string().required() })
  .returns(a.boolean())
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(revokeShareLink)),

listTeamShareLinks: a.query()
  .arguments({ teamId: a.string().required() })
  .returns(a.ref('ShareLinkSummary').array())
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(listTeamShareLinks)),

getFanGameView: a.query()
  .arguments({ token: a.string().required() })
  .returns(a.ref('FanGameViewResult'))
  .authorization((allow) => [allow.guest()])
  .handler(a.handler.function(getFanGameView)),
```

`FanGameViewResult` — curated custom type (following the `CalendarSyncResult` precedent, `resource.ts:603-654`): `teamName`, `opponentName`, `locationName`, `status`, `currentHalf`, `elapsedSeconds`, `lastStartTime`, `halfLengthMinutes`, `ourScore`, `opponentScore`, `onFieldPlayers: [{ firstName, lastInitial, positionName }]` (first name + last **initial** only — no `birthYear`, no coach identities), `recentEvents: [{ type, playerName, minute, half }]` (last ~5 `Goal`/`Substitution` rows, using the new `listGoalsByGameId` index from Milestone A and the existing `Substitution` gameId pattern).

`onFieldPlayers` derivation reuses the **existing** `listPlayTimeRecordsByGameId` index (`resource.ts:311-312`) — query open rows (`endGameSeconds == null`) and batch-fetch `Player`/`FieldPosition`. No new index needed for this part.

### New Lambda functions (`amplify/functions/`)

| Function | Auth | Responsibility |
|---|---|---|
| `generate-share-link` | authenticated | Verify caller ∈ `team.coaches`; reject if `team.status === 'archived'` (mirror `createGameSafe`'s guard); if an active link of that `type` exists for the team, revoke it first (one active link per team per type); write new `ShareLink` row with a `nanoid()` token; return it. |
| `revoke-share-link` | authenticated | Look up `ShareLink` by token → `teamId` → verify caller ∈ `team.coaches`; set `revokedAt`. |
| `list-team-share-links` | authenticated | Verify caller ∈ `team.coaches`; return active/recent links for the `InvitationManagement.tsx` display. |
| `get-fan-game-view` | **guest** | Look up `ShareLink` by token; reject if missing/revoked/wrong type; query `listGamesByTeamIdAndDate`, pick in-progress/halftime first else most recent; assemble `FanGameViewResult` via the indexed queries above. Rate-limited (see below). |

All use `grantReadData`/`grantReadWriteData` IAM grants wired in `amplify/backend.ts`, following the `CalendarFeed`/`GameNote` pattern.

**Read-path rate limiting**: reuse the `ShareLinkRateLimit` table introduced in B2 isn't available yet in this milestone's scope on its own — since B1 ships before B2, add a lightweight read-side limiter here too (same shape, its own table `FanViewRateLimit: [token, minuteBucket] → count, ttl`, generous threshold e.g. 30 reads/min) so an unauthenticated, fan-out read endpoint isn't a free billing-DoS vector for a leaked/screenshotted link before the write path (and its shared rate-limit infra) even exists.

### Guest auth — must be pinned down before implementation starts, not deferred to it

- `amplify/auth/resource.ts` is currently bare (`defineAuth({ loginWith: { email: true } })`, no `access`/unauthenticated-identity config). **Verify explicitly** (inspect the synthesized unauthenticated IAM role, e.g. in `.amplify/artifacts/cdk.out`, same evidence standard already used elsewhere in this repo for GSI checks) whether Amplify Gen2 auto-provisions an unauthenticated Identity Pool role once `allow.guest()` appears anywhere in `defineData`'s schema, or whether `defineAuth`/`defineData`'s `authorizationModes` needs an explicit addition.
- **Acceptance check, not optional**: confirm the generated unauthenticated role's `appsync:GraphQL` policy is scoped to exactly `.../types/Query/fields/getFanGameView` (and, in B2, `.../types/Mutation/fields/submitStatEvent`) — **not** `.../apis/<id>/*`. This is the single highest-risk item in the whole feature; security-reviewer must diff `defineData`'s authorization modes before/after and confirm this scoping directly, not take the plan's word for it.
- Client calls use `{ authMode: 'identityPool' }` (the current, non-deprecated Amplify v6 name — not `'iam'`).
- `allow.guest()` must land **only** on `getFanGameView` (and, in B2, `submitStatEvent`) — nowhere else. `ShareLink`/`FanViewRateLimit` stay `allow.authenticated().to([])`. Every other model/operation is untouched.
- The bug-screenshot S3 bucket (`amplify/storage/resource.ts`) currently has **no client-accessible paths at all** ("Bug report screenshots are uploaded to GitHub Issues directly by the Lambda") — there is no existing storage policy for guest identities to interact with, so this is not a verification item.

### Frontend routing (`src/main.tsx`, `src/App.tsx`)

Current structure (verified): `main.tsx` renders `<Authenticator.Provider><Root/></Authenticator.Provider>` with **no router** — `Root()` conditionally renders `<LandingPage>`/`<Authenticator>`/`<App/>`. `App.tsx` owns the **only** `<BrowserRouter>` in the app, with its own `<Routes>` including a catch-all `<Route path="*" element={<Navigate to="/" replace />} />`.

The fix is to **hoist `BrowserRouter` up to `main.tsx`**, convert `App.tsx` to render only `<Routes>` (no router), and add the two public routes as siblings, ordered before any catch-all:

```tsx
// main.tsx
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/watch/:token" element={<FanGameView />} />
        <Route path="/track/:token" element={<StatTrackerView />} /> {/* added in B2 */}
        <Route path="*" element={
          <Authenticator.Provider><Root /></Authenticator.Provider>
        } />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

// App.tsx — drop the <BrowserRouter> wrapper, keep everything else:
function App() {
  return (
    <Routes>
      <Route path="/invite/:invitationId" element={<InvitationRoute />} />
      <Route element={<AppLayout />}>{/* ...unchanged... */}</Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

Because `main.tsx`'s `"*"` route only matches when neither `/watch/:token` nor `/track/:token` matched, `App.tsx`'s own inner `"*"` (which redirects to `/`) is unaffected — it only ever sees paths that already fell through to `Root`/`App`. `UpdatePrompt` stays exactly where it is today (inside `Root`'s branches) — correct as originally stated. Two corrections to the original claim, though:

- **`initGA` is not inside `Root`** — it runs at module scope in `main.tsx:38-42`, before `ReactDOM.createRoot`. Under this restructure it would fire unconditionally, including for unauthenticated visitors on `/watch/:token`/`/track/:token` who never saw any consent surface. Guard it explicitly: check `window.location.pathname` for the `/watch/`/`/track/` prefixes before calling `initGA`, so analytics only initializes for the authenticated app shell.
- **The two public pages won't actually be "minimal" as-is.** `main.tsx:5` statically imports `App`, which statically imports `AppLayout`, `Home`, `App.css`, and `@aws-amplify/ui-react/styles.css` — hoisting the router doesn't change that; a fan on stadium LTE would still download the entire authenticated app shell to view a scoreboard. Wrap the `"*"` route's `<Authenticator.Provider><Root/></Authenticator.Provider>` branch in `React.lazy`/`Suspense` (the codebase already lazy-loads `Management`/`UserProfile`/`SeasonReportRoute` in `App.tsx:17-27` — same pattern, one level up) so `/watch`/`/track` only pull in their own small bundle.

### New frontend components

- `src/components/FanMode/FanGameView.tsx` — polls `getFanGameView` (every 10–15s, paused via the Page Visibility API when hidden); renders score/timer/half (new standalone component, visual style borrowed from `CommandBand.tsx` — including its `aria-live="polite" aria-atomic="true"` score wrapper, `CommandBand.tsx:183`, which carries over for free), on-field lineup grid, recent-events feed. Empty/error states: "link revoked," "team hasn't started a game yet," "game finished — final score X–Y."
- `src/components/InvitationManagement.tsx` — new "Share Links" section: generate/copy/revoke controls for the `FAN` link type (the `STAT_TRACKER` half of this UI lands in B2), replacing today's raw-text invite-link display pattern with a proper copy-to-clipboard control. **"Generate" needs a confirmation step, not a bare action**: `generate-share-link` revokes any existing active link of that type first, so a coach re-generating mid-game silently strands a link someone (a fan, or in B2 a helper) may be actively using. Mirror the existing Confirmation Modal convention (UI-SPEC §5.6/§7.9) — "This replaces the current link — anyone still using it will lose access" — whenever an active link already exists for that type.

### Docs

- `README.md` — Data Model: add `ShareLink`. Features: add "Fan Mode (public read-only live game view)."
- `docs/ARCHITECTURE.md:25-31` — the Authorization Model section currently states flatly "All data models use `allow.ownersDefinedIn('coaches')`" (and repeats this at line 431 as a key design decision). This becomes actively false the moment `ShareLink`/`getFanGameView` ship. Amend this section explicitly: document the guest-auth exception, exactly which two operations carry it, and link to the `CalendarFeed`-style closed-model rationale.
- `docs/specs/UI-SPEC.md` — three things: (1) add a full entry for the `FanGameView` screen (layout, a11y — screen-reader behavior for the "not live" state, responsive breakpoints); (2) §6 "Routes Outside AppLayout" (`:216-219`) currently lists only `/invite/:invitationId` and `/dev` — add `/watch/:token` (and, in B2, `/track/:token`) to this table, since that's exactly the kind of no-AppLayout/no-bottom-nav route it documents; (3) §7.9's "Sharing & Permissions" panel is currently documented as having "**Three regions**" (`:654-657`) — the new Share Links section makes it four. Update that count and add the Share Links subsection (the `STAT_TRACKER` half completes in B2) rather than letting the spec keep asserting a region count the shipped screen no longer matches.

### Tests

- `generate-share-link` / `revoke-share-link` / `list-team-share-links` / `get-fan-game-view` handler tests: coach-authorization checks, archived-team rejection, token validation (valid/missing/revoked/wrong-type), rate-limit rejection, game-selection query correctness (in-progress preferred over completed/scheduled).
- `FanGameView.test.tsx` — loading/empty/populated/revoked/error states; polling under fake timers, pause-on-hidden.
- `InvitationManagement.test.tsx` — generate/copy/revoke controls for the Fan link.

---

## Milestone B2 — Sideline Stat Tracker (public write)

### Data model

```ts
ShareLinkRateLimit: a.model({
  token: a.string().required(),
  minuteBucket: a.string().required(), // e.g. "2026-09-06T18:32"
  count: a.integer().required(),
  ttl: a.integer(),                    // DynamoDB TTL, ~10 min
})
  .identifier(['token', 'minuteBucket'])
  .authorization((allow) => [allow.authenticated().to([])]),
```

Threshold ~20 writes/min per token. **Accepted tradeoff, stated explicitly**: this budget is per-token, not per-caller — a leaked token hammered by a script starves the legitimate helper for the rest of that minute. Mitigation is the existing revoke/regenerate flow, not additional IP-based throttling (out of scope for v1; note as a follow-up if abuse is observed).

### `submitStatEvent` — the write path, designed around the subscription finding

```ts
submitStatEvent: a.mutation()
  .arguments({
    token: a.string().required(),
    eventType: a.string().required(),   // 'GOAL' | 'SHOT' | 'SAVE'  (see Assist note below)
    playerId: a.string(),               // scorer (GOAL), shooter (SHOT), keeper (SAVE)
    assistPlayerId: a.string(),         // optional, GOAL only
    forUs: a.boolean(),                 // generic "this event belongs to our side" flag —
                                         // written to Goal.scoredByUs / Shot.takenByUs /
                                         // Save.byUs depending on eventType. One arg name,
                                         // three differently-named target fields; state this
                                         // mapping explicitly in the handler, don't rename the
                                         // model fields to match — they're each named for
                                         // what reads correctly on that specific model.
    onTarget: a.boolean(),               // SHOT only
  })
  .returns(a.boolean())
  .authorization((allow) => [allow.guest()])
  .handler(a.handler.function(submitStatEvent)),
```

**`ASSIST` is not an independent event** — `Goal.assistId` is a field on a `Goal`, not a standalone record (confirmed `resource.ts:327-328`). The Stat Tracker UI's "Assist" tap is step two of the Goal flow (pick scorer, then optionally pick an assisting player), producing one `Goal` write with both fields set — not a second event type.

**`coaches[]` must be populated explicitly — this is not automatic just because the write goes through AppSync.** Per CLAUDE.md, omitting `coaches` on any new record is the single most common way to lock a coach out, and here the failure mode is worse than usual: it would be silent, and it would lock out *every* coach on the team, including the one who generated the link. The handler must read the team's **current** `coaches` array (fresh, not cached from `ShareLink`) and set it explicitly on the created `Goal`/`Shot`/`Save` record.

**Game-clock contract**: `gameSeconds`/`half` are **not** supplied by the untrusted public client. The Lambda derives them server-side from the team's current `Game` (`elapsedSeconds`, `lastStartTime`, `status`, `currentHalf`). **Correction from the previous draft**: this formula does not live in `src/utils/gameTimeUtils.ts` (that file is 39 lines of pure display formatting — `formatGameTimeDisplay`/`formatMinutesSeconds`/`isoToDatetimeLocal` — no clock arithmetic at all). The actual formula is inline in `src/components/GameManagement/hooks/useGameSubscriptions.ts:229-239`: when `status === 'in-progress'` and `lastStartTime` is set, current seconds = `elapsedSeconds + Math.floor((Date.now() - new Date(lastStartTime).getTime()) / 1000)`; otherwise (paused, or `lastStartTime` absent) current seconds = `elapsedSeconds` as-is, frozen. Before B2 implementation: extract this into a small shared pure function (e.g. `src/utils/gameClock.ts`), have `useGameSubscriptions.ts` call it instead of inlining it, and mirror that same function at `amplify/functions/shared/gameClock.ts` (a Lambda can't import from `src/`) with a parity test asserting identical output for the same inputs against the *real* extracted source, not the display-formatting file. Two things to explicitly verify/decide during that extraction, not assume: whether `elapsedSeconds` resets to 0 at halftime or accumulates across both halves (this determines whether a second-half `gameSeconds` value is comparable to a coach-logged one), and that `Game.elapsedSeconds` as persisted in DynamoDB can lag the true value while running (it's saved on a periodic interval, not every tick) — the Lambda's derivation must use the same running-vs-paused branch as the client, not just read the stored value verbatim. Reject the submission if `Game.status !== 'in-progress'` (clear "game not live" error the UI surfaces) — this correctly excludes halftime, but confirm the paused-within-a-half case (`status === 'in-progress'`, `lastStartTime` null) is handled by the frozen-`elapsedSeconds` branch above, not treated as a rejection.

**Critical fix — write through AppSync, not the DynamoDB SDK.** Every other Lambda in this repo (`CalendarFeed`, `GameNote`, `archiveTeam`, etc.) writes via direct `DynamoDBDocumentClient`/`PutCommand`, which is correct for those because none of them need a live subscriber to see the write instantly. This one does: the whole point of the Stat Tracker is that the coach's `GameManagement.tsx` screen (subscribed to `Goal`/`Shot`/`Save` via `useAmplifyQuery`'s `observeQuery`) reflects a helper's tap in real time. A raw DynamoDB write **will not** trigger the `onCreateGoal`/`onCreateShot`/`onCreateSave` subscription event — this is the exact, already-documented hazard in `src/components/Home.tsx:135-145` (`createGameSafe`'s DynamoDB-SDK writes never fire `onCreateGame`, requiring the `pendingCreatedGames` client-side patch — which doesn't help here, since the "other browser" problem means there's no local optimistic state to patch with).

Fix: grant the `submitStatEvent` Lambda **resource-level AppSync access** to `Goal`/`Shot`/`Save` via `allow.resource(submitStatEventFunction)` added to each model's authorization array (alongside the existing `allow.ownersDefinedIn('coaches')`), and have the handler call `generateClient<Schema>({ authMode: 'iam' })` inside the Lambda to create the record through the normal GraphQL mutation — not `PutCommand`. **There is no in-repo precedent for this** (every existing handler uses the raw DynamoDB SDK), so name the wiring explicitly rather than leaving it to be discovered: the Lambda needs `Amplify.configure(...)` using `AMPLIFY_DATA_GRAPHQL_ENDPOINT` from its typed `$amplify/env/submit-stat-event` env import, and `amplify/backend.ts` needs the `allow.resource()` ↔ `defineFunction` wiring connecting `submitStatEvent`'s function resource to the `Goal`/`Shot`/`Save` model grants. This makes a helper's submission behave, for subscription purposes, exactly like a coach's own write, and removes the need for any client-side polling workaround on the coach's screen.

This also resolves the score-consistency concern cleanly: since the `Goal` write goes through the real `createGoal` mutation, `GameManagement.tsx`'s existing subscription-fed derivation of `ourScore`/`opponentScore` during play, and its existing completion-time reconciliation, both see the record exactly as they would a coach-submitted one — no special-casing needed after all, but only *because* of the AppSync-write fix above, not by default.

### Lifecycle wiring

- `generate-share-link` (already handles both link types from B1) and `submit-stat-event` both reject `team.status === 'archived'`.
- `archive-team` (`amplify/backend.ts:350-355`, which already sweeps pending `TeamInvitation`s) should revoke active `ShareLink`s the same way — add this sweep when B2 lands (or move it into B1 if it's cheap to include there instead, since `ShareLink` already exists by then).

### Frontend

- `src/components/FanMode/StatTrackerView.tsx` — reuses the curated roster payload from `getFanGameView` (extended to include `playerId`s for the picker), large tap targets (Goal / Shot / Save, with Assist as Goal's second step per above). **Every tap opens with an Us/Opponent choice before anything else** — `opponentName` is already in `FanGameViewResult` (B1), so this reads naturally as e.g. "Riverside Rovers" vs. "Lakeside FC," not a generic "Us/Them." Picking "Us" proceeds into the existing player-picker flow (scorer/shooter/keeper, then assist for Goal); picking "Opponent" skips straight to confirm — no player picker, since this app has no opposing roster to attribute it to. This is the same distinction `Goal.scoredByUs` already makes (a helper logging the opponent's goal is exactly as real a case as logging our own), extended consistently to `Shot.takenByUs`/`Save.byUs`. **Instant-feedback + duplicate-tap guard, borrowing `LineupPanel.tsx`'s `pendingRemovalIds` pattern (PR #172) directly**: on tap, immediately disable that target and show a visible "logged!" confirmation (plus an `aria-live="polite"` announcement) before the mutation round-trips — an unauthenticated sideline helper has no other way to confirm a tap landed, and unlike a coach, no self-serve undo if it fires twice. Without this the realistic failure mode is duplicate rows that only a coach can clean up after the fact. No delete/undo for the helper — the coach corrects mistakes via the Milestone A `ShotSaveTracker`/existing `GoalTracker` edit UI, which now shows a small "via helper" badge when `loggedVia === 'HELPER'`. Tap targets are **56×56px minimum with 12px gaps** between adjacent Goal/Shot/Save targets — deliberately larger than the app's generic 44×44px floor (§4), since this screen's mis-tap cost (no self-serve undo, one-handed, standing) is higher than the app's baseline. Player pickers (Goal scorer/assist, Shot shooter, Save keeper) need an explicit "skip / unknown player" affordance, since `playerId` is optional in the schema — a helper shouldn't be stuck trying to identify a jersey number mid-play. Poll the roster/game-state (same `getFanGameView` endpoint, same 10-15s/visibility-paused cadence as `FanGameView`) rather than loading once at mount, so a helper who opens the link before kickoff sees the tap UI unlock without a manual reload, and a mid-game substitution appears in the picker promptly. Handle **mid-session token revocation** explicitly (not just an initial-load rejection) — if the coach regenerates the `STAT_TRACKER` link while a helper's page is open, the next poll should surface a clear "this link is no longer active" state, not a silent stall. Explicit "game not in progress" gate before the tap UI is shown at all.
- `src/components/InvitationManagement.tsx` — add the `STAT_TRACKER` half of the Share Links section (generate/copy/revoke), completing the UI started in B1, including the same regenerate-confirmation requirement B1 specifies (more urgent here, since this is the write-capable link).

### Docs

- `README.md` — Data Model: add `ShareLinkRateLimit`. Features: add "Sideline Stat Tracking (public helper-submitted stats)."
- `docs/specs/UI-SPEC.md` — add the `StatTrackerView` screen entry; add `/track/:token` to §6's routes table (started in B1 for `/watch/:token`); complete the `STAT_TRACKER` half of §7.9's Share Links subsection; add a `§13` subsection for the `loggedVia === 'HELPER'` badge, structurally identical to the existing §13.5 "Edited Indicator" pattern (attribution label, fallback order, styling) — don't leave this as implementation-only prose.
- `docs/ARCHITECTURE.md` — extend the guest-auth exception note from B1 to cover `submitStatEvent`, and document the `allow.resource()` grant pattern as the reason helper writes appear in real time (future readers will otherwise wonder why this one Lambda doesn't follow the `CalendarFeed`-style raw-DynamoDB convention).

### Risks / edge cases carried into security + UI review

- Token leakage (screenshot/forwarded link) — mitigated by revoke; consider a shorter default lifetime for `STAT_TRACKER` links specifically, since it's the write-capable one.
- Multiple simultaneous helpers on one link — no locking for v1; duplicate entries are a coach cleanup task via existing edit/delete UI.
- Offline/dropped connection on a public link — no Cognito session means no `useOfflineMutations` queuing; show an inline error + manual retry, don't silently queue.
- The `accept-invitation`/`revoke-coach-access` `coaches[]`-backfill gap that `Shot`/`Save` inherit is recorded in Milestone A (where those tables start existing), not here — see that section.

### Tests

- `submit-stat-event` handler tests: token validation, rate-limit rejection, game-state gating, server-derived `gameSeconds`/`half` correctness (including the paused-within-a-half and halftime cases), explicit assertion that `coaches[]` is populated from the team's current array, and — importantly — an integration-style test confirming the write is observable via `observeQuery`/subscription (not just present in the table), to lock in the AppSync-vs-DynamoDB-SDK fix.
- Parity test for the extracted `gameClock.ts` shared function (client `src/utils/gameClock.ts` vs. Lambda `amplify/functions/shared/gameClock.ts`) — same inputs, identical output, covering running/paused/halftime cases.
- `StatTrackerView.test.tsx` — tap-to-submit flow (including the Goal→Assist two-step), the duplicate-tap guard (rapid double-tap produces one submission, not two), disabled state when not in-progress, mid-session revocation surfacing, rate-limit error surfacing.
- `GameManagement.test.tsx` / `GoalTracker.test.tsx` / `ShotSaveTracker.test.tsx` — "via helper" badge rendering.

## Verification

- `npm run gate:commit` (lint → test:run → build) must be green before each milestone's commit.
- Manually drive both public pages end-to-end in the browser preview: generate a Fan link and a Stat Tracker link from `InvitationManagement.tsx`, open each in a fresh (unauthenticated) browser context, submit a stat from the tracker page, and confirm it appears **live** (no refresh) on a separately-open coach `GameManagement.tsx` session — this specifically proves the AppSync-write fix, not just that data lands in DynamoDB.
- Confirm a revoked/garbage token renders the "link revoked"/"not found" state instead of an unhandled error.
- Confirm the unauthenticated IAM role's AppSync policy is scoped to the specific field ARNs (`getFanGameView`, `submitStatEvent`) before merging B1/B2 — this check is a merge gate, not a nice-to-have.

## Next step

All three milestones are architecture/security-relevant multi-file changes — run each through the full `dev-pipeline` skill (plan-writer → architect-reviewer → ui-reviewer → coding-agent → parallel validation/security/UI review → commit gate).

**Current status**: Milestone A has now been through one round of formal `architect-reviewer` + `ui-reviewer` review (this revision folds in both). `architect-reviewer`'s explicit read was that Milestone A is a go without another architecture round once these findings are folded in. `ui-reviewer` asked specifically to see the corrected segmented-sub-view approach (replacing the original 6th-tab sketch) before signing off — re-run `ui-reviewer` once more on Milestone A's revised Frontend section, then proceed to `coding-agent` for Milestone A. Milestones B1 and B2 have architecture-level findings already folded in above but have not yet had their own dedicated review round — run architect-reviewer (and ui-reviewer, given both add UI) on each before implementing them, same as Milestone A got.
