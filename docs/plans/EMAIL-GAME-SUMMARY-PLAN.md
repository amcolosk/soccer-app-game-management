# Email Me A Game Summary — Implementation Plan

**Feature:** Manual "Email Summary" button on the completed-game screen. Sends the clicking coach a summary email of the game (their own address only — no team-wide fan-out, no opt-in setting; clicking is the consent).
**Status:** Approved — architecture review round 2 (final) and UI review both passed with no blocking findings. Ready for implementation.
**Last Updated:** 2026-09-16

---

## 0. Architecture Review Round 1 — Resolutions Log

| # | Finding | Resolution |
|---|---|---|
| Q1 | GameNote ordering: flat timestamp sort was a third ordering scheme not used elsewhere in the product | **Changed.** §6 now splits notes into two sections matching the app's own existing split (`PreGameNotesPanel.tsx` vs. `PlayerNotesPanel.tsx:147`'s `noteType !== 'coaching-point'` filter): "Pre-Game Notes" (timestamp asc) and "In-Game Notes" (half asc, gameSeconds asc, timestamp as tiebreak). Null-handling special case is gone — the validation invariant guarantees non-null `half`/`gameSeconds` in the in-game bucket. |
| Q2 | Team name inclusion in email | **Approved as planned**, no change. |
| Major 1 | Scan-vs-Query claim unverified | **Verified and changed to Query.** See §3.7 — read the actual `@aws-amplify/graphql-relational-transformer` source (`resolvers.js`, `updateTableForConnection`), not just analogy. Confirms `gsi-Game.goals` (on `Goal`, partition key `gameId`) and `gsi-Game.gameNotes` (on `GameNote`, partition key `gameId`) are unconditionally created by the transformer for these exact `hasMany`/`belongsTo` shapes — same mechanism already exploited by `revoke-coach-access`. Handler and IAM policy below now use `QueryCommand` + index ARNs, not `Scan`. |
| Major 2 | `Game.coaches`-only gate over-exposes rows the caller isn't backfilled onto | **Resolved — row-level filter added.** See §4/§5.2 step 9. Query adds `FilterExpression: 'contains(coaches, :callerId)'` on both `Goal` and `GameNote`, so a coach who is in `Game.coaches` but was never backfilled onto a specific pre-existing `Goal`/`GameNote` row (accept-invitation's IAM grants — `backend.ts:116-122` — do NOT backfill `Goal`/`GameNote`/`PlayTimeRecord`) sees exactly what the in-app UI would show them, not more. |
| Major 3 | No HTML escaping on interpolated user text (opponent, note text, player names) | **Resolved.** New `amplify/functions/shared/escapeHtml.ts` helper, applied to every dynamic value in the HTML branch. See §5.2a, §5.2b. |
| Major 4 | No rate limit on a user-triggered SES send sharing quota with invitation email | **Resolved.** New `EmailGameSummaryRateLimit` table, reusing `create-github-issue`'s `checkRateLimit` shape exactly (`amplify/functions/create-github-issue/handler.ts` lines 122-145), capped at 10 sends/caller/hour. See §4, §5.2, §5.6. |
| Minor 1 | `resource.ts` timeout | `timeoutSeconds: 60` (not 30), with the same rationale comment style as `revoke-coach-access/resource.ts:7`. |
| Minor 2 | Distinguish "not found" vs "not authorized"? | Kept distinguishing (matches `delete-game-safe` precedent) — explicit choice, noted in §5.2. |
| Minor 3 | New service file vs. existing `gameService.ts` | Changed — added to existing `src/services/gameService.ts`, no new service file. |
| Minor 4 | Jersey numbers in email? | Decision: **omitted**, deferred. Would require a `TeamRoster` read + new IAM grant for a field not in R1-R9's explicit scope. Noted in §6/§8 as a deliberate deferral, not a silent gap. |
| Minor 5 | Offline behavior | Addressed in §7 — custom mutations aren't queued by `offlineQueueService` (model-CRUD-only); button is online-only. |
| Minor 6 | PII risk line was inaccurate | Restated in §8 — this does move data into a new surface (inbox + SES/CloudWatch logs), not "no new exposure." |
| Minor 7 | `docs/ARCHITECTURE.md` has two stale lists | Both updated (§5.15) — new entries added accurately, existing drift (`send-bug-report`/`update-issue-status`/etc., already stale before this plan) not touched further. |
| Minor 8 | Button placement: between play-time table/timeline, or in `.completed-footer`? | Plan now proposes `.completed-footer` (alongside "View Full Season Report" / delete-game — same "game-level action" grouping), reusing existing CSS with no new block needed. **Final call deferred to ui-reviewer**, flagged explicitly in §5.10 and §12. |
| (approved as-is) | New Lambda folder, `allow.authenticated()` + in-handler check, per-table `PolicyStatement` IAM style, `EmailSummaryButton` as a separate component, archived-team behavior | No changes; archived-team sentence added to §7 for completeness/consistency with sibling handlers. |

---

## 1. Overview

Add a new Lambda-backed custom mutation, `emailGameSummary(gameId)`, invoked directly (synchronously, on click — not stream-triggered) from a new button rendered in `GameManagement.tsx`'s completed-state layout (`.completed-footer`, alongside the existing "View Full Season Report" link and delete-game button — see Minor 8). The Lambda:

1. Verifies the caller is in `Game.coaches` (403-equivalent otherwise), and the game is `completed`.
2. Applies a per-caller rate limit (10 sends/hour) before doing any further work.
3. Resolves the caller's email server-side via `cognito-idp:AdminGetUser` (access token has no `email` claim — CLAUDE.md's Amplify v6 auth gotcha).
4. Reads `Game`, `Team` (for names), and **queries** (not scans — confirmed GSIs exist, §3.7) all `Goal`/`GameNote` rows for the game, filtered server-side to rows whose own `coaches` array includes the caller (row-level parity with the in-app `ownersDefinedIn('coaches')` model auth this handler otherwise bypasses by using the raw SDK).
5. Resolves the `Player` rows referenced by those rows via chunked `BatchGetItem`.
6. Builds an HTML+text email (opponent/date/home-away/score; goals in order with scorer/assist; pre-game notes and in-game notes as two separately-ordered sections; every dynamic value HTML-escaped) and sends it via SES, reusing `send-invitation-email`'s SES send shape but not its DynamoDB Stream trigger.
7. Returns `{ success, sentTo }` synchronously so the UI can show a toast.

No changes to any existing data model's fields. Two new models (`EmailGameSummaryResult` customType — API response shape; `EmailGameSummaryRateLimit` — Lambda-only rate-limit table), one new Lambda, one new shared helper, one new frontend button component, one new function added to an existing service file.

---

## 2. Requirements Summary

