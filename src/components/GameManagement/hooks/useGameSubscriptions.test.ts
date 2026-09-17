import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useGameSubscriptions,
  classifyIncomingGameEvent,
  mergeIncomingGameState,
  computeGapConfirmationDecision,
} from './useGameSubscriptions';
import type { Game, Team } from '../types';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// Capture the `next` callback from Game.observeQuery so tests can fire events.
let capturedGameNext: ((data: { items: Partial<Game>[] }) => void) | null = null;

const { mockGameObserveQuery, mockGamePlanObserveQuery, mockPlannedRotationObserveQuery } =
  vi.hoisted(() => ({
    mockGameObserveQuery: vi.fn(),
    mockGamePlanObserveQuery: vi.fn(),
    mockPlannedRotationObserveQuery: vi.fn(),
  }));

const { mockPlannedRotationList } = vi.hoisted(() => ({
  mockPlannedRotationList: vi.fn().mockResolvedValue({ data: [] }),
}));

const { mockLineupList, mockLineupCreate, mockLineupDelete, mockLineupUpdate } = vi.hoisted(() => ({
  mockLineupList: vi.fn().mockResolvedValue({ data: [] }),
  mockLineupCreate: vi.fn().mockResolvedValue({ data: {} }),
  mockLineupDelete: vi.fn().mockResolvedValue({ data: {} }),
  mockLineupUpdate: vi.fn().mockResolvedValue({ data: {} }),
}));

const { mockUseAmplifyQuery } = vi.hoisted(() => ({
  mockUseAmplifyQuery: vi.fn(),
}));

const { mockHandleApiError } = vi.hoisted(() => ({
  mockHandleApiError: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: {
        observeQuery: mockGameObserveQuery,
      },
      GamePlan: {
        observeQuery: mockGamePlanObserveQuery,
      },
      PlannedRotation: {
        observeQuery: mockPlannedRotationObserveQuery,
        list: mockPlannedRotationList,
      },
      LineupAssignment: {
        list: mockLineupList,
        create: mockLineupCreate,
        delete: mockLineupDelete,
        update: mockLineupUpdate,
      },
    },
  })),
}));

// Mock useAmplifyQuery so the secondary subscriptions (LineupAssignment,
// PlayTimeRecord, Goal, GameNote, PlayerAvailability) don't interfere.
vi.mock('../../../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: mockUseAmplifyQuery,
}));

