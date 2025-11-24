# TODO

## Security Vulnerabilities

### npm audit findings
- **Total vulnerabilities**: 15
  - Low: 6
  - Moderate: 8
  - High: 1

### Action Required
Run the following command to address issues that do not require attention:
```bash
npm audit fix
```

### Notes
- Review the output after running `npm audit fix`
- For vulnerabilities that cannot be auto-fixed, may need to:
  - Update dependencies manually
  - Find alternative packages
  - Evaluate if the vulnerability affects the application's usage
- Run `npm audit` to see detailed vulnerability report

## Feature Enhancements

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
