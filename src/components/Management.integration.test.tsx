import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FORMATION_TEMPLATES } from '../../amplify/data/formation-templates';
import '../test/mockAmplifyClient';
import { Management } from './Management';
import { renderWithProviders } from '../test/renderWithProviders';
import {
  managementModelMocks,
  managementUiMocks,
  setConfirmResult,
} from '../test/mockAmplifyClient';
import {
  formationFixture,
  managementFixtures,
  playerFixture,
  teamFixture,
} from '../test/fixtures/managementFixtures';

describe('Management integration', () => {
  it('creates a team from a custom formation selection', async () => {
    const user = userEvent.setup();
    const customFormation = formationFixture({
      id: 'formation-custom',
      name: 'Custom 3-2-1',
      playerCount: 7,
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({
        Formation: [customFormation],
      }),
    });

    await user.click(screen.getByRole('button', { name: /\+ create new team/i }));
    await user.type(screen.getByPlaceholderText(/enter team name/i), 'Custom Team');
    await user.clear(screen.getByPlaceholderText(/enter max players/i));
    await user.type(screen.getByPlaceholderText(/enter max players/i), '7');
    await user.clear(screen.getByPlaceholderText(/enter half length/i));
    await user.type(screen.getByPlaceholderText(/enter half length/i), '25');
    await user.selectOptions(screen.getByLabelText('Formation'), 'formation-custom');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(managementModelMocks.Team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Custom Team',
          formationId: 'formation-custom',
          coaches: ['test-user-id'],
        }),
      );
    });

    expect(screen.queryByRole('heading', { name: /create new team/i })).not.toBeInTheDocument();
  });

  it('creates a team from a template formation selection', async () => {
    const user = userEvent.setup();
    const template = FORMATION_TEMPLATES[0];

    managementModelMocks.Formation.create.mockResolvedValueOnce({ data: { id: 'template-formation-id' } });

    renderWithProviders(<Management />);

    await user.click(screen.getByRole('button', { name: /\+ create new team/i }));
    await user.type(screen.getByPlaceholderText(/enter team name/i), 'Template Team');
    await user.clear(screen.getByPlaceholderText(/enter max players/i));
    await user.type(screen.getByPlaceholderText(/enter max players/i), String(template.playerCount));
    await user.clear(screen.getByPlaceholderText(/enter half length/i));
    await user.type(screen.getByPlaceholderText(/enter half length/i), '25');

    const formationSelect = screen.getByLabelText('Formation');
    const templateOption = Array.from(formationSelect.querySelectorAll('option')).find((option) =>
      option.value.startsWith('template-'),
    );

    expect(templateOption).toBeTruthy();
    await user.selectOptions(formationSelect, templateOption!.value);
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(managementModelMocks.Formation.create).toHaveBeenCalledTimes(1);
      expect(managementModelMocks.FormationPosition.create).toHaveBeenCalledTimes(template.positions.length);
      expect(managementModelMocks.Team.create).toHaveBeenCalledWith(
        expect.objectContaining({ formationId: 'template-formation-id' }),
      );
    });
  });

  it('validates and creates a player from the players tab', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Management />);

    await user.click(screen.getByRole('button', { name: /players/i }));
    await user.click(screen.getByRole('button', { name: /\+ add player/i }));

    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(managementUiMocks.toast.showWarning).toHaveBeenCalledWith('Please enter first name and last name');

    await user.type(screen.getByPlaceholderText(/first name/i), 'Jordan');
    await user.type(screen.getByPlaceholderText(/last name/i), 'Miles');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(managementModelMocks.Player.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Jordan',
          lastName: 'Miles',
          coaches: ['test-user-id'],
        }),
      );
    });
  });

  it('supports formation create and cancel UX transitions', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Management />);

    await user.click(screen.getByRole('button', { name: /formations/i }));
    await user.click(screen.getByRole('button', { name: /\+ create formation/i }));

    await user.type(screen.getByPlaceholderText(/formation name/i), '7v7 Build');
    await user.type(screen.getByPlaceholderText(/number of players on field/i), '3');

    const rows = screen.getAllByPlaceholderText(/position name/i);
    expect(rows).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('heading', { name: /create new formation/i })).not.toBeInTheDocument();
  });

  it('respects delete cancel and confirm decisions for team records', async () => {
    const user = userEvent.setup();
    const team = teamFixture({ id: 'team-delete', name: 'Delete Me FC' });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
      swipedItemId: 'team-delete',
    });

    setConfirmResult(false);
    await user.click(screen.getByRole('button', { name: /delete team/i }));
    await waitFor(() => {
      expect(managementUiMocks.confirm).toHaveBeenCalled();
    });
    expect(managementUiMocks.cascade.deleteTeamCascade).not.toHaveBeenCalled();

    setConfirmResult(true);
    await user.click(screen.getByRole('button', { name: /delete team/i }));
    await waitFor(() => {
      expect(managementUiMocks.cascade.deleteTeamCascade).toHaveBeenCalledWith('team-delete');
    });
  });

  it('respects delete cancel and confirm decisions for player records', async () => {
    const user = userEvent.setup();
    const player = playerFixture({ id: 'player-delete', firstName: 'Delete', lastName: 'Player' });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Player: [player] }),
      swipedItemId: 'player-delete',
    });

    await user.click(screen.getByRole('button', { name: /players/i }));

    setConfirmResult(false);
    await user.click(screen.getByRole('button', { name: /delete player/i }));
    await waitFor(() => {
      expect(managementUiMocks.confirm).toHaveBeenCalled();
    });
    expect(managementUiMocks.cascade.deletePlayerCascade).not.toHaveBeenCalled();

    setConfirmResult(true);
    await user.click(screen.getByRole('button', { name: /delete player/i }));
    await waitFor(() => {
      expect(managementUiMocks.cascade.deletePlayerCascade).toHaveBeenCalledWith('player-delete');
    });
  });

  it('keeps roster add rollback behavior when player coach update fails', async () => {
    const user = userEvent.setup();
    const team = teamFixture({ id: 'team-1', coaches: ['owner-a', 'coach-b'] });
    const player = playerFixture({ id: 'player-1', coaches: ['owner-a'] });

    managementModelMocks.TeamRoster.create.mockResolvedValueOnce({ data: { id: 'roster-created' } });
    managementModelMocks.Player.update.mockRejectedValueOnce(new Error('update failed'));

    renderWithProviders(<Management />, {
      queryData: managementFixtures({
        Team: [team],
        Player: [player],
      }),
    });

    await user.click(screen.getByRole('button', { name: /show roster/i }));
    await user.click(screen.getByRole('button', { name: /\+ add player to roster/i }));

    const addForm = screen.getByRole('heading', { name: /add player to roster/i }).closest('div');
    if (!addForm) throw new Error('Expected add player form container');

    await user.selectOptions(within(addForm).getByRole('combobox'), 'player-1');
    await user.type(within(addForm).getByPlaceholderText(/player number/i), '11');
    await user.click(within(addForm).getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(managementModelMocks.TeamRoster.delete).toHaveBeenCalledWith({ id: 'roster-created' });
      expect(managementUiMocks.error.handleApiError).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to add player to roster',
      );
    });
  });
});
