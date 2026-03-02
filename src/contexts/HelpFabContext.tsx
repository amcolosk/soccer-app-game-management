import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { HelpScreenKey } from '../help';

interface HelpFabContextValue {
  // Existing — unchanged. Consumed by BugReport modal.
  debugContext: string | null;
  setDebugContext: (ctx: string | null) => void;

  // New — consumed by HelpModal.
  // null  → no screen has registered; "Get Help" stays disabled
  // key   → active screen context; "Get Help" becomes active
  helpContext: HelpScreenKey | null;
  setHelpContext: (key: HelpScreenKey | null) => void;
}

const HelpFabContext = createContext<HelpFabContextValue | null>(null);

interface HelpFabProviderProps {
  children: ReactNode;
}

export function HelpFabProvider({ children }: HelpFabProviderProps) {
  const [debugContext, setDebugContext] = useState<string | null>(null);
  const [helpContext, setHelpContext] = useState<HelpScreenKey | null>(null);

  return (
    <HelpFabContext.Provider value={{ debugContext, setDebugContext, helpContext, setHelpContext }}>
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
