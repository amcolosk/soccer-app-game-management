import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LineupTemplatesPanel } from "./LineupTemplatesPanel";
import type { LineupTemplate } from "../../utils/planTemplateUtils";
import type { FormationPosition, PlayerWithRoster } from "./types";

const players = [
  { id: "p1", firstName: "Ann", lastName: "Alpha", playerNumber: 1 },
  { id: "p2", firstName: "Bo", lastName: "Beta", playerNumber: 2 },
] as unknown as PlayerWithRoster[];
const positions = [
  { id: "gk", abbreviation: "GK" },
  { id: "st", abbreviation: "ST" },
] as unknown as FormationPosition[];

function tpl(id: string, name: string, updatedAt: string, extra: Partial<LineupTemplate> = {}): LineupTemplate {
  return {
    id,
    name,
    formationId: "f1",
    startingLineup: [{ positionId: "gk", playerId: "p1" }],
    savedAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

const baseProps = {
  error: null,
  players,
  positions,
  teamFormationId: "f1",
  applyBlockedReason: null,
  canManage: true,
  isBusy: false,
  onApply: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
};

describe("LineupTemplatesPanel", () => {
  it("shows a loading message until templates arrive", () => {
    render(<LineupTemplatesPanel {...baseProps} templates={undefined} />);
    expect(screen.getByText(/loading templates/i)).toBeInTheDocument();
  });

  it("lists templates most recently updated first", () => {
    render(
      <LineupTemplatesPanel
        {...baseProps}
        templates={[tpl("a", "Older", "2026-01-01T00:00:00Z"), tpl("b", "Newer", "2026-06-01T00:00:00Z")]}
      />
    );
    const names = screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);
    expect(names).toEqual(["Newer", "Older"]);
  });

  it("shows a load error without hiding the list", () => {
    render(
      <LineupTemplatesPanel
        {...baseProps}
        error="Could not refresh"
        templates={[tpl("a", "Kept", "2026-01-01T00:00:00Z")]}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh");
    expect(screen.getByText("Kept")).toBeInTheDocument();
  });

  it("previews the selected template with player names and passes the mapping to onApply", () => {
    const onApply = vi.fn();
    render(
      <LineupTemplatesPanel {...baseProps} onApply={onApply} templates={[tpl("a", "Standard", "2026-01-01T00:00:00Z")]} />
    );
    fireEvent.click(screen.getByRole("button", { name: /^standard/i }));
    expect(screen.getByText("#1 Ann Alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /apply template/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][1].startingLineup.get("gk")).toBe("p1");
  });

  it("shows the blocked reason and disables Apply", () => {
    render(
      <LineupTemplatesPanel
        {...baseProps}
        applyBlockedReason="You're offline."
        templates={[tpl("a", "Standard", "2026-01-01T00:00:00Z")]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^standard/i }));
    expect(screen.getByText("You're offline.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply template/i })).toBeDisabled();
  });

  it("shows rename and delete inline on every row without a popover", () => {
    render(<LineupTemplatesPanel {...baseProps} templates={[tpl("a", "Standard", "2026-01-01T00:00:00Z"), tpl("b", "Press", "2026-01-02T00:00:00Z")]} />);
    expect(screen.getByRole("button", { name: "Rename Standard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Press" })).toBeInTheDocument();
  });

  it("hides rename/delete and explains why when the team is read-only", () => {
    render(
      <LineupTemplatesPanel
        {...baseProps}
        canManage={false}
        manageBlockedReason="This team is archived. Templates are read-only."
        templates={[tpl("a", "Standard", "2026-01-01T00:00:00Z")]}
      />
    );
    expect(screen.queryByRole("button", { name: /rename standard/i })).not.toBeInTheDocument();
    expect(screen.getByText("This team is archived. Templates are read-only.")).toBeInTheDocument();
  });

  it("shows the load error with Retry and no empty-state text when loading failed", () => {
    const onRetry = vi.fn();
    render(<LineupTemplatesPanel {...baseProps} templates={[]} error="Failed to load templates" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load templates");
    expect(screen.queryByText(/no saved templates yet/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("links the Apply button to the blocked reason", () => {
    render(
      <LineupTemplatesPanel
        {...baseProps}
        applyBlockedReason="You're offline."
        templates={[tpl("a", "Standard", "2026-01-01T00:00:00Z")]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^standard/i }));
    const apply = screen.getByRole("button", { name: /apply template/i });
    expect(apply).toHaveAttribute("aria-describedby", screen.getByText("You're offline.").id);
  });
});
