import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatsSubViewTabs } from "./StatsSubViewTabs";

describe("StatsSubViewTabs", () => {
  it("renders Goals/Shots/Saves tabs with the active one marked aria-selected", () => {
    render(<StatsSubViewTabs activeSubView="shots" onChange={vi.fn()} idPrefix="test" />);

    expect(screen.getByRole("tab", { name: "Goals" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Shots" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Saves" })).toHaveAttribute("aria-selected", "false");
  });

  it("uses a distinguishing aria-label so it doesn't collide with the outer TabNav's tablist", () => {
    render(<StatsSubViewTabs activeSubView="goals" onChange={vi.fn()} idPrefix="test" />);
    expect(screen.getByRole("tablist", { name: "Goals sub-view" })).toBeInTheDocument();
  });

  it("uses roving tabindex so only the active tab is tabbable", () => {
    render(<StatsSubViewTabs activeSubView="goals" onChange={vi.fn()} idPrefix="test" />);
    expect(screen.getByRole("tab", { name: "Goals" })).toHaveAttribute("tabIndex", "0");
    expect(screen.getByRole("tab", { name: "Shots" })).toHaveAttribute("tabIndex", "-1");
    expect(screen.getByRole("tab", { name: "Saves" })).toHaveAttribute("tabIndex", "-1");
  });

  it("calls onChange when a pill is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatsSubViewTabs activeSubView="goals" onChange={onChange} idPrefix="test" />);

    await user.click(screen.getByRole("tab", { name: "Shots" }));
    expect(onChange).toHaveBeenCalledWith("shots");
  });

  it("moves selection to the next tab on ArrowRight, wrapping past the last", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatsSubViewTabs activeSubView="saves" onChange={onChange} idPrefix="test" />);

    screen.getByRole("tab", { name: "Saves" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("goals");
  });

  it("moves selection to the previous tab on ArrowLeft, wrapping past the first", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatsSubViewTabs activeSubView="goals" onChange={onChange} idPrefix="test" />);

    screen.getByRole("tab", { name: "Goals" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenCalledWith("saves");
  });

  it("jumps to the first tab on Home and the last tab on End", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatsSubViewTabs activeSubView="shots" onChange={onChange} idPrefix="test" />);

    screen.getByRole("tab", { name: "Shots" }).focus();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenCalledWith("goals");

    onChange.mockClear();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenCalledWith("saves");
  });
});
