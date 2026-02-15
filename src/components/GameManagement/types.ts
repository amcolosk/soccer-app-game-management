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
  PlayerAvailability,
  PlayerWithRoster,
} from "../../types/schema";

export interface SubQueue {
  playerId: string;
  positionId: string;
}
