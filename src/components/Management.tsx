import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import { BugReport } from './BugReport';
import { InvitationManagement } from './InvitationManagement';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

type Team = Schema['Team']['type'];
type Player = Schema['Player']['type'];
type TeamRoster = Schema['TeamRoster']['type'];
type Formation = Schema['Formation']['type'];
type FormationPosition = Schema['FormationPosition']['type'];

export function Management() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teamRosters, setTeamRosters] = useState<TeamRoster[]>([]);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [formationPositions, setFormationPositions] = useState<FormationPosition[]>([]);
  const [activeSection, setActiveSection] = useState<'teams' | 'formations' | 'players' | 'sharing' | 'app'>('teams');
  const [showBugReport, setShowBugReport] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  // Sharing state
  const [sharingResourceType, setSharingResourceType] = useState<'team' | null>(null);
  const [sharingResourceId, setSharingResourceId] = useState<string>('');
  const [sharingResourceName, setSharingResourceName] = useState<string>('');

  // Team form state
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('7');
  const [halfLength, setHalfLength] = useState('25');
  const [selectedFormation, setSelectedFormation] = useState('');
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [isAddingRosterPlayer, setIsAddingRosterPlayer] = useState(false);
  const [editingRoster, setEditingRoster] = useState<TeamRoster | null>(null);
  const [selectedPlayerForRoster, setSelectedPlayerForRoster] = useState('');
  const [rosterPlayerNumber, setRosterPlayerNumber] = useState('');
  const [rosterPreferredPositions, setRosterPreferredPositions] = useState<string[]>([]);
  const [editRosterFirstName, setEditRosterFirstName] = useState('');
  const [editRosterLastName, setEditRosterLastName] = useState('');

  // Formation form state
  const [isCreatingFormation, setIsCreatingFormation] = useState(false);
  const [editingFormation, setEditingFormation] = useState<Formation | null>(null);
  const [formationName, setFormationName] = useState('');
  const [playerCount, setPlayerCount] = useState('');
  const [formationPositionsList, setFormationPositionsList] = useState<Array<{ positionName: string; abbreviation: string }>>([]);

  // Player form state
  const [isCreatingPlayer, setIsCreatingPlayer] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  useEffect(() => {
    loadCurrentUser();
    loadTeamsWithPermissions();

    const teamSub = client.models.Team.observeQuery().subscribe({
      next: () => {
        // Reload teams when any team changes
        loadTeamsWithPermissions();
      },
    });

    const playerSub = client.models.Player.observeQuery().subscribe({
      next: (data) => setPlayers([...data.items]),
    });

    const rosterSub = client.models.TeamRoster.observeQuery().subscribe({
      next: (data) => setTeamRosters([...data.items]),
    });

    const formationSub = client.models.Formation.observeQuery().subscribe({
      next: (data) => setFormations([...data.items]),
    });

    const formationPositionSub = client.models.FormationPosition.observeQuery().subscribe({
      next: (data) => setFormationPositions([...data.items]),
    });

    return () => {
      teamSub.unsubscribe();
      playerSub.unsubscribe();
      rosterSub.unsubscribe();
      formationSub.unsubscribe();
      formationPositionSub.unsubscribe();
    };
  }, []);

  async function loadCurrentUser() {
    try {
      const user = await getCurrentUser();
      setCurrentUserId(user.userId);
    } catch (error) {
      console.error('Error getting current user:', error);
    }
  }

  async function loadTeamsWithPermissions() {
    try {
      const user = await getCurrentUser();
      
      // Get owned teams
      const ownedTeamsResponse = await client.models.Team.list({
        filter: { ownerId: { eq: user.userId } }
      });
      const ownedTeams = ownedTeamsResponse.data || [];
      
      // Get team permissions for this user
      const permissionsResponse = await client.models.TeamPermission.list({
        filter: { userId: { eq: user.userId } }
      });
      const permissions = permissionsResponse.data || [];
      
      // Get teams from permissions
      const permittedTeamIds = permissions.map(p => p.teamId);
      const permittedTeamsPromises = permittedTeamIds.map(id => 
        client.models.Team.get({ id })
      );
      const permittedTeamsResponses = await Promise.all(permittedTeamsPromises);
      const permittedTeams = permittedTeamsResponses
        .map(r => r.data)
        .filter((t): t is NonNullable<typeof t> => t !== null && t !== undefined);
      
      // Combine and deduplicate
      const allTeamsMap = new Map<string, Team>();
      [...ownedTeams, ...permittedTeams].forEach(team => {
        if (team && team.id) {
          allTeamsMap.set(team.id, team as Team);
        }
      });
      
      setTeams(Array.from(allTeamsMap.values()));
    } catch (error) {
      console.error('Error loading teams:', error);
    }
  }

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      alert('Please enter team name');
      return;
    }

    if (!currentUserId) {
      alert('User not authenticated');
      return;
    }

    const maxPlayersNum = parseInt(maxPlayers);
    if (isNaN(maxPlayersNum) || maxPlayersNum < 1) {
      alert('Please enter a valid number of players');
      return;
    }

    const halfLengthNum = parseInt(halfLength);
    if (isNaN(halfLengthNum) || halfLengthNum < 1) {
      alert('Please enter a valid half length');
      return;
    }

    try {
      await client.models.Team.create({
        name: teamName,
        ownerId: currentUserId,
        formationId: selectedFormation || undefined,
        maxPlayersOnField: maxPlayersNum,
        halfLengthMinutes: halfLengthNum,
      });
      setTeamName('');
      setMaxPlayers('7');
      setHalfLength('25');
      setSelectedFormation('');
      setIsCreatingTeam(false);
      // Explicitly reload teams to ensure UI updates on mobile
      await loadTeamsWithPermissions();
    } catch (error) {
      console.error('Error creating team:', error);
      alert('Failed to create team');
    }
  };

  const handleEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamName(team.name);
    setMaxPlayers(team.maxPlayersOnField.toString());
    setHalfLength((team.halfLengthMinutes || 30).toString());
    setSelectedFormation(team.formationId || '');
    setIsCreatingTeam(false);
  };

  const handleUpdateTeam = async () => {
    if (!editingTeam) return;

    if (!teamName.trim()) {
      alert('Please enter team name');
      return;
    }

    const maxPlayersNum = parseInt(maxPlayers);
    if (isNaN(maxPlayersNum) || maxPlayersNum < 1) {
      alert('Please enter a valid number of players');
      return;
    }

    const halfLengthNum = parseInt(halfLength);
    if (isNaN(halfLengthNum) || halfLengthNum < 1) {
      alert('Please enter a valid half length');
      return;
    }

    try {
      await client.models.Team.update({
        id: editingTeam.id,
        name: teamName,
        formationId: selectedFormation || undefined,
        maxPlayersOnField: maxPlayersNum,
        halfLengthMinutes: halfLengthNum,
      });
      setTeamName('');
      setMaxPlayers('7');
      setHalfLength('25');
      setSelectedFormation('');
      setEditingTeam(null);
    } catch (error) {
      console.error('Error updating team:', error);
      alert('Failed to update team');
    }
  };

  const handleCancelTeamEdit = () => {
    setEditingTeam(null);
    setTeamName('');
    setMaxPlayers('7');
    setHalfLength('25');
    setSelectedFormation('');
  };

  const handleDeleteTeam = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this team? This will also delete all players, positions, and games.')) {
      try {
        await client.models.Team.delete({ id });
      } catch (error) {
        console.error('Error deleting team:', error);
        alert('Failed to delete team');
      }
    }
  };

  const handleAddPlayerToRoster = async (teamId: string) => {
    if (!selectedPlayerForRoster || !rosterPlayerNumber.trim()) {
      alert('Please select a player and enter a player number');
      return;
    }

    const num = parseInt(rosterPlayerNumber);
    if (isNaN(num) || num < 1 || num > 99) {
      alert('Please enter a valid player number (1-99)');
      return;
    }

    // Check if player is already on this team's roster
    if (teamRosters.some(r => r.teamId === teamId && r.playerId === selectedPlayerForRoster)) {
      alert('This player is already on the team roster');
      return;
    }

    // Check if number is already in use on this team
    if (teamRosters.some(r => r.teamId === teamId && r.playerNumber === num)) {
      alert('This player number is already in use on this team');
      return;
    }

    try {
      await client.models.TeamRoster.create({
        teamId,
        playerId: selectedPlayerForRoster,
        playerNumber: num,
        preferredPositions: rosterPreferredPositions.length > 0 
          ? rosterPreferredPositions.join(', ') 
          : undefined,
      });

      setSelectedPlayerForRoster('');
      setRosterPlayerNumber('');
      setRosterPreferredPositions([]);
      setIsAddingRosterPlayer(false);
    } catch (error) {
      console.error('Error adding player to roster:', error);
      alert('Failed to add player to roster');
    }
  };

  const handleRemovePlayerFromRoster = async (rosterId: string) => {
    if (window.confirm('Are you sure you want to remove this player from the team roster?')) {
      try {
        await client.models.TeamRoster.delete({ id: rosterId });
      } catch (error) {
        console.error('Error removing player from roster:', error);
        alert('Failed to remove player from roster');
      }
    }
  };

  const handleEditRoster = (roster: TeamRoster) => {
    const player = players.find(p => p.id === roster.playerId);
    setEditingRoster(roster);
    setRosterPlayerNumber(roster.playerNumber?.toString() || '');
    setRosterPreferredPositions(roster.preferredPositions ? roster.preferredPositions.split(', ') : []);
    setEditRosterFirstName(player?.firstName || '');
    setEditRosterLastName(player?.lastName || '');
    setIsAddingRosterPlayer(false);
  };

  const handleUpdateRoster = async () => {
    if (!editingRoster) return;

    if (!rosterPlayerNumber.trim()) {
      alert('Please enter a player number');
      return;
    }

    const num = parseInt(rosterPlayerNumber);
    if (isNaN(num) || num < 1 || num > 99) {
      alert('Player number must be between 1 and 99');
      return;
    }

    // Check if number is already in use by another player on this team
    if (teamRosters.some(r => r.teamId === editingRoster.teamId && r.playerNumber === num && r.id !== editingRoster.id)) {
      alert('This player number is already in use on this team');
      return;
    }

    if (!editRosterFirstName.trim() || !editRosterLastName.trim()) {
      alert('Please enter first name and last name');
      return;
    }

    try {
      // Update player name
      await client.models.Player.update({
        id: editingRoster.playerId,
        firstName: editRosterFirstName,
        lastName: editRosterLastName,
      });

      // Update roster entry
      await client.models.TeamRoster.update({
        id: editingRoster.id,
        playerNumber: num,
        preferredPositions: rosterPreferredPositions.length > 0 
          ? rosterPreferredPositions.join(', ') 
          : undefined,
      });

      setEditingRoster(null);
      setRosterPlayerNumber('');
      setRosterPreferredPositions([]);
      setEditRosterFirstName('');
      setEditRosterLastName('');
    } catch (error) {
      console.error('Error updating roster:', error);
      alert('Failed to update roster');
    }
  };

  const handleCancelRosterEdit = () => {
    setEditingRoster(null);
    setRosterPlayerNumber('');
    setRosterPreferredPositions([]);
    setEditRosterFirstName('');
    setEditRosterLastName('');
  };

  const handleDeletePlayer = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this player? This will remove them from all team rosters.')) {
      try {
        await client.models.Player.delete({ id });
      } catch (error) {
        console.error('Error deleting player:', error);
        alert('Failed to delete player');
      }
    }
  };

  const getTeamFormationPositions = (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team?.formationId) return [];
    return formationPositions.filter(fp => fp.formationId === team.formationId);
  };


  const handleCreatePlayer = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      alert('Please enter first name and last name');
      return;
    }

    try {
      // Create the player
      await client.models.Player.create({
        firstName,
        lastName,
      });

      setFirstName('');
      setLastName('');
      setIsCreatingPlayer(false);
    } catch (error) {
      console.error('Error creating player:', error);
      alert('Failed to create player');
    }
  };

  const handleCreateFormation = async () => {
    if (!formationName.trim() || !playerCount.trim()) {
      alert('Please enter formation name and specify player count');
      return;
    }

    const count = parseInt(playerCount);
    if (isNaN(count) || count < 1) {
      alert('Please enter a valid player count');
      return;
    }

    if (formationPositionsList.length === 0) {
      alert('Please add at least one position');
      return;
    }

    try {
      const formation = await client.models.Formation.create({
        name: formationName,
        playerCount: count,
      });

      if (formation.data) {
        // Create all positions
        for (let i = 0; i < formationPositionsList.length; i++) {
          const pos = formationPositionsList[i];
          await client.models.FormationPosition.create({
            formationId: formation.data.id,
            positionName: pos.positionName,
            abbreviation: pos.abbreviation,
            sortOrder: i + 1,
          });
        }
      }

      setFormationName('');
      setPlayerCount('');
      setFormationPositionsList([]);
      setIsCreatingFormation(false);
    } catch (error) {
      console.error('Error creating formation:', error);
      alert('Failed to create formation');
    }
  };

  const handleEditFormation = (formation: Formation) => {
    setEditingFormation(formation);
    setFormationName(formation.name);
    setPlayerCount(formation.playerCount.toString());
    
    // Load existing positions for this formation
    const existingPositions = formationPositions
      .filter(p => p.formationId === formation.id)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(p => ({ positionName: p.positionName, abbreviation: p.abbreviation }));
    
    setFormationPositionsList(existingPositions);
    setIsCreatingFormation(false);
  };

  const handleUpdateFormation = async () => {
    if (!editingFormation) return;

    if (!formationName.trim() || !playerCount.trim()) {
      alert('Please enter formation name and specify player count');
      return;
    }

    const count = parseInt(playerCount);
    if (isNaN(count) || count < 1) {
      alert('Please enter a valid player count');
      return;
    }

    if (formationPositionsList.length === 0) {
      alert('Please add at least one position');
      return;
    }

    try {
      // Update formation
      await client.models.Formation.update({
        id: editingFormation.id,
        name: formationName,
        playerCount: count,
      });

      // Delete all existing positions for this formation
      const existingPositions = formationPositions.filter(p => p.formationId === editingFormation.id);
      for (const pos of existingPositions) {
        await client.models.FormationPosition.delete({ id: pos.id });
      }

      // Create new positions
      for (let i = 0; i < formationPositionsList.length; i++) {
        const pos = formationPositionsList[i];
        await client.models.FormationPosition.create({
          formationId: editingFormation.id,
          positionName: pos.positionName,
          abbreviation: pos.abbreviation,
          sortOrder: i + 1,
        });
      }

      setFormationName('');
      setPlayerCount('');
      setFormationPositionsList([]);
      setEditingFormation(null);
    } catch (error) {
      console.error('Error updating formation:', error);
      alert('Failed to update formation');
    }
  };

  const handleCancelFormationEdit = () => {
    setEditingFormation(null);
    setFormationName('');
    setPlayerCount('');
    setFormationPositionsList([]);
  };

  const handleDeleteFormation = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this formation? This will also delete all positions in the formation.')) {
      try {
        await client.models.Formation.delete({ id });
      } catch (error) {
        console.error('Error deleting formation:', error);
        alert('Failed to delete formation');
      }
    }
  };

  const addFormationPosition = () => {
    setFormationPositionsList([...formationPositionsList, { positionName: '', abbreviation: '' }]);
  };

  const updateFormationPosition = (index: number, field: 'positionName' | 'abbreviation', value: string) => {
    const updated = [...formationPositionsList];
    updated[index][field] = value;
    setFormationPositionsList(updated);
  };

  const removeFormationPosition = (index: number) => {
    setFormationPositionsList(formationPositionsList.filter((_, i) => i !== index));
  };

  const getFormationName = (formationId: string | null | undefined) => {
    if (!formationId) return null;
    return formations.find(f => f.id === formationId)?.name || null;
  };

  // Filter formations to only show those used by teams the user has access to OR owned by current user
  const accessibleFormations = formations.filter(formation => 
    formation.owner === currentUserId || teams.some(team => team.formationId === formation.id)
  );

  // Filter players to show those on rosters for accessible teams OR owned by current user
  const teamIds = new Set(teams.map(t => t.id));
  const accessiblePlayerIds = new Set(
    teamRosters
      .filter(roster => teamIds.has(roster.teamId))
      .map(roster => roster.playerId)
  );
  const accessiblePlayers = players.filter(player => 
    player.owner === currentUserId || accessiblePlayerIds.has(player.id)
  );

  return (
    <div className="management">

      <div className="management-tabs">
        <button
          className={`management-tab ${activeSection === 'teams' ? 'active' : ''}`}
          onClick={() => setActiveSection('teams')}
        >
          Teams ({teams.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'formations' ? 'active' : ''}`}
          onClick={() => setActiveSection('formations')}
        >
          Formations ({accessibleFormations.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'players' ? 'active' : ''}`}
          onClick={() => setActiveSection('players')}
        >
          Players ({accessiblePlayers.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'sharing' ? 'active' : ''}`}
          onClick={() => setActiveSection('sharing')}
        >
          Sharing
        </button>
        <button
          className={`management-tab ${activeSection === 'app' ? 'active' : ''}`}
          onClick={() => setActiveSection('app')}
        >
          App
        </button>
      </div>

      {activeSection === 'teams' && (
        <div className="management-section">
          {!isCreatingTeam && !editingTeam && (
            <button onClick={() => setIsCreatingTeam(true)} className="btn-primary">
              + Create New Team
            </button>
          )}

          {editingTeam && (
            <div className="create-form">
              <h3>Edit Team</h3>
              <label>
                Team Name *
                <input
                  type="text"
                  placeholder="Enter team name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </label>
              <label>
                Max Players on Field *
                <input
                  type="number"
                  placeholder="Enter max players"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(e.target.value)}
                  min="1"
                />
              </label>
              <label>
                Half Length (minutes) *
                <input
                  type="number"
                  placeholder="Enter half length"
                  value={halfLength}
                  onChange={(e) => setHalfLength(e.target.value)}
                  min="1"
                />
              </label>
              <label>
                Formation
                <select
                  value={selectedFormation}
                  onChange={(e) => setSelectedFormation(e.target.value)}
                >
                  <option value="">Select formation (optional)</option>
                  {accessibleFormations.map((formation) => (
                    <option key={formation.id} value={formation.id}>
                      {formation.name} ({formation.playerCount} players)
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button onClick={handleUpdateTeam} className="btn-primary">
                  Update
                </button>
                <button
                  onClick={handleCancelTeamEdit}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isCreatingTeam && (
            <div className="create-form">
              <h3>Create New Team</h3>
              <label>
                Team Name *
                <input
                  type="text"
                  placeholder="Enter team name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </label>
              <label>
                Max Players on Field *
                <input
                  type="number"
                  placeholder="Enter max players"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(e.target.value)}
                  min="1"
                />
              </label>
              <label>
                Half Length (minutes) *
                <input
                  type="number"
                  placeholder="Enter half length"
                  value={halfLength}
                  onChange={(e) => setHalfLength(e.target.value)}
                  min="1"
                />
              </label>
              <label>
                Formation
                <select
                  value={selectedFormation}
                  onChange={(e) => setSelectedFormation(e.target.value)}
                >
                  <option value="">Select formation (optional)</option>
                  {accessibleFormations.map((formation) => (
                    <option key={formation.id} value={formation.id}>
                      {formation.name} ({formation.playerCount} players)
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button onClick={handleCreateTeam} className="btn-primary">
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsCreatingTeam(false);
                    setTeamName('');
                    setMaxPlayers('7');
                    setHalfLength('25');
                    setSelectedFormation('');
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {teams.length === 0 ? (
              <p className="empty-message">No teams yet. Create your first team!</p>
            ) : (
              teams.map((team) => {
                const teamRosterList = teamRosters.filter(r => r.teamId === team.id);
                const isExpanded = expandedTeamId === team.id;
                
                return (
                  <div key={team.id} className={`team-card-wrapper ${isExpanded ? 'expanded' : ''}`}>
                    <div className="item-card">
                      <div className="item-info">
                        <h3>{team.name}</h3>
                        <p className="item-meta">
                          {team.maxPlayersOnField} players • {team.halfLengthMinutes} min halves
                          {getFormationName(team.formationId) && (
                            <> • Formation: {getFormationName(team.formationId)}</>
                          )}
                        </p>
                        <p className="item-meta">Roster: {teamRosterList.length} player(s)</p>
                      </div>
                      <div className="card-actions">
                        <button
                          onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                          className="btn-edit"
                          aria-label={isExpanded ? "Hide roster" : "Show roster"}
                          title={isExpanded ? "Hide roster" : "Show roster"}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                        <button
                          onClick={() => handleEditTeam(team)}
                          className="btn-edit"
                          aria-label="Edit team"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeleteTeam(team.id)}
                          className="btn-delete"
                          aria-label="Delete team"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="team-roster-section">
                        <h4>Team Roster</h4>
                        
                        {!isAddingRosterPlayer && !editingRoster && (
                          <button 
                            onClick={() => setIsAddingRosterPlayer(true)} 
                            className="btn-secondary" 
                            style={{ marginBottom: '1rem' }}
                          >
                            + Add Player to Roster
                          </button>
                        )}
                        
                        {isAddingRosterPlayer && (
                          <div className="create-form" style={{ marginBottom: '1rem' }}>
                            <h5>Add Player to Roster</h5>
                            <select
                              value={selectedPlayerForRoster}
                              onChange={(e) => setSelectedPlayerForRoster(e.target.value)}
                            >
                              <option value="">Select Player *</option>
                              {players
                                .filter(p => !teamRosterList.some(r => r.playerId === p.id))
                                .map(player => (
                                  <option key={player.id} value={player.id}>
                                    {player.firstName} {player.lastName}
                                  </option>
                                ))}
                            </select>
                            <input
                              type="number"
                              placeholder="Player Number *"
                              value={rosterPlayerNumber}
                              onChange={(e) => setRosterPlayerNumber(e.target.value)}
                              min="1"
                              max="99"
                            />
                            {getTeamFormationPositions(team.id).length > 0 && (
                              <div className="checkbox-group">
                                <label className="group-label">Preferred Positions (optional)</label>
                                {getTeamFormationPositions(team.id).map((position) => (
                                  <label key={position.id} className="checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={rosterPreferredPositions.includes(position.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setRosterPreferredPositions([...rosterPreferredPositions, position.id]);
                                        } else {
                                          setRosterPreferredPositions(rosterPreferredPositions.filter(id => id !== position.id));
                                        }
                                      }}
                                    />
                                    {position.abbreviation} - {position.positionName}
                                  </label>
                                ))}
                              </div>
                            )}
                            <div className="form-actions">
                              <button onClick={() => handleAddPlayerToRoster(team.id)} className="btn-primary">
                                Add
                              </button>
                              <button
                                onClick={() => {
                                  setIsAddingRosterPlayer(false);
                                  setSelectedPlayerForRoster('');
                                  setRosterPlayerNumber('');
                                  setRosterPreferredPositions([]);
                                }}
                                className="btn-secondary"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {editingRoster && editingRoster.teamId === team.id && (
                          <div className="create-form" style={{ marginBottom: '1rem' }}>
                            <h5>Edit Roster Entry</h5>
                            <label>
                              First Name *
                              <input
                                type="text"
                                placeholder="Enter first name"
                                value={editRosterFirstName}
                                onChange={(e) => setEditRosterFirstName(e.target.value)}
                              />
                            </label>
                            <label>
                              Last Name *
                              <input
                                type="text"
                                placeholder="Enter last name"
                                value={editRosterLastName}
                                onChange={(e) => setEditRosterLastName(e.target.value)}
                              />
                            </label>
                            <label>
                              Player Number *
                              <input
                                type="number"
                                placeholder="Player Number"
                                value={rosterPlayerNumber}
                                onChange={(e) => setRosterPlayerNumber(e.target.value)}
                                min="1"
                                max="99"
                              />
                            </label>
                            {getTeamFormationPositions(team.id).length > 0 && (
                              <div className="checkbox-group">
                                <label className="group-label">Preferred Positions (optional)</label>
                                {getTeamFormationPositions(team.id).map((position) => (
                                  <label key={position.id} className="checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={rosterPreferredPositions.includes(position.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setRosterPreferredPositions([...rosterPreferredPositions, position.id]);
                                        } else {
                                          setRosterPreferredPositions(rosterPreferredPositions.filter(id => id !== position.id));
                                        }
                                      }}
                                    />
                                    {position.abbreviation} - {position.positionName}
                                  </label>
                                ))}
                              </div>
                            )}
                            <div className="form-actions">
                              <button onClick={handleUpdateRoster} className="btn-primary">
                                Update
                              </button>
                              <button onClick={handleCancelRosterEdit} className="btn-secondary">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {teamRosterList.length === 0 ? (
                          <p className="empty-message" style={{ fontSize: '0.9em' }}>No players on roster yet.</p>
                        ) : (
                          <div className="roster-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {teamRosterList.map((roster) => {
                              const player = players.find(p => p.id === roster.playerId);
                              if (!player) return null;
                              
                              return (
                                <div key={roster.id} className="roster-item" style={{ 
                                  display: 'flex', 
                                  justifyContent: 'space-between', 
                                  alignItems: 'center',
                                  padding: '0.5rem',
                                  background: '#f5f5f5',
                                  borderRadius: '4px'
                                }}>
                                  <span>
                                    #{roster.playerNumber} {player.firstName} {player.lastName}
                                  </span>
                                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                      onClick={() => handleEditRoster(roster)}
                                      className="btn-edit"
                                      style={{ fontSize: '0.9em' }}
                                      aria-label="Edit roster entry"
                                    >
                                      ✎
                                    </button>
                                    <button
                                      onClick={() => handleRemovePlayerFromRoster(roster.id)}
                                      className="btn-delete"
                                      style={{ fontSize: '0.9em' }}
                                      aria-label="Remove from roster"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeSection === 'formations' && (
        <div className="management-section">
          {!isCreatingFormation && !editingFormation && (
            <button onClick={() => setIsCreatingFormation(true)} className="btn-primary">
              + Create Formation
            </button>
          )}

          {editingFormation && (
            <div className="create-form">
              <h3>Edit Formation</h3>
              <input
                type="text"
                placeholder="Formation Name (e.g., 4-3-3) *"
                value={formationName}
                onChange={(e) => setFormationName(e.target.value)}
              />
              <input
                type="number"
                placeholder="Number of Players on Field *"
                value={playerCount}
                onChange={(e) => setPlayerCount(e.target.value)}
                min="1"
              />
              <div className="form-group">
                <label>Positions</label>
                {formationPositionsList.map((pos, index) => (
                  <div key={index} className="position-row">
                    <input
                      type="text"
                      placeholder="Position Name (e.g., Left Forward)"
                      value={pos.positionName}
                      onChange={(e) => updateFormationPosition(index, 'positionName', e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="text"
                      placeholder="Abbreviation (e.g., LF)"
                      value={pos.abbreviation}
                      onChange={(e) => updateFormationPosition(index, 'abbreviation', e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeFormationPosition(index)}
                      className="btn-delete"
                      style={{ marginLeft: '0.5rem' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addFormationPosition}
                  className="btn-secondary"
                  style={{ marginTop: '0.5rem' }}
                >
                  + Add Position
                </button>
              </div>
              <div className="form-actions">
                <button onClick={handleUpdateFormation} className="btn-primary">
                  Update
                </button>
                <button
                  onClick={handleCancelFormationEdit}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isCreatingFormation && (
            <div className="create-form">
              <h3>Create New Formation</h3>
              <input
                type="text"
                placeholder="Formation Name (e.g., 4-3-3) *"
                value={formationName}
                onChange={(e) => setFormationName(e.target.value)}
              />
              <input
                type="number"
                placeholder="Number of Players on Field *"
                value={playerCount}
                onChange={(e) => setPlayerCount(e.target.value)}
                min="1"
              />
              <div className="form-group">
                <label>Positions</label>
                {formationPositionsList.map((pos, index) => (
                  <div key={index} className="position-row">
                    <input
                      type="text"
                      placeholder="Position Name (e.g., Left Forward)"
                      value={pos.positionName}
                      onChange={(e) => updateFormationPosition(index, 'positionName', e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="text"
                      placeholder="Abbreviation (e.g., LF)"
                      value={pos.abbreviation}
                      onChange={(e) => updateFormationPosition(index, 'abbreviation', e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeFormationPosition(index)}
                      className="btn-delete"
                      style={{ marginLeft: '0.5rem' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addFormationPosition}
                  className="btn-secondary"
                  style={{ marginTop: '0.5rem' }}
                >
                  + Add Position
                </button>
              </div>
              <div className="form-actions">
                <button onClick={handleCreateFormation} className="btn-primary">
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsCreatingFormation(false);
                    setFormationName('');
                    setPlayerCount('');
                    setFormationPositionsList([]);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {accessibleFormations.length === 0 ? (
              <p className="empty-message">No formations yet. Create your first formation!</p>
            ) : (
              accessibleFormations.map((formation) => {
                const formationPositionList = formationPositions.filter(p => p.formationId === formation.id);
                return (
                  <div key={formation.id} className="item-card">
                    <div className="item-info">
                      <h3>{formation.name}</h3>
                      <p className="item-meta">
                        {formation.playerCount} players
                      </p>
                      {formationPositionList.length > 0 && (
                        <p className="item-meta" style={{ marginTop: '0.5rem' }}>
                          Positions: {formationPositionList
                            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
                            .map(p => p.abbreviation)
                            .join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="card-actions">
                      <button
                        onClick={() => handleEditFormation(formation)}
                        className="btn-edit"
                        aria-label="Edit formation"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDeleteFormation(formation.id)}
                        className="btn-delete"
                        aria-label="Delete formation"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeSection === 'players' && (
        <div className="management-section">
          {!isCreatingPlayer && (
            <button onClick={() => setIsCreatingPlayer(true)} className="btn-primary">
              + Add Player
            </button>
          )}

          {isCreatingPlayer && (
            <div className="create-form">
              <h3>Add New Player</h3>
              <input
                type="text"
                placeholder="First Name *"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Last Name *"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
              <p className="form-hint">Players can be assigned to teams in the Team Management section.</p>
              <div className="form-actions">
                <button onClick={handleCreatePlayer} className="btn-primary">
                  Add
                </button>
                <button
                  onClick={() => {
                    setIsCreatingPlayer(false);
                    setFirstName('');
                    setLastName('');
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {accessiblePlayers.length === 0 ? (
              <p className="empty-message">No players yet. Add your first player!</p>
            ) : (
              accessiblePlayers.map((player) => {
                // Get all team rosters for this player
                const playerRosters = teamRosters.filter(r => r.playerId === player.id);
                const teamsList = playerRosters.map(r => {
                  const team = teams.find(t => t.id === r.teamId);
                  return team ? `${team.name} #${r.playerNumber}` : '';
                }).filter(Boolean).join(', ');
                
                return (
                  <div key={player.id} className="item-card">
                    <div className="item-info">
                      <h3>{player.firstName} {player.lastName}</h3>
                      <p className="item-meta">
                        {teamsList || 'Not assigned to any team'}
                      </p>
                    </div>
                    <div className="item-actions">
                      <button
                        onClick={() => handleDeletePlayer(player.id)}
                        className="btn-delete"
                        aria-label="Delete player"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeSection === 'sharing' && (
        <div className="management-section">
          <h2>Sharing & Permissions</h2>
          <p className="section-description">
            Manage who has access to your teams. Invite other coaches to collaborate or add parents for read-only access.
          </p>

          {!sharingResourceType && (
            <div className="sharing-selection">
              <h3>Select a team to share:</h3>
              
              <div className="resource-list">
                {teams.length === 0 ? (
                  <p className="empty-message">No teams yet</p>
                ) : (
                  teams.map((team) => {
                    return (
                      <div key={team.id} className="resource-item">
                        <div className="resource-info">
                          <strong>{team.name}</strong>
                        </div>
                        <button
                          onClick={() => {
                            setSharingResourceType('team');
                            setSharingResourceId(team.id);
                            setSharingResourceName(team.name);
                          }}
                          className="btn-primary"
                        >
                          Manage Sharing
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {sharingResourceType && sharingResourceId && (
            <div className="sharing-details">
              <button
                onClick={() => {
                  setSharingResourceType(null);
                  setSharingResourceId('');
                  setSharingResourceName('');
                }}
                className="btn-secondary"
                style={{ marginBottom: '20px' }}
              >
                ← Back to Selection
              </button>
              
              <InvitationManagement
                type={sharingResourceType}
                resourceId={sharingResourceId}
                resourceName={sharingResourceName}
              />
            </div>
          )}
        </div>
      )}

      {activeSection === 'app' && (
        <div className="management-section">
          <div className="app-info-section">
            <div className="app-info-card">
              <h3>📱 App Information</h3>
              <div className="app-info-item">
                <span className="info-label">Version:</span>
                <span className="info-value">{import.meta.env.VITE_APP_VERSION || '1.0.0'}</span>
              </div>
              <div className="app-info-item">
                <span className="info-label">Build Date:</span>
                <span className="info-value">
                  {import.meta.env.VITE_BUILD_TIMESTAMP 
                    ? new Date(import.meta.env.VITE_BUILD_TIMESTAMP).toLocaleString()
                    : 'Unknown'}
                </span>
              </div>
              <div className="app-info-item">
                <span className="info-label">Source Code:</span>
                <span className="info-value">
                  <a 
                    href="https://github.com/amcol/soccer-app-game-management" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#2e8555', textDecoration: 'underline' }}
                  >
                    GitHub Repository
                  </a>
                </span>
              </div>
            </div>

            <div className="app-info-card">
              <h3>🐛 Report an Issue</h3>
              <p className="info-description">
                Found a bug or have feedback? Let us know so we can improve the app.
              </p>
              <button 
                onClick={() => setShowBugReport(true)} 
                className="btn-primary"
              >
                Report Issue
              </button>
            </div>
          </div>

          {showBugReport && (
            <BugReport onClose={() => setShowBugReport(false)} />
          )}
        </div>
      )}
    </div>
  );
}
