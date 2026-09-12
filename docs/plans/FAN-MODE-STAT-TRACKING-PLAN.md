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

**This plan has been through one round of independent architecture review** (two reviewers, both flagged real issues — one caught outright factual errors: a nested-`BrowserRouter` crash in the original routing sketch, and a critical gap where Lambda→DynamoDB-SDK writes never fire AppSync subscriptions, verified against the exact same hazard already hit and documented in this codebase at `src/components/Home.tsx:135-145`). All findings below are folded in; the design decisions and file paths reflect the corrected version.

## Key existing precedents to reuse (not reinvent)

- **`Goal` model** (`amplify/data/resource.ts:318-335`) is the template shape for a per-event game stat (`gameId`, `gameSeconds`, `half`, optional player refs, `timestamp`, `coaches[]`) — template for new `Shot`/`Save` models.
- **`CalendarFeed` model** (`amplify/data/resource.ts:595-601`) is the template for any model reachable by a non-coach: `allow.authenticated().to([])` (or `allow.guest().to([])`) — **zero direct client grants**, all access via Lambda IAM.
- **`BugReportRateLimit` model** (`amplify/data/resource.ts:432-443`, keyed `[userId, hourBucket]`, DynamoDB TTL) is the template for rate-limiting.
- **`createGameSafe`/`deleteGameSafe`/`archiveTeam`** Lambda-mutation pattern — authenticated custom mutations that do their own authorization check inside the handler — template for coach-side "generate/revoke share link" mutations. `createGameSafe` also has an archived-team guard (`amplify/data/resource.ts:568-572`) the new coach-side mutations should mirror.
- **`CalendarSyncResult`-style custom type** (`amplify/data/resource.ts:603-654`) is precedent for returning a curated custom type instead of `a.ref('Game')`/`a.ref('Team')` from a query — this codebase already hit and solved "cannot `.ref()` a model from a custom type" here.
- Score is **derived, not stored, during play**: `GoalTracker.tsx:87-93,145-153` shows `ourScore`/`opponentScore` are computed live from `Goal` records and only written back to `Game` at completion-time reconciliation.
- **Lambda writes via the DynamoDB SDK do not fire AppSync subscriptions** — this is a known, previously-hit, already-documented hazard in this exact codebase (`src/components/Home.tsx:135-145`, referencing `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md` Decision 0/3). Any new Lambda write that a coach's live screen needs to see in real time must go through AppSync (IAM-signed), not a raw `PutCommand`.
- `isReadOnly` props exist on `LineupPanel.tsx`, `PlannerLineupView.tsx`, `PreGameNotesPanel.tsx`, `shape/LineupShapeView.tsx` — **not directly reused here**: those components are typed against coach-scoped model shapes that the curated Fan Mode payload won't satisfy, so Fan Mode gets new standalone read-only components instead. Noted explicitly so a future reviewer doesn't re-ask.

## Recommended phasing

Three milestones, each its own full `dev-pipeline` cycle (squarely "Larger: 3+ files, architecture/security-relevant" per CLAUDE.md):

- **Milestone A — Stats data model + coach-only UI.** New `Shot`/`Save` models, `loggedVia` field on `Goal`/`Shot`/`Save`, a new tab in `GameManagement.tsx` for the coach to log them directly. Stays entirely inside the existing `ownersDefinedIn('coaches')` pattern.
- **Milestone B1 — Fan Mode (public read only).** `ShareLink` model, the 3 authenticated coach-side link-management mutations, `getFanGameView`, the routing restructure, the Fan Mode page. This lands the guest-auth mechanism and the routing change with **zero unauthenticated write exposure** — if the guest IAM scoping turns out wrong, the blast radius is a curated read payload, not a write into game records.
- **Milestone B2 — Sideline Stat Tracker (public write).** `ShareLinkRateLimit`, `submitStatEvent` (writing through AppSync, not raw DynamoDB, per the subscription finding above), the Stat Tracker page. This is the first unauthenticated write path in the app's history — it gets its own review cycle rather than riding along with Fan Mode.

---

## Milestone A — Stat models + coach UI

### Data model (`amplify/data/resource.ts`)

```ts
Shot: a.model({
  gameId: a.id().required(),
  game: a.belongsTo('Game', 'gameId'),
  playerId: a.id(),
  player: a.belongsTo('Player', 'playerId'),
  scoredByUs: a.boolean().required(),
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
  playerId: a.id(),           // goalkeeper
  player: a.belongsTo('Player', 'playerId'),
  gameSeconds: a.integer().required(),
  half: a.integer().required(),
  timestamp: a.datetime().required(),
  loggedVia: a.enum(['COACH', 'HELPER']),
  coaches: a.string().array(),
})
  .secondaryIndexes((index) => [index('gameId').queryField('listSavesByGameId')])
  .authorization((allow) => [allow.ownersDefinedIn('coaches')]),
```

