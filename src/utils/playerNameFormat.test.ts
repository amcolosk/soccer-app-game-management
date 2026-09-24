import { describe, expect, it } from "vitest";
import { formatPlayerShortLabel, getInitialFromLastName, normalizeNamePart } from "./playerNameFormat";

describe("playerNameFormat", () => {
  describe("normalizeNamePart", () => {
    it("trims and collapses internal whitespace", () => {
      expect(normalizeNamePart("  Ava   Keeper  ")).toBe("Ava Keeper");
    });

    it("returns empty string for null/undefined", () => {
      expect(normalizeNamePart(null)).toBe("");
      expect(normalizeNamePart(undefined)).toBe("");
    });
  });

  describe("getInitialFromLastName", () => {
    it("returns the first alphabetic character, uppercased", () => {
      expect(getInitialFromLastName("keeper")).toBe("K");
    });

    it("falls back to the first alphanumeric character when no letters exist", () => {
      expect(getInitialFromLastName("7")).toBe("7");
    });
  });

  describe("formatPlayerShortLabel", () => {
    it("formats first name + last initial when both are present", () => {
      expect(formatPlayerShortLabel({ firstName: "  Ava  ", lastName: "  Keeper  " })).toBe("Ava K");
    });

    it("returns first name alone when last name is missing", () => {
      expect(formatPlayerShortLabel({ firstName: "Ava", lastName: "" })).toBe("Ava");
    });

    it("returns the last initial alone when first name is missing", () => {
      expect(formatPlayerShortLabel({ firstName: "", lastName: " Keeper " })).toBe("K");
    });

    it("returns 'Unknown player' for a null/undefined player", () => {
      expect(formatPlayerShortLabel(null)).toBe("Unknown player");
      expect(formatPlayerShortLabel(undefined)).toBe("Unknown player");
    });

    it("returns 'Unknown player' when both names are empty", () => {
      expect(formatPlayerShortLabel({ firstName: "", lastName: "" })).toBe("Unknown player");
    });
  });
});
