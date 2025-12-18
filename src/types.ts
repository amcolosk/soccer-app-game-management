import type { Schema } from "../amplify/data/resource";

// Type definitions from Amplify schema
export type Team = Schema["Team"]["type"];
export type Player = Schema["Player"]["type"];
export type TeamRoster = Schema["TeamRoster"]["type"];
export type FieldPosition = Schema["FieldPosition"]["type"];
export type TeamPermission = Schema["TeamPermission"]["type"];
export type TeamInvitation = Schema["TeamInvitation"]["type"];

// Permission and invitation enums
export type PermissionRole = 'OWNER' | 'COACH' | 'READ_ONLY';
export type InvitationRole = 'OWNER' | 'COACH' | 'PARENT';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

// Component props types
export interface TeamSelectorProps {
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
