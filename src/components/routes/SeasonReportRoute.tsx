import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import type { Team } from "../../types/schema";
import { logError } from "../../utils/errorHandler";
import { TeamReport } from "../SeasonReport";

const client = generateClient<Schema>();

/**
 * Route wrapper for /reports and /reports/:teamId
 *
 * - /reports          → loads all teams, shows selector, no report until picked
 * - /reports/:teamId  → pre-selects that team (from state or fetched by ID)
 *
 * A filter pane at the top always lets the user switch between teams.
 */
export function SeasonReportRoute() {
  const { teamId } = useParams<{ teamId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Teams list for the selector
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  // Currently selected team (may come from URL param, location.state, or selector)
  const stateTeam = (location.state as { team?: Team })?.team;
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(stateTeam || null);
  const [teamLoading, setTeamLoading] = useState(!stateTeam && !!teamId);

  // Load all teams for the dropdown
  useEffect(() => {
    async function loadTeams() {
      try {
        const response = await client.models.Team.list();
        const loadedTeams = (response.data || []) as Team[];
        setTeams(loadedTeams);

        // If we have a teamId in the URL but no stateTeam, find it in the list
        if (teamId && !stateTeam) {
          const match = loadedTeams.find((t) => t.id === teamId);
          if (match) {
            setSelectedTeam(match);
            setTeamLoading(false);
          }
          // If not found in list, the separate fetch below will handle it
        }

        // Auto-select if there's only one team and no teamId specified
        if (!teamId && !stateTeam && loadedTeams.length === 1) {
          setSelectedTeam(loadedTeams[0]);
          navigate(`/reports/${loadedTeams[0].id}`, { replace: true });
        }
      } catch (err) {
        logError("SeasonReportRoute.loadTeams", err);
      } finally {
        setTeamsLoading(false);
      }
    }

    loadTeams();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: if teamId is in URL but wasn't found in the teams list, fetch directly
  useEffect(() => {
    if (stateTeam || !teamId || selectedTeam) return;

    async function fetchTeamById() {
      try {
        const id = teamId!;
        const response = await client.models.Team.get({ id });
        if (response.data) {
          setSelectedTeam(response.data as Team);
        }
      } catch (err) {
        logError("SeasonReportRoute.fetchTeamById", err);
      } finally {
        setTeamLoading(false);
      }
    }

    fetchTeamById();
  }, [teamId, stateTeam, selectedTeam]);

  const handleTeamChange = (newTeamId: string) => {
    const team = teams.find((t) => t.id === newTeamId) || null;
    setSelectedTeam(team);
    if (team) {
      navigate(`/reports/${team.id}`, { replace: true });
    } else {
      navigate("/reports", { replace: true });
    }
  };

  if (teamsLoading || teamLoading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="reports-page">
      {/* Team filter pane */}
      <div className="reports-filter-pane">
        <label htmlFor="team-select" className="reports-filter-label">
          📊 Team Reports
        </label>
        <select
          id="team-select"
          className="reports-team-select"
          value={selectedTeam?.id || ""}
          onChange={(e) => handleTeamChange(e.target.value)}
        >
          <option value="">Select a team…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Report content */}
      {selectedTeam ? (
        <TeamReport key={selectedTeam.id} team={selectedTeam} />
      ) : (
        <div className="empty-state">
          {teams.length === 0 ? (
            <>
              <p>No teams found.</p>
              <p>Create a team in the Manage tab to start tracking stats.</p>
            </>
          ) : (
            <p>Select a team above to view their season report.</p>
          )}
        </div>
      )}
    </div>
  );
}
