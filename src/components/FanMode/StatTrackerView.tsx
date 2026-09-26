import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { computeCurrentGameSeconds } from '../../utils/gameClock';
import { formatPlayTime } from '../../utils/playTimeCalculations';
import { useWakeLock } from '../../hooks/useWakeLock';
import { TrackerFieldLineup } from './TrackerFieldLineup';
import './FanMode.css';

// Public, unauthenticated screen (`/track/:token`) — a non-coach helper's
// sideline stat-entry page. Polls `getStatTrackerView` on the same
// 10-15s/visibility-paused/resume-repoll cadence B1's FanGameView
// established, and writes via `submitStatEvent` (the app's first
// unauthenticated write path — see amplify/functions/submit-stat-event).
const POLL_INTERVAL_MS = 12000;
// Faster cadence specifically for LIVE-but-locked (i.e. halftime) -- the
// only reachable case of viewState === 'LIVE' && !tapUiUnlocked; NEXT_GAME
// (pregame) isn't LIVE at all and uses the normal poll only. There's
// nothing to accidentally over-poll here (no tapping happening), and a
// shorter gap gets a helper back to tracking sooner once the coach starts
// the next half, without requiring a manual page reload.
const PAUSED_POLL_INTERVAL_MS = 5000;

const client = generateClient<Schema>();

type StatTrackerViewResult = NonNullable<Schema['getStatTrackerView']['returnType']>;
type RosterPlayer = NonNullable<NonNullable<StatTrackerViewResult['roster']>[number]>;
type UpcomingGame = NonNullable<NonNullable<StatTrackerViewResult['upcomingGames']>[number]>;

type ViewState =
  | 'LOADING'
  | 'LIVE'
  | 'FINISHED'
  | 'NEXT_GAME'
  | 'NO_GAMES_YET'
  | 'NO_GAME_RIGHT_NOW'
  | 'RATE_LIMITED'
  | 'INVALID_LINK';

// Unified shot-outcome tracking: the 3-way GOAL/SHOT/SAVE tap grid is gone,
// replaced by two entry points ("Log Shot – Us"/"Log Shot – Them") plus an
// outcome picker -- see src/utils/shotOutcomeMapping.ts for the shared
// outcome -> records mapping this mirrors on the coach side.
type ShotOutcome = 'GOAL' | 'SAVED' | 'BLOCKED' | 'WIDE';

type FlowStep = 'closed' | 'player' | 'outcome' | 'confirmKeeper' | 'assist' | 'confirm';

interface FlowState {
  step: FlowStep;
  forUs: boolean | null;
  outcome: ShotOutcome | null;
  // Dual use, mutually exclusive per-flow (per the plan): shooter/scorer
  // attribution on the "Us" side (populated by the initial 'player' step),
  // OR our keeper attribution on the "Them"+SAVED override-picker path
  // (populated by the SAME 'player' step, reached via "pick another
  // keeper"). One slot suffices since a single flow is never both at once.
  playerId: string | null;
  assistPlayerId: string | null;
  clientEventId: string | null;
  // Save Auto-Goalkeeper Attribution: the display name of the keeper shown
  // (and submitted) for the `confirmKeeper` step, frozen at the same
  // tap-time as `playerId` in `pickOutcome`. Rendering `confirmKeeper` from
  // this instead of the live-recomputed `activeGoalkeeperPlayer` keeps what
  // the helper sees in sync with what actually gets submitted, even if a
  // poll lands mid-step and changes/clears the live keeper.
  confirmedKeeperName: string | null;
}

const CLOSED_FLOW: FlowState = {
  step: 'closed',
  forUs: null,
  outcome: null,
  playerId: null,
  assistPlayerId: null,
  clientEventId: null,
  confirmedKeeperName: null,
};

