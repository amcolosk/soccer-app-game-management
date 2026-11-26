import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HalftimeLineupSummary } from "./HalftimeLineupSummary";
import type { FormationPosition, LineupAssignment } from "./types";

const pos1 = { id: "pos1", positionName: "Goalkeeper", abbreviation: "GK" } as unknown as FormationPosition;
const pos2 = { id: "pos2", positionName: "Defender", abbreviation: "DEF" } as unknown as FormationPosition;
const positions = [pos1, pos2];

function makeAssignment(overrides: Partial<LineupAssignment>): LineupAssignment {
  return {
    id: "la-1",
    gameId: "game-1",
    playerId: "p1",
    positionId: "pos1",
    isStarter: true,
    ...overrides,
  } as unknown as LineupAssignment;
}

// Note: HalftimeLineupSummary itself isn't gated — GameManagement.tsx only
// mounts it when version === 'new'. Both "toggle states" referenced in the
// plan's test strategy are therefore exercised at the GameManagement mount
// site, not inside this component. These tests cover the component's own
// anomaly-only rendering, which is what's actually shown in the 'new' state.
describe("HalftimeLineupSummary", () => {
  it('renders a single reassuring line when all positions are filled', () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
      makeAssignment({ id: "la-2", playerId: "p2", positionId: "pos2" }),
    ];

    render(
      <HalftimeLineupSummary
        lineup={lineup}
        positions={positions}
        pendingRemovalIds={new Set()}
        maxPlayersOnField={2}
      />
    );

    expect(screen.getByText("All positions filled")).toBeInTheDocument();
    expect(screen.queryByText(/is empty/i)).not.toBeInTheDocument();
  });

  it("renders a line for an empty position", () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
    ];

    render(
      <HalftimeLineupSummary
        lineup={lineup}
        positions={positions}
        pendingRemovalIds={new Set()}
        maxPlayersOnField={2}
      />
    );

    expect(screen.getByText(/Defender is empty/i)).toBeInTheDocument();
    expect(screen.queryByText("All positions filled")).not.toBeInTheDocument();
  });

  it("does NOT render a redundant under-count line when the shortfall is fully explained by named empty positions", () => {
    // Single missing starter (Defender) — already explained by its own
    // "Defender is empty" line, so the generic "1 of 2 starters assigned"
    // line would be redundant and must not also render.
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
    ];

    render(
      <HalftimeLineupSummary
        lineup={lineup}
        positions={positions}
        pendingRemovalIds={new Set()}
        maxPlayersOnField={2}
      />
    );

    expect(screen.getByText(/Defender is empty/i)).toBeInTheDocument();
    expect(screen.queryByText(/starters assigned/i)).not.toBeInTheDocument();
  });

  it("renders an under-count warning when the gap exceeds the number of specifically-named empty positions", () => {
    // Only 2 named positions exist, but maxPlayersOnField expects 3 starters —
    // the gap (2) is larger than emptyPositionIds.length (1), so there's an
    // unexplained shortfall beyond what the named "is empty" line covers.
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
    ];

    render(
      <HalftimeLineupSummary
        lineup={lineup}
        positions={positions}
        pendingRemovalIds={new Set()}
        maxPlayersOnField={3}
      />
    );

    expect(screen.getByText(/Defender is empty/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 starters assigned/i)).toBeInTheDocument();
  });

  it("treats a pending-removal id as not resolved, flagging its position as empty", () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
      makeAssignment({ id: "la-2", playerId: "p2", positionId: "pos2" }),
    ];

    render(
      <HalftimeLineupSummary
        lineup={lineup}
        positions={positions}
        pendingRemovalIds={new Set(["la-1"])}
        maxPlayersOnField={2}
      />
    );

    expect(screen.getByText(/Goalkeeper is empty/i)).toBeInTheDocument();
  });

  it('has role="status" and aria-live="polite" so a screen reader notices the change without re-scanning', () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
      makeAssignment({ id: "la-2", playerId: "p2", positionId: "pos2" }),
    ];

    render(
      <HalftimeLineupSummary
        lineup={lineup}
        positions={positions}
        pendingRemovalIds={new Set()}
        maxPlayersOnField={2}
      />
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});
