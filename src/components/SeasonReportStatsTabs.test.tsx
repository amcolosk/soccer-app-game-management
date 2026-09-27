import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeasonReportStatsTabs } from "./SeasonReportStatsTabs";

describe("SeasonReportStatsTabs", () => {
  it("renders Field/Goalkeeper tabs with the active one marked aria-selected", () => {
    render(<SeasonReportStatsTabs activeView="goalkeeper" onChange={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Field" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Goalkeeper" })).toHaveAttribute("aria-selected", "true");
  });

  it("uses a distinguishing aria-label for the tablist", () => {
    render(<SeasonReportStatsTabs activeView="field" onChange={vi.fn()} />);
    expect(screen.getByRole("tablist", { name: "Player statistics view" })).toBeInTheDocument();
  });

  it("uses roving tabindex so only the active tab is tabbable", () => {
    render(<SeasonReportStatsTabs activeView="field" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Field" })).toHaveAttribute("tabIndex", "0");
    expect(screen.getByRole("tab", { name: "Goalkeeper" })).toHaveAttribute("tabIndex", "-1");
  });

  it("calls onChange when the inactive tab is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeasonReportStatsTabs activeView="field" onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Goalkeeper" }));
    expect(onChange).toHaveBeenCalledWith("goalkeeper");
  });

  it("moves selection to the next tab on ArrowRight, wrapping past the last", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeasonReportStatsTabs activeView="goalkeeper" onChange={onChange} />);

    screen.getByRole("tab", { name: "Goalkeeper" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("field");
  });

  it("moves selection to the previous tab on ArrowLeft, wrapping past the first", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeasonReportStatsTabs activeView="field" onChange={onChange} />);

    screen.getByRole("tab", { name: "Field" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenCalledWith("goalkeeper");
  });

  it("jumps to the first tab on Home", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeasonReportStatsTabs activeView="goalkeeper" onChange={onChange} />);

    screen.getByRole("tab", { name: "Goalkeeper" }).focus();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenCalledWith("field");
  });

  it("jumps to the last tab on End", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SeasonReportStatsTabs activeView="field" onChange={onChange} />);

    screen.getByRole("tab", { name: "Field" }).focus();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenCalledWith("goalkeeper");
  });
});
