# Sharing & Permissions Feature

## Overview

The TeamTrack app supports multi-user collaboration through a team-based sharing and permissions system. Team owners can invite other coaches to help manage their teams, or add parents for read-only access.

## Key Features

### 1. **Permission Roles**

- **OWNER**: Full control over the team (create, edit, delete, manage permissions)
- **COACH**: Can edit and manage the team, but cannot delete or manage permissions
- **READ_ONLY** (Parents): Can only view information, no editing capabilities

### 2. **Team-Level Sharing**

When you share a team with someone, they get access to:
- **Team information** (name, formation, settings)
- **All players** on the team roster
- **All games** for that team
- **Team reports** with player statistics
- **Formation** used by the team (if any)
- **All game data** (lineups, substitutions, play time records, goals, notes)

**Important:** Users can only see players and formations that are either:
- Owned by them (they created it), OR
- Associated with a team they have access to

### 4. **Invitation System**

- Send invitations via email address
- Invitations expire after 7 days
- Recipients see pending invitations in their Profile page
- Accept or decline with one click
- Email notifications sent via AWS SES (Lambda function)

## What Shared Users Can See

### Data Visibility by Access Level

When a user has access to a team (as OWNER, COACH, or READ_ONLY):

**✅ They CAN see:**
- The team and its configuration
- All players on the team roster
- All games for that team
- Game lineups, substitutions, and play time
- Goals, assists, and game notes
- Team reports and player statistics
- The formation used by the team
- Their own created players (even if not on roster)
- Their own created formations

**❌ They CANNOT see:**
- Teams they don't own or haven't been shared with
- Players only on other teams' rosters
- Formations only used by other teams
- Games for teams they don't have access to

### Permission Level Capabilities

| Action | OWNER | COACH | READ_ONLY |
|--------|-------|-------|-----------|
| View team & games | ✅ | ✅ | ✅ |
| View reports | ✅ | ✅ | ✅ |
| Edit team settings | ✅ | ✅ | ❌ |
| Add/edit players | ✅ | ✅ | ❌ |
| Manage roster | ✅ | ✅ | ❌ |
| Create/edit games | ✅ | ✅ | ❌ |
| Manage lineups | ✅ | ✅ | ❌ |
| Delete team | ✅ | ❌ | ❌ |
| Manage permissions | ✅ | ❌ | ❌ |
| Send invitations | ✅ | ❌ | ❌ |

## How to Use

### As a Team Owner

1. **Navigate to Sharing Tab**
   - Go to Management → Sharing
   - Select the team you want to share

2. **Send an Invitation**
   - Enter the email address of the person
   - Select their role (Coach or Parent)
   - Click "Send Invitation"
   - An email will be sent to the recipient

3. **Manage Members**
   - View all current members and their roles
   - Remove members if needed
   - Cancel pending invitations

### As an Invited User

1. **Check Your Email**
   - Look for invitation email from TeamTrack
   - Email includes team name and inviter's information

2. **Check Your Profile**
   - Open Profile from the bottom navigation
   - Pending invitations appear at the top

3. **Accept or Decline**
   - Click "Accept" to join the team
   - Click "Decline" to reject the invitation

4. **Access Shared Teams**
   - Once accepted, shared teams appear in your Management tab
   - Your access level determines what you can do
   - You can create your own players and formations
   - You can view all data for the shared team

## Data Models

### TeamPermission
```typescript
{
  id: string
  teamId: string  // Reference to the team
  team: Team
  userId: string  // User who has permission
  role: 'OWNER' | 'COACH' | 'READ_ONLY'
  grantedAt: DateTime
  grantedBy: string  // User ID who granted permission
}
```

### TeamInvitation
```typescript
{
  id: string
  teamId: string  // Reference to the team
  team: Team
  email: string  // Email address of invitee
  role: 'COACH' | 'READ_ONLY'
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
  invitedBy: string  // User ID who sent invitation
  invitedAt: DateTime
  expiresAt: DateTime  // 7 days from invitedAt
}
```

## Technical Implementation

### Database Schema

```typescript
// Team model with sharing support
Team {
  id, name, ownerId, formationId, maxPlayersOnField, halfLengthMinutes
  roster: TeamRoster[]
  positions: FieldPosition[]
  games: Game[]
  permissions: TeamPermission[]
  invitations: TeamInvitation[]
}
```

### Authorization Model

**Approach:** Hybrid client-side and server-side authorization

**Server-Side (AWS AppSync/DynamoDB):**
- All authenticated users can READ most data (Team, Player, Game, etc.)
- Only owners can CREATE, UPDATE, DELETE resources
- This enables data sharing while preventing unauthorized modifications

**Client-Side (UI Filtering):**
- UI filters displayed data based on team access
- Shows only players on accessible teams + user's own players
- Shows only formations used by accessible teams + user's own formations
- Prevents UI clutter from other users' data

### Permission Checking

```typescript
import { hasTeamPermission } from '@/utils/permissions';

// Check if user can edit a team
const canEdit = await hasTeamPermission(userId, teamId, 'COACH');

// Check if user can only view a team  
const canView = await hasTeamPermission(userId, teamId, 'READ_ONLY');

// Load teams with user's permissions
const teams = await loadTeamsWithPermissions(userId);
```

### Sending Invitations

```typescript
import { sendTeamInvitation } from '@/services/invitationService';

await sendTeamInvitation(teamId, 'coach@example.com', 'COACH');
// Sends email via Lambda + SES
```

