import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import './FanMode.css';

// Public, unauthenticated screen (`/track/:token`) — a non-coach helper's
// sideline stat-entry page. Polls `getStatTrackerView` on the same
// 10-15s/visibility-paused/resume-repoll cadence B1's FanGameView
// established, and writes via `submitStatEvent` (the app's first
// unauthenticated write path — see amplify/functions/submit-stat-event).
const POLL_INTERVAL_MS = 12000;

const client = generateClient<Schema>();

type StatTrackerViewResult = NonNullable<Schema['getStatTrackerView']['returnType']>;
type RosterPlayer = NonNullable<NonNullable<StatTrackerViewResult['roster']>[number]>;

type ViewState =
  | 'LOADING'
  | 'LIVE'
  | 'FINISHED'
  | 'NEXT_GAME'
  | 'NO_GAMES_YET'
  | 'NO_GAME_RIGHT_NOW'
  | 'RATE_LIMITED'
  | 'INVALID_LINK';

type EventType = 'GOAL' | 'SHOT' | 'SAVE';

type FlowStep = 'closed' | 'side' | 'player' | 'confirmKeeper' | 'assist' | 'onTarget' | 'confirm';

interface FlowState {
  step: FlowStep;
  eventType: EventType | null;
  forUs: boolean | null;
  playerId: string | null;
  clientEventId: string | null;
  // Save Auto-Goalkeeper Attribution: the display name of the keeper shown
  // (and submitted) for the `confirmKeeper` step, frozen at the same
  // tap-time as `playerId` in `chooseSide`. Rendering `confirmKeeper` from
  // this instead of the live-recomputed `activeGoalkeeperPlayer` keeps what
  // the helper sees in sync with what actually gets submitted, even if a
  // poll lands mid-step and changes/clears the live keeper.
  confirmedKeeperName: string | null;
}

const CLOSED_FLOW: FlowState = {
  step: 'closed',
  eventType: null,
  forUs: null,
  playerId: null,
  clientEventId: null,
  confirmedKeeperName: null,
};

const EVENT_LABELS: Record<EventType, { verb: string; icon: string }> = {
  GOAL: { verb: 'Goal', icon: '⚽' },
  SHOT: { verb: 'Shot', icon: '🎯' },
  SAVE: { verb: 'Save', icon: '🧤' },
};