Add `loggedVia: a.enum(['COACH', 'HELPER'])` to `Goal` too. **Contract**: `a.enum()` can't be `.required()` (see existing precedent/comment at `resource.ts:344`) — every write path (client `GoalTracker.tsx`, the new coach-side Shot/Save UI, and Milestone B2's `submitStatEvent`) must explicitly set this field; a record with it unset/absent is treated as `COACH` everywhere it's read (UI badge logic, any future filtering).

**Also add `index('gameId')` to `Goal`** (it currently has none — `delete-game-safe/handler.ts:142` falls back to a table `scanAll` for goals today). Update `delete-game-safe` to use the new `listGoalsByGameId` query instead of scanning, same for the new `Shot`/`Save` cascades below. This removes an existing scan and keeps all three stat models consistent.

### Lifecycle wiring (do not skip — these tables don't exist yet, but the moment they do, every place that currently cascades `Goal` needs the same treatment)

- `amplify/functions/delete-game-safe/handler.ts` — add `Shot`/`Save` to the `Promise.all([...scanAll/query...])` block (~line 140) and the delete loops (~line 166), using the new indexed queries.
- `amplify/functions/delete-team-safe/` and `amplify/functions/delete-player-safe/` — both already cascade `Goal` (`amplify/backend.ts:287,313`); add `Shot`/`Save` alongside, plus the matching table grants and `*_TABLE` env vars in `amplify/backend.ts`, plus entries in each handler's rollback-snapshot stack.
- `src/utils/e2eCleanup.ts:14-17` — add `'Shot'`, `'Save'` to the cleanup model list so E2E runs don't leak rows.

### Frontend

- `src/components/GameManagement/ShotSaveTracker.tsx` (new) — same interaction shape as `GoalTracker.tsx`: modal-driven create, `GameActionRow`/`actionContract` for edit/delete, `useOfflineMutations`-wrapped writes, explicitly sets `loggedVia: 'COACH'` on every write.
- Add a **"Stats" tab** to `TabNav.tsx`'s `GameTab` union (currently exactly `"plan" | "field" | "bench" | "goals" | "notes"`, `TabNav.tsx:3`) and to `GameManagement.tsx`'s tab content. Confirm during UI review whether a 6th tab fits the existing fixed-width mobile tab bar, or whether Shots/Saves should be sub-sections of the existing Goals tab instead — call this out explicitly as a UI-review decision, not a foregone conclusion.
- `src/types/schema.ts` / `src/components/GameManagement/types.ts` — re-export `Shot`/`Save` types.

### Docs (part of this milestone, not deferred)

- `README.md` — Data Model section: add `Shot`, `Save`. Features section: add shot/save tracking.
- `docs/specs/UI-SPEC.md` — add the new tab to the game-tab table (~line 390) with its layout/accessibility/responsive notes.

### Tests

- `ShotSaveTracker.test.tsx` (mirrors `GoalTracker.test.tsx`).
- `TabNav.test.tsx` — new tab entry, keyboard nav across 6 tabs.
- `GameManagement.test.tsx` — tab-switch coverage for the new tab.
- `delete-game-safe` / `delete-team-safe` / `delete-player-safe` handler tests — new cascade coverage.

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

**`Game` needs a queryable index for "this team's current game."** Today `Game` has no `secondaryIndexes` at all (confirmed — only the implicit `belongsTo('Team')` relationship index, which has no sort key). Add:

```ts
// on Game:
.secondaryIndexes((index) => [
  index('teamId').sortKeys(['scheduledDate']).queryField('listGamesByTeamIdAndDate'),
])
```

(Use whatever the actual chronological field is named on `Game` — verify against the schema during implementation; the point is a `Query`, not a full-team `Scan`, sorted so the Lambda can cheaply pick the in-progress/halftime game, falling back to most-recently-scheduled/completed.)

### Custom operations

