import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../test/mockAmplifyClient';
import { Management } from './Management';
import { renderWithProviders } from '../test/renderWithProviders';
import { managementUiMocks } from '../test/mockAmplifyClient';

describe('Management', () => {
  beforeEach(() => {
    managementUiMocks.helpFab.setHelpContext.mockClear();
  });

  it('renders tab navigation (smoke)', () => {
    renderWithProviders(<Management />);
    expect(screen.getByRole('button', { name: /teams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /formations/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /players/i })).toBeInTheDocument();
  });

  it('updates help context when switching tabs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Management />);

    await user.click(screen.getByRole('button', { name: /players/i }));
    await user.click(screen.getByRole('button', { name: /formations/i }));
    await user.click(screen.getByRole('button', { name: /sharing/i }));

    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-teams');
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-players');
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-formations');
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-sharing');
  });

  it('clears help context on unmount', () => {
    const { unmount } = renderWithProviders(<Management />);
    unmount();
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith(null);
  });
});
