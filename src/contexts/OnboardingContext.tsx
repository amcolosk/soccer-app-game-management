import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

interface OnboardingContextValue {
  welcomed: boolean;
  collapsed: boolean;
  dismissed: boolean;
  markWelcomed: () => void;
  collapse: () => void;
  expand: () => void;
  dismiss: () => void;
  resetOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  // SSR-safe initialization — read from localStorage only on mount
  const [welcomed, setWelcomed] = useState(() => 
    typeof window !== 'undefined' ? localStorage.getItem('onboarding:welcomed') === '1' : false
  );
  const [collapsed, setCollapsed] = useState(() => 
    typeof window !== 'undefined' ? localStorage.getItem('onboarding:collapsed') === '1' : false
  );
  const [dismissed, setDismissed] = useState(() => 
    typeof window !== 'undefined' ? localStorage.getItem('onboarding:dismissed') === '1' : false
  );

  const markWelcomed = useCallback(() => {
    setWelcomed(true);
    localStorage.setItem('onboarding:welcomed', '1');
  }, []);

  const collapse = useCallback(() => {
    setCollapsed(true);
    localStorage.setItem('onboarding:collapsed', '1');
  }, []);

  const expand = useCallback(() => {
    setCollapsed(false);
    localStorage.removeItem('onboarding:collapsed');
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setCollapsed(false);
    localStorage.setItem('onboarding:dismissed', '1');
    localStorage.removeItem('onboarding:collapsed');
  }, []);

  const resetOnboarding = useCallback(() => {
    setWelcomed(false);
    setCollapsed(false);
    setDismissed(false);
    localStorage.removeItem('onboarding:welcomed');
    localStorage.removeItem('onboarding:collapsed');
    localStorage.removeItem('onboarding:dismissed');
  }, []);

  const value = useMemo(
    () => ({ welcomed, collapsed, dismissed, markWelcomed, collapse, expand, dismiss, resetOnboarding }),
    [welcomed, collapsed, dismissed, markWelcomed, collapse, expand, dismiss, resetOnboarding]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return ctx;
}
