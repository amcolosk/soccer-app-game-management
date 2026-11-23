import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddGuestPlayerButton } from "./AddGuestPlayerButton";

describe("AddGuestPlayerButton", () => {
  it("renders nothing without an action", () => {
    const { container } = render(<AddGuestPlayerButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onOpen when clicked", async () => {
    const onOpen = vi.fn();
    render(<AddGuestPlayerButton action={{ onOpen }} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add Guest Player" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("is disabled and explains why when a reason is given", () => {
    render(<AddGuestPlayerButton action={{ onOpen: vi.fn(), disabledReason: "Reconnect to add a guest player" }} />);
    const btn = screen.getByRole("button", { name: "+ Add Guest Player" });
    expect(btn).toBeDisabled();
    expect(screen.getByText("Reconnect to add a guest player")).toBeInTheDocument();
  });
});
