# Sharing & Permissions

## Overview

TeamTrack supports multi-coach collaboration. Team owners can invite other coaches by email to co-manage a team, or add parents for read-only access.

## Roles

| Role | Description |
|---|---|
| `OWNER` | Full control — create, edit, delete, manage invitations |
| `COACH` | Can edit and manage the team, cannot delete or manage invitations |
| `PARENT` | View-only access — can see team data and reports but cannot edit anything |

## How the Authorization Model Works

There is no separate "TeamPermission" table. Instead, every record in the database has a `coaches: string[]` field containing the user IDs of everyone authorized to access it. Amplify's `allow.ownersDefinedIn('coaches')` rule grants full CRUD access to any user whose ID appears in that array.

When a coach accepts an invitation, the `accept-invitation` Lambda function appends their user ID to the `coaches` array on the `Team` and all its related records (games, roster, positions, etc.).

```typescript
// Every model uses this pattern
.authorization((allow) => [allow.ownersDefinedIn('coaches')])
```

**Implication**: Role enforcement (COACH vs PARENT) is currently UI-only. All users in the `coaches` array have full backend access. A PARENT with direct GraphQL access could technically write data. This is an accepted tradeoff for the app's low-sensitivity use case.

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
| Delete team | ✅ | ❌ | ❌ |
| Send invitations | ✅ | ❌ | ❌ |

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

**Backend-enforced:**
- Authentication required (Cognito)
- All data access limited to users in the `coaches` array
- The `accept-invitation` Lambda is the only path to add a new user to a team (direct writes to `coaches` are blocked by the authorization rule for non-owners)

**UI-only (not backend-enforced):**
- COACH vs PARENT role distinction — the UI hides edit controls for PARENT users, but all users in `coaches` have equal backend write access
- This is acceptable given the app's low-sensitivity data (soccer game stats, not financial or health data)

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