### UI Data Filtering

Players and formations are filtered to show only accessible items:

```typescript
// Filter formations: owned by user OR used by accessible teams
const accessibleFormations = formations.filter(formation => 
  formation.owner === currentUserId || 
  teams.some(team => team.formationId === formation.id)
);

// Filter players: owned by user OR on rosters for accessible teams
const accessiblePlayers = players.filter(player => 
  player.owner === currentUserId || 
  accessiblePlayerIds.has(player.id)
);
```

## Security Considerations

### Current Security Model

**✅ Enforced at Backend:**
- Authentication (must be signed in)
- Ownership verification (only owner can delete/modify owned resources)
- Write protection (no unauthorized updates)

**⚠️ Client-Side Only:**
- Data visibility filtering (UI hides unrelated data)
- Permission level enforcement (COACH vs READ_ONLY)

### Known Limitations

1. **Data Leakage via GraphQL API:**
   - Technically, any authenticated user can query all players/formations via direct GraphQL queries
   - UI filtering prevents accidental viewing but doesn't prevent intentional API access
   - **Risk Level:** Low for trusted coaching applications
   - **Mitigation:** Users are expected to be coaches/parents, not adversarial

2. **Performance:**
   - All players and formations are loaded into memory, then filtered client-side
   - Works fine for typical team sizes (hundreds of players)
   - May need optimization for very large databases (thousands of teams)

3. **Permission Level Enforcement:**
   - COACH vs READ_ONLY distinction is enforced in UI only
   - A determined user could bypass by calling GraphQL API directly
   - **Mitigation:** Amplify owner-based auth prevents data corruption; at worst, a coach could modify their own team data

### Why This Approach?

**AWS Amplify Gen 2 Limitations:**
- Does not support relationship-based authorization (e.g., "allow if user has TeamPermission")
- Cannot enforce "user can read Player if Player is on a Team they have access to"
- Available options: owner, authenticated, groups, custom Lambda

**Alternative Solutions Considered:**

1. **Cognito Groups per Team**
   - Create a Cognito group for each team
   - **Problems:** 100 groups/user limit, complex sync, management overhead

2. **Custom Lambda Authorizer**
   - Write custom authorization logic checking TeamPermission relationships
   - **Problems:** High complexity, harder to maintain, slower queries

3. **Custom Resolvers with Filtering**
   - Keep current auth, add Lambda resolvers to filter results
   - **Problems:** Additional Lambda costs, complexity

4. **Current Hybrid Approach** ✅
   - Simple to implement and maintain
   - Acceptable security for typical use case
   - Can be enhanced later if needed

### Best Practices

- **Trust Model:** App assumes users (coaches/parents) are not malicious
- **Data Sensitivity:** Soccer game data is low-sensitivity (not financial/health data)
- **Future Enhancement:** Could add custom Lambda authorizer if needed for stricter enforcement
- **Audit Trail:** Consider adding audit logging for sensitive operations

## Future Enhancements

### Planned Improvements

1. **Backend Authorization**
   - Implement custom Lambda authorizer for relationship-based permissions
   - Server-side filtering of players/formations based on team access
   - Stricter enforcement of permission levels

2. **Advanced Features**
   - **Bulk Invitations**: Invite multiple users at once
   - **Custom Roles**: More granular permissions (e.g., can manage rosters but not formations)
   - **Audit Log**: Track who made what changes
   - **Notification System**: In-app notifications for new invitations and changes
   - **Team Templates**: Share team configurations without sharing actual game data

3. **Performance Optimizations**
   - Server-side pagination for large datasets
   - Lazy loading of game data
   - GraphQL query optimization with selective field fetching

## Testing

### Manual Testing Checklist

1. **Invitation Flow**
   - [ ] Create a team as User A
   - [ ] Go to Sharing tab and invite User B as COACH
   - [ ] Verify email is sent
   - [ ] Sign in as User B
   - [ ] Check Profile for pending invitation
   - [ ] Accept invitation
   - [ ] Verify User B can see and edit the team

2. **Data Visibility**
   - [ ] User B can see all players on shared team
   - [ ] User B can see team's formation
   - [ ] User B can see all games and reports
   - [ ] User B cannot see other teams
   - [ ] User B can create their own players
   - [ ] User B's created players appear in their list

3. **Permission Enforcement**
   - [ ] COACH can edit team settings
   - [ ] READ_ONLY cannot edit anything
   - [ ] Only OWNER can delete team
   - [ ] Only OWNER can manage permissions

### E2E Testing
- Test invitation creation and email sending
- Test invitation acceptance/decline
- Test permission enforcement
- Test expiration handling
- Test data visibility filtering

## Troubleshooting

### Common Issues

**Shared team not appearing:**
- Verify invitation was accepted
- Check that invitation hasn't expired
- Refresh the Management page

**Can't see players after creating them:**
- Players are filtered by team access
- Ensure you have access to at least one team
- Your own created players should always appear

**Email not received:**
- Check spam folder
- Verify SES is configured and sandbox mode approved
- Check Lambda function logs in CloudWatch

**Permission denied errors:**
- Verify user has appropriate role (COACH or higher)
- Owner field must be set correctly
- Check console for detailed error messages

## Support

For issues or questions about the sharing feature:
- Check browser console logs for detailed error messages
- Verify user is authenticated
- Confirm email addresses match exactly
- Check invitation hasn't expired (7 days)
- Review CloudWatch logs for Lambda/SES errors
