import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuestBadge } from "./GuestBadge";

describe("GuestBadge", () => {
  it("renders the full neutral badge", () => {
    render(<GuestBadge />);
    const badge = screen.getByText("Guest");
    expect(badge.className).toContain("status-badge--guest");
  });

  it("renders a compact mark with an accessible Guest label", () => {
    render(<GuestBadge compact />);
    expect(screen.getByText("G").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Guest").className).toContain("sr-only");
  });
});
