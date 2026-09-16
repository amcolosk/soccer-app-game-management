# Email Me A Game Summary — Implementation Plan

**Feature:** Manual "Email Summary" button on the completed-game screen. Sends the clicking coach a summary email of the game (their own address only — no team-wide fan-out, no opt-in setting; clicking is the consent).
**Status:** Ready for architecture review
**Last Updated:** 2026-09-16

---

## 1. Overview

Add a new Lambda-backed custom mutation, `emailGameSummary(gameId)`, invoked directly (synchronously, on click — not stream-triggered) from a new button rendered in `GameManagement.tsx`'s completed-state layout, next to `CompletedPlayTimeSummary`. The Lambda:

1. Verifies the caller is in `Game.coaches` (403-equivalent otherwise).
2. Verifies `Game.status === 'completed'`.
3. Resolves the caller's email server-side via `cognito-idp:AdminGetUser` (access token has no `email` claim — CLAUDE.md's Amplify v6 auth gotcha).
4. Reads `Game`, `Team` (for names), all `Goal` rows for the game, all `GameNote` rows for the game, and the `Player` rows referenced by them.
5. Builds an HTML+text email (opponent/date/home-away/score, goal-by-goal scorers/assists, all game notes chronologically) and sends it via SES, reusing `send-invitation-email`'s SES send shape but not its DynamoDB Stream trigger.
6. Returns `{ success, sentTo }` synchronously so the UI can show a toast.

No changes to any existing data model. One new custom mutation, one new customType, one new Lambda, one new frontend service + button component.

---

## 2. Requirements Summary

| # | Requirement | Source |
|---|---|---|
| R1 | "Email Summary" button in completed-state layout, near `CompletedPlayTimeSummary` | User requirement |
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
Validation invariant (enforced in `create-game-note`/`update-game-note` handlers, not the schema): `noteType === 'coaching-point'` ⇒ `gameSeconds === null && half === null`; every other `noteType` ⇒ both non-null. The four non-coaching-point types are exactly "cards" (`yellow-card`, `red-card`) and "gold-star recognitions" (`gold-star`), plus a catch-all `other`. Per requirement R6, the email includes **all** `GameNote` rows for the game regardless of `noteType` — no filtering.

There is no secondary index on `GameNote.gameId`. `amplify/functions/delete-game-safe/handler.ts` already reads all `GameNote` (and `Goal`) rows for a game via a full-table `Scan` + `FilterExpression: 'gameId = :gameId'` (see `scanAll` helper, lines 22–42, 143). This Lambda will reuse that exact same pattern — it's established precedent, not a new anti-pattern.

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
No existing player-id→display-name helper is reused server-side elsewhere (the frontend has display-name helpers for `CoachProfile`, not `Player`; `Player.firstName`/`Player.lastName` are already plain, non-privacy-gated fields — see `Player` model, lines 110–130). The Lambda will do its own minimal `BatchGetItem` against the `Player` table (id, firstName, lastName only), following the exact chunked-`BatchGetCommand` pattern already used in `amplify/functions/get-team-coach-profiles/handler.ts` (`batchGetCoachProfiles`, lines 50–90) — reuse the *shape*, not the coach-profile-specific privacy logic (`Player` has no privacy setting to respect).

Ordering "in order" (R5) = sort by `half` ascending, then `gameSeconds` ascending.

