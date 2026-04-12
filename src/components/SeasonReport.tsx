import { useEffect, useState, useRef, useMemo } from "react";
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
import { useHelpFab } from "../contexts/HelpFabContext";
import { buildFlatDebugSnapshot } from "../utils/debugUtils";
import type { SeasonReportDebugContext } from "../types/debug";

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
  const { setHelpContext, setDebugContext } = useHelpFab();

  // Register 'season-reports' help context while this screen is mounted.
  // @help-content: season-reports
  useEffect(() => {
    setHelpContext('season-reports');
    return () => setHelpContext(null);
  }, [setHelpContext]);
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

  const seasonReportDebugContext = useMemo((): SeasonReportDebugContext => ({
    teamIdPrefix: team.id.slice(0, 8),
    teamName: team.name,
    rosterSize: teamRosters.length,
    totalGames: allGames.length,
    completedGames: allGames.filter(g => g.status === 'completed').length,
    scheduledGames: allGames.filter(g => g.status === 'scheduled' || !g.status).length,
    allSynced,
    loading,
    playerStatsCount: playerStats.length,
    hasSelectedPlayer: selectedPlayer !== null,
  }), [team, teamRosters, allGames, allSynced, loading, playerStats, selectedPlayer]);

  const seasonReportDebugSnapshot = useMemo(
    () => buildFlatDebugSnapshot('Season Report Debug Snapshot', { ...seasonReportDebugContext }),
    [seasonReportDebugContext]
  );

  useEffect(() => {
    setDebugContext(seasonReportDebugSnapshot);
    return () => setDebugContext(null);
  }, [seasonReportDebugSnapshot, setDebugContext]);

  useEffect(() => {
    trackEvent(AnalyticsEvents.SEASON_REPORT_VIEWED.category, AnalyticsEvents.SEASON_REPORT_VIEWED.action);
  }, []);

  // Phase 2: Once games are loaded, fetch PlayTimeRecords via gameId index query,
  // and fetch Goals/GameNotes via per-game paginated list() calls. This avoids
  // unfiltered observeQuery() scans that can miss records under heavy pagination.
  const gameDataLoadedRef = useRef(false);
  useEffect(() => {
    if (!gamesSynced || allGames.length === 0) return;
    // Reload game-specific data whenever allGames changes
    gameDataLoadedRef.current = false;

    // Paginated list helper for a single gameId
    async function fetchPlayTimeForGame(gameId: string): Promise<PlayTimeRecord[]> {
      const items: PlayTimeRecord[] = [];
      let nextToken: string | null | undefined = undefined;

      type IndexPage = {
        data?: unknown;
        nextToken?: string | null;
        errors?: Array<{ message?: string }>;
      };

      const parseIndexPage = (page: IndexPage): { records: PlayTimeRecord[]; nextToken: string | null | undefined } => {
        if (page.errors && page.errors.length > 0) {
          throw new Error(page.errors[0]?.message ?? 'Failed to fetch PlayTimeRecords by gameId index');
        }

        const extractRecords = (value: unknown): PlayTimeRecord[] => {
          if (!Array.isArray(value)) return [];
          return value.filter((entry): entry is PlayTimeRecord => {
            if (!entry || typeof entry !== 'object') return false;
            const candidate = entry as Partial<PlayTimeRecord>;
            return typeof candidate.gameId === 'string' && typeof candidate.playerId === 'string';
          });
        };

        // Model index call shape: { data: PlayTimeRecord[], nextToken }
        const modelData = extractRecords(page.data);
        if (Array.isArray(page.data)) {
          return { records: modelData, nextToken: page.nextToken };
        }

        // Query call shape can be a JSON string or nested object payload.
        let payload: unknown = page.data;
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload) as unknown;
          } catch {
            payload = null;
          }
        }

        if (!payload || typeof payload !== 'object') {
          return { records: [], nextToken: page.nextToken };
        }

        const payloadObj = payload as Record<string, unknown>;
        const nestedResult = payloadObj.listPlayTimeRecordsByGameId;
        const rootItems = extractRecords(payloadObj.items);
        const rootNextToken = typeof payloadObj.nextToken === 'string' || payloadObj.nextToken === null
          ? payloadObj.nextToken as string | null
          : undefined;

        if (rootItems.length > 0 || Array.isArray(payloadObj.items)) {
          return { records: rootItems, nextToken: rootNextToken ?? page.nextToken };
        }

        if (nestedResult && typeof nestedResult === 'object') {
          const nestedObj = nestedResult as Record<string, unknown>;
          const nestedItems = extractRecords(nestedObj.items);
          const nestedNextToken = typeof nestedObj.nextToken === 'string' || nestedObj.nextToken === null
            ? nestedObj.nextToken as string | null
            : undefined;
          return { records: nestedItems, nextToken: nestedNextToken ?? page.nextToken };
        }

        return { records: [], nextToken: page.nextToken };
      };

      const playTimeModel = client.models.PlayTimeRecord as typeof client.models.PlayTimeRecord & {
        listPlayTimeRecordsByGameId?: (args: {
          gameId: string;
          limit?: number;
          nextToken?: string;
        }) => Promise<IndexPage>;
      };

      const queryApi = client.queries as unknown as {
        listPlayTimeRecordsByGameId?: (args: {
          gameId: string;
          limit?: number;
          nextToken?: string;
        }) => Promise<IndexPage>;
      };

      do {
        const queryArgs: { gameId: string; nextToken?: string; limit?: number } = {
          gameId,
          limit: 1000,
        };
        if (nextToken) queryArgs.nextToken = nextToken;

        let page: IndexPage;
        if (typeof playTimeModel.listPlayTimeRecordsByGameId === 'function') {
          page = await playTimeModel.listPlayTimeRecordsByGameId(queryArgs);
        } else if (typeof queryApi.listPlayTimeRecordsByGameId === 'function') {
          page = await queryApi.listPlayTimeRecordsByGameId(queryArgs);
        } else {
          throw new Error('PlayTimeRecord gameId index query is not available on models or queries client');
        }

        const normalized = parseIndexPage(page);
        if (normalized.records.length > 0) {
          items.push(...normalized.records);
        }
        nextToken = normalized.nextToken;
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

        // Fetch PlayTimeRecords, Goals, and GameNotes for all games in parallel
        const [playTimeResults, goalResults, noteResults] = await Promise.all([
          Promise.all(gameIds.map(fetchPlayTimeForGame)),
          Promise.all(gameIds.map(fetchGoalsForGame)),
          Promise.all(gameIds.map(fetchNotesForGame)),
        ]);

        const allPlayTime = playTimeResults.flat();
        const allGoalsData = goalResults.flat();
        const allNotesData = noteResults.flat();

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

    void loadGameData();

    // Schedule a reload after 2 seconds to catch records missed by
    // eventually consistent DynamoDB Scans. This handles the case where
    // records were written very recently and the initial Scan didn't see them.
    const reloadTimer = setTimeout(() => {
      void loadGameData();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        return { ...r, endGameSeconds: gameEndTime };
      }
      return r;
    });

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
                  <div className="summary-value">{wins}-{losses}-{ties}</div>
                  <div className="summary-sublabel">W - L - T</div>
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
                  <th className="player-name">Player</th>
                  <th>GP</th>
                  <th>Time</th>
                  <th>⚽<span className="col-label"> Goals</span></th>
                  <th>🎯<span className="col-label"> Assists</span></th>
                  <th>⭐<span className="col-label"> Stars</span></th>
                  <th>🟨<span className="col-label"> Yellow</span></th>
                  <th>🟥<span className="col-label"> Red</span></th>
                </tr>
              </thead>
              <tbody>
                {playerStats.map((stat) => (
                  <tr
                    key={stat.player.id}
                    onClick={() => {
                      setSelectedRoster(stat.roster);
                      void loadPlayerDetails(stat.player);
                    }}
                    className={`clickable-row ${selectedPlayer?.id === stat.player.id ? 'selected' : ''}`}
                  >
                    <td className="player-name">
                      {stat.roster.playerNumber !== undefined ? `#${stat.roster.playerNumber} ` : ''}
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
