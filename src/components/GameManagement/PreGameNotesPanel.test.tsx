import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { PreGameNotesPanel } from "./PreGameNotesPanel";
import { getCurrentUser } from "aws-amplify/auth";
import type { TeamCoachProfileDTO } from "../../services/coachDisplayNameService";

vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn(),
}));

const mockedGetCurrentUser = vi.mocked(getCurrentUser);

const notes = [
  {
    id: 'n1',
    noteType: 'coaching-point',
    playerId: 'p1',
    notes: 'Press quickly after turnovers',
    authorId: 'current-user-id',
  },
  {
    id: 'n2',
    noteType: 'coaching-point',
    playerId: null,
    notes: 'Keep shape compact in midfield',
    authorId: 'coach-2',
  },
  {
    id: 'n4',
    noteType: 'coaching-point',
    playerId: null,
    notes: 'Duplicate name disambiguation check',
    authorId: 'coach-3',
  },
  {
    id: 'n5',
    noteType: 'coaching-point',
    playerId: null,
    notes: 'Missing profile display check',
    authorId: 'coach-4',
  },
  {
    id: 'n6',
    noteType: 'coaching-point',
    playerId: null,
    notes: 'Removed coach label check',
    authorId: 'coach-removed',
  },
  {
    id: 'n3',
    noteType: 'coaching-point',
    playerId: null,
    notes: 'Use voice to organize transitions',
    authorId: null,
  },
] as never[];

const players = [
  { id: 'p1', playerNumber: 10, firstName: 'Ava', lastName: 'Lopez' },
] as never[];

const profileMap = new Map<string, TeamCoachProfileDTO>([
  [
    'coach-2',
    {
      coachId: 'coach-2',
      displayName: 'Alex P. (Coach 1)',
      isFallback: false,
      disambiguationGroupKey: 'alex p.',
    },
  ],
  [
    'coach-3',
    {
      coachId: 'coach-3',
      displayName: 'Alex P. (Coach 2)',
      isFallback: false,
      disambiguationGroupKey: 'alex p.',
    },
  ],
  [
    'coach-4',
    {
      coachId: 'coach-4',
      displayName: null,
      isFallback: true,
      disambiguationGroupKey: null,
    },
  ],
]);

function renderPanel(
  gameStatus: 'scheduled' | 'in-progress' | 'halftime' | 'completed' = 'scheduled',
) {
  return render(
    <PreGameNotesPanel
      gameStatus={gameStatus}
      notes={notes}
      players={players}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      profileMap={profileMap}
    />,
  );
}

describe('PreGameNotesPanel', () => {
  beforeEach(() => {
    mockedGetCurrentUser.mockReset();
    mockedGetCurrentUser.mockRejectedValue(new Error('Not signed in'));
  });

  it('renders attribution matrix labels for You, named coach, duplicate name, Coach fallback, Former Coach, and Unknown Author', async () => {
    mockedGetCurrentUser.mockResolvedValue({
      username: 'coach@example.com',
      userId: 'current-user-id',
      signInDetails: undefined,
    });

    renderPanel('scheduled');

    expect(await screen.findByText('Created by: You')).toBeInTheDocument();
    expect(screen.getByText('Created by: Alex P. (Coach 1)')).toBeInTheDocument();
    expect(screen.getByText('Created by: Alex P. (Coach 2)')).toBeInTheDocument();
    expect(screen.getByText('Created by: Coach')).toBeInTheDocument();
    expect(screen.getByText('Created by: Former Coach')).toBeInTheDocument();
    expect(screen.getByText('Created by: Unknown Author')).toBeInTheDocument();
    expect(screen.getByText('#10 Ava Lopez')).toBeInTheDocument();
    expect(screen.getAllByText('General Note')).toHaveLength(5);
  });

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
