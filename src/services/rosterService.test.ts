import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlayerOnRoster, parseOptionalPlayerNumbers, RosterValidationError } from "./rosterService";

const { mockPlayerCreate, mockRosterCreate, mockDeletePlayerCascade, mockLogError } = vi.hoisted(() => ({
  mockPlayerCreate: vi.fn(),
  mockRosterCreate: vi.fn(),
  mockDeletePlayerCascade: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: vi.fn(() => ({
    models: {
      Player: { create: mockPlayerCreate },
      TeamRoster: { create: mockRosterCreate },
    },
  })),
}));

vi.mock("./cascadeDeleteService", () => ({
  deletePlayerCascade: mockDeletePlayerCascade,
}));

vi.mock("../utils/errorHandler", () => ({
  logError: mockLogError,
}));

const team = { id: "team-1", coaches: ["coach-a", "coach-b"] };

const baseInput = {
  team,
  currentUserId: "coach-b",
  firstName: "Gus",
  lastName: "Guest",
  isGuest: true,
  existingNumbers: [7, 9],
};

describe("createPlayerOnRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayerCreate.mockResolvedValue({ data: { id: "player-1" } });
    mockRosterCreate.mockResolvedValue({ data: { id: "roster-1" } });
    mockDeletePlayerCascade.mockResolvedValue(undefined);
  });

  it("creates the player then the roster row and returns both ids", async () => {
    const result = await createPlayerOnRoster({ ...baseInput, birthYear: 2015, jerseyNumber: 12 });

    expect(result).toEqual({ playerId: "player-1", rosterId: "roster-1" });
    expect(mockPlayerCreate).toHaveBeenCalledWith({
      firstName: "Gus",
      lastName: "Guest",
      birthYear: 2015,
      coaches: ["coach-a", "coach-b"],
    });
    expect(mockRosterCreate).toHaveBeenCalledWith({
      teamId: "team-1",
      playerId: "player-1",
      playerNumber: 12,
      preferredPositions: undefined,
      isGuest: true,
      coaches: ["coach-a", "coach-b"],
    });
  });

  it("seeds Player.coaches with the team's coaches plus the creator", async () => {
    await createPlayerOnRoster({ ...baseInput, currentUserId: "coach-c" });

    expect(mockPlayerCreate.mock.calls[0][0].coaches).toEqual(["coach-a", "coach-b", "coach-c"]);
    expect(mockRosterCreate.mock.calls[0][0].coaches).toEqual(["coach-a", "coach-b"]);
  });

  it("omits playerNumber (no null) when there is no jersey number", async () => {
    await createPlayerOnRoster(baseInput);

    expect(mockRosterCreate.mock.calls[0][0]).not.toHaveProperty("playerNumber");
  });

  it("joins preferred positions with a comma and space", async () => {
    await createPlayerOnRoster({ ...baseInput, preferredPositionIds: ["p1", "p2"] });

    expect(mockRosterCreate.mock.calls[0][0].preferredPositions).toBe("p1, p2");
  });

  it("trims names and rejects blanks without creating anything", async () => {
    await createPlayerOnRoster({ ...baseInput, firstName: "  Gus ", lastName: " Guest  " });
    expect(mockPlayerCreate.mock.calls[0][0]).toMatchObject({ firstName: "Gus", lastName: "Guest" });

    vi.clearAllMocks();
    await expect(createPlayerOnRoster({ ...baseInput, firstName: "   " })).rejects.toBeInstanceOf(
      RosterValidationError,
    );
    expect(mockPlayerCreate).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range or duplicate jersey number without creating anything", async () => {
    await expect(createPlayerOnRoster({ ...baseInput, jerseyNumber: 100 })).rejects.toBeInstanceOf(
      RosterValidationError,
    );
    await expect(createPlayerOnRoster({ ...baseInput, jerseyNumber: 7 })).rejects.toThrow(/already in use/);
    expect(mockPlayerCreate).not.toHaveBeenCalled();
  });

  it("throws and creates no roster row when Player.create returns errors", async () => {
    mockPlayerCreate.mockResolvedValue({ data: null, errors: [{ message: "denied" }] });

    await expect(createPlayerOnRoster(baseInput)).rejects.toThrow("denied");
    expect(mockRosterCreate).not.toHaveBeenCalled();
    expect(mockDeletePlayerCascade).not.toHaveBeenCalled();
  });

  it("rolls back the player via deletePlayerCascade when the roster create fails", async () => {
    mockRosterCreate.mockResolvedValue({ data: null, errors: [{ message: "roster boom" }] });

    await expect(createPlayerOnRoster(baseInput)).rejects.toThrow("roster boom");
    expect(mockDeletePlayerCascade).toHaveBeenCalledWith("player-1");
  });

  it("still surfaces the original error when the rollback itself fails", async () => {
    mockRosterCreate.mockRejectedValue(new Error("network"));
    mockDeletePlayerCascade.mockRejectedValue(new Error("rollback failed"));

    await expect(createPlayerOnRoster(baseInput)).rejects.toThrow("network");
    expect(mockLogError).toHaveBeenCalled();
  });
});

describe("parseOptionalPlayerNumbers", () => {
  it("maps blanks to undefined, never NaN", () => {
    expect(parseOptionalPlayerNumbers({ birthYear: "", jerseyNumber: "  " })).toEqual({
      birthYear: undefined,
      jerseyNumber: undefined,
    });
  });

  it("parses valid values", () => {
    expect(parseOptionalPlayerNumbers({ birthYear: "2015", jerseyNumber: "12" })).toEqual({
      birthYear: 2015,
      jerseyNumber: 12,
    });
  });

  it("throws RosterValidationError for an invalid birth year or jersey number", () => {
    expect(() => parseOptionalPlayerNumbers({ birthYear: "1800", jerseyNumber: "" })).toThrow(RosterValidationError);
    expect(() => parseOptionalPlayerNumbers({ birthYear: "", jerseyNumber: "0" })).toThrow(/1-99/);
  });
});
