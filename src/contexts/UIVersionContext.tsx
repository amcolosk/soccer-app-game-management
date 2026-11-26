import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type UIVersion = 'classic' | 'new';

const STORAGE_KEY = 'teamtrack-ui-version';

interface UIVersionContextValue {
  version: UIVersion;
  setVersion: (version: UIVersion) => void;
}

const UIVersionContext = createContext<UIVersionContextValue | null>(null);

function readStoredVersion(): UIVersion {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'classic' || stored === 'new') {
      return stored;
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to the
    // stored/mounted default below.
  }
  // Stored default for a user with nothing saved: 'new'.
  return 'new';
}

interface UIVersionProviderProps {
  children: ReactNode;
}

export function UIVersionProvider({ children }: UIVersionProviderProps) {
  const [version, setVersionState] = useState<UIVersion>(() => readStoredVersion());

  const setVersion = (next: UIVersion) => {
    setVersionState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures (private mode, storage quota, etc.) — the
      // in-memory version still takes effect for this session.
    }
  };

  const value = useMemo(() => ({ version, setVersion }), [version]);

  return <UIVersionContext.Provider value={value}>{children}</UIVersionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUIVersion(): UIVersionContextValue {
  const context = useContext(UIVersionContext);
  if (!context) {
    // Deliberately different from the stored/mounted default ('new'): this
    // fallback exists so components/tests that render without a
    // UIVersionProvider degrade to the pre-existing 'classic' behavior
    // instead of throwing or silently opting into new, gated behavior they
    // weren't written/tested against. Mirrors ThemeContext's useTheme()
    // fallback pattern.
    return { version: 'classic', setVersion: () => {} };
  }
  return context;
}
