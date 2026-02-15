export type {
  Game,
  Team,
  Player,
  FormationPosition,
  LineupAssignment,
  PlayTimeRecord,
  Goal,
  GameNote,
  GamePlan,
  PlannedRotation,
  
  PlayerWithRoster,
} from "../../types/schema";

export interface SubQueue {
  playerId: string;
  positionId: string;
}
