import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getCurrentUser } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import { trackEvent, AnalyticsEvents } from "../../utils/analytics";
import { showError, showSuccess, showWarning } from "../../utils/toast";
import { handleApiError } from "../../utils/errorHandler";
import { isoToDatetimeLocal } from "../../utils/gameTimeUtils";
import { useConfirm } from "../ConfirmModal";
import { closeActivePlayTimeRecords } from "../../services/substitutionService";
import { deleteGameCascade } from "../../services/cascadeDeleteService";
import { calculateFairRotations, type PlannedSubstitution } from "../../services/rotationPlannerService";
import { calculatePlayerPlayTime } from "../../utils/playTimeCalculations";
import { useTeamData } from "../../hooks/useTeamData";
import { useOfflineMutations } from "../../hooks/useOfflineMutations";
import { useTeamCoachProfiles } from "../../hooks/useTeamCoachProfiles";
import { useGameSubscriptions } from "./hooks/useGameSubscriptions";
import { useGameTimer } from "./hooks/useGameTimer";
import { CommandBand } from "./CommandBand";
import { TabNav, type GameTab } from "./TabNav";
import { BenchTab } from "./BenchTab";
import { GameTimer } from "./GameTimer";
import { GoalTracker } from "./GoalTracker";
import { PlayerNotesPanel, type OpenLiveNoteIntent } from "./PlayerNotesPanel";
import { PreGameNotesPanel } from "./PreGameNotesPanel";
import { CreateEditNoteModal } from "./CreateEditNoteModal";
import { RotationWidget } from "./RotationWidget";
import { SubstitutionPanel } from "./SubstitutionPanel";
import { LineupPanel } from "./LineupPanel";
import { CompletedPlayTimeSummary } from "./CompletedPlayTimeSummary";
import { PlayerAvailabilityGrid } from "../PlayerAvailabilityGrid";
import { OfflineBanner } from "../OfflineBanner";
import type { Game, Team, FormationPosition, SubQueue } from "./types";
import { AvailabilityProvider } from "../../contexts/AvailabilityContext";
import { useHelpFab } from "../../contexts/HelpFabContext";
import type { HelpScreenKey } from "../../help";
import { buildFlatDebugSnapshot } from "../../utils/debugUtils";
import { isSubEffectivelyExecuted } from "../../utils/rotationConflictUtils";
import type { GameManagementDebugContext } from "../../types/debug";
import { useWakeLock } from "../../hooks/useWakeLock";
import { useGameNotification } from "../../hooks/useGameNotification";

// Used only for planning operations (PlannedRotation.update) — not live-game mutations.
const client = generateClient<Schema>();

interface GameManagementProps {
  game: Game;
  team: Team;
  onBack: () => void;
}

class StarterCountError extends Error {
  readonly userMessage: string;

  constructor(handler: 'handleStartGame' | 'handleStartSecondHalf', expected: number, chosen: number) {
    super(
      `[${handler}] starter count below expected before play-time record creation (expected=${expected}, chosen=${chosen})`
    );
    this.name = 'StarterCountError';
    this.userMessage = handler === 'handleStartSecondHalf'
      ? `Assign ${expected} starters before starting the second half. Currently assigned: ${chosen}.`
      : `Assign ${expected} starters before starting the game. Currently assigned: ${chosen}.`;
  }
}

function isStarterCountError(error: unknown): error is StarterCountError {
  return error instanceof StarterCountError;
}

/**
 * Compute final score from Goal records.
 * Used for deriving scores during active game and writing snapshots on completion.
 */
function computeScoreFromGoals(goals: Array<{ scoredByUs: boolean }>) {
  return {
    ourScore: goals.filter(g => g.scoredByUs).length,
    opponentScore: goals.filter(g => !g.scoredByUs).length,
  };
}

/**
 * Build a stable fingerprint of goals for deduplication.
 * Sort by id and hash to detect changes.
 */
function buildGoalsFingerprint(goals: Array<{ id: string }>): string {
  const sorted = [...goals].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(sorted.map(g => g.id));
}

