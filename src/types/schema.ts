import type { Schema } from "../../amplify/data/resource";

// Data model types derived from Amplify schema
export type Team = Schema["Team"]["type"];
export type Game = Schema["Game"]["type"];
export type Player = Schema["Player"]["type"];
export type TeamRoster = Schema["TeamRoster"]["type"];
export type Formation = Schema["Formation"]["type"];
export type FormationPosition = Schema["FormationPosition"]["type"];
export type FieldPosition = Schema["FieldPosition"]["type"];
export type LineupAssignment = Schema["LineupAssignment"]["type"];
export type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];
export type Goal = Schema["Goal"]["type"];
export type GameNote = Schema["GameNote"]["type"];
export type GamePlan = Schema["GamePlan"]["type"];
export type PlannedRotation = Schema["PlannedRotation"]["type"];
export type PlayerAvailability = Schema["PlayerAvailability"]["type"];
export type Substitution = Schema["Substitution"]["type"];
export type TeamInvitation = Schema["TeamInvitation"]["type"];

// Domain interfaces
export interface PlayerWithRoster extends Player {
  playerNumber?: number;
  preferredPositions?: string;
}

export interface PlannedSubstitution {
  playerOutId: string;
  playerInId: string;
  positionId: string;
}