const OUTCOME_LABELS: Record<ShotOutcome, { verb: string; icon: string }> = {
  GOAL: { verb: 'Goal', icon: '⚽' },
  SAVED: { verb: 'Save', icon: '🧤' },
  BLOCKED: { verb: 'Blocked shot', icon: '🎯' },
  WIDE: { verb: 'Wide shot', icon: '🎯' },
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
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isFetching, setIsFetching] = useState(false);
  const [rateLimitedWhilePolling, setRateLimitedWhilePolling] = useState(false);
  // In-flight guard: the primary poll, the paused-poll interval, the
  // 'focus'/'visibilitychange' listeners, and the manual "Refresh now"
  // button can all independently decide to call fetchView around the same
  // moment (e.g. a single app-resume fires both 'focus' and
  // 'visibilitychange'). Without this, that's 2+ concurrent requests for
  // one real refresh, which eats into the per-identity rate-limit ceiling
  // for no benefit.
  const isFetchingRef = useRef(false);

  const fetchView = useCallback(async () => {
    if (!token || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsFetching(true);
    try {
      const result = await client.queries.getStatTrackerView({ token }, { authMode: 'identityPool' });
      if (result.errors && result.errors.length > 0) {
        setLoadError(result.errors[0]?.message ?? 'Something went wrong loading this page.');
      } else {
        setLoadError(null);
        const next = (result.data as StatTrackerViewResult) ?? null;
        // A RATE_LIMITED response is this page's own polling/refresh
        // cadence tripping a per-minute ceiling, not a real state change --
        // the next poll a minute later recovers on its own. Unlike
        // INVALID_LINK (a genuine, permanent revocation the page must
        // reflect -- see the "Mid-session revocation" behavior below),
        // treat it as a transient blip: keep showing the last-known-good
        // view instead of replacing it with the "you're tapping too fast"
        // full-page state.
        setRateLimitedWhilePolling(next?.state === 'RATE_LIMITED');
        setData((prev) => (next?.state === 'RATE_LIMITED' && prev ? prev : next));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Something went wrong loading this page.');
    } finally {
      setHasLoadedOnce(true);
      isFetchingRef.current = false;
      setIsFetching(false);
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

    // 'focus' is a defense-in-depth companion to visibilitychange, not a
    // replacement -- some mobile/PWA contexts (a locked screen through a
    // whole halftime break, in particular) are more reliable about firing
    // window focus on return than visibilitychange. Either one re-polls
    // immediately rather than waiting out the current interval.
    function handleFocus() {
      void fetchView();
    }

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
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

  // Local 1-second tick for the live game clock, seeded from each poll's
  // payload rather than rendering the raw elapsedSeconds directly — a
  // literal reading of the payload would jump in POLL_INTERVAL_MS steps.
  // Same pattern as FanGameView.tsx.
  useEffect(() => {
    if (!data || data.state !== 'LIVE') {
      return;
    }
    setCurrentSeconds(computeCurrentGameSeconds(data));
    const tick = setInterval(() => {
      setCurrentSeconds(computeCurrentGameSeconds(data));
    }, 1000);
    return () => clearInterval(tick);
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

  // Keeps the helper's screen from sleeping mid-game -- covers both
  // in-progress and halftime (viewState === 'LIVE'), same reuse of
  // src/hooks/useWakeLock.ts that GameManagement.tsx mounts for the coach's
  // own live-game screen. No-ops silently on browsers without Wake Lock API
  // support (handled inside the hook).
  useWakeLock(viewState === 'LIVE');

  // Faster resync while the tap UI is locked but the page is still open on
  // a LIVE game (halftime, most commonly) -- a helper shouldn't need to
  // manually reload the page to pick tracking back up once the coach starts
  // the next half; this closes that gap to at most PAUSED_POLL_INTERVAL_MS
  // instead of the normal cadence. A separate, additive interval rather than
  // varying the primary one, so the primary poll's fixed cadence (and its
  // existing tests) are untouched.
  useEffect(() => {
    if (viewState !== 'LIVE' || tapUiUnlocked) return;
    const id = setInterval(() => { void fetchView(); }, PAUSED_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [viewState, tapUiUnlocked, fetchView]);

  const roster: RosterPlayer[] = (data?.roster ?? []).filter((p): p is RosterPlayer => !!p);
  const upcomingGames: UpcomingGame[] = (data?.upcomingGames ?? []).filter((g): g is UpcomingGame => !!g);

  // Show players actually on the field first, then the bench -- a helper
  // logging a shot is almost always picking an on-field player.
  // positionName is only ever non-null for a player with an open
  // PlayTimeRecord (see get-stat-tracker-view/handler.ts), so this is a
  // stable partition, not a guess.
  const onFieldRoster = roster.filter((p) => p.positionName != null);
  const benchRoster = roster.filter((p) => p.positionName == null);
  const sortedRoster = [...onFieldRoster, ...benchRoster];

  // Save Auto-Goalkeeper Attribution: null when the server didn't derive an
  // unambiguous keeper, OR when it named a player no longer present in this
  // roster snapshot (stale/mismatched data guard) -- either way, the helper
  // falls back to the existing full player picker.
  const activeGoalkeeperPlayer = roster.find((p) => p.id === data?.activeGoalkeeperId) ?? null;

  function openFlow(forUs: boolean) {
    if (isSubmitting) return; // duplicate-tap guard: ignore new taps while one is in flight
    setSubmitError(null);
    setFlow({
      step: forUs ? 'player' : 'outcome',
      forUs,
      outcome: null,
      playerId: null,
      assistPlayerId: null,
      clientEventId: crypto.randomUUID(),
      confirmedKeeperName: null,
    });
  }

  function closeFlow() {
    setFlow(CLOSED_FLOW);
    setSubmitError(null);
  }

  function choosePlayer(playerId: string | null) {
    if (flow.outcome === null) {
      // "Us" shooter picker -- the initial step, before an outcome is
      // chosen at all.
      setFlow({ ...flow, playerId, step: 'outcome' });
      return;
    }
    // "Them" + SAVED keeper-override picker, reached via "pick another
    // keeper" below.
    setFlow({ ...flow, playerId, step: 'confirm' });
  }

  function pickDifferentKeeper() {
    setFlow({ ...flow, playerId: null, confirmedKeeperName: null, step: 'player' });
  }

  // Q1 split (UI review): BLOCKED/WIDE submit immediately on tap -- fast,
  // low-stakes, already correctable via the coach's edit modal (M1). GOAL
  // and SAVED always route through an explicit confirm step first.
  function pickOutcome(outcome: ShotOutcome) {
    if (outcome === 'BLOCKED' || outcome === 'WIDE') {
      void submit({ ...flow, outcome });
      return;
    }

    if (outcome === 'GOAL') {
      if (flow.forUs) {
        setFlow({ ...flow, outcome, step: 'assist' });
      } else {
        // Opponent goals carry no scorer/assist attribution.
        setFlow({ ...flow, outcome, step: 'confirm' });
      }
      return;
    }

    // outcome === 'SAVED'
    if (flow.forUs) {
      // "Us" + Saved: no keeper attribution possible (no opponent roster).
      setFlow({ ...flow, outcome, step: 'confirm' });
      return;
    }

    // "Them" + Saved: auto-prefill the current on-field goalkeeper when
    // unambiguous (Save Auto-Goalkeeper Attribution).
    if (activeGoalkeeperPlayer) {
      setFlow({
        ...flow,
        outcome,
        playerId: activeGoalkeeperPlayer.id,
        confirmedKeeperName: `${activeGoalkeeperPlayer.firstName} ${activeGoalkeeperPlayer.lastName}`,
        step: 'confirmKeeper',
      });
    } else {
      setFlow({ ...flow, outcome, step: 'player' });
    }
  }

  function chooseAssist(assistPlayerId: string | null) {
    setFlow({ ...flow, assistPlayerId, step: 'confirm' });
  }

  // The confirm step's Back action returns to whichever step led here,
  // without submitting or clearing clientEventId -- distinct from Cancel,
  // which closes the whole flow.
  function confirmBack() {
    if (flow.outcome === 'GOAL' && flow.forUs) {
      setFlow({ ...flow, step: 'assist' });
    } else if (flow.outcome === 'SAVED' && !flow.forUs) {
      setFlow({ ...flow, step: 'player' });
    } else {
      setFlow({ ...flow, step: 'outcome' });
    }
  }

  async function submit(f: FlowState) {
    if (!f.outcome || f.forUs === null || !token) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await client.mutations.submitStatEvent({
        token,
        outcome: f.outcome,
        forUs: f.forUs,
        playerId: f.forUs && f.playerId ? f.playerId : undefined,
        assistPlayerId: f.forUs && f.assistPlayerId ? f.assistPlayerId : undefined,
        keeperPlayerId: !f.forUs && f.outcome === 'SAVED' && f.playerId ? f.playerId : undefined,
        clientEventId: f.clientEventId ?? undefined,
        expectedGameId: data?.gameId ?? undefined,
      }, { authMode: 'identityPool' });

      const outcomeResult = result.data as { ok: boolean; reason: string | null } | null;
      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors[0]?.message ?? 'Failed to log stat');
      }
      if (!outcomeResult?.ok) {
        // m4: on every rejection (including PARTIAL_WRITE) the sheet is
        // deliberately left exactly where it is -- `flow.clientEventId` is
        // never regenerated here, so a subsequent tap on the same control
        // resumes server-side (PARTIAL_WRITE) or retries cleanly (any other
        // reason) instead of starting a fresh, unrelated dedup row.
        setSubmitError(describeSubmitFailure(outcomeResult?.reason ?? null));
        setIsSubmitting(false);
        return;
      }

      // Success — close the flow and show a brief confirmation. Immediate
      // re-poll so a mid-session game-change/revocation surfaces promptly.
      const label = OUTCOME_LABELS[f.outcome];
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
    // NO_GAMES_YET is only ever reached when the team has zero games at
    // all (selectGameForFan branch 4a) -- upcomingGames is therefore always
    // [] here by construction (see selectUpcomingGames's doc comment), so
    // there's no "coming up" list to show, just the static copy.
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-no-games-yet">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>No games yet — check back once your coach schedules one.</p>
      </div>
    );
  }

  if (viewState === 'NO_GAME_RIGHT_NOW') {
    // Same reasoning as NO_GAMES_YET above: this branch is only reached
    // when no future-dated game exists either, so upcomingGames is always
    // [] here too.
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-no-game-right-now">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>No game right now — check back closer to the next one.</p>
      </div>
    );
  }

  if (viewState === 'NEXT_GAME') {
    // Unlike the two states above, this branch is defined by "at least one
    // future-dated game exists," so upcomingGames is always non-empty here.
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-next-game">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>Stat entry unlocks once the game starts.</p>
        <UpcomingGamesList games={upcomingGames} />
      </div>
    );
  }

  if (viewState === 'FINISHED') {
    // The one state where "what's coming up" is genuinely useful and
    // reachable: today's game just ended, and a future game may already be
    // on the schedule (upcomingGames is independent of which branch
    // selectGameForFan landed on for the *current* game).
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="tracker-state-finished">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>This game has ended — stat entry is closed.</p>
        {upcomingGames.length > 0 && (
          <>
            <p>Next up:</p>
            <UpcomingGamesList games={upcomingGames} />
          </>
        )}
      </div>
    );
  }

  // LIVE — either the tap UI (in-progress) or a "paused" message (halftime).
  const isHalftime = data?.status === 'halftime';
  const halfLabel = isHalftime ? 'Halftime' : (data?.currentHalf === 2 ? '2nd Half' : '1st Half');
  const halfLengthSeconds = (data?.halfLengthMinutes ?? 0) * 60;

  return (
    <div className="fan-mode-page" data-testid="tracker-state-live">
      <header className="fan-mode-header">
        <h1 className="fan-mode-header__title">
          {data?.teamName ?? 'Live Game'} vs {data?.opponentName ?? 'Opponent'}
        </h1>
        {staleFromError && (
          <p className="fan-mode-stale-banner" role="status">Having trouble refreshing — showing the last update.</p>
        )}
        {rateLimitedWhilePolling && (
          <p className="fan-mode-stale-banner" role="status">Refreshing is temporarily limited — showing the last update.</p>
        )}
        <div className="fan-mode-header__row">
          <div className="fan-mode-score" aria-live="polite" aria-atomic="true">
            <div className="fan-mode-score__value">
              {data?.ourScore ?? 0} <span className="fan-mode-score__dash">–</span> {data?.opponentScore ?? 0}
            </div>
          </div>
          <div className="fan-mode-timer">
            <div className="fan-mode-timer__value">{formatPlayTime(currentSeconds, 'short')}</div>
            <div className="fan-mode-timer__meta">
              <span>{halfLabel}</span>
              {!isHalftime && halfLengthSeconds > 0 && <span> / {formatPlayTime(halfLengthSeconds, 'short')}</span>}
            </div>
          </div>
        </div>
      </header>

      {confirmation && (
        <p className="tracker-confirmation" role="status" aria-live="polite" aria-atomic="true">
          {confirmation}
        </p>
      )}

      {tapUiUnlocked && (
        <section aria-label="On-field lineup" className="fan-mode-lineup">
          <h2>On the Field</h2>
          {onFieldRoster.length > 0 ? (
            <TrackerFieldLineup players={onFieldRoster} />
          ) : (
            <p className="fan-mode-empty">No lineup data yet.</p>
          )}
        </section>
      )}

      {tapUiUnlocked && benchRoster.length > 0 && (
        <section aria-label="Bench" className="fan-mode-lineup">
          <h2>Bench</h2>
          <ul className="fan-mode-lineup__grid">
            {benchRoster.map((player) => (
              <li key={player.id} className="fan-mode-lineup__player">
                <span className="fan-mode-lineup__name">#{player.playerNumber ?? '?'} {player.firstName} {player.lastName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!tapUiUnlocked ? (
        <div className="tracker-paused">
          <p className="fan-mode-empty" data-testid="tracker-not-in-progress">
            Stat entry is paused — it unlocks again when the game resumes.
          </p>
          <button
            type="button"
            className="tracker-sheet-option tracker-refresh-button"
            onClick={() => void fetchView()}
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      ) : (
        <div className="tracker-tap-grid" role="group" aria-label="Log a shot">
          <button
            type="button"
            className="tracker-tap-target"
            onClick={() => openFlow(true)}
            disabled={isSubmitting}
          >
            <span aria-hidden="true">🎯</span>
            <span>Log Shot – Us</span>
          </button>
          <button
            type="button"
            className="tracker-tap-target"
            onClick={() => openFlow(false)}
            disabled={isSubmitting}
          >
            <span aria-hidden="true">🎯</span>
            <span>Log Shot – {data?.opponentName ?? 'Opponent'}</span>
          </button>
        </div>
      )}

      {flow.step !== 'closed' && flow.forUs !== null && (
        <StatFlowSheet
          flow={flow}
          opponentName={data?.opponentName ?? 'Opponent'}
          roster={sortedRoster}
          isSubmitting={isSubmitting}
          submitError={submitError}
          onChoosePlayer={choosePlayer}
          onPickOutcome={pickOutcome}
          onPickDifferentKeeper={pickDifferentKeeper}
          onChooseAssist={chooseAssist}
          onConfirmBack={confirmBack}
          onSubmit={(f) => void submit(f)}
          onClose={closeFlow}
        />
      )}
    </div>
  );
}

function formatGameDateTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function UpcomingGamesList({ games }: { games: UpcomingGame[] }) {
  return (
    <ul className="tracker-upcoming-games">
      {games.map((game, index) => (
        <li key={index} className="tracker-upcoming-games__item">
          <span className="tracker-upcoming-games__opponent">vs {game.opponentName ?? 'TBD'}</span>
          <span className="tracker-upcoming-games__date">{formatGameDateTime(game.gameDate)}</span>
        </li>
      ))}
    </ul>
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
    case 'PARTIAL_WRITE':
      // m4: retry-steerable, not a flat failure -- a subsequent tap on the
      // SAME control resumes server-side rather than starting over.
      return 'Almost done — tap it again to finish.';
    default:
      return 'Could not log that. Please try again.';
  }
}

interface StatFlowSheetProps {
  flow: FlowState;
  opponentName: string;
  roster: RosterPlayer[];
  isSubmitting: boolean;
  submitError: string | null;
  onChoosePlayer: (playerId: string | null) => void;
  onPickOutcome: (outcome: ShotOutcome) => void;
  onPickDifferentKeeper: () => void;
  onChooseAssist: (assistPlayerId: string | null) => void;
  onConfirmBack: () => void;
  onSubmit: (f: FlowState) => void;
  onClose: () => void;
}

// Sheet-based per-tap question flow — deliberately distinct from the
// coach-side ShotOutcomeEntry's modal shape; this is a different page with a
// different interaction model (one shared sheet driving every tap) and
// stays as designed here. Save Auto-Goalkeeper Attribution's `confirmKeeper`
// step is a specialized instance of the same review-with-override-before-
// commit shape the generic `confirm` step below generalizes to every other
// GOAL/SAVED path (Q1).
function StatFlowSheet({
  flow, opponentName, roster, isSubmitting, submitError,
  onChoosePlayer, onPickOutcome, onPickDifferentKeeper, onChooseAssist, onConfirmBack, onSubmit, onClose,
}: StatFlowSheetProps) {
  const titleId = 'tracker-flow-title';
  const sideLabel = flow.forUs ? 'Us' : opponentName;

  return (
    <div className="tracker-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="tracker-sheet">
        <h2 id={titleId}>🎯 Log Shot – {sideLabel}</h2>

        {flow.step === 'player' && (
          <PlayerPickerStep
            roster={roster}
            heading={flow.outcome === null ? 'Who took the shot?' : 'Which keeper?'}
            isSubmitting={isSubmitting}
            onChoose={onChoosePlayer}
          />
        )}

        {flow.step === 'outcome' && (
          <div className="tracker-sheet-options">
            <p>What happened?</p>
            <button type="button" className="tracker-sheet-option" onClick={() => onPickOutcome('GOAL')} disabled={isSubmitting}>
              Goal
            </button>
            <button type="button" className="tracker-sheet-option" onClick={() => onPickOutcome('SAVED')} disabled={isSubmitting}>
              Saved
            </button>
            <button type="button" className="tracker-sheet-option" onClick={() => onPickOutcome('BLOCKED')} disabled={isSubmitting}>
              Blocked
            </button>
            <button type="button" className="tracker-sheet-option" onClick={() => onPickOutcome('WIDE')} disabled={isSubmitting}>
              Wide
            </button>
          </div>
        )}

        {flow.step === 'confirmKeeper' && flow.confirmedKeeperName && (
          <div className="tracker-sheet-options">
            <p>{flow.confirmedKeeperName} made the save?</p>
            <button
              type="button"
              className="tracker-sheet-option tracker-sheet-option--primary"
              onClick={() => onSubmit(flow)}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Logging…' : 'Log Save'}
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
            onChoose={onChooseAssist}
          />
        )}

        {flow.step === 'confirm' && flow.outcome && (
          <div className="tracker-sheet-options">
            <button
              type="button"
              className="tracker-sheet-option tracker-sheet-option--primary"
              onClick={() => onSubmit(flow)}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Logging…' : `Log ${flow.outcome === 'GOAL' ? 'Goal' : 'Save'}`}
            </button>
            <button type="button" className="tracker-sheet-option tracker-sheet-option--skip" onClick={onConfirmBack} disabled={isSubmitting}>
              Back
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
  // `roster` arrives already on-field-first (see StatTrackerView's
  // sortedRoster) -- re-partitioned here only to add group labels, and only
  // when there's an actual mix to label (a fully-bench or fully-on-field
  // roster, e.g. the game isn't in-progress, gets no labels at all).
  const onField = roster.filter((p) => p.positionName != null);
  const bench = roster.filter((p) => p.positionName == null);
  const showGroupLabels = onField.length > 0 && bench.length > 0;

  function renderButton(player: RosterPlayer) {
    return (
      <button
        key={player.id}
        type="button"
        className="tracker-sheet-option"
        onClick={() => onChoose(player.id)}
        disabled={isSubmitting}
      >
        #{player.playerNumber ?? '?'} {player.firstName} {player.lastName}
      </button>
    );
  }

  return (
    <div className="tracker-sheet-options">
      <p>{heading}</p>
      <div className="tracker-player-list">
        {showGroupLabels && <p className="tracker-player-list__group-label">On the field</p>}
        {onField.map(renderButton)}
        {showGroupLabels && <p className="tracker-player-list__group-label">Bench</p>}
        {bench.map(renderButton)}
      </div>
      <button type="button" className="tracker-sheet-option tracker-sheet-option--skip" onClick={() => onChoose(null)} disabled={isSubmitting}>
        {skipLabel}
      </button>
    </div>
  );
}
