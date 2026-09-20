import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';
import { computeCurrentGameSeconds } from '../../utils/gameClock';
import { formatPlayTime } from '../../utils/playTimeCalculations';
import './FanMode.css';

// Public, unauthenticated screen (`/watch/:token`) — the app's first
// guest-reachable surface. Polls `getFanGameView` (guest + IAM
// identityPool auth) on a fixed cadence, paused via the Page Visibility API
// while the tab is hidden and immediately re-polled on resume (otherwise
// the clock would look frozen/broken while backgrounded, not paused).
const POLL_INTERVAL_MS = 12000;

const client = generateClient<Schema>();

type FanGameViewResult = NonNullable<Schema['getFanGameView']['returnType']>;

type ViewState =
  | 'LOADING'
  | 'LIVE'
  | 'FINISHED'
  | 'NEXT_GAME'
  | 'NO_GAMES_YET'
  | 'NO_GAME_RIGHT_NOW'
  | 'RATE_LIMITED'
  | 'INVALID_LINK';

function formatGameDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatGameDateTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function FanGameView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<FanGameViewResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchView = useCallback(async () => {
    if (!token) return;
    try {
      const result = await client.queries.getFanGameView({ token }, { authMode: 'identityPool' });
      if (result.errors && result.errors.length > 0) {
        setLoadError(result.errors[0]?.message ?? 'Something went wrong loading this game.');
      } else {
        setLoadError(null);
        setData((result.data as FanGameViewResult) ?? null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Something went wrong loading this game.');
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
        // Immediate re-poll on resume — otherwise the clock would look
        // frozen/broken (mid-value from before the tab was hidden) instead
        // of correctly paused.
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

  // Local 1-second tick for the live game clock, seeded from each poll's
  // payload rather than rendering the raw elapsedSeconds directly — a
  // literal reading of the payload would jump in POLL_INTERVAL_MS steps.
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

  // A poll error only means "this link is invalid" on the very first load —
  // once we have a good `data` payload, a later poll blip (a real scenario on
  // the mobile/stadium connections this page is built for) must not discard
  // the last-known-good view. `staleFromError` drives a small "having
  // trouble refreshing" banner instead of blanking the whole page.
  const staleFromError = !!(loadError && data);
  // A bookmarked/shared /watch/:token tab otherwise keeps the generic
  // app-wide title forever, which is useless in a browser tab list for a
  // link people are expected to keep open through a whole game.
  useEffect(() => {
    const team = data?.teamName;
    if (!team) {
      document.title = 'TeamTrack - Fan Mode';
      return;
    }
    if (data?.state === 'LIVE') {
      document.title = `${data.ourScore ?? 0}-${data.opponentScore ?? 0} · ${team} - TeamTrack`;
    } else if (data?.state === 'FINISHED') {
      document.title = `Final: ${data.ourScore ?? 0}-${data.opponentScore ?? 0} · ${team} - TeamTrack`;
    } else {
      document.title = `${team} - TeamTrack`;
    }
  }, [data]);

  const viewState: ViewState = !hasLoadedOnce
    ? 'LOADING'
    : (loadError && !data)
      ? 'INVALID_LINK'
      : ((data?.state as ViewState | undefined) ?? 'INVALID_LINK');

  const staleBanner = staleFromError ? (
    <p className="fan-mode-stale-banner" role="status">Having trouble refreshing — showing the last update.</p>
  ) : null;

  if (viewState === 'LOADING') {
    return (
      <div className="fan-mode-page fan-mode-page--center">
        <p>Loading...</p>
      </div>
    );
  }

  if (viewState === 'INVALID_LINK') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="fan-state-invalid-link">
        <h1>This link isn't valid</h1>
        <p>Check with your coach for an up-to-date link.</p>
      </div>
    );
  }

  if (viewState === 'RATE_LIMITED') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="fan-state-rate-limited">
        <h1>You're checking a bit too often</h1>
        <p>Try again in a moment.</p>
      </div>
    );
  }

  if (viewState === 'NO_GAMES_YET') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="fan-state-no-games-yet">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>No games yet — check back once your coach schedules one.</p>
      </div>
    );
  }

  if (viewState === 'NO_GAME_RIGHT_NOW') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="fan-state-no-game-right-now">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>No game right now — check back closer to the next one.</p>
      </div>
    );
  }

  if (viewState === 'NEXT_GAME') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="fan-state-next-game">
        <h1>{data?.teamName ?? 'This team'}</h1>
        <p>Next game: vs {data?.opponentName ?? 'TBD'}</p>
        <p>{formatGameDateTime(data?.gameDate)}</p>
      </div>
    );
  }

  if (viewState === 'FINISHED') {
    return (
      <div className="fan-mode-page fan-mode-page--center" data-testid="fan-state-finished">
        <h1>{data?.teamName ?? 'This team'}</h1>
        {staleBanner}
        <p>Final ({formatGameDate(data?.gameDate)})</p>
        <div className="fan-mode-score" aria-live="polite" aria-atomic="true">
          {data?.ourScore ?? 0} <span className="fan-mode-score__dash">–</span> {data?.opponentScore ?? 0}
        </div>
        <p>vs {data?.opponentName ?? 'Opponent'}</p>
        <RecentEventsFeed events={data?.recentEvents ?? []} />
      </div>
    );
  }

  // LIVE — the main scoreboard/lineup/events view.
  const isHalftime = data?.status === 'halftime';
  const halfLabel = isHalftime ? 'Halftime' : (data?.currentHalf === 2 ? '2nd Half' : '1st Half');
  const halfLengthSeconds = (data?.halfLengthMinutes ?? 0) * 60;

  return (
    <div className="fan-mode-page" data-testid="fan-state-live">
      <header className="fan-mode-header">
        <h1 className="fan-mode-header__title">{data?.teamName ?? 'Live Game'} vs {data?.opponentName ?? 'Opponent'}</h1>
        {staleBanner}
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

      <section aria-label="On-field lineup" className="fan-mode-lineup">
        <h2>On the Field</h2>
        {data?.onFieldPlayers && data.onFieldPlayers.length > 0 ? (
          <ul className="fan-mode-lineup__grid">
            {data.onFieldPlayers.map((player, index) => (
              <li key={index} className="fan-mode-lineup__player">
                <span className="fan-mode-lineup__name">{player?.firstName} {player?.lastInitial}</span>
                {player?.positionName && <span className="fan-mode-lineup__position">{player.positionName}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="fan-mode-empty">No lineup data yet.</p>
        )}
      </section>

      <RecentEventsFeed events={data?.recentEvents ?? []} />
    </div>
  );
}

function RecentEventsFeed({ events }: { events: FanGameViewResult['recentEvents'] }) {
  const list = events ?? [];
  return (
    <section aria-label="Recent events" className="fan-mode-events">
      <h2>Recent Events</h2>
      {list.length > 0 ? (
        <ul className="fan-mode-events__list">
          {list.map((event, index) => (
            <li key={index} className="fan-mode-events__item">
              <span className="fan-mode-events__type">{event?.type === 'GOAL' ? '⚽ Goal' : '🔄 Sub'}</span>
              {event?.playerName && <span className="fan-mode-events__player">{event.playerName}</span>}
              {typeof event?.minute === 'number' && <span className="fan-mode-events__minute">{event.minute}'</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="fan-mode-empty">No events yet.</p>
      )}
    </section>
  );
}