export function StatTrackerView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<StatTrackerViewResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [flow, setFlow] = useState<FlowState>(CLOSED_FLOW);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchView = useCallback(async () => {
    if (!token) return;
    try {
      const result = await client.queries.getStatTrackerView({ token }, { authMode: 'identityPool' });
      if (result.errors && result.errors.length > 0) {
        setLoadError(result.errors[0]?.message ?? 'Something went wrong loading this page.');
      } else {
        setLoadError(null);
        setData((result.data as StatTrackerViewResult) ?? null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Something went wrong loading this page.');
    } finally {
      setHasLoadedOnce(true);
    }
  }, [token]);

  useEffect(() => {
    void fetchView();

    function startPolling() {
      if (pollTimerRef.current) return;
      pollTimerRef.current = setInterval(() => {
        void fetchView();
      }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        void fetchView();
        startPolling();
      }
    }

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchView]);

  useEffect(() => () => {
    if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
  }, []);

  // Mid-session revocation: the next poll surfacing INVALID_LINK (or any
  // non-LIVE state) closes any in-flight tap flow rather than leaving a
  // helper mid-tap against a link/game that's no longer valid.
  useEffect(() => {
    if (data && data.state !== 'LIVE') {
      setFlow(CLOSED_FLOW);
    }
  }, [data]);

  const staleFromError = !!(loadError && data);

  const viewState: ViewState = !hasLoadedOnce
    ? 'LOADING'
    : (loadError && !data)
      ? 'INVALID_LINK'
      : ((data?.state as ViewState | undefined) ?? 'INVALID_LINK');

  // Explicit "game not in progress" gate, driven by the same server-supplied
  // discriminator FanGameView uses — LIVE covers both in-progress AND
  // halftime (see selectGameForFan), but submitStatEvent only accepts
  // writes while status === 'in-progress'. Tap targets stay hidden for the
  // halftime sub-case rather than letting a helper produce a guaranteed
  // GAME_NOT_LIVE rejection.
  const tapUiUnlocked = viewState === 'LIVE' && data?.status === 'in-progress';

  const roster: RosterPlayer[] = (data?.roster ?? []).filter((p): p is RosterPlayer => !!p);

  // Save Auto-Goalkeeper Attribution: null when the server didn't derive an
  // unambiguous keeper, OR when it named a player no longer present in this
  // roster snapshot (stale/mismatched data guard) -- either way, the helper
  // falls back to the existing full player picker.
  const activeGoalkeeperPlayer = roster.find((p) => p.id === data?.activeGoalkeeperId) ?? null;

  function openFlow(eventType: EventType) {
    if (isSubmitting) return; // duplicate-tap guard: ignore new taps while one is in flight
    setSubmitError(null);
    setFlow({
      step: 'side',
      eventType,
      forUs: null,
      playerId: null,
      clientEventId: crypto.randomUUID(),
      confirmedKeeperName: null,
    });
  }

  function closeFlow() {
    setFlow(CLOSED_FLOW);
    setSubmitError(null);
  }

  function chooseSide(forUs: boolean) {
    if (!flow.eventType) return;
    setSubmitError(null);
    if (forUs) {
      // Save Auto-Goalkeeper Attribution: a "Us" Save with an unambiguous
      // current goalkeeper skips the full player picker in favor of a
      // confirm-with-override step. GOAL and SHOT are unaffected.
      if (flow.eventType === 'SAVE' && activeGoalkeeperPlayer) {
        setFlow({
          ...flow,
          forUs,
          playerId: activeGoalkeeperPlayer.id,
          confirmedKeeperName: `${activeGoalkeeperPlayer.firstName} ${activeGoalkeeperPlayer.lastName}`,
          step: 'confirmKeeper',
        });
        return;
      }
      setFlow({ ...flow, forUs, step: 'player' });
      return;
    }
    // Opponent path: no player attribution at all — this app has no
    // opposing roster to validate against.
    if (flow.eventType === 'SHOT') {
      setFlow({ ...flow, forUs, step: 'onTarget' });
    } else {
      setFlow({ ...flow, forUs, step: 'confirm' });
    }
  }

  function pickDifferentKeeper() {
    setFlow({ ...flow, playerId: null, confirmedKeeperName: null, step: 'player' });
  }

  function choosePlayer(playerId: string | null) {
    if (!flow.eventType) return;
    if (flow.eventType === 'GOAL') {
      setFlow({ ...flow, playerId, step: 'assist' });
    } else if (flow.eventType === 'SHOT') {
      setFlow({ ...flow, playerId, step: 'onTarget' });
    } else {
      setFlow({ ...flow, playerId, step: 'confirm' });
    }
  }

  async function submit(payload: { assistPlayerId?: string | null; onTarget?: boolean }) {
    if (!flow.eventType || flow.forUs === null || !token) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await client.mutations.submitStatEvent({
        token,
        eventType: flow.eventType,
        forUs: flow.forUs,
        playerId: flow.forUs && flow.playerId ? flow.playerId : undefined,
        assistPlayerId: flow.forUs && payload.assistPlayerId ? payload.assistPlayerId : undefined,
        onTarget: payload.onTarget,
        clientEventId: flow.clientEventId ?? undefined,
        expectedGameId: data?.gameId ?? undefined,
      }, { authMode: 'identityPool' });

      const outcome = result.data as { ok: boolean; reason: string | null } | null;
      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors[0]?.message ?? 'Failed to log stat');
      }
      if (!outcome?.ok) {
        setSubmitError(describeSubmitFailure(outcome?.reason ?? null));
        setIsSubmitting(false);
        return;
      }

      // Success — close the flow and show a brief confirmation. Immediate
      // re-poll so a mid-session game-change/revocation surfaces promptly.
      const label = EVENT_LABELS[flow.eventType];
      setFlow(CLOSED_FLOW);
      setIsSubmitting(false);
      setConfirmation(`${label.icon} ${label.verb} logged!`);
      if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
      confirmationTimerRef.current = setTimeout(() => setConfirmation(null), 2500);
      void fetchView();
    } catch (err) {
      // Genuine failure — re-enable the target and show a visible inline
      // error, mirroring LineupPanel.tsx's restore-on-failure half (#172).
      // No false-positive "logged!" here: the confirmation banner above is
      // only ever set after a confirmed ok:true response.
      setSubmitError(err instanceof Error ? err.message : 'Failed to log stat. Please try again.');
      setIsSubmitting(false);
    }
  }

  if (viewState === 'LOADING') {
    return (
      <div className="fan-mode-page fan-mode-page--center">
        <p>Loading...</p>
      </div>
    );
  }

  if (viewState === 'INVALID_LINK') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-invalid-link">
        <h1>This link isn't valid</h1>
        <p>Check with your coach for an up-to-date link.</p>
      </div>
    );
  }

  if (viewState === 'RATE_LIMITED') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-rate-limited">
        <h1>You're tapping a bit too fast</h1>
        <p>Try again in a moment.</p>
      </div>
    );
  }

  if (viewState === 'NO_GAMES_YET') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-no-games-yet">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>No games yet — check back once your coach schedules one.</p>
      </div>
    );
  }

  if (viewState === 'NO_GAME_RIGHT_NOW') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-no-game-right-now">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>No game right now — check back closer to the next one.</p>
      </div>
    );
  }

  if (viewState === 'NEXT_GAME') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-next-game">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>Next game: vs {data?.opponentName ?? 'TBD'}</p>
        <p>Stat entry unlocks once the game starts.</p>
      </div>
    );
  }

  if (viewState === 'FINISHED') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-finished">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>This game has ended — stat entry is closed.</p>
      </div>
    );
  }

  // LIVE — either the tap UI (in-progress) or a "paused" message (halftime).
  return (
    <div className="fan-mode-page" data-testid="tracker-state-live">
      <header className="fan-mode-header">
        <h1 className="fan-mode-header__title">
          {data?.teamName ?? 'Live Game'} vs {data?.opponentName ?? 'Opponent'}
        </h1>
        {staleFromError && (
          <p className="fan-mode-stale-banner" role="status">Having trouble refreshing — showing the last update.</p>
        )}
      </header>

      {confirmation && (
        <p className="tracker-confirmation" role="status" aria-live="polite" aria-atomic="true">
          {confirmation}
        </p>
      )}

      {!tapUiUnlocked ? (
        <p className="fan-mode-empty" data-testid="tracker-not-in-progress">
          Stat entry is paused — it unlocks again when the game resumes.
        </p>
      ) : (
        <div className="tracker-tap-grid" role="group" aria-label="Log a stat">
          {(['GOAL', 'SHOT', 'SAVE'] as EventType[]).map((eventType) => (
            <button
              key={eventType}
              type="button"
              className="tracker-tap-target"
              onClick={() => openFlow(eventType)}
              disabled={isSubmitting}
            >
              <span aria-hidden="true">{EVENT_LABELS[eventType].icon}</span>
              <span>{EVENT_LABELS[eventType].verb}</span>
            </button>
          ))}
        </div>
      )}

      {flow.step !== 'closed' && flow.eventType && (
        <StatFlowSheet
          flow={flow}
          eventType={flow.eventType}
          roster={roster}
          opponentName={data?.opponentName ?? 'Opponent'}
          isSubmitting={isSubmitting}
          submitError={submitError}
          onChooseSide={chooseSide}
          onChoosePlayer={choosePlayer}
          onPickDifferentKeeper={pickDifferentKeeper}
          onSubmit={submit}
          onClose={closeFlow}
        />
      )}
    </div>
  );
}

