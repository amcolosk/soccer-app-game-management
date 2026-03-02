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
  }>;
}
