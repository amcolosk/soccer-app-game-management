import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import type { Game, Team } from "../../types/schema";
import { logError } from "../../utils/errorHandler";
import { GameManagement } from "../GameManagement";
import type { GameTab } from "../GameManagement/TabNav";

const client = generateClient<Schema>();

const VALID_GAME_TABS: GameTab[] = ["plan", "field", "bench", "goals", "notes"];

/**
 * Route wrapper for /game/:gameId
 * 
 * Two-tier loading strategy:
 * 1. From in-app navigation: game + team passed via location.state → instant render
 * 2. From direct URL (bookmark, refresh): fetches Game + Team by ID from DynamoDB
 */
export function GameManagementRoute() {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Capture the requested tab on first render; cleared from URL after mount
  const rawTab = searchParams.get('tab');
  const initialTabRef = useRef<GameTab | undefined>(
    rawTab && VALID_GAME_TABS.includes(rawTab as GameTab) ? (rawTab as GameTab) : undefined
  );

  // Try to get game + team from navigation state (instant, no fetch)
  const stateGame = (location.state as { game?: Game })?.game;
  const stateTeam = (location.state as { team?: Team })?.team;

  const [game, setGame] = useState<Game | null>(stateGame || null);
  const [team, setTeam] = useState<Team | null>(stateTeam || null);
  const [loading, setLoading] = useState(!stateGame || !stateTeam);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Already have data from navigation state
    if (stateGame && stateTeam) return;

    // Fallback: fetch by ID (direct URL, bookmark, refresh)
    async function loadFromUrl() {
      if (!gameId) {
        setError(true);
        setLoading(false);
        return;
      }

      try {
        const gameResponse = await client.models.Game.get({ id: gameId });
        if (!gameResponse.data) {
          setError(true);
          setLoading(false);
          return;
        }

        const fetchedGame = gameResponse.data as Game;
        const teamResponse = await client.models.Team.get({ id: fetchedGame.teamId });
        if (!teamResponse.data) {
          setError(true);
          setLoading(false);
          return;
        }

        setGame(fetchedGame);
        setTeam(teamResponse.data as Team);
        setLoading(false);
      } catch (err) {
        logError("GameManagementRoute.loadFromUrl", err);
        setError(true);
        setLoading(false);
      }
    }

    void loadFromUrl();
  }, [gameId, stateGame, stateTeam]);

  // Clear the tab search param from the URL after mount (one-time deep-link clean-up)
  useEffect(() => {
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('tab'); return n; }, { replace: true });
  }, [setSearchParams]);

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading game...</p>
      </div>
    );
  }

  if (error || !game || !team) {
    return (
      <div className="empty-state">
        <p>Game not found.</p>
        <button onClick={() => navigate("/")} className="btn-primary">
          Back to Games
        </button>
      </div>
    );
  }

  return (
    <GameManagement
      game={game}
      team={team}
      onBack={() => navigate("/")}
      initialTab={initialTabRef.current}
    />
  );
}
