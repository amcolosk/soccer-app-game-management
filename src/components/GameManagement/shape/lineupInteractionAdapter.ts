import type {
  FormationPosition,
  PlayerWithRoster,
} from "../types";

export type SupportedShapeStatus = "scheduled" | "in-progress" | "halftime";

interface InteractionAdapterConfig {
  gameStatus: string;
  startersCount: number;
  maxStarters: number;
  onSubstitute: (position: FormationPosition) => void;
  onStarterLimitReached: (message: string) => void;
}

export interface PositionInteraction {
  canTap: boolean;
  title: string;
  onTap: () => void;
}

function isStatusSupported(status: string): status is SupportedShapeStatus {
  return status === "scheduled" || status === "in-progress" || status === "halftime";
}

export function createLineupInteractionAdapter(config: InteractionAdapterConfig) {
  const { gameStatus, startersCount, maxStarters, onSubstitute, onStarterLimitReached } = config;

  const getEmptyNodeInteraction = (position: FormationPosition): PositionInteraction => {
    if (!isStatusSupported(gameStatus)) {
      return {
        canTap: false,
        title: "Unavailable",
        onTap: () => undefined,
      };
    }

    if (gameStatus === "in-progress") {
      return {
        canTap: false,
        title: "Assign players in scheduled or halftime",
        onTap: () => undefined,
      };
    }

    return {
      canTap: true,
      title: "Tap to assign player",
      onTap: () => {
        if (startersCount >= maxStarters) {
          onStarterLimitReached(`Maximum ${maxStarters} starters allowed`);
          return;
        }
        onSubstitute(position);
      },
    };
  };

  const getAssignedNodeInteraction = (position: FormationPosition): PositionInteraction => {
    if (gameStatus !== "in-progress") {
      return {
        canTap: false,
        title: "Edit assignment using remove action",
        onTap: () => undefined,
      };
    }

    return {
      canTap: true,
      title: "Tap to open substitution",
      onTap: () => onSubstitute(position),
    };
  };

  return {
    getEmptyNodeInteraction,
    getAssignedNodeInteraction,
  };
}

function parsePreferredPositionIds(preferredPositions: string | null | undefined): Set<string> {
  if (!preferredPositions) return new Set();
  return new Set(
    preferredPositions
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function playerHasPreferredPositions(
  player: Pick<PlayerWithRoster, "preferredPositions">,
): boolean {
  return parsePreferredPositionIds(player.preferredPositions).size > 0;
}

export function playerPreferredForPosition(
  player: Pick<PlayerWithRoster, "preferredPositions">,
  positionId: string,
): boolean {
  return parsePreferredPositionIds(player.preferredPositions).has(positionId);
}

export function sortBenchPlayersByPriority(params: {
  benchPlayers: PlayerWithRoster[];
  currentPositionId?: string;
  getPlayTimeSeconds: (playerId: string) => number;
}): PlayerWithRoster[] {
  const { benchPlayers, currentPositionId, getPlayTimeSeconds } = params;

  return [...benchPlayers].sort((a, b) => {
    const aPlayTime = getPlayTimeSeconds(a.id);
    const bPlayTime = getPlayTimeSeconds(b.id);
    if (aPlayTime !== bPlayTime) {
      return aPlayTime - bPlayTime;
    }

    if (currentPositionId) {
      const aPreferred = playerPreferredForPosition(a, currentPositionId);
      const bPreferred = playerPreferredForPosition(b, currentPositionId);
      if (aPreferred !== bPreferred) {
        return aPreferred ? -1 : 1;
      }
    }

    return (a.playerNumber ?? Number.MAX_SAFE_INTEGER) - (b.playerNumber ?? Number.MAX_SAFE_INTEGER);
  });
}