| # | Requirement | Source |
|---|---|---|
| R1 | "Email Summary" button in completed-state layout | User requirement |
| R2 | Recipient is only the clicking coach, their own address; no opt-in setting | User requirement |
| R3 | Email resolved server-side via `cognito-idp:AdminGetUser` | User requirement, CLAUDE.md auth gotcha |
| R4 | Content: opponent, date, home/away, final score | User requirement |
| R5 | Content: goal scorers in order, with assist if present | User requirement |
| R6 | Content: all `GameNote` rows, chronological, unfiltered (notes + cards + gold stars) | User requirement |
| R7 | Lambda verifies caller ∈ `Game.coaches` before reading anything or sending | User requirement, CLAUDE.md authz pattern |
| R8 | Synchronous custom mutation taking `gameId`, returning success/failure for the UI | User requirement |
| R9 | Reuse `send-invitation-email`'s SES send shape, not its Stream trigger | User requirement |

---

## 3. Research Findings (grounding, not guesses)

### 3.1 `GameNote` model (`amplify/data/resource.ts` lines ~347–376)
```ts
GameNote: {
  gameId, game (belongsTo),
  noteType: a.string().required(),   // 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other'
  playerId: a.id(), player (belongsTo),
  authorId: a.string(),
  gameSeconds: a.integer(),  // null for pre-game/coaching-point notes
  half: a.integer(),         // null for pre-game/coaching-point notes
  notes: a.string(),         // free text, max 500 chars (enforced in create/update Lambdas)
  editedAt, editedById,
  timestamp: a.datetime().required(),  // real-world creation timestamp
  coaches: a.string().array(),
}
```
Validation invariant (enforced in `create-game-note`/`update-game-note` handlers, not the schema): `noteType === 'coaching-point'` ⇒ `gameSeconds === null && half === null`; every other `noteType` ⇒ both non-null. The four non-coaching-point types are exactly "cards" (`yellow-card`, `red-card`) and "gold-star recognitions" (`gold-star`), plus a catch-all `other`. Per requirement R6, the email includes **all** `GameNote` rows for the game regardless of `noteType` — no filtering by type. It **is** split by pre-game vs. in-game per the Q1 resolution above — that split mirrors an ordering distinction the app already makes (`PreGameNotesPanel.tsx` vs. `PlayerNotesPanel.tsx:147`), not a new filter.

### 3.2 `Goal` model (lines ~328–345)
```ts
Goal: {
  gameId, game (belongsTo),
  scoredByUs: a.boolean().required(),
  gameSeconds: a.integer().required(),
  half: a.integer().required(),
  scorerId: a.id(), scorer (belongsTo Player),   // only meaningful if scoredByUs
  assistId: a.id(), assist (belongsTo Player),   // optional
  notes: a.string(),
  timestamp: a.datetime().required(),
  coaches: a.string().array(),
}
```
No existing player-id→display-name helper is reused server-side elsewhere. The Lambda does its own minimal `BatchGetItem` against `Player` (id, firstName, lastName only), following the chunked-`BatchGetCommand` shape already used in `amplify/functions/get-team-coach-profiles/handler.ts` (`batchGetCoachProfiles`, lines 50–90) — reuse the *shape*, not the coach-profile-specific privacy logic (`Player` has no privacy setting to respect).

Ordering "in order" (R5) = sort by `half` ascending, then `gameSeconds` ascending.

### 3.3 Custom-mutation Lambda wiring pattern
Confirmed against `upsertMyCoachProfile`/`getTeamCoachProfiles` (`amplify/data/resource.ts` lines 728–749) and `createSecureGameNote` (lines 379–394):
1. `amplify/functions/<name>/resource.ts` — `defineFunction({ name, entry: './handler.ts', runtime: 22, timeoutSeconds, resourceGroupName: 'data' })`.
2. `amplify/functions/<name>/handler.ts` — typed `Schema['<mutationName>']['functionHandler']`.
3. `amplify/data/resource.ts` — import the function, add a `<mutationName>: a.mutation().arguments({...}).returns(a.ref(<Type>) | a.json()).authorization((allow) => [allow.authenticated()]).handler(a.handler.function(<fn>))` entry. Declared authorization is always just "must be signed in" — the real access check (team/game membership) happens inside the handler, since Amplify's declarative auth can't express "caller must be in this specific record's `coaches` array" for a *custom* op. Same shape as `archiveTeam`/`revokeCoachAccess`/`createGameSafe`.
4. `amplify/backend.ts` — import the function's `resource.ts` export, add it to the `defineBackend({...})` object, then wire least-privilege `PolicyStatement`s per table (`dynamodb:GetItem`/`Query`/`BatchGetItem` as needed) and `addEnvironment(...)` calls for table names.

### 3.4 Email resolution via `AdminGetUser`
CLAUDE.md's cited reference, `update-issue-status`, **no longer exists in this repo** — it was removed by the GitHub-issues migration (`docs/specs/Bug-Reporting-GitHub.md` lines 31, 169, 504; confirmed via grep, zero hits under `amplify/functions/`). The live, in-repo reference pattern is `amplify/functions/accept-invitation/handler.ts` (lines 161–201): a fallback chain — `identity.claims.email` → `identity.username` (if it looks like an email) → `identity.claims.username` → `identity.claims['cognito:username']` → `cognito-idp:AdminGetUser` keyed on `identity.username || identity.sub`, requiring `USER_POOL_ID` env var + `cognito-idp:AdminGetUser` IAM grant on `backend.auth.resources.userPool.userPoolArn` (wired in `amplify/backend.ts` lines 134–143).

Since the access token AppSync receives carries **no** `email` claim at all (CLAUDE.md), the first few fallback steps in that chain will essentially never resolve for an access-token-authenticated call — only `AdminGetUser` will. This plan keeps the full fallback chain anyway (cheap, defensive, consistent with the only two working examples in the codebase — `accept-invitation` and `get-user-invitations` both use it) rather than hand-rolling an `AdminGetUser`-only path.

### 3.5 `send-invitation-email` reusable pieces
`amplify/functions/send-invitation-email/handler.ts` has no exported/shared template helpers — the HTML/text bodies are inlined in `sendInvitationEmail()` (lines 52–202), and notably interpolates `teamName` into HTML with **no escaping** (lines 66, 132) — a gap this plan does not propagate (see Major 3 / §5.2a). This plan inlines a new template in the same visual style (header banner div, `.content` div, `.footer` div, matching inline CSS) rather than extracting a shared template module (small, one-off content shape; not worth a premature abstraction), but does add a small shared escaping helper (§5.2a) since that gap is a real, distinct security concern independent of the templating-reuse question. `FROM_EMAIL` is set as a literal in `send-invitation-email/resource.ts` (`'TeamTrack Support <admin@coachteamtrack.com>'`) — reuse the identical value, and reuse the already-verified SES identity/config-set ARNs already computed in `amplify/backend.ts` (`sesIdentityArn`, `sesConfigSetArn`, lines 74–79) for the new function's `ses:SendEmail`/`ses:SendRawEmail` grant.

