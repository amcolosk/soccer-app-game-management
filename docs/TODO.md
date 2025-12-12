# TODO
## Feature Enhancements

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
