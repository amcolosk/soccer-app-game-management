import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerSelect } from "./PlayerSelect";

const makePlayers = () => [
  { id: "p1", firstName: "Alice", lastName: "Smith", playerNumber: 10, createdAt: "", updatedAt: "" },
  { id: "p2", firstName: "Bob", lastName: "Jones", playerNumber: 3, createdAt: "", updatedAt: "" },
  { id: "p3", firstName: "Charlie", lastName: "Brown", playerNumber: 7, createdAt: "", updatedAt: "" },
];

describe("PlayerSelect", () => {
  it("renders a select with default placeholder", () => {
    render(<PlayerSelect players={[]} value="" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Select player...")).toBeInTheDocument();
  });

  it("renders player options sorted by playerNumber", () => {
    render(<PlayerSelect players={makePlayers()} value="" onChange={() => {}} />);
    const options = screen.getAllByRole("option");
    // First option is the placeholder
    expect(options[1]).toHaveTextContent("#3 - Bob Jones");
    expect(options[2]).toHaveTextContent("#7 - Charlie Brown");
    expect(options[3]).toHaveTextContent("#10 - Alice Smith");
  });

  it("renders custom placeholder", () => {
    render(
      <PlayerSelect players={[]} value="" onChange={() => {}} placeholder="Pick one" />
    );
    expect(screen.getByText("Pick one")).toBeInTheDocument();
  });

  it("renders with the correct selected value", () => {
    render(<PlayerSelect players={makePlayers()} value="p1" onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toHaveValue("p1");
  });

  it("excludes the player matching excludeId", () => {
    render(
      <PlayerSelect players={makePlayers()} value="" onChange={() => {}} excludeId="p2" />
    );
    const options = screen.getAllByRole("option");
    // placeholder + 2 remaining players
    expect(options).toHaveLength(3);
    expect(screen.queryByText(/#3 - Bob Jones/)).not.toBeInTheDocument();
  });

  it("renders all players when excludeId is not provided", () => {
    render(<PlayerSelect players={makePlayers()} value="" onChange={() => {}} />);
    // placeholder + 3 players
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("calls onChange with selected player id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PlayerSelect players={makePlayers()} value="" onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox"), "p3");
    expect(onChange).toHaveBeenCalledWith("p3");
  });

  it("renders a disabled select when disabled=true", () => {
    render(
      <PlayerSelect players={makePlayers()} value="" onChange={() => {}} disabled />
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("applies className and id props", () => {
    render(
      <PlayerSelect
        players={[]}
        value=""
        onChange={() => {}}
        className="custom-class"
        id="my-select"
      />
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveAttribute("id", "my-select");
    expect(select).toHaveClass("custom-class");
  });
});
