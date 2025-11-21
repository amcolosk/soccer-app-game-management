import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { Player, FieldPosition, TeamManagementProps } from "../types";

const client = generateClient<Schema>();

export function TeamManagement({ team, onBack }: TeamManagementProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [positions, setPositions] = useState<FieldPosition[]>([]);
  const [activeTab, setActiveTab] = useState<"players" | "positions">("players");

  // Player form state
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [playerNumber, setPlayerNumber] = useState("");
  const [preferredPosition, setPreferredPosition] = useState("");

  // Position form state
  const [isAddingPosition, setIsAddingPosition] = useState(false);
  const [positionName, setPositionName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [draggedPosition, setDraggedPosition] = useState<FieldPosition | null>(null);

  useEffect(() => {
    const playerSub = client.models.Player.observeQuery({
      filter: { teamId: { eq: team.id } },
    }).subscribe({
      next: (data) => setPlayers([...data.items].sort((a, b) => a.playerNumber - b.playerNumber)),
    });

    const positionSub = client.models.FieldPosition.observeQuery({
      filter: { teamId: { eq: team.id } },
    }).subscribe({
      next: (data) => setPositions([...data.items].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))),
    });

    return () => {
      playerSub.unsubscribe();
      positionSub.unsubscribe();
    };
  }, [team.id]);

  const handleAddPlayer = async () => {
    if (!firstName.trim() || !lastName.trim() || !playerNumber.trim()) {
      alert("Please fill in all required fields");
      return;
    }

    const num = parseInt(playerNumber);
    if (isNaN(num) || num < 0) {
      alert("Please enter a valid player number");
      return;
    }

    try {
      await client.models.Player.create({
        teamId: team.id,
        firstName,
        lastName,
        playerNumber: num,
        preferredPosition: preferredPosition || undefined,
      });
      setFirstName("");
      setLastName("");
      setPlayerNumber("");
      setPreferredPosition("");
      setIsAddingPlayer(false);
    } catch (error) {
      console.error("Error adding player:", error);
      alert("Failed to add player");
    }
  };

  const handleDeletePlayer = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this player?")) {
      try {
        await client.models.Player.delete({ id });
      } catch (error) {
        console.error("Error deleting player:", error);
        alert("Failed to delete player");
      }
    }
  };

  const handleAddPosition = async () => {
    if (!positionName.trim()) {
      alert("Please enter a position name");
      return;
    }

    try {
      const maxOrder = positions.length > 0 ? Math.max(...positions.map(p => p.sortOrder || 0)) : 0;
      await client.models.FieldPosition.create({
        teamId: team.id,
        positionName,
        abbreviation: abbreviation || undefined,
        sortOrder: maxOrder + 1,
      });
      setPositionName("");
      setAbbreviation("");
      setIsAddingPosition(false);
    } catch (error) {
      console.error("Error adding position:", error);
      alert("Failed to add position");
    }
  };

  const handleDragStart = (position: FieldPosition) => {
    setDraggedPosition(position);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (targetPosition: FieldPosition) => {
    if (!draggedPosition || draggedPosition.id === targetPosition.id) {
      setDraggedPosition(null);
      return;
    }

    const draggedIndex = positions.findIndex(p => p.id === draggedPosition.id);
    const targetIndex = positions.findIndex(p => p.id === targetPosition.id);
    
    const newPositions = [...positions];
    newPositions.splice(draggedIndex, 1);
    newPositions.splice(targetIndex, 0, draggedPosition);

    try {
      await Promise.all(
        newPositions.map((pos, index) => 
          client.models.FieldPosition.update({
            id: pos.id,
            sortOrder: index + 1,
          })
        )
      );
    } catch (error) {
      console.error("Error reordering positions:", error);
      alert("Failed to reorder positions");
    }

    setDraggedPosition(null);
  };

  const handleDeletePosition = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this position?")) {
      try {
        await client.models.FieldPosition.delete({ id });
      } catch (error) {
        console.error("Error deleting position:", error);
        alert("Failed to delete position");
      }
    }
  };

  return (
    <div className="team-management">
      <div className="team-header">
        <button onClick={onBack} className="btn-back">
          ← Back
        </button>
        <div className="team-title">
          <h1>{team.name}</h1>
          <div className="team-meta">
            <span>Max Players: {team.maxPlayersOnField}</span>
            {team.formation && <span>Formation: {team.formation}</span>}
          </div>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "players" ? "active" : ""}`}
          onClick={() => setActiveTab("players")}
        >
          Players ({players.length})
        </button>
        <button
          className={`tab ${activeTab === "positions" ? "active" : ""}`}
          onClick={() => setActiveTab("positions")}
        >
          Positions ({positions.length})
        </button>
      </div>

      {activeTab === "players" && (
        <div className="players-section">
          {!isAddingPlayer && (
            <button onClick={() => setIsAddingPlayer(true)} className="btn-primary">
              + Add Player
            </button>
          )}

          {isAddingPlayer && (
            <div className="create-form">
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
              <input
                type="text"
                placeholder="Preferred Position"
                value={preferredPosition}
                onChange={(e) => setPreferredPosition(e.target.value)}
              />
              <div className="form-actions">
                <button onClick={handleAddPlayer} className="btn-primary">
                  Add
                </button>
                <button onClick={() => setIsAddingPlayer(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="player-list">
            {players.length === 0 && !isAddingPlayer && (
              <p className="empty-state">No players yet. Add your first player!</p>
            )}
            
            {players.map((player) => (
              <div key={player.id} className="player-card">
                <div className="player-number">#{player.playerNumber}</div>
                <div className="player-info">
                  <h3>{player.firstName} {player.lastName}</h3>
                  {player.preferredPosition && (
                    <p className="player-position">{player.preferredPosition}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDeletePlayer(player.id)}
                  className="btn-delete"
                  aria-label="Delete player"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "positions" && (
        <div className="positions-section">
          {!isAddingPosition && (
            <button onClick={() => setIsAddingPosition(true)} className="btn-primary">
              + Add Position
            </button>
          )}

          {isAddingPosition && (
            <div className="create-form">
              <input
                type="text"
                placeholder="Position Name *"
                value={positionName}
                onChange={(e) => setPositionName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Abbreviation (e.g., FW, MF, DF)"
                value={abbreviation}
                onChange={(e) => setAbbreviation(e.target.value)}
              />
              <div className="form-actions">
                <button onClick={handleAddPosition} className="btn-primary">
                  Add
                </button>
                <button onClick={() => setIsAddingPosition(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="position-list">
            {positions.length === 0 && !isAddingPosition && (
              <p className="empty-state">No positions yet. Add your first position!</p>
            )}
            {positions.length > 0 && (
              <p className="drag-hint">💡 Drag and drop to reorder positions</p>
            )}
            
            {positions.map((position) => (
              <div 
                key={position.id} 
                className="position-card draggable"
                draggable
                onDragStart={() => handleDragStart(position)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(position)}
              >
                {position.abbreviation && (
                  <div className="position-abbr">{position.abbreviation}</div>
                )}
                <div className="position-info">
                  <h3>{position.positionName}</h3>
                </div>
                <button
                  onClick={() => handleDeletePosition(position.id)}
                  className="btn-delete"
                  aria-label="Delete position"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
