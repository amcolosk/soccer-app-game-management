import { describe, it, expect } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import React from 'react';
import { AvailabilityProvider, useAvailability } from './AvailabilityContext';

function Wrapper({
  availabilities,
  children,
}: {
  availabilities: { playerId: string; status: string }[];
  children: React.ReactNode;
}) {
  return (
    <AvailabilityProvider availabilities={availabilities}>
      {children}
    </AvailabilityProvider>
  );
}

describe('AvailabilityProvider', () => {
  it('exposes the availabilities array to consumers', () => {
    const availabilities = [
      { playerId: 'p1', status: 'absent' },
      { playerId: 'p2', status: 'late-arrival' },
    ];

    function Consumer() {
      const { availabilities: avs } = useAvailability();
      return <div data-testid="count">{avs.length}</div>;
    }

    render(<Wrapper availabilities={availabilities}><Consumer /></Wrapper>);
    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  it('getPlayerAvailability returns "available" when no record exists for a player', () => {
    function Consumer() {
      const { getPlayerAvailability } = useAvailability();
      return <div data-testid="status">{getPlayerAvailability('unknown-player')}</div>;
    }

    render(<Wrapper availabilities={[]}><Consumer /></Wrapper>);
    expect(screen.getByTestId('status').textContent).toBe('available');
  });

  it('getPlayerAvailability returns the correct status when a record exists', () => {
    const availabilities = [{ playerId: 'p1', status: 'absent' }];

    function Consumer() {
      const { getPlayerAvailability } = useAvailability();
      return <div data-testid="status">{getPlayerAvailability('p1')}</div>;
    }

    render(<Wrapper availabilities={availabilities}><Consumer /></Wrapper>);
    expect(screen.getByTestId('status').textContent).toBe('absent');
  });

  it('returns fallback values (not a throw) when used outside a provider', () => {
    // The implementation returns a fallback rather than throwing
    const { result } = renderHook(() => useAvailability());
    expect(result.current.availabilities).toEqual([]);
    expect(result.current.getPlayerAvailability('any')).toBe('available');
  });

  it('getPlayerAvailability is stable across re-renders with the same availabilities', () => {
    const availabilities = [{ playerId: 'p1', status: 'late-arrival' }];
    let prevFn: ((id: string) => string) | undefined;

    function Consumer() {
      const { getPlayerAvailability } = useAvailability();
      const stable = prevFn === undefined || prevFn === getPlayerAvailability;
      prevFn = getPlayerAvailability;
      return <div data-testid="stable">{String(stable)}</div>;
    }

    const { rerender } = render(
      <AvailabilityProvider availabilities={availabilities}>
        <Consumer />
      </AvailabilityProvider>,
    );

    rerender(
      <AvailabilityProvider availabilities={availabilities}>
        <Consumer />
      </AvailabilityProvider>,
    );

    expect(screen.getByTestId('stable').textContent).toBe('true');
  });
});
