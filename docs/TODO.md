# TODO
## Feature Enhancements

### Enhanced Authorization Security
- [ ] Upgrade from client-side filtering to database-enforced team access control
  - **Current Implementation**: 
    - Teams are readable by all authenticated users with client-side filtering based on TeamPermission records
    - Write operations are owner-only at the database level (server-enforced)
    - Client-side permission checks via `requireTeamWritePermission()` and `canWriteToTeam()` utilities (see `src/utils/permissions.ts`)
    - Team names alone are not sensitive; sensitive data (games, player stats) requires ownership or permissions
  
  **Potential Solutions for Future Enhancement**:
  
  1. **Cognito Groups Approach** (Most Secure)
     - Create a Cognito group for each team (e.g., `team-{teamId}`)
     - Add users to team groups when they accept invitations
     - Use `allow.groupsDefinedIn('allowedGroups')` authorization
     - **Pros**: Database-enforced security, no client filtering needed
     - **Cons**: Requires managing Cognito groups, increased complexity, group limits
  
  2. **Custom Query Functions** (Recommended Balance)
     - Create custom GraphQL queries with Lambda resolvers
     - Queries check TeamPermission records server-side
     - Returns only teams user has legitimate access to
     - **Pros**: Secure, server-enforced, flexible authorization logic
     - **Cons**: More code to maintain, additional Lambda functions
  
  3. **Row-Level Security with Custom Authorizers** (Future AWS Feature)
     - Wait for enhanced Amplify Gen 2 authorization features
     - Implement custom authorization logic at the AppSync level
     - Use Lambda authorizers for fine-grained access control
     - **Pros**: Most flexible, fine-grained control
     - **Cons**: Not fully available in current Amplify Gen 2, requires future AWS updates

### Cascading Deletes
- [ ] Implement cascading deletes for related data
  - **Season deletion**: Delete all associated teams, games, players, positions, stats
  - **Team deletion**: Delete all associated games, players, positions, stats
  - **Game deletion**: Delete all associated game events, player stats, lineup data
  - Add confirmation dialog showing what will be deleted
  - Consider soft delete option to preserve historical data
  - Update Amplify data schema to handle cascading relationships

### Player Availability
- [ ] Add player availability status (absent, injured, unavailable)
  - Implement ability to mark players as absent, injured, or unavailable for games
  - Filter unavailable players from lineup selection
  - Track reasons for absence
  - Display availability status in player roster
  - Add date ranges for injuries/absences
  - Show availability summary in game management view

### Position Management
- [ ] Add position suggestions based on US Soccer standard positions
  - Goalkeeper (GK)
  - Defenders: Center Back (CB), Left Back (LB), Right Back (RB), Sweeper (SW)
  - Midfielders: Defensive Mid (CDM), Central Mid (CM), Attacking Mid (CAM), Left Mid (LM), Right Mid (RM)
  - Forwards: Left Wing (LW), Right Wing (RW), Striker (ST), Center Forward (CF)
  - Allow coaches to quickly add standard positions or create custom ones
  - Consider adding formation templates (4-4-2, 4-3-3, 3-5-2, etc.)
