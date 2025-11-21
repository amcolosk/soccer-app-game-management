import type { Schema } from "../amplify/data/resource";

// Type definitions from Amplify schema
export type Season = Schema["Season"]["type"];
export type Team = Schema["Team"]["type"];
export type Player = Schema["Player"]["type"];
export type FieldPosition = Schema["FieldPosition"]["type"];

// Component props types
export interface SeasonSelectorProps {
  onSeasonSelect: (season: Season) => void;
  selectedSeason: Season | null;
}

export interface TeamSelectorProps {
  seasonId: string;
  onTeamSelect: (team: Team) => void;
  selectedTeam: Team | null;
}

export interface TeamManagementProps {
  team: Team;
  onBack: () => void;
}

export interface PlayerListProps {
  players: Player[];
  onPlayerAdd: () => void;
  onPlayerEdit: (player: Player) => void;
  onPlayerDelete: (playerId: string) => void;
}

export interface FieldPositionListProps {
  positions: FieldPosition[];
  onPositionAdd: () => void;
  onPositionEdit: (position: FieldPosition) => void;
  onPositionDelete: (positionId: string) => void;
}
