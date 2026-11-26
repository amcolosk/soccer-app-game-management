import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export interface OnboardingContextValue {
  welcomed: boolean;
  collapsed: boolean;
  dismissed: boolean;
  /**
   * The 7 raw onboarding-completion signals (see
   * `src/utils/onboardingSignals.ts`), or `null` when no screen has
   * supplied a baseline yet (e.g. a cold load directly on `/manage` or
   * `/profile` before `Home` has ever mounted this session). Consumers
   * (e.g. `OnboardingNudge`) must treat `null` as "unknown" and render
   * nothing rather than guessing.
   */
  signals: boolean[] | null;
  markWelcomed: () => void;
  collapse: () => void;
  expand: () => void;
  dismiss: () => void;
  clearDismissed: () => void;
  resetOnboarding: () => void;
  /**
   * Full-replace setter for `signals` — used by `Home.tsx`, which always
   * has all 7 signals computed from data it fetches directly. Equality
   * guarded: skips the state update when `next` has the same values as the
   * current `signals`, since `Home` is both a producer and a consumer of
   * this context (an unconditional set inside an effect would loop).
   */
  setSignals: (next: boolean[]) => void;
  /**
   * Partial-update setter for `signals` — used by destination screens
   * (`Management.tsx`, `UserProfile.tsx`) that only have enough data to
   * compute a subset of the 7 signals. Merges `values` into the existing
   * `signals` at the given `indices`, leaving every other index untouched.
   * No-ops (never guesses) when there is no existing baseline (`signals`
   * is `null`).
   */
  patchSignals: (indices: number[], values: boolean[]) => void;
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
  // Not backed by localStorage — a fresh baseline is recomputed by Home (or,
  // in the no-Home-yet case, simply absent) on every session/reload.
  const [signals, setSignalsState] = useState<boolean[] | null>(null);

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
  }, []);

  const setSignals = useCallback((next: boolean[]) => {
    setSignalsState((prev) => {
      if (prev && prev.length === next.length && prev.every((value, index) => value === next[index])) {
        return prev;
      }
      return next;
    });
  }, []);

  const patchSignals = useCallback((indices: number[], values: boolean[]) => {
    setSignalsState((prev) => {
      // No baseline yet — never guess at the signals this caller doesn't
      // know about.
      if (!prev) {
        return prev;
      }

      const merged = prev.slice();
      indices.forEach((index, i) => {
        merged[index] = values[i];
      });

      const unchanged = merged.every((value, index) => value === prev[index]);
      return unchanged ? prev : merged;
    });
  }, []);

  const resetOnboarding = useCallback(() => {
    setWelcomed(false);
    setCollapsed(false);
    setDismissed(false);
    setSignalsState(null);
    localStorage.removeItem('welcomeModalDismissed');
    localStorage.removeItem('quickStartChecklistDismissed');
    localStorage.removeItem('onboarding:welcomed');
    localStorage.removeItem('onboarding:collapsed');
    localStorage.removeItem('onboarding:dismissed');
    localStorage.removeItem('onboarding:lastCompletedSteps');
  }, []);

  const value = useMemo(
    () => ({
      welcomed, collapsed, dismissed, signals,
      markWelcomed, collapse, expand, dismiss, clearDismissed, resetOnboarding,
      setSignals, patchSignals,
    }),
    [welcomed, collapsed, dismissed, signals, markWelcomed, collapse, expand, dismiss, clearDismissed, resetOnboarding, setSignals, patchSignals]
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

/**
 * Non-throwing variant of `useOnboarding()`, returning `null` when called
 * outside an `OnboardingProvider` instead of throwing. Used by destination
 * screens (`Management.tsx`, `UserProfile.tsx`) that supply local onboarding
 * signals and mount `OnboardingNudge` — in production these are always
 * wrapped by `AppLayout`'s `OnboardingProvider`, but their unit tests render
 * them standalone, and this feature is additive/best-effort for those
 * screens (no provider simply means no nudge, not a hard error).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOnboardingOptional(): OnboardingContextValue | null {
  return useContext(OnboardingContext);
}
