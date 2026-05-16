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
  it("renders exactly five tabs with labels Plan, Field, Bench, Goals, Notes", () => {
    render(<TabNav {...defaultProps} />);
    expect(screen.getByRole("tab", { name: /Plan/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Field/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Bench/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Goals/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Notes/ })).toBeInTheDocument();
  });

  // ── Active tab ───────────────────────────────────────────────────────────
  it("marks only the active tab as aria-selected=true", () => {
    render(<TabNav {...defaultProps} activeTab="goals" />);
    expect(screen.getByRole("tab", { name: /Plan/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Goals/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Field/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Bench/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Notes/ })).toHaveAttribute("aria-selected", "false");
  });

  it("uses roving tabindex so only the active tab is tabbable", () => {
    render(<TabNav {...defaultProps} activeTab="field" />);
    expect(screen.getByRole("tab", { name: /Field/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Plan/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: /Bench/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: /Goals/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: /Notes/ })).toHaveAttribute("tabindex", "-1");
  });

  it("wires each tab to an aria-controls target id", () => {
    render(<TabNav {...defaultProps} tabPanelIdPrefix="gm-tab" />);
    expect(screen.getByRole("tab", { name: /Plan/ })).toHaveAttribute("aria-controls", "gm-tab-plan");
    expect(screen.getByRole("tab", { name: /Field/ })).toHaveAttribute("aria-controls", "gm-tab-field");
    expect(screen.getByRole("tab", { name: /Bench/ })).toHaveAttribute("aria-controls", "gm-tab-bench");
    expect(screen.getByRole("tab", { name: /Goals/ })).toHaveAttribute("aria-controls", "gm-tab-goals");
    expect(screen.getByRole("tab", { name: /Notes/ })).toHaveAttribute("aria-controls", "gm-tab-notes");
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

  it("calls onTabChange with adjacent tab on ArrowRight", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<TabNav {...defaultProps} activeTab="field" onTabChange={onTabChange} />);

    const fieldTab = screen.getByRole("tab", { name: /Field/ });
    fieldTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(onTabChange).toHaveBeenCalledWith("bench");
  });

  it("calls onTabChange with first tab on Home and last tab on End", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<TabNav {...defaultProps} activeTab="goals" onTabChange={onTabChange} />);

    const goalsTab = screen.getByRole("tab", { name: /Goals/ });
    goalsTab.focus();
    await user.keyboard("{Home}");
    await user.keyboard("{End}");

    expect(onTabChange).toHaveBeenNthCalledWith(1, "plan");
    expect(onTabChange).toHaveBeenNthCalledWith(2, "notes");
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