### 3.6 Async-button UX pattern
No global toast/notification context component exists; the codebase uses `react-hot-toast` via `src/utils/toast.ts` (`showError`, `showSuccess`, `showWarning`, `showInfo`) — already the pattern `GameManagement.tsx`'s own `deleteGameButton` uses for its async mutation (lines 2107–2132: try/await/`showError` on catch). The new button follows the exact same shape: local `isSending` state, `showSuccess`/`showError` on settle, no new UI primitive needed.

Service-layer convention: a thin wrapper in `src/services/*.ts` that calls `client.mutations.<name>({...})` and unwraps via the shared `assertMutationResult` helper (`src/services/amplifyMutationResult.ts`) when the mutation `.returns(a.ref(<customType>))` — exactly what `src/services/gameService.ts`'s `createGame` and `teamLifecycleService.ts`'s `archiveTeam`/`restoreTeam`/`assignTeamOwner` do. Per Minor 3, `emailGameSummary` is added to the existing `gameService.ts` (already the game-scoped Lambda-mutation wrapper module) rather than a new file.

### 3.7 GSI verification for `Goal.gameId` / `GameNote.gameId` (Major 1)
`amplify/backend.ts` lines 423-434 (the `revoke-coach-access` grants) document that this repo already verified — against deployed CDK synth output — that Amplify Gen2 auto-creates a relationship GSI, named `gsi-<ParentModel>.<hasManyFieldName>`, on the *child* table for every implicit (`fields`/`references`-less) `hasMany`/`belongsTo` pair, keyed on the FK attribute, ALL-projection. `delete-game-safe`'s `Scan` over `Goal`/`GameNote` predates that finding and is not itself evidence the index doesn't exist — it just never got revisited.

