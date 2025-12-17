# Sharing & Permissions Feature

## Overview

The TeamTrack app now supports multi-user collaboration through a comprehensive sharing and permissions system. Season and team owners can invite other coaches to help manage their resources, or add parents for read-only access.

## Key Features

### 1. **Permission Roles**

- **OWNER**: Full control over the resource (create, edit, delete, manage permissions)
- **COACH**: Can edit and manage the resource, but cannot delete or manage permissions
- **READ_ONLY** (Parents): Can only view information, no editing capabilities

### 2. **Season-Level Sharing**

When you share a season with someone:
- They get access to the season information
- They can view all teams within that season
- Their permission level applies to all teams in the season

### 3. **Team-Level Sharing**

Share individual teams without granting access to the entire season:
- More granular control
- Useful for assistant coaches managing specific teams

### 4. **Invitation System**

- Send invitations via email address
- Invitations expire after 7 days
- Recipients see pending invitations in their Profile page
- Accept or decline with one click

## How to Use

### As a Season/Team Owner

1. **Navigate to Sharing Tab**
   - Go to Management → Sharing
   - Select the season or team you want to share

2. **Send an Invitation**
   - Enter the email address of the person
   - Select their role (Coach or Parent)
   - Click "Send Invitation"

3. **Manage Members**
   - View all current members and their roles
   - Remove members if needed
   - Cancel pending invitations

### As an Invited User

1. **Check Your Profile**
   - Open Profile from the bottom navigation
   - Pending invitations appear at the top

2. **Accept or Decline**
   - Click "Accept" to join the season/team
   - Click "Decline" to reject the invitation

3. **Access Shared Resources**
   - Once accepted, shared seasons/teams appear in your Management tab
   - Your access level determines what you can do

## Data Models

### SeasonPermission
- Links a user to a season with a specific role
- Tracks when permission was granted and by whom

### TeamPermission
- Links a user to a team with a specific role
- Can be granted independently or inherited from season permission

### SeasonInvitation & TeamInvitation
- Stores pending invitations
- Includes email, role, expiration date
- Status tracking (PENDING, ACCEPTED, DECLINED, EXPIRED)

## Technical Implementation

### Database Schema

```typescript
// Permission models
SeasonPermission {
  id, seasonId, userId, role, grantedAt, grantedBy
}

TeamPermission {
  id, teamId, userId, role, grantedAt, grantedBy
}

// Invitation models
SeasonInvitation {
  id, seasonId, email, role, status, invitedBy, invitedAt, expiresAt
}

TeamInvitation {
  id, teamId, email, role, status, invitedBy, invitedAt, expiresAt
}

// Updated models
Season {
  // ...existing fields
  ownerId: String! // Creator's user ID
  permissions: [SeasonPermission]
  invitations: [SeasonInvitation]
}

Team {
  // ...existing fields
  ownerId: String! // Creator's user ID
  permissions: [TeamPermission]
  invitations: [TeamInvitation]
}
```

### Permission Checking

```typescript
import { hasSeasonPermission, hasTeamPermission } from '@/utils/permissions';

// Check if user can edit a season
const canEdit = await hasSeasonPermission(userId, seasonId, 'COACH');

// Check if user can only view a team
const canView = await hasTeamPermission(userId, teamId, 'READ_ONLY');
```

### Sending Invitations

```typescript
import { sendSeasonInvitation } from '@/services/invitationService';

await sendSeasonInvitation(seasonId, 'coach@example.com', 'COACH');
```

## Future Enhancements

### Email Notifications
Currently, invitations are stored in the database but no email is sent. Future implementation:
- AWS SES integration for email delivery
- Lambda function triggered by DynamoDB streams
- Email template with invitation link

### React Router Integration
For email-based invitation acceptance:
- Add react-router-dom
- Create `/invitations/:id` route
- Use InvitationAcceptance component

### Advanced Features
- **Bulk Invitations**: Invite multiple users at once
- **Custom Roles**: More granular permissions (e.g., can edit rosters but not delete games)
- **Audit Log**: Track who made what changes
- **Notification System**: In-app notifications for new invitations
- **Team Inheritance**: Auto-grant team access when season permission is granted

## Migration Notes

### Existing Data
- Existing seasons and teams need `ownerId` populated
- Run a migration script to set current user as owner for all existing resources
- Or handle gracefully by checking if ownerId exists

### Backward Compatibility
- App works with or without ownerId set
- New creations automatically set ownerId
- Missing ownerId means only the creator (via Amplify owner field) has access

## Security Considerations

- All permission checks happen on the client side
- AWS Amplify DataStore handles server-side authorization
- Users can only see resources they own or have been granted access to
- Invitation emails should be validated
- Expired invitations are automatically filtered out

## Testing

### Manual Testing
1. Create a season as User A
2. Go to Sharing tab and invite User B
3. Sign in as User B
4. Check Profile for pending invitation
5. Accept invitation
6. Verify User B can see and edit the season

### E2E Testing
- Test invitation creation
- Test invitation acceptance/decline
- Test permission enforcement
- Test expiration handling

## Support

For issues or questions about the sharing feature:
- Check console logs for detailed error messages
- Verify user is authenticated
- Confirm email addresses match exactly
- Check invitation hasn't expired
