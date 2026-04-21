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
  id: string;       // stable client-generated uuid (matches backend record id)
  playerId: string;
  positionId: string;
  createdAt?: string; // ISO timestamp for FIFO ordering
}
