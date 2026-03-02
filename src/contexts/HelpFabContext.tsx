import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface HelpFabContextValue {
  debugContext: string | null;
  setDebugContext: (ctx: string | null) => void;
}

const HelpFabContext = createContext<HelpFabContextValue | null>(null);

interface HelpFabProviderProps {
  children: ReactNode;
}

export function HelpFabProvider({ children }: HelpFabProviderProps) {
  const [debugContext, setDebugContext] = useState<string | null>(null);

  return (
    <HelpFabContext.Provider value={{ debugContext, setDebugContext }}>
      {children}
    </HelpFabContext.Provider>
  );
}

export function useHelpFab(): HelpFabContextValue {
  const ctx = useContext(HelpFabContext);
  if (!ctx) {
    throw new Error('useHelpFab must be used within a HelpFabProvider');
  }
  return ctx;
}
