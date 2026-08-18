# Team Archive — Step 1: Backend Declaration, Wiring, and Handler Corrections

Status: Revised after architecture review round 1 — ready for re-review
Date: 2026-08-18
Parent plan: [TEAM-ARCHIVE-PLAN.md](TEAM-ARCHIVE-PLAN.md) — "Next Steps (ordered)" items 1, 2, and 3.

**Revision 1 summary:** fixes CRLF-broken test block-bounding (Major 1), adds a coach-membership guard plus orphaned-owner recovery to `archiveTeam`/`restoreTeam`/`assignTeamOwner` (Major 2), switches condition-check disambiguation to `ReturnValuesOnConditionCheckFailure` (Minor 3), scopes IAM grants (Minor 4), adds a concrete GSI-deferral trigger and a timeout fix (Minor 5), and removes the redundant post-write `GetCommand` while documenting the real-time-subscription gap (Minor 6). See inline call-outs below for exactly what changed per finding.

## Goal

Make the three Lambda handlers that landed in commit `5fcaff3` (`archive-team`, `restore-team`, `assign-team-owner`) declarable, deployable, and type-clean, and close the gate hole that let three non-compiling handlers pass `npm run gate:commit`.

**Definition of done:** `npx tsc -p amplify/tsconfig.json --noEmit` reports 0 errors (it reports exactly 6 today, all in those three handlers), the extended schema-policy test passes, and `npm run gate:commit` is green with a new `typecheck:amplify` stage.

**Definition of done does *not* include** proving the backend deploys. Field-level `.authorization()` on `Team` is still unvalidated against this Amplify version's transformer (parent plan Correction 3). That remains Next Step 4 (sandbox) and is the go/no-go for everything after it. This slice makes the sandbox attempt *possible*; it does not make it *proven*.

## Scope

### In scope
- Declare `archiveTeam`, `restoreTeam`, `assignTeamOwner` as `a.mutation()` operations in `amplify/data/resource.ts`.
- Wire all three into `amplify/backend.ts` (imports, `defineBackend`, scoped table grants, env vars).
- Parent-plan Correction 1: `ownerId` field grant becomes `.to(['create', 'read'])`.
- Parent-plan Correction 5a/5b (handler defects) and 5c (confirm the already-made decision in a comment).
- **Added in revision 1 (architecture review Major 2):** a `coaches`-membership guard (JS pre-check + `contains(coaches, :callerSub)` conditional-write clause) on `archiveTeam` and `restoreTeam`, matching the TOCTOU protection already planned for `assignTeamOwner`; and a loosened `assignTeamOwner` condition so a team whose owner was removed from `coaches` (via `revokeCoachAccess`) is not permanently un-archivable.
- **Added in revision 1 (Minor 3/6):** `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'` and `ReturnValues: 'ALL_NEW'` on the conditional `UpdateCommand`s in all three handlers, removing the second `GetCommand` round trip and the "re-read in catch" imprecision.
- **Added in revision 1 (Minor 4):** scoped `PolicyStatement` IAM grants in `amplify/backend.ts` instead of `grantReadWriteData`, matching the `upsertCoachProfile`/`getTeamCoachProfiles` precedent.
- **Added in revision 1 (Minor 5):** `archive-team`'s `timeoutSeconds` raised from 30 to 60 to match `delete-team-safe`'s equivalent scan-based handler.
- Extend `amplify/data/resource.safe-delete-policy.test.ts` with field-level-auth and new-operation assertions (parent Next Step 3 — pulled forward because it is the only test surface this slice has). **Revised in revision 1 (Major 1):** the file's block-bounding logic is CRLF-broken on this repo's checked-in line endings; both the existing tests and the new ones are rewritten to normalize line endings and tolerate whitespace-only separator lines before this slice can rely on them.
- Add an `amplify/tsconfig.json` typecheck stage to `scripts/commit-gate.mjs` (parent Next Step 2).
- Add `@aws-sdk/util-dynamodb` as an explicit `package.json` dependency (revision 1, Minor 3) — needed at runtime to unmarshal `ConditionalCheckFailedException.Item`, which today resolves only as a transitive dependency of `@aws-sdk/lib-dynamodb`.

### Explicitly out of scope
- `Management.tsx` / `demoDataService.ts` passing `ownerId` on `Team.create()`. Correction 1's `create` grant is what *makes that possible*, but the call-site change is frontend work in Next Step 5/6. Until it lands, newly created teams are still born ownerless — same as today, no regression, but also no improvement yet.
- Any UI, any `src/services/` wrapper, the `isTeamArchived`/`isTeamActive` helper.
- Handler behavior unit tests, e2e, `Game.create` conversion, `accept-invitation` transactionalization, archived-team guards on the `*Safe` Lambdas.
- Any sandbox / `ampx` deploy.

## Decisions Made In This Slice