vi.mock('../../../utils/errorHandler', () => ({
  handleApiError: (...args: unknown[]) => mockHandleApiError(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNoOpSub() {
  return { unsubscribe: vi.fn() };
}

function createDefaultGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    status: 'in-progress',
    elapsedSeconds: 0,
    lastStartTime: null,
    currentHalf: 1,
    ...overrides,
  } as Game;
}

function createDefaultTeam(): Team {
  return {
    id: 'team-1',
    coaches: [],
  } as unknown as Team;
}

function createDefaultProps(overrides: {
  isRunning?: boolean;
  setCurrentTime?: ReturnType<typeof vi.fn>;
  setIsRunning?: ReturnType<typeof vi.fn>;
  game?: Game;
  userId?: string;
} = {}) {
  return {
    game: overrides.game ?? createDefaultGame(),
    team: createDefaultTeam(),
    isRunning: overrides.isRunning ?? false,
    setCurrentTime: overrides.setCurrentTime ?? vi.fn(),
    setIsRunning: overrides.setIsRunning ?? vi.fn(),
    notesRefreshKey: 0,
    userId: overrides.userId ?? '',
  };
}

// ---------------------------------------------------------------------------
// Direct unit tests for the extracted decision functions (Issue C) — these
// exercise classifyIncomingGameEvent/mergeIncomingGameState/
// computeGapConfirmationDecision in isolation, independent of the
// observeQuery/renderHook machinery the tests below also cover them through.
// ---------------------------------------------------------------------------

describe('classifyIncomingGameEvent', () => {
  it('flags a legitimate second-half start event', () => {
    const result = classifyIncomingGameEvent({ status: 'in-progress', currentHalf: 2 }, 'halftime', 1);
    expect(result.isSecondHalfStartEvent).toBe(true);
  });

  it('does not flag second-half start when status is not in-progress', () => {
    const result = classifyIncomingGameEvent({ status: 'halftime', currentHalf: 2 }, 'halftime', 1);
    expect(result.isSecondHalfStartEvent).toBe(false);
  });

  it('flags a stale first-half event arriving after local state already advanced to second half', () => {
    const result = classifyIncomingGameEvent({ status: 'in-progress', currentHalf: 1 }, 'in-progress', 2);
    expect(result.isStaleSecondHalfRegression).toBe(true);
  });

  it('does not flag stale second-half regression when the incoming half is also 2', () => {
    const result = classifyIncomingGameEvent({ status: 'in-progress', currentHalf: 2 }, 'in-progress', 2);
    expect(result.isStaleSecondHalfRegression).toBe(false);
  });

  it.each(['in-progress', 'halftime', 'completed'] as const)(
    'flags a stale scheduled event when local status is already %s',
    (localStatus) => {
      const result = classifyIncomingGameEvent({ status: 'scheduled', currentHalf: 1 }, localStatus, 1);
      expect(result.isStaleScheduledRegression).toBe(true);
    }
  );

  it('does not flag stale scheduled regression when local status is also scheduled', () => {
    const result = classifyIncomingGameEvent({ status: 'scheduled', currentHalf: 1 }, 'scheduled', 1);
    expect(result.isStaleScheduledRegression).toBe(false);
  });
});

describe('mergeIncomingGameState', () => {
  it('keeps prev unchanged once local state is completed', () => {
    const prev = createDefaultGame({ status: 'completed' });
    const updatedGame = createDefaultGame({ status: 'in-progress' });
    expect(mergeIncomingGameState(prev, updatedGame, false)).toBe(prev);
  });

  it('rejects a scheduled event regressing local in-progress/halftime state', () => {
    const prev = createDefaultGame({ status: 'in-progress' });
    const updatedGame = createDefaultGame({ status: 'scheduled' });
    expect(mergeIncomingGameState(prev, updatedGame, false)).toBe(prev);
  });

  it('rejects a stale in-progress event while local state is halftime, unless it is a real second-half start', () => {
    const prev = createDefaultGame({ status: 'halftime' });
    const updatedGame = createDefaultGame({ status: 'in-progress', currentHalf: 2 });
    expect(mergeIncomingGameState(prev, updatedGame, false)).toBe(prev);
    expect(mergeIncomingGameState(prev, updatedGame, true)).not.toBe(prev);
  });

  it('rejects a stale first-half event regressing local second-half in-progress state', () => {
    const prev = createDefaultGame({ status: 'in-progress', currentHalf: 2 });
    const updatedGame = createDefaultGame({ status: 'in-progress', currentHalf: 1 });
    expect(mergeIncomingGameState(prev, updatedGame, false)).toBe(prev);
  });

  it('merges the incoming game but preserves the locally-derived score (issue #177)', () => {
    const prev = createDefaultGame({ status: 'in-progress', ourScore: 3, opponentScore: 2 });
    const updatedGame = createDefaultGame({ status: 'in-progress', elapsedSeconds: 900, ourScore: 0, opponentScore: 0 });
    const merged = mergeIncomingGameState(prev, updatedGame, false);
    expect(merged.elapsedSeconds).toBe(900);
    expect(merged.ourScore).toBe(3);
    expect(merged.opponentScore).toBe(2);
  });
});

describe('computeGapConfirmationDecision', () => {
  const HEARTBEAT_KEY = 'teamtrack:timerHeartbeat:user-1:game-1';

  afterEach(() => {
    localStorage.clear();
  });

  it('returns already-pending when a correction is already pending, regardless of the gap', () => {
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 1, halfLengthMinutes: null },
      teamHalfLengthMinutes: 30,
      priorElapsed: 0,
      additionalSeconds: 5,
      currentUserId: 'user-1',
      gameId: 'game-1',
      hasPendingCorrection: true,
    });
    expect(decision.kind).toBe('already-pending');
  });

  it('returns silent-apply when there is no continuity heartbeat', () => {
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 1, halfLengthMinutes: null },
      teamHalfLengthMinutes: 30,
      priorElapsed: 0,
      additionalSeconds: 1200,
      currentUserId: 'user-1',
      gameId: 'game-1',
      hasPendingCorrection: false,
    });
    expect(decision).toEqual({ kind: 'silent-apply', proposedElapsed: 1200 });
  });

  it('returns silent-apply when the gap is below the anomalous threshold, even with continuity', () => {
    localStorage.setItem(HEARTBEAT_KEY, '1');
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 1, halfLengthMinutes: null },
      teamHalfLengthMinutes: 30,
      priorElapsed: 0,
      additionalSeconds: 30,
      currentUserId: 'user-1',
      gameId: 'game-1',
      hasPendingCorrection: false,
    });
    expect(decision.kind).toBe('silent-apply');
  });

  it('returns propose when continuity, an anomalous gap, and no auto-trigger boundary all hold', () => {
    localStorage.setItem(HEARTBEAT_KEY, '1');
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 2, halfLengthMinutes: null },
      teamHalfLengthMinutes: 30,
      priorElapsed: 2000,
      additionalSeconds: 900,
      currentUserId: 'user-1',
      gameId: 'game-1',
      hasPendingCorrection: false,
    });
    expect(decision).toEqual({ kind: 'propose', proposedElapsed: 2900 });
  });

  it('returns silent-apply when the proposed elapsed crosses the auto-halftime boundary in half 1', () => {
    localStorage.setItem(HEARTBEAT_KEY, '1');
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 1, halfLengthMinutes: null },
      teamHalfLengthMinutes: 30,
      priorElapsed: 1700,
      additionalSeconds: 650,
      currentUserId: 'user-1',
      gameId: 'game-1',
      hasPendingCorrection: false,
    });
    expect(decision.kind).toBe('silent-apply');
  });

  it('returns silent-apply when the proposed elapsed crosses MAX_GAME_SECONDS, even in half 2', () => {
    localStorage.setItem(HEARTBEAT_KEY, '1');
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 2, halfLengthMinutes: null },
      teamHalfLengthMinutes: 30,
      priorElapsed: 7000,
      additionalSeconds: 900,
      currentUserId: 'user-1',
      gameId: 'game-1',
      hasPendingCorrection: false,
    });
    expect(decision.kind).toBe('silent-apply');
  });

  it('uses the per-game halfLengthMinutes override over the team default when present', () => {
    localStorage.setItem(HEARTBEAT_KEY, '1');
    // Team default is 30 min (1800s); a 10-min (600s) per-game override means
    // priorElapsed=500 + 650s gap = 1150, which crosses the 600s override but
    // would NOT cross the 1800s team default — proves the override is honored.
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 1, halfLengthMinutes: 10 },
      teamHalfLengthMinutes: 30,
      priorElapsed: 500,
      additionalSeconds: 650,
      currentUserId: 'user-1',
      gameId: 'game-1',
      hasPendingCorrection: false,
    });
    expect(decision.kind).toBe('silent-apply');
  });

  it('returns silent-apply when currentUserId is empty (no continuity possible)', () => {
    const decision = computeGapConfirmationDecision({
      updatedGame: { currentHalf: 1, halfLengthMinutes: null },
      teamHalfLengthMinutes: 30,
      priorElapsed: 0,
      additionalSeconds: 900,
      currentUserId: '',
      gameId: 'game-1',
      hasPendingCorrection: false,
    });
    expect(decision.kind).toBe('silent-apply');
  });
});

