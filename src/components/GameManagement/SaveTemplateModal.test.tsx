import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveTemplateModal } from "./SaveTemplateModal";

describe("SaveTemplateModal", () => {
  it("submits the trimmed name and closes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SaveTemplateModal mode="save" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "  Standard  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Standard"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a validation error and does not submit an empty name", () => {
    const onSubmit = vi.fn();
    render(<SaveTemplateModal mode="save" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter a name/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a name over 60 characters", () => {
    const onSubmit = vi.fn();
    render(<SaveTemplateModal mode="save" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "a".repeat(61) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/60/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the Save label and marks the input invalid on a validation error", () => {
    render(<SaveTemplateModal mode="save" onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    const input = screen.getByLabelText("Template name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
    expect(input).toHaveAttribute("maxlength", "60");
  });

  it("returns focus to the element that opened it when it closes", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<SaveTemplateModal mode="save" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("keeps the modal open with an inline error and a Retry button when saving fails", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("Network down")).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<SaveTemplateModal mode="save" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Standard" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Network down");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("prefills the name in rename mode and closes on Escape", () => {
    const onClose = vi.fn();
    render(<SaveTemplateModal mode="rename" initialName="Old name" onSubmit={vi.fn()} onClose={onClose} />);
    expect(screen.getByLabelText("Template name")).toHaveValue("Old name");
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