### 3.3 Custom-mutation Lambda wiring pattern
Confirmed against `upsertMyCoachProfile`/`getTeamCoachProfiles` (`amplify/data/resource.ts` lines 728–749) and `createSecureGameNote` (lines 379–394):
1. `amplify/functions/<name>/resource.ts` — `defineFunction({ name, entry: './handler.ts', runtime: 22, timeoutSeconds, resourceGroupName: 'data' })`.
2. `amplify/functions/<name>/handler.ts` — typed `Schema['<mutationName>']['functionHandler']`.
3. `amplify/data/resource.ts` — import the function, add a `<mutationName>: a.mutation().arguments({...}).returns(a.ref(<Type>) | a.json()).authorization((allow) => [allow.authenticated()]).handler(a.handler.function(<fn>))` entry. Declared authorization is always just "must be signed in" — the real access check (team/game membership) happens inside the handler, since Amplify's declarative auth can't express "caller must be in this specific record's `coaches` array" for a *custom* op. Same shape as `archiveTeam`/`revokeCoachAccess`/`createGameSafe`.
4. `amplify/backend.ts` — import the function's `resource.ts` export, add it to the `defineBackend({...})` object, then wire least-privilege `PolicyStatement`s per table (`dynamodb:GetItem`/`Scan`/`BatchGetItem` as needed — see `getTeamCoachProfiles`/`archiveTeam` blocks, lines 232–246, 344–357) and `addEnvironment(...)` calls for table names.

### 3.4 Email resolution via `AdminGetUser`
CLAUDE.md's cited reference, `update-issue-status`, **no longer exists in this repo** — it was removed by the GitHub-issues migration (`docs/specs/Bug-Reporting-GitHub.md` lines 31, 169, 504; confirmed via `git grep`, zero hits under `amplify/functions/`). The live, in-repo reference pattern is `amplify/functions/accept-invitation/handler.ts` (lines 161–201): a fallback chain — `identity.claims.email` → `identity.username` (if it looks like an email) → `identity.claims.username` → `identity.claims['cognito:username']` → `cognito-idp:AdminGetUser` keyed on `identity.username || identity.sub`, requiring `USER_POOL_ID` env var + `cognito-idp:AdminGetUser` IAM grant on `backend.auth.resources.userPool.userPoolArn` (wired in `amplify/backend.ts` lines 134–143).

Since the access token AppSync receives carries **no** `email` claim at all (CLAUDE.md), the first few fallback steps in that chain will essentially never resolve for an access-token-authenticated call — only `AdminGetUser` will. This plan keeps the full fallback chain anyway (cheap, defensive, consistent with the only two working examples in the codebase — `accept-invitation` and `get-user-invitations` both use it) rather than hand-rolling a `AdminGetUser`-only path.

### 3.5 `send-invitation-email` reusable pieces
`amplify/functions/send-invitation-email/handler.ts` has no exported/shared template helpers — the HTML/text bodies are inlined in `sendInvitationEmail()` (lines 52–202). This plan inlines a new template in the new handler, following the same visual style (header banner div, `.content` div, `.footer` div, matching inline CSS) rather than extracting a shared template module (small, one-off content shape; not worth a premature abstraction). `FROM_EMAIL` is set as a literal in `send-invitation-email/resource.ts` (`'TeamTrack Support <admin@coachteamtrack.com>'`) — reuse the identical value for the new function's `resource.ts`, and reuse the already-verified SES identity/config-set ARNs already computed in `amplify/backend.ts` (`sesIdentityArn`, `sesConfigSetArn`, lines 74–79) for the new function's `ses:SendEmail`/`ses:SendRawEmail` grant.

### 3.6 Async-button UX pattern
No global toast/notification context component exists; the codebase uses `react-hot-toast` via `src/utils/toast.ts` (`showError`, `showSuccess`, `showWarning`, `showInfo`) — already the pattern `GameManagement.tsx`'s own `deleteGameButton` uses for its async mutation (lines 2107–2132: try/await/`showError` on catch). The new button follows the exact same shape: local `isSending` state, `showSuccess`/`showError` on settle, no new UI primitive needed.

Service-layer convention: a thin wrapper in `src/services/*.ts` that calls `client.mutations.<name>({...})` and unwraps via the shared `assertMutationResult` helper (`src/services/amplifyMutationResult.ts`) when the mutation `.returns(a.ref(<customType>))` — exactly what `teamLifecycleService.ts`'s `archiveTeam`/`restoreTeam`/`assignTeamOwner` do (lines 8–23). This plan's new mutation follows that, not the `a.json()`-with-`assertMutationSuccess` variant used for the safe-delete mutations.

