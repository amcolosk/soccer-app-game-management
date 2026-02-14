import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';

interface PlayerAvailability {
  playerId: string;
  status: string;
}

interface AvailabilityContextValue {
  availabilities: PlayerAvailability[];
  getPlayerAvailability: (playerId: string) => string;
}

const AvailabilityContext = createContext<AvailabilityContextValue | null>(null);

interface AvailabilityProviderProps {
  availabilities: PlayerAvailability[];
  children: ReactNode;
}

export function AvailabilityProvider({ availabilities, children }: AvailabilityProviderProps) {
  const getPlayerAvailability = useCallback((playerId: string): string => {
    const availability = availabilities.find(a => a.playerId === playerId);
    return availability?.status || 'available';
  }, [availabilities]);

  const value = useMemo(() => ({ availabilities, getPlayerAvailability }), [availabilities, getPlayerAvailability]);

  return <AvailabilityContext.Provider value={value}>{children}</AvailabilityContext.Provider>;
}

export function useAvailability() {
  const context = useContext(AvailabilityContext);
  if (!context) {
    return { availabilities: [] as PlayerAvailability[], getPlayerAvailability: () => 'available' as string };
  }
  return context;
}
