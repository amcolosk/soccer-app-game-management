import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "./ConfirmModal";

function ConfirmHarness() {
  const confirm = useConfirm();

  return (
    <button
      type="button"
      onClick={async () => {
        await confirm({
          title: "Confirm Injury Action",
          message: "Continue with this action?",
          confirmText: "Confirm",
          cancelText: "Cancel",
          variant: "warning",
        });
      }}
    >
      Manage Injury
    </button>
  );
}

describe("ConfirmProvider focus management", () => {
  it("returns focus to the invoking control after cancel", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Manage Injury" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("returns focus to the invoking control after confirm", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Manage Injury" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("supports keyboard cancel via Escape and restores focus", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Manage Injury" });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
