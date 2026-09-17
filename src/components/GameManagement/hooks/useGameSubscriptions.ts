import { useEffect, useMemo, useRef, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../../amplify/data/resource";
import type {
  Game,
  Team,
  GamePlan,
  PlannedRotation,
} from "../types";
import { useAmplifyQuery } from "../../../hooks/useAmplifyQuery";
import { handleApiError } from "../../../utils/errorHandler";
import {
  MAX_GAME_SECONDS,
  ANOMALOUS_GAP_THRESHOLD_SECONDS,
  buildTimerHeartbeatStorageKey,
} from "../../../constants/gameTimer";

const client = generateClient<Schema>();

interface UseGameSubscriptionsParams {
  game: Game;
  team: Team;
  isRunning: boolean;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
  notesRefreshKey?: number;
  /** Used to scope the timer-continuity heartbeat read (see constants/gameTimer.ts). */
  userId: string;
}

/** A resume gap this device's timer needs a coach's confirmation about — see
 * ANOMALOUS_GAP_THRESHOLD_SECONDS and the auto-trigger exclusion below. */
interface PendingGapCorrection {
  /** The elapsed value before this gap (what stays displayed while pending). */
  priorElapsed: number;
  /** The elapsed value this device would resume at if the coach confirms it's correct. */
  proposedElapsed: number;
  /** proposedElapsed - priorElapsed, for display ("advanced by N minutes"). */
  gapSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Game.observeQuery `next` handler — decision helpers
//
// This callback has needed emergency fixes for issues #49, #31, and #177,
// plus two bugs caught in review while adding the gap-confirmation feature
// (Issue B). The refs above it (manuallyPausedRef, isRunningRef, gameStateRef,
// pendingGapCorrectionRef, userIdRef) all exist for the same reason: this
// effect's deps are [game.id] only (see below), so its closure is created
// once at mount and never refreshed — anything it needs to read at call time
// that can change after mount must be read through a ref, not destructured
// directly, or it silently goes stale (this is exactly how the userId bug
// happened — see userIdRef's comment).
//
// The three functions below are extracted because they're pure — no refs,
// no state setters, no ordering dependency on anything else in the
// callback — so isolating them carries no behavior-change risk. What's
// deliberately NOT extracted is the early-return sequence at the top of the
// callback (the completed-status short-circuit, the stale-event returns, the
// manuallyPausedRef reset, and the isRunningRef check): those have an
// explicit, load-bearing ORDER dependency documented inline (e.g. the
// manuallyPausedRef reset must run before the isRunningRef check), and
// collapsing ordering-dependent, ref-mutating code into a reusable function
// is exactly the kind of change that has broken this callback before.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Classifies an incoming Game.observeQuery event against the locally-known
 * status/half, to detect three kinds of stale/out-of-order event this
 * callback must not act on (see the state-merge and early-return logic below
 * for how each is used).
 */
export function classifyIncomingGameEvent(
  updatedGame: Pick<Game, 'status' | 'currentHalf'>,
  localStatus: string | null | undefined,
  localHalf: number
): {
  /** A legitimate second-half start (from any coach's device), not a stale event. */
  isSecondHalfStartEvent: boolean;
  /** A buffered first-half in-progress event arriving after this device already
   * advanced to the second half — must not regress local state (issue #49-class). */
  isStaleSecondHalfRegression: boolean;
  /** A buffered pre-start event arriving after the game has already started
   * locally — must not regress local state back to 'scheduled'. */
  isStaleScheduledRegression: boolean;
} {
  const incomingHalf = updatedGame.currentHalf ?? 1;
  const isSecondHalfStartEvent = updatedGame.status === 'in-progress' && updatedGame.currentHalf === 2;
  return {
    isSecondHalfStartEvent,
    isStaleSecondHalfRegression:
      localStatus === 'in-progress'
      && localHalf === 2
      && updatedGame.status === 'in-progress'
      && incomingHalf === 1,
    isStaleScheduledRegression:
      updatedGame.status === 'scheduled'
      && (localStatus === 'in-progress' || localStatus === 'halftime' || localStatus === 'completed'),
  };
}

/**
 * Decides the next local gameState for a NON-completed incoming event (the
 * `completed` status is handled by an earlier, separate return that
 * deliberately does NOT go through this function — see its own comment for
 * why that asymmetry is intentional, not a bug).
 */
export function mergeIncomingGameState(
  prev: Game,
  updatedGame: Game,
  isSecondHalfStartEvent: boolean
): Game {
  if (prev.status === 'completed') {
    return prev;
  }
  if (updatedGame.status === 'scheduled' && (prev.status === 'in-progress' || prev.status === 'halftime')) {
    return prev;
  }
  if (prev.status === 'halftime' && updatedGame.status === 'in-progress' && !isSecondHalfStartEvent) {
    return prev;
  }
  if (
    prev.status === 'in-progress'
    && (prev.currentHalf ?? 1) === 2
    && updatedGame.status === 'in-progress'
    && (updatedGame.currentHalf ?? 1) === 1
  ) {
    return prev;
  }
  // Active-state score is derived locally from goals and is never persisted to
  // the Game record (see GameManagement's score-derivation effect). Preserve it
  // here so an unrelated Game field update (pause, resume, halftime transition,
  // ...) doesn't clobber it back to the DB's stale 0-0 (issue #177). This does
  // NOT apply to the completed-status path (see that branch's own comment) —
  // by the time a game reaches 'completed', handleEndGame has already written
  // the final score snapshot to the DB, so the DB's value is authoritative
  // there instead.
  return { ...updatedGame, ourScore: prev.ourScore, opponentScore: prev.opponentScore };
}

/** Inputs the gap-confirmation decision needs, isolated from the ref-reading
 * mechanics above (callers pass in the already-dereferenced current values). */
interface GapConfirmationInputs {
  updatedGame: Pick<Game, 'currentHalf' | 'halfLengthMinutes'>;
  teamHalfLengthMinutes: number | null | undefined;
  priorElapsed: number;
  additionalSeconds: number;
  currentUserId: string;
  gameId: string;
  hasPendingCorrection: boolean;
}

type GapConfirmationDecision =
  | { kind: 'already-pending' }
  | { kind: 'propose'; proposedElapsed: number }
  | { kind: 'silent-apply'; proposedElapsed: number };

/**
 * Pure decision logic for Issue B's gap-confirmation feature — kept separate
 * from computeGapConfirmationDecision's caller so every input it reasons
 * about (the resume gap, the two auto-trigger boundaries, the continuity
 * heartbeat, and whether a correction is already pending) is explicit and
 * independently testable, rather than buried in the observeQuery callback.
 * See docs/specs/Game-Management-Spec.md §3.6 for the full behavior spec.
 */
export function computeGapConfirmationDecision(inputs: GapConfirmationInputs): GapConfirmationDecision {
  const { updatedGame, teamHalfLengthMinutes, priorElapsed, additionalSeconds, currentUserId, gameId, hasPendingCorrection } = inputs;
  const proposedElapsed = priorElapsed + additionalSeconds;

  // Already pending takes priority over everything else below: nothing may
  // touch currentTime/isRunning while the coach's dialog is still open, even
  // if a later event's recomputed gap would otherwise cross an auto-trigger
  // boundary (caught in review — see PITCH-RELIABILITY-HARDENING-PLAN.md Issue B).
  if (hasPendingCorrection) {
    return { kind: 'already-pending' };
  }

  const incomingHalfForGap = updatedGame.currentHalf ?? 1;
  const willAutoHalftime = incomingHalfForGap === 1
    && proposedElapsed >= (updatedGame.halfLengthMinutes ?? teamHalfLengthMinutes ?? 30) * 60;
  const willAutoEnd = proposedElapsed >= MAX_GAME_SECONDS;

  const hasLocalContinuity = !!currentUserId
    && (() => {
      try {
        return localStorage.getItem(buildTimerHeartbeatStorageKey(currentUserId, gameId)) !== null;
      } catch {
        return false;
      }
    })();

  const isAnomalousGap = additionalSeconds >= ANOMALOUS_GAP_THRESHOLD_SECONDS;
  const needsConfirmation = hasLocalContinuity && isAnomalousGap && !willAutoHalftime && !willAutoEnd;

  return needsConfirmation
    ? { kind: 'propose', proposedElapsed }
    : { kind: 'silent-apply', proposedElapsed };
}

export function useGameSubscriptions({
  game,
  team,
  isRunning,
  setCurrentTime,
  setIsRunning,
  notesRefreshKey = 0,
  userId,
}: UseGameSubscriptionsParams) {
  const [gameState, setGameState] = useState(game);
  const [gamePlan, setGamePlan] = useState<GamePlan | null>(null);
  const [plannedRotations, setPlannedRotations] = useState<PlannedRotation[]>([]);
  const [pendingGapCorrection, setPendingGapCorrection] = useState<PendingGapCorrection | null>(null);

  // Simple data subscriptions via reusable hook
  const { data: lineupRaw } = useAmplifyQuery('LineupAssignment', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);

  // Deduplicate lineup assignments: when multiple assignments exist for the same
  // position (caused by a failed delete during substitution), keep only the most
  // recently created one. This prevents stale entries from showing the old player.
  const lineup = useMemo(() => {
    const byPosition = new Map<string, (typeof lineupRaw)[0]>();
    for (const assignment of lineupRaw) {
      if (!assignment.positionId) continue;
      const existing = byPosition.get(assignment.positionId);
      if (!existing || (assignment.createdAt ?? '') > (existing.createdAt ?? '')) {
        byPosition.set(assignment.positionId, assignment);
      }
    }
    const withoutPosition = lineupRaw.filter(a => !a.positionId);
    return [...Array.from(byPosition.values()), ...withoutPosition];
  }, [lineupRaw]);

  const { data: playTimeRecords } = useAmplifyQuery('PlayTimeRecord', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);

  const halfThenSeconds = (a: { half: number; gameSeconds: number }, b: { half: number; gameSeconds: number }) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.gameSeconds - b.gameSeconds;
  };

  const nullSafeGameNotesSort = (
    a: { gameSeconds?: number | null; half?: number | null; timestamp?: string | null },
    b: { gameSeconds?: number | null; half?: number | null; timestamp?: string | null }
  ) => {
    const aIsPreGame = a.gameSeconds === null && a.half === null;
    const bIsPreGame = b.gameSeconds === null && b.half === null;

    if (aIsPreGame && bIsPreGame) {
      return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
    }
    if (aIsPreGame) return 1;
    if (bIsPreGame) return -1;

    const halfDiff = (a.half || 0) - (b.half || 0);
    if (halfDiff !== 0) return halfDiff;
    return (a.gameSeconds || 0) - (b.gameSeconds || 0);
  };

  const { data: goals } = useAmplifyQuery('Goal', {
    filter: { gameId: { eq: game.id } },
    sort: halfThenSeconds,
  }, [game.id]);

  const { data: gameNotes } = useAmplifyQuery('GameNote', {
    filter: { gameId: { eq: game.id } },
    sort: nullSafeGameNotesSort,
  }, [game.id, notesRefreshKey]);

  const { data: playerAvailabilities } = useAmplifyQuery('PlayerAvailability', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);

  const { data: queuedSubstitutionsRaw } = useAmplifyQuery('QueuedSubstitution', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);

  // FIFO order by createdAt ascending
  const queuedSubstitutions = useMemo(() => {
    return [...queuedSubstitutionsRaw].sort((a, b) =>
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    );
  }, [queuedSubstitutionsRaw]);

  // Ref to track manual pause - prevents race condition with observeQuery auto-resume
  const manuallyPausedRef = useRef(false);

  // Ref for isRunning — keeps the observeQuery callback up-to-date without
  // recreating the subscription every time the timer starts or stops (fixes
  // the stale-subscription race that caused completed games to show as
  // in-progress after ending).
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;

  // Ref for gameState — allows the observeQuery callback to read the latest
  // local game state without being in the effect deps. Used to block
  // auto-resume when a stale in-progress subscription event arrives after
  // the game has already been completed locally (regression guard).
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  // Ref to track if lineup sync is in progress - prevents duplicate creation
  const lineupSyncInProgressRef = useRef(false);

  // Ref for pendingGapCorrection — lets the observeQuery callback (which only
  // depends on [game.id], see below) avoid re-proposing a second gap
  // correction while one is already awaiting the coach's answer, without
  // needing pendingGapCorrection in that effect's deps.
  const pendingGapCorrectionRef = useRef<PendingGapCorrection | null>(null);
  pendingGapCorrectionRef.current = pendingGapCorrection;

  // Ref for userId — same reason as isRunningRef/gameStateRef above: the
  // observeQuery effect's deps are [game.id] only, so it subscribes once at
  // mount and never re-runs for the life of viewing one game. userId starts
  // as '' in GameManagement.tsx and is populated later by an async
  // getCurrentUser() call in a separate effect — without this ref, the
  // closure below would permanently see the mount-time '', making the
  // heartbeat continuity check (and the whole gap-confirmation feature)
  // silently inert for the entire session (caught in review).
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Observe game changes and restore state (complex timer resume logic — stays manual)
  useEffect(() => {
    const gameSub = client.models.Game.observeQuery({
      filter: { id: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        if (data.items.length > 0) {
          const updatedGame = data.items[0];
          const localStatus = gameStateRef.current.status;

          // If the game is completed, always stop the timer regardless of isRunning.
          // Guard against stale subscription events regressing a completed game back
          // to in-progress (fixes games appearing in-progress after ending).
          if (updatedGame.status === 'completed') {
            setGameState(updatedGame);
            setIsRunning(false);
            if (updatedGame.elapsedSeconds !== null && updatedGame.elapsedSeconds !== undefined) {
              setCurrentTime(updatedGame.elapsedSeconds);
            }
            return;
          }

          // Prevent a stale 'in-progress' subscription event from overwriting a
          // locally-set halftime or completed state. This handles the race where the
          // periodic saveInterval write (in-progress + lastStartTime) has a buffered
          // AppSync subscription event that arrives out-of-order after the halftime
          // or completed write's subscription event.
          const localHalf = gameStateRef.current.currentHalf ?? 1;
          const { isSecondHalfStartEvent, isStaleSecondHalfRegression, isStaleScheduledRegression } =
            classifyIncomingGameEvent(updatedGame, localStatus, localHalf);

          setGameState(prev => mergeIncomingGameState(prev, updatedGame, isSecondHalfStartEvent));

          // If local state is already completed, skip all timer logic — this
          // event is stale and must not trigger auto-resume or time updates.
          if (localStatus === 'completed' || isStaleScheduledRegression || isStaleSecondHalfRegression) {
            return;
          }
            // Skip timer logic if local state is halftime unless this is a
            // legitimate second-half start from another coach.
            if (localStatus === 'halftime' && !isSecondHalfStartEvent) {
              return;
            }

            // Don't update time if timer is currently running in this component.
            // When the confirmed pause event arrives (lastStartTime null, status in-progress),
            // release the manual-pause guard so future resume events from another coach can
            // auto-resume. This must happen BEFORE the isRunningRef check so that a
            // stale in-progress+lastStartTime event (from game start) arriving before
            // this confirmed-pause event is correctly blocked.
            if (
              updatedGame.status === 'in-progress' &&
              (updatedGame.lastStartTime === null || updatedGame.lastStartTime === undefined)
            ) {
              manuallyPausedRef.current = false;
            }

            // Don't update time if timer is currently running in this component.
          // Use isRunningRef (not the captured closure) so this check is always
          // fresh without requiring the subscription to recreate on every tick.
          if (isRunningRef.current) {
            return;
          }

          // Auto-resume timer if game was in progress (but not if user manually paused)
          if (updatedGame.status === 'in-progress' && updatedGame.lastStartTime && !manuallyPausedRef.current) {
            const lastStart = new Date(updatedGame.lastStartTime).getTime();
            const now = Date.now();
            const additionalSeconds = Math.floor((now - lastStart) / 1000);
            const priorElapsed = updatedGame.elapsedSeconds || 0;

            const decision = computeGapConfirmationDecision({
              updatedGame,
              teamHalfLengthMinutes: team.halfLengthMinutes,
              priorElapsed,
              additionalSeconds,
              currentUserId: userIdRef.current,
              gameId: game.id,
              hasPendingCorrection: !!pendingGapCorrectionRef.current,
            });

            switch (decision.kind) {
              case 'already-pending':
                // Do nothing — let the open dialog resolve first (see
                // computeGapConfirmationDecision's comment for why this must be
                // checked before evaluating the auto-trigger boundaries at all).
                break;
              case 'propose':
                // Don't apply the jump yet — leave currentTime/isRunning as they
                // are (paused-looking locally) until the coach confirms via
                // GameManagement's confirm() dialog.
                setPendingGapCorrection({ priorElapsed, proposedElapsed: decision.proposedElapsed, gapSeconds: additionalSeconds });
                break;
              case 'silent-apply':
                setCurrentTime(decision.proposedElapsed);
                setIsRunning(true);
                break;
            }
          } else {
            // Restore elapsed time for halftime or paused states
            if (updatedGame.elapsedSeconds !== null && updatedGame.elapsedSeconds !== undefined) {
              setCurrentTime(updatedGame.elapsedSeconds);
            }
          }
        }
      },
    });

    return () => {
      gameSub.unsubscribe();
    };
    // isRunning intentionally omitted from deps — we use isRunningRef to read
    // the latest value without recreating the subscription on every timer tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  // GamePlan + PlannedRotation subscriptions (co-dependent — stays manual)
  useEffect(() => {
    let currentGamePlanId: string | null = null;

    const gamePlanSub = client.models.GamePlan.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        if (data.items.length > 0) {
          const plan = data.items[0];
          setGamePlan(plan);
          currentGamePlanId = plan.id;

          // Load rotations for this game plan
            void client.models.PlannedRotation.list({
            filter: { gamePlanId: { eq: plan.id } },
          }).then(({ data: rotations }) => {
            if (rotations) {
              setPlannedRotations(rotations.sort((a, b) => a.rotationNumber - b.rotationNumber));
            }
          });
        }
      },
    });

    const rotationSub = client.models.PlannedRotation.observeQuery().subscribe({
      next: (data) => {
        if (currentGamePlanId) {
          const gameRotations = data.items.filter(r => r.gamePlanId === currentGamePlanId);
          setPlannedRotations(gameRotations.sort((a, b) => a.rotationNumber - b.rotationNumber));
        }
      },
    });

    return () => {
      gamePlanSub.unsubscribe();
      rotationSub.unsubscribe();
    };
  }, [game.id, gamePlan?.id]);

  // Sync lineup from game plan when available
  useEffect(() => {
    const syncLineupFromGamePlan = async () => {
      if (!gamePlan || gameState.status !== 'scheduled') {
        return; // Only sync if game is scheduled
      }

      if (!gamePlan.startingLineup) {
        console.log('Game plan has no starting lineup data');
        return;
      }

      // Prevent concurrent execution using ref
      if (lineupSyncInProgressRef.current) {
        console.log('Lineup sync already in progress, skipping');
        return;
      }
      lineupSyncInProgressRef.current = true;

      try {
        const startingLineup = JSON.parse(gamePlan.startingLineup as string) as Array<{
          playerId: string;
          positionId: string;
        }>;

        const desiredAssignments = startingLineup.filter(
          (entry): entry is { playerId: string; positionId: string } => !!entry.playerId && !!entry.positionId,
        );
        const desiredKeys = new Set(
          desiredAssignments.map(({ playerId, positionId }) => `${positionId}:${playerId}`),
        );
        const localStarterKeys = new Set(
          lineup
            .filter((assignment): assignment is typeof assignment & { playerId: string; positionId: string } => !!assignment.playerId && !!assignment.positionId)
            .map(({ playerId, positionId }) => `${positionId}:${playerId}`),
        );

        const localLineupAligned = (
          desiredAssignments.length > 0
          && lineup.length === desiredAssignments.length
          && desiredAssignments.every(({ playerId, positionId }) => localStarterKeys.has(`${positionId}:${playerId}`))
        );

        // Query the database to double-check for existing assignments
        // This handles the race condition where subscription hasn't loaded yet
        const existingAssignments = await client.models.LineupAssignment.list({
          filter: { gameId: { eq: game.id } },
        });

        const existingStarterAssignments = existingAssignments.data.filter(
          (assignment): assignment is typeof assignment & { id: string; playerId: string; positionId: string } =>
            !!assignment.id && !!assignment.playerId && !!assignment.positionId,
        );
        const existingByPosition = new Map<string, typeof existingStarterAssignments[number]>();
        const duplicateAssignments: Array<typeof existingStarterAssignments[number]> = [];

        for (const assignment of existingStarterAssignments) {
          const existingForPosition = existingByPosition.get(assignment.positionId);
          if (!existingForPosition) {
            existingByPosition.set(assignment.positionId, assignment);
            continue;
          }

          const keepExisting = (existingForPosition.createdAt ?? '') >= (assignment.createdAt ?? '');
          if (keepExisting) {
            duplicateAssignments.push(assignment);
          } else {
            duplicateAssignments.push(existingForPosition);
            existingByPosition.set(assignment.positionId, assignment);
          }
        }

        const existingKeys = new Set(
          Array.from(existingByPosition.values()).map(({ playerId, positionId }) => `${positionId}:${playerId}`),
        );

        if (
          localLineupAligned
          && existingByPosition.size === desiredAssignments.length
          && duplicateAssignments.length === 0
          && desiredAssignments.every(({ playerId, positionId }) => existingKeys.has(`${positionId}:${playerId}`))
        ) {
          console.log(`Lineup already aligned in DB with ${existingByPosition.size} assignments, skipping sync`);
          return;
        }

        const syncOperations: Promise<unknown>[] = [];

        for (const staleAssignment of duplicateAssignments) {
          syncOperations.push(client.models.LineupAssignment.delete({ id: staleAssignment.id }));
        }

        for (const { playerId, positionId } of desiredAssignments) {
          const existingAssignment = existingByPosition.get(positionId);
          if (!existingAssignment) {
            syncOperations.push(client.models.LineupAssignment.create({
              gameId: game.id,
              playerId,
              positionId,
              isStarter: true,
              coaches: team.coaches,
            }));
            continue;
          }

          if (existingAssignment.playerId !== playerId || existingAssignment.isStarter !== true) {
            syncOperations.push(client.models.LineupAssignment.update({
              id: existingAssignment.id,
              playerId,
              positionId,
              isStarter: true,
            }));
          }
        }

        for (const existingAssignment of Array.from(existingByPosition.values())) {
          if (!desiredKeys.has(`${existingAssignment.positionId}:${existingAssignment.playerId}`)) {
            syncOperations.push(client.models.LineupAssignment.delete({ id: existingAssignment.id }));
          }
        }

        if (syncOperations.length === 0) {
          return;
        }

        await Promise.all(syncOperations);
        console.log(`Synced ${desiredAssignments.length} starters from game plan`);
      } catch (error) {
        handleApiError(error, 'Failed to sync lineup from game plan');
      } finally {
        lineupSyncInProgressRef.current = false;
      }
    };

    void syncLineupFromGamePlan();
  }, [gamePlan, gameState.status, game.id, team.coaches, lineup]);

  /**
   * Resolves a pending gap correction (see PendingGapCorrection above).
   * accept: applies the proposed elapsed time and resumes, exactly like the
   *   silent auto-resume path would have — isRunning becomes true, so the
   *   earlier isRunningRef guard in the observeQuery callback blocks any
   *   further auto-resume logic on its own; manuallyPausedRef is irrelevant
   *   here. reject: applies nothing — currentTime and isRunning are left as
   *   they were (isRunning stays false), so the coach's existing Resume
   *   button (handleResumeTimer in GameManagement.tsx) is the natural next
   *   action, starting a fresh anchor from the un-jumped time. manuallyPausedRef
   *   is set only in this branch, so a duplicate/replayed subscription event
   *   for the same stale lastStartTime doesn't immediately re-propose the
   *   same correction while isRunning is still false.
   */
  const resolveGapCorrection = (accept: boolean) => {
    const pending = pendingGapCorrectionRef.current;
    if (!pending) return;
    if (accept) {
      setCurrentTime(pending.proposedElapsed);
      setIsRunning(true);
    } else {
      manuallyPausedRef.current = true;
    }
    setPendingGapCorrection(null);
  };

  return {
    gameState,
    setGameState,
    lineup,
    playTimeRecords,
    goals,
    gameNotes,
    gamePlan,
    plannedRotations,
    playerAvailabilities,
    queuedSubstitutions,
    manuallyPausedRef,
    pendingGapCorrection,
    resolveGapCorrection,
  };
}