1. **No `TeamInvitation` `teamId` GSI (parent Correction 4 deferred).** `archive-team` keeps its full-table `scanAll`. Rationale: (a) `delete-team-safe` already scans the same table for the same purpose, so a scan is repo precedent, not a novelty; (b) adding `.secondaryIndexes(...)` to a populated table changes deploy shape and starts an async GSI backfill, during which queries return incomplete results — shipping a GSI in the same change as the code that depends on it is a correctness hazard; (c) archive is a rare, human-initiated action, so the scan is not a hot path; (d) this slice's whole point is to reach a clean typecheck with the *smallest possible* deploy-shape delta ahead of the Correction 3 sandbox validation, which is already carrying an unproven field-level-auth change. Recommendation: add `index('teamId').queryField('listInvitationsByTeamId')` and switch the scan to a Query as a follow-up, sequenced with (or after) Next Step 4, not bundled into it.
2. **`assign-team-owner` disambiguates a combined condition failure via `ReturnValuesOnConditionCheckFailure`, not a re-read (revised in revision 1, Minor 3).** DynamoDB returns a single `ConditionalCheckFailedException` for a compound `ConditionExpression` with no indication of which clause failed. The original plan re-read the item with a second `GetCommand` in the catch block, which cost an extra round trip and left a documented (if accepted) race between the failed write and the re-read. Setting `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'` on the `UpdateCommand` instead returns the pre-write item **on the exception itself**, atomically with the condition check — no race, no extra round trip. The one wrinkle: that item comes back in raw low-level `AttributeValue` shape (confirmed against `@aws-sdk/client-dynamodb`'s `ConditionalCheckFailedException.Item: Record<string, AttributeValue>` typing) even though the rest of the handler uses `DynamoDBDocumentClient`, because the document client's marshalling middleware only unmarshals successful command output, not thrown exceptions. It must be unmarshalled explicitly via `unmarshall()` from `@aws-sdk/util-dynamodb` before use — see the handler section below and the new `package.json` dependency this requires. Applied to all three handlers' conditional writes for a consistent shape (archive/restore don't need to branch on the disambiguated result today, since both of their conditions collapse to one "access denied" message either way, but the shape stays uniform).
3. **No null-safe `status` rewrite is needed in this slice (parent Correction 2 audited).** All three handlers were checked: `archive-team`'s `ConditionExpression` is `ownerId = :callerSub`, `restore-team`'s is `ownerId = :callerSub`, `assign-team-owner`'s is `attribute_not_exists(ownerId)`. **No condition expression in any of the three compares `status`**, so the `(attribute_not_exists(#status) OR #status <> :archived)` shape is not required here. The status comparisons that do exist are JavaScript-side (`team.status !== 'archived'` in archive, `team.status === 'archived'` in restore) and both already treat a legacy `undefined` status correctly as "active". Correction 2's condition-expression rule first bites in Next Step 8 (`accept-invitation`, `*Safe` guards) — record it there, not here.
4. **`restore-team` keeps `REMOVE archivedAt, archivedBy`** (parent Correction 5c — decision already made). No behavior change; add a code comment naming the decision so the pending `docs/SHARING-PERMISSIONS.md` write-up has an anchor.
5. **Orphaned-owner recovery: `assign-team-owner`'s condition is loosened to allow reclaiming a team whose owner is no longer a coach (added in revision 1, Major 2).** `src/services/invitationService.ts:revokeCoachAccess` filters a user out of `Team.coaches` with no owner guard and no `ownerId` clearing (`ownerId` has no `update` grant, so it structurally cannot clear it even if it wanted to). Concrete scenario: coaches `[A, B]`, `ownerId = A`; B revokes A. Without a fix, A can still archive/restore (owner-equality check alone doesn't see the revocation) — a real authorization defect — and even after closing that hole with a `contains(coaches, :callerSub)` guard (this revision's other Major 2 fix), B is left permanently unable to reclaim ownership, because `assign-team-owner`'s original `attribute_not_exists(ownerId)` condition is false (A still owns it). **Decision:** widen `assign-team-owner`'s `ConditionExpression` to `(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)` — DynamoDB permits a document path (`ownerId`) as `contains`'s second operand, referencing the item's own attribute. This resolves scenario (b) within this same slice rather than leaving the team permanently stuck, and it is policy-consistent with the parent plan's already-decided "first-come-first-served by any existing coach" rule (Phase 2 step 4) — reclaiming an orphaned-owner team is the same policy, just extended to a second trigger condition. **Follow-up obligation this decision creates (see Risks and Required Follow-Ups below):** the parent plan's Phase 2 step 4 sentence and Phase 5's "Owner Unassigned" warning-pill UI condition (currently gated on bare `!team.ownerId`) both need updating to also cover "owner is set but no longer a coach" — not fixed in this slice (frontend is out of scope here), but the obligation must be carried into `docs/plans/TEAM-ARCHIVE-PLAN.md` before Next Step 5/6 starts.

## File-by-File Changes

### 1. `amplify/data/resource.ts`

**a. Imports** — append after the `deletePlayerSafe` import (line 13), matching that file's double-quoted import style:

```ts
import { archiveTeam } from "../functions/archive-team/resource";
import { restoreTeam } from "../functions/restore-team/resource";
import { assignTeamOwner } from "../functions/assign-team-owner/resource";
```

**b. Correction 1 — `ownerId` field grant.** In the `Team` model block, change only the `.to([...])` list on `ownerId` and refresh its comment. `status`, `archivedAt`, `archivedBy` are untouched.

```ts
      // Persisted owner (Cognito sub). Undefined = legacy team pending owner assignment.
      // Coaches may stamp this once at create time (Management.tsx / demoDataService);
      // there is no update grant, so ownership can only change via assignTeamOwner.
      ownerId: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['create', 'read'])]),
```

**Constraint: do not introduce a blank line anywhere inside the `Team` model block.** `resource.safe-delete-policy.test.ts` bounds the block from `Team: a` to the next blank line; a blank line silently truncates it and weakens the existing delete-grant assertion. The new test below adds an explicit guard against this.

**c. Three mutation declarations** — insert after the `deletePlayerSafe` block and before `QueuedSubstitution`, following `acceptInvitation` exactly (it is the only precedent for a Lambda mutation returning a model, and its handler likewise returns the raw DynamoDB item):

```ts
  // Owner-authorized team lifecycle mutations. The declared authorization is
  // only "must be signed in" — the real check is strict owner equality
  // (team.ownerId === callerSub) inside each handler, which Amplify's
  // declarative auth cannot express. Same shape as acceptInvitation.
  archiveTeam: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(archiveTeam)),

  restoreTeam: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(restoreTeam)),

  // First-come-first-served owner claim for legacy ownerless teams; any coach
  // already on the team may call it, and a conditional write in the handler
  // resolves concurrent claims.
  assignTeamOwner: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(assignTeamOwner)),
```

This edit alone clears all 6 current typecheck errors: `Schema['archiveTeam']` etc. resolve, and the knock-on `event` implicit-`any` disappears with them.

### 2. `amplify/backend.ts`

Typecheck-neutral but **deploy-critical**: without it the mutations exist in the API with no Lambda permissions and no `TEAM_TABLE` / `TEAM_INVITATION_TABLE`, so every call fails at `Required environment variables are not set`.

**a. Imports** — after line 20 (`deletePlayerSafe`), single-quoted to match this file:

```ts
import { archiveTeam } from './functions/archive-team/resource';
import { restoreTeam } from './functions/restore-team/resource';
import { assignTeamOwner } from './functions/assign-team-owner/resource';
```

**b. `defineBackend`** — add `archiveTeam,`, `restoreTeam,`, `assignTeamOwner,` after `deletePlayerSafe,` (line 38).

**c. Grants and env vars — revised in revision 1 (Minor 4): scoped `PolicyStatement`s instead of `grantReadWriteData`.** The original plan used `grantReadWriteData`, which grants delete rights on tables none of these three Lambdas ever deletes from. The repo already has a narrower precedent for exactly this situation — `upsertCoachProfile`/`getTeamCoachProfiles`, a few lines above the append point in the same file, use explicit `PolicyStatement`s. Follow that shape. `teamTable` (line 88) and `teamInvitationTable` (line 76) are already in scope; do not redeclare them. `PolicyStatement` is already imported at the top of the file (line 2).

```ts
// Grant table access for restoreTeam Lambda (least-privilege: Team get/update only, no delete)
backend.restoreTeam.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
    resources: [teamTable.tableArn],
  })
);
backend.restoreTeam.addEnvironment('TEAM_TABLE', teamTable.tableName);

// Grant table access for assignTeamOwner Lambda (least-privilege: Team get/update only, no delete)
backend.assignTeamOwner.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
    resources: [teamTable.tableArn],
  })
);
backend.assignTeamOwner.addEnvironment('TEAM_TABLE', teamTable.tableName);

// Grant table access for archiveTeam Lambda (least-privilege: Team get/update;
// TeamInvitation scan + per-item update for the pending-invitation sweep)
backend.archiveTeam.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
    resources: [teamTable.tableArn],
  })
);
backend.archiveTeam.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:Scan', 'dynamodb:UpdateItem'],
    resources: [teamInvitationTable.tableArn],
  })
);
backend.archiveTeam.addEnvironment('TEAM_TABLE', teamTable.tableName);
backend.archiveTeam.addEnvironment('TEAM_INVITATION_TABLE', teamInvitationTable.tableName);
```

Notes:
- `archive-team`'s `scanAll` does a plain table scan (no `IndexName`), so `dynamodb:Scan` on the base `teamTable`/`teamInvitationTable` ARN is sufficient; no GSI ARN is needed.
- `restore-team` and `assign-team-owner` get `Team` only — least privilege; neither touches invitations.
- No Cognito/`USER_POOL_ID` grant is needed: none of the three resolves an email; they compare Cognito subs only.
- The three `resource.ts` files already set `resourceGroupName: 'data'` (matching `delete-team-safe`), which is what avoids a circular data/function stack dependency. No change there. **`archive-team/resource.ts` does need one change — see Minor 5's timeout bump in the archive-team handler section below.**

### 3. `amplify/functions/archive-team/handler.ts` — Correction 5a + Major 2 (coach-membership guard) + Minor 3/6 (result shape) + Minor 5 (timeout)

**a. Correction 5a (unchanged from the original plan):** move the pending-invitation sweep **out of** the `if (team.status !== 'archived')` branch so a retry after a partial failure re-sweeps. The team-status `UpdateCommand` stays inside the branch (that is what keeps the write idempotent); only the sweep moves out and de-indents one level.

**b. Major 2 (new in revision 1):** add a `coaches`-membership guard, both as a fast JS pre-check and as a `contains(coaches, :callerSub)` clause on the conditional write, so a caller whose `ownerId` equality still (incorrectly) matches after being removed from `coaches` by `revokeCoachAccess` is rejected. The two together close the TOCTOU window: the JS check catches the common case cheaply, the write-time clause catches a revocation that races between the `GetCommand` and the `UpdateCommand`.

**c. Minor 3/6 (new in revision 1):** the conditional write returns `ReturnValues: 'ALL_NEW'`, so the trailing unconditional `GetCommand` is removed — one fewer round trip, and no window where the returned `Team` could reflect a stale, non-consistent read. `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'` is also set for shape consistency with `assignTeamOwner` (see Decision 2), even though this handler doesn't need to branch on it — both of its condition clauses collapse to the same "access denied" message.

**d. Minor 5 (new in revision 1):** bump `amplify/functions/archive-team/resource.ts`'s `timeoutSeconds` from `30` to `60`, matching `delete-team-safe/resource.ts`, which uses the same scan-based pattern against the same class of table. `archive-team`'s scan is currently smaller in scope (`TeamInvitation` only, vs. `delete-team-safe`'s ten-plus tables), but there is no principled reason for it to have a *shorter* budget than the precedent it explicitly follows, and the 5x cost is trivial for a rare, human-initiated action.

Resulting order inside the handler:

```ts
  if (!team.ownerId) {
    throw new Error('Team has no assigned owner. Assign an owner before archiving.');
  }

  if (team.ownerId !== callerSub) {
    throw new Error('Access denied: only the team owner can archive this team');
  }

  // Major 2: revokeCoachAccess can remove the owner from `coaches` without
  // ever clearing ownerId (ownerId has no update grant, so it structurally
  // can't). Reject fast here; the write-time contains() clause below closes
  // the race between this read and the write.
  const coaches = team.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: only the team owner can archive this team');
  }

  const nowIso = new Date().toISOString();
  let archivedTeam: DbItem = team;

  if (team.status !== 'archived') {
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: teamTable,
        Key: { id: teamId },
        UpdateExpression: 'SET #status = :archivedStatus, archivedAt = :archivedAt, archivedBy = :archivedBy, updatedAt = :updatedAt',
        // contains(coaches, :callerSub) closes the TOCTOU window between the
        // GetCommand above and this write (Major 2).
        ConditionExpression: 'ownerId = :callerSub AND contains(coaches, :callerSub)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':archivedStatus': 'archived',
          ':archivedAt': nowIso,
          ':archivedBy': callerSub,
          ':updatedAt': nowIso,
          ':callerSub': callerSub,
        },
        ReturnValues: 'ALL_NEW', // Minor 6: replaces the trailing GetCommand.
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD', // Minor 3: shape consistency with assignTeamOwner; unused here.
      }));
      archivedTeam = result.Attributes as DbItem;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new Error('Access denied: only the team owner can archive this team');
      }
      throw error;
    }
  }

  // Runs on EVERY call, not just the archiving transition: a retry after a
  // partial failure — or an invitation that was still PENDING during a race —
  // must be swept. Phase 3 step 3, "deterministic when called repeatedly".
  // Minor 5 bound: this is a full-table scan on every call, including
  // idempotent no-ops. Convert to a Query (parent Correction 4, deferred)
  // once the trigger condition in Required Follow-Ups is hit.
  const pendingInvitations = await scanAll(
    teamInvitationTable,
    'teamId = :teamId AND #status = :pendingStatus',
    { ':teamId': teamId, ':pendingStatus': 'PENDING' },
    { '#status': 'status' },
  );

  await Promise.all(pendingInvitations.map(/* unchanged per-item conditional EXPIRED update */));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return archivedTeam as any;
```

The per-invitation update body, its `ConditionExpression: '#status = :pendingStatus'`, and its swallow-on-conditional-failure catch are unchanged. `nowIso` is already computed above the branch, so the moved block still resolves it. `type DbItem` is the existing type already declared at the top of this handler.

### 4. `amplify/functions/assign-team-owner/handler.ts` — Correction 5b + Major 2 (orphaned-owner reclaim) + Minor 3/6 (result shape, no re-read)

**a. Correction 5b, extended by Major 2 (revision 1):** the original plan added `contains(coaches, :callerSub)` to close the TOCTOU window against `revokeCoachAccess`. Architecture review Major 2 found that alone is insufficient: once `archiveTeam`/`restoreTeam` also gain a `contains(coaches, :callerSub)` guard (section 3/5), a team whose owner was removed from `coaches` becomes **permanently un-archivable and un-reclaimable** — `assignTeamOwner`'s original `attribute_not_exists(ownerId)` clause is false because the orphaned `ownerId` is still set. **Decision (Decision 5 above): widen the condition** to `(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)`, so any current coach can also reclaim ownership once the existing owner is no longer a coach.

**b. Minor 3 (revised in revision 1): disambiguate via `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`, not a re-read.** This removes the extra `GetCommand` round trip *and* the previously-accepted imprecision (a third party claiming ownership between the failed write and a separate re-read could produce a misleading message) — `ReturnValuesOnConditionCheckFailure` returns the pre-write item atomically with the condition check, so there is no window for that race at all. The returned item is in raw `AttributeValue` shape and must be unmarshalled with `unmarshall()` from `@aws-sdk/util-dynamodb` (added as an explicit `package.json` dependency in section 7).

**c. Minor 6: `ReturnValues: 'ALL_NEW'`** replaces the trailing unconditional `GetCommand` on the success path.

The pre-write JS membership check (`coaches?.includes(callerSub)`) stays — it gives the fast, unambiguous "not a coach" error on the common path, before any write is attempted.

```ts
import { DynamoDBClient, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
// ...existing imports (DynamoDBDocumentClient, GetCommand, UpdateCommand) unchanged.

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: teamTable,
      Key: { id: teamId },
      UpdateExpression: 'SET ownerId = :ownerId, updatedAt = :updatedAt',
      // attribute_not_exists(ownerId) resolves the common "legacy, never
      // owned" case. NOT contains(coaches, ownerId) additionally allows
      // reclaiming a team whose current owner was removed from `coaches` by
      // revokeCoachAccess (Major 2 / Decision 5) — without this clause an
      // orphaned-owner team can never be archived or restored by anyone.
      // contains(coaches, :callerSub) closes the TOCTOU window where
      // revokeCoachAccess removes the caller between the read and this write.
      ConditionExpression: '(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)',
      ExpressionAttributeValues: {
        ':ownerId': callerSub,
        ':callerSub': callerSub,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.Attributes as any;
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // DynamoDB reports one undifferentiated failure for a compound
      // condition. ReturnValuesOnConditionCheckFailure returns the pre-write
      // item atomically on the exception itself — no re-read, no race — but
      // in raw low-level AttributeValue shape, so it must be unmarshalled.
      const rawItem = (error as { Item?: Record<string, AttributeValue> }).Item;
      const current = rawItem ? (unmarshall(rawItem) as DbItem) : undefined;

      if (!current) {
        throw new Error('Team not found');
      }

      const currentCoaches = current.coaches as string[] | undefined;
      if (current.ownerId && currentCoaches?.includes(current.ownerId as string)) {
        throw new Error('Team already has an owner');
      }

      throw new Error('Access denied: caller is not a coach on this team');
    }

    throw error;
  }
```

No imprecision remains to document here: unlike the original re-read approach, `ReturnValuesOnConditionCheckFailure` cannot race with a subsequent write, because DynamoDB returns the item state as of the same atomic condition-check operation that failed.

### 5. `amplify/functions/restore-team/handler.ts` — Correction 5c + Major 2 (coach-membership guard) + Minor 3/6 (result shape)

**a. Correction 5c (unchanged from the original plan, comment only):** add a comment above the `UpdateCommand` recording the `REMOVE archivedAt, archivedBy` decision, so the later `docs/SHARING-PERMISSIONS.md` write-up has an anchor in code.

**b. Major 2 (new in revision 1):** add the same `coaches`-membership guard as `archive-team` (JS pre-check + `contains(coaches, :callerSub)` write-time clause) — same rationale, same TOCTOU window against `revokeCoachAccess`.

**c. Minor 6 (new in revision 1):** `ReturnValues: 'ALL_NEW'` replaces the trailing unconditional `GetCommand`; the idempotent-no-op path (team already active) returns the already-fetched `team` object directly instead of re-reading it.

```ts
  if (!team.ownerId) {
    throw new Error('Team has no assigned owner. Assign an owner before restoring.');
  }

  if (team.ownerId !== callerSub) {
    throw new Error('Access denied: only the team owner can restore this team');
  }

  // Major 2: same TOCTOU guard as archive-team — see that handler's comment.
  const coaches = team.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: only the team owner can restore this team');
  }

  if (team.status === 'archived') {
    const nowIso = new Date().toISOString();
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: teamTable,
        Key: { id: teamId },
        // Decision (TEAM-ARCHIVE-PLAN Correction 5c): archivedAt/archivedBy are
        // REMOVEd on restore. They are only meaningful while a team is archived,
        // and a stale value on an active team misleads. If archive history is
        // wanted, add append-only audit records instead. Document in
        // docs/SHARING-PERMISSIONS.md when Phase 7 lands.
        UpdateExpression: 'SET #status = :activeStatus, updatedAt = :updatedAt REMOVE archivedAt, archivedBy',
        // contains(coaches, :callerSub) closes the TOCTOU window between the
        // GetCommand above and this write (Major 2).
        ConditionExpression: 'ownerId = :callerSub AND contains(coaches, :callerSub)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':activeStatus': 'active',
          ':updatedAt': nowIso,
          ':callerSub': callerSub,
        },
        ReturnValues: 'ALL_NEW', // Minor 6: replaces the trailing GetCommand.
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD', // Minor 3: shape consistency; unused here.
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result.Attributes as any;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new Error('Access denied: only the team owner can restore this team');
      }
      throw error;
    }
  }

  // Already active — idempotent no-op. Nothing was written, so return the
  // team as already fetched rather than re-reading it (Minor 6).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return team as any;
```

### 6. `amplify/data/resource.safe-delete-policy.test.ts` — parent Next Step 3 (rewritten in revision 1, Major 1)

**The original plan's block-bounding is broken and must be fixed as part of this slice, not left "byte-for-byte unchanged."** Verified directly against the checked-in file: `amplify/data/resource.ts` is 100% CRLF (557 `\r\n`, 0 bare `\n`; confirmed with a byte-level scan), and this test file is CRLF too. `readFileSync(path, 'utf-8')` does not normalize line endings. Three concrete consequences, all confirmed against the real file:

1. The **existing** test's bounding — `source.indexOf('\n\n  ', modelStart + 1)` — searches for two consecutive bare `\n` characters. A "blank line" in a CRLF file is `\r\n\r\n`, not `\n\n`, so this search returns `-1` and every existing model block silently runs to EOF instead of stopping at the next blank line. Both existing assertions currently pass trivially against unrelated downstream text — the bounding was never real on this machine, and with no `.gitattributes` in this repo a Linux CI checkout (LF) would behave *differently again*, not just fail loudly.
2. The plan's **new** `teamBlock` computation has the identical bug, and it is not merely inert: the "grants no update on any lifecycle field" test's `toHaveLength(4)` assertion would hard-fail, because an unbounded (EOF-terminated) block matches 7 lines against `/^\s+(ownerId|status|archivedAt|archivedBy):/` (Team's four, plus `Game.status`, `PlayerAvailability.status`, `TeamInvitation.status` elsewhere in the file), not 4.
3. Separately from CRLF: the actual separator line after the `deletePlayerSafe` block (where the three new mutations are inserted, immediately before `QueuedSubstitution`) is **whitespace-only** (`"  "`, two spaces — confirmed with `cat -A`), not truly empty, even under LF. A bound that only recognizes a truly empty line would run past it. And the existing test's model-name search (`` `${modelName}: a` ``) is **unanchored** — it only happens to be safe today because `archiveTeam: a` / `restoreTeam: a` (both containing the substring `Team: a`) are inserted *after* the `Team` model block in this plan's ordering. That is an undocumented ordering dependency in the original text; this rewrite removes it entirely by anchoring on full lines instead of relying on ordering.

**Fix:** normalize line endings once (`source.replace(/\r\n/g, '\n')`) before any bounding logic, and bound every block on a line matching `^\s*$` (empty **or** whitespace-only) rather than a raw `'\n\n'` substring search, using a small shared helper. Apply this to both the existing `describe` block and the new one — the whole file is rewritten below, not just appended to.

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const filePath = resolve(__dirname, 'resource.ts');
// amplify/data/resource.ts is CRLF on disk (confirmed: 557 \r\n, 0 bare \n).
// readFileSync(..., 'utf-8') does not normalize line endings, so every block
// boundary below is computed on a normalized copy, not the raw file text.
const rawSource = readFileSync(filePath, 'utf-8');
const source = rawSource.replace(/\r\n/g, '\n');

/**
 * Extracts a source block starting at the line exactly matching
 * `^  ${label}: a$` (top-level schema entries are declared at 2-space
 * indent) through the next line that is empty OR whitespace-only (some
 * separators in this file are a lone "  ", not a truly empty line — e.g.
 * between deletePlayerSafe and QueuedSubstitution). Anchoring on the full
 * line — not a raw substring search — means this can never accidentally
 * match a differently-named declaration that merely contains `${label}: a`
 * as a substring (e.g. `Team: a` inside `archiveTeam: a`), so unlike the
 * original test, block order in the file has no bearing on correctness.
 */
function extractBlock(label: string): string {
  const lines = source.split('\n');
  const startPattern = new RegExp(`^  ${label}: a$`);
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  expect(startIndex).toBeGreaterThanOrEqual(0);

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^\s*$/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n');
}

describe('safe-delete authorization policy', () => {
  it('does not grant model delete to Formation, Team, Player, Game, or GameNote', () => {
    const blockedDeleteModels = ['Formation', 'Team', 'Player', 'Game', 'GameNote'];

    for (const modelName of blockedDeleteModels) {
      const block = extractBlock(modelName);

      if (modelName === 'GameNote') {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)/);
      } else {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['create', 'read', 'update'\]\)/);
      }
    }
  });

  it('declares authoritative safe-delete mutations for the same entities', () => {
    expect(source).toContain('deleteFormationSafe: a');
    expect(source).toContain('deleteTeamSafe: a');
    expect(source).toContain('deletePlayerSafe: a');
    expect(source).toContain('deleteGameSafe: a');
    expect(source).toContain('deleteSecureGameNote: a');
  });
});