function describeSubmitFailure(reason: string | null): string {
  switch (reason) {
    case 'RATE_LIMITED':
      return "You're tapping a bit too fast — try again in a moment.";
    case 'INVALID_LINK':
      return 'This link is no longer active.';
    case 'GAME_NOT_LIVE':
      return 'The game is no longer in progress.';
    case 'GAME_CHANGED':
      return 'The current game changed — refreshing before you try again.';
    default:
      return 'Could not log that. Please try again.';
  }
}

interface StatFlowSheetProps {
  flow: FlowState;
  eventType: EventType;
  roster: RosterPlayer[];
  opponentName: string;
  isSubmitting: boolean;
  submitError: string | null;
  onChooseSide: (forUs: boolean) => void;
  onChoosePlayer: (playerId: string | null) => void;
  onPickDifferentKeeper: () => void;
  onSubmit: (payload: { assistPlayerId?: string | null; onTarget?: boolean }) => void;
  onClose: () => void;
}

// Sheet-based per-tap question flow — deliberately distinct from the
// coach-side ShotSaveTracker/GoalTracker's two-button-per-sub-view shape
// (Milestone A); this is a different page with a different interaction
// model (one shared sheet driving every event type) and stays as designed
// here. Save Auto-Goalkeeper Attribution adds a `confirmKeeper` step for a
// "Us" Save with a known current goalkeeper -- a suggested-default (primary)
// vs. escape-hatch (de-emphasized) choice, not an equal-weight either/or.
function StatFlowSheet({
  flow, eventType, roster, opponentName, isSubmitting, submitError,
  onChooseSide, onChoosePlayer, onPickDifferentKeeper, onSubmit, onClose,
}: StatFlowSheetProps) {
  const label = EVENT_LABELS[eventType];
  const titleId = 'tracker-flow-title';

  return (
    <div className="tracker-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="tracker-sheet">
        <h2 id={titleId}>{label.icon} {label.verb}</h2>

        {flow.step === 'side' && (
          <div className="tracker-sheet-options">
            <button type="button" className="tracker-sheet-option" onClick={() => onChooseSide(true)} disabled={isSubmitting}>
              Us
            </button>
            <button type="button" className="tracker-sheet-option" onClick={() => onChooseSide(false)} disabled={isSubmitting}>
              {opponentName}
            </button>
          </div>
        )}

        {flow.step === 'player' && (
          <PlayerPickerStep
            roster={roster}
            heading={eventType === 'GOAL' ? 'Who scored?' : eventType === 'SHOT' ? 'Who took the shot?' : 'Which keeper?'}
            isSubmitting={isSubmitting}
            onChoose={onChoosePlayer}
          />
        )}

        {flow.step === 'confirmKeeper' && flow.confirmedKeeperName && (
          <div className="tracker-sheet-options">
            <p>{flow.confirmedKeeperName} made the save?</p>
            <button
              type="button"
              className="tracker-sheet-option tracker-sheet-option--primary"
              onClick={() => onSubmit({})}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Logging…' : 'Yes, log it'}
            </button>
            <button
              type="button"
              className="tracker-sheet-option tracker-sheet-option--skip"
              onClick={onPickDifferentKeeper}
              disabled={isSubmitting}
            >
              Not right? Pick another keeper
            </button>
          </div>
        )}

        {flow.step === 'assist' && (
          <PlayerPickerStep
            roster={roster.filter((p) => p.id !== flow.playerId)}
            heading="Assisted by? (optional)"
            skipLabel="No assist"
            isSubmitting={isSubmitting}
            onChoose={(assistPlayerId) => onSubmit({ assistPlayerId })}
          />
        )}

        {flow.step === 'onTarget' && (
          <div className="tracker-sheet-options">
            <p>Did it beat the keeper?</p>
            <button type="button" className="tracker-sheet-option" onClick={() => onSubmit({ onTarget: true })} disabled={isSubmitting}>
              On target
            </button>
            <button type="button" className="tracker-sheet-option" onClick={() => onSubmit({ onTarget: false })} disabled={isSubmitting}>
              Off target
            </button>
          </div>
        )}

        {flow.step === 'confirm' && (
          <div className="tracker-sheet-options">
            <button type="button" className="tracker-sheet-option tracker-sheet-option--primary" onClick={() => onSubmit({})} disabled={isSubmitting}>
              {isSubmitting ? 'Logging…' : `Log ${label.verb}`}
            </button>
          </div>
        )}

        {submitError && <p className="error-message" role="alert">{submitError}</p>}

        <button type="button" className="tracker-sheet-cancel" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function PlayerPickerStep({
  roster, heading, skipLabel = 'Skip / unknown player', isSubmitting, onChoose,
}: {
  roster: RosterPlayer[];
  heading: string;
  skipLabel?: string;
  isSubmitting: boolean;
  onChoose: (playerId: string | null) => void;
}) {
  return (
    <div className="tracker-sheet-options">
      <p>{heading}</p>
      <div className="tracker-player-list">
        {roster.map((player) => (
          <button
            key={player.id}
            type="button"
            className="tracker-sheet-option"
            onClick={() => onChoose(player.id)}
            disabled={isSubmitting}
          >
            {player.firstName} {player.lastName}
          </button>
        ))}
      </div>
      <button type="button" className="tracker-sheet-option tracker-sheet-option--skip" onClick={() => onChoose(null)} disabled={isSubmitting}>
        {skipLabel}
      </button>
    </div>
  );
}
