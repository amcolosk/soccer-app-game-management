import { useState, useEffect } from "react";
import { useAuthenticator } from '@aws-amplify/ui-react';
import { generateClient } from "aws-amplify/data";
import { SeasonSelector } from "./components/SeasonSelector";
import { TeamSelector } from "./components/TeamSelector";
import { TeamManagement } from "./components/TeamManagement";
import type { Season, Team } from "./types";
import type { Schema } from "../amplify/data/resource";
import "./App.css";

const client = generateClient<Schema>();

function App() {
  const { signOut } = useAuthenticator();
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  const handleSeasonSelect = (season: Season) => {
    setSelectedSeason(season);
    setSelectedTeam(null); // Reset team selection when season changes
  };

  const handleTeamSelect = (team: Team) => {
    setSelectedTeam(team);
  };

  const handleBackToTeams = () => {
    setSelectedTeam(null);
    localStorage.removeItem('activeGame');
  };

  const handleBackToSeasons = () => {
    setSelectedSeason(null);
    setSelectedTeam(null);
    localStorage.removeItem('activeGame');
  };

  // Restore navigation state from localStorage on mount
  useEffect(() => {
    const restoreState = async () => {
      try {
        const activeGameData = localStorage.getItem('activeGame');
        if (activeGameData) {
          const { seasonId, teamId } = JSON.parse(activeGameData);
          
          // Fetch season
          const seasonResponse = await client.models.Season.get({ id: seasonId });
          if (seasonResponse.data) {
            setSelectedSeason(seasonResponse.data as Season);
            
            // Fetch team
            const teamResponse = await client.models.Team.get({ id: teamId });
            if (teamResponse.data) {
              setSelectedTeam(teamResponse.data as Team);
            }
          }
        }
      } catch (error) {
        console.error('Error restoring state:', error);
        localStorage.removeItem('activeGame');
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, []);

  if (isRestoring) {
    return (
      <main className="app-container">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-container">
      <header className="app-header">
        <h1>⚽ Soccer Coach Manager</h1>
        <button onClick={signOut} className="btn-signout">
          Sign out
        </button>
      </header>

      {!selectedSeason && (
        <SeasonSelector
          onSeasonSelect={handleSeasonSelect}
          selectedSeason={selectedSeason}
        />
      )}

      {selectedSeason && !selectedTeam && (
        <div>
          <button onClick={handleBackToSeasons} className="btn-back">
            ← Back to Seasons
          </button>
          <TeamSelector
            seasonId={selectedSeason.id}
            onTeamSelect={handleTeamSelect}
            selectedTeam={selectedTeam}
          />
        </div>
      )}

      {selectedTeam && (
        <TeamManagement
          team={selectedTeam}
          onBack={handleBackToTeams}
        />
      )}
    </main>
  );
}

export default App;
