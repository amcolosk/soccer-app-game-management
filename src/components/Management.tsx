import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import { BugReport } from './BugReport';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

type Season = Schema['Season']['type'];
type Team = Schema['Team']['type'];
type Player = Schema['Player']['type'];
type FieldPosition = Schema['FieldPosition']['type'];
type Formation = Schema['Formation']['type'];
type FormationPosition = Schema['FormationPosition']['type'];

export function Management() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [positions, setPositions] = useState<FieldPosition[]>([]);
  const [formations, setFormations] = useState<Formation[]>([]);
  const [formationPositions, setFormationPositions] = useState<FormationPosition[]>([]);
  const [activeSection, setActiveSection] = useState<'seasons' | 'teams' | 'formations' | 'players' | 'app'>('seasons');
  const [showBugReport, setShowBugReport] = useState(false);

  // Season form state
  const [isCreatingSeason, setIsCreatingSeason] = useState(false);
  const [editingSeason, setEditingSeason] = useState<Season | null>(null);
  const [newSeasonName, setNewSeasonName] = useState('');
  const [newSeasonYear, setNewSeasonYear] = useState('');
  const [isArchived, setIsArchived] = useState(false);

  // Team form state
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [selectedSeasonForTeam, setSelectedSeasonForTeam] = useState('');
  const [teamName, setTeamName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('7');
  const [halfLength, setHalfLength] = useState('25');
  const [selectedFormation, setSelectedFormation] = useState('');

  // Formation form state
  const [isCreatingFormation, setIsCreatingFormation] = useState(false);
  const [editingFormation, setEditingFormation] = useState<Formation | null>(null);
  const [formationName, setFormationName] = useState('');
  const [playerCount, setPlayerCount] = useState('');
  const [formationPositionsList, setFormationPositionsList] = useState<Array<{ positionName: string; abbreviation: string }>>([]);

  // Player form state
  const [isCreatingPlayer, setIsCreatingPlayer] = useState(false);
  const [selectedTeamForPlayer, setSelectedTeamForPlayer] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [playerNumber, setPlayerNumber] = useState('');
  const [preferredPosition, setPreferredPosition] = useState('');

  useEffect(() => {
    const seasonSub = client.models.Season.observeQuery().subscribe({
      next: (data) => setSeasons([...data.items]),
    });

    const teamSub = client.models.Team.observeQuery().subscribe({
      next: (data) => setTeams([...data.items]),
    });

    const playerSub = client.models.Player.observeQuery().subscribe({
      next: (data) => setPlayers([...data.items]),
    });

    const positionSub = client.models.FieldPosition.observeQuery().subscribe({
      next: (data) => setPositions([...data.items]),
    });

    const formationSub = client.models.Formation.observeQuery().subscribe({
      next: (data) => setFormations([...data.items]),
    });

    const formationPositionSub = client.models.FormationPosition.observeQuery().subscribe({
      next: (data) => setFormationPositions([...data.items]),
    });

    return () => {
      seasonSub.unsubscribe();
      teamSub.unsubscribe();
      playerSub.unsubscribe();
      positionSub.unsubscribe();
      formationSub.unsubscribe();
      formationPositionSub.unsubscribe();
    };
  }, []);

  const handleCreateSeason = async () => {
    if (!newSeasonName.trim() || !newSeasonYear.trim()) {
      alert('Please enter both season name and year');
      return;
    }

    try {
      await client.models.Season.create({
        name: newSeasonName,
        year: newSeasonYear,
      });
      setNewSeasonName('');
      setNewSeasonYear('');
      setIsCreatingSeason(false);
    } catch (error) {
      console.error('Error creating season:', error);
      alert('Failed to create season');
    }
  };

  const handleEditSeason = (season: Season) => {
    setEditingSeason(season);
    setNewSeasonName(season.name);
    setNewSeasonYear(season.year);
    setIsArchived(season.isArchived || false);
    setIsCreatingSeason(false);
  };

  const handleUpdateSeason = async () => {
    if (!editingSeason) return;
    
    if (!newSeasonName.trim() || !newSeasonYear.trim()) {
      alert('Please enter both season name and year');
      return;
    }

    try {
      await client.models.Season.update({
        id: editingSeason.id,
        name: newSeasonName,
        year: newSeasonYear,
        isArchived: isArchived,
      });
      setNewSeasonName('');
      setNewSeasonYear('');
      setIsArchived(false);
      setEditingSeason(null);
    } catch (error) {
      console.error('Error updating season:', error);
      alert('Failed to update season');
    }
  };

  const handleCancelSeasonEdit = () => {
    setEditingSeason(null);
    setNewSeasonName('');
    setNewSeasonYear('');
    setIsArchived(false);
  };

  const handleDeleteSeason = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this season? This will also delete all teams, players, and games associated with it.')) {
      try {
        await client.models.Season.delete({ id });
      } catch (error) {
        console.error('Error deleting season:', error);
        alert('Failed to delete season');
      }
    }
  };

  const handleCreateTeam = async () => {
    if (!teamName.trim() || !selectedSeasonForTeam) {
      alert('Please enter team name and select a season');
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
        seasonId: selectedSeasonForTeam,
        formationId: selectedFormation || undefined,
        maxPlayersOnField: maxPlayersNum,
        halfLengthMinutes: halfLengthNum,
      });
      setTeamName('');
      setMaxPlayers('7');
      setHalfLength('25');
      setSelectedFormation('');
      setSelectedSeasonForTeam('');
      setIsCreatingTeam(false);
    } catch (error) {
      console.error('Error creating team:', error);
      alert('Failed to create team');
    }
  };

  const handleEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamName(team.name);
    setSelectedSeasonForTeam(team.seasonId);
    setMaxPlayers(team.maxPlayersOnField.toString());
    setHalfLength(team.halfLengthMinutes.toString());
    setSelectedFormation(team.formationId || '');
    setIsCreatingTeam(false);
  };

  const handleUpdateTeam = async () => {
    if (!editingTeam) return;

    if (!teamName.trim() || !selectedSeasonForTeam) {
      alert('Please enter team name and select a season');
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
        seasonId: selectedSeasonForTeam,
        formationId: selectedFormation || undefined,
        maxPlayersOnField: maxPlayersNum,
        halfLengthMinutes: halfLengthNum,
      });
      setTeamName('');
      setMaxPlayers('7');
      setHalfLength('25');
      setSelectedFormation('');
      setSelectedSeasonForTeam('');
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
    setSelectedSeasonForTeam('');
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

  const getSeasonName = (seasonId: string) => {
    return seasons.find(s => s.id === seasonId)?.name || 'Unknown Season';
  };

  const getTeamName = (teamId: string) => {
    return teams.find(t => t.id === teamId)?.name || 'Unknown Team';
  };

  const handleCreatePlayer = async () => {
    if (!selectedTeamForPlayer) {
      alert('Please select a team');
      return;
    }

    if (!firstName.trim() || !lastName.trim() || !playerNumber.trim()) {
      alert('Please enter first name, last name, and player number');
      return;
    }

    try {
      await client.models.Player.create({
        teamId: selectedTeamForPlayer,
        firstName,
        lastName,
        playerNumber: parseInt(playerNumber),
        preferredPosition: preferredPosition || undefined,
      });
      setFirstName('');
      setLastName('');
      setPlayerNumber('');
      setPreferredPosition('');
      setSelectedTeamForPlayer('');
      setIsCreatingPlayer(false);
    } catch (error) {
      console.error('Error creating player:', error);
      alert('Failed to create player');
    }
  };

  const handleDeletePlayer = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this player?')) {
      try {
        await client.models.Player.delete({ id });
      } catch (error) {
        console.error('Error deleting player:', error);
        alert('Failed to delete player');
      }
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

  const getPositionName = (positionId: string) => {
    const position = positions.find(p => p.id === positionId);
    return position ? position.abbreviation || position.positionName : '';
  };

  const getFormationName = (formationId: string | null | undefined) => {
    if (!formationId) return null;
    return formations.find(f => f.id === formationId)?.name || null;
  };

  return (
    <div className="management">
      <h2>⚙️ Management</h2>

      <div className="management-tabs">
        <button
          className={`management-tab ${activeSection === 'seasons' ? 'active' : ''}`}
          onClick={() => setActiveSection('seasons')}
        >
          Seasons ({seasons.length})
        </button>
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
          Formations ({formations.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'players' ? 'active' : ''}`}
          onClick={() => setActiveSection('players')}
        >
          Players ({players.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'app' ? 'active' : ''}`}
          onClick={() => setActiveSection('app')}
        >
          App
        </button>
      </div>

      {activeSection === 'seasons' && (
        <div className="management-section">
          {!isCreatingSeason && !editingSeason && (
            <button onClick={() => setIsCreatingSeason(true)} className="btn-primary">
              + Create New Season
            </button>
          )}

          {editingSeason && (
            <div className="create-form">
              <h3>Edit Season</h3>
              <input
                type="text"
                placeholder="Season Name (e.g., Fall League)"
                value={newSeasonName}
                onChange={(e) => setNewSeasonName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Year (e.g., 2025)"
                value={newSeasonYear}
                onChange={(e) => setNewSeasonYear(e.target.value)}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={isArchived}
                  onChange={(e) => setIsArchived(e.target.checked)}
                />
                <span>Archive this season (completed seasons)</span>
              </label>
              <div className="form-actions">
                <button onClick={handleUpdateSeason} className="btn-primary">
                  Update
                </button>
                <button onClick={handleCancelSeasonEdit} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isCreatingSeason && (
            <div className="create-form">
              <h3>Create New Season</h3>
              <input
                type="text"
                placeholder="Season Name (e.g., Fall League)"
                value={newSeasonName}
                onChange={(e) => setNewSeasonName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Year (e.g., 2025)"
                value={newSeasonYear}
                onChange={(e) => setNewSeasonYear(e.target.value)}
              />
              <div className="form-actions">
                <button onClick={handleCreateSeason} className="btn-primary">
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsCreatingSeason(false);
                    setNewSeasonName('');
                    setNewSeasonYear('');
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {seasons.length === 0 ? (
              <p className="empty-message">No seasons yet. Create your first season to get started!</p>
            ) : (
              seasons.map((season) => (
                <div key={season.id} className={`item-card ${season.isArchived ? 'archived' : ''}`}>
                  <div className="item-info">
                    <h3>
                      {season.name}
                      {season.isArchived && <span className="archive-badge">📦 Archived</span>}
                    </h3>
                    <p>{season.year}</p>
                  </div>
                  <div className="card-actions">
                    <button
                      onClick={() => handleEditSeason(season)}
                      className="btn-edit"
                      aria-label="Edit season"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeleteSeason(season.id)}
                      className="btn-delete"
                      aria-label="Delete season"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

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
                Season *
                <select
                  value={selectedSeasonForTeam}
                  onChange={(e) => setSelectedSeasonForTeam(e.target.value)}
                >
                  <option value="">Select Season</option>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name} ({season.year})
                    </option>
                  ))}
                </select>
              </label>
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
                  {formations.map((formation) => (
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
                Season *
                <select
                  value={selectedSeasonForTeam}
                  onChange={(e) => setSelectedSeasonForTeam(e.target.value)}
                >
                  <option value="">Select Season</option>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name} ({season.year})
                    </option>
                  ))}
                </select>
              </label>
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
                  {formations.map((formation) => (
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
                    setSelectedSeasonForTeam('');
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
              teams.map((team) => (
                <div key={team.id} className="item-card">
                  <div className="item-info">
                    <h3>{team.name}</h3>
                    <p className="item-meta">
                      {getSeasonName(team.seasonId)} • {team.maxPlayersOnField} players • {team.halfLengthMinutes} min halves
                      {getFormationName(team.formationId) && (
                        <> • Formation: {getFormationName(team.formationId)}</>
                      )}
                    </p>
                  </div>
                  <div className="card-actions">
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
              ))
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
            {formations.length === 0 ? (
              <p className="empty-message">No formations yet. Create your first formation!</p>
            ) : (
              formations.map((formation) => {
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
              <select
                value={selectedTeamForPlayer}
                onChange={(e) => {
                  setSelectedTeamForPlayer(e.target.value);
                  // Clear preferred position when team changes
                  setPreferredPosition('');
                }}
              >
                <option value="">Select Team *</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
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
              <input
                type="number"
                placeholder="Player Number *"
                value={playerNumber}
                onChange={(e) => setPlayerNumber(e.target.value)}
                min="0"
              />
              {selectedTeamForPlayer && positions.filter(p => p.teamId === selectedTeamForPlayer).length > 0 && (
                <select
                  value={preferredPosition}
                  onChange={(e) => setPreferredPosition(e.target.value)}
                >
                  <option value="">Preferred Position (optional)</option>
                  {positions
                    .filter(p => p.teamId === selectedTeamForPlayer)
                    .map((position) => (
                      <option key={position.id} value={position.id}>
                        {position.abbreviation} - {position.positionName}
                      </option>
                    ))}
                </select>
              )}
              <div className="form-actions">
                <button onClick={handleCreatePlayer} className="btn-primary">
                  Add
                </button>
                <button
                  onClick={() => {
                    setIsCreatingPlayer(false);
                    setFirstName('');
                    setLastName('');
                    setPlayerNumber('');
                    setPreferredPosition('');
                    setSelectedTeamForPlayer('');
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {players.length === 0 ? (
              <p className="empty-message">No players yet. Add your first player!</p>
            ) : (
              players.map((player) => (
                <div key={player.id} className="item-card">
                  <div className="item-info">
                    <h3>#{player.playerNumber} {player.firstName} {player.lastName}</h3>
                    <p className="item-meta">
                      {getTeamName(player.teamId)}
                      {player.preferredPosition && (
                        <> • Preferred: {getPositionName(player.preferredPosition)}</>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeletePlayer(player.id)}
                    className="btn-delete"
                    aria-label="Delete player"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
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
                <span className="info-label">Name:</span>
                <span className="info-value">TeamTrack</span>
              </div>
              <div className="app-info-item">
                <span className="info-label">Description:</span>
                <span className="info-value">Game Management for Coaches</span>
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
