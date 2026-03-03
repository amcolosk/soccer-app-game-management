export interface GamePlannerDebugContext {
  rotationIntervalMinutes: number;
  halfLengthMinutes: number;
  maxPlayersOnField: number;
  availablePlayerCount: number;
  players: Array<{
    number: number;
    status: string;
    availableFromMinute: number | null | undefined;
    availableUntilMinute: number | null | undefined;
    preferredPositionNames?: string[];
  }>;
  rotations?: Array<{
    rotationNumber: number;
    gameMinute: number;
    half: number;
    substitutions: Array<{
      playerOutNumber: number;
      playerInNumber: number;
      positionName: string;
    }>;
  }>;
}
