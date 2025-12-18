import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { sortRosterByNumber } from "../utils/playerUtils";
import {
  calculatePlayerPlayTime,
  calculatePlayTimeByPosition,
  formatPlayTime,
  countGamesPlayed,
} from "../utils/playTimeCalculations";
import {
  calculatePlayerGoals,
  calculatePlayerAssists,
  calculatePlayerGoldStars,
  calculatePlayerYellowCards,
  calculatePlayerRedCards,
} from "../utils/gameCalculations";

const client = generateClient<Schema>();

type Team = Schema["Team"]["type"];
type Player = Schema["Player"]["type"];
type TeamRoster = Schema["TeamRoster"]["type"];
type Goal = Schema["Goal"]["type"];
type GameNote = Schema["GameNote"]["type"];
type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];
type Game = Schema["Game"]["type"];
type FormationPosition = Schema["FormationPosition"]["type"];

interface TeamReportProps {
  team: Team;
}

interface PlayerStats {
  player: Player;
  roster: TeamRoster;
  goals: number;
  assists: number;
  goldStars: number;
  yellowCards: number;
  redCards: number;
  totalPlayTimeSeconds: number;
  gamesPlayed: number;
}

interface PlayerDetails {
  player: Player;
  goals: Array<{ game: Game; minute: number; half: number }>;
  assists: Array<{ game: Game; minute: number; half: number }>;
  goldStars: Array<{ game: Game; minute: number; half: number }>;
  yellowCards: Array<{ game: Game; minute: number; half: number }>;
  redCards: Array<{ game: Game; minute: number; half: number }>;
  playTimeByPosition: Map<string, number>;
}

