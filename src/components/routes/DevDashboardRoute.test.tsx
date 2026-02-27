import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { mockUseDeveloperAccess } = vi.hoisted(() => ({
  mockUseDeveloperAccess: vi.fn(),
}));

vi.mock('../../hooks/useDeveloperAccess', () => ({
  useDeveloperAccess: mockUseDeveloperAccess,
}));

vi.mock('../DevDashboard/DevDashboard', () => ({
  DevDashboard: ({ userEmail }: { userEmail: string }) => (
    <div data-testid="dev-dashboard">DevDashboard: {userEmail}</div>
  ),
}));

import { DevDashboardRoute } from './DevDashboardRoute';

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/dev']}>
      <Routes>
        <Route path="/dev" element={<DevDashboardRoute />} />
        <Route path="/" element={<div data-testid="home-page">Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DevDashboardRoute', () => {
  describe('loading state', () => {
    it('shows the loading container while checking is true', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: true, isDeveloper: false, userEmail: null });
      renderRoute();
      expect(document.querySelector('.dev-access-loading')).not.toBeNull();
    });

    it('shows "Checking access..." text while checking is true', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: true, isDeveloper: false, userEmail: null });
      renderRoute();
      expect(screen.getByText('Checking access...')).toBeInTheDocument();
    });

    it('renders three spinner dots while checking is true', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: true, isDeveloper: false, userEmail: null });
      renderRoute();
      expect(document.querySelectorAll('.dev-spinner-dot')).toHaveLength(3);
    });

    it('does not render DevDashboard while checking is true', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: true, isDeveloper: false, userEmail: null });
      renderRoute();
      expect(screen.queryByTestId('dev-dashboard')).not.toBeInTheDocument();
    });
  });

  describe('access denied', () => {
    it('redirects to "/" when isDeveloper is false and checking is false', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: false, isDeveloper: false, userEmail: null });
      renderRoute();
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
      expect(screen.queryByTestId('dev-dashboard')).not.toBeInTheDocument();
    });

    it('does not show loading content when isDeveloper is false and checking is false', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: false, isDeveloper: false, userEmail: null });
      renderRoute();
      expect(screen.queryByText('Checking access...')).not.toBeInTheDocument();
    });
  });

  describe('access granted', () => {
    it('renders DevDashboard when isDeveloper is true', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: false, isDeveloper: true, userEmail: 'dev@example.com' });
      renderRoute();
      expect(screen.getByTestId('dev-dashboard')).toBeInTheDocument();
    });

    it('passes userEmail to DevDashboard', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: false, isDeveloper: true, userEmail: 'dev@example.com' });
      renderRoute();
      expect(screen.getByText('DevDashboard: dev@example.com')).toBeInTheDocument();
    });

    it('passes empty string to DevDashboard when userEmail is null', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: false, isDeveloper: true, userEmail: null });
      renderRoute();
      expect(screen.getByTestId('dev-dashboard').textContent).toBe('DevDashboard: ');
    });

    it('does not show the home page when isDeveloper is true', () => {
      mockUseDeveloperAccess.mockReturnValue({ checking: false, isDeveloper: true, userEmail: 'dev@example.com' });
      renderRoute();
      expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
    });
  });
});