This plan verified the mechanism directly rather than relying on analogy or a live deploy (neither AWS credentials nor a `cdk.out` artifact were available in the planning environment): `npm pack @aws-amplify/graphql-relational-transformer` (the actual open-source GraphQL transformer package Amplify Gen2's `defineData` runs under the hood) and read `lib/resolvers.js`:

```js
const updateTableForConnection = (config, ctx) => {
    const { fields, indexName: incomingIndexName } = config;
    if (incomingIndexName || fields.length > 0) {
        return;   // only skips if the model author supplied explicit fields/index
    }
    const { field, object, relatedType } = config;
    const mappedObjectName = ctx.resourceHelper.getModelNameMapping(object.name.value);
    ...
    const indexName = `gsi-${mappedObjectName}.${field.name.value}`;
    ...
    addGlobalSecondaryIndex(table, { indexName, partitionKey: { name: partitionKeyName, ... }, ... projectionType: 'ALL' ... });
};
```
This runs **unconditionally** for every implicit relation — exactly the shape used by `Game.goals: a.hasMany('Goal', 'gameId')` / `Goal.game: a.belongsTo('Game', 'gameId')` and `Game.gameNotes: a.hasMany('GameNote', 'gameId')` / `GameNote.game: a.belongsTo('Game', 'gameId')` (no `fields`/`references`/custom index specified on either side, same as the already-verified `Team.roster`/`Team.games`/etc. pairs). `object` here is `Game` (the type declaring the `hasMany` field), `field.name.value` is `goals` / `gameNotes` — so the created indexes are:

- **`gsi-Game.goals`** on the `Goal` table, partition key `gameId`, projection `ALL`.
- **`gsi-Game.gameNotes`** on the `GameNote` table, partition key `gameId`, projection `ALL`.

**Conclusion: switch both reads from `Scan` to `Query` against these indexes.** IAM grants must include both the table ARN and the specific index ARN (`${tableArn}/index/gsi-Game.goals`, `${tableArn}/index/gsi-Game.gameNotes`) — a table-ARN-only grant does not authorize a GSI `Query`, per the `revoke-coach-access` comment block's own warning (`amplify/backend.ts` lines 423-434). This is confirmed against the transformer's actual source, not asserted by precedent alone; still, the implementer should do one cheap sanity check the first time this deploys to a real sandbox — a `ResourceNotFoundException: index not found` on first invocation would mean this analysis needs revisiting — but no code-level fallback-to-Scan branch is needed given the strength of this evidence.

### 3.8 Rate limiting precedent (Major 4)
`amplify/functions/create-github-issue/handler.ts` lines 118-145 (`checkRateLimit`) is the exact existing pattern for a user-triggered, quota-sensitive action: a dedicated table keyed on `(userId, hourBucket)`, an `UpdateCommand` with `ADD #count :one SET #ttl = if_not_exists(...)` (atomic increment + one-time TTL set), and a post-increment threshold check that throws if exceeded. `BugReportRateLimit` (`amplify/data/resource.ts` lines 442-453) is the backing table shape: `identifier(['userId', 'hourBucket'])`, `count`, `ttl`, `allow.authenticated().to([])` (no client access at all — Lambda-only via IAM). This plan reuses both pieces verbatim for `emailGameSummary`, under a new dedicated table (not a shared counter with bug reports — different resource, different legitimate-use volume shape) — see §4, §5.2, §5.6.

---

## 4. Data Model Impact

**No changes to any existing model's fields.** This feature is additive/read-only against `Game`, `Team`, `Goal`, `GameNote`, `Player`. Two new schema additions:

```ts
// amplify/data/resource.ts
EmailGameSummaryResult: a.customType({
  success: a.boolean().required(),
  sentTo: a.string(), // the resolved recipient address, for the success toast
}),

emailGameSummary: a
  .mutation()
  .arguments({
    gameId: a.string().required(),
  })
  .returns(a.ref('EmailGameSummaryResult'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(emailGameSummary)),

// Rate limiting (Major 4) — identical shape to BugReportRateLimit, own table
// (own resource, own legitimate-volume profile; not sharing a counter with
// bug reports).
EmailGameSummaryRateLimit: a
  .model({
    userId: a.string().required(),
    hourBucket: a.string().required(), // ISO hour e.g. "2026-03-07T14"
    count: a.integer().required(),
    ttl: a.integer(), // Unix timestamp for DynamoDB TTL auto-expiry (2 hours)
  })
  .identifier(['userId', 'hourBucket'])
  .authorization((allow) => [
    // No client access — only Lambda IAM role accesses this table
    allow.authenticated().to([]),
  ]),
```

**Authorization decision (Major 2, explicit — not left implicit):** `Goal`/`GameNote` both carry their own `coaches[]` and use `allow.ownersDefinedIn('coaches')` at the model level, but this handler reads them via the raw DynamoDB SDK (bypassing that row-level AppSync authorization entirely, same as every other custom-mutation Lambda in this repo). `accept-invitation`'s coach-onboarding backfill (`backend.ts` lines 116-122) does **not** touch `Goal`/`GameNote`/`PlayTimeRecord` — so a coach who joins a team after some goals/notes already exist is present in `Game.coaches` (Games *are* backfilled) but absent from those specific pre-existing `Goal`/`GameNote` rows' own `coaches` arrays. The in-app UI, which does go through normal AppSync `ownersDefinedIn` auth, would not show that coach those older rows.

**Chosen approach: (a) filter to row-level visibility**, not "declare `Game.coaches` the sole gate." The `Query` against `gsi-Game.goals`/`gsi-Game.gameNotes` includes `FilterExpression: 'contains(coaches, :callerId)'` alongside the `KeyConditionExpression: 'gameId = :gameId'`, so the email can never contain a goal or note the caller wouldn't already be able to see in the app itself. `Game.coaches` membership remains the *first* gate (cheap early rejection of a caller with zero relationship to the game at all — §5.2 step 4); the per-row filter is a second, independent check applied to the actual content, not a replacement for it. Test case added in §10.

No `coaches[]` population concern for the two new records — `EmailGameSummaryResult` is a non-persisted response shape, and `EmailGameSummaryRateLimit` rows are Lambda-only (no coach ever reads them, no multi-coach sharing concept applies to a per-user rate-limit counter).

---

## 5. File-by-File Change List

### 5.1 NEW: `amplify/functions/email-game-summary/resource.ts`
```ts
import { defineFunction } from '@aws-amplify/backend';

export const emailGameSummary = defineFunction({
  name: 'email-game-summary-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60, // Cognito AdminGetUser + 2 point reads + 2 GSI queries + BatchGet + SES send, cold start — matches revoke-coach-access's 60s (not assign-team-owner's 30s single-item one)
  resourceGroupName: 'data',
  environment: {
    FROM_EMAIL: 'TeamTrack Support <admin@coachteamtrack.com>',
  },
});
```

### 5.2 NEW: `amplify/functions/email-game-summary/handler.ts`
Typed as `Schema['emailGameSummary']['functionHandler']`. Logic:

1. Extract `callerSub = (event.identity as AppSyncIdentityCognito)?.sub`; throw `'User not authenticated'` if missing.
2. Read `gameId` from `event.arguments`. Read env vars `GAME_TABLE`, `TEAM_TABLE`, `GOAL_TABLE`, `GAME_NOTE_TABLE`, `PLAYER_TABLE`, `RATE_LIMIT_TABLE`, `USER_POOL_ID`, `FROM_EMAIL`; throw if any missing.
3. `GetCommand` the `Game`. Throw `'Game not found'` if absent. **(Minor 2 — deliberately distinguished from the access-denied error below, matching `delete-game-safe`'s precedent of a specific "not found" message; the alternative single generic-error style from `get-team-coach-profiles` was considered and rejected here since a coach clicking the button on their own already-rendered completed-game screen realistically never hits "not found" except via a stale/deleted-game race, which deserves a distinct, clearer message than "access denied.")**
4. **Authz gate (R7) — before any other read**: `if (!game.coaches?.includes(callerSub)) throw new Error('Access denied: caller is not a coach on this game')`. Mirrors `create-game-note`/`delete-game-safe`'s exact check.
5. **Status gate**: `if (game.status !== 'completed') throw new Error('Game summary email is only available once the game is completed')`. (No special-case for archived teams — an archived team's games remain readable/emailable, consistent with the rest of the app's "archived = read-only, not read-blocked" behavior.)
6. **Rate limit gate (Major 4)**: `checkRateLimit(callerSub)` — same `UpdateCommand`-based atomic-increment-then-check shape as `create-github-issue/handler.ts` lines 122-145, against `RATE_LIMIT_TABLE`, `MAX_SUMMARY_EMAILS_PER_HOUR = 10` (generous relative to realistic usage — a handful of completed games in a single tournament day — while still bounding the cost of a bypassed/absent client-side `isSending` guard, direct API calls, or reload-and-reclick). Throws `'Rate limit exceeded. Try again later.'` if exceeded. Placed after the authz/status gates (so a caller who isn't even a coach on the game, or the game isn't completed, doesn't consume their own quota on a call that was going to fail anyway) but before any further reads.
7. Resolve caller email via the `accept-invitation`-style fallback chain (§3.4), ending in `AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: identity.username || callerSub })`. If no email attribute is found after all fallbacks, throw `'Unable to resolve your account email address'` (edge case: coach's Cognito user has no email attribute — surfaces as a clear button-click error, not a silent no-op).
8. `GetCommand` the `Team` (best-effort — used only for display name in the subject/greeting; if missing, fall back to a generic `'Your Team'` string rather than failing the whole send).
9. In parallel, `QueryCommand` both `Goal` and `GameNote` (§3.7/§4): `IndexName: 'gsi-Game.goals'` / `'gsi-Game.gameNotes'`, `KeyConditionExpression: 'gameId = :gameId'`, `FilterExpression: 'contains(coaches, :callerId)'`, `ExpressionAttributeValues: { ':gameId': gameId, ':callerId': callerSub }`. Paginate via `LastEvaluatedKey` in a `do...while` loop (same shape as `delete-game-safe`'s `scanAll`, renamed locally to `queryAllByGameId` since it's now index-based, not a full scan).
10. Split `GameNote` results into `preGameNotes` (`noteType === 'coaching-point'`, sorted by `timestamp` ascending) and `inGameNotes` (everything else, sorted by `(half, gameSeconds)` ascending with `timestamp` as a tiebreak) — see Q1 resolution in §0/§6. Sort `Goal` results by `(half, gameSeconds)` ascending.
11. Collect distinct player IDs referenced (`goal.scorerId`, `goal.assistId`, `note.playerId` across both note buckets), `BatchGetCommand` the `Player` table (id, firstName, lastName only) in chunks of 100, matching `get-team-coach-profiles/handler.ts`'s `batchGetCoachProfiles` shape. Build an `id → "First Last"` map; any ID with no match (e.g. a hard-deleted-player edge case) renders as `"a former player"` rather than blank/crashing.
12. Build subject: `` `Game Summary: ${teamName} vs ${game.opponent}` ``. Build HTML + plain-text bodies (§6 below), passing every dynamic string through the new `escapeHtml` helper (§5.2a) in the HTML branch only.
13. `SendEmailCommand` via `SESClient`, `Source: FROM_EMAIL`, `Destination.ToAddresses: [resolvedEmail]`. **Do not catch-and-swallow** the SES call — let a send failure propagate as a thrown error (surfaces to the UI as an error toast; edge case "SES send failure must not silently succeed").
14. Return `{ success: true, sentTo: resolvedEmail }`.

### 5.2a NEW: `amplify/functions/shared/escapeHtml.ts` (Major 3)
A minimal, dependency-free helper — this folder is already the established home for cross-function logic (`coachArraySync.ts`, `ical/parser.ts`):
```ts
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes the five HTML-significant characters. Apply to every dynamic
 * string interpolated into an HTML email/document body — do NOT apply to
 * plain-text bodies (unnecessary there, and would show literal "&amp;" etc.
 * to the reader). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}
```
Applied in the new handler to: `teamName`, `game.opponent`, every resolved player display name (scorer/assist/note-player), and `GameNote.notes` free text (the highest-risk field — up to 500 chars of coach-authored content, potentially containing `<a href>`/`<script>`-shaped text). Not applied to the plain-text email branch.

### 5.2b NEW: `amplify/functions/shared/escapeHtml.test.ts`
Cases: escapes all five characters; leaves plain alphanumeric/punctuation text untouched; a realistic phishing-style input (`<a href="evil.example">click</a>`) renders as inert escaped text, not a live tag, when the output is embedded in an HTML fragment assertion.

### 5.3 NEW: `amplify/functions/email-game-summary/handler.test.ts`
Vitest, mocking `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-ses`, `@aws-sdk/client-cognito-identity-provider` the same way `get-team-coach-profiles/handler.test.ts` mocks Dynamo (hoisted `mockSend` per client). Cases:
- Caller not in `Game.coaches` → throws access-denied, no Query/BatchGet/SES/rate-limit calls made (assert call counts).
- `Game` not found → throws distinct "not found" message, no further calls.
- `Game.status !== 'completed'` (e.g. `'in-progress'`) → throws, no Query/GameNote/SES/rate-limit calls.
- Rate limit exceeded (`checkRateLimit` returns/mocks a count over the cap) → throws `'Rate limit exceeded...'`, no Query/BatchGet/SES calls made after the check.
- **Row-level filter (Major 2):** mocked `QueryCommand` response includes a `Goal`/`GameNote` row whose `coaches` array does *not* include the caller — asserted via the constructed `FilterExpression`/`ExpressionAttributeValues` on the `QueryCommand` call (`contains(coaches, :callerId)` present with the correct caller ID), and/or via a mock that only returns filter-matching rows and confirms the email body doesn't reference the excluded row's content.
- **Query targets the confirmed GSIs, not Scan:** asserts `QueryCommand` (not `ScanCommand`) is constructed with `IndexName: 'gsi-Game.goals'` and `'gsi-Game.gameNotes'` respectively.
- Happy path: mocked Game (completed, caller in coaches), Team, Goal rows (mixed `scoredByUs`), GameNote rows split across pre-game (`coaching-point`, null half/gameSeconds) and in-game (`yellow-card`, `gold-star`, `other`) types → asserts `SendEmailCommand` called once with the resolved recipient, correct subject, correct two-section note ordering, and that the email body contains each goal's scorer/assist name and every note's text (spot-check via substring assertions on the `Html`/`Text` body strings).
- **HTML escaping (Major 3):** a `GameNote.notes` value containing `<a href="...">`/`<script>` renders as escaped entities in the `Html` body (assert no literal `<a `/`<script` substring survives) while the `Text` body contains the raw, unescaped string.
- Game with zero goals and zero notes → still sends, body contains the "no goals recorded"/"no pre-game notes"/"no in-game notes" copy (not a blank section).
- `AdminGetUser` returns no `email` attribute (and all earlier fallbacks also miss) → throws `'Unable to resolve your account email address'`, no SES call.
- `SendEmailCommand` rejects (mocked SES throwing) → error propagates out of the handler (not swallowed), asserted via `await expect(handler(...)).rejects.toThrow(...)`.

### 5.4 NEW: `amplify/functions/email-game-summary/package.json`
Mirrors `get-team-coach-profiles/package.json` shape, dependencies: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-ses`, `@aws-sdk/client-cognito-identity-provider`, devDependency `@types/aws-lambda`.

### 5.5 MODIFIED: `amplify/data/resource.ts`
- Add `import { emailGameSummary } from "../functions/email-game-summary/resource";` alongside the other function imports (top of file).
- Add the `EmailGameSummaryResult` customType, `EmailGameSummaryRateLimit` model, and `emailGameSummary` mutation (§4 above), placed near the other Game-adjacent custom mutations (after `createGameSafe`, before `CalendarFeed`) and near `BugReportRateLimit` for the rate-limit table (keeps same-shaped Lambda-only tables grouped).

### 5.6 MODIFIED: `amplify/backend.ts`
- Import `emailGameSummary` from `./functions/email-game-summary/resource`.
- Add `emailGameSummary` to the `defineBackend({...})` object.
- Wire least-privilege grants, reusing the existing `gameTable`, `teamTable`, `goalTable`, `gameNoteTable`, `playerTable` constants already declared in the file (lines 102-113; `playerTable` is already in scope from `acceptInvitation`'s grants):
  ```ts
  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [gameTable.tableArn, teamTable.tableArn],
    })
  );

  // Major 1 / §3.7: Query against the confirmed relationship GSIs — table
  // ARN alone does not authorize a GSI Query (see revoke-coach-access's own
  // comment on this, lines 423-434), so both the table and index ARNs are
  // granted, same shape as that Lambda's TeamRoster/FieldPosition/Game/
  // TeamInvitation grants.
  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [
        goalTable.tableArn, `${goalTable.tableArn}/index/gsi-Game.goals`,
        gameNoteTable.tableArn, `${gameNoteTable.tableArn}/index/gsi-Game.gameNotes`,
      ],
    })
  );

  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem'],
      resources: [playerTable.tableArn],
    })
  );

  backend.emailGameSummary.addEnvironment('GAME_TABLE', gameTable.tableName);
  backend.emailGameSummary.addEnvironment('TEAM_TABLE', teamTable.tableName);
  backend.emailGameSummary.addEnvironment('GOAL_TABLE', goalTable.tableName);
  backend.emailGameSummary.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
  backend.emailGameSummary.addEnvironment('PLAYER_TABLE', playerTable.tableName);

  // Cognito email resolution (accept-invitation pattern, §3.4)
  backend.emailGameSummary.addEnvironment('USER_POOL_ID', backend.auth.resources.userPool.userPoolId);
  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [backend.auth.resources.userPool.userPoolArn],
    })
  );

  // SES send (reuses the identity/config-set ARNs already computed for sendInvitationEmail, lines 74-79)
  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [sesIdentityArn, sesConfigSetArn],
    })
  );

  // Rate limiting (Major 4 / §3.8) — Lambda-only table, UpdateItem only
  // (atomic ADD counter), no GetItem/Query needed since checkRateLimit's
  // single UpdateCommand with ReturnValues: 'ALL_NEW' both writes and reads.
  const emailGameSummaryRateLimitTable = backend.data.resources.tables['EmailGameSummaryRateLimit'];
  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['dynamodb:UpdateItem'],
      resources: [emailGameSummaryRateLimitTable.tableArn],
    })
  );
  backend.emailGameSummary.addEnvironment('RATE_LIMIT_TABLE', emailGameSummaryRateLimitTable.tableName);
  ```

### 5.7 MODIFIED: `src/services/gameService.ts` (Minor 3 — not a new file)
Add alongside the existing `createGame`:
```ts
/** Sends the calling coach a summary email for a completed game they coach. Recipient is always the caller's own Cognito email — resolved server-side, never client-supplied. */
export async function emailGameSummary(gameId: string): Promise<NonNullable<Schema['emailGameSummary']['returnType']>> {
  const result = await client.mutations.emailGameSummary({ gameId });
  return assertMutationResult(result, 'Failed to send game summary email');
}
```

### 5.8 NEW: `src/components/GameManagement/EmailSummaryButton.tsx`
Small, self-contained component (pure-ish, one Amplify-backed action) — follows the "each completed-state section is its own component" convention, but is deliberately **not** merged into `CompletedPlayTimeSummary` (that component is explicitly documented as having "No imports of Amplify client or hooks — pure display component"; keep that boundary intact).

```ts
interface EmailSummaryButtonProps {
  gameId: string;
}

