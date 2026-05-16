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

function RichBodyHarness() {
  const confirm = useConfirm();

  return (
    <button
      type="button"
      onClick={async () => {
        await confirm({
          title: "Delete note?",
          message: "This permanently removes this note.",
          bodyContent: (
            <>
              <p className="confirm-message">This permanently removes this note.</p>
              <p className="confirm-message">Only the original author can confirm this delete.</p>
            </>
          ),
          confirmText: "Delete",
          cancelText: "Cancel",
          variant: "danger",
        });
      }}
    >
      Delete Note
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

describe("ConfirmProvider bodyContent", () => {
  it("renders rich bodyContent inside the aria-describedby container", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmProvider>
        <RichBodyHarness />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Delete Note" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    // Both paragraphs are rendered
    expect(screen.getByText("This permanently removes this note.")).toBeInTheDocument();
    expect(screen.getByText("Only the original author can confirm this delete.")).toBeInTheDocument();

    // aria-describedby points to the container holding both paragraphs
    const describedById = dialog.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const container = document.getElementById(describedById!);
    expect(container).toBeInTheDocument();
    expect(container).toHaveTextContent("This permanently removes this note.");
    expect(container).toHaveTextContent("Only the original author can confirm this delete.");
  });

  it("falls back to plain message paragraph when bodyContent is not provided", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Manage Injury" }));

    const dialog = screen.getByRole("alertdialog");
    const describedById = dialog.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const container = document.getElementById(describedById!);
    expect(container?.tagName).toBe("P");
    expect(container).toHaveTextContent("Continue with this action?");
  });
});
