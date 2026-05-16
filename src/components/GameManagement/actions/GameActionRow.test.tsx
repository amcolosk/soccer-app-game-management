import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { GameActionRow } from './GameActionRow';
import type { GameActionDescriptor } from './actionContract';
import { ConfirmProvider } from '../../ConfirmModal';

function createActions(onDelete: () => Promise<void> | void): GameActionDescriptor[] {
  return [
    {
      id: 'edit',
      label: 'Edit',
      kind: 'primary',
      ariaLabel: 'Edit note',
      onAction: vi.fn(),
    },
    {
      id: 'delete',
      label: 'Delete',
      kind: 'destructive',
      ariaLabel: 'Delete note',
      confirmDialog: {
        title: 'Delete note?',
        body: 'This permanently removes this note from the game timeline.',
        authorReminder: 'Only the original author can confirm this delete.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
      },
      onAction: onDelete,
    },
  ];
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<ConfirmProvider>{ui}</ConfirmProvider>);
}

describe('GameActionRow keyboard and focus contract', () => {
  it('cancels with Escape and returns focus to invoking button', async () => {
    const user = userEvent.setup();
    renderWithProvider(<GameActionRow actions={createActions(vi.fn())} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete note' });
    await user.click(deleteButton);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(deleteButton);
    });
  });

  it('returns focus to invoking button on Cancel', async () => {
    const user = userEvent.setup();
    renderWithProvider(<GameActionRow actions={createActions(vi.fn())} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete note' });
    await user.click(deleteButton);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(deleteButton);
    });
  });

  it('returns focus to invoking button after successful delete confirmation', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);

    renderWithProvider(<GameActionRow actions={createActions(onDelete)} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete note' });
    await user.click(deleteButton);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(deleteButton);
    });
  });

  it('falls back to heading focus when deleted row unmounts and invoking button is removed', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [deleted, setDeleted] = useState(false);

      const actions: GameActionDescriptor[] = [
        {
          id: 'edit',
          label: 'Edit',
          kind: 'primary',
          ariaLabel: 'Edit note',
          onAction: vi.fn(),
        },
        {
          id: 'delete',
          label: 'Delete',
          kind: 'destructive',
          ariaLabel: 'Delete note',
          confirmDialog: {
            title: 'Delete note?',
            body: 'This permanently removes this note from the game timeline.',
            confirmText: 'Delete',
            cancelText: 'Cancel',
          },
          onAction: async () => {
            setDeleted(true);
          },
        },
      ];

      return (
        <>
          <h3 id="notes-heading" tabIndex={-1}>Game Notes</h3>
          {!deleted && <GameActionRow actions={actions} headingIdForDeleteSuccessFocus="notes-heading" />}
        </>
      );
    }

    render(
      <ConfirmProvider>
        <Harness />
      </ConfirmProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete note' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Game Notes' }));
    });
  });

  it('shows rich body content in confirm modal (warning + author reminder)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<GameActionRow actions={createActions(vi.fn())} />);

    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('This permanently removes this note from the game timeline.')).toBeInTheDocument();
    expect(screen.getByText('Only the original author can confirm this delete.')).toBeInTheDocument();
  });

  it('blocks duplicate delete submissions while delete is in-flight', async () => {
    const user = userEvent.setup();
    let resolveDelete!: () => void;
    const onDelete = vi.fn().mockImplementation(
      () => new Promise<void>((res) => { resolveDelete = res; })
    );

    renderWithProvider(<GameActionRow actions={createActions(onDelete)} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete note' });
    await user.click(deleteButton);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // While in-flight, the delete button should be disabled
    await waitFor(() => {
      expect(deleteButton).toBeDisabled();
    });

    // Resolve the in-flight delete
    resolveDelete();
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });
});
