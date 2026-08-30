import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArchivedTeamBanner } from './ArchivedTeamBanner';

describe('ArchivedTeamBanner', () => {
  it('renders nothing for a legacy-active team (status undefined)', () => {
    const { container } = render(
      <ArchivedTeamBanner team={{ status: undefined, archivedAt: null } as never} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an active team', () => {
    const { container } = render(
      <ArchivedTeamBanner team={{ status: 'active', archivedAt: null } as never} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the read-only banner with the archive date for an archived team', () => {
    render(
      <ArchivedTeamBanner
        team={{ status: 'archived', archivedAt: '2026-08-01T12:00:00.000Z' } as never}
      />
    );
    expect(
      screen.getByText(/Archived Team — Read-Only \(Archived Aug 1, 2026\)/)
    ).toBeInTheDocument();
  });

  it('renders the banner without a parenthetical when archivedAt is null', () => {
    render(<ArchivedTeamBanner team={{ status: 'archived', archivedAt: null } as never} />);
    expect(screen.getByText(/Archived Team — Read-Only$/)).toBeInTheDocument();
  });

  it('renders the banner without a parenthetical when archivedAt is an invalid date', () => {
    render(
      <ArchivedTeamBanner team={{ status: 'archived', archivedAt: 'not-a-date' } as never} />
    );
    expect(screen.getByText(/Archived Team — Read-Only$/)).toBeInTheDocument();
  });

  it('has role="status" for a11y announcement', () => {
    render(
      <ArchivedTeamBanner
        team={{ status: 'archived', archivedAt: '2026-08-01T12:00:00.000Z' } as never}
      />
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
