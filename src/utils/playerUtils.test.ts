import { describe, it, expect } from "vitest";
import type { TeamRoster } from "../types/schema";
import { formatJerseyNumber, formatJerseyPrefix, sortRosterByNumber } from "./playerUtils";

describe("formatJerseyNumber", () => {
  it("formats a number with a # prefix", () => {
    expect(formatJerseyNumber(7)).toBe("#7");
  });
  it("returns an empty string for null and undefined", () => {
    expect(formatJerseyNumber(null)).toBe("");
    expect(formatJerseyNumber(undefined)).toBe("");
  });
});

describe("formatJerseyPrefix", () => {
  it("formats a number with a # prefix and trailing space", () => {
    expect(formatJerseyPrefix(10)).toBe("#10 ");
  });
  it("returns an empty string for null and undefined", () => {
    expect(formatJerseyPrefix(null)).toBe("");
    expect(formatJerseyPrefix(undefined)).toBe("");
  });
});

describe("sortRosterByNumber", () => {
  const roster = (id: string, n: number | null | undefined) =>
    ({ id, playerNumber: n }) as unknown as TeamRoster;

  it("sorts ascending by number", () => {
    const sorted = sortRosterByNumber([roster("a", 9), roster("b", 2), roster("c", 5)]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts entries without a number last", () => {
    const sorted = sortRosterByNumber([roster("g1", null), roster("a", 9), roster("g2", undefined), roster("b", 2)]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "g1", "g2"]);
  });

  it("does not mutate the input", () => {
    const input = [roster("a", 9), roster("b", 2)];
    sortRosterByNumber(input);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
