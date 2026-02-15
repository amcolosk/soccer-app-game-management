import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import type { Game, Team } from "../../types/schema";
import { logError } from "../../utils/errorHandler";
import { GamePlanner } from "../GamePlanner";

const client = generateClient<Schema>();

/**
 * Route wrapper for /game/:gameId/plan
 * 
 * Two-tier loading strategy:
 * 1. From in-app navigation: game + team passed via location.state → instant render
 * 2. From direct URL (bookmark, refresh): fetches Game + Team by ID from DynamoDB
 */
export function GamePlannerRoute() {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const stateGame = (location.state as { game?: Game })?.game;
  const stateTeam = (location.state as { team?: Team })?.team;

  const [game, setGame] = useState<Game | null>(stateGame || null);
  const [team, setTeam] = useState<Team | null>(stateTeam || null);
  const [loading, setLoading] = useState(!stateGame || !stateTeam);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (stateGame && stateTeam) return;

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
        logError("GamePlannerRoute.loadFromUrl", err);
        setError(true);
        setLoading(false);
      }
    }

    loadFromUrl();
  }, [gameId, stateGame, stateTeam]);

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading game plan...</p>
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
    <GamePlanner
      game={game}
      team={team}
      onBack={() => navigate("/")}
    />
  );
}
