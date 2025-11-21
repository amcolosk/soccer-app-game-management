import { useState } from "react";
import { useAuthenticator } from '@aws-amplify/ui-react';
import { SeasonSelector } from "./components/SeasonSelector";
import { TeamSelector } from "./components/TeamSelector";
import { TeamManagement } from "./components/TeamManagement";
import type { Season, Team } from "./types";
import "./App.css";

function App() {
  const { signOut } = useAuthenticator();
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  const handleSeasonSelect = (season: Season) => {
    setSelectedSeason(season);
    setSelectedTeam(null); // Reset team selection when season changes
  };

  const handleTeamSelect = (team: Team) => {
    setSelectedTeam(team);
  };

  const handleBackToTeams = () => {
    setSelectedTeam(null);
  };

  const handleBackToSeasons = () => {
    setSelectedSeason(null);
    setSelectedTeam(null);
  };

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
