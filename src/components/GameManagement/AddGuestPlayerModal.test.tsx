import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddGuestPlayerModal } from "./AddGuestPlayerModal";

const positions = [{ id: "p1", abbreviation: "GK", positionName: "Goalkeeper" }];

describe("AddGuestPlayerModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <AddGuestPlayerModal isOpen={false} positions={positions} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("submits entered values and closes on success", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<AddGuestPlayerModal isOpen positions={positions} onClose={onClose} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/first name/i), "Sam");
    await userEvent.type(screen.getByLabelText(/last name/i), "Lee");
    await userEvent.click(screen.getByRole("button", { name: "Add Guest" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Sam", lastName: "Lee", jerseyNumber: "" }));
  });

  it("stays open when submit resolves false", async () => {
    const onClose = vi.fn();
    render(<AddGuestPlayerModal isOpen positions={positions} onClose={onClose} onSubmit={vi.fn().mockResolvedValue(false)} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Guest" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Guest" })).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a second submit while one is in flight", async () => {
    let resolve!: (v: boolean) => void;
    const onSubmit = vi.fn().mockReturnValue(new Promise<boolean>(r => { resolve = r; }));
    render(<AddGuestPlayerModal isOpen positions={positions} onClose={vi.fn()} onSubmit={onSubmit} />);
    const btn = screen.getByRole("button", { name: "Add Guest" });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: /Adding/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve(false);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<AddGuestPlayerModal isOpen positions={positions} onClose={onClose} onSubmit={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
