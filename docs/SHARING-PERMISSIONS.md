# Sharing & Permissions

## Overview

TeamTrack supports multi-coach collaboration. Team owners can invite other coaches by email to co-manage a team, or add parents for read-only access.

## Roles

| Role | Description |
|---|---|
| `OWNER` | Full control — create, edit, delete, manage invitations |
| `COACH` | Can edit and manage the team, cannot delete or manage invitations |
| `PARENT` | View-only access — can see team data and reports but cannot edit anything |

> `OWNER` in this table (and in `TeamInvitation.role`) is a legacy invitation-role label, not the same thing as `Team.ownerId`. The invite UI (`InvitationManagement.tsx`) only ever offers `COACH`/`PARENT` — `OWNER` is not reachable via invitation and does not transfer team ownership. See "Team Lifecycle: Ownership, Archive, and Restore" below for what actually governs `Team.ownerId`.

## How the Authorization Model Works

There is no separate "TeamPermission" table. Instead, every record in the database has a `coaches: string[]` field containing the user IDs of everyone authorized to access it. Amplify's `allow.ownersDefinedIn('coaches')` rule grants full CRUD access to any user whose ID appears in that array.

When a coach accepts an invitation, the `accept-invitation` Lambda function appends their user ID to the `coaches` array on the `Team` and all its related records (games, roster, positions, etc.).

```typescript
// Every model uses this pattern
.authorization((allow) => [allow.ownersDefinedIn('coaches')])
```

**Implication**: Role enforcement (COACH vs PARENT) is currently UI-only. All users in the `coaches` array have full backend access. A PARENT with direct GraphQL access could technically write data. This is an accepted tradeoff for the app's low-sensitivity use case.

## Team Lifecycle: Ownership, Archive, and Restore

**Ownership (`Team.ownerId`).** Field-level authorization: coaches get `create` + `read` only (`amplify/data/resource.ts`), no `update` — ownership can be stamped once at team creation (`Management.tsx: handleCreateTeam`, `src/services/demoDataService.ts`) or claimed via the `assignTeamOwner` mutation; it can never change through a plain `Team.update()` call.

**Claiming an unowned or orphaned team.** `assignTeamOwner` (`amplify/functions/assign-team-owner/handler.ts`) is first-come-first-served among the team's current `coaches`, resolved by a conditional DynamoDB write: `(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)`. The second clause exists because `revokeCoachAccess` (`src/services/invitationService.ts`) has no owner guard — any coach can revoke any other coach, including the current owner — so an owner can become "orphaned" (still recorded as `ownerId`, no longer in `coaches`). Without this clause, an orphaned team could never be archived, restored, or reclaimed by anyone. **Named, accepted tradeoff:** this also means a co-coach can revoke the owner and immediately self-claim ownership — availability is chosen over hijack-resistance for this trusted, multi-coach context (see `docs/plans/TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md`, Decision 5, for the full reasoning). Automated coverage: `amplify/functions/assign-team-owner/handler.test.ts` exercises this condition directly, including the never-owned, orphaned-owner, valid-owner-present, non-coach-caller, and concurrent-claim-race cases.

**Archive/restore are owner-only, Lambda-backed operations.** `archiveTeam`/`restoreTeam` (`amplify/functions/archive-team/`, `amplify/functions/restore-team/`) verify `team.ownerId === callerSub` and that the caller is still in `coaches`. Archiving sets `status: 'archived'`, `archivedAt`, `archivedBy`, and expires every `PENDING` `TeamInvitation` for the team (the sweep runs on every call, including idempotent no-ops, so a retried or raced call always catches stragglers). Restoring sets `status: 'active'` and **clears** `archivedAt`/`archivedBy` (`REMOVE`, not retained) — they're only meaningful while archived; a stale value on an active team would mislead. There is no separate audit-history log today; if archive history is wanted later, add append-only records rather than retaining last-archive fields.

**Invitations do not survive archiving.** Pending invitations expire on archive and are **not** revived on restore — resend if needed. (E2E-covered: `e2e/team-archive-ownership.spec.ts`.)

