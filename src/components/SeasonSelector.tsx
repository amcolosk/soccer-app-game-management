import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import { getCurrentUser } from "aws-amplify/auth";
import type { Schema } from "../../amplify/data/resource";
import type { Season, SeasonSelectorProps } from "../types";

const client = generateClient<Schema>();

export function SeasonSelector({ onSeasonSelect, selectedSeason }: SeasonSelectorProps) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newSeasonName, setNewSeasonName] = useState("");
  const [newSeasonYear, setNewSeasonYear] = useState("");

  useEffect(() => {
    const subscription = client.models.Season.observeQuery().subscribe({
      next: (data) => setSeasons([...data.items]),
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleCreateSeason = async () => {
    if (!newSeasonName.trim() || !newSeasonYear.trim()) {
      alert("Please enter both season name and year");
      return;
    }

    try {
      const user = await getCurrentUser();
      await client.models.Season.create({
        name: newSeasonName,
        year: newSeasonYear,
        ownerId: user.userId,
      });
      setNewSeasonName("");
      setNewSeasonYear("");
      setIsCreating(false);
    } catch (error) {
      console.error("Error creating season:", error);
      alert("Failed to create season");
    }
  };

  const handleDeleteSeason = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this season?")) {
      try {
        await client.models.Season.delete({ id });
      } catch (error) {
        console.error("Error deleting season:", error);
        alert("Failed to delete season");
      }
    }
  };

  return (
    <div className="season-selector">
      <h2>Select a Season</h2>
      
      {!isCreating && (
        <button onClick={() => setIsCreating(true)} className="btn-primary">
          + Create New Season
        </button>
      )}

      {isCreating && (
        <div className="create-form">
          <input
            type="text"
            placeholder="Season Name (e.g., Fall League)"
            value={newSeasonName}
            onChange={(e) => setNewSeasonName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Year (e.g., 2025)"
            value={newSeasonYear}
            onChange={(e) => setNewSeasonYear(e.target.value)}
          />
          <div className="form-actions">
            <button onClick={handleCreateSeason} className="btn-primary">
              Create
            </button>
            <button onClick={() => setIsCreating(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="season-list">
        {seasons.length === 0 && !isCreating && (
          <p className="empty-state">No seasons yet. Create your first season!</p>
        )}
        
        {seasons.map((season) => (
          <div
            key={season.id}
            className={`season-card ${selectedSeason?.id === season.id ? "selected" : ""}`}
            onClick={() => onSeasonSelect(season)}
          >
            <div className="season-info">
              <h3>{season.name}</h3>
              <p className="season-year">{season.year}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteSeason(season.id);
              }}
              className="btn-delete"
              aria-label="Delete season"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
