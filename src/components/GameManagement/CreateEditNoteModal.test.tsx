import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateEditNoteModal } from "./CreateEditNoteModal";

const { mockShowError } = vi.hoisted(() => ({
  mockShowError: vi.fn(),
}));

vi.mock('../../utils/toast', () => ({
  showError: mockShowError,
}));

const players = [
  { id: 'p1', playerNumber: 9, firstName: 'Mia', lastName: 'Jones' },
] as never[];

describe('CreateEditNoteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits valid form data', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateEditNoteModal
        isOpen={true}
        mode={'create'}
        players={players}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText('Coaching note text'), 'Stay compact out of possession');
    await user.selectOptions(screen.getByLabelText('Select player for note'), 'p1');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(onSubmit).toHaveBeenCalledWith({
      notes: 'Stay compact out of possession',
      playerId: 'p1',
    });
  });

  it('shows validation error for empty notes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CreateEditNoteModal
        isOpen={true}
        mode={'create'}
        players={players}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mockShowError).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error when note exceeds 500 characters', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CreateEditNoteModal
        isOpen={true}
        mode={'create'}
        players={players}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Coaching note text'), {
      target: { value: 'a'.repeat(501) },
    });
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mockShowError).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('supports Ctrl+Enter submit and Escape close shortcuts', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <CreateEditNoteModal
        isOpen={true}
        mode={'create'}
        players={players}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText('Coaching note text'), 'Trigger submit with keyboard');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('focuses note textarea when opened and renders player options', () => {
    render(
      <CreateEditNoteModal
        isOpen={true}
        mode={'edit'}
        players={players}
        initialNote={{
          id: 'n1',
          noteType: 'coaching-point',
          playerId: null,
          notes: 'Initial note',
        } as never}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const noteInput = screen.getByLabelText('Coaching note text');
    expect(noteInput).toHaveFocus();
    expect(screen.getByRole('option', { name: 'General Note' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '#9 Mia Jones' })).toBeInTheDocument();
  });
});
