import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { Team, TeamSelectorProps } from "../types";

const client = generateClient<Schema>();

export function TeamSelector({ seasonId, onTeamSelect, selectedTeam }: TeamSelectorProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("11");
  const [halfLength, setHalfLength] = useState("30");

  useEffect(() => {
    const subscription = client.models.Team.observeQuery({
      filter: { seasonId: { eq: seasonId } },
    }).subscribe({
      next: (data) => setTeams([...data.items]),
    });

    return () => subscription.unsubscribe();
  }, [seasonId]);

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      alert("Please enter a team name");
      return;
    }

    const maxPlayersNum = parseInt(maxPlayers);
    if (isNaN(maxPlayersNum) || maxPlayersNum < 1) {
      alert("Please enter a valid number of players");
      return;
    }

    const halfLengthNum = parseInt(halfLength);
    if (isNaN(halfLengthNum) || halfLengthNum < 1) {
      alert("Please enter a valid half length");
      return;
    }

    try {
      await client.models.Team.create({
        name: teamName,
        seasonId: seasonId,
        maxPlayersOnField: maxPlayersNum,
        halfLengthMinutes: halfLengthNum,
      });
      setTeamName("");
      setMaxPlayers("11");
      setHalfLength("30");
      setIsCreating(false);
    } catch (error) {
      console.error("Error creating team:", error);
      alert("Failed to create team");
    }
  };

  const handleDeleteTeam = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this team? This will also delete all players and positions.")) {
      try {
        await client.models.Team.delete({ id });
      } catch (error) {
        console.error("Error deleting team:", error);
        alert("Failed to delete team");
      }
    }
  };

  return (
    <div className="team-selector">
      <h2>Select a Team</h2>
      
      {!isCreating && (
        <button onClick={() => setIsCreating(true)} className="btn-primary">
          + Create New Team
        </button>
      )}

      {isCreating && (
        <div className="create-form">
          <div className="form-group">
            <label htmlFor="teamName">Team Name</label>
            <input
              id="teamName"
              type="text"
              placeholder="Enter team name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="maxPlayers">Max Players on Field</label>
            <input
              id="maxPlayers"
              type="number"
              placeholder="e.g., 11 for full field"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              min="1"
            />
          </div>
          <div className="form-group">
            <label htmlFor="halfLength">Half Length (minutes)</label>
            <input
              id="halfLength"
              type="number"
              placeholder="e.g., 30 minutes"
              value={halfLength}
              onChange={(e) => setHalfLength(e.target.value)}
              min="1"
            />
          </div>
          <div className="form-actions">
            <button onClick={handleCreateTeam} className="btn-primary">
              Create
            </button>
            <button onClick={() => setIsCreating(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="team-list">
        {teams.length === 0 && !isCreating && (
          <p className="empty-state">No teams yet. Create your first team!</p>
        )}
        
        {teams.map((team) => (
          <div
            key={team.id}
            className={`team-card ${selectedTeam?.id === team.id ? "selected" : ""}`}
            onClick={() => onTeamSelect(team)}
          >
            <div className="team-info">
              <h3>{team.name}</h3>
              <div className="team-details">
                <span>Max Players: {team.maxPlayersOnField}</span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteTeam(team.id);
              }}
              className="btn-delete"
              aria-label="Delete team"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