export function EmailSummaryButton({ gameId }: EmailSummaryButtonProps) {
  const [isSending, setIsSending] = useState(false);

  const handleClick = async () => {
    setIsSending(true);
    try {
      const result = await emailGameSummary(gameId);
      showSuccess(result.sentTo ? `Summary sent to ${result.sentTo}` : 'Summary sent');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to send summary email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="btn-secondary"
      disabled={isSending}
    >
      {isSending ? 'Sending…' : 'Email Game Summary'}
    </button>
  );
}
```
Button label is "Email Game Summary" (not the shorter "Email Summary") per ui-reviewer's accessibility finding — a generic "Email Summary" is ambiguous to a screen-reader user scanning a button list out of context, and the app already disambiguates similarly generic actions elsewhere (`"Delete Game"` not `"Delete"`, `"Delete Account"` not `"Delete"`). Uses `showSuccess`/`showError` from `src/utils/toast.ts` — same as `deleteGameButton`'s inline handler in `GameManagement.tsx`. No wrapping `<div>` with a dedicated CSS class — it renders as a plain sibling button inside `.completed-footer`, which already provides flex/gap layout.

### 5.9 NEW: `src/components/GameManagement/EmailSummaryButton.test.tsx`
Mocks `src/services/gameService.ts` (`vi.mock`) and `src/utils/toast.ts`. Cases:
- Renders "Email Game Summary" button, not disabled initially.
- Click → button shows "Sending…" and is disabled while the mocked promise is pending.
- Resolves with `{ success: true, sentTo: 'coach@example.com' }` → `showSuccess` called with a message containing the email; button re-enabled.
- Rejects with an `Error('Access denied...')` → `showError` called with that message; button re-enabled (not stuck disabled).
- Rejects with a non-`Error` throw → `showError` called with the generic fallback message.

### 5.10 MODIFIED: `src/components/GameManagement/GameManagement.tsx`
- Import `EmailSummaryButton` from `./EmailSummaryButton`.
- **Placement (Minor 8/§12 — RESOLVED by ui-reviewer: use `.completed-footer`).** The `.completed-footer`/`.delete-game-section` divider (`App.css:3990-3996`) already visually separates the destructive delete action from what sits above it, and "View Full Season Report" already establishes this footer as the home for data-export-adjacent actions on this screen — Email Summary fits the same category. Render inside the existing `completed-footer` block (line ~2679-2686), between the "View Full Season Report" link and `deleteGameButton`:
  ```tsx
  {gameState.status === 'completed' && (
    <div className="completed-footer">
      <Link to={`/reports/${team.id}`} className="btn-link completed-report-link__anchor">
        View Full Season Report →
      </Link>
      <EmailSummaryButton gameId={game.id} />
      {deleteGameButton}
    </div>
  )}
  ```
  `game.id` is already in scope (used elsewhere in this component, e.g. `deleteGameCascade(game.id)`).

### 5.11 MODIFIED: `src/App.css`
**No changes needed.** With the `.completed-footer` placement (§5.10), no new CSS block is required — `.completed-footer` (`App.css` lines 8307-8314) is already a `flex`/`column`/`gap: 1rem` container and the button reuses the existing `.btn-secondary` class. ui-reviewer confirmed the global `button:disabled { opacity: 0.5; cursor: not-allowed; }` rule (`src/index.css:136-139`) already applies to every button including `.btn-secondary` (already used disabled elsewhere, e.g. `PlayerNotesPanel.tsx:587`, `CreateEditNoteModal.tsx:164`), so the disabled state needs no new rule.

### 5.12 MODIFIED: `src/types/schema.ts`
Add, alongside the existing `CalendarSyncResult` line (19):
```ts
export type EmailGameSummaryResult = NonNullable<Schema["emailGameSummary"]["returnType"]>;
```
Not strictly required by the button component (which can consume the service's return type directly), but matches this file's existing convention of centralizing every schema-derived type.

### 5.13 MODIFIED: `README.md`
- **Features → Game Day Management**: add a bullet, e.g. `- **Email Game Summary**: After a game is completed, a coach can email themselves a summary — final score, goal scorers/assists, and all game notes/cards/gold stars`.
- **Technology Stack**: update the `Email` line from `Amazon SES (team invitation emails)` to `Amazon SES (team invitation emails, post-game summary emails)`.
- No Data Model section change — no new coach-visible model (the rate-limit table is Lambda-only, not part of the app's data model from a coach's perspective).

### 5.14 MODIFIED: `docs/specs/UI-SPEC.md`
Update §7.6 "Game Management — Completed State" (lines 433–447), "Components Rendered" list:
```
1. **GameHeader** — final score
2. Play time summary table (player → total minutes)
3. Game notes summary (gold stars, cards)
4. **Completed-footer actions**: `View Full Report` link → `/reports/:teamId`; **Email Game Summary button** — sends the current coach a game-summary email (opponent, score, goals, pre-game and in-game notes); shows a loading state while sending and a success/error toast on completion; delete-game button
```
(Also fixes pre-existing spec drift: the current list at lines 442-447 doesn't mention the delete-game button at all — folding it in here per ui-reviewer's note, since this list is already being touched.)

### 5.15 MODIFIED: `docs/ARCHITECTURE.md` (Minor 7 — both stale lists)
Both the Lambda Functions table (~line 348) and the GraphQL Operations list (~line 360) currently list `send-bug-report`/`update-issue-status`/`submitBugReport`/`updateIssueStatus`, none of which exist anymore (§3.4) — pre-existing drift, not touched further here, just not perpetuated by the new entries. Add:

Lambda Functions table, new row:
```
| `email-game-summary` | Custom GraphQL mutation | Verifies caller is in `Game.coaches` and the game is completed, rate-limits per caller, resolves caller's email via `AdminGetUser`, queries `Goal`/`GameNote` via their relationship GSIs filtered to caller-visible rows, and sends a summary email (score, goals, notes) via SES |
```
GraphQL Operations list, new bullet:
```
- `emailGameSummary` mutation — sends the calling coach a summary email for a completed game they coach
```

---

## 6. Email Content Spec

**Subject:** `Game Summary: {teamName} vs {opponent}`

**Body sections (HTML mirrors `send-invitation-email`'s visual style — header banner, `.content` box, `.footer`; plain-text fallback included per SES multipart convention). Every dynamic value in the HTML branch is passed through `escapeHtml` (§5.2a) — the plain-text branch uses raw values, unescaped, since it's not markup:**

1. **Header:** `{teamName} vs {opponent}` — `{Home|Away}` — formatted `gameDate` (fallback: "Date not recorded" if `gameDate` is null) — **Final Score:** `{teamName} {ourScore} – {opponent} {opponentScore}`. (Jersey numbers are not included anywhere in the email — Minor 4 — since they live on `TeamRoster`, not `Player`, and pulling them in would need a new table read/IAM grant for a field outside R1-R9's explicit scope. Deliberate deferral, not an oversight.)
2. **Goals** (sorted `half` asc, `gameSeconds` asc):
   - If none: "No goals recorded for this game."
   - Else, one line per goal: `Half {half}, {mm:ss} — ` then either `{teamName} goal by {scorerName}` (+ `, assisted by {assistName}` if `assistId` present) when `scoredByUs`, or `{opponent} goal` when not `scoredByUs` (no scorer/assist fields exist for opponent goals in the schema).
3. **Pre-Game Notes** (Q1 resolution — separate section, `noteType === 'coaching-point'` only, sorted `timestamp` asc):
   - If none: "No pre-game notes recorded."
   - Else, one line per note: `{formatted timestamp} — {notes text}` (no player attribution shown here even if `playerId` is set — pre-game notes are general team-level notes by convention, matching `PreGameNotesPanel.tsx`'s own display).
4. **In-Game Notes** (Q1 resolution — separate section, every `noteType !== 'coaching-point'`, sorted `half` asc then `gameSeconds` asc, `timestamp` as tiebreak):
   - If none: "No in-game notes recorded."
   - Else, one line per note: `Half {half}, {mm:ss} — [{noteTypeLabel}]{ ' ' + playerName if playerId present }: {notes text}`, where `noteTypeLabel` maps `gold-star → "⭐ Gold Star"`, `yellow-card → "🟨 Yellow Card"`, `red-card → "🟥 Red Card"`, `other → "Note"`. (`coaching-point` never appears here by construction — it's exhaustively the other bucket.)
5. **Footer:** standard "you're receiving this because you clicked Email Summary in TeamTrack" line — no unsubscribe link needed (not a recurring/marketing email; matches R2's "clicking is the consent" decision).

---

## 7. Edge Cases

| Case | Handling |
|---|---|
| Caller not in `Game.coaches` | Handler throws before any Query/BatchGet/SES/rate-limit call; AppSync surfaces the error; button shows `showError` toast |
| `Game.status !== 'completed'` | Handler throws a clear message; caught by the button, shown via `showError`. (UI layer never actually offers the button outside `completed-layout`, so this is a defense-in-depth server check, not the primary UX gate) |
| Caller is in `Game.coaches` but not backfilled onto a specific older `Goal`/`GameNote` row (Major 2) | Row-level `FilterExpression: contains(coaches, :callerId)` excludes it from both the Query result and the email — matches what that coach would see in-app |
| Caller exceeds 10 sends/hour (Major 4) | Handler throws `'Rate limit exceeded. Try again later.'` before any Query/SES call; shown via `showError` |
| Game has no goals | Email still sends; "No goals recorded" copy, not an empty/malformed section |
| Game has no pre-game or in-game notes | Email still sends; each empty section gets its own "No ... recorded" copy independently |
| `GameNote.notes` contains HTML-significant characters (Major 3) | Escaped in the HTML body via `escapeHtml`; shown raw (correctly) in the plain-text body |
| SES send failure (throttling, unverified identity edge case, etc.) | Not caught/swallowed in the handler — propagates as a thrown error, AppSync returns it as a GraphQL error, `assertMutationResult` throws, button's catch shows `showError`. UI never shows a false "Sent!" success |
| Coach's Cognito user has no `email` attribute at all | All fallback steps miss (including `AdminGetUser`); handler throws `'Unable to resolve your account email address'` before touching Goal/GameNote/Player tables, rate-limit table, or SES |
| Goal/GameNote references a player ID that no longer resolves (edge case even though `delete-player-safe` cascades `Goal`/`GameNote` cleanup on delete) | Batch-get miss renders as `"a former player"` rather than blank text or a crash |
| `Team` record missing (orphaned game) | Falls back to `"Your Team"` in subject/header rather than failing the whole send |
| Game belongs to an archived team | No special-case — archived teams are read-only, not read-blocked; the game and its goals/notes remain fully queryable and emailable, consistent with how the rest of the app treats archived-team data (view/report, not edit) |
| Coach is offline (or the mutation call fails mid-flight for a network reason) | Custom mutations are **not** queued by `offlineQueueService` (it only intercepts model create/update/delete calls, not custom Lambda-backed mutations) — this is an online-only action. A network failure surfaces as a rejected promise from `client.mutations.emailGameSummary(...)`, caught by `EmailSummaryButton`'s existing try/catch, showing the generic `'Failed to send summary email'` fallback via `showError` (the thrown error in this case is a raw network/GraphQL-transport error, not one of the handler's own `Error` messages, so it won't have a specific instructive string — acceptable, since retry-when-back-online is the only actionable guidance anyway) |
| Double-click / rapid repeat clicks | Button is `disabled` while `isSending` is true — prevents duplicate concurrent sends from a single click sequence. (Two separate deliberate clicks across two sends is accepted — each is a valid, intentional resend, within the rate limit's bound) |

---

## 8. Risks

- **SES sending limits/quota shared with invitation email:** mitigated by the new per-caller rate limit (Major 4, §3.8, §4) — 10 sends/caller/hour bounds worst-case volume from a single compromised/misbehaving client to a level far below any realistic SES account-level quota concern, and specifically prevents this feature from being able to exhaust the shared quota and cause `send-invitation-email` (a business-critical path) to start failing. No SES-quota-headroom analysis was done beyond this bound, since the bound itself is the mitigation, not a claim about current quota headroom.
- **IAM permission scope:** kept least-privilege and per-table (mirrors `getTeamCoachProfiles`/`archiveTeam`/`revoke-coach-access` style grants, not a blanket `grantReadWriteData`) — `GetItem` only on `Game`/`Team`, `Query` (not `Scan`) on the confirmed `Goal`/`GameNote` relationship GSIs with both table and index ARNs granted, `UpdateItem` only on the new rate-limit table, no write actions granted on any coach-visible table (this Lambda never mutates `Game`/`Goal`/`GameNote`/`Player`).
- **PII exposure (restated accurately, Minor 6):** this feature moves player first/last names and disciplinary records (yellow/red cards) — data a coach can already see on-screen in the completed-game view — into a **new** surface: the coach's own email inbox, plus SES delivery logs and this Lambda's CloudWatch logs. That's a real, distinct exposure surface (a different retention/access model than an authenticated in-app view, e.g. inbox forwarding, email provider retention, log retention policy), even though the only recipient is the same coach who already has read access to the underlying data. Not blocking — this is the entire point of the feature and R2's "clicking is the consent" already accepts it for the recipient side — but it should not be described as "no new exposure."
- **`Query`-based reads on `Goal`/`GameNote` via their relationship GSIs (Major 1, resolved):** confirmed to exist via the actual transformer source (§3.7), not analogy — this removes what would otherwise have been an unbounded-Scan risk on a synchronous, user-facing click path. Residual risk is limited to the (considered unlikely, given the source-level evidence) case that the first real sandbox deploy surfaces a `ResourceNotFoundException` for either index name, which would be caught immediately by the handler's own `handler.test.ts` `IndexName` assertions failing to match reality only if a manual deploy/integration check is also run — this plan does not add an automated deploy-time index-existence check beyond that.

---

## 9. Sequencing

1. Backend first (`amplify/functions/email-game-summary/`, `amplify/functions/shared/escapeHtml.ts`, `amplify/data/resource.ts`, `amplify/backend.ts`) — the frontend service/component import `Schema['emailGameSummary']`, which only exists after the schema change is deployed (`ampx sandbox` locally / pipeline-deploy in CI) and generated types are refreshed. The new `EmailGameSummaryRateLimit` table must exist before the handler's `checkRateLimit` can run (same ordering constraint `create-github-issue`/`BugReportRateLimit` already has).
2. On first real sandbox deploy, do a quick manual smoke check that the `Query` calls against `gsi-Game.goals`/`gsi-Game.gameNotes` succeed against a real game with at least one goal and one note (cheap, since §3.7's evidence is strong but not itself a live-deploy confirmation).
3. Frontend service addition (`gameService.ts`) and `EmailSummaryButton.tsx` next, once the mutation is deployed and typed.
4. `GameManagement.tsx` wiring + any CSS adjustment last, after ui-reviewer resolves the Minor 8 placement question.
5. Docs (`README.md`, `UI-SPEC.md`, `ARCHITECTURE.md`) updated alongside the corresponding code change, not deferred to the end.

---

## 10. Test Strategy

**Backend (`amplify/functions/email-game-summary/handler.test.ts`, Vitest, mocked AWS SDK clients — full case list in §5.3):**
- Authz rejection (caller ∉ `Game.coaches`).
- Game-not-found rejection.
- Non-`completed` status rejection.
- Rate-limit-exceeded rejection, before any Query/SES call.
- Row-level visibility filter (Major 2) — excluded row never reaches the email.
- `QueryCommand` (not `ScanCommand`) used, with the correct `IndexName`s (Major 1).
- Happy path: correct SES call (recipient, subject, two-section note ordering, body contents) with mixed goals/notes/note-types.
- HTML escaping (Major 3) — malicious-shaped note text is inert in the HTML body, raw in the text body.
- Empty-goals / empty-pre-game-notes / empty-in-game-notes still sends with fallback copy, independently.
- Email-resolution total failure (no `AdminGetUser` email attribute).
- SES send failure propagates, is not swallowed.

`amplify/functions/shared/escapeHtml.test.ts` (§5.2b): escaping correctness, no-op on safe input, phishing-shaped input rendered inert.

**Frontend (`src/components/GameManagement/EmailSummaryButton.test.tsx`, Vitest + Testing Library, mocked service module — see §5.9):**
- Default render state.
- Pending/disabled state during send.
- Success toast path.
- Error toast path (both `Error` and non-`Error` rejection shapes).

**Existing tests affected:** `GameManagement.test.tsx` may need an assertion update if it asserts the exact child list of `.completed-footer` or `completed-layout` (grep for any such assertion during implementation) — otherwise no existing test should need behavior changes, since this is purely additive.

**Not covered by unit tests (acceptable gap, per CLAUDE.md's e2e layering guidance):** actual SES delivery — mocked at the SDK boundary in both directions (`send-invitation-email` has no e2e SES-delivery test either, for the same reason: no real inbox to assert against in CI).

---

## 11. Questions / Assumptions Resolved While Planning

- **GameNote ordering** (Q1, revised): two sections — Pre-Game Notes (timestamp asc) and In-Game Notes (half asc, gameSeconds asc, timestamp tiebreak) — matching the app's own existing `PreGameNotesPanel`/`PlayerNotesPanel` split, not a new third ordering scheme.
- **Opponent goals** (`scoredByUs === false`) are included in the goals list (for score-context completeness) but obviously carry no scorer/assist — schema has no such fields for them.
- **Team name** (Q2, approved as originally planned) is included in the email even though not explicitly listed in R4's four fields — cheap additional `Game.teamId` lookup, and "vs {opponent}" alone reads oddly as a subject without it.
- **Row-level `Goal`/`GameNote` visibility** (Major 2): filtered to the caller's own `coaches` membership per row, not just gated at the `Game` level — see §4.
- **Jersey numbers** (Minor 4): deliberately omitted/deferred — out of R1-R9's explicit scope, would need a new `TeamRoster` read.

## 12. UI Review Resolution (was: Open Item for Next Reviewer)

**Button placement (Minor 8) — RESOLVED: `.completed-footer`.** ui-reviewer confirmed via direct inspection of `App.css`/`GameManagement.tsx` that `.completed-footer` is the right home: the `.delete-game-section` divider already visually separates the destructive delete button from what sits above it, and "View Full Season Report" already establishes this footer as the home for data-export-adjacent actions on this screen. No new CSS needed (§5.11).

**Button label — changed to "Email Game Summary"** (from "Email Summary") per ui-reviewer's accessibility finding: a generic label is ambiguous to a screen-reader user scanning a button list out of context; the app already disambiguates similarly generic actions elsewhere ("Delete Game", "Delete Account"). Applied in §5.8.

**Disabled-state styling — no gap found.** The plan's premise that this "may be the first `.btn-secondary:disabled` use" was checked and found inaccurate — a global `button:disabled` rule (`src/index.css:136-139`) already covers it, and `.btn-secondary` is already used disabled elsewhere in the app. No CSS change needed.

Plan is approved by both architecture (2 rounds) and UI review with no blocking findings. Proceeding to implementation.
