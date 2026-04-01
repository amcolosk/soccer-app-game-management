import type { PlayerWithRoster, PlayTimeRecord } from "./types";
import { calculatePlayerPlayTime, formatPlayTime } from "../../utils/playTimeCalculations";

interface CompletedPlayTimeSummaryProps {
  players: PlayerWithRoster[];
  playTimeRecords: PlayTimeRecord[];
  gameEndSeconds: number;
}

export function CompletedPlayTimeSummary({
  players,
  playTimeRecords,
  gameEndSeconds,
}: CompletedPlayTimeSummaryProps) {
  // Normalize records: treat null/undefined endGameSeconds as gameEndSeconds
  const normalizedRecords: PlayTimeRecord[] = playTimeRecords.map((r) => {
    if (r.endGameSeconds === null || r.endGameSeconds === undefined) {
      return { ...r, endGameSeconds: gameEndSeconds };
    }
    return r;
  });

  // Sort players by jersey number ascending, null/undefined last
  const sortedPlayers = [...players].sort(
    (a, b) => (a.playerNumber ?? 999) - (b.playerNumber ?? 999)
  );

  return (
    <section
      className="completed-playtime-summary"
      aria-labelledby="completed-playtime-summary-heading"
    >
      <h3
        id="completed-playtime-summary-heading"
        className="completed-playtime-summary__heading"
      >
        ⏱ Play Time
      </h3>

      {players.length === 0 ? (
        <div className="empty-state">
          <p>No players on roster.</p>
        </div>
      ) : (
        <table
          className="completed-playtime-summary__table"
          aria-label="Player play time for this game"
        >
          <thead>
            <tr>
              <th scope="col" className="completed-playtime-summary__col--number">
                #
              </th>
              <th scope="col" className="completed-playtime-summary__col--name">
                Player
              </th>
              <th scope="col" className="completed-playtime-summary__col--time">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((player) => {
              const seconds = calculatePlayerPlayTime(player.id, normalizedRecords);
              const hasTime = seconds > 0;
              return (
                <tr
                  key={player.id}
                  className={
                    hasTime ? undefined : "completed-playtime-summary__row--no-time"
                  }
                >
                  <th scope="row">{player.playerNumber}</th>
                  <td>{`${player.firstName} ${player.lastName}`}</td>
                  <td className="completed-playtime-summary__col--time">
                    {hasTime ? formatPlayTime(seconds, "long") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
