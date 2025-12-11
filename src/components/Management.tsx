import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

type Season = Schema['Season']['type'];
type Team = Schema['Team']['type'];
type Game = Schema['Game']['type'];

export function Management() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [activeSection, setActiveSection] = useState<'seasons' | 'teams' | 'games'>('seasons');

  // Season form state
  const [isCreatingSeason, setIsCreatingSeason] = useState(false);
  const [newSeasonName, setNewSeasonName] = useState('');
  const [newSeasonYear, setNewSeasonYear] = useState('');

  // Team form state
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [selectedSeasonForTeam, setSelectedSeasonForTeam] = useState('');
  const [teamName, setTeamName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('7');
  const [halfLength, setHalfLength] = useState('25');

  // Game form state
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [selectedTeamForGame, setSelectedTeamForGame] = useState('');
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [isHome, setIsHome] = useState(true);

  useEffect(() => {
    const seasonSub = client.models.Season.observeQuery().subscribe({
      next: (data) => setSeasons([...data.items]),
    });

    const teamSub = client.models.Team.observeQuery().subscribe({
      next: (data) => setTeams([...data.items]),
    });

    const gameSub = client.models.Game.observeQuery().subscribe({
      next: (data) => setGames([...data.items]),
    });

    return () => {
      seasonSub.unsubscribe();
      teamSub.unsubscribe();
      gameSub.unsubscribe();
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
        maxPlayersOnField: maxPlayersNum,
        halfLengthMinutes: halfLengthNum,
      });
      setTeamName('');
      setMaxPlayers('7');
      setHalfLength('25');
      setSelectedSeasonForTeam('');
      setIsCreatingTeam(false);
    } catch (error) {
      console.error('Error creating team:', error);
      alert('Failed to create team');
    }
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

  const handleCreateGame = async () => {
    if (!opponent.trim() || !selectedTeamForGame) {
      alert('Please enter opponent name and select a team');
      return;
    }

    try {
      const gameData: any = {
        teamId: selectedTeamForGame,
        opponent,
        isHome,
      };

      if (gameDate) {
        gameData.gameDate = new Date(gameDate).toISOString();
      }

      await client.models.Game.create(gameData);
      setOpponent('');
      setGameDate('');
      setIsHome(true);
      setSelectedTeamForGame('');
      setIsCreatingGame(false);
    } catch (error) {
      console.error('Error creating game:', error);
      alert('Failed to create game');
    }
  };

  const handleDeleteGame = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this game? This will also delete all lineup assignments, play time records, goals, and notes.')) {
      try {
        await client.models.Game.delete({ id });
      } catch (error) {
        console.error('Error deleting game:', error);
        alert('Failed to delete game');
      }
    }
  };

  const getSeasonName = (seasonId: string) => {
    return seasons.find(s => s.id === seasonId)?.name || 'Unknown Season';
  };

  const getTeamName = (teamId: string) => {
    return teams.find(t => t.id === teamId)?.name || 'Unknown Team';
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'No date set';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getGameStatus = (status: string | null | undefined) => {
    if (!status || status === 'scheduled') return '📅 Scheduled';
    if (status === 'in-progress') return '⚽ In Progress';
    if (status === 'halftime') return '⏸️ Halftime';
    if (status === 'completed') return '✅ Completed';
    return status;
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
          className={`management-tab ${activeSection === 'games' ? 'active' : ''}`}
          onClick={() => setActiveSection('games')}
        >
          Games ({games.length})
        </button>
      </div>

      {activeSection === 'seasons' && (
        <div className="management-section">
          {!isCreatingSeason && (
            <button onClick={() => setIsCreatingSeason(true)} className="btn-primary">
              + Create New Season
            </button>
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
                <div key={season.id} className="item-card">
                  <div className="item-info">
                    <h3>{season.name}</h3>
                    <p>{season.year}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteSeason(season.id)}
                    className="btn-delete"
                    aria-label="Delete season"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeSection === 'teams' && (
        <div className="management-section">
          {!isCreatingTeam && (
            <button onClick={() => setIsCreatingTeam(true)} className="btn-primary">
              + Create New Team
            </button>
          )}

          {isCreatingTeam && (
            <div className="create-form">
              <h3>Create New Team</h3>
              <select
                value={selectedSeasonForTeam}
                onChange={(e) => setSelectedSeasonForTeam(e.target.value)}
              >
                <option value="">Select Season *</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name} ({season.year})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Team Name *"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
              <input
                type="number"
                placeholder="Max Players on Field *"
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(e.target.value)}
                min="1"
              />
              <input
                type="number"
                placeholder="Half Length (minutes) *"
                value={halfLength}
                onChange={(e) => setHalfLength(e.target.value)}
                min="1"
              />
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
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteTeam(team.id)}
                    className="btn-delete"
                    aria-label="Delete team"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeSection === 'games' && (
        <div className="management-section">
          {!isCreatingGame && (
            <button onClick={() => setIsCreatingGame(true)} className="btn-primary">
              + Schedule New Game
            </button>
          )}

          {isCreatingGame && (
            <div className="create-form">
              <h3>Schedule New Game</h3>
              <select
                value={selectedTeamForGame}
                onChange={(e) => setSelectedTeamForGame(e.target.value)}
              >
                <option value="">Select Team *</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({getSeasonName(team.seasonId)})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Opponent Team Name *"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
              />
              <input
                type="datetime-local"
                value={gameDate}
                onChange={(e) => setGameDate(e.target.value)}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={isHome}
                  onChange={(e) => setIsHome(e.target.checked)}
                />
                Home Game
              </label>
              <div className="form-actions">
                <button onClick={handleCreateGame} className="btn-primary">
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsCreatingGame(false);
                    setOpponent('');
                    setGameDate('');
                    setIsHome(true);
                    setSelectedTeamForGame('');
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {games.length === 0 ? (
              <p className="empty-message">No games scheduled yet. Create your first game!</p>
            ) : (
              games.map((game) => (
                <div key={game.id} className="item-card">
                  <div className="item-info">
                    <h3>{getTeamName(game.teamId)} vs {game.opponent}</h3>
                    <p className="item-meta">
                      {getGameStatus(game.status)} • {game.isHome ? '🏠 Home' : '✈️ Away'} • {formatDate(game.gameDate)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteGame(game.id)}
                    className="btn-delete"
                    aria-label="Delete game"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
