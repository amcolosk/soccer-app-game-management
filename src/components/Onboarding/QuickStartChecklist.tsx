import { useEffect, useRef, useState } from 'react';
import { trackEvent, AnalyticsEvents } from '../../utils/analytics';
import './QuickStartChecklist.css';

interface QuickStartChecklistProps {
  teams: unknown[];
  games: unknown[];
  teamRosters: unknown[];
  gamePlans: unknown[];
  collapsed: boolean;
  demoTeamId: string | null;
  onDismiss: () => void;
  onExpand: () => void;
  onNavigate: (stepId: number) => void;
  onRemoveDemoData?: () => Promise<void>;
}

interface OnboardingStep {
  id: number;
  title: string;
  completed: boolean;
  directionText: string;
}

/**
 * QuickStartChecklist
 * 
 * Persistent card on the Home tab that guides users through 6 setup steps.
 * Auto-dismisses when all steps are complete (shows completion state for 4 seconds first).
 * Can be collapsed/expanded; shows a resume banner when collapsed.
 */
export function QuickStartChecklist({
  teams,
  games,
  teamRosters,
  gamePlans,
  collapsed,
  demoTeamId,
  onDismiss,
  onExpand,
  onNavigate,
  onRemoveDemoData,
}: QuickStartChecklistProps) {
  const [isComplete, setIsComplete] = useState(false);
  const [isRemovingDemo, setIsRemovingDemo] = useState(false);
  
  // Track previous step states to detect transitions (for analytics)
  const prevStepsRef = useRef<boolean[]>([]);

  // Derive step completion
  const step1Complete = teams.length >= 1;
  const step2Complete = (teamRosters as { teamId: string }[]).some(r => 
    (teams as { id: string }[]).some(t => t.id === r.teamId)
  );
  const step3Complete = (teams as { id: string; formationId?: string | null }[]).some(
    t => t.formationId != null && t.formationId !== ''
  );
  const step4Complete = games.length >= 1;
  const step5Complete = gamePlans.length >= 1;
  const step6Complete = (games as { status?: string }[]).some(
    g => g.status === 'in-progress' || g.status === 'completed'
  );

  const steps: OnboardingStep[] = [
    {
      id: 1,
      title: 'Create your team',
      completed: step1Complete,
      directionText: 'Go to Manage ⚙️ → Teams',
    },
    {
      id: 2,
      title: 'Add players to your roster',
      completed: step2Complete,
      directionText: 'Go to Manage ⚙️ → Players',
    },
    {
      id: 3,
      title: 'Set your formation',
      completed: step3Complete,
      directionText: 'Go to Manage ⚙️ → Teams and assign a formation',
    },
    {
      id: 4,
      title: 'Schedule a game',
      completed: step4Complete,
      directionText: 'Tap + Schedule New Game above',
    },
    {
      id: 5,
      title: 'Plan your rotations',
      completed: step5Complete,
      directionText: 'Tap 📋 Plan Game on your game card',
    },
    {
      id: 6,
      title: 'Manage a live game',
      completed: step6Complete,
      directionText: 'On game day, tap Start Game',
    },
  ];

  const completedCount = steps.filter(s => s.completed).length;
  const allComplete = completedCount === steps.length;

  // Track step completion transitions (incomplete → complete)
  useEffect(() => {
    const currentStates = steps.map(s => s.completed);
    
    // Only track if we have previous state to compare
    if (prevStepsRef.current.length > 0) {
      steps.forEach((step, i) => {
        // Newly completed: was false, now true
        if (!prevStepsRef.current[i] && currentStates[i]) {
          trackEvent(
            AnalyticsEvents.ONBOARDING_STEP_COMPLETE.category,
            AnalyticsEvents.ONBOARDING_STEP_COMPLETE.action,
            `Step ${step.id}: ${step.title}`
          );
        }
      });
    }

    prevStepsRef.current = currentStates;
  }, [step1Complete, step2Complete, step3Complete, step4Complete, step5Complete, step6Complete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss on completion (after 4 seconds)
  useEffect(() => {
    if (allComplete && !isComplete) {
      setIsComplete(true);
      const timer = setTimeout(() => {
        onDismiss();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [allComplete, isComplete, onDismiss]);

  // Track analytics when checklist expands from collapsed
  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsedRef.current && !collapsed) {
      trackEvent(AnalyticsEvents.QUICK_START_OPENED.category, AnalyticsEvents.QUICK_START_OPENED.action);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  const handleDismiss = () => {
    trackEvent(AnalyticsEvents.QUICK_START_DISMISSED.category, AnalyticsEvents.QUICK_START_DISMISSED.action);
    onDismiss();
  };

  // If collapsed and not complete, show resume banner
  if (collapsed && !isComplete) {
    return (
      <div className="quick-start-resume-banner" onClick={onExpand}>
        <span className="quick-start-resume-icon" aria-hidden="true">📋</span>
        <span className="quick-start-resume-text">
          Setup: {completedCount} of 6 complete — Resume →
        </span>
      </div>
    );
  }

  const handleRemoveDemoAndDismiss = async () => {
    if (!onRemoveDemoData) return;
    setIsRemovingDemo(true);
    try {
      await onRemoveDemoData();
    } finally {
      setIsRemovingDemo(false);
      onDismiss();
    }
  };

  // If complete, show completion state (replaces step list)
  if (isComplete) {
    return (
      <div className="quick-start-card quick-start-card--complete">
        <div className="quick-start-completion" role="status" aria-live="polite">
          <div className="quick-start-completion-icon" aria-hidden="true">🎉</div>
          <h3 className="quick-start-completion-title">You're ready!</h3>
          <p className="quick-start-completion-message">All set — enjoy game day</p>
          {demoTeamId && onRemoveDemoData ? (
            <div className="quick-start-completion-actions">
              <button
                className="quick-start-completion-button"
                onClick={() => { void handleRemoveDemoAndDismiss(); }}
                disabled={isRemovingDemo}
                type="button"
              >
                {isRemovingDemo ? 'Removing…' : 'Done — remove demo data'}
              </button>
              <button
                className="quick-start-completion-button quick-start-completion-button--ghost"
                onClick={onDismiss}
                disabled={isRemovingDemo}
                type="button"
              >
                Keep demo data
              </button>
            </div>
          ) : (
            <button
              className="quick-start-completion-button"
              onClick={onDismiss}
              type="button"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    );
  }

  // Normal expanded state: full checklist
  return (
    <div className="quick-start-card">
      <div className="quick-start-header">
        <div className="quick-start-header-top">
          <h3 className="quick-start-title">Get ready for game day</h3>
          <button
            className="quick-start-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss checklist"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="quick-start-progress">
          <div
            className="quick-start-progress-bar"
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemax={6}
            aria-label="Onboarding progress"
          >
            <div
              className="quick-start-progress-fill"
              style={{ '--progress': `${(completedCount / 6) * 100}%` } as React.CSSProperties}
            />
          </div>
          <p className="quick-start-progress-label">
            {completedCount} of 6 steps complete
          </p>
        </div>
        {demoTeamId && (
          <div className="quick-start-demo-indicator">
            🧪 Using demo data
          </div>
        )}
      </div>

      <div className="quick-start-body">
        {steps.map((step) => (
          <button
            key={step.id}
            className="quick-start-step"
            data-state={step.completed ? 'completed' : 'active'}
            onClick={() => onNavigate(step.id)}
            aria-disabled={step.completed}
            type="button"
          >
            <div className="quick-start-step-icon">
              {step.completed ? '✓' : '○'}
            </div>
            <div className="quick-start-step-content">
              <span className="quick-start-step-title">{step.title}</span>
              <span className="quick-start-step-direction">{step.directionText}</span>
            </div>
            {!step.completed && (
              <div className="quick-start-step-arrow" aria-hidden="true">→</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
