import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreGameNotesPanel } from "./PreGameNotesPanel";

const notes = [
  {
    id: 'n1',
    noteType: 'coaching-point',
    playerId: 'p1',
    notes: 'Press quickly after turnovers',
    authorId: 'coach-123',
  },
  {
    id: 'n2',
    noteType: 'coaching-point',
    playerId: null,
    notes: 'Keep shape compact in midfield',
    authorId: null,
  },
] as never[];

const players = [
  { id: 'p1', playerNumber: 10, firstName: 'Ava', lastName: 'Lopez' },
] as never[];

function renderPanel(gameStatus: 'scheduled' | 'in-progress' | 'halftime' | 'completed' = 'scheduled') {
  return render(
    <PreGameNotesPanel
      gameStatus={gameStatus}
      notes={notes}
      players={players}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe('PreGameNotesPanel', () => {
  it('renders empty state when no notes exist', () => {
    render(
      <PreGameNotesPanel
        gameStatus={'scheduled'}
        notes={[]}
        players={players}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('No coaching points yet.')).toBeInTheDocument();
  });

  it('renders author attribution and player-specific/general labels', () => {
    renderPanel('scheduled');

    expect(screen.getByText('Created by: coach-123')).toBeInTheDocument();
    expect(screen.getByText('Created by: Unknown Author')).toBeInTheDocument();
    expect(screen.getByText('#10 Ava Lopez')).toBeInTheDocument();
    expect(screen.getByText('General Note')).toBeInTheDocument();
  });

  it('calls add/edit/delete handlers when unlocked', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <PreGameNotesPanel
        gameStatus={'scheduled'}
        notes={notes}
        players={players}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add coaching point' }));
    await user.click(screen.getAllByRole('button', { name: 'Edit coaching point' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Delete coaching point' })[0]);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('disables controls during in-progress and halftime soft-lock', () => {
    const { rerender } = render(
      <PreGameNotesPanel
        gameStatus={'in-progress'}
        notes={notes}
        players={players}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add coaching point' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Edit coaching point' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Delete coaching point' })[0]).toBeDisabled();

    rerender(
      <PreGameNotesPanel
        gameStatus={'halftime'}
        notes={notes}
        players={players}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add coaching point' })).toBeDisabled();
  });

  it('keeps controls enabled again in completed state', () => {
    render(
      <PreGameNotesPanel
        gameStatus={'completed'}
        notes={notes}
        players={players}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add coaching point' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Edit coaching point' })[0]).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Delete coaching point' })[0]).toBeEnabled();
  });

  it('renders responsive grid container for note cards', () => {
    renderPanel('scheduled');
    expect(screen.getByTestId('pre-game-notes-grid')).toBeInTheDocument();
  });
});
