import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingOptional } from '../../contexts/OnboardingContext';
import { useUIVersion } from '../../contexts/UIVersionContext';
import { ONBOARDING_STEPS } from '../../utils/onboardingSignals';

interface OnboardingNudgeProps {
  /**
   * Controlled dismiss flag. Pass this (together with `onDismiss`) from a
   * parent that needs the dismissal to survive a remount of this component
   * (e.g. `UserProfile.tsx`, where a profile save can swap which branch of
   * the surrounding JSX renders, remounting a fresh `OnboardingNudge`
   * instance). Omit both props to fall back to the component's own internal
   * dismiss state (e.g. `Management.tsx`'s single, never-remounted mount).
   */
  dismissed?: boolean;
  onDismiss?: () => void;
}

/**
 * OnboardingNudge
 *
 * Small, dismissible banner mounted on destination screens (`Management.tsx`,
 * `UserProfile.tsx`) that reads the shared `OnboardingContext.signals`
 * baseline and shows "Next: {title} →" for whichever onboarding step is
 * next incomplete, deep-linking to it.
 *
 * Renders nothing unless ALL of:
 *  - Interface Mode is 'new' (classic has no nudge banner anywhere)
 *  - a signals baseline exists in context (never guesses on a cold load
 *    with no baseline, e.g. landing directly on /manage with nothing from
 *    Home yet this session)
 *  - onboarding isn't fully complete
 *  - the coach hasn't dismissed it (via the controlled prop, if supplied, or
 *    this component's own local state otherwise)
 */
export function OnboardingNudge({ dismissed: dismissedProp, onDismiss }: OnboardingNudgeProps = {}) {
  const { version } = useUIVersion();
  const onboarding = useOnboardingOptional();
  const navigate = useNavigate();
  const [dismissedState, setDismissedState] = useState(false);

  const dismissed = dismissedProp ?? dismissedState;
  const handleDismiss = onDismiss ?? (() => setDismissedState(true));

  const signals = onboarding?.signals ?? null;

  if (version !== 'new' || !signals || dismissed) {
    return null;
  }

  const nextStep = ONBOARDING_STEPS.find((step) => signals[step.id - 1] === false);
  if (!nextStep) {
    // Either fully complete, or (defensively) a signals array that doesn't
    // line up with ONBOARDING_STEPS — either way, nothing to nudge toward.
    return null;
  }

  return (
    <div className="onboarding-nudge" role="status">
      <button
        type="button"
        className="onboarding-nudge-link"
        onClick={() => navigate(nextStep.route)}
      >
        Next: {nextStep.title} →
      </button>
      <button
        type="button"
        className="onboarding-nudge-dismiss"
        aria-label="Dismiss"
        onClick={handleDismiss}
      >
        ✕
      </button>
    </div>
  );
}
