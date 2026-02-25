import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabNav } from "./TabNav";

const defaultProps = {
  activeTab: "field" as const,
  onTabChange: vi.fn(),
  substitutionQueueCount: 0,
};

describe("TabNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────
  it("renders exactly four tabs with labels Field, Bench, Goals, Notes", () => {
    render(<TabNav {...defaultProps} />);
    expect(screen.getByRole("tab", { name: /Field/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Bench/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Goals/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Notes/ })).toBeInTheDocument();
  });

  // ── Active tab ───────────────────────────────────────────────────────────
  it("marks only the active tab as aria-selected=true", () => {
    render(<TabNav {...defaultProps} activeTab="goals" />);
    expect(screen.getByRole("tab", { name: /Goals/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Field/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Bench/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Notes/ })).toHaveAttribute("aria-selected", "false");
  });

  // ── Tab click callbacks ──────────────────────────────────────────────────
  it("calls onTabChange with 'bench' when Bench tab is clicked", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<TabNav {...defaultProps} onTabChange={onTabChange} />);
    await user.click(screen.getByRole("tab", { name: /Bench/ }));
    expect(onTabChange).toHaveBeenCalledWith("bench");
  });

  it("calls onTabChange with 'goals' when Goals tab is clicked", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<TabNav {...defaultProps} onTabChange={onTabChange} />);
    await user.click(screen.getByRole("tab", { name: /Goals/ }));
    expect(onTabChange).toHaveBeenCalledWith("goals");
  });

  it("calls onTabChange with 'notes' when Notes tab is clicked", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<TabNav {...defaultProps} onTabChange={onTabChange} />);
    await user.click(screen.getByRole("tab", { name: /Notes/ }));
    expect(onTabChange).toHaveBeenCalledWith("notes");
  });

  it("calls onTabChange with 'field' when Field tab is clicked", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<TabNav {...defaultProps} activeTab="bench" onTabChange={onTabChange} />);
    await user.click(screen.getByRole("tab", { name: /Field/ }));
    expect(onTabChange).toHaveBeenCalledWith("field");
  });

  // ── Queue badge ──────────────────────────────────────────────────────────
  it("shows badge on Field tab when substitutionQueueCount is greater than 0", () => {
    render(<TabNav {...defaultProps} substitutionQueueCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("displays the exact substitutionQueueCount in the badge", () => {
    render(<TabNav {...defaultProps} substitutionQueueCount={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does not show a badge when substitutionQueueCount is 0", () => {
    render(<TabNav {...defaultProps} substitutionQueueCount={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("badge appears only on the Field tab button, not on Bench/Goals/Notes", () => {
    render(<TabNav {...defaultProps} substitutionQueueCount={2} />);
    const benchTab = screen.getByRole("tab", { name: /Bench/ });
    const goalsTab = screen.getByRole("tab", { name: /Goals/ });
    const notesTab = screen.getByRole("tab", { name: /Notes/ });
    // Badge element should not be inside these tabs
    expect(benchTab.querySelector(".game-tab-nav__badge")).toBeNull();
    expect(goalsTab.querySelector(".game-tab-nav__badge")).toBeNull();
    expect(notesTab.querySelector(".game-tab-nav__badge")).toBeNull();
  });
});
