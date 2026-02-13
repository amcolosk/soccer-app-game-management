import type { Schema } from "../../../amplify/data/resource";
import type { PlayerWithRoster as PlayerWithRosterBase } from "../../hooks/useTeamData";

export type Game = Schema["Game"]["type"];
export type Team = Schema["Team"]["type"];
export type Player = Schema["Player"]["type"];
export type FormationPosition = Schema["FormationPosition"]["type"];
export type LineupAssignment = Schema["LineupAssignment"]["type"];
export type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];
export type Goal = Schema["Goal"]["type"];
export type GameNote = Schema["GameNote"]["type"];
export type GamePlan = Schema["GamePlan"]["type"];
export type PlannedRotation = Schema["PlannedRotation"]["type"];
export type PlayerAvailability = Schema["PlayerAvailability"]["type"];
export type PlayerWithRoster = PlayerWithRosterBase;

export interface SubQueue {
  playerId: string;
  positionId: string;
}
