import { describe, expect, it } from "vitest";
import {
  getPlayerAvailabilityStatus,
  isPlayerAvailable,
  isPlayerInjured,
} from "./availabilityUtils";
import type { PlayerAvailability } from "../types/schema";

const makeAvailability = (playerId: string, status: string): PlayerAvailability => (
  { id: `availability-${playerId}`, playerId, status } as unknown as PlayerAvailability
);

const availabilities: PlayerAvailability[] = [
  makeAvailability("player-1", "injured"),
  makeAvailability("player-2", "available"),
];

describe("availabilityUtils", () => {
  it("returns injured status for an injured player", () => {
    expect(getPlayerAvailabilityStatus("player-1", availabilities)).toBe("injured");
    expect(isPlayerInjured("player-1", availabilities)).toBe(true);
  });

  it("defaults to available when no record exists", () => {
    expect(getPlayerAvailabilityStatus("missing-player", availabilities)).toBe("available");
    expect(isPlayerInjured("missing-player", availabilities)).toBe(false);
    expect(isPlayerAvailable("missing-player", availabilities)).toBe(true);
  });

  it("treats absent and injured as not available", () => {
    const absent: PlayerAvailability[] = [
      makeAvailability("player-3", "absent"),
    ];

    expect(isPlayerAvailable("player-3", absent)).toBe(false);
    expect(isPlayerAvailable("player-1", availabilities)).toBe(false);
    expect(isPlayerAvailable("player-2", availabilities)).toBe(true);
  });

  it("handles nullish availability arrays", () => {
    expect(isPlayerInjured("player-1", undefined)).toBe(false);
    expect(isPlayerInjured("player-1", null)).toBe(false);
    expect(isPlayerAvailable("player-1", undefined)).toBe(true);
  });
});