**Legacy teams have no `status` attribute at all.** `.default('active')` only applies to newly created rows; nothing backfills existing ones. Every consumer must go through `isTeamArchived`/`isTeamActive` (`src/utils/teamUtils.ts`), never a direct `status ===`/`!==` comparison.

**Sharing & Permissions is reachable for active teams only.** The team picker in `Management.tsx`'s Sharing tab is filtered to active teams — a coach must restore an archived team before they can invite or revoke access on it.

**Archived teams remain fully readable.** Child records (games, roster, players, formations) are untouched by archiving; reports and historical game views keep working (see the Security Model update below for what's actually blocked).

## What Shared Users Can See

### Data Visibility

When a user has access to a team:

**They CAN see:**
- The team and its configuration
- All players on the team roster
- All games for that team
- Game lineups, substitutions, and play time records
- Goals, assists, and game notes
- Team reports and player statistics
- The formation used by the team
- Their own created players and formations (even if not on this team)

**They CANNOT see:**
- Teams they don't own and haven't been invited to
- Players only on other teams' rosters
- Formations only used by other teams
- Games for teams they don't have access to

### Permission Capabilities

| Action | OWNER | COACH | PARENT |
|---|---|---|---|
| View team & games | ✅ | ✅ | ✅ |
| View reports | ✅ | ✅ | ✅ |
| Edit team settings | ✅ | ✅ | ❌ |
| Add/edit players | ✅ | ✅ | ❌ |
| Manage roster | ✅ | ✅ | ❌ |
| Create/edit games | ✅ | ✅ | ❌ |
| Manage lineups | ✅ | ✅ | ❌ |
| Pre-game planning | ✅ | ✅ | ❌ |
| Delete team permanently (Archived Teams tab) | ✅ | ✅ | ❌ |
| Send / revoke invitations (Manage Sharing) | ✅ | ✅ | ❌ |
| Archive / Restore team | ✅ | ❌ | ❌ |
| Claim ownership of an unowned/orphaned team | ✅ (any current coach) | ✅ (any current coach) | ❌ |

> **Note on the asymmetry above:** Archive/Restore (reversible) is owner-gated, while permanently deleting a team and sending/revoking invitations (harder or impossible to reverse) are not — any coach can do them. This is not an oversight introduced by this documentation update; it reflects `deleteTeamSafe`'s pre-existing any-coach authorization model, which the archive feature intentionally left as-is. It's a known characteristic of the current authorization model.

## How to Use

### Sending an Invitation (Owner)

1. Go to **Manage** tab → expand a team → **Sharing**
2. Enter the invitee's email address
3. Select their role (Coach or Parent)
4. Click **Send Invitation** — they receive an email with an accept link
5. Invitations expire after 7 days

### Accepting an Invitation (Invitee)

1. Check the **Profile** tab — pending invitations appear at the top
2. Click **Accept** to join the team or **Decline** to reject
3. Once accepted, the shared team appears in your **Manage** and **Games** tabs

## Technical Implementation

### Invitation Flow

1. Team owner creates a `TeamInvitation` record (status: `PENDING`)
2. DynamoDB Stream triggers the `send-invitation-email` Lambda, which sends an HTML email via SES
3. Invitee accepts via the Profile tab, which calls the `acceptInvitation` custom GraphQL mutation
4. The `accept-invitation` Lambda (running with elevated IAM permissions) appends the invitee's user ID to the `coaches` array on the `Team` and all related records
5. `TeamInvitation` status is updated to `ACCEPTED`

### Data Model

```typescript
TeamInvitation {
  id: string
  teamId: string
  teamName: string       // denormalized for display
  email: string          // invitee's email
  role: 'OWNER' | 'COACH' | 'PARENT'
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
  invitedBy: string      // userId of sender
  invitedAt: DateTime
  expiresAt: DateTime    // 7 days from invitedAt
  acceptedAt: DateTime
  acceptedBy: string     // userId of accepter
  coaches: string[]      // team coaches who can manage invitations
}
```

Secondary index on `email + status` enables efficient lookup of all pending invitations for a given email.

### Sending Invitations in Code

```typescript
import { invitationService } from '../services/invitationService';

// Sends invitation and triggers email Lambda via DynamoDB Stream
await invitationService.sendInvitation(teamId, 'coach@example.com', 'COACH');
```

## Security Model

The `accept-invitation` Lambda genuinely is the only path to *add* a coach to a team — its elevated IAM role exists precisely because the invitee isn't yet in `coaches` at accept time, so the standard model-level grant would reject a client-side write. But *removing* a coach is different: `revokeCoachAccess` (`src/services/invitationService.ts`) performs a plain client-side `Team.update({ coaches: updatedCoaches })`, and `coaches` carries **no** field-level lockdown in `amplify/data/resource.ts` (only `ownerId`/`status`/`archivedAt`/`archivedBy` are locked down there) — any existing coach can call it directly against any team they're on, including to revoke the owner. There is no server-side guard against that today (see Known residual risks below and Required Follow-Ups in `docs/plans/TEAM-ARCHIVE-STEP10-E2E-AND-DOCS.md`).

**Backend-enforced:**
- Authentication (Cognito), `coaches`-array scoping.
- Team lifecycle fields (`ownerId`, `status`, `archivedAt`, `archivedBy`) — field-level lockdown, writable only via `archiveTeam`/`restoreTeam`/`assignTeamOwner`.
- `deleteGameSafe` (`amplify/functions/delete-game-safe/handler.ts`) — rejects deleting a game whose team is archived.
- `deletePlayerSafe` (`amplify/functions/delete-player-safe/handler.ts`) — rejects deleting a player with roster history on any archived team.
- `accept-invitation` (`amplify/functions/accept-invitation/handler.ts`) — atomic `TransactWriteCommand` across `TeamInvitation` + `Team`; rejects accepting into an archived team with no partial state possible; the only path to *add* a coach to `coaches` (see correction above).
- `createGameSafe` (`amplify/functions/create-game-safe/handler.ts`) — enforced server-side: rejects creating a game against an archived team. The Schedule Game dropdown's client-side `isTeamActive` filter (`src/components/Home.tsx`) remains as a fast, non-authoritative UX convenience on top of the server-side check, not a substitute for it.

**Deliberately not archived-team-guarded (documented exceptions, not oversights):**
- `deleteTeamSafe` (`amplify/functions/delete-team-safe/handler.ts`) — must stay unguarded; it's also the rollback/cleanup path for demo-team seeding and removal (`src/services/demoDataService.ts`), which always targets active teams. The Management UI's "Delete Permanently" being reachable only from the Archived Teams view is a UI restriction, not a backend one, and (per the corrected table above) is not owner-gated either.
- `deleteFormationSafe` (`amplify/functions/delete-formation-safe/handler.ts`) — the existing "referenced by any team" check already subsumes an archived-team check; a Formation isn't scoped to one team.

**UI-only enforced (no server-side backstop — explicit, accepted residual risk):**
- COACH vs PARENT role distinction — the UI hides edit controls for PARENT users, but all users in `coaches` have equal backend write access. This is acceptable given the app's low-sensitivity data (soccer game stats, not financial or health data).
- Deep in-game mutations: lineup, rotation, substitutions, goals, notes, availability, roster/player edits — no team-status check anywhere in these resolvers.
- Every surface showing archived-team data displays a persistent read-only banner (`src/components/shared/ArchivedTeamBanner.tsx`, mounted in Season Reports and `GameManagement.tsx`) — visibility only, not enforcement; no `aria-disabled` treatment exists yet on any control.
- Removing a coach: `revokeCoachAccess` (see Known residual risks below).

**Known residual risks (record permanently):**
- `deletePlayerSafe` can disclose the *name* of an archived team the deleting coach doesn't otherwise have visibility into, when a player is rostered on two teams and only one is shared with that coach — pre-existing `Player.coaches` union behavior, first surfaced as literal team-name disclosure by the archived-team delete guard. Low priority, tracked, not fixed.
- The archived-team read-only banner and the Management team-card lifecycle badges can be stale for a coach mid-session: `archiveTeam`/`restoreTeam`/`assignTeamOwner` write via the DynamoDB SDK directly and never trigger an AppSync subscription event, so a co-coach already viewing the affected team/game won't see the change until they leave and re-enter. `Management.tsx` has a component-local workaround (`teamLifecycleOverrides`, self-reconciling against the next list refetch); `GameManagement.tsx`'s banner has no equivalent.
- **`revokeCoachAccess` does not cascade to child records.** Revoking a coach's access currently removes them from the team's coach list only; it is not yet a complete access-removal operation for that team's related records. Tracked in [issue #162](https://github.com/amcolosk/soccer-app-game-management/issues/162).
- **`revokeCoachAccess` has no server-side guard against revoking the team's current owner.** Any coach — not just the owner — can revoke any other coach, including the owner, producing the orphaned-owner state the Team Lifecycle section above describes. A client-side check alone would not be sufficient, since `coaches` is a plain client-writable model field — the fix needs a server-side home (its own Lambda-backed mutation, mirroring `assignTeamOwner`, or a condition expression on the field). Tracked in `docs/plans/TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md` (Required Follow-Ups #7) and `docs/plans/TEAM-ARCHIVE-STEP10-E2E-AND-DOCS.md` (Required Follow-Ups).

### Known Limitation

Any authenticated user can technically query any player, formation, or game if they know the ID, because global player/formation data uses the same `coaches` auth but a newly shared user's ID might not be on old global records. The UI filters displayed data to only show items connected to accessible teams. A determined user with direct API access could see more. See AWS Amplify Gen2 limitations for why relationship-based server-side authorization (e.g., "allow if user has access to this player's team") is not straightforward to implement.

## Troubleshooting

**Shared team not appearing:**
- Verify invitation was accepted
- Check that invitation hasn't expired (7 days)
- Refresh the Manage page

**Email not received:**
- Check spam folder
- Verify SES is configured (see `INVITATION-EMAIL-SETUP.md`)
- Check Lambda logs: `aws logs tail /aws/lambda/send-invitation-email --follow`

**Can't see players after joining a team:**
- Players are shown based on team access
- Your own created players always appear regardless of team membership
- Refresh the page after accepting an invitation

**Archived team missing from Sharing & Permissions:**
- Expected — restore it first. Invitations can only be sent, and coach access can only be revoked, for active teams (see "Team Lifecycle: Ownership, Archive, and Restore" above).

## Remediation For Existing Shared Teams

If teams were shared before the concurrency-safe acceptance patch, some related records may still have stale `coaches` arrays. Run the one-time repair script to backfill coaches across:
- `Team`
- `TeamRoster`
- `Player` records linked through team roster
- `Formation`
- `FormationPosition`
- `Game` records for the team

Command examples:

```bash
# Dry run all teams (default; recommended first)
npm run repair:sharing-permissions -- \
  --team-invitation-table=<TeamInvitationTableName> \
  --team-table=<TeamTableName> \
  --team-roster-table=<TeamRosterTableName> \
  --player-table=<PlayerTableName> \
  --formation-table=<FormationTableName> \
  --formation-position-table=<FormationPositionTableName> \
  --game-table=<GameTableName>

# Apply to one team only
npm run repair:sharing-permissions -- --apply --team-id=<team-id> \
  --team-invitation-table=<TeamInvitationTableName> \
  --team-table=<TeamTableName> \
  --team-roster-table=<TeamRosterTableName> \
  --player-table=<PlayerTableName> \
  --formation-table=<FormationTableName> \
  --formation-position-table=<FormationPositionTableName> \
  --game-table=<GameTableName>

# Apply to all teams (requires explicit global confirmation flag)
npm run repair:sharing-permissions -- --apply --all-teams \
  --team-invitation-table=<TeamInvitationTableName> \
  --team-table=<TeamTableName> \
  --team-roster-table=<TeamRosterTableName> \
  --player-table=<PlayerTableName> \
  --formation-table=<FormationTableName> \
  --formation-position-table=<FormationPositionTableName> \
  --game-table=<GameTableName>
```

You can also provide table names using env vars instead of flags:
- `TEAM_INVITATION_TABLE`
- `TEAM_TABLE`
- `TEAM_ROSTER_TABLE`
- `PLAYER_TABLE`
- `FORMATION_TABLE`
- `FORMATION_POSITION_TABLE`
- `GAME_TABLE`
