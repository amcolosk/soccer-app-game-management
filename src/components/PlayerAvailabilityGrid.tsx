import { updatePlayerAvailability } from "../services/rotationPlannerService";
import { useAvailability } from "../contexts/AvailabilityContext";
import { handleApiError } from "../utils/errorHandler";

interface Player {
  id: string;
  playerNumber?: number;
  firstName?: string | null;
  lastName?: string | null;
}

interface PlayerAvailabilityGridProps {
  players: Player[];
  gameId: string;
  coaches: string[];
  /** Half length in minutes — used to set availableFromMinute for late arrivals */
  halfLengthMinutes?: number;
  /** Current elapsed game minutes — used to set availableUntilMinute for injuries */
  elapsedGameMinutes?: number;
}

export const STATUS_CYCLE: Array<"available" | "absent" | "late-arrival" | "injured"> = [
  "available",
  "absent",
  "late-arrival",
  "injured",
];

export function getStatusColor(status: string): string {
  switch (status) {
    case "available":
      return "#4caf50";
    case "absent":
      return "#f44336";
    case "injured":
      return "#ff9800";
    case "late-arrival":
      return "#fdd835";
    default:
      return "#9e9e9e";
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case "available":
      return "✓";
    case "absent":
      return "✗";
    case "injured":
      return "🩹";
    case "late-arrival":
      return "⏰";
    default:
      return "?";
  }
}

export function PlayerAvailabilityGrid({
  players,
  gameId,
  coaches,
  halfLengthMinutes,
  elapsedGameMinutes,
}: PlayerAvailabilityGridProps) {
  const { getPlayerAvailability } = useAvailability();
  const handleToggle = async (playerId: string) => {
    const currentStatus = getPlayerAvailability(playerId);
    const currentIndex = STATUS_CYCLE.indexOf(
      currentStatus as (typeof STATUS_CYCLE)[number]
    );
    const newStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];

    // Derive availability window for special statuses.
    // Pass null for available/absent to clear any stale window values in the DB.
    const clearsWindow = newStatus === 'available' || newStatus === 'absent';
    const availableFromMinute = clearsWindow
      ? null
      : newStatus === 'late-arrival' && halfLengthMinutes !== undefined
        ? halfLengthMinutes
        : newStatus === 'injured'
          ? null   // clear stale availableFromMinute (e.g., from a prior late-arrival)
          : undefined;
    const availableUntilMinute = clearsWindow
      ? null
      : newStatus === 'injured' && elapsedGameMinutes !== undefined
        ? elapsedGameMinutes
        : undefined;

    try {
      await updatePlayerAvailability(gameId, playerId, newStatus, undefined, coaches, availableFromMinute, availableUntilMinute);
    } catch (error) {
      handleApiError(error, 'Failed to update player availability');
    }
  };

  return (
    <div className="planner-section">
      <h3>Player Availability</h3>
      <div className="availability-grid">
        {players.map((player) => {
          const status = getPlayerAvailability(player.id);
          const color = getStatusColor(status);
          return (
            <button
              key={player.id}
              className="availability-card"
              onClick={() => handleToggle(player.id)}
              style={{ borderColor: color }}
            >
              <div
                className="availability-status"
                style={{ backgroundColor: color }}
              >
                {getStatusLabel(status)}
              </div>
              <div className="player-info">
                <span className="player-number">#{player.playerNumber}</span>
                <span className="player-name">
                  {player.firstName} {player.lastName}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <p className="availability-legend">
        Click player cards to cycle: Available → Absent → Late Arrival → Injured
      </p>
    </div>
  );
}