---

## 4. Data Model Impact

**No changes to any existing model.** This feature is additive/read-only against `Game`, `Team`, `Goal`, `GameNote`, `Player`. One new schema addition:

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
```

No `coaches[]` population concern — no new coach-scoped record is ever created or persisted by this feature; it only reads existing coach-scoped records after verifying `game.coaches.includes(callerSub)` up front, then scopes every subsequent read to that specific `gameId` or to the exact player IDs referenced within that game's `Goal`/`GameNote` rows. No IDOR surface beyond the initial membership check.

---

## 5. File-by-File Change List

### 5.1 NEW: `amplify/functions/email-game-summary/resource.ts`
```ts
import { defineFunction } from '@aws-amplify/backend';

export const emailGameSummary = defineFunction({
  name: 'email-game-summary-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
  environment: {
    FROM_EMAIL: 'TeamTrack Support <admin@coachteamtrack.com>',
  },
});
```

### 5.2 NEW: `amplify/functions/email-game-summary/handler.ts`
Typed as `Schema['emailGameSummary']['functionHandler']`. Logic:

1. Extract `callerSub = (event.identity as AppSyncIdentityCognito)?.sub`; throw `'User not authenticated'` if missing.
2. Read `gameId` from `event.arguments`. Read env vars `GAME_TABLE`, `TEAM_TABLE`, `GOAL_TABLE`, `GAME_NOTE_TABLE`, `PLAYER_TABLE`, `USER_POOL_ID`, `FROM_EMAIL`; throw if any missing.
3. `GetCommand` the `Game`. Throw `'Game not found'` if absent.
4. **Authz gate (R7) — before any other read**: `if (!game.coaches?.includes(callerSub)) throw new Error('Access denied: caller is not a coach on this game')`. Mirrors `create-game-note`/`delete-game-safe`'s exact check.
5. **Status gate**: `if (game.status !== 'completed') throw new Error('Game summary email is only available once the game is completed')`.
6. Resolve caller email via the `accept-invitation`-style fallback chain (§3.4), ending in `AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: identity.username || callerSub })`. If no email attribute is found after all fallbacks, throw `'Unable to resolve your account email address'` (edge case: coach's Cognito user has no email attribute — surfaces as a clear button-click error, not a silent no-op).
7. `GetCommand` the `Team` (best-effort — used only for display name in the subject/greeting; if missing, fall back to a generic `'Your Team'` string rather than failing the whole send).
8. In parallel, `scanAll(goalTable, 'gameId = :gameId', ...)` and `scanAll(gameNoteTable, 'gameId = :gameId', ...)` (same `scanAll` shape as `delete-game-safe/handler.ts` lines 22–42 — duplicated locally, not imported cross-function, matching this repo's existing convention of no shared-across-function-folder logic modules beyond `amplify/functions/shared/`).
9. Sort goals by `(half, gameSeconds)` ascending; sort notes by `timestamp` ascending (ISO strings sort lexicographically — no `Date` parsing needed).
10. Collect distinct player IDs referenced (`goal.scorerId`, `goal.assistId`, `note.playerId`), `BatchGetCommand` the `Player` table (id, firstName, lastName only) in chunks of 100, matching `get-team-coach-profiles/handler.ts`'s `batchGetCoachProfiles` shape. Build an `id → "First Last"` map; any ID with no match (e.g. a hard-deleted player edge case) renders as `"a former player"` in the email rather than blank/crashing.
11. Build subject: `` `Game Summary: ${teamName} vs ${game.opponent}` ``. Build HTML + plain-text bodies (§6 below).
12. `SendEmailCommand` via `SESClient`, `Source: FROM_EMAIL`, `Destination.ToAddresses: [resolvedEmail]`. **Do not catch-and-swallow** the SES call — let a send failure propagate as a thrown error (surfaces to the UI as an error toast per R... edge case "SES send failure must not silently succeed").
13. Return `{ success: true, sentTo: resolvedEmail }`.

### 5.3 NEW: `amplify/functions/email-game-summary/handler.test.ts`
Vitest, mocking `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-ses`, `@aws-sdk/client-cognito-identity-provider` the same way `get-team-coach-profiles/handler.test.ts` mocks Dynamo (hoisted `mockSend` per client). Cases:
- Caller not in `Game.coaches` → throws access-denied, no Scan/SES calls made (assert call counts).
- `Game` not found → throws, no further calls.
- `Game.status !== 'completed'` (e.g. `'in-progress'`) → throws, no Goal/GameNote/SES calls.
- Happy path: mocked Game (completed, caller in coaches), Team, Goal rows (mixed `scoredByUs`), GameNote rows (mixed `noteType` including a `coaching-point` with null `gameSeconds`/`half`), Player batch-get → asserts `SendEmailCommand` called once with the resolved recipient, correct subject, and that the email body contains each goal's scorer/assist name and every note's text (spot-check via substring assertions on the `Html`/`Text` body strings).
- Game with zero goals and zero notes → still sends, body contains the "no goals recorded"/"no notes recorded" copy (not a blank section).
- `AdminGetUser` returns no `email` attribute (and all earlier fallbacks also miss) → throws `'Unable to resolve your account email address'`, no SES call.
- `SendEmailCommand` rejects (mocked SES throwing) → error propagates out of the handler (not swallowed), asserted via `await expect(handler(...)).rejects.toThrow(...)`.

### 5.4 NEW: `amplify/functions/email-game-summary/package.json`
Mirrors `get-team-coach-profiles/package.json` shape, dependencies: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-ses`, `@aws-sdk/client-cognito-identity-provider`, devDependency `@types/aws-lambda`.

