import { updatePlayerAvailability } from "../services/rotationPlannerService";
import { useAvailability } from "../contexts/AvailabilityContext";
import { handleApiError } from "../utils/errorHandler";
import { trackEvent, AnalyticsEvents } from "../utils/analytics";

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
  /** IDs of players currently in the starting lineup. These players skip the
   * 'injured' status — a player on the field who is injured should be
   * substituted out rather than marked as injured in the availability grid. */
  lineupPlayerIds?: string[];
}

// eslint-disable-next-line react-refresh/only-export-components
export const STATUS_CYCLE: Array<"available" | "absent" | "late-arrival" | "injured"> = [
  "available",
  "absent",
  "late-arrival",
  "injured",
];

// eslint-disable-next-line react-refresh/only-export-components
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

// eslint-disable-next-line react-refresh/only-export-components
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
  lineupPlayerIds,
}: PlayerAvailabilityGridProps) {
  const { getPlayerAvailability } = useAvailability();
  const handleToggle = async (playerId: string) => {
    const currentStatus = getPlayerAvailability(playerId);
    // Players in the active lineup cannot be marked injured from this grid —
    // they should be substituted out instead. Use a shorter cycle for them.
    const inLineup = (lineupPlayerIds ?? []).includes(playerId);
    const cycle = inLineup
      ? (STATUS_CYCLE.filter(s => s !== 'injured') as Array<'available' | 'absent' | 'late-arrival'>)
      : STATUS_CYCLE;
    const currentIndex = cycle.indexOf(currentStatus as typeof STATUS_CYCLE[number]);
    const newStatus = cycle[(currentIndex + 1) % cycle.length];

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
      trackEvent(AnalyticsEvents.AVAILABILITY_MARKED.category, AnalyticsEvents.AVAILABILITY_MARKED.action, newStatus);
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