describe('useGameSubscriptions — Game observeQuery handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedGameNext = null;
    mockUseAmplifyQuery.mockReturnValue({ data: [], isSynced: false });
    mockLineupList.mockResolvedValue({ data: [] });
    mockLineupCreate.mockResolvedValue({ data: {} });
    mockLineupDelete.mockResolvedValue({ data: {} });
    mockLineupUpdate.mockResolvedValue({ data: {} });
    mockHandleApiError.mockReset();
    mockPlannedRotationList.mockResolvedValue({ data: [] });

    // Game.observeQuery captures the `next` callback so tests can trigger events.
    mockGameObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Partial<Game>[] }) => void }) => {
        capturedGameNext = handlers.next;
        return makeNoOpSub();
      },
    });

    // GamePlan and PlannedRotation subscriptions are no-ops for these tests.
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: () => makeNoOpSub(),
    });
    mockPlannedRotationObserveQuery.mockReturnValue({
      subscribe: () => makeNoOpSub(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('stops the timer when completed status arrives even if isRunning is true (primary bug fix)', () => {
    // Setup: isRunning = true — the timer was already running (e.g., due to
    // stale Amplify cache data that had status: 'in-progress').
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: true, setIsRunning, setCurrentTime });

    renderHook(() => useGameSubscriptions(props));

    // Verify the subscription was set up and we captured the next callback.
    expect(capturedGameNext).not.toBeNull();

    // Fire the subscription with completed status — this is the live data arriving
    // AFTER stale cache had incorrectly shown the game as in-progress.
    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'completed',
            elapsedSeconds: 2700,
            lastStartTime: null,
          } as Partial<Game>,
        ],
      });
    });

    // The completed guard must fire BEFORE the `if (isRunning) return` guard.
    // setIsRunning(false) stops the erroneously-running timer.
    expect(setIsRunning).toHaveBeenCalledWith(false);
    // setCurrentTime is called with the authoritative final elapsed time.
    expect(setCurrentTime).toHaveBeenCalledWith(2700);
  });

  it('does NOT preserve locally-derived score when the incoming status is completed (the other side of the #177 asymmetry — characterization for Issue C)', () => {
    // The general merge path (setGameState(prev => ({...updatedGame, ourScore: prev.ourScore, ...})))
    // deliberately preserves locally-derived score (issue #177, tested below). The
    // `completed` branch takes a separate, earlier return and calls
    // setGameState(updatedGame) directly — this is a real, load-bearing asymmetry
    // (the final score snapshot IS written to the DB by handleEndGame before this
    // event fires, so the DB's completed-status score is authoritative here, unlike
    // the local derivation used for an in-progress game). Pinning both sides so a
    // future refactor doesn't accidentally "fix" this into symmetry.
    const props = createDefaultProps({ isRunning: false });
    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      result.current.setGameState(prev => ({ ...prev, ourScore: 3, opponentScore: 2 }));
    });
    expect(result.current.gameState.ourScore).toBe(3);

    act(() => {
      capturedGameNext!({
        items: [{ id: 'game-1', status: 'completed', elapsedSeconds: 2700, lastStartTime: null, ourScore: 5, opponentScore: 1 } as Partial<Game>],
      });
    });

    // Overwritten with the DB's completed-snapshot score, NOT preserved.
    expect(result.current.gameState.ourScore).toBe(5);
    expect(result.current.gameState.opponentScore).toBe(1);
  });

  it('releases manuallyPausedRef when a confirmed-pause event arrives (lastStartTime cleared)', () => {
    // handlePauseTimer sets manuallyPausedRef=true locally and writes
    // lastStartTime:null to the DB. This event — the DB write echoing back — is
    // the ONLY place manuallyPausedRef is reset from inside this hook (every
    // other reset is a local handler in GameManagement.tsx setting it directly).
    // Losing this in a refactor would permanently block auto-resume for any
    // FUTURE resume event after one manual pause.
    const props = createDefaultProps({ isRunning: false });
    const { result } = renderHook(() => useGameSubscriptions(props));

    result.current.manuallyPausedRef.current = true;

    act(() => {
      capturedGameNext!({
        items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 500, lastStartTime: null } as Partial<Game>],
      });
    });

    expect(result.current.manuallyPausedRef.current).toBe(false);
  });

  it('does not stop timer or update time when a non-completed update arrives while running', () => {
    // Setup: isRunning = true — the timer is correctly running.
    // A score update (or other data change) arrives via the subscription.
    // The `if (isRunning) return` guard must prevent time from being overwritten.
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: true, setIsRunning, setCurrentTime });

    renderHook(() => useGameSubscriptions(props));

    expect(capturedGameNext).not.toBeNull();

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            elapsedSeconds: 1800,
            lastStartTime: new Date().toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    // The isRunning guard should have blocked any state updates for the timer.
    expect(setIsRunning).not.toHaveBeenCalled();
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('auto-resumes timer when in-progress with lastStartTime arrives while not running', () => {
    vi.useFakeTimers();

    // Setup: isRunning = false (fresh load or after a pause that was not manual).
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime });

    // Freeze time so the additionalSeconds calculation is deterministic.
    const now = Date.now();
    // lastStartTime is 30 seconds in the past.
    const lastStartTime = new Date(now - 30_000).toISOString();

    renderHook(() => useGameSubscriptions(props));

    expect(capturedGameNext).not.toBeNull();

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            elapsedSeconds: 1000,
            lastStartTime,
          } as Partial<Game>,
        ],
      });
    });

    // Timer should have been started.
    expect(setIsRunning).toHaveBeenCalledWith(true);

    // Time should have been set to elapsedSeconds + additionalSeconds (≈ 1030).
    expect(setCurrentTime).toHaveBeenCalledTimes(1);
    const setTimeArg = setCurrentTime.mock.calls[0][0] as number;
    // Allow ±1s tolerance for timing variance.
    expect(setTimeArg).toBeGreaterThanOrEqual(1029);
    expect(setTimeArg).toBeLessThanOrEqual(1031);
  });

  describe('timer gap confirmation (Issue B)', () => {
    const HEARTBEAT_KEY = 'teamtrack:timerHeartbeat:user-1:game-1';

    it('applies a large gap silently when this device has no continuity heartbeat (e.g. a second coach opening an already-running game)', () => {
      vi.useFakeTimers();
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      // No heartbeat written — userId set, but this device never ran this game's timer.
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 20 * 60_000).toISOString(); // 20 min gap — well past threshold

      renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 0, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
    });

    it('applies a large gap silently when userId has not loaded yet', () => {
      vi.useFakeTimers();
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: '' });
      localStorage.setItem('teamtrack:timerHeartbeat::game-1', '1'); // can't happen for real, but prove userId is required

      const now = Date.now();
      const lastStartTime = new Date(now - 20 * 60_000).toISOString();

      renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 0, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
    });

    it('proposes a gap correction using the CURRENT userId even though it loaded after mount (regression: stale closure caught in review)', () => {
      // Mirrors GameManagement.tsx's real timeline: userId starts as '' (useState('')),
      // and is only populated later by an async getCurrentUser() effect — well after
      // this hook's Game.observeQuery subscription (deps: [game.id] only) has already
      // subscribed once. Without userIdRef, the subscription's `next` closure would
      // permanently see the mount-time '', making the gap-confirmation feature
      // silently inert for the entire session.
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: '' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result, rerender } = renderHook((p) => useGameSubscriptions(p), { initialProps: props });

      // userId loads asynchronously, same game.id — the subscription effect does NOT re-run.
      rerender({ ...props, userId: 'user-1' });

      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).not.toBeNull();
    });

    it('applies a small gap silently even with a continuity heartbeat present (below threshold)', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 30_000).toISOString(); // 30s — below the 600s threshold

      renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 0, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
    });

    it('proposes a gap correction instead of auto-resuming when this device has continuity, the gap is anomalous, and no auto-trigger boundary is crossed', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      // Second half, elapsed already past the half-length boundary — a 15 min
      // gap here does NOT cross MAX_GAME_SECONDS (7200s), so it's eligible.
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });

      // Must NOT have auto-resumed.
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();
      // Must have proposed a correction instead.
      expect(result.current.pendingGapCorrection).not.toBeNull();
      expect(result.current.pendingGapCorrection?.priorElapsed).toBe(2000);
      expect(result.current.pendingGapCorrection?.gapSeconds).toBeGreaterThanOrEqual(899);
      expect(result.current.pendingGapCorrection?.gapSeconds).toBeLessThanOrEqual(901);
    });

    it('stays silent when the gap would cross the auto-halftime boundary in half 1', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      // elapsedSeconds=1700 + an ~11 min (>600s, anomalous) gap crosses the
      // 30-min (1800s) default half length.
      const lastStartTime = new Date(now - 11 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 1700, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).toBeNull();
    });

    it('stays silent when the gap would cross the auto-end boundary, even in the second half', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      // elapsedSeconds already at 7000; a 15 min gap pushes past MAX_GAME_SECONDS (7200).
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 7000, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).toBeNull();
    });

    it('does not propose a second pending correction — or silently apply the gap underneath the open dialog — while one is already awaiting an answer', () => {
      // Regression (caught in review): a naive if/else that falls through to
      // the silent-apply branch whenever the "propose" condition isn't met
      // would silently jump the clock and resume the timer out from under an
      // already-open "Was play stopped?" dialog on a second matching event.
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });
      const firstPending = result.current.pendingGapCorrection;
      expect(firstPending).not.toBeNull();
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();

      // A second, slightly different event arrives while still pending.
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });

      expect(result.current.pendingGapCorrection).toBe(firstPending);
      // Must still not have silently applied the gap underneath the open dialog.
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();
    });

    it('does not silently apply the gap underneath the open dialog when a later event\'s recomputed gap newly crosses an auto-trigger boundary', () => {
      // Regression (caught in a second-round review): the first fix only
      // guarded the "propose" branch against a pending correction, but the
      // silent-apply branch had no such guard. If the dialog is still open
      // and enough real time passes that a later event's proposedElapsed
      // newly crosses an auto-trigger boundary, gapNeedsConfirmation flips to
      // false and the code must still stay a no-op — not silently jump the
      // clock and resume underneath the coach's still-open dialog.
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      // Half 1, elapsedSeconds=1000 + ~700s gap = 1700, under the 1800s boundary.
      const lastStartTime = new Date(now - 700_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 1000, lastStartTime } as Partial<Game>],
        });
      });
      expect(result.current.pendingGapCorrection).not.toBeNull();

      // 200s more real time passes while the dialog sits open (e.g. a slow
      // sideline connection re-syncing observeQuery). The same lastStartTime
      // now computes a gap that crosses the 1800s auto-halftime boundary.
      act(() => {
        vi.advanceTimersByTime(200_000);
      });
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 1000, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).not.toBeNull();
    });

    it('resolveGapCorrection(true) applies the proposed elapsed time and resumes', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });
      const proposed = result.current.pendingGapCorrection?.proposedElapsed;
      expect(proposed).toBeDefined();

      act(() => {
        result.current.resolveGapCorrection(true);
      });

      expect(setCurrentTime).toHaveBeenCalledWith(proposed);
      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(result.current.pendingGapCorrection).toBeNull();
    });

    it('resolveGapCorrection(false) leaves currentTime/isRunning untouched and sets manuallyPausedRef', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });
      expect(result.current.pendingGapCorrection).not.toBeNull();

      act(() => {
        result.current.resolveGapCorrection(false);
      });

      expect(setCurrentTime).not.toHaveBeenCalled();
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).toBeNull();
      expect(result.current.manuallyPausedRef.current).toBe(true);
    });
  });

  it('does not fire setIsRunning or setCurrentTime when subscription data is empty', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({ items: [] });
    });

    expect(setIsRunning).not.toHaveBeenCalled();
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('does NOT auto-resume when a stale in-progress event arrives after game was completed (regression guard)', () => {
    // This tests the fix for: games persisting as in-progress on Home screen
    // after End Game was pressed.
    //
    // Scenario: the game is already completed in local state (coach pressed
    // End Game). A stale subscription notification from a prior timer-sync
    // write arrives late. Without the regression guard, this would call
    // setIsRunning(true) and re-start the saveInterval.
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const completedGame = createDefaultGame({
      status: 'completed',
      elapsedSeconds: 2700,
      lastStartTime: null,
    });
    const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, game: completedGame });

    renderHook(() => useGameSubscriptions(props));

    expect(capturedGameNext).not.toBeNull();

    // Fire a stale in-progress event — simulates a late DynamoDB subscription
    // notification from a timer-sync write that happened before End Game.
    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            elapsedSeconds: 2695,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    // The regression guard must block auto-resume: timer should NOT restart.
    expect(setIsRunning).not.toHaveBeenCalledWith(true);
    // Time should NOT be updated (stays at 2700 from the completed state).
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('ignores stale scheduled events after local state has already advanced to in-progress', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const liveGame = createDefaultGame({
      status: 'in-progress',
      elapsedSeconds: 300,
      lastStartTime: new Date(Date.now() - 5_000).toISOString(),
    });
    const props = createDefaultProps({
      isRunning: true,
      setIsRunning,
      setCurrentTime,
      game: liveGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'scheduled',
            elapsedSeconds: 0,
            lastStartTime: null,
            currentHalf: 1,
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('in-progress');
    expect(setIsRunning).not.toHaveBeenCalled();
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('blocks stale in-progress half-1 events while local state is halftime', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const halftimeGame = createDefaultGame({
      status: 'halftime',
      currentHalf: 1,
      elapsedSeconds: 1800,
      lastStartTime: null,
    });
    const props = createDefaultProps({
      isRunning: false,
      setIsRunning,
      setCurrentTime,
      game: halftimeGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            currentHalf: 1,
            elapsedSeconds: 1800,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('halftime');
    expect(setIsRunning).not.toHaveBeenCalledWith(true);
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('accepts legitimate second-half in-progress events while local state is halftime', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const halftimeGame = createDefaultGame({
      status: 'halftime',
      currentHalf: 1,
      elapsedSeconds: 1800,
      lastStartTime: null,
    });
    const props = createDefaultProps({
      isRunning: false,
      setIsRunning,
      setCurrentTime,
      game: halftimeGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            currentHalf: 2,
            elapsedSeconds: 1800,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('in-progress');
    expect(result.current.gameState.currentHalf).toBe(2);
    expect(setIsRunning).toHaveBeenCalledWith(true);
  });

  it('blocks stale in-progress half-1 events from regressing local in-progress second-half state', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const secondHalfGame = createDefaultGame({
      status: 'in-progress',
      currentHalf: 2,
      elapsedSeconds: 2100,
      lastStartTime: null,
    });
    const props = createDefaultProps({
      isRunning: false,
      setIsRunning,
      setCurrentTime,
      game: secondHalfGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            currentHalf: 1,
            elapsedSeconds: 2100,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('in-progress');
    expect(result.current.gameState.currentHalf).toBe(2);
    expect(setIsRunning).not.toHaveBeenCalledWith(true);
  });

  // Reproduces issue #177: "Game scores are showing 0-0 at halftime".
  //
  // GameManagement derives ourScore/opponentScore locally from the `goals`
  // array during active play and never persists them to the Game record
  // (see docs/plans/GAME-SCORE-SNAPSHOT-CONCURRENCY-PLAN.md — active-state
  // score is goal-derived, no DB write). But any *other* Game field update
  // during active play (pause, resume, halftime transition, second-half
  // start, half-length edit, ...) round-trips through this hook's
  // Game.observeQuery subscription, whose fallback branch does
  // `return updatedGame` — replacing the whole local gameState wholesale
  // with the DB record, whose ourScore/opponentScore are still 0 because
  // they were never written. This clobbers the locally-derived score back
  // to 0-0 until the next goal is scored (which re-triggers the derivation
  // effect in GameManagement).
  it('does not clobber locally-derived score when an unrelated Game field update arrives (issue #177)', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const liveGame = createDefaultGame({
      status: 'in-progress',
      currentHalf: 1,
      elapsedSeconds: 1200,
      lastStartTime: new Date().toISOString(),
      ourScore: 0,
      opponentScore: 0,
    });
    const props = createDefaultProps({
      isRunning: true,
      setIsRunning,
      setCurrentTime,
      game: liveGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    // Simulate GameManagement's active-state score-derivation effect, which
    // computes the score from the subscribed `goals` array and writes it
    // into local gameState (no DB write) once goals have been recorded.
    act(() => {
      result.current.setGameState(prev => ({ ...prev, ourScore: 3, opponentScore: 2 }));
    });
    expect(result.current.gameState.ourScore).toBe(3);
    expect(result.current.gameState.opponentScore).toBe(2);

    // An unrelated Game update round-trips through the subscription — e.g. the
    // halftime transition write (status/elapsedSeconds/lastStartTime only).
    // Because score is never persisted during active play, the DB record
    // (and thus this event) still carries the stale ourScore/opponentScore: 0.
    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'halftime',
            currentHalf: 1,
            elapsedSeconds: 1500,
            lastStartTime: null,
            ourScore: 0,
            opponentScore: 0,
          } as Partial<Game>,
        ],
      });
    });

    // The goal-derived score must survive an unrelated field update — it
    // should still read 3-2, not be clobbered back to the stale DB 0-0.
    expect(result.current.gameState.ourScore).toBe(3);
    expect(result.current.gameState.opponentScore).toBe(2);
  });

  it('does NOT recreate the subscription when isRunning changes (isRunningRef fix)', () => {
    // This tests Bug Fix 1: isRunning was previously in the observeQuery useEffect
    // deps, causing the subscription to recreate on every timer tick. The new
    // isRunningRef pattern means subscribe is called only once regardless of how
    // many times isRunning changes.
    const subscribeSpy = vi.fn((handlers: { next: (data: { items: Partial<Game>[] }) => void }) => {
      capturedGameNext = handlers.next;
      return makeNoOpSub();
    });
    mockGameObserveQuery.mockReturnValue({ subscribe: subscribeSpy });

    // Start with isRunning = false
    const props = createDefaultProps({ isRunning: false });
    const { rerender } = renderHook(
      (p: ReturnType<typeof createDefaultProps>) => useGameSubscriptions(p),
      { initialProps: props }
    );

    // Subscription created once on mount
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    // Simulate isRunning changing to true (timer started)
    rerender(createDefaultProps({ isRunning: true }));
    // Subscription must NOT be recreated — still only 1 call
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    // Simulate isRunning changing back to false (timer paused/stopped)
    rerender(createDefaultProps({ isRunning: false }));
    // Still only 1 call — no subscription churn
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from Game.observeQuery on unmount', () => {
    const unsubscribeSpy = vi.fn();
    mockGameObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Partial<Game>[] }) => void }) => {
        capturedGameNext = handlers.next;
        return { unsubscribe: unsubscribeSpy };
      },
    });

    const props = createDefaultProps();
    const { unmount } = renderHook(() => useGameSubscriptions(props));

    unmount();

    expect(unsubscribeSpy).toHaveBeenCalled();
  });

  it('syncs lineup from scheduled gamePlan when lineup is empty locally and in DB', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{
          id: 'plan-1',
          startingLineup: JSON.stringify([
            { playerId: 'p1', positionId: 'pos1' },
            { playerId: 'p2', positionId: 'pos2' },
          ]),
        }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).toHaveBeenCalledTimes(2);
    });
  });

  it('skips lineup writes when local lineup already exists and DB is aligned', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockUseAmplifyQuery.mockImplementation((model: string) => {
      if (model === 'LineupAssignment') {
        return { data: [{ id: 'la-1', positionId: 'pos1', playerId: 'p1', isStarter: true }], isSynced: true };
      }
      return { data: [], isSynced: false };
    });

    mockLineupList.mockResolvedValue({
      data: [{ id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true }],
    });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
      expect(mockLineupUpdate).not.toHaveBeenCalled();
      expect(mockLineupDelete).not.toHaveBeenCalled();
    });
  });

  it('does not sync lineup from gamePlan when DB already has assignments', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockLineupList.mockResolvedValue({
      data: [{ id: 'la-existing', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true }],
    });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
      expect(mockLineupUpdate).not.toHaveBeenCalled();
      expect(mockLineupDelete).not.toHaveBeenCalled();
    });
  });

  it('fills missing starter assignments when DB lineup is only partially synced', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockUseAmplifyQuery.mockImplementation((model: string) => {
      if (model === 'LineupAssignment') {
        return {
          data: [{ id: 'la-1', positionId: 'pos1', playerId: 'p1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' }],
          isSynced: true,
        };
      }
      return { data: [], isSynced: false };
    });

    mockLineupList
      .mockResolvedValueOnce({
        data: [{ id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' }],
      })
      .mockResolvedValue({
        data: [
          { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' },
          { id: 'la-2', gameId: 'game-1', playerId: 'p2', positionId: 'pos2', isStarter: true, createdAt: '2026-05-10T00:00:01.000Z' },
        ],
      });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{
          id: 'plan-1',
          startingLineup: JSON.stringify([
            { playerId: 'p1', positionId: 'pos1' },
            { playerId: 'p2', positionId: 'pos2' },
          ]),
        }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).toHaveBeenCalledTimes(1);
    });

    expect(mockLineupCreate).toHaveBeenCalledWith({
      gameId: 'game-1',
      playerId: 'p2',
      positionId: 'pos2',
      isStarter: true,
      coaches: [],
    });
    expect(mockLineupUpdate).not.toHaveBeenCalled();
    expect(mockLineupDelete).not.toHaveBeenCalled();
  });

  it('cleans duplicate DB starter rows even when local lineup already matches the plan', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockUseAmplifyQuery.mockImplementation((model: string) => {
      if (model === 'LineupAssignment') {
        return {
          data: [{ id: 'la-1', positionId: 'pos1', playerId: 'p1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' }],
          isSynced: true,
        };
      }
      return { data: [], isSynced: false };
    });

    mockLineupList.mockResolvedValue({
      data: [
        { id: 'la-old', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' },
        { id: 'la-new', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:01.000Z' },
      ],
    });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupDelete).toHaveBeenCalledWith({ id: 'la-old' });
    });
    expect(mockLineupCreate).not.toHaveBeenCalled();
    expect(mockLineupUpdate).not.toHaveBeenCalled();
  });

  it('does not sync lineup from gamePlan when game is not scheduled', async () => {
    const game = createDefaultGame({ status: 'in-progress' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).not.toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
    });
  });

  it('does not sync lineup when gamePlan has no startingLineup payload', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({ items: [{ id: 'plan-1', startingLineup: null }] });
    });

    await waitFor(() => {
      expect(mockLineupList).not.toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
      expect(mockHandleApiError).not.toHaveBeenCalled();
    });
  });

  it('reports error when startingLineup is invalid JSON', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: '{bad-json' }],
      });
    });

    await waitFor(() => {
      expect(mockHandleApiError).toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
    });
  });

  it('keeps planned rotations sorted by rotationNumber from list', async () => {
    const props = createDefaultProps();

    let capturedGamePlanNext: ((data: { items: Array<{ id: string }> }) => void) | null = null;

    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    mockPlannedRotationList.mockResolvedValue({
      data: [
        { id: 'r2', gamePlanId: 'gp-1', rotationNumber: 2 },
        { id: 'r1', gamePlanId: 'gp-1', rotationNumber: 1 },
      ],
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({ items: [{ id: 'gp-1' }] });
    });

    await waitFor(() => {
      expect(result.current.plannedRotations.map(r => r.rotationNumber)).toEqual([1, 2]);
    });
  });
});