export function TeamReport({ team }: TeamReportProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedRoster, setSelectedRoster] = useState<TeamRoster | null>(null);
  const [playerDetails, setPlayerDetails] = useState<PlayerDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Store full data for details view
  const [allGoals, setAllGoals] = useState<Goal[]>([]);
  const [allNotes, setAllNotes] = useState<GameNote[]>([]);
  const [allPlayTimeRecords, setAllPlayTimeRecords] = useState<PlayTimeRecord[]>([]);
  const [allGames, setAllGames] = useState<Game[]>([]);
  const [allPositions, setAllPositions] = useState<FormationPosition[]>([]);
  const [teamRosters, setTeamRosters] = useState<TeamRoster[]>([]);

  useEffect(() => {
    loadTeamData();
    
    // Subscribe to PlayTimeRecord updates for reactive data
    const playTimeSub = client.models.PlayTimeRecord.observeQuery().subscribe({
      next: (data) => {
        setAllPlayTimeRecords([...data.items]);
        console.log(`[TeamReport] PlayTimeRecords updated: ${data.items.length} records`);
      },
    });

    return () => {
      playTimeSub.unsubscribe();
    };
  }, [team.id]);

  // Recalculate stats when PlayTimeRecords update
  useEffect(() => {
    if (allPlayTimeRecords.length > 0 && teamRosters.length > 0 && players.length > 0 && allGames.length > 0) {
      calculateStats();
    }
  }, [allPlayTimeRecords, teamRosters, players, allGames, allGoals, allNotes]);

  const calculateStats = () => {
    const teamGameIds = new Set(allGames.map(g => g.id));

    const stats: PlayerStats[] = teamRosters.map((roster) => {
      const player = players.find(p => p.id === roster.playerId);
      if (!player) return null;
      
      // Filter data for this team's games only
      const teamGoals = allGoals.filter(g => g && teamGameIds.has(g.gameId));
      const teamNotes = allNotes.filter(n => n && teamGameIds.has(n.gameId));
      const playerPlayTime = allPlayTimeRecords.filter(r => 
        r && r.playerId === player.id && teamGameIds.has(r.gameId)
      );

      // Use utility functions for calculations
      const playerGoalsCount = calculatePlayerGoals(player.id, teamGoals);
      const playerAssistsCount = calculatePlayerAssists(player.id, teamGoals);
      const goldStars = calculatePlayerGoldStars(player.id, teamNotes);
      const yellowCards = calculatePlayerYellowCards(player.id, teamNotes);
      const redCards = calculatePlayerRedCards(player.id, teamNotes);

      // Use shared calculation utility for play time
      const totalPlayTimeSeconds = calculatePlayerPlayTime(player.id, playerPlayTime);

      // Debug: Log play time calculation for Diana Davis
      if (player.firstName === 'Diana' && player.lastName === 'Davis') {
        console.log(`[TeamReport - Stats] Diana Davis play time records (${playerPlayTime.length} records):`,
          playerPlayTime.map(r => ({
            gameId: r.gameId,
            startGameSeconds: r.startGameSeconds,
            endGameSeconds: r.endGameSeconds,
            duration: r.endGameSeconds !== null && r.endGameSeconds !== undefined 
              ? r.endGameSeconds - r.startGameSeconds 
              : 'incomplete'
          }))
        );
        console.log(`[TeamReport - Stats] Total play time: ${totalPlayTimeSeconds}s = ${formatPlayTime(totalPlayTimeSeconds, 'long')}`, );
      }

      // Use shared utility to count games played
      const gamesPlayed = countGamesPlayed(player.id, playerPlayTime);

      return {
        player,
        roster,
        goals: playerGoalsCount,
        assists: playerAssistsCount,
        goldStars,
        yellowCards,
        redCards,
        totalPlayTimeSeconds,
        gamesPlayed,
      };
    }).filter(Boolean) as PlayerStats[];

    // Sort by player number using roster-based sorting
    const sortedRosters = sortRosterByNumber(stats.map(s => s.roster));
    const rosterOrderMap = new Map(sortedRosters.map((r, i) => [r.id, i]));
    stats.sort((a, b) => (rosterOrderMap.get(a.roster.id) || 0) - (rosterOrderMap.get(b.roster.id) || 0));

    setPlayerStats(stats);
  };

  const loadTeamData = async () => {
    setLoading(true);
    try {
      // Load all rosters for this team
      const rostersResponse = await client.models.TeamRoster.list({
        filter: { teamId: { eq: team.id } },
      });
      setTeamRosters(rostersResponse.data);

      // Load all players
      const playersResponse = await client.models.Player.list();
      const playersList = playersResponse.data;
      setPlayers(playersList);

      // Load all goals for this team
      const goalsResponse = await client.models.Goal.list();
      const goals = goalsResponse.data;
      setAllGoals(goals);

      // Load all game notes for this team
      const notesResponse = await client.models.GameNote.list();
      const notes = notesResponse.data;
      setAllNotes(notes);

      // PlayTimeRecords are loaded via observeQuery subscription above

      // Get all games for this team to filter by
      const gamesResponse = await client.models.Game.list({
        filter: { teamId: { eq: team.id } },
      });
      const games = gamesResponse.data;
      setAllGames(games);

      // Load all positions from team's formation
      let formationPositions: FormationPosition[] = [];
      if (team.formationId) {
        const positionsResponse = await client.models.FormationPosition.list({
          filter: { formationId: { eq: team.formationId } },
        });
        formationPositions = positionsResponse.data;
      }
      setAllPositions(formationPositions);

      setLoading(false);
    } catch (error) {
      console.error("Error loading season data:", error);
      alert("Failed to load season report");
      setLoading(false);
    }
  };

  const loadPlayerDetails = async (player: Player) => {
    setLoadingDetails(true);
    setSelectedPlayer(player);

    try {
      const teamGameIds = new Set(allGames.map(g => g.id));
      const teamGoals = allGoals.filter(g => g && teamGameIds.has(g.gameId));
      
      // Get goals scored by this player using utility
      const playerGoalsList = teamGoals.filter(g => g.scorerId === player.id);
      const playerGoals = playerGoalsList
        .map(g => ({
          game: allGames.find(game => game.id === g.gameId)!,
          minute: Math.floor((g.gameSeconds || 0) / 60),
          half: g.half || 1,
        }))
        .sort((a, b) => (a.game.gameDate || '').localeCompare(b.game.gameDate || ''));

      // Get assists by this player using utility
      const playerAssistsList = teamGoals.filter(g => g.assistId === player.id);
      const playerAssists = playerAssistsList
        .map(g => ({
          game: allGames.find(game => game.id === g.gameId)!,
          minute: Math.floor((g.gameSeconds || 0) / 60),
          half: g.half || 1,
        }))
        .sort((a, b) => (a.game.gameDate || '').localeCompare(b.game.gameDate || ''));

      // Get notes for this player
      const teamNotes = allNotes.filter(n => n && teamGameIds.has(n.gameId));
      const playerNotes = teamNotes.filter(n => n.playerId === player.id);

      const goldStars = playerNotes
        .filter(n => n.noteType === 'gold-star')
        .map(n => ({
          game: allGames.find(game => game.id === n.gameId)!,
          minute: Math.floor((n.gameSeconds || 0) / 60),
          half: n.half || 1,
        }))
        .sort((a, b) => (a.game.gameDate || '').localeCompare(b.game.gameDate || ''));

      const yellowCards = playerNotes
        .filter(n => n.noteType === 'yellow-card')
        .map(n => ({
          game: allGames.find(game => game.id === n.gameId)!,
          minute: Math.floor((n.gameSeconds || 0) / 60),
          half: n.half || 1,
        }))
        .sort((a, b) => (a.game.gameDate || '').localeCompare(b.game.gameDate || ''));

      const redCards = playerNotes
        .filter(n => n.noteType === 'red-card')
        .map(n => ({
          game: allGames.find(game => game.id === n.gameId)!,
          minute: Math.floor((n.gameSeconds || 0) / 60),
          half: n.half || 1,
        }))
        .sort((a, b) => (a.game.gameDate || '').localeCompare(b.game.gameDate || ''));

      // Calculate play time by position using shared utility
      const playerPlayTime = allPlayTimeRecords.filter(r => 
        r && r.playerId === player.id && teamGameIds.has(r.gameId)
      );
 
      // Create position map with position names
      const positionsMap = new Map(
        allPositions.map(p => [p.id, { positionName: p.positionName }])
      );

      // Calculate play time by position
      // No need to pass currentGameTime since these are completed games
      const playTimeByPosition = calculatePlayTimeByPosition(
        player.id,
        playerPlayTime,
        positionsMap
      );

      setPlayerDetails({
        player,
        goals: playerGoals,
        assists: playerAssists,
        goldStars,
        yellowCards,
        redCards,
        playTimeByPosition,
      });
    } catch (error) {
      console.error("Error loading player details:", error);
      alert("Failed to load player details");
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className="season-report">
      <div className="report-header">
        <h1>Season Report: {team.name}</h1>
      </div>

      {loading ? (
        <div className="loading-state">Loading season statistics...</div>
      ) : (
        <div className="report-content">
          <div className="report-summary">
            <div className="summary-card">
              <div className="summary-label">Total Players</div>
              <div className="summary-value">{players.length}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Total Goals</div>
              <div className="summary-value">
                {playerStats.reduce((sum, s) => sum + s.goals, 0)}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Total Assists</div>
              <div className="summary-value">
                {playerStats.reduce((sum, s) => sum + s.assists, 0)}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Gold Stars</div>
              <div className="summary-value">
                {playerStats.reduce((sum, s) => sum + s.goldStars, 0)}
              </div>
            </div>
          </div>

          <div className="stats-table-container">
            <table className="stats-table">
              <thead>
                <tr>
                  <th className="player-number-cell">#</th>
                  <th className="player-name">Player</th>
                  <th>Games</th>
                  <th>Play Time</th>
                  <th>⚽ Goals</th>
                  <th>🎯 Assists</th>
                  <th>⭐ Stars</th>
                  <th>🟨 Yellow</th>
                  <th>🟥 Red</th>
                </tr>
              </thead>
              <tbody>
                {playerStats.map((stat) => (
                  <tr 
                    key={stat.player.id}
                    onClick={() => {
                      setSelectedRoster(stat.roster);
                      loadPlayerDetails(stat.player);
                    }}
                    className={`clickable-row ${selectedPlayer?.id === stat.player.id ? 'selected' : ''}`}
                  >
                    <td className="player-number-cell">
                      <div className="player-number">
                        {stat.roster.playerNumber !== undefined ? `#${stat.roster.playerNumber}` : '-'}
                      </div>
                    </td>
                    <td className="player-name">
                      {stat.player.firstName} {stat.player.lastName}
                    </td>
                    <td>{stat.gamesPlayed}</td>
                    <td>{formatPlayTime(stat.totalPlayTimeSeconds, 'long')}</td>
                    <td className="stat-goals">{stat.goals || '-'}</td>
                    <td className="stat-assists">{stat.assists || '-'}</td>
                    <td className="stat-stars">{stat.goldStars || '-'}</td>
                    <td className="stat-yellow">{stat.yellowCards || '-'}</td>
                    <td className="stat-red">{stat.redCards || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {playerStats.length === 0 && (
            <p className="empty-state">No player statistics available yet.</p>
          )}

          {selectedPlayer && (
            <div className="player-details-section">
              <div className="details-header">
                <h2>
                  {selectedPlayer.firstName} {selectedPlayer.lastName} 
                  {selectedRoster?.playerNumber !== undefined && ` #${selectedRoster.playerNumber}`}
                </h2>
                <button onClick={() => setSelectedPlayer(null)} className="btn-secondary">
                  Close Details
                </button>
              </div>

              {loadingDetails ? (
                <div className="loading-state">Loading player details...</div>
              ) : playerDetails ? (
                <div className="details-content">
                  {/* Play Time by Position */}
                  {playerDetails.playTimeByPosition.size > 0 && (
                    <div className="details-card">
                      <h3>⏱️ Play Time by Position</h3>
                      <div className="position-time-list">
                        {Array.from(playerDetails.playTimeByPosition.entries())
                          .sort((a, b) => b[1] - a[1])
                          .map(([position, seconds]) => (
                            <div key={position} className="position-time-item">
                              <span className="position-name">{position}</span>
                              <span className="position-time">{formatPlayTime(seconds, 'long')}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Goals */}
                  {playerDetails.goals.length > 0 && (
                    <div className="details-card">
                      <h3>⚽ Goals ({playerDetails.goals.length})</h3>
                      <div className="event-list">
                        {playerDetails.goals.map((goal, idx) => (
                          <div key={idx} className="event-item">
                            <span className="event-game">
                              vs {goal.game.opponent} ({goal.game.gameDate ? new Date(goal.game.gameDate).toLocaleDateString() : 'N/A'})
                            </span>
                            <span className="event-time">
                              {goal.minute}' (Half {goal.half})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assists */}
                  {playerDetails.assists.length > 0 && (
                    <div className="details-card">
                      <h3>🎯 Assists ({playerDetails.assists.length})</h3>
                      <div className="event-list">
                        {playerDetails.assists.map((assist, idx) => (
                          <div key={idx} className="event-item">
                            <span className="event-game">
                              vs {assist.game.opponent} ({assist.game.gameDate ? new Date(assist.game.gameDate).toLocaleDateString() : 'N/A'})
                            </span>
                            <span className="event-time">
                              {assist.minute}' (Half {assist.half})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Gold Stars */}
                  {playerDetails.goldStars.length > 0 && (
                    <div className="details-card">
                      <h3>⭐ Gold Stars ({playerDetails.goldStars.length})</h3>
                      <div className="event-list">
                        {playerDetails.goldStars.map((star, idx) => (
                          <div key={idx} className="event-item">
                            <span className="event-game">
                              vs {star.game.opponent} ({star.game.gameDate ? new Date(star.game.gameDate).toLocaleDateString() : 'N/A'})
                            </span>
                            <span className="event-time">
                              {star.minute}' (Half {star.half})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Yellow Cards */}
                  {playerDetails.yellowCards.length > 0 && (
                    <div className="details-card">
                      <h3>🟨 Yellow Cards ({playerDetails.yellowCards.length})</h3>
                      <div className="event-list">
                        {playerDetails.yellowCards.map((card, idx) => (
                          <div key={idx} className="event-item">
                            <span className="event-game">
                              vs {card.game.opponent} ({card.game.gameDate ? new Date(card.game.gameDate).toLocaleDateString() : 'N/A'})
                            </span>
                            <span className="event-time">
                              {card.minute}' (Half {card.half})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Red Cards */}
                  {playerDetails.redCards.length > 0 && (
                    <div className="details-card">
                      <h3>🟥 Red Cards ({playerDetails.redCards.length})</h3>
                      <div className="event-list">
                        {playerDetails.redCards.map((card, idx) => (
                          <div key={idx} className="event-item">
                            <span className="event-game">
                              vs {card.game.opponent} ({card.game.gameDate ? new Date(card.game.gameDate).toLocaleDateString() : 'N/A'})
                            </span>
                            <span className="event-time">
                              {card.minute}' (Half {card.half})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