describe('team lifecycle field authorization policy', () => {
  const teamBlock = extractBlock('Team');

  it('keeps the whole Team model in one block bounded by a blank/whitespace-only line', () => {
    // Guards the bounding logic every other test in this describe depends
    // on: a blank line inside the Team model would silently truncate the
    // block and weaken every assertion made against it.
    expect(teamBlock).toContain('archivedBy');
    expect(teamBlock).toContain("allow.ownersDefinedIn('coaches').to(['create', 'read', 'update'])");
  });

  it('lets the creator stamp ownerId at create time but never update it', () => {
    expect(teamBlock).toMatch(
      /ownerId: a\.string\(\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['create', 'read'\]\)\]\)/
    );
  });

  it('keeps status, archivedAt, and archivedBy read-only for coaches', () => {
    expect(teamBlock).toMatch(
      /status: a\.string\(\)\.default\('active'\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)\]\)/
    );
    expect(teamBlock).toMatch(
      /archivedAt: a\.datetime\(\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)\]\)/
    );
    expect(teamBlock).toMatch(
      /archivedBy: a\.string\(\)\.authorization\(\(allow\) => \[allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)\]\)/
    );
  });

  it('grants no update on any lifecycle field', () => {
    const lifecycleFieldLines = teamBlock
      .split('\n')
      .filter((line) => /^\s+(ownerId|status|archivedAt|archivedBy):/.test(line));

    expect(lifecycleFieldLines).toHaveLength(4);
    for (const line of lifecycleFieldLines) {
      expect(line).toContain('.authorization(');
      expect(line).not.toContain("'update'");
    }
  });

  it('declares owner-authorized lifecycle mutations returning Team', () => {
    for (const operation of ['archiveTeam', 'restoreTeam', 'assignTeamOwner']) {
      const block = extractBlock(operation);

      expect(block).toContain('.mutation()');
      expect(block).toContain('teamId: a.string().required()');
      expect(block).toContain(".returns(a.ref('Team'))");
      expect(block).toContain('allow.authenticated()');
      expect(block).toContain(`a.handler.function(${operation})`);
    }
  });
});
```

Notes for the implementer:
- **This is a full rewrite of the file, not an append.** The existing `describe('safe-delete authorization policy', ...)` block's *assertions* are unchanged; only how `source`/blocks are computed changes (shared `extractBlock` helper, normalized line endings, whitespace-tolerant bound). `filePath`/`source` move to module scope so both `describe` blocks share them.
- These assertions pin *source text*, matching the file's existing convention. They will fail on a cosmetic reformat of the pinned lines — that is intended for security-relevant grants, and the failure message points straight at the changed rule.
- The `grants no update` test is the one that actually enforces the security property; the exact-shape regexes are the readable documentation of it.
- Vitest's `include` is `['**/*.test.ts', ...]`, so this file already runs under `npm run test:run`. `amplify/tsconfig.json` has no `include`, so it typechecks this test file too — keep the new code strict-clean.
- File name vs contents: this file is now really "schema policy pinning", not just safe-delete. Do **not** rename it in this slice (it would obscure the diff); note it as a possible later cleanup.
- When inserting the three new mutation declarations in section 1c, prefer replacing the existing whitespace-only (`"  "`) separator line after `deletePlayerSafe` with a genuinely empty line. `extractBlock`'s `^\s*$` bound tolerates either, but a true empty line keeps the file's blank-line convention consistent for human readers, not just for this test.

### 7. `package.json` + `scripts/commit-gate.mjs` — parent Next Step 2 + Minor 3 dependency addition

**a. New in revision 1 (Minor 3): add `@aws-sdk/util-dynamodb` as an explicit dependency.** Section 4 (`assign-team-owner`) imports `unmarshall` from it to decode `ConditionalCheckFailedException.Item` — the only one of the three handlers that actually branches on the disambiguated result; `archive-team` and `restore-team` set `ReturnValuesOnConditionCheckFailure` for shape consistency but don't need to unmarshal it, so they don't import this package. It currently resolves only because it is a transitive dependency of `@aws-sdk/lib-dynamodb` (confirmed present in `package-lock.json` at `3.996.8`, and its types are already referenced indirectly via `NativeAttributeValue` in `@aws-sdk/lib-dynamodb`'s own type definitions) — it is not a declared direct dependency today. Importing it directly at runtime without declaring it is fragile (relies on npm's hoisting behavior, which is not a version-pinning guarantee). Add to `package.json` `dependencies`, matching the caret style of its sibling AWS SDK packages already there:

```json
    "@aws-sdk/util-dynamodb": "^3.965.0",
