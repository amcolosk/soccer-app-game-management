import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

interface OnboardingContextValue {
  welcomed: boolean;
  collapsed: boolean;
  dismissed: boolean;
  markWelcomed: () => void;
  collapse: () => void;
  expand: () => void;
  dismiss: () => void;
  clearDismissed: () => void;
  resetOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const readFlag = (primaryKey: string, legacyKey?: string): boolean => {
    if (typeof window === 'undefined') {
      return false;
    }

    if (localStorage.getItem(primaryKey) === '1') {
      return true;
    }

    return legacyKey ? localStorage.getItem(legacyKey) === '1' : false;
  };

  // SSR-safe initialization — read from localStorage only on mount
  const [welcomed, setWelcomed] = useState(() =>
    readFlag('welcomeModalDismissed', 'onboarding:welcomed')
  );
  const [collapsed, setCollapsed] = useState(() => 
    typeof window !== 'undefined' ? localStorage.getItem('onboarding:collapsed') === '1' : false
  );
  const [dismissed, setDismissed] = useState(() =>
    readFlag('quickStartChecklistDismissed', 'onboarding:dismissed')
  );

  const markWelcomed = useCallback(() => {
    setWelcomed(true);
    localStorage.setItem('welcomeModalDismissed', '1');
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
    localStorage.setItem('quickStartChecklistDismissed', '1');
    localStorage.setItem('onboarding:dismissed', '1');
    localStorage.removeItem('onboarding:collapsed');
  }, []);

  const clearDismissed = useCallback(() => {
    setDismissed(false);
    localStorage.removeItem('quickStartChecklistDismissed');
    localStorage.removeItem('onboarding:dismissed');
    localStorage.removeItem('onboarding:lastCompletedSteps');
  }, []);

  const resetOnboarding = useCallback(() => {
    setWelcomed(false);
    setCollapsed(false);
    setDismissed(false);
    localStorage.removeItem('welcomeModalDismissed');
    localStorage.removeItem('quickStartChecklistDismissed');
    localStorage.removeItem('onboarding:welcomed');
    localStorage.removeItem('onboarding:collapsed');
    localStorage.removeItem('onboarding:dismissed');
    localStorage.removeItem('onboarding:lastCompletedSteps');
  }, []);

  const value = useMemo(
    () => ({ welcomed, collapsed, dismissed, markWelcomed, collapse, expand, dismiss, clearDismissed, resetOnboarding }),
    [welcomed, collapsed, dismissed, markWelcomed, collapse, expand, dismiss, clearDismissed, resetOnboarding]
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
