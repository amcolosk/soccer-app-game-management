# TODO

## Development Environment Issues

### AWS CDK Version Mismatch
**Priority**: High  
**Issue**: Incompatible versions between `aws-cdk` CLI and `aws-cdk-lib` package causing sandbox deployment failures.

**Symptoms**:
- Error: "Installed 'aws-cdk' is not compatible with installed 'aws-cdk-lib'"
- Schema version mismatch: CLI supports max 38.x.x but app uses 48.0.0
- Node version warning: Running v24.11.1 but supported versions are v20.x or v22.x

**Resolution Steps**:
1. **Fix Node Version** (Recommended):
   ```bash
   # Install Node v22 LTS using nvm or directly
   nvm install 22
   nvm use 22
   # Or download from https://nodejs.org/
   ```

2. **Update CDK Packages**:
   ```bash
   # Update aws-cdk CLI globally
   npm install -g aws-cdk@latest
   
   # Update project dependencies
   npm install aws-cdk@latest aws-cdk-lib@latest --save-dev
   ```

3. **Verify Versions Match**:
   ```bash
   cdk --version
   npm list aws-cdk-lib
   # Both should be on same major version
   ```

4. **Alternative - Silence Node Warning** (if downgrade not possible):
   ```bash
   $env:JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION = "1"
   # Add to .env file for persistence
   ```

**References**:
- [AWS CDK Compatibility](https://docs.aws.amazon.com/cdk/v2/guide/troubleshooting.html)
- [Node Version Compatibility](https://nodejs.org/en/about/releases/)

---

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
