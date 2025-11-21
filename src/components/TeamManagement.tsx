import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { Player, FieldPosition, TeamManagementProps } from "../types";
import { GameList } from "./GameList";
import { GameManagement } from "./GameManagement";

const client = generateClient<Schema>();

type Game = Schema["Game"]["type"];

export function TeamManagement({ team, onBack }: TeamManagementProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [positions, setPositions] = useState<FieldPosition[]>([]);
  const [activeTab, setActiveTab] = useState<"players" | "positions" | "games">("players");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  // Player form state
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [playerNumber, setPlayerNumber] = useState("");
  const [preferredPositions, setPreferredPositions] = useState<string[]>([]);

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
        preferredPosition: preferredPositions.length > 0 ? preferredPositions.join(", ") : undefined,
      });
      setFirstName("");
      setLastName("");
      setPlayerNumber("");
      setPreferredPositions([]);
      setIsAddingPlayer(false);
    } catch (error) {
      console.error("Error adding player:", error);
      alert("Failed to add player");
    }
  };

  const handleEditPlayer = (player: Player) => {
    setEditingPlayer(player);
    setFirstName(player.firstName);
    setLastName(player.lastName);
    setPlayerNumber(player.playerNumber.toString());
    setPreferredPositions(player.preferredPosition ? player.preferredPosition.split(', ') : []);
    setIsAddingPlayer(false);
  };

  const handleUpdatePlayer = async () => {
    if (!editingPlayer) return;
    
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
      await client.models.Player.update({
        id: editingPlayer.id,
        firstName,
        lastName,
        playerNumber: num,
        preferredPosition: preferredPositions.length > 0 ? preferredPositions.join(", ") : undefined,
      });
      setFirstName("");
      setLastName("");
      setPlayerNumber("");
      setPreferredPositions([]);
      setEditingPlayer(null);
    } catch (error) {
      console.error("Error updating player:", error);
      alert("Failed to update player");
    }
  };

  const handleCancelEdit = () => {
    setEditingPlayer(null);
    setFirstName("");
    setLastName("");
    setPlayerNumber("");
    setPreferredPositions([]);
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
          </div>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "games" ? "active" : ""}`}
          onClick={() => setActiveTab("games")}
        >
          Games
        </button>
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
          {!isAddingPlayer && !editingPlayer && (
            <button onClick={() => setIsAddingPlayer(true)} className="btn-primary">
              + Add Player
            </button>
          )}

          {editingPlayer && (
            <div className="create-form">
              <h3 style={{ margin: '0 0 1rem 0' }}>Edit Player</h3>
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
              <div className="form-group">
                <label>Preferred Positions (optional)</label>
                {positions.length === 0 ? (
                  <p className="empty-state" style={{ margin: '0.5rem 0', fontSize: '0.9em' }}>
                    Add positions in the Positions tab first
                  </p>
                ) : (
                  <div className="checkbox-group">
                    {positions.map((position) => (
                      <label key={position.id} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={preferredPositions.includes(position.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPreferredPositions([...preferredPositions, position.id]);
                            } else {
                              setPreferredPositions(preferredPositions.filter(id => id !== position.id));
                            }
                          }}
                        />
                        <span>{position.abbreviation} - {position.positionName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-actions">
                <button onClick={handleUpdatePlayer} className="btn-primary">
                  Update
                </button>
                <button onClick={handleCancelEdit} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
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
              <div className="form-group">
                <label>Preferred Positions (optional)</label>
                {positions.length === 0 ? (
                  <p className="empty-state" style={{ margin: '0.5rem 0', fontSize: '0.9em' }}>
                    Add positions in the Positions tab first
                  </p>
                ) : (
                  <div className="checkbox-group">
                    {positions.map((position) => (
                      <label key={position.id} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={preferredPositions.includes(position.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPreferredPositions([...preferredPositions, position.id]);
                            } else {
                              setPreferredPositions(preferredPositions.filter(id => id !== position.id));
                            }
                          }}
                        />
                        <span>{position.abbreviation} - {position.positionName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
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
            
            {players.map((player) => {
              const preferredPositionNames = player.preferredPosition
                ? player.preferredPosition.split(', ').map(posId => {
                    const pos = positions.find(p => p.id === posId);
                    return pos ? pos.abbreviation : null;
                  }).filter(Boolean).join(', ')
                : '';
              
              return (
                <div key={player.id} className="player-card">
                  <div className="player-number">#{player.playerNumber}</div>
                  <div className="player-info">
                    <h3>{player.firstName} {player.lastName}</h3>
                    {preferredPositionNames && (
                      <p className="player-position">{preferredPositionNames}</p>
                    )}
                  </div>
                  <div className="card-actions">
                    <button
                      onClick={() => handleEditPlayer(player)}
                      className="btn-edit"
                      aria-label="Edit player"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeletePlayer(player.id)}
                      className="btn-delete"
                      aria-label="Delete player"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
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

      {activeTab === "games" && !selectedGame && (
        <GameList 
          teamId={team.id} 
          onGameSelect={(game) => setSelectedGame(game)} 
        />
      )}

      {selectedGame && (
        <GameManagement
          game={selectedGame}
          team={team}
          onBack={() => setSelectedGame(null)}
        />
      )}
    </div>
  );
}
