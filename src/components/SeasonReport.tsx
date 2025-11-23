import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Team = Schema["Team"]["type"];
type Player = Schema["Player"]["type"];
type Goal = Schema["Goal"]["type"];
type GameNote = Schema["GameNote"]["type"];
type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];

interface SeasonReportProps {
  team: Team;
  onBack: () => void;
}

interface PlayerStats {
  player: Player;
  goals: number;
  assists: number;
  goldStars: number;
  yellowCards: number;
  redCards: number;
  totalPlayTimeSeconds: number;
  gamesPlayed: number;
}

export function SeasonReport({ team, onBack }: SeasonReportProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSeasonData();
  }, [team.id]);

  const loadSeasonData = async () => {
    setLoading(true);
    try {
      // Load all players for this team
      const playersResponse = await client.models.Player.list({
        filter: { teamId: { eq: team.id } },
      });
      const playersList = playersResponse.data;
      setPlayers(playersList);

      // Load all goals for this team
      const goalsResponse = await client.models.Goal.list();
      const goals = goalsResponse.data;

      // Load all game notes for this team
      const notesResponse = await client.models.GameNote.list();
      const notes = notesResponse.data;

      // Load all play time records for this team
      const playTimeResponse = await client.models.PlayTimeRecord.list();
      const playTimeRecords = playTimeResponse.data;

      // Get all games for this team to filter by
      const gamesResponse = await client.models.Game.list({
        filter: { teamId: { eq: team.id } },
      });
      const teamGameIds = new Set(gamesResponse.data.map(g => g.id));

      // Calculate stats for each player
      const stats: PlayerStats[] = playersList.map(player => {
        // Filter data for this player and this team's games
        const playerGoals = goals.filter(g => 
          g.scorerId === player.id && teamGameIds.has(g.gameId)
        );
        const playerAssists = goals.filter(g => 
          g.assistId === player.id && teamGameIds.has(g.gameId)
        );
        const playerNotes = notes.filter(n => 
          n.playerId === player.id && teamGameIds.has(n.gameId)
        );
        const playerPlayTime = playTimeRecords.filter(r => 
          r.playerId === player.id && teamGameIds.has(r.gameId)
        );

        // Count note types
        const goldStars = playerNotes.filter(n => n.noteType === 'gold-star').length;
        const yellowCards = playerNotes.filter(n => n.noteType === 'yellow-card').length;
        const redCards = playerNotes.filter(n => n.noteType === 'red-card').length;

        // Calculate total play time
        const totalPlayTimeSeconds = playerPlayTime.reduce((total, record) => {
          if (record.durationSeconds) {
            return total + record.durationSeconds;
          } else if (record.startTime && !record.endTime) {
            // Currently playing - calculate from start to now
            const startTime = new Date(record.startTime).getTime();
            const now = Date.now();
            return total + Math.floor((now - startTime) / 1000);
          }
          return total;
        }, 0);

        // Count unique games played
        const gamesPlayed = new Set(playerPlayTime.map(r => r.gameId)).size;

        return {
          player,
          goals: playerGoals.length,
          assists: playerAssists.length,
          goldStars,
          yellowCards,
          redCards,
          totalPlayTimeSeconds,
          gamesPlayed,
        };
      });

      // Sort by player number
      stats.sort((a, b) => (a.player.playerNumber || 0) - (b.player.playerNumber || 0));
      setPlayerStats(stats);
    } catch (error) {
      console.error("Error loading season data:", error);
      alert("Failed to load season report");
    } finally {
      setLoading(false);
    }
  };

  const formatPlayTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="season-report">
      <div className="report-header">
        <button onClick={onBack} className="btn-back">
          ← Back
        </button>
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
                  <th>#</th>
                  <th>Player</th>
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
                  <tr key={stat.player.id}>
                    <td className="player-number">
                      {stat.player.playerNumber !== undefined ? `#${stat.player.playerNumber}` : '-'}
                    </td>
                    <td className="player-name">
                      {stat.player.firstName} {stat.player.lastName}
                    </td>
                    <td>{stat.gamesPlayed}</td>
                    <td>{formatPlayTime(stat.totalPlayTimeSeconds)}</td>
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
        </div>
      )}
    </div>
  );
}