```ts
generateShareLink: a.mutation()
  .arguments({ teamId: a.string().required(), type: a.string().required() })
  .returns(a.ref('ShareLink'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(generateShareLink)),

revokeShareLink: a.mutation()
  .arguments({ token: a.string().required() })
  .returns(a.boolean())
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(revokeShareLink)),

listTeamShareLinks: a.query()
  .arguments({ teamId: a.string().required() })
  .returns(a.ref('ShareLink').array())
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

Because `main.tsx`'s `"*"` route only matches when neither `/watch/:token` nor `/track/:token` matched, `App.tsx`'s own inner `"*"` (which redirects to `/`) is unaffected — it only ever sees paths that already fell through to `Root`/`App`. `UpdatePrompt`/`initGA` stay exactly where they are today (inside `Root`'s branches) — the two public pages intentionally don't get them; they're minimal standalone pages, not part of the installable-PWA app shell.

### New frontend components

- `src/components/FanMode/FanGameView.tsx` — polls `getFanGameView` (every 10–15s, paused via the Page Visibility API when hidden); renders score/timer/half (new standalone component, visual style borrowed from `CommandBand.tsx`), on-field lineup grid, recent-events feed. Empty/error states: "link revoked," "team hasn't started a game yet," "game finished — final score X–Y."
- `src/components/InvitationManagement.tsx` — new "Share Links" section: generate/copy/revoke controls for the `FAN` link type (the `STAT_TRACKER` half of this UI lands in B2), replacing today's raw-text invite-link display pattern with a proper copy-to-clipboard control.

### Docs

- `README.md` — Data Model: add `ShareLink`. Features: add "Fan Mode (public read-only live game view)."
- `docs/ARCHITECTURE.md:25-31` — the Authorization Model section currently states flatly "All data models use `allow.ownersDefinedIn('coaches')`" (and repeats this at line 431 as a key design decision). This becomes actively false the moment `ShareLink`/`getFanGameView` ship. Amend this section explicitly: document the guest-auth exception, exactly which two operations carry it, and link to the `CalendarFeed`-style closed-model rationale.
- `docs/specs/UI-SPEC.md` — add a full entry for the `FanGameView` screen (layout, a11y — screen-reader behavior for the "not live" state, responsive breakpoints).

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
    scoredByUs: a.boolean(),
    onTarget: a.boolean(),               // SHOT only
  })
  .returns(a.boolean())
  .authorization((allow) => [allow.guest()])
  .handler(a.handler.function(submitStatEvent)),
```

**`ASSIST` is not an independent event** — `Goal.assistId` is a field on a `Goal`, not a standalone record (confirmed `resource.ts:327-328`). The Stat Tracker UI's "Assist" tap is step two of the Goal flow (pick scorer, then optionally pick an assisting player), producing one `Goal` write with both fields set — not a second event type.

**Game-clock contract**: `gameSeconds`/`half` are **not** supplied by the untrusted public client. The Lambda derives them server-side from the team's current `Game` (`elapsedSeconds`, `lastStartTime`, `status`, `currentHalf`), using the same `elapsedSeconds + (now - lastStartTime)` formula documented in CLAUDE.md and implemented in `src/utils/gameTimeUtils.ts`. Since a Lambda can't import from `src/`, add a small, pure reimplementation at `amplify/functions/shared/gameClock.ts` with a comment cross-referencing `src/utils/gameTimeUtils.ts`, and a test in both locations asserting identical output for the same inputs — this is intentional, tightly-scoped duplication (a handful of lines), not a maintenance trap, and is called out explicitly here so nobody "fixes" it into an import that won't bundle. Reject the submission if `Game.status !== 'in-progress'` (clear "game not live" error the UI surfaces).

**Critical fix — write through AppSync, not the DynamoDB SDK.** Every other Lambda in this repo (`CalendarFeed`, `GameNote`, `archiveTeam`, etc.) writes via direct `DynamoDBDocumentClient`/`PutCommand`, which is correct for those because none of them need a live subscriber to see the write instantly. This one does: the whole point of the Stat Tracker is that the coach's `GameManagement.tsx` screen (subscribed to `Goal`/`Shot`/`Save` via `useAmplifyQuery`'s `observeQuery`) reflects a helper's tap in real time. A raw DynamoDB write **will not** trigger the `onCreateGoal`/`onCreateShot`/`onCreateSave` subscription event — this is the exact, already-documented hazard in `src/components/Home.tsx:135-145` (`createGameSafe`'s DynamoDB-SDK writes never fire `onCreateGame`, requiring the `pendingCreatedGames` client-side patch — which doesn't help here, since the "other browser" problem means there's no local optimistic state to patch with).

Fix: grant the `submitStatEvent` Lambda **resource-level AppSync access** to `Goal`/`Shot`/`Save` via `allow.resource(submitStatEventFunction)` added to each model's authorization array (alongside the existing `allow.ownersDefinedIn('coaches')`), and have the handler call `generateClient<Schema>({ authMode: 'iam' })` inside the Lambda (Amplify Gen2's supported pattern for a function-scoped data client) to create the record through the normal GraphQL mutation — not `PutCommand`. This makes a helper's submission behave, for subscription purposes, exactly like a coach's own write, and removes the need for any client-side polling workaround on the coach's screen.