```

**b. `scripts/commit-gate.mjs`'s `runStep` only knows how to spawn `npm <args>`, so expose the typecheck as an npm script rather than reworking the runner.**

`package.json`, after `"build"`:

```json
    "typecheck:amplify": "tsc -p amplify/tsconfig.json --noEmit",
```

`scripts/commit-gate.mjs`:

```js
const STEPS = [
  { key: 'lint', command: ['run', 'lint'] },
  { key: 'typecheck:amplify', command: ['run', 'typecheck:amplify'] },
  { key: 'test:run', command: ['run', 'test:run'] },
  { key: 'build', command: ['run', 'build'] },
];
```

Placed second because it is the cheapest step that can catch a backend-only regression, so it fails before the full Vitest suite and the Vite build. Also widen the summary column so the longer key still aligns:

```js
    console.log(`${result.step.padEnd(18)} ${result.status.padEnd(7)} EXIT=${exit}`);
```

### 8. `CLAUDE.md` — one-line staleness fix (requires the user's own approval)

CLAUDE.md's command list documents `npm run gate:commit` as "Runs lint -> test:run -> build in sequence", which this change makes wrong. The accurate line is "Runs lint -> typecheck:amplify -> test:run -> build in sequence", plus a `npm run typecheck:amplify` entry. **CLAUDE.md is project configuration — do not edit it on the strength of this plan alone; ask the user directly.** If they decline, the plan is otherwise unaffected.

## Sequencing

1. `amplify/data/resource.ts` — imports, Correction 1, three mutation declarations. Use a genuinely empty separator line, not the whitespace-only one currently there, between the new blocks (see section 6's implementer note). **Checkpoint:** `npx tsc -p amplify/tsconfig.json --noEmit` should already be clean (0 errors) at this point; everything after is correctness and enforcement, not compilation.
2. Handler corrections — 5a (sweep placement), 5b/Major 2 (coach-membership guard + orphaned-owner reclaim), 5c (comment), Minor 3/6 (`ReturnValuesOnConditionCheckFailure`/`ReturnValues`, no second `GetCommand`) across all three handlers, plus the Minor 5 `archive-team/resource.ts` timeout bump. Independent of step 1 and of each other, no ordering constraint.
3. `amplify/backend.ts` wiring with the scoped `PolicyStatement` grants (Minor 4). Invisible to the typecheck but required for the Next Step 4 sandbox; do not defer it, or step 4 fails at the first invocation with a misleading env-var error.
4. Test extension (Major 1 rewrite — full file, not an append).
5. `package.json` (new `@aws-sdk/util-dynamodb` dependency, `typecheck:amplify` script) + `scripts/commit-gate.mjs`.
6. Full verification below.

## Verification

```bash
npx tsc -p amplify/tsconfig.json --noEmit                       # expect: 0 errors (6 before)
npx vitest run amplify/data/resource.safe-delete-policy.test.ts # expect: 7 passing (2 existing + 5 new)
npm run gate:commit                                             # expect: lint / typecheck:amplify / test:run / build all PASS
```

Negative check that the new gate stage actually bites (do this once, then revert): comment out one of the three mutation declarations and confirm `npm run gate:commit` now fails at `typecheck:amplify` with a nonzero exit, rather than reaching `test:run`. Without this, the stage is unproven and this slice has not delivered its stated purpose.

**Second negative check, new in revision 1 (proves Major 1's fix is real, not just theoretical):** before normalizing line endings, temporarily revert the `extractBlock` helper to the original `source.indexOf('\n\n  ', ...)` shape and confirm `grants no update on any lifecycle field` actually fails with `toHaveLength(4)` receiving 7 — this is the concrete failure the architecture review predicted. Revert the temporary change once confirmed; it exists only to prove the fix was necessary, not to ship.

Diff hygiene: `git status` should show exactly 10 modified files (`amplify/data/resource.ts`, `amplify/backend.ts`, `amplify/functions/archive-team/handler.ts`, `amplify/functions/archive-team/resource.ts`, `amplify/functions/restore-team/handler.ts`, `amplify/functions/assign-team-owner/handler.ts`, `amplify/data/resource.safe-delete-policy.test.ts`, `package.json`, `package-lock.json`, `scripts/commit-gate.mjs`) plus CLAUDE.md only if the user approved item 8. **No file under `src/` should appear.** `package-lock.json` changes because adding `@aws-sdk/util-dynamodb` as an explicit `package.json` dependency (section 7a) requires an `npm install` run, which updates the lockfile even though the package was already present transitively — this is expected and should not be reverted.

## Risks and Edge Cases

- **Field-level `.authorization()` remains unvalidated (parent Correction 3) — highest risk, deliberately not resolved here.** A clean typecheck says nothing about whether the GraphQL transformer accepts `allow.ownersDefinedIn('coaches')` at field level, whether `.default('active')` still applies on a field carrying a field-level rule, or whether the locked fields survive in `observeQuery` payloads. This slice makes the sandbox attempt possible; Next Step 4 is still the go/no-go. Do not build anything on top of this until it passes.
- **A custom mutation returning a model that now has field-level auth is a new combination.** `acceptInvitation` already returns `a.ref('Team')`, but `Team` did not carry field-level rules when that was written. Add to the Next Step 4 smoke test: call `archiveTeam` and confirm the returned `Team` includes non-null `status`/`archivedAt`/`archivedBy` for a coach caller, rather than nulled-out fields.
- **Decision 5's widened `assignTeamOwner` condition has a known revoke→reclaim hijack path — accepted tradeoff, not a bug.** `revokeCoachAccess` (`src/services/invitationService.ts`) is out of scope for this slice and today has no owner guard: any coach on a team can call it to remove any other coach, including the current owner, from `coaches`. Combined with this slice's `NOT contains(coaches, ownerId)` clause (Decision 5), a co-coach can revoke the current owner and then immediately call `assignTeamOwner` to become owner themselves — a self-service ownership takeover with no server-side block. This is an **intentional, accepted tradeoff**: the alternative (leaving the widened condition out) permanently strands orphaned-owner teams, which is strictly worse for a rare, human-initiated, already-trusted-multi-coach context. Availability is chosen over hijack-resistance for this slice. See the Required Follow-Ups entry below for the eventual close.
- **Orphaned-owner reclaim (new in revision 1, Major 2) leaves a frontend follow-up obligation, not fully closed by this slice.** Widening `assignTeamOwner`'s condition to `NOT contains(coaches, ownerId)` closes the backend availability gap, but the parent plan's UI condition for showing the "Owner Unassigned" warning pill / "Assign Owner" action (Phase 5) is currently gated on bare `!team.ownerId`, and will not fire for a team whose `ownerId` is set but orphaned. **This must be reflected in `docs/plans/TEAM-ARCHIVE-PLAN.md`** — both Phase 2 step 4's ownership-assignment policy sentence and Phase 5's "Owner Unassigned" UI condition — before Next Step 5/6 (frontend) starts; see Required Follow-Ups below. Not fixed here; frontend is out of scope for this slice.
- **`attribute_not_exists(ownerId)` vs an explicitly-null `ownerId`, updated for the revision-1 condition shape.** If any client ever writes `ownerId: null` (rather than omitting it), neither `attribute_not_exists(ownerId)` nor (now) `NOT contains(coaches, ownerId)` reliably resolves the ambiguity the same way `attribute_type` would, and `assignTeamOwner` could report "Team already has an owner" while `team.ownerId` is falsy. Legacy rows predate the field so the attribute is genuinely absent, and Amplify's client drops `undefined` inputs, so this is currently unreachable — but it becomes reachable the moment the Next Step 5/6 frontend passes `ownerId` from a possibly-null variable. Optional one-clause hardening, recommended: extend the condition to `ConditionExpression: '(attribute_not_exists(ownerId) OR attribute_type(ownerId, :nullType) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)'` with `':nullType': 'NULL'`. If not taken now, the frontend step must guarantee it never sends a null `ownerId`.
- **`contains(coaches, :callerSub)` (and, in `assignTeamOwner`, `contains(coaches, ownerId)`) assume `coaches` is a DynamoDB List.** It is (`a.string().array()`). If `coaches` is absent entirely on a malformed row, `contains(coaches, :callerSub)` is false and the caller is correctly denied; a malformed row with no `coaches` also makes `NOT contains(coaches, ownerId)` true, which is the conservative (more permissive to reclaim) direction — acceptable, since a row with neither a valid owner nor a valid coaches list is already broken and reclaiming it is the only way out. No crash path either way.
- **Handler logic has no automated coverage in this slice.** The only tests here pin schema text. Archive idempotency, the re-sweep behavior, the TOCTOU conditions, the orphaned-owner reclaim path, and the (now atomic, not re-read) disambiguation branch are all proven only by the Next Step 4 sandbox smoke test — a deliberate, accepted gap, but it means a regression in any of these would be invisible to `gate:commit`. Parent Phase 7 step 1 is where these get real tests; that phase's test list should explicitly add a reclaim-after-revocation case given Major 2.
- **Real-time subscribers will not see archive/restore/owner-assignment in real time (new in revision 1, Minor 6).** All three handlers write via the DynamoDB SDK directly (the same pattern `delete-team-safe` uses), which never triggers `onUpdateTeam`. `observeQuery('Team')` subscribers — `src/components/Home.tsx:65` and `src/components/Management.tsx:128` — will not see the effect of these mutations until their next full re-fetch. The parent plan already documents this exact hazard for `Game.create` (Phase 8 / Risks), but never for these three Team lifecycle mutations, which have identical behavior. **Must be carried into the parent plan's Next Step 5 (frontend service wrappers):** `Management.tsx` already has a `teamRefreshKey` escape hatch it can reuse, but `Home.tsx` has no equivalent today, and other coaches' live sessions on the same team have no refresh path at all — the frontend service wrapper will need to manually update/refetch local state after calling these mutations, mirroring the pattern already planned for `Game.create` in Phase 8. Not fixed here (frontend out of scope); tracked in Required Follow-Ups.
- **`isConditionalCheckFailed` and `scanAll` duplication is accruing (informational, not blocking).** Verified directly: `isConditionalCheckFailed` is now declared as an identically-shaped standalone function in 4 handler files (`accept-invitation`, `archive-team`, `assign-team-owner`, `restore-team`), plus one more (`upsert-coach-profile`) with equivalent inline logic under a different shape; `scanAll` is declared identically in 4 handler files (`archive-team`, `delete-game-safe`, `delete-player-safe`, `delete-team-safe`). A shared `amplify/functions/shared/` module is the eventual answer, but this slice stays scoped — do not build it now.
- **`amplify/tsconfig.json` has no explicit `include`/`exclude` (informational, forward-looking).** Confirmed safe today — no `$amplify/env/*` generated-import surface exists under `amplify/` yet — but as more `amplify/` subdirectories accumulate, an explicit `include` would keep the new `typecheck:amplify` gate stage's surface deterministic rather than implicitly picking up whatever is added later. Not required for this slice.
- **Three new Lambdas in the `data` resource group** lengthen the data stack deploy and add cold-start surface. Consistent with the existing four `*Safe` functions; no new pattern.
- **`scripts/fix-appsync-datasource.ps1` is `acceptInvitation`-specific.** The later `*Safe` mutations were added without extending it, so the workaround it encodes appears to be legacy. If the Next Step 4 sandbox shows the new mutations resolving against the wrong data source, that script is the precedent for the fix — but do not run or generalize it speculatively.
- **Test brittleness is intentional but real.** The pinned-source assertions fail on reformatting. The `keeps the whole Team model in one block bounded by a blank/whitespace-only line` test exists specifically so a future blank line fails loudly instead of silently voiding the other assertions.
- **New teams are still born ownerless after this slice.** Correction 1 only removes the blocker. Anyone reading `ownerId` between this slice and the frontend step must still handle `undefined`.

## Required Follow-Ups (not in this slice)

1. Next Step 4 — sandbox validation of the field-level auth contract plus a live archive/restore/assign-owner smoke test, including a reclaim-after-owner-revocation case (Major 2). **Blocks everything downstream.**
2. Next Step 5/6 — `Management.tsx: handleCreateTeam` and `demoDataService.ts` pass `ownerId: currentUserId` into `Team.create()`, now permitted by Correction 1. **Must also carry the Minor 6 real-time-subscription gap:** the archive/restore/assign-owner service wrappers need to manually update or refetch local state after calling these mutations (`Home.tsx` needs a refresh path equivalent to `Management.tsx`'s `teamRefreshKey`; other coaches' live sessions currently have none).
3. **New in revision 1 (Major 2): update `docs/plans/TEAM-ARCHIVE-PLAN.md` to reflect the orphaned-owner reclaim decision before Next Step 5/6 starts** — Phase 2 step 4's ownership-assignment policy sentence needs a clause covering "owner is set but no longer a coach," and Phase 5's "Owner Unassigned" warning-pill UI condition (currently `!team.ownerId`) needs to also trigger when `ownerId` is set but that id is no longer present in `coaches`, or the reclaim affordance this slice enables on the backend will never be reachable from the UI.
4. `TeamInvitation` `teamId` GSI + Query conversion in `archive-team` (parent Correction 4), sequenced after the sandbox step. **Concrete trigger, new in revision 1 (Minor 5):** convert from `scanAll` to a Query once either (a) the `TeamInvitation` table exceeds roughly 5,000 total items (scan cost starts dominating over a targeted query at that order of magnitude), or (b) `archive-team`'s Lambda p99 duration (CloudWatch) exceeds 3 seconds — whichever comes first. Until then the scan is fine per Decision 1's rationale, now sharpened with an actual number instead of "rare, human-initiated action" alone. Note also that Correction 5a's fix makes this scan run on every `archiveTeam` call, including idempotent no-ops, not just on the archiving transition — factor that into whichever threshold is observed first.
5. `docs/SHARING-PERMISSIONS.md` — record the restore-clears-audit-fields decision (Correction 5c), the orphaned-owner reclaim policy (Major 2 / Decision 5), and the server-side vs UI-only enforcement split.
6. (Informational, non-blocking) Extract `isConditionalCheckFailed`/`scanAll` into a shared `amplify/functions/shared/` module once a further handler needs either — deferred, not urgent.
7. **New (final architecture review, revoke→reclaim tradeoff): `revokeCoachAccess` (`src/services/invitationService.ts`) must eventually reject revoking the team's current owner.** Today it has no owner guard at all, and because `coaches` is a client-updatable field via the standard model API (not routed through a Lambda), a client-side check in `revokeCoachAccess` alone would not be sufficient — a malicious or buggy client could still call `Team.update({ coaches: [...] })` directly. The guard needs a server-side home (e.g. its own Lambda-backed mutation, mirroring `assignTeamOwner`'s pattern, or a condition expression on the `coaches` field), not just a UI-layer check. This is what closes the revoke→reclaim hijack path documented in Risks and Edge Cases above. Out of scope for this slice.