### 5.5 MODIFIED: `amplify/data/resource.ts`
- Add `import { emailGameSummary } from "../functions/email-game-summary/resource";` alongside the other function imports (top of file).
- Add the `EmailGameSummaryResult` customType and `emailGameSummary` mutation (§4 above), placed near the other Game-adjacent custom mutations (after `createGameSafe`, before `CalendarFeed`, to keep game-lifecycle mutations grouped — matches the file's existing loose grouping-by-topic).

### 5.6 MODIFIED: `amplify/backend.ts`
- Import `emailGameSummary` from `./functions/email-game-summary/resource`.
- Add `emailGameSummary` to the `defineBackend({...})` object.
- Wire least-privilege grants, placed near the existing `gameTable`/`goalTable`/`gameNoteTable` constants (already declared, lines 107–113; no new table constants needed except reusing `teamTable`, `goalTable`, `gameNoteTable`, `gameTable`, `playerTable`):
  ```ts
  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [gameTable.tableArn, teamTable.tableArn],
    })
  );
  backend.emailGameSummary.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['dynamodb:Scan'],
      resources: [goalTable.tableArn, gameNoteTable.tableArn],
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
  ```
  `playerTable` is not currently declared as a `const` in `backend.ts` (only referenced inline for `acceptInvitation`'s grants via the local `playerTable` const at line 103 — reuse it, it's already in scope for the whole file).

### 5.7 NEW: `src/services/gameSummaryEmailService.ts`
```ts
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { assertMutationResult } from './amplifyMutationResult';

const client = generateClient<Schema>();

/** Sends the calling coach a summary email for a completed game. Recipient is always the caller's own Cognito email — resolved server-side. */
export async function emailGameSummary(gameId: string): Promise<NonNullable<Schema['emailGameSummary']['returnType']>> {
  const result = await client.mutations.emailGameSummary({ gameId });
  return assertMutationResult(result, 'Failed to send game summary email');
}
```

### 5.8 NEW: `src/components/GameManagement/EmailSummaryButton.tsx`
Small, self-contained component (pure-ish, one Amplify-backed action) — follows the "each completed-state section is its own component" convention (ISSUE-63 plan §3.1), but is deliberately **not** merged into `CompletedPlayTimeSummary` (that component is explicitly documented as having "No imports of Amplify client or hooks — pure display component"; keep that boundary intact).

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
    <div className="completed-email-summary">
      <button
        onClick={handleClick}
        className="btn-secondary"
        disabled={isSending}
      >
        {isSending ? 'Sending…' : 'Email Summary'}
      </button>
    </div>
  );
}
```
Uses `showSuccess`/`showError` from `src/utils/toast.ts` — same as `deleteGameButton`'s inline handler in `GameManagement.tsx`.

### 5.9 NEW: `src/components/GameManagement/EmailSummaryButton.test.tsx`
Mocks `src/services/gameSummaryEmailService.ts` (`vi.mock`) and `src/utils/toast.ts`. Cases:
- Renders "Email Summary" button, not disabled initially.
- Click → button shows "Sending…" and is disabled while the mocked promise is pending.
- Resolves with `{ success: true, sentTo: 'coach@example.com' }` → `showSuccess` called with a message containing the email; button re-enabled.
- Rejects with an `Error('Access denied...')` → `showError` called with that message; button re-enabled (not stuck disabled).
- Rejects with a non-`Error` throw → `showError` called with the generic fallback message.

### 5.10 MODIFIED: `src/components/GameManagement/GameManagement.tsx`
- Import `EmailSummaryButton` from `./EmailSummaryButton`.
- In the `completed-layout` block (line ~2637), render it immediately after `CompletedPlayTimeSummary`:
  ```tsx
  <CompletedPlayTimeSummary
    players={players}
    playTimeRecords={playTimeRecords}
    gameEndSeconds={gameState.elapsedSeconds ?? 0}
  />
  <EmailSummaryButton gameId={game.id} />
  <CompletedGameTimeline ... />
  ```
  `game.id` is already in scope (used elsewhere in this component, e.g. `deleteGameCascade(game.id)`).

### 5.11 MODIFIED: `src/App.css`
Append a new section at the bottom (per CLAUDE.md's single-stylesheet convention) for `.completed-email-summary` — spacing/margin to sit naturally between the play-time table and the timeline; button reuses the existing `.btn-secondary` class, no new button variant needed.

### 5.12 MODIFIED: `src/types/schema.ts`
Add, alongside the existing `CalendarSyncResult` line (19):
```ts
export type EmailGameSummaryResult = NonNullable<Schema["emailGameSummary"]["returnType"]>;
```
Not strictly required by the button component (which can consume the service's return type directly), but matches this file's existing convention of centralizing every schema-derived type, and gives `EmailSummaryButton.tsx` a clean import if a future consumer needs the shape.

### 5.13 MODIFIED: `README.md`
- **Features → Game Day Management**: add a bullet, e.g. `- **Email Game Summary**: After a game is completed, a coach can email themselves a summary — final score, goal scorers/assists, and all game notes/cards/gold stars`.
- **Technology Stack**: update the `Email` line from `Amazon SES (team invitation emails)` to `Amazon SES (team invitation emails, post-game summary emails)`.
- No Data Model section change — no new model.

### 5.14 MODIFIED: `docs/specs/UI-SPEC.md`
Update §7.6 "Game Management — Completed State" (lines 433–447), "Components Rendered" list — insert the new button between items 2 and 3:
```
1. **GameHeader** — final score
2. Play time summary table (player → total minutes)
3. **Email Summary button** — sends the current coach a game-summary email (opponent, score, goals, notes); shows a loading state while sending and a success/error toast on completion
4. Game notes summary (gold stars, cards)
5. `View Full Report` link → navigates to `/reports/:teamId`
```
(renumbering the two existing trailing items).

### 5.15 MODIFIED: `docs/ARCHITECTURE.md`
Add a row to the Lambda functions table (same table containing `accept-invitation`, `sync-team-calendar`, etc., lines ~353–359):
```
| `email-game-summary` | Custom GraphQL mutation | Verifies caller is in `Game.coaches` and game is completed, resolves caller's email via `AdminGetUser`, and sends a summary email (score, goals, notes) via SES |
```

---

## 6. Email Content Spec

**Subject:** `Game Summary: {teamName} vs {opponent}`

**Body sections (HTML mirrors `send-invitation-email`'s visual style — header banner, `.content` box, `.footer`; plain-text fallback included per SES multipart convention):**

1. **Header:** `{teamName} vs {opponent}` — `{Home|Away}` — formatted `gameDate` (fallback: "Date not recorded" if `gameDate` is null) — **Final Score:** `{teamName} {ourScore} – {opponent} {opponentScore}`.
2. **Goals** (sorted `half` asc, `gameSeconds` asc):
   - If none: "No goals recorded for this game."
   - Else, one line per goal: `Half {half}, {mm:ss} — ` then either `{teamName} goal by {scorerName}` (+ `, assisted by {assistName}` if `assistId` present) when `scoredByUs`, or `{opponent} goal` when not `scoredByUs` (no scorer/assist fields exist for opponent goals in the schema).
3. **Game Notes** (sorted `timestamp` asc, unfiltered — every `noteType`):
   - If none: "No notes recorded for this game."
   - Else, one line per note: `{formatted timestamp} — [{noteTypeLabel}]{ ' ' + playerName if playerId present }: {notes text}`, where `noteTypeLabel` maps `coaching-point → "Coaching Note"`, `gold-star → "⭐ Gold Star"`, `yellow-card → "🟨 Yellow Card"`, `red-card → "🟥 Red Card"`, `other → "Note"`.
4. **Footer:** standard "you're receiving this because you clicked Email Summary in TeamTrack" line — no unsubscribe link needed (not a recurring/marketing email; matches R2's "clicking is the consent" decision).

---

## 7. Edge Cases

| Case | Handling |
|---|---|
| Caller not in `Game.coaches` | Handler throws before any Goal/GameNote/Player read or SES call; AppSync surfaces the error; button shows `showError` toast |
| `Game.status !== 'completed'` | Handler throws a clear message; caught by the button, shown via `showError`. (UI layer never actually offers the button outside `completed-layout`, so this is a defense-in-depth server check, not the primary UX gate) |
| Game has no goals | Email still sends; "No goals recorded" copy, not an empty/malformed section |
| Game has no notes | Email still sends; "No notes recorded" copy |
| SES send failure (throttling, unverified identity edge case, etc.) | Not caught/swallowed in the handler — propagates as a thrown error, AppSync returns it as a GraphQL error, `assertMutationResult` throws, button's catch shows `showError`. UI never shows a false "Sent!" success |
| Coach's Cognito user has no `email` attribute at all | All fallback steps miss (including `AdminGetUser`); handler throws `'Unable to resolve your account email address'` before touching Goal/GameNote/Player tables or SES |
| Goal/GameNote references a player ID that no longer resolves (edge case even though `delete-player-safe` cascades `Goal`/`GameNote` cleanup on delete) | Batch-get miss renders as `"a former player"` rather than blank text or a crash |
| `Team` record missing (orphaned game) | Falls back to `"Your Team"` in subject/header rather than failing the whole send |
| Double-click / rapid repeat clicks | Button is `disabled` while `isSending` is true — prevents duplicate concurrent sends from a single click sequence. (Two separate deliberate clicks across two sends is accepted — each is a valid, intentional resend, there's no dedup requirement in the requirements) |

---

## 8. Risks

- **SES sending limits/verified-identity scope:** reuses the already-verified `coachteamtrack.com` identity and existing config-set ARNs — no new SES setup needed, but this adds a second call path (button clicks, potentially bursty right after many games complete on a Saturday) on top of the existing invitation-email volume against the same sending quota. Low risk given current usage patterns, but worth a mental note if SES throttling errors start appearing in this Lambda's logs.
- **IAM permission scope:** kept least-privilege and per-table (mirrors `getTeamCoachProfiles`/`archiveTeam` style grants, not a blanket `grantReadWriteData`) — `GetItem` only on `Game`/`Team`, `Scan` only on `Goal`/`GameNote` (no write actions granted at all, since this Lambda never mutates anything).
- **PII in email body:** player first/last names, plus the clicking coach's own resolved email as the sole recipient. No new PII exposure beyond what a coach can already see on-screen in the completed-game view (play time, notes, goals) — the email is just that same data, addressed only to someone who already has read access to it.
- **`Scan`-based reads on `Goal`/`GameNote` (no GSI on `gameId`):** cost grows with total table size, not just the game's own row count — but this is pre-existing, accepted precedent in `delete-game-safe`, not a new pattern introduced here. Not blocking, but if a future plan ever adds a `gameId` GSI to either table (matching what `PlayTimeRecord`/`QueuedSubstitution` already have via `secondaryIndexes`), this Lambda should be switched to `Query` at that time.

---

## 9. Sequencing

1. Backend first (`amplify/functions/email-game-summary/`, `amplify/data/resource.ts`, `amplify/backend.ts`) — the frontend service/component import `Schema['emailGameSummary']`, which only exists after the schema change is deployed (`ampx sandbox` locally / pipeline-deploy in CI) and `amplify_outputs.json`/generated types are refreshed.
2. Frontend service (`gameSummaryEmailService.ts`) and `EmailSummaryButton.tsx` next, once the mutation is deployed and typed.
3. `GameManagement.tsx` wiring + CSS last.
4. Docs (`README.md`, `UI-SPEC.md`, `ARCHITECTURE.md`) updated alongside the corresponding code change, not deferred to the end.

---

## 10. Test Strategy

**Backend (`amplify/functions/email-game-summary/handler.test.ts`, Vitest, mocked AWS SDK clients — see §5.3 for full case list):**
- Authz rejection (caller ∉ `Game.coaches`).
- Game-not-found rejection.
- Non-`completed` status rejection.
- Happy path: correct SES call (recipient, subject, body contents) with mixed goals/notes/note-types.
- Empty-goals / empty-notes still sends with fallback copy.
- Email-resolution total failure (no `AdminGetUser` email attribute).
- SES send failure propagates, is not swallowed.

**Frontend (`src/components/GameManagement/EmailSummaryButton.test.tsx`, Vitest + Testing Library, mocked service module — see §5.9):**
- Default render state.
- Pending/disabled state during send.
- Success toast path.
- Error toast path (both `Error` and non-`Error` rejection shapes).

**Existing tests affected:** `GameManagement.test.tsx` may need a snapshot/assertion update if it asserts the exact child list of `completed-layout` (grep for any such assertion during implementation) — otherwise no existing test should need behavior changes, since this is purely additive.

**Not covered by unit tests (acceptable gap, per CLAUDE.md's e2e layering guidance):** actual SES delivery — mocked at the SDK boundary in both directions (`send-invitation-email` has no e2e SES-delivery test either, for the same reason: no real inbox to assert against in CI).

---

## 11. Questions / Assumptions Resolved While Planning

- **GameNote chronological order** = sort by `timestamp` (real-world note-creation time), not `gameSeconds`/`half` (which is null for pre-game `coaching-point` notes and wouldn't give a single consistent sort key across all note types anyway). Documented as a deliberate choice in §6.
- **Opponent goals** (`scoredByUs === false`) are included in the goals list (for score-context completeness) but obviously carry no scorer/assist — schema has no such fields for them.
- **Team name** is included in the email even though not explicitly listed in R4's four fields — it's already available from a `Game.teamId` lookup that's cheap to add, and "opponent" alone reads oddly without it (`"vs {opponent}"` needs a subject). Flagged here in case the architecture reviewer wants it trimmed.
