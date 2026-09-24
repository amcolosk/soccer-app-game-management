import { SoccerPitchSurface } from '../shared/SoccerPitchSurface';
import { formatPlayerShortLabel } from '../../utils/playerNameFormat';
import {
  buildLineupShapeNodes,
  type LineupShapePositionInput,
} from '../GameManagement/shape/lineupShapeDeterminism';

// Pure, read-only, presentational -- the public Sideline Stat Tracker's
// pitch/field visualization of the on-field roster. Deliberately does NOT
// import `RosterPlayer` back from `./StatTrackerView` (that file is where
// this component gets *used* from; importing its type back would create a
// circular type dependency, and `RosterPlayer` there is unexported anyway).
// Its own narrow, local, structural prop type is intentionally a subset of
// what `getStatTrackerView` actually returns.
export interface TrackerFieldPlayer {
  id: string;
  firstName: string;
  lastName: string;
  playerNumber?: number | null;
  position?: {
    id: string;
    positionName?: string | null;
    abbreviation?: string | null;
    role?: string | null;
    sortOrder?: number | null;
    xPct?: number | null;
    yPct?: number | null;
  } | null;
}

interface TrackerFieldLineupProps {
  players: TrackerFieldPlayer[];
}

function positionInputFrom(position: NonNullable<TrackerFieldPlayer['position']>): LineupShapePositionInput {
  return {
    id: position.id,
    positionName: position.positionName ?? null,
    abbreviation: position.abbreviation ?? null,
    role: position.role ?? null,
    sortOrder: position.sortOrder ?? null,
    xPct: position.xPct ?? null,
    yPct: position.yPct ?? null,
  };
}

function jerseyContent(player: TrackerFieldPlayer): string {
  if (player.playerNumber != null) return `#${player.playerNumber}`;
  const abbreviation = player.position?.abbreviation?.trim();
  if (abbreviation) return abbreviation;
  return '?';
}

function occupantLabel(player: TrackerFieldPlayer): string {
  const name = formatPlayerShortLabel(player);
  return player.playerNumber != null ? `#${player.playerNumber} ${name}` : name;
}

// Pure, read-only presentational component -- no tap handlers,
// interactionAdapter, quick-replace, or clear-slot logic. Safeguards against
// a caller passing a bench player (position: null) even though the Lambda's
// own invariant should already guarantee on-field-only input here.
export function TrackerFieldLineup({ players }: TrackerFieldLineupProps) {
  const onField = players.filter((p): p is TrackerFieldPlayer & { position: NonNullable<TrackerFieldPlayer['position']> } => p.position != null);

  if (onField.length === 0) {
    return null;
  }

  // Deduplicate positions by id -- two players can momentarily share one
  // FormationPosition during a substitution race (see the Lambda's own
  // handling of this same case in goalkeeper.ts / handler.test.ts). Group
  // every occupant under their shared position id rather than dropping one.
  const occupantsByPositionId = new Map<string, TrackerFieldPlayer[]>();
  const positionInputById = new Map<string, LineupShapePositionInput>();
  for (const player of onField) {
    const position = player.position;
    if (!occupantsByPositionId.has(position.id)) {
      occupantsByPositionId.set(position.id, []);
      positionInputById.set(position.id, positionInputFrom(position));
    }
    occupantsByPositionId.get(position.id)?.push(player);
  }

  const nodes = buildLineupShapeNodes(Array.from(positionInputById.values()));

  return (
    <SoccerPitchSurface className="tracker-field" role="img" aria-label="On-field lineup, by position">
      {nodes.map((node) => {
        const occupants = occupantsByPositionId.get(node.positionId) ?? [];
        if (occupants.length === 0) return null;

        const positionLabel = node.abbreviation || node.positionName;
        const isMulti = occupants.length > 1;

        const groupLabel = isMulti
          ? `${node.positionName}: ${occupants.map(occupantLabel).join(', ')}`
          : `${occupantLabel(occupants[0])}, ${node.positionName}`;

        return (
          <div
            key={node.positionId}
            className={`tracker-field-node ${isMulti ? 'tracker-field-node--multi' : ''}`}
            style={{ left: `${node.xPct}%`, top: `${node.yPct}%` }}
            role="group"
            aria-label={groupLabel}
          >
            {isMulti ? (
              <div className="tracker-field-node__occupants">
                {occupants.map((player) => (
                  <div key={player.id} className="tracker-field-node__occupant">
                    <span className="tracker-field-node__jersey tracker-field-node__jersey--compact" aria-hidden="true">
                      {jerseyContent(player)}
                    </span>
                    <span className="tracker-field-node__name" aria-hidden="true">{formatPlayerShortLabel(player)}</span>
                  </div>
                ))}
                <span className="tracker-field-node__position" aria-hidden="true">{positionLabel}</span>
              </div>
            ) : (
              <>
                <span className="tracker-field-node__jersey" aria-hidden="true">
                  {jerseyContent(occupants[0])}
                </span>
                <span className="tracker-field-node__name" aria-hidden="true">{formatPlayerShortLabel(occupants[0])}</span>
                <span className="tracker-field-node__position" aria-hidden="true">{positionLabel}</span>
              </>
            )}
          </div>
        );
      })}
    </SoccerPitchSurface>
  );
}
