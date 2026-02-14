import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerAvailabilityGrid } from "./PlayerAvailabilityGrid";

vi.mock("../services/rotationPlannerService", () => ({
  updatePlayerAvailability: vi.fn(),
}));

vi.mock("../contexts/AvailabilityContext", () => ({
  useAvailability: vi.fn(),
}));

vi.mock("../utils/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
}));

import { updatePlayerAvailability } from "../services/rotationPlannerService";
import { useAvailability } from "../contexts/AvailabilityContext";
import { showError } from "../utils/toast";

const mockUpdate = vi.mocked(updatePlayerAvailability);
const mockUseAvailability = vi.mocked(useAvailability);
const mockShowError = vi.mocked(showError);

const players = [
  { id: "p1", playerNumber: 5, firstName: "Alice", lastName: "Smith" },
  { id: "p2", playerNumber: 9, firstName: "Bob", lastName: "Jones" },
];

const defaultProps = {
  players,
  gameId: "game-1",
  coaches: ["coach-1"],
};

beforeEach(() => {
  mockUpdate.mockReset();
  mockShowError.mockReset();
  mockUseAvailability.mockReturnValue({
    availabilities: [],
    getPlayerAvailability: () => "available",
  });
});

describe("PlayerAvailabilityGrid", () => {
  it("renders heading, player buttons, and legend", () => {
    render(<PlayerAvailabilityGrid {...defaultProps} />);
    expect(screen.getByText("Player Availability")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.getByText(/Click player cards to cycle/)
    ).toBeInTheDocument();
  });

  it("displays player number and name for each player", () => {
    render(<PlayerAvailabilityGrid {...defaultProps} />);
    expect(screen.getByText("#5")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("#9")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("shows correct status indicator for available", () => {
    render(<PlayerAvailabilityGrid {...defaultProps} />);
    // All players are available, so check marks
    const statusEls = document.querySelectorAll(".availability-status");
    expect(statusEls[0]).toHaveTextContent("✓");
    expect(statusEls[0]).toHaveStyle({ backgroundColor: "#4caf50" });
  });

  it("shows correct status indicator for absent", () => {
    mockUseAvailability.mockReturnValue({
      availabilities: [],
      getPlayerAvailability: () => "absent",
    });
    render(<PlayerAvailabilityGrid {...defaultProps} />);
    const statusEls = document.querySelectorAll(".availability-status");
    expect(statusEls[0]).toHaveTextContent("✗");
    expect(statusEls[0]).toHaveStyle({ backgroundColor: "#f44336" });
  });

  it("shows correct status indicator for late-arrival", () => {
    mockUseAvailability.mockReturnValue({
      availabilities: [],
      getPlayerAvailability: () => "late-arrival",
    });
    render(<PlayerAvailabilityGrid {...defaultProps} />);
    const statusEls = document.querySelectorAll(".availability-status");
    expect(statusEls[0]).toHaveTextContent("⏰");
    expect(statusEls[0]).toHaveStyle({ backgroundColor: "#fdd835" });
  });

  it("shows correct status indicator for injured", () => {
    mockUseAvailability.mockReturnValue({
      availabilities: [],
      getPlayerAvailability: () => "injured",
    });
    render(<PlayerAvailabilityGrid {...defaultProps} />);
    const statusEls = document.querySelectorAll(".availability-status");
    expect(statusEls[0]).toHaveTextContent("🩹");
    expect(statusEls[0]).toHaveStyle({ backgroundColor: "#ff9800" });
  });

  it("calls updatePlayerAvailability with next status on click (available -> absent)", async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(undefined);

    render(<PlayerAvailabilityGrid {...defaultProps} />);
    await user.click(screen.getAllByRole("button")[0]);

    expect(mockUpdate).toHaveBeenCalledWith(
      "game-1", "p1", "absent", undefined, ["coach-1"]
    );
  });

  it("cycles absent -> late-arrival on click", async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(undefined);
    mockUseAvailability.mockReturnValue({
      availabilities: [],
      getPlayerAvailability: () => "absent",
    });

    render(<PlayerAvailabilityGrid {...defaultProps} />);
    await user.click(screen.getAllByRole("button")[0]);

    expect(mockUpdate).toHaveBeenCalledWith(
      "game-1", "p1", "late-arrival", undefined, ["coach-1"]
    );
  });

  it("cycles injured -> available (wraps around)", async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(undefined);
    mockUseAvailability.mockReturnValue({
      availabilities: [],
      getPlayerAvailability: () => "injured",
    });

    render(<PlayerAvailabilityGrid {...defaultProps} />);
    await user.click(screen.getAllByRole("button")[0]);

    expect(mockUpdate).toHaveBeenCalledWith(
      "game-1", "p1", "available", undefined, ["coach-1"]
    );
  });

  it("defaults unknown status to available on click", async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(undefined);
    mockUseAvailability.mockReturnValue({
      availabilities: [],
      getPlayerAvailability: () => "unknown",
    });

    render(<PlayerAvailabilityGrid {...defaultProps} />);
    await user.click(screen.getAllByRole("button")[0]);

    // indexOf('unknown') = -1, (-1+1)%4 = 0 => 'available'
    expect(mockUpdate).toHaveBeenCalledWith(
      "game-1", "p1", "available", undefined, ["coach-1"]
    );
  });

  it("shows error toast on API error", async () => {
    const user = userEvent.setup();
    mockUpdate.mockRejectedValue(new Error("network"));

    render(<PlayerAvailabilityGrid {...defaultProps} />);
    await user.click(screen.getAllByRole("button")[0]);

    expect(mockShowError).toHaveBeenCalledWith("Failed to update player availability");
  });

  it("does not show error toast on success", async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue(undefined);

    render(<PlayerAvailabilityGrid {...defaultProps} />);
    await user.click(screen.getAllByRole("button")[0]);

    expect(mockShowError).not.toHaveBeenCalled();
  });
});
