import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('shows hash-bearing app version in the App section when VITE_APP_VERSION is set', async () => {
    vi.stubEnv('VITE_APP_VERSION', '1.1.0-42+abc123ef');
    const user = userEvent.setup();

    renderWithProviders(<Management />);
    await user.click(screen.getByRole('button', { name: /app/i }));

    expect(screen.getByText('1.1.0-42+abc123ef')).toBeInTheDocument();
  });

  it('preserves App section fallback when VITE_APP_VERSION is empty', async () => {
    vi.stubEnv('VITE_APP_VERSION', '');
    const user = userEvent.setup();

    renderWithProviders(<Management />);
    await user.click(screen.getByRole('button', { name: /app/i }));

    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });
});
