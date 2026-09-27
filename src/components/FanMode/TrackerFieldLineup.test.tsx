import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackerFieldLineup, type TrackerFieldPlayer } from './TrackerFieldLineup';

function player(overrides: Partial<TrackerFieldPlayer> & { id: string }): TrackerFieldPlayer {
  return {
    firstName: 'Sam',
    lastName: 'Jones',
    playerNumber: null,
    position: null,
    ...overrides,
  };
}

describe('TrackerFieldLineup', () => {
  it('renders null when there are no on-field players (all filtered out)', () => {
    const { container } = render(<TrackerFieldLineup players={[player({ id: 'p1', position: null })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders null for an empty players array', () => {
    const { container } = render(<TrackerFieldLineup players={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one node per distinct occupied position', () => {
    render(
      <TrackerFieldLineup
        players={[
          player({ id: 'p1', playerNumber: 8, position: { id: 'pos-fwd', positionName: 'Forward', abbreviation: 'FWD', role: 'FORWARD' } }),
          player({ id: 'p2', playerNumber: 4, position: { id: 'pos-def', positionName: 'Defender', abbreviation: 'DEF', role: 'DEFENDER' } }),
          player({ id: 'p3', position: null }), // bench, filtered
        ]}
      />
    );
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });

  it('shows the jersey number as the dominant node content', () => {
    render(
      <TrackerFieldLineup
        players={[
          player({ id: 'p1', playerNumber: 8, position: { id: 'pos-fwd', positionName: 'Forward', abbreviation: 'FWD', role: 'FORWARD' } }),
        ]}
      />
    );
    expect(screen.getByText('#8')).toBeInTheDocument();
  });

  it('renders positions without persisted xPct/yPct via lane-grid fallback without crashing', () => {
    render(
      <TrackerFieldLineup
        players={[
          player({ id: 'p1', playerNumber: 1, position: { id: 'pos-gk', positionName: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER', xPct: null, yPct: null } }),
        ]}
      />
    );
    expect(screen.getByRole('group')).toBeInTheDocument();
  });

  it('falls back to "?" when playerNumber is null and no position abbreviation is available', () => {
    render(
      <TrackerFieldLineup
        players={[
          player({ id: 'p1', playerNumber: null, position: { id: 'pos-x', positionName: null, abbreviation: null, role: null } }),
        ]}
      />
    );
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders every occupant of a multi-occupant position, dropping none', () => {
    render(
      <TrackerFieldLineup
        players={[
          player({ id: 'p1', playerNumber: 1, firstName: 'Asher', lastName: 'M', position: { id: 'pos-gk', positionName: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER' } }),
          player({ id: 'p2', playerNumber: 14, firstName: 'Jordan', lastName: 'T', position: { id: 'pos-gk', positionName: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER' } }),
        ]}
      />
    );
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#14')).toBeInTheDocument();
  });

  it('sets an accessible group label for a single-occupant node', () => {
    render(
      <TrackerFieldLineup
        players={[
          player({ id: 'p1', playerNumber: 8, firstName: 'Asher', lastName: 'M', position: { id: 'pos-gk', positionName: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER' } }),
        ]}
      />
    );
    expect(screen.getByRole('group', { name: '#8 Asher M, Goalkeeper' })).toBeInTheDocument();
  });

  it('sets an accessible group label listing all occupants for a multi-occupant node', () => {
    render(
      <TrackerFieldLineup
        players={[
          player({ id: 'p1', playerNumber: 8, firstName: 'Asher', lastName: 'M', position: { id: 'pos-gk', positionName: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER' } }),
          player({ id: 'p2', playerNumber: 14, firstName: 'Jordan', lastName: 'T', position: { id: 'pos-gk', positionName: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER' } }),
        ]}
      />
    );
    expect(screen.getByRole('group', { name: 'Goalkeeper: #8 Asher M, #14 Jordan T' })).toBeInTheDocument();
  });
});