export function GameManagement({ game, team, onBack }: GameManagementProps) {
  const confirm = useConfirm();
  // Load team roster and formation positions with real-time updates
  const { players, positions } = useTeamData(team.id, team.formationId);
  const { profileMap, refetch: refetchCoachProfiles } = useTeamCoachProfiles({
    teamId: team.id,
    onFocusRefetch: true,
  });


  const [currentTime, setCurrentTime] = useState(game.elapsedSeconds || 0);
  const [isRunning, setIsRunning] = useState(false);
  const [substitutionRequest, setSubstitutionRequest] = useState<FormationPosition | null>(null);
  const [userId, setUserId] = useState<string>('');

  // Mobile tab navigation (in-progress state only)
  const [activeTab, setActiveTab] = useState<GameTab>("field");
  // Controlled state for rotation modal (opened from CommandBand)
  const [rotationModalOpen, setRotationModalOpen] = useState(false);
  const [injuryModalOpen, setInjuryModalOpen] = useState(false);
  const [isInjuryMutationPending, setIsInjuryMutationPending] = useState(false);
  const [isPreGameNoteModalOpen, setIsPreGameNoteModalOpen] = useState(false);
  const [preGameNoteMode, setPreGameNoteMode] = useState<'create' | 'edit'>('create');
  const [preGameNoteDraft, setPreGameNoteDraft] = useState<{ id?: string; notes?: string | null; playerId?: string | null } | null>(null);
  const [notesRefreshKey, setNotesRefreshKey] = useState(0);
  const [liveNoteModalState, setLiveNoteModalState] = useState<{
    isOpen: boolean;
    requestId: number;
    intent: OpenLiveNoteIntent | null;
  }>({
    isOpen: false,
    requestId: 0,
    intent: null,
  });

  // Game planner integration
  const [isRecalculating, setIsRecalculating] = useState(false);

  const [substitutionQueue, setSubstitutionQueue] = useState<SubQueue[]>([]);

  // Edit scheduled game state
  const [isEditingGame, setIsEditingGame] = useState(false);
  const [editGameOpponent, setEditGameOpponent] = useState('');
  const [editGameDate, setEditGameDate] = useState('');
  const [editGameIsHome, setEditGameIsHome] = useState(true);
  const [isSavingGameEdit, setIsSavingGameEdit] = useState(false);
  const editFormRef = useRef<HTMLDivElement>(null);
  const editGameButtonRef = useRef<HTMLButtonElement>(null);

  // Guards to prevent duplicate halftime/end-game handling when both the
  // auto-trigger (from useGameTimer) and a manual button click fire concurrently.
  const halftimeInProgressRef = useRef(false);
  const endGameInProgressRef = useRef(false);
  const halftimePtrClosePendingRef = useRef(false);
  const injuryModalRef = useRef<HTMLDivElement | null>(null);
  const injuryModalHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const injuryModalReturnFocusRef = useRef<HTMLElement | null>(null);
  const liveNoteModalReturnFocusRef = useRef<HTMLElement | null>(null);

  // Completed-state reconciliation: prevent concurrent writes and detect goal changes
  const completedReconcileInFlightRef = useRef(false);
  const completedGoalsFingerprintRef = useRef<string>('');
  const completedReconcileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscriptions hook - manages game observation, data subscriptions, and lineup sync
  const {
    gameState,
    setGameState,
    lineup,
    playTimeRecords,
    goals,
    gameNotes,
    gamePlan,
    plannedRotations,
    playerAvailabilities,
    manuallyPausedRef,
  } = useGameSubscriptions({
    game,
    team,
    isRunning,
    setCurrentTime,
    setIsRunning,
    notesRefreshKey,
  });

  // Use per-game half length override when set; fall back to team default.
  // gameState is live-updated via observeQuery so this recomputes reactively.
  const halfLengthSeconds = (gameState.halfLengthMinutes ?? team.halfLengthMinutes ?? 30) * 60;

  // Offline-aware mutation wrapper — routes writes to IndexedDB when offline,
  // drains automatically on reconnect (fixes issue #35).
  const { mutations, isOnline, pendingCount: pendingMutationCount, isSyncing } = useOfflineMutations();

  const { setHelpContext, setDebugContext } = useHelpFab();

  // Load current user ID for user-scoped localStorage keys (security fix)
  useEffect(() => {
    void (async () => {
      try {
        const user = await getCurrentUser();
        setUserId(user.userId);
      } catch (error) {
        console.error('[GameManagement] Failed to load current user:', error);
      }
    })();
  }, []);

  // Map game status → help key. Reactive: re-runs when game status transitions.
  // @help-content: game-scheduled, game-in-progress, game-halftime, game-completed
  useEffect(() => {
    const statusToHelpKey: Partial<Record<string, HelpScreenKey>> = {
      'scheduled':   'game-scheduled',
      'in-progress': 'game-in-progress',
      'halftime':    'game-halftime',
      'completed':   'game-completed',
    };
    // Guard against null/undefined status (Amplify fields can be null)
    const key = gameState.status ? statusToHelpKey[gameState.status] : undefined;
    if (key) setHelpContext(key);
    return () => setHelpContext(null);
  }, [gameState.status, setHelpContext]);

    // Active-state score derivation: derive score from goals in real-time
    // (for scheduled, in-progress, halftime states). Updates gameState locally
    // without writing to database. Database gets final snapshot on game completion.
    useEffect(() => {
      // Only update score in active states; completed state uses separate reconciliation
      if (gameState.status === 'completed') return;

      // Derive score from current goals
      const { ourScore, opponentScore } = computeScoreFromGoals(goals);

      // Update gameState if score has changed (triggers CommandBand re-render)
      setGameState(prev => {
        if (prev.ourScore === ourScore && prev.opponentScore === opponentScore) {
          return prev; // No change, avoid re-render
        }
        return { ...prev, ourScore, opponentScore };
      });
      }, [goals, gameState.status, setGameState]);

  // Completed-state reconciliation: auto-update score snapshot when goals change
  // (triggered by user goal mutations in completed state).
  // Uses in-flight guard, fingerprint dedup, and persistent pending marker.
  useEffect(() => {
    if (gameState.status !== 'completed') return;

    const reconcile = async () => {
      // Guard: prevent concurrent writes
      if (completedReconcileInFlightRef.current) return;

      // Compute score from current goals
      const { ourScore, opponentScore } = computeScoreFromGoals(goals);
      const currentFingerprint = buildGoalsFingerprint(goals);

      // Check if goals haven't changed since last attempt (dedup)
      if (currentFingerprint === completedGoalsFingerprintRef.current) return;

      // Check if score already matches snapshot (no reconcile needed)
      if (ourScore === gameState.ourScore && opponentScore === gameState.opponentScore) {
        // Clear pending marker if present
        const markerKey = `game-score-reconcile:${userId}:${game.id}`;
        localStorage.removeItem(markerKey);
        completedGoalsFingerprintRef.current = currentFingerprint;
        return;
      }

      // Score mismatch: initiate reconcile
      completedReconcileInFlightRef.current = true;
      try {
        await mutations.updateGame(game.id, {
          ourScore,
          opponentScore,
        });
        // Success: update state and clear marker
        setGameState(prev => ({ ...prev, ourScore, opponentScore }));
        const markerKey = `game-score-reconcile:${userId}:${game.id}`;
        localStorage.removeItem(markerKey);
        completedGoalsFingerprintRef.current = currentFingerprint;
      } catch (error) {
        // Failure: persist marker for retry on next mount
        const markerKey = `game-score-reconcile:${userId}:${game.id}`;
        localStorage.setItem(markerKey, JSON.stringify({ ourScore, opponentScore, timestamp: Date.now() }));
        console.error('[Completed reconcile] Failed to update score snapshot:', error);
      } finally {
        completedReconcileInFlightRef.current = false;
      }
    };

    // Debounce reconcile (300ms) to batch rapid goal changes
    if (completedReconcileTimeoutRef.current) {
      clearTimeout(completedReconcileTimeoutRef.current);
    }
    completedReconcileTimeoutRef.current = setTimeout(() => {
      void reconcile();
    }, 300);

    return () => {
      if (completedReconcileTimeoutRef.current) {
        clearTimeout(completedReconcileTimeoutRef.current);
      }
    };
  }, [gameState.status, goals, gameState.ourScore, gameState.opponentScore, game.id, userId, mutations, setGameState]);

  // On completed-state activation, check for pending marker and retry
  useEffect(() => {
    if (gameState.status !== 'completed') return;

    const markerKey = `game-score-reconcile:${userId}:${game.id}`;
    const markerData = localStorage.getItem(markerKey);
    if (!markerData) return;

    // Retry reconcile on next tick
    const timeoutId = setTimeout(() => {
      completedReconcileInFlightRef.current = false;
      completedGoalsFingerprintRef.current = ''; // Force retry
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [gameState.status, game.id, userId]);

  const gameManagementDebugContext = useMemo((): GameManagementDebugContext => {
    const availMap: Record<string, number> = {};
    for (const a of playerAvailabilities) {
      const status = a.status ?? 'unknown';
      availMap[status] = (availMap[status] ?? 0) + 1;
    }
    const openPTR = playTimeRecords.filter(r => r.endGameSeconds == null).length;
    const closedPTR = playTimeRecords.filter(r => r.endGameSeconds != null).length;
    const starterCount = lineup.filter(l => l.isStarter).length;
    // planConflictCount: computed via getPlanConflicts() which is a plain function above.
    // We keep it at 0 here to avoid duplicating complex conflict logic in a useMemo.
    const planConflictCount = 0;
    const lineupDetail = lineup.length === 0
      ? '(none)'
      : lineup
          .map(l => `${l.playerId ?? '(unknown-player)'}@${l.positionId ?? '(unknown-position)'}`)
          .sort()
          .join('|');

    const currentGameMinute = Math.floor(currentTime / 60);
    const nextPlannedRotation = plannedRotations
      .filter(r => (r.gameMinute ?? -1) > currentGameMinute)
      .sort((a, b) => {
        const minuteDiff = (a.gameMinute ?? Number.MAX_SAFE_INTEGER) - (b.gameMinute ?? Number.MAX_SAFE_INTEGER);
        if (minuteDiff !== 0) return minuteDiff;
        return (a.rotationNumber ?? Number.MAX_SAFE_INTEGER) - (b.rotationNumber ?? Number.MAX_SAFE_INTEGER);
      })[0];

    let nextPlannedRotationMeta = '(none)';
    let nextPlannedRotationSubstitutions = '(none)';
    if (nextPlannedRotation) {
      nextPlannedRotationMeta = [
        `rotation=${nextPlannedRotation.rotationNumber ?? '(unknown)'}`,
        `minute=${nextPlannedRotation.gameMinute ?? '(unknown)'}`,
        `half=${nextPlannedRotation.half ?? '(unknown)'}`,
      ].join(',');

      try {
        const rawSubstitutions = nextPlannedRotation.plannedSubstitutions;
        const parsed = typeof rawSubstitutions === 'string'
          ? JSON.parse(rawSubstitutions || '[]')
          : rawSubstitutions;
        if (Array.isArray(parsed)) {
          const parsedSubs = (parsed as Array<Partial<PlannedSubstitution>>)
            .map(s => `${s.playerOutId ?? '(unknown-out)'}>${s.playerInId ?? '(unknown-in)'}@${s.positionId ?? '(unknown-position)'}`)
            .sort();
          nextPlannedRotationSubstitutions = parsedSubs.length > 0 ? parsedSubs.join('|') : '(none)';
        } else {
          nextPlannedRotationSubstitutions = '(invalid-json-shape)';
        }
      } catch {
        nextPlannedRotationSubstitutions = '(invalid-json)';
      }
    }

    return {
      gameIdPrefix: gameState.id?.slice(0, 8) ?? '(none)',
      status: gameState.status ?? 'unknown',
      currentHalf: gameState.currentHalf ?? 1,
      elapsedSeconds: currentTime,
      halfLengthSeconds,
      isRunning,
      activeTab,
      rosterSize: players.length,
      lineupCount: lineup.length,
      starterCount,
      openPlayTimeRecordCount: openPTR,
      closedPlayTimeRecordCount: closedPTR,
      ourScore: gameState.ourScore ?? 0,
      opponentScore: gameState.opponentScore ?? 0,
      goalCount: goals.length,
      gameNoteCount: gameNotes.length,
      availabilityByStatus: availMap,
      planExists: gamePlan !== null,
      plannedRotationCount: plannedRotations.length,
      planConflictCount,
      substitutionQueueLength: substitutionQueue.length,
      lineupDetail,
      nextPlannedRotationMeta,
      nextPlannedRotationSubstitutions,
    };
  }, [gameState, currentTime, halfLengthSeconds, isRunning, activeTab, players, lineup,
      playTimeRecords, goals, gameNotes, playerAvailabilities, gamePlan, plannedRotations,
      substitutionQueue]);

  const gameManagementDebugSnapshot = useMemo(() => {
    const { availabilityByStatus, ...flat } = gameManagementDebugContext;
    return buildFlatDebugSnapshot('Game Management Debug Snapshot', {
      ...flat,
      availabilityByStatus,
    });
  }, [gameManagementDebugContext]);

  useEffect(() => {
    setDebugContext(gameManagementDebugSnapshot);
    return () => setDebugContext(null);
  }, [gameManagementDebugSnapshot, setDebugContext]);

  useEffect(() => {
    if (isEditingGame && editFormRef.current) {
      editFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const firstInput = editFormRef.current.querySelector<HTMLInputElement>('input[type="text"]');
      firstInput?.focus();
    }
  }, [isEditingGame]);

  // Wake Lock: prevent screen sleep during active game
  const isGameActive = gameState.status === 'in-progress' || gameState.status === 'halftime';
  useWakeLock(isGameActive);

  // Persistent notification: show live score in notification shade
  useGameNotification({
    isActive: isGameActive,
    requestPermissionNow: isGameActive,
    teamName: team.name,
    opponent: gameState.opponent ?? '',
    ourScore: gameState.ourScore ?? 0,
    opponentScore: gameState.opponentScore ?? 0,
    currentHalf: gameState.currentHalf ?? 1,
    currentTime,
  });

  const getPlayerAvailability = (playerId: string): string => {
    const availability = playerAvailabilities.find(a => a.playerId === playerId);
    return availability?.status || 'available';
  };

  // Detect conflicts between current availability and the rotation plan
  const getPlanConflicts = () => {
    const conflicts: Array<{
      type: 'starter' | 'rotation' | 'on-field';
      playerId: string;
      playerName: string;
      status: string;
      rotationNumbers: number[];
    }> = [];

    if (!gamePlan) return conflicts;

    // Check starting lineup
    if (gamePlan.startingLineup) {
      try {
        const sl = JSON.parse(gamePlan.startingLineup as string) as Array<{ playerId: string; positionId: string }>;
        for (const entry of sl) {
          const status = getPlayerAvailability(entry.playerId);
          if (status === 'absent' || status === 'injured') {
            const player = players.find(p => p.id === entry.playerId);
            conflicts.push({
              type: 'starter',
              playerId: entry.playerId,
              playerName: player ? `#${player.playerNumber} ${player.firstName} ${player.lastName}` : 'Unknown',
              status,
              rotationNumbers: [],
            });
          }
        }
      } catch { /* ignore parse errors */ }
    }

    // Check all planned rotations
    for (const rotation of plannedRotations) {
      try {
        const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
        for (const sub of subs) {
          // CRITICAL: Only skip in in-progress state.
          // In scheduled state, 'lineup' contains the pre-game starting lineup, not live substitution state.
          if (gameState.status === 'in-progress' && isSubEffectivelyExecuted(sub, lineup)) continue;
          for (const pid of [sub.playerOutId, sub.playerInId]) {
            const status = getPlayerAvailability(pid);
            if (status === 'absent' || status === 'injured') {
              const player = players.find(p => p.id === pid);
              const existing = conflicts.find(c => c.playerId === pid);
              if (existing) {
                if (!existing.rotationNumbers.includes(rotation.rotationNumber)) {
                  existing.rotationNumbers.push(rotation.rotationNumber);
                }
              } else {
                conflicts.push({
                  type: 'rotation',
                  playerId: pid,
                  playerName: player ? `#${player.playerNumber} ${player.firstName} ${player.lastName}` : 'Unknown',
                  status,
                  rotationNumbers: [rotation.rotationNumber],
                });
              }
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    // Check for playerIn already on the live field (in-progress only, future rotations only)
    if (gameState.status === 'in-progress') {
      const currentMinutes = Math.floor(currentTime / 60);
      for (const rotation of plannedRotations) {
        if (rotation.gameMinute <= currentMinutes) continue; // skip past rotations
        try {
          const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
          for (const sub of subs) {
            const playerInOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerInId);
            const playerOutOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerOutId);
            const isTrueOnFieldConflict = playerInOnField && playerOutOnField;
            if (isTrueOnFieldConflict) {
              const player = players.find(p => p.id === sub.playerInId);
              const existing = conflicts.find(c => c.playerId === sub.playerInId && c.type === 'on-field');
              if (existing) {
                if (!existing.rotationNumbers.includes(rotation.rotationNumber)) {
                  existing.rotationNumbers.push(rotation.rotationNumber);
                }
              } else {
                conflicts.push({
                  type: 'on-field',
                  playerId: sub.playerInId,
                  playerName: player
                    ? `#${player.playerNumber} ${player.firstName} ${player.lastName}`
                    : 'Unknown',
                  status: 'on-field',
                  rotationNumbers: [rotation.rotationNumber],
                });
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    return conflicts;
  };

  const handleRecalculateRotations = async () => {
    if (!gamePlan || plannedRotations.length === 0) return;

    const confirmed = await confirm({
      title: 'Recalculate Rotations',
      message: 'This will recalculate all rotation substitutions based on current player availability and preferred positions.\n\nExisting rotation substitutions will be overwritten.',
      confirmText: 'Recalculate',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      setIsRecalculating(true);

      // Build available roster from players who are available or late-arrival
      const availableRoster = players
        .filter(p => {
          const status = getPlayerAvailability(p.id);
          return status === 'available' || status === 'late-arrival';
        })
        .map(p => ({
          id: p.id,
          playerId: p.id,
          playerNumber: p.playerNumber || 0,
          preferredPositions: p.preferredPositions,
        }));

      // Use live lineup instead of gamePlan.startingLineup for mid-game recalculations
      const liveStarters = lineup.filter(l => l.isStarter);
      if (liveStarters.length === 0) {
        showWarning('No active lineup found. Please set up the lineup before recalculating.');
        setIsRecalculating(false);
        return;
      }
      const lineupArray = liveStarters
        .map(l => ({ playerId: l.playerId, positionId: l.positionId }))
        .filter((entry): entry is { playerId: string; positionId: string } => {
          const status = getPlayerAvailability(entry.playerId);
          return (status === 'available' || status === 'late-arrival') && entry.positionId != null;
        });

      if (lineupArray.length === 0) {
        showWarning('No available players in the starting lineup. Adjust the lineup in the Game Planner first.');
        return;
      }

      const halfLengthMinutes = gameState.halfLengthMinutes ?? team.halfLengthMinutes ?? 30;
      const rotationIntervalMinutes = gamePlan.rotationIntervalMinutes || 10;
      const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);

      const goaliePos = positions.find(p => {
        const abbr = p.abbreviation?.toUpperCase();
        return abbr === 'GK' || abbr === 'G';
      });
      const goaliePositionId = goaliePos?.id;

      // Compute accumulated play time per player (seconds → minutes) for fairness seeding
      const initialPlayTimeMinutes = new Map<string, number>();
      for (const player of availableRoster) {
        const accSecs = calculatePlayerPlayTime(player.playerId, playTimeRecords, currentTime);
        initialPlayTimeMinutes.set(player.playerId, accSecs / 60);
      }

      const { rotations: generatedRotations } = calculateFairRotations(
        availableRoster,
        lineupArray,
        plannedRotations.length,
        rotationsPerHalf,
        team.maxPlayersOnField || positions.length,
        goaliePositionId,
        undefined,
        { rotationIntervalMinutes, halfLengthMinutes, positions, playerAvailabilities, initialPlayTimeMinutes },
      );

      // Update only future rotations with generated substitutions
      const currentMinutes = Math.floor(currentTime / 60);
      const updates = plannedRotations
        .map((rotation, index) => ({ rotation, generated: generatedRotations[index] }))
        .filter(({ rotation }) => rotation.gameMinute > currentMinutes)
        .map(({ rotation, generated }) => {
          return client.models.PlannedRotation.update({
            id: rotation.id,
            plannedSubstitutions: JSON.stringify(generated?.substitutions || []),
          });
        });

      await Promise.all(updates);

      showSuccess('Rotations recalculated based on current availability! Review each rotation to verify.');      trackEvent(AnalyticsEvents.ROTATION_RECALCULATED.category, AnalyticsEvents.ROTATION_RECALCULATED.action);    } catch (error) {
      handleApiError(error, 'Failed to recalculate rotations');
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleOpenEditGame = useCallback(() => {
    setEditGameOpponent(game.opponent ?? '');
    setEditGameDate(isoToDatetimeLocal(game.gameDate));
    setEditGameIsHome(game.isHome ?? true);
    setIsEditingGame(true);
  }, [game]);

  const handleSaveGameEdit = useCallback(async () => {
    if (!editGameOpponent.trim()) {
      showWarning('Please enter an opponent name');
      return;
    }
    setIsSavingGameEdit(true);
    const timeoutId = setTimeout(() => {
      setIsSavingGameEdit(false);
      showError('Could not confirm save — check your connection and try again.');
    }, 5000);
    try {
      await client.models.Game.update({
        id: game.id,
        opponent: editGameOpponent.trim(),
        isHome: editGameIsHome,
        gameDate: editGameDate ? new Date(editGameDate).toISOString() : null,
      });
      clearTimeout(timeoutId);
      trackEvent(AnalyticsEvents.GAME_UPDATED.category, AnalyticsEvents.GAME_UPDATED.action);
      setIsEditingGame(false);
      setIsSavingGameEdit(false);
      editGameButtonRef.current?.focus();
    } catch (error) {
      clearTimeout(timeoutId);
      setIsSavingGameEdit(false);
      handleApiError(error, 'Failed to update game');
    }
  }, [game, editGameOpponent, editGameIsHome, editGameDate]);

  const handleCancelGameEdit = useCallback(() => {
    setIsEditingGame(false);
    editGameButtonRef.current?.focus();
  }, []);

  const handleStartGame = async () => {
    // Warn if any starters are unavailable
    const unavailableStarters = lineup
      .filter(l => l.isStarter)
      .filter(l => {
        const status = getPlayerAvailability(l.playerId);
        return status === 'absent' || status === 'injured';
      })
      .map(l => {
        const player = players.find(p => p.id === l.playerId);
        const status = getPlayerAvailability(l.playerId);
        return player ? `#${player.playerNumber} ${player.firstName} (${status})` : `Unknown (${status})`;
      });

    if (unavailableStarters.length > 0) {
      const proceed = await confirm({
        title: 'Unavailable Starters',
        message: `The following starters are unavailable:\n\n${unavailableStarters.join('\n')}\n\nPlease update the lineup before starting. Start anyway?`,
        confirmText: 'Start Anyway',
        variant: 'warning',
      });
      if (!proceed) return;
    }

    try {
      const resolvedLocalStarters = lineup.filter(
        (l): l is typeof l & { playerId: string; positionId: string } =>
          l.isStarter && !!l.playerId && !!l.positionId
      );
      const resolvedLocalStarterCount = resolvedLocalStarters.length;
      const expectedStarterCount = team.maxPlayersOnField ?? resolvedLocalStarterCount;

      let starters = resolvedLocalStarters;

      if (resolvedLocalStarterCount < expectedStarterCount) {
        const fallbackAssignments = await client.models.LineupAssignment.list({
          filter: {
            gameId: { eq: game.id },
            isStarter: { eq: true },
          },
        });

        const dbStarters = fallbackAssignments.data.filter(
          (l): l is typeof l & { playerId: string; positionId: string } => !!l.playerId && !!l.positionId
        );

        if (dbStarters.length > resolvedLocalStarters.length) {
          starters = dbStarters;
        }
      }

      if (starters.length < expectedStarterCount) {
        throw new StarterCountError('handleStartGame', expectedStarterCount, starters.length);
      }

      const startTime = new Date().toISOString();
      
      await mutations.updateGame(game.id, {
        status: 'in-progress',
        lastStartTime: startTime,
      });

      // Create play time records for resolved starters using game time.
      // Only create if they don't already have an active record for this game.
      const startersWithoutActiveRecords = starters
        .filter(l => {
          const hasActiveRecord = playTimeRecords.some(
            r => r.gameId === game.id && r.playerId === l.playerId && r.endGameSeconds === null
          );
          return !hasActiveRecord;
        });

      const starterPromises = startersWithoutActiveRecords.map(l =>
        mutations.createPlayTimeRecord({
          gameId: game.id,
          playerId: l.playerId,
          positionId: l.positionId,
          startGameSeconds: currentTime,
          coaches: team.coaches,
        })
      );

      await Promise.all(starterPromises);

      setGameState({ ...gameState, status: 'in-progress' });
      setIsRunning(true);
      trackEvent(AnalyticsEvents.GAME_STARTED.category, AnalyticsEvents.GAME_STARTED.action);
    } catch (error) {
      handleApiError(
        error,
        isStarterCountError(error) ? error.userMessage : 'Failed to start game'
      );
    }
  };

  const handlePauseTimer = async () => {
    manuallyPausedRef.current = true; // Prevent observeQuery from auto-resuming
    setIsRunning(false);
    try {
      await mutations.updateGame(game.id, {
        elapsedSeconds: currentTime,
        lastStartTime: null, // Clear lastStartTime to prevent auto-resume from observeQuery
      });
        // Do NOT reset manuallyPausedRef.current here.
        // A stale game-start subscription event (lastStartTime: T_start) may be buffered
        // in the AppSync pipeline and could arrive seconds after the pause write completes.
        // If manuallyPausedRef is false when that event arrives, the timer auto-resumes.
        // Instead, observeQuery resets manuallyPausedRef when it sees the confirmed
        // pause event (lastStartTime: null) from DynamoDB.
    } catch (error) {
      handleApiError(error, 'Failed to pause game');
      manuallyPausedRef.current = false;
    }
  };

  const handleResumeTimer = async () => {
    setIsRunning(true);
      manuallyPausedRef.current = false; // Explicit resume clears the manual-pause flag
    try {
      await mutations.updateGame(game.id, {
        lastStartTime: new Date().toISOString(),
        elapsedSeconds: currentTime,
      });
    } catch (error) {
      handleApiError(error, 'Failed to resume game');
    }
  };

  const handleHalftime = async () => {
    // Guard: prevent duplicate calls from auto-trigger + manual button click
    if (halftimeInProgressRef.current) {
      return;
    }
    halftimeInProgressRef.current = true;
    manuallyPausedRef.current = true; // Prevent observeQuery from auto-resuming during halftime transition (fixes #49)
    setIsRunning(false);

    const halftimeSeconds = currentTime; // Capture current time before any async operations

    // CRITICAL: Write 'halftime' status to DynamoDB FIRST, before the
    // potentially-slow PTR closing pass. If PTR closing throws, the game
    // status must still be persisted so the coach is not stuck in-progress.
    try {
      await mutations.updateGame(game.id, {
        status: 'halftime',
        elapsedSeconds: halftimeSeconds,
        lastStartTime: null, // Clear so stale observeQuery cannot auto-resume
      });
      setGameState(prev => ({ ...prev, status: 'halftime', elapsedSeconds: halftimeSeconds }));
      setCurrentTime(halftimeSeconds);
      trackEvent(AnalyticsEvents.GAME_HALFTIME.category, AnalyticsEvents.GAME_HALFTIME.action);
    } catch (error) {
      handleApiError(error, 'Failed to set halftime');
      halftimeInProgressRef.current = false; // Reset on error so user can retry
      manuallyPausedRef.current = false;
      return;
    }

    // Close play time records after status is safely persisted.
    try {
      await closeActivePlayTimeRecords(playTimeRecords, halftimeSeconds, undefined, game.id, mutations);
      halftimePtrClosePendingRef.current = false;
    } catch (error) {
      halftimePtrClosePendingRef.current = true;
      console.warn('[handleHalftime] PTR closing failed; marked pending retry before second half start.', error);
    } finally {
      manuallyPausedRef.current = false;
    }
  };

  const handleApplyHalftimeSub = async (sub: PlannedSubstitution) => {
    try {
      const currentAssignment = lineup.find(l => l.positionId === sub.positionId && l.isStarter);
      if (!currentAssignment) return;
      if (currentAssignment.playerId === sub.playerInId) return; // already applied

      await mutations.deleteLineupAssignment(currentAssignment.id);
      await mutations.createLineupAssignment({
        gameId: game.id,
        playerId: sub.playerInId,
        positionId: sub.positionId,
        isStarter: true,
        coaches: team.coaches,
      });
      await mutations.createSubstitution({
        gameId: game.id,
        positionId: sub.positionId,
        playerOutId: sub.playerOutId,
        playerInId: sub.playerInId,
        half: 1,
        gameSeconds: currentTime,
        coaches: team.coaches,
      });
    } catch (error) {
      handleApiError(error, 'Failed to apply halftime substitution');
    }
  };

  const handleStartSecondHalf = async () => {
    try {
      const startTime = new Date().toISOString();
      const resumeTime = currentTime; // Capture current time to continue from

      if (halftimePtrClosePendingRef.current) {
        try {
          await closeActivePlayTimeRecords(playTimeRecords, resumeTime, undefined, game.id, mutations);
          halftimePtrClosePendingRef.current = false;
        } catch (error) {
          handleApiError(error, 'Failed to close halftime play-time records before second half start');
          return;
        }
      }
      
      // CRITICAL: Update gameState.currentHalf BEFORE starting the timer.
      // Without this, the timer hook may see currentHalf===1 and re-trigger
      // auto-halftime because the DB subscription hasn't propagated yet.
      setGameState(prev => ({ ...prev, status: 'in-progress', currentHalf: 2 }));
      
      // Reset halftime guard so it could theoretically fire again if needed
      halftimeInProgressRef.current = false;
      
      // Create play time records for all players currently in lineup for second half
      const resolvedLocalStarters = lineup.filter(
        (l): l is typeof l & { playerId: string; positionId: string } =>
          l.isStarter && !!l.playerId && !!l.positionId
      );
      const resolvedLocalStarterCount = resolvedLocalStarters.length;
      const expectedStarterCount = team.maxPlayersOnField ?? resolvedLocalStarterCount;

      let starters = resolvedLocalStarters;

      if (resolvedLocalStarterCount < expectedStarterCount) {
        const fallbackAssignments = await client.models.LineupAssignment.list({
          filter: {
            gameId: { eq: game.id },
            isStarter: { eq: true },
          },
        });

        const dbStarters = fallbackAssignments.data.filter(
          (l): l is typeof l & { playerId: string; positionId: string } => !!l.playerId && !!l.positionId
        );

        if (dbStarters.length > resolvedLocalStarters.length) {
          starters = dbStarters;
        }
      }

      if (starters.length < expectedStarterCount) {
        throw new StarterCountError('handleStartSecondHalf', expectedStarterCount, starters.length);
      }
      
      const starterPromises = starters.map(l => {
        return mutations.createPlayTimeRecord({
          gameId: game.id,
          playerId: l.playerId,
          positionId: l.positionId,
          startGameSeconds: resumeTime,
          coaches: team.coaches,
        });
      });

      await Promise.all(starterPromises);

      // Update game status - keep resumeTime to continue from halftime
      await mutations.updateGame(game.id, {
        status: 'in-progress',
        currentHalf: 2,
        lastStartTime: startTime,
        elapsedSeconds: resumeTime,
      });

      // Explicitly set current time and start running
      setCurrentTime(resumeTime);
      setIsRunning(true);
      trackEvent(AnalyticsEvents.GAME_SECOND_HALF_STARTED.category, AnalyticsEvents.GAME_SECOND_HALF_STARTED.action);
    } catch (error) {
      handleApiError(
        error,
        isStarterCountError(error) ? error.userMessage : 'Failed to start second half'
      );
    }
  };

  const handleEndGame = async () => {
    // Guard: prevent duplicate calls from auto-trigger + manual button click
    if (endGameInProgressRef.current) {
      return;
    }
    endGameInProgressRef.current = true;
    manuallyPausedRef.current = true; // Prevent observeQuery from auto-resuming during end-game transition (fixes #49)

    const endGameTime = currentTime;
    setIsRunning(false);

    // Compute final score from goals at time of completion
    const { ourScore, opponentScore } = computeScoreFromGoals(goals);

    // CRITICAL: Write 'completed' status + score snapshot to DynamoDB FIRST, before the
    // potentially-slow PTR closing pass. If PTR closing throws, the game
    // status must still be persisted so the coach is not stuck in-progress.
    try {
      await mutations.updateGame(game.id, {
        status: 'completed',
        elapsedSeconds: endGameTime,
        lastStartTime: null, // Clear so stale observeQuery cannot auto-resume
        ourScore,
        opponentScore,
      });
      setGameState(prev => ({ ...prev, status: 'completed', elapsedSeconds: endGameTime, ourScore, opponentScore }));
      setCurrentTime(endGameTime);
      trackEvent(AnalyticsEvents.GAME_COMPLETED.category, AnalyticsEvents.GAME_COMPLETED.action);
    } catch (error) {
      handleApiError(error, 'Failed to end game');
      endGameInProgressRef.current = false; // Reset on error so user can retry
      manuallyPausedRef.current = false;
      return;
    }

    // Close play time records after status is safely persisted.
    // Failures here are non-fatal — SeasonReport already handles unclosed PTRs as a fallback.
    try {
      await closeActivePlayTimeRecords(playTimeRecords, endGameTime, undefined, game.id, mutations);
    } catch (error) {
      console.error('[handleEndGame] PTR closing failed (non-fatal, game already completed):', error);
    } finally {
      manuallyPausedRef.current = false;
    }
  };

  // Timer hook - handles 500ms wall-clock tick, DB sync every 5s, auto-halftime/auto-end (fixes #31)
  const { resetAnchor } = useGameTimer({
    game,
    gameState,
    halfLengthSeconds,
    currentTime,
    setCurrentTime,
    isRunning,
    gamePlan,
    plannedRotations,
    onHalftime: handleHalftime,
    onEndGame: handleEndGame,
  });

  // Reset tab to 'field' whenever the game leaves in-progress state
  useEffect(() => {
    if (gameState.status !== "in-progress") {
      setActiveTab("field");
    }
  }, [gameState.status]);

  useEffect(() => {
    if (gameState.status === 'in-progress' && activeTab === 'notes') {
      void refetchCoachProfiles();
    }
  }, [gameState.status, activeTab, refetchCoachProfiles]);

  const handleSubstitute = (position: FormationPosition) => {
    setSubstitutionRequest(position);
  };

  const handleQueueSubstitution = (playerId: string, positionId: string) => {
    // Early-return guards read the closure snapshot for immediate single-click
    // warning feedback. In batched scenarios (e.g. Queue All) these checks see
    // stale state and will not fire; the functional updater below is the
    // authoritative duplicate check for all cases.
    const alreadyQueued = substitutionQueue.some(
      q => q.playerId === playerId && q.positionId === positionId
    );
    if (alreadyQueued) {
      showWarning("This player is already queued for this position");
      return;
    }

    const queuedElsewhere = substitutionQueue.find(q => q.playerId === playerId);
    if (queuedElsewhere) {
      showWarning("This player is already queued for another position");
      return;
    }

    // Use functional updater so batched calls (e.g. Queue All) each see the
    // latest queue state instead of the stale closure captured at render time.
    setSubstitutionQueue(prev => {
      if (prev.some(q => q.playerId === playerId && q.positionId === positionId)) return prev;
      if (prev.some(q => q.playerId === playerId)) return prev;
      return [...prev, { playerId, positionId }];
    });
  };

  const openLiveNoteModal = useCallback((intent: OpenLiveNoteIntent, trigger: HTMLElement | null) => {
    liveNoteModalReturnFocusRef.current = trigger;
    setLiveNoteModalState((previous) => ({
      isOpen: true,
      requestId: previous.requestId + 1,
      intent,
    }));
  }, []);

  const closeLiveNoteModal = useCallback(() => {
    setLiveNoteModalState((previous) => ({
      ...previous,
      isOpen: false,
    }));
    window.setTimeout(() => {
      liveNoteModalReturnFocusRef.current?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const handleAddTestTime = (minutes: number) => {
    const newTime = currentTime + minutes * 60;
    setCurrentTime(newTime);
    resetAnchor(newTime);
  };

  const openCreatePreGameNote = () => {
    setPreGameNoteMode('create');
    setPreGameNoteDraft(null);
    setIsPreGameNoteModalOpen(true);
  };

  const openEditPreGameNote = (note: { id?: string; notes?: string | null; playerId?: string | null }) => {
    setPreGameNoteMode('edit');
    setPreGameNoteDraft(note);
    setIsPreGameNoteModalOpen(true);
  };

  const closePreGameNoteModal = () => {
    setIsPreGameNoteModalOpen(false);
  };

  const handleSubmitPreGameNote = async (payload: { notes: string; playerId: string | null }) => {
    try {
      if (preGameNoteMode === 'edit' && preGameNoteDraft?.id) {
        await mutations.updateGameNote(preGameNoteDraft.id, {
          notes: payload.notes,
          playerId: payload.playerId,
        });
        setNotesRefreshKey(k => k + 1);
        return;
      }

      await mutations.createGameNote({
        gameId: game.id,
        noteType: 'coaching-point',
        playerId: payload.playerId,
        gameSeconds: null,
        half: null,
        notes: payload.notes,
        timestamp: new Date().toISOString(),
        coaches: team.coaches,
      });
      setNotesRefreshKey(k => k + 1);
    } catch (error) {
      handleApiError(error, preGameNoteMode === 'edit' ? 'Failed to update pre-game note' : 'Failed to create pre-game note');
      throw error;
    }
  };

  const handleDeletePreGameNote = async (note: { id?: string }) => {
    if (!note.id) {
      showWarning('Unable to delete note: missing note id.');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete Coaching Point',
      message: 'Delete this coaching point? This action cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await mutations.deleteGameNote(note.id);
    } catch (error) {
      handleApiError(error, 'Failed to delete pre-game note');
    }
  };

  const closeInjuryModal = useCallback(() => {
    if (isInjuryMutationPending) {
      return;
    }
    setInjuryModalOpen(false);
  }, [isInjuryMutationPending]);

  useEffect(() => {
    if (!injuryModalOpen) {
      if (injuryModalReturnFocusRef.current) {
        injuryModalReturnFocusRef.current.focus({ preventScroll: true });
      }
      return;
    }

    injuryModalHeadingRef.current?.focus();
    const modal = injuryModalRef.current;
    if (!modal) {
      return;
    }

    const focusableSelectors = [
      'button:not(:disabled)',
      '[href]',
      'input:not(:disabled)',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isInjuryMutationPending) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        closeInjuryModal();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors));
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener('keydown', onKeyDown);
    return () => {
      modal.removeEventListener('keydown', onKeyDown);
    };
  }, [closeInjuryModal, injuryModalOpen, isInjuryMutationPending]);

  const deleteGameButton = (
    <div className="delete-game-section">
      <button
        onClick={async () => {
          const confirmed = await confirm({
            title: 'Delete Game',
            message: 'Are you sure you want to delete this game? This action cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger',
          });
          if (!confirmed) return;
          try {
            await deleteGameCascade(game.id);
            trackEvent(AnalyticsEvents.GAME_DELETED.category, AnalyticsEvents.GAME_DELETED.action);
            onBack();
          } catch (error) {
            handleApiError(error, 'Failed to delete game');
          }
        }}
        className="btn-delete-game"
      >
        Delete Game
      </button>
    </div>
  );

  const sharedLineupPanelProps = {
    gameState,
    game,
    team,
    players,
    positions,
    lineup,
    playTimeRecords,
    currentTime,
    onSubstitute: handleSubstitute,
    mutations,
  };

  const sharedGoalTrackerProps = {
    gameState,
    game,
    team,
    players,
    goals,
    currentTime,
    playTimeRecords,
    lineup,
    mutations,
  };

  const sharedNotesPanelProps = {
    gameState,
    game,
    team,
    players,
    gameNotes,
    currentTime,
    mutations,
    currentUserId: userId,
    profileMap,
    onNoteSaved: () => setNotesRefreshKey(k => k + 1),
  };

  const preGameNotes = gameNotes.filter(
    (note) => note.gameSeconds == null && note.half == null
  );

  return (
    <AvailabilityProvider availabilities={playerAvailabilities}>
      <div className="game-management">

        {/* Always-visible sticky command band */}
        <CommandBand
          gameState={gameState}
          onBack={onBack}
          currentTime={currentTime}
          isRunning={isRunning}
          halfLengthSeconds={halfLengthSeconds}
          gamePlan={gamePlan}
          plannedRotations={plannedRotations}
          onPauseTimer={handlePauseTimer}
          onResumeTimer={handleResumeTimer}
          onShowRotationModal={() => { setRotationModalOpen(true); trackEvent(AnalyticsEvents.ROTATION_WIDGET_OPENED.category, AnalyticsEvents.ROTATION_WIDGET_OPENED.action); }}
          onAddNote={(trigger) => openLiveNoteModal({ source: 'command-band', defaultType: 'other' }, trigger)}
        />

        {/* Rotation and late-arrival modals (always mounted for in-progress) */}
        <RotationWidget
          gameState={gameState}
          game={game}
          team={team}
          players={players}
          positions={positions}
          gamePlan={gamePlan}
          plannedRotations={plannedRotations}
          currentTime={currentTime}
          lineup={lineup}
          playTimeRecords={playTimeRecords}
          substitutionQueue={substitutionQueue}
          onQueueSubstitution={handleQueueSubstitution}
          isRotationModalOpen={rotationModalOpen}
          onOpenRotationModal={() => { setRotationModalOpen(true); trackEvent(AnalyticsEvents.ROTATION_WIDGET_OPENED.category, AnalyticsEvents.ROTATION_WIDGET_OPENED.action); }}
          onCloseRotationModal={() => setRotationModalOpen(false)}
          onRecalculateRotations={handleRecalculateRotations}
          isRecalculating={isRecalculating}
          getPlanConflicts={getPlanConflicts}
        />

        {/* Substitution modal (always mounted) */}
        <SubstitutionPanel
          gameState={gameState}
          game={game}
          team={team}
          players={players}
          positions={positions}
          lineup={lineup}
          playTimeRecords={playTimeRecords}
          currentTime={currentTime}
          substitutionQueue={substitutionQueue}
          onQueueChange={setSubstitutionQueue}
          substitutionRequest={substitutionRequest}
          onSubstitutionRequestHandled={() => setSubstitutionRequest(null)}
          mutations={mutations}
        />

        {/* ── PRE-GAME ─────────────────────────────────────────────── */}
        {gameState.status === 'scheduled' && (
          <div className="pregame-layout">
            {/* Edit Game trigger or inline edit form */}
            {!isEditingGame ? (
              <button
                ref={editGameButtonRef}
                className="btn-secondary btn-edit-game-trigger"
                onClick={handleOpenEditGame}
              >
                ✏️ Edit Game
              </button>
            ) : (
              <div className="create-form" ref={editFormRef}>
                <h3>Edit Game</h3>
                <input
                  type="text"
                  placeholder="Opponent Team Name *"
                  value={editGameOpponent}
                  onChange={(e) => setEditGameOpponent(e.target.value)}
                  maxLength={100}
                />
                <input
                  type="datetime-local"
                  value={editGameDate}
                  onChange={(e) => setEditGameDate(e.target.value)}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editGameIsHome}
                    onChange={(e) => setEditGameIsHome(e.target.checked)}
                  />
                  Home Game
                </label>
                <div className="form-actions">
                  <button
                    onClick={handleSaveGameEdit}
                    className="btn-primary"
                    disabled={isSavingGameEdit}
                  >
                    {isSavingGameEdit ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button
                    onClick={handleCancelGameEdit}
                    className="btn-secondary"
                    disabled={isSavingGameEdit}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {gamePlan && (() => {
              const conflicts = getPlanConflicts();
              if (conflicts.length === 0) return null;
              return (
                <div className="plan-conflict-banner">
                  <h4>⚠️ Plan Conflicts</h4>
                  <p>The following players are in the game plan but currently unavailable:</p>
                  <ul>
                    {conflicts.map(c => (
                      <li key={c.playerId}>
                        <strong>{c.playerName}</strong> — {c.status}
                        {c.type === 'starter' && ' (starting lineup)'}
                        {c.rotationNumbers.length > 0 && ` · Rotation${c.rotationNumbers.length > 1 ? 's' : ''} ${c.rotationNumbers.join(', ')}`}
                      </li>
                    ))}
                  </ul>
                  <p className="conflict-hint">Update availability or adjust the game plan before starting.</p>
                  <button
                    onClick={handleRecalculateRotations}
                    disabled={isRecalculating}
                    className="btn-secondary"
                    style={{ marginTop: '8px' }}
                  >
                    {isRecalculating ? '⏳ Recalculating...' : '🔄 Recalculate Rotations'}
                  </button>
                </div>
              );
            })()}

            {gamePlan && players.length > 0 && (
              <PlayerAvailabilityGrid
                players={players}
                gameId={game.id}
                coaches={team.coaches || []}
                lineupPlayerIds={lineup.filter(l => l.isStarter).map(l => l.playerId)}
              />
            )}

            <LineupPanel {...sharedLineupPanelProps} />

            {!isEditingGame && (
              <div className="pregame-start-cta">
                <button onClick={handleStartGame} className="btn-primary btn-large">
                  Start Game
                </button>
              </div>
            )}

            {!isEditingGame && deleteGameButton}
          </div>
        )}

        {/* ── IN-PROGRESS ──────────────────────────────────────────── */}
        {gameState.status === 'in-progress' && (
          <>
            <OfflineBanner isOnline={isOnline} pendingCount={pendingMutationCount} isSyncing={isSyncing} />
            <TabNav
              activeTab={activeTab}
              onTabChange={setActiveTab}
              substitutionQueueCount={substitutionQueue.length}
            />

            {activeTab === 'field' && (
              <div className="field-tab">
                <LineupPanel
                  {...sharedLineupPanelProps}
                  hideAvailablePlayers={true}
                />
                {import.meta.env.DEV && (
                  <div className="testing-controls">
                    <span className="testing-label">Testing:</span>
                    <button
                      onClick={() => handleAddTestTime(1)}
                      className="btn-test-time"
                      title="Add 1 minute for testing"
                    >
                      +1 min
                    </button>
                    <button
                      onClick={() => handleAddTestTime(5)}
                      className="btn-test-time"
                      title="Add 5 minutes for testing"
                    >
                      +5 min
                    </button>
                  </div>
                )}
                <div className="field-tab__action-bar">
                  {gameState.currentHalf === 1 && (
                    <button onClick={handleHalftime} className="btn-secondary">
                      End First Half
                    </button>
                  )}
                  {gameState.currentHalf === 2 && (
                    <button onClick={handleEndGame} className="btn-secondary">
                      End Game
                    </button>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'bench' && (
              <BenchTab
                players={players}
                lineup={lineup}
                playTimeRecords={playTimeRecords}
                currentTime={currentTime}
                halfLengthSeconds={halfLengthSeconds}
                gameId={game.id}
                coaches={Array.isArray(team.coaches) ? team.coaches : undefined}
                playerAvailabilities={playerAvailabilities}
                mutations={mutations}
                isOnline={isOnline}
                onSelectPlayer={() => {
                  const emptyPosition = positions.find(
                    pos => !lineup.some(l => l.positionId === pos.id && l.isStarter)
                  );
                  const targetPosition = emptyPosition ?? positions[0];
                  if (targetPosition) setSubstitutionRequest(targetPosition);
                }}
              />
            )}

            {activeTab === 'goals' && (
              <GoalTracker {...sharedGoalTrackerProps} />
            )}

          </>
        )}

        {/* ── HALFTIME ─────────────────────────────────────────────── */}
        {gameState.status === 'halftime' && (
          <div className="halftime-layout">
            <OfflineBanner isOnline={isOnline} pendingCount={pendingMutationCount} isSyncing={isSyncing} />
            <GameTimer
              gameState={gameState}
              game={game}
              team={team}
              players={players}
              positions={positions}
              currentTime={currentTime}
              isRunning={isRunning}
              halfLengthSeconds={halfLengthSeconds}
              gamePlan={gamePlan}
              plannedRotations={plannedRotations}
              lineup={lineup}
              isRecalculating={isRecalculating}
              hidePrimaryCta={true}
              onStartGame={handleStartGame}
              onPauseTimer={handlePauseTimer}
              onResumeTimer={handleResumeTimer}
              onHalftime={handleHalftime}
              onStartSecondHalf={handleStartSecondHalf}
              onEndGame={handleEndGame}
              onAddTestTime={handleAddTestTime}
              onRecalculateRotations={handleRecalculateRotations}
              onApplyHalftimeSub={handleApplyHalftimeSub}
              getPlanConflicts={getPlanConflicts}
            />
            <LineupPanel {...sharedLineupPanelProps} />
            <div className="halftime-actions">
              <button
                onClick={() => {
                  injuryModalReturnFocusRef.current = document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
                  setInjuryModalOpen(true);
                }}
                className="btn-secondary"
              >
                Manage Injuries
              </button>
              <button
                onClick={(event) => openLiveNoteModal({ source: 'halftime-action', defaultType: 'other' }, event.currentTarget)}
                className="btn-secondary"
              >
                Add note
              </button>
            </div>
            <div className="halftime-start-cta">
              <button onClick={handleStartSecondHalf} className="btn-primary btn-large">
                Start Second Half
              </button>
            </div>
          </div>
        )}

        {/* ── COMPLETED ────────────────────────────────────────────── */}
        {gameState.status === 'completed' && (
          <div className="completed-layout">
            <CompletedPlayTimeSummary
              players={players}
              playTimeRecords={playTimeRecords}
              gameEndSeconds={gameState.elapsedSeconds ?? 0}
            />
            <GoalTracker {...sharedGoalTrackerProps} />
            <PreGameNotesPanel
              gameStatus={gameState.status}
              notes={preGameNotes}
              players={players}
              onAdd={openCreatePreGameNote}
              onEdit={openEditPreGameNote}
              onDelete={handleDeletePreGameNote}
              isReadOnly={false}
              profileMap={profileMap}
            />
          </div>
        )}

        <PlayerNotesPanel
          {...sharedNotesPanelProps}
          showPanelContent={
            (gameState.status === 'in-progress' && activeTab === 'notes')
            || gameState.status === 'completed'
          }
          isNoteModalOpen={liveNoteModalState.isOpen}
          noteModalRequestId={liveNoteModalState.requestId}
          noteModalIntent={liveNoteModalState.intent}
          onRequestOpenNote={openLiveNoteModal}
          onRequestCloseNote={closeLiveNoteModal}
        />

        {gameState.status === 'completed' && (
          <div className="completed-footer">
            <Link to={`/reports/${team.id}`} className="btn-link completed-report-link__anchor">
              View Full Season Report →
            </Link>
            {deleteGameButton}
          </div>
        )}

        {injuryModalOpen && gameState.status === 'halftime' && (
          <div className="modal-overlay" onClick={closeInjuryModal}>
            <div
              ref={injuryModalRef}
              className="modal-content halftime-injury-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="halftime-injury-modal-title"
              aria-describedby="halftime-injury-modal-description"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="halftime-injury-modal__header">
                <h3 id="halftime-injury-modal-title" tabIndex={-1} ref={injuryModalHeadingRef}>Manage Injuries</h3>
                <p className="modal-subtitle" id="halftime-injury-modal-description">
                  Mark injured players unavailable for substitutions and rotations until recovered.
                </p>
              </div>
              <BenchTab
                players={players}
                lineup={lineup}
                playTimeRecords={playTimeRecords}
                currentTime={currentTime}
                halfLengthSeconds={halfLengthSeconds}
                gameId={game.id}
                coaches={Array.isArray(team.coaches) ? team.coaches : undefined}
                playerAvailabilities={playerAvailabilities}
                mutations={mutations}
                isOnline={isOnline}
                allowSubstitution={false}
                onInjuryMutationPendingChange={setIsInjuryMutationPending}
                onSelectPlayer={() => undefined}
              />
              <div className="form-actions">
                <button className="btn-primary" onClick={closeInjuryModal} disabled={isInjuryMutationPending}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        <CreateEditNoteModal
          isOpen={isPreGameNoteModalOpen}
          mode={preGameNoteMode}
          players={players}
          initialNote={preGameNoteMode === 'edit' && preGameNoteDraft?.id
            ? {
                playerId: preGameNoteDraft.playerId ?? null,
                notes: preGameNoteDraft.notes ?? '',
              }
            : null}
          onClose={closePreGameNoteModal}
          onSubmit={handleSubmitPreGameNote}
        />

      </div>
    </AvailabilityProvider>
  );
}
