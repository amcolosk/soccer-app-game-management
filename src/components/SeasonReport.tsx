import { useEffect, useState, useRef } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { Team, Player, TeamRoster, Goal, GameNote, PlayTimeRecord, Game } from '../types/schema';
import { handleApiError } from "../utils/errorHandler";
import { trackEvent, AnalyticsEvents } from "../utils/analytics";
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
  calculateRecord,
} from "../utils/gameCalculations";
import { useAmplifyQuery } from "../hooks/useAmplifyQuery";

const client = generateClient<Schema>();

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

  // Phase 1: Subscribe to team-scoped data and simple models
  const { data: teamRosters, isSynced: rostersSynced } = useAmplifyQuery('TeamRoster', {
    filter: { teamId: { eq: team.id } },
  }, [team.id]);
  const { data: players, isSynced: playersSynced } = useAmplifyQuery('Player');
  const { data: allGames, isSynced: gamesSynced } = useAmplifyQuery('Game', {
    filter: { teamId: { eq: team.id } },
  }, [team.id]);
  const { data: allPositions, isSynced: positionsSynced } = useAmplifyQuery('FormationPosition');

  // Track sync status for Phase 2 data (fetched via list(), not observeQuery)
  const [phase2Synced, setPhase2Synced] = useState(false);
  const allSynced = rostersSynced && playersSynced && gamesSynced && positionsSynced && phase2Synced;

  useEffect(() => {
    trackEvent(AnalyticsEvents.SEASON_REPORT_VIEWED.category, AnalyticsEvents.SEASON_REPORT_VIEWED.action);
  }, []);

  // Phase 2: Once games are loaded, fetch PlayTimeRecords, Goals, and GameNotes
  // per-game using paginated list() calls. This avoids the unfiltered observeQuery()
  // which scans the entire table and may miss records due to pagination issues
  // when orphaned records from previous test/game sessions accumulate.
  const gameDataLoadedRef = useRef(false);
  useEffect(() => {
    if (!gamesSynced || allGames.length === 0) return;
    // Reload game-specific data whenever allGames changes
    gameDataLoadedRef.current = false;

    // Paginated list helper for a single gameId
    async function fetchPlayTimeForGame(gameId: string): Promise<PlayTimeRecord[]> {
      const items: PlayTimeRecord[] = [];
      let nextToken: string | null | undefined = undefined;
      do {
        const opts: { filter: { gameId: { eq: string } }; nextToken?: string; limit?: number } = {
          filter: { gameId: { eq: gameId } },
          limit: 1000,
        };
        if (nextToken) opts.nextToken = nextToken;
        const res = await client.models.PlayTimeRecord.list(opts);
        if (res.data) items.push(...res.data);
        nextToken = res.nextToken;
      } while (nextToken);
      return items;
    }

    async function fetchGoalsForGame(gameId: string): Promise<Goal[]> {
      const items: Goal[] = [];
      let nextToken: string | null | undefined = undefined;
      do {
        const opts: { filter: { gameId: { eq: string } }; nextToken?: string; limit?: number } = {
          filter: { gameId: { eq: gameId } },
          limit: 1000,
        };
        if (nextToken) opts.nextToken = nextToken;
        const res = await client.models.Goal.list(opts);
        if (res.data) items.push(...res.data);
        nextToken = res.nextToken;
      } while (nextToken);
      return items;
    }

    async function fetchNotesForGame(gameId: string): Promise<GameNote[]> {
      const items: GameNote[] = [];
      let nextToken: string | null | undefined = undefined;
      do {
        const opts: { filter: { gameId: { eq: string } }; nextToken?: string; limit?: number } = {
          filter: { gameId: { eq: gameId } },
          limit: 1000,
        };
        if (nextToken) opts.nextToken = nextToken;
        const res = await client.models.GameNote.list(opts);
        if (res.data) items.push(...res.data);
        nextToken = res.nextToken;
      } while (nextToken);
      return items;
    }

    const loadGameData = async () => {
      try {
        const gameIds = allGames.map(g => g.id);
        console.log(`[TeamReport] Loading data for ${gameIds.length} games...`);

        // Fetch PlayTimeRecords, Goals, and GameNotes for all games in parallel
        const [playTimeResults, goalResults, noteResults] = await Promise.all([
          Promise.all(gameIds.map(fetchPlayTimeForGame)),
          Promise.all(gameIds.map(fetchGoalsForGame)),
          Promise.all(gameIds.map(fetchNotesForGame)),
        ]);

        const allPlayTime = playTimeResults.flat();
        const allGoalsData = goalResults.flat();
        const allNotesData = noteResults.flat();

        console.log(`[TeamReport] Loaded ${allPlayTime.length} PlayTimeRecords, ${allGoalsData.length} Goals, ${allNotesData.length} Notes`);

        setAllPlayTimeRecords(allPlayTime);
        setAllGoals(allGoalsData);
        setAllNotes(allNotesData);

        setPhase2Synced(true);
        gameDataLoadedRef.current = true;
      } catch (error) {
        handleApiError(error, 'Failed to load game data');
        // Still mark as synced so the UI doesn't hang forever
        setPhase2Synced(true);
      }
    };

    loadGameData();

    // Schedule a reload after 2 seconds to catch records missed by
    // eventually consistent DynamoDB Scans. This handles the case where
    // records were written very recently and the initial Scan didn't see them.
    const reloadTimer = setTimeout(() => {
      console.log('[TeamReport] Reloading game data (eventual consistency retry)...');
      loadGameData();
    }, 2000);

    return () => clearTimeout(reloadTimer);
  }, [gamesSynced, allGames]);

  // Recalculate stats only after ALL subscriptions have fully synced
  // This prevents showing incorrect stats from partial observeQuery page loads
  useEffect(() => {
    if (allSynced) {
      setLoading(false);
      if (teamRosters.length > 0 && players.length > 0 && allGames.length > 0) {
        calculateStats();
      }
    }
  }, [allSynced, allPlayTimeRecords, teamRosters, players, allGames, allGoals, allNotes]);

  const calculateStats = () => {
    const teamGameIds = new Set(allGames.map(g => g.id));
    
    // Build a map of gameId → elapsedSeconds for completed games.
    // This is used as a safety net: if closeActivePlayTimeRecords missed closing
    // some records (e.g., due to DynamoDB Scan pagination without a GSI on gameId),
    // we can still calculate correct play time for completed games.
    const completedGameEndTimes = new Map<string, number>();
    allGames.forEach(g => {
      if (g.status === 'completed' && g.elapsedSeconds != null) {
        completedGameEndTimes.set(g.id, g.elapsedSeconds);
      }
    });
    
    // Fix up any unclosed records in completed games before calculating stats.
    // This handles the case where closeActivePlayTimeRecords didn't find all records
    // during the DynamoDB Scan (no GSI on gameId, eventually consistent reads).
    const fixedPlayTimeRecords = allPlayTimeRecords.map(r => {
      if ((r.endGameSeconds === null || r.endGameSeconds === undefined) && completedGameEndTimes.has(r.gameId)) {
        const gameEndTime = completedGameEndTimes.get(r.gameId)!;
        console.log(`[TeamReport] Fixing unclosed record for player ${r.playerId} in completed game: setting endGameSeconds to ${gameEndTime}`);
        return { ...r, endGameSeconds: gameEndTime };
      }
      return r;
    });
    
    // DEBUG: Log all games and their IDs
    console.log(`[TeamReport DEBUG] Team games (${allGames.length}):`, 
      allGames.map(g => ({ id: g.id, opponent: g.opponent, status: g.status }))
    );
    
    // DEBUG: Log ALL PlayTimeRecords for this team's games
    const teamPlayTimeRecords = fixedPlayTimeRecords.filter(r => teamGameIds.has(r.gameId));
    console.log(`[TeamReport DEBUG] All PlayTimeRecords for team games (${teamPlayTimeRecords.length} records):`,
      teamPlayTimeRecords.map(r => ({
        id: r.id,
        gameId: r.gameId,
        playerId: r.playerId,
        start: r.startGameSeconds,
        end: r.endGameSeconds,
        duration: r.endGameSeconds != null ? r.endGameSeconds - r.startGameSeconds : 'active'
      }))
    );
    
    // DEBUG: Group records by game to see distribution
    const recordsByGame = new Map<string, number>();
    teamPlayTimeRecords.forEach(r => {
      recordsByGame.set(r.gameId, (recordsByGame.get(r.gameId) || 0) + 1);
    });
    console.log(`[TeamReport DEBUG] Records per game:`, Object.fromEntries(recordsByGame));

    const stats: PlayerStats[] = teamRosters.map((roster) => {
      const player = players.find(p => p.id === roster.playerId);
      if (!player) return null;
      
      // Filter data for this team's games only
      const teamGoals = allGoals.filter(g => g && teamGameIds.has(g.gameId));
      const teamNotes = allNotes.filter(n => n && teamGameIds.has(n.gameId));
      const playerPlayTime = fixedPlayTimeRecords.filter(r => 
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
        console.log(`[TeamReport - Stats] Diana Total play time: ${totalPlayTimeSeconds}s = ${formatPlayTime(totalPlayTimeSeconds, 'long')}`);
      }
      
      // Debug: Log play time calculation for Hannah Harris
      if (player.firstName === 'Hannah' && player.lastName === 'Harris') {
        console.log(`[TeamReport - Stats] Hannah Harris play time records (${playerPlayTime.length} records):`,
          playerPlayTime.map(r => ({
            gameId: r.gameId,
            startGameSeconds: r.startGameSeconds,
            endGameSeconds: r.endGameSeconds,
            duration: r.endGameSeconds !== null && r.endGameSeconds !== undefined 
              ? r.endGameSeconds - r.startGameSeconds 
              : 'incomplete'
          }))
        );
        console.log(`[TeamReport - Stats] Hannah Total play time: ${totalPlayTimeSeconds}s = ${formatPlayTime(totalPlayTimeSeconds, 'long')}`);
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
      // Fix up unclosed records for completed games (same as calculateStats)
      const completedGameEndTimes = new Map<string, number>();
      allGames.forEach(g => {
        if (g.status === 'completed' && g.elapsedSeconds != null) {
          completedGameEndTimes.set(g.id, g.elapsedSeconds);
        }
      });
      const playerPlayTime = allPlayTimeRecords
        .filter(r => r && r.playerId === player.id && teamGameIds.has(r.gameId))
        .map(r => {
          if ((r.endGameSeconds === null || r.endGameSeconds === undefined) && completedGameEndTimes.has(r.gameId)) {
            return { ...r, endGameSeconds: completedGameEndTimes.get(r.gameId)! };
          }
          return r;
        });
 
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
      handleApiError(error, 'Failed to load player details');
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
            {(() => {
              const { wins, losses, ties } = calculateRecord(allGames);
              return (
                <div className="summary-card">
                  <div className="summary-label">Record</div>
                  <div className="summary-value">{wins}W - {losses}L - {ties}T</div>
                </div>
              );
            })()}
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