This also resolves the score-consistency concern cleanly: since the `Goal` write goes through the real `createGoal` mutation, `GameManagement.tsx`'s existing subscription-fed derivation of `ourScore`/`opponentScore` during play, and its existing completion-time reconciliation, both see the record exactly as they would a coach-submitted one — no special-casing needed after all, but only *because* of the AppSync-write fix above, not by default.

### Lifecycle wiring

- `generate-share-link` (already handles both link types from B1) and `submit-stat-event` both reject `team.status === 'archived'`.
- `archive-team` (`amplify/backend.ts:350-355`, which already sweeps pending `TeamInvitation`s) should revoke active `ShareLink`s the same way — add this sweep when B2 lands (or move it into B1 if it's cheap to include there instead, since `ShareLink` already exists by then).

### Frontend

- `src/components/FanMode/StatTrackerView.tsx` — reuses the curated roster payload from `getFanGameView` (extended to include `playerId`s for the picker), four large tap targets (Goal / Shot / Save, with Assist as Goal's second step per above). No delete/undo for the helper — the coach corrects mistakes via the Milestone A `ShotSaveTracker`/existing `GoalTracker` edit UI, which now shows a small "via helper" badge when `loggedVia === 'HELPER'`. Explicit "game not in progress" gate before the tap UI is shown at all.
- `src/components/InvitationManagement.tsx` — add the `STAT_TRACKER` half of the Share Links section (generate/copy/revoke), completing the UI started in B1.

### Docs

- `README.md` — Data Model: add `ShareLinkRateLimit`. Features: add "Sideline Stat Tracking (public helper-submitted stats)."
- `docs/specs/UI-SPEC.md` — add the `StatTrackerView` screen entry.
- `docs/ARCHITECTURE.md` — extend the guest-auth exception note from B1 to cover `submitStatEvent`, and document the `allow.resource()` grant pattern as the reason helper writes appear in real time (future readers will otherwise wonder why this one Lambda doesn't follow the `CalendarFeed`-style raw-DynamoDB convention).

### Risks / edge cases carried into security + UI review

- Token leakage (screenshot/forwarded link) — mitigated by revoke; consider a shorter default lifetime for `STAT_TRACKER` links specifically, since it's the write-capable one.
- Multiple simultaneous helpers on one link — no locking for v1; duplicate entries are a coach cleanup task via existing edit/delete UI.
- Offline/dropped connection on a public link — no Cognito session means no `useOfflineMutations` queuing; show an inline error + manual retry, don't silently queue.
- Pre-existing gaps this feature inherits, not introduces (informational, worth one line so a future reviewer doesn't re-discover them): `accept-invitation`'s `coaches[]` backfill covers `Team`/`TeamRoster`/`Player`/`Formation`/`FormationPosition`/`Game` only, not `Goal` — so a co-coach accepting after a game can't see its goals; `Shot`/`Save` inherit the same gap. Likewise `revoke-coach-access` cascades five tables, not `Goal` — a revoked coach retains read access to `Goal` rows, and will to `Shot`/`Save`.

### Tests

- `submit-stat-event` handler tests: token validation, rate-limit rejection, game-state gating, server-derived `gameSeconds`/`half` correctness (including paused-clock and halftime cases), and — importantly — an integration-style test confirming the write is observable via `observeQuery`/subscription (not just present in the table), to lock in the AppSync-vs-DynamoDB-SDK fix.
- `gameClock.ts` (Lambda) vs `gameTimeUtils.ts` (client) parity test.
- `StatTrackerView.test.tsx` — tap-to-submit flow (including the Goal→Assist two-step), disabled state when not in-progress, rate-limit error surfacing.
- `GameManagement.test.tsx` / `GoalTracker.test.tsx` / `ShotSaveTracker.test.tsx` — "via helper" badge rendering.

## Verification

- `npm run gate:commit` (lint → test:run → build) must be green before each milestone's commit.
- Manually drive both public pages end-to-end in the browser preview: generate a Fan link and a Stat Tracker link from `InvitationManagement.tsx`, open each in a fresh (unauthenticated) browser context, submit a stat from the tracker page, and confirm it appears **live** (no refresh) on a separately-open coach `GameManagement.tsx` session — this specifically proves the AppSync-write fix, not just that data lands in DynamoDB.
- Confirm a revoked/garbage token renders the "link revoked"/"not found" state instead of an unhandled error.
- Confirm the unauthenticated IAM role's AppSync policy is scoped to the specific field ARNs (`getFanGameView`, `submitStatEvent`) before merging B1/B2 — this check is a merge gate, not a nice-to-have.

## Next step

All three milestones are architecture/security-relevant multi-file changes — run each through the full `dev-pipeline` skill (plan-writer → architect-reviewer → ui-reviewer → coding-agent → parallel validation/security/UI review → commit gate), starting with Milestone A.
