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
import { calculateFairRotations, copyGamePlan, type PlannedSubstitution } from "../../services/rotationPlannerService";
import { calculatePlayerPlayTime } from "../../utils/playTimeCalculations";
import {
  computeRevisionFingerprint,
  computeRotationDiff,
  filterScopedDeletes,
  type RotationDiffOperation,
} from "../../utils/rotationDiffUtils";
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
import { PlanTab, type GenerateRotationsOptions } from "./PlanTab";
import type { PlannedRotationsUpdateInput, PlannerMutationResult } from "./PlanTab";
import { CompletedPlayTimeSummary } from "./CompletedPlayTimeSummary";
import { OfflineBanner } from "../OfflineBanner";
import type { Game, Team, FormationPosition, PlannedRotation, SubQueue } from "./types";
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

type PreviousGameSummary = { id: string; opponent: string; gameDate: string | null };

interface GameManagementProps {
  game: Game;
  team: Team;
  onBack: () => void;
  initialTab?: GameTab;
}

type LineupViewMode = "list" | "shape";

function getLineupViewStorageKey(userId: string, gameId: string): string {
  return `lineup-view-mode:${userId}:${gameId}`;
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

function buildDeterministicStartPlayTimeRecordId(params: {
  gameId: string;
  playerId: string;
  half: 1 | 2;
  startGameSeconds: number;
}): string {
  const { gameId, playerId, half, startGameSeconds } = params;
  return `ptr:${gameId}:${playerId}:h${half}:t${startGameSeconds}`;
}

type StarterSelection = {
  playerId: string;
  positionId: string;
};

function parsePersistedStarterLineup(
  lineupRaw: string | null | undefined,
  getPlayerAvailability: (playerId: string) => string | null | undefined,
): StarterSelection[] {
  if (!lineupRaw) {
    return [];
  }

  try {
    const parsed = JSON.parse(lineupRaw) as Array<{ playerId?: string | null; positionId?: string | null }>;
    return parsed.filter(
      (entry): entry is { playerId: string; positionId: string } =>
        typeof entry.playerId === 'string'
        && entry.playerId.length > 0
        && typeof entry.positionId === 'string'
        && entry.positionId.length > 0
        && ['available', 'late-arrival'].includes(getPlayerAvailability(entry.playerId) ?? 'available')
    );
  } catch {
    return [];
  }
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

function orderPlannerOperationsForSaferApply(
  operations: RotationDiffOperation[]
): RotationDiffOperation[] {
  const order = { update: 0, create: 1, delete: 2 } as const;
  return [...operations].sort((a, b) => {
    const byAction = order[a.action] - order[b.action];
    if (byAction !== 0) return byAction;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Phase A of the rotation schedule pipeline.
 * Builds the expected rotation timeline, reconciles it against existing rows
 * (deleting duplicates/obsolete rows, updating schedule fields), creates any
 * missing rows with empty substitutions, and returns the full sorted list of
 * normalized PlannedRotation records.
 *
 * Does NOT call calculateFairRotations — substitution content is left empty.
 */
async function normalizeAndCreateRotationSchedule({
  gamePlan,
  plannedRotations,
  halfLengthMinutes,
  rotationIntervalMinutes,
  userId,
  team,
}: {
  gamePlan: import("./types").GamePlan;
  plannedRotations: import("./types").PlannedRotation[];
  halfLengthMinutes: number;
  rotationIntervalMinutes: number;
  userId: string | undefined;
  team: import("./types").Team;
}): Promise<import("./types").PlannedRotation[]> {
  const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);

  const expectedRotations: Array<{ rotationNumber: number; gameMinute: number; half: 1 | 2 }> = [];
  for (let index = 1; index <= rotationsPerHalf; index += 1) {
    expectedRotations.push({
      rotationNumber: index,
      gameMinute: index * rotationIntervalMinutes,
      half: 1,
    });
  }
  expectedRotations.push({
    rotationNumber: rotationsPerHalf + 1,
    gameMinute: halfLengthMinutes,
    half: 2,
  });
  for (let index = 1; index <= rotationsPerHalf; index += 1) {
    expectedRotations.push({
      rotationNumber: rotationsPerHalf + 1 + index,
      gameMinute: halfLengthMinutes + index * rotationIntervalMinutes,
      half: 2,
    });
  }

  const getExpectedKey = (rotation: { half?: number | null; gameMinute?: number | null }) => {
    return `${rotation.half ?? 0}:${rotation.gameMinute ?? 0}`;
  };

  const expectedByKey = new Map(
    expectedRotations.map(spec => [getExpectedKey(spec), spec])
  );
  const existingByKey = new Map<string, import("./types").PlannedRotation[]>();
  for (const rotation of plannedRotations) {
    const key = getExpectedKey(rotation);
    const bucket = existingByKey.get(key);
    if (bucket) {
      bucket.push(rotation);
    } else {
      existingByKey.set(key, [rotation]);
    }
  }

  const rowsToDelete: import("./types").PlannedRotation[] = [];
  const rowsToUpdateSchedule: Array<{ id: string; rotationNumber: number; gameMinute: number; half: 1 | 2 }> = [];
  const normalizedExistingRows: import("./types").PlannedRotation[] = [];

  for (const spec of expectedRotations) {
    const key = getExpectedKey(spec);
    const candidates = existingByKey.get(key) ?? [];
    if (candidates.length === 0) {
      continue;
    }

    const preferredMatch = candidates.find(candidate => candidate.rotationNumber === spec.rotationNumber);
    const deterministicSorted = [...candidates].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
    const rowToKeep = preferredMatch ?? deterministicSorted[0];

    normalizedExistingRows.push({
      ...rowToKeep,
      rotationNumber: spec.rotationNumber,
      gameMinute: spec.gameMinute,
      half: spec.half,
    });

    if (
      rowToKeep.rotationNumber !== spec.rotationNumber
      || rowToKeep.gameMinute !== spec.gameMinute
      || rowToKeep.half !== spec.half
    ) {
      rowsToUpdateSchedule.push({
        id: rowToKeep.id,
        rotationNumber: spec.rotationNumber,
        gameMinute: spec.gameMinute,
        half: spec.half,
      });
    }

    for (const candidate of candidates) {
      if (candidate.id !== rowToKeep.id) {
        rowsToDelete.push(candidate);
      }
    }
  }

  for (const rotation of plannedRotations) {
    const key = getExpectedKey(rotation);
    if (!expectedByKey.has(key)) {
      rowsToDelete.push(rotation);
    }
  }

  const rowsToDeleteById = new Map<string, import("./types").PlannedRotation>();
  for (const rotation of rowsToDelete) {
    rowsToDeleteById.set(rotation.id, rotation);
  }

  if (rowsToDeleteById.size > 0) {
    await Promise.all(
      Array.from(rowsToDeleteById.values()).map(rotation => client.models.PlannedRotation.delete({ id: rotation.id }))
    );
  }

  if (rowsToUpdateSchedule.length > 0) {
    await Promise.all(
      rowsToUpdateSchedule.map(update => client.models.PlannedRotation.update(update))
    );
  }

  const keptKeys = new Set(normalizedExistingRows.map(rotation => getExpectedKey(rotation)));
  const missingRotations = expectedRotations.filter(spec => !keptKeys.has(getExpectedKey(spec)));

  const allPlannedRotations = [...normalizedExistingRows];
  if (missingRotations.length > 0) {
    let coachId = userId || team.coaches?.[0];
    if (!coachId) {
      const currentUser = await getCurrentUser();
      coachId = currentUser.userId;
    }
    const createdRotations = await Promise.all(
      missingRotations.map(async spec => {
        const response = await client.models.PlannedRotation.create({
          gamePlanId: gamePlan.id,
          rotationNumber: spec.rotationNumber,
          gameMinute: spec.gameMinute,
          half: spec.half,
          plannedSubstitutions: '[]',
          coaches: [coachId],
        });
        if (!response.data) {
          throw new Error('Failed to create missing planned rotation record');
        }
        return response.data as import("./types").PlannedRotation;
      })
    );
    allPlannedRotations.push(...createdRotations.map(rotation => ({
      ...rotation,
      plannedSubstitutions: rotation.plannedSubstitutions ?? '[]',
    })));
  }
  allPlannedRotations.sort((a, b) => {
    const rotationDiff = (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0);
    if (rotationDiff !== 0) return rotationDiff;
    const minuteDiff = (a.gameMinute ?? 0) - (b.gameMinute ?? 0);
    if (minuteDiff !== 0) return minuteDiff;
    return (a.half ?? 0) - (b.half ?? 0);
  });

  return allPlannedRotations;
}

export function GameManagement({ game, team, onBack, initialTab }: GameManagementProps) {
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
  const [activeTab, setActiveTab] = useState<GameTab>(initialTab ?? "field");
  const [lineupViewMode, setLineupViewMode] = useState<LineupViewMode>("list");
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

  // Copy-from-game state
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [previousGamesWithPlans, setPreviousGamesWithPlans] = useState<PreviousGameSummary[] | null>(null);
  const [isCopyingPlan, setIsCopyingPlan] = useState(false);

  // Optimistic overlay ids pending backend confirmation (to avoid flicker on add)
  const [optimisticAddIds, setOptimisticAddIds] = useState<Set<string>>(new Set());
  // Items removed optimistically while delete RPC is in flight (by queue record id)
  const [optimisticRemoveIds, setOptimisticRemoveIds] = useState<Set<string>>(new Set());
  // Ref to store pending optimistic-add data for queue rendering before backend confirms
  const pendingOptimisticAddsRef = useRef<Map<string, SubQueue>>(new Map());

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
  const startGameInProgressRef = useRef(false);
  const startStatusRef = useRef<Game['status']>(game.status);
  const [isStartingGame, setIsStartingGame] = useState(false);
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
    queuedSubstitutions,
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

  // Merged substitution queue: backend records (FIFO) plus optimistic adds, minus optimistic removes
  const substitutionQueue = useMemo<SubQueue[]>(() => {
    // Start with backend records, filter optimistic removes
    const backendItems = queuedSubstitutions
      .filter(q => !optimisticRemoveIds.has(q.id))
      .map(q => ({
        id: q.id,
        playerId: q.playerId ?? '',
        positionId: q.positionId ?? '',
        createdAt: q.createdAt ?? undefined,
      }));

    // Add local optimistic items not yet confirmed from backend
    const backendIds = new Set(backendItems.map(q => q.id));
    const optimisticItems = Array.from(optimisticAddIds)
      .filter(id => !backendIds.has(id))
      .map(id => pendingOptimisticAddsRef.current.get(id))
      .filter((q): q is SubQueue => q != null);

    return [...backendItems, ...optimisticItems];
  }, [queuedSubstitutions, optimisticAddIds, optimisticRemoveIds]);

  // When backend confirms an add (item appears in subscription), clear from optimistic set
  useEffect(() => {
    if (optimisticAddIds.size === 0) return;
    const backendIds = new Set(queuedSubstitutions.map(q => q.id));
    const confirmedIds = Array.from(optimisticAddIds).filter(id => backendIds.has(id));
    if (confirmedIds.length === 0) return;
    setOptimisticAddIds(prev => {
      const next = new Set(prev);
      for (const id of confirmedIds) next.delete(id);
      return next;
    });
  }, [queuedSubstitutions, optimisticAddIds]);

  // When backend confirms a delete (item disappears from subscription), clear from removes set
  useEffect(() => {
    if (optimisticRemoveIds.size === 0) return;
    const backendIds = new Set(queuedSubstitutions.map(q => q.id));
    const confirmedRemovals = Array.from(optimisticRemoveIds).filter(id => !backendIds.has(id));
    if (confirmedRemovals.length === 0) return;
    setOptimisticRemoveIds(prev => {
      const next = new Set(prev);
      for (const id of confirmedRemovals) next.delete(id);
      return next;
    });
  }, [queuedSubstitutions, optimisticRemoveIds]);

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

  // View mode persistence scope is user+game and only for active lineup states.
  useEffect(() => {
    if (!userId) return;

    const supportsShape = gameState.status === "scheduled" || gameState.status === "in-progress" || gameState.status === "halftime";
    const storageKey = getLineupViewStorageKey(userId, game.id);

    if (!supportsShape) {
      localStorage.removeItem(storageKey);
      setLineupViewMode("list");
      return;
    }

    const stored = localStorage.getItem(storageKey);
    if (stored === "shape" || stored === "list") {
      setLineupViewMode(stored);
      return;
    }
    setLineupViewMode("list");
  }, [game.id, gameState.status, userId]);

  const handleLineupViewModeChange = useCallback((mode: LineupViewMode) => {
    setLineupViewMode(mode);
    if (!userId) return;
    const storageKey = getLineupViewStorageKey(userId, game.id);
    localStorage.setItem(storageKey, mode);
  }, [game.id, userId]);

  const handleResetLineupViewPreference = useCallback(() => {
    setLineupViewMode("list");
    if (!userId) return;
    const storageKey = getLineupViewStorageKey(userId, game.id);
    localStorage.removeItem(storageKey);
  }, [game.id, userId]);

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
    startStatusRef.current = gameState.status;
  }, [gameState.status]);

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

  const handleRecalculateRotations = async (options?: GenerateRotationsOptions) => {
    if (!gamePlan) return;

    if (!options?.skipConfirm) {
      const confirmed = await confirm({
        title: 'Recalculate Rotations',
        message: 'This will recalculate all rotation substitutions based on current player availability and preferred positions.\n\nExisting rotation substitutions will be overwritten.',
        confirmText: 'Recalculate',
        variant: 'warning',
      });
      if (!confirmed) return;
    }

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

      // Lineup seed priority: plannerSnapshot → saved gamePlan.startingLineup → live starters (compatibility fallback)
      let lineupArray: { playerId: string; positionId: string }[];
      if (options?.plannerSnapshot?.startingLineup && options.plannerSnapshot.startingLineup.size > 0) {
        lineupArray = Array.from(options.plannerSnapshot.startingLineup.entries())
          .map(([positionId, playerId]) => ({ positionId, playerId }))
          .filter((entry): entry is { playerId: string; positionId: string } => {
            const status = getPlayerAvailability(entry.playerId);
            return Boolean(entry.playerId) && (status === 'available' || status === 'late-arrival');
          });
      } else {
        // Try gamePlan.startingLineup; fall through to live starters if empty or unparseable.
        // For in-progress/halftime games, skip the plan snapshot and use live starters so future
        // rotations are calculated from the actual current field state.
        let lineupFromPlan: { playerId: string; positionId: string }[] | null = null;
        if (gamePlan.startingLineup && gameState.status === 'scheduled') {
          try {
            const sl = JSON.parse(gamePlan.startingLineup as string) as Array<{ playerId: string; positionId: string }>;
            const filtered = sl.filter((entry): entry is { playerId: string; positionId: string } => {
              const status = getPlayerAvailability(entry.playerId);
              return Boolean(entry.playerId) && (status === 'available' || status === 'late-arrival') && entry.positionId != null;
            });
            if (filtered.length > 0) lineupFromPlan = filtered;
          } catch {
            // Ignore parse errors; fall through to live starters.
          }
        }

        if (lineupFromPlan && lineupFromPlan.length > 0) {
          lineupArray = lineupFromPlan;
        } else {
          const liveStarters = lineup.filter(l => l.isStarter);
          lineupArray = liveStarters
            .map(l => ({ playerId: l.playerId, positionId: l.positionId }))
            .filter((entry): entry is { playerId: string; positionId: string } => {
              const status = getPlayerAvailability(entry.playerId);
              return (status === 'available' || status === 'late-arrival') && entry.positionId != null;
            });
        }
      }

      if (lineupArray.length === 0) {
        showWarning('No available players in the starting lineup. Adjust the lineup in the Game Planner first.');
        setIsRecalculating(false);
        return;
      }

      const halfLengthMinutes = options?.plannerSnapshot?.halfLengthMinutes ?? (gameState.halfLengthMinutes ?? team.halfLengthMinutes ?? 30);
      const rotationIntervalMinutes = options?.plannerSnapshot?.rotationIntervalMinutes ?? (gamePlan.rotationIntervalMinutes || 10);
      const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);

      // Phase A: normalize schedule rows and create any missing ones
      const allPlannedRotations = await normalizeAndCreateRotationSchedule({
        gamePlan,
        plannedRotations,
        halfLengthMinutes,
        rotationIntervalMinutes,
        userId,
        team,
      });

      // Phase B: compute fair substitutions and write them to future rotations
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

      const currentMinutes = Math.floor(currentTime / 60);
      const isLiveGame = gameState.status === 'in-progress' || gameState.status === 'halftime';

      // For live games (in-progress/halftime), only pass FUTURE rotation slots to the algorithm.
      // Passing all slots (including past) creates invalid plans: the algorithm builds each
      // rotation on its simulated previous state, which drifts from the actual field after any
      // manual substitutions. Future rotations then reference players the algorithm thinks are
      // on the bench but who are actually on the field.
      // For scheduled games we generate all rotations but only write future slots (old behaviour).
      //
      // Grace window: RotationWidget shows rotations within 2 minutes of the current game time
      // (gameMinute >= currentMinutes - 2) so a slightly-past rotation stays actionable for the
      // coach. Recalculate must cover the same window — otherwise a stale rotation sitting in the
      // grace period never gets updated and keeps showing the same conflict even after recalculate.
      const RECALC_GRACE_MINUTES = 2;
      const rotationsToGenerate = isLiveGame
        ? allPlannedRotations.filter(r => r.gameMinute >= currentMinutes - RECALC_GRACE_MINUTES)
        : allPlannedRotations;

      // Compute the effective rotationsPerHalf for the subset being generated.
      // If halftime is still future, count first-half future slots (gameMinute < halfLengthMinutes).
      // If halftime already passed (all future rotations are in half 2), pass -1 so the algorithm
      // treats every generated rotation as a second-half rotation with no halftime transition.
      let effectiveRotationsPerHalf = rotationsPerHalf;
      if (isLiveGame) {
        const halfInFuture = rotationsToGenerate.some(r => r.gameMinute === halfLengthMinutes);
        effectiveRotationsPerHalf = halfInFuture
          ? rotationsToGenerate.filter(r => r.gameMinute < halfLengthMinutes).length
          : -1;
      }

      // Resolve halftime lineup from plannerSnapshot when provided.
      // This preserves explicit coach overrides (e.g. a goalie swap at halftime) so the
      // algorithm generates second-half rotations from the correct baseline instead of
      // auto-computing the halftime transition and ignoring the override.
      const halftimeLineupForAlgorithm: Array<{ playerId: string; positionId: string }> | undefined =
        options?.plannerSnapshot?.halftimeLineup && options.plannerSnapshot.halftimeLineup.size > 0
          ? Array.from(options.plannerSnapshot.halftimeLineup.entries())
              .filter(([, playerId]) => Boolean(playerId))
              .map(([positionId, playerId]) => ({ positionId, playerId }))
          : undefined;

      const { rotations: generatedRotations } = calculateFairRotations(
        availableRoster,
        lineupArray,
        rotationsToGenerate.length,
        effectiveRotationsPerHalf,
        team.maxPlayersOnField || positions.length,
        goaliePositionId,
        halftimeLineupForAlgorithm,
        { rotationIntervalMinutes, halfLengthMinutes, positions, playerAvailabilities, initialPlayTimeMinutes },
      );

      // Write generated substitutions to the target rotation slots.
      // For live games, rotationsToGenerate is already the grace-window set; use direct indexing.
      // For scheduled games, allPlannedRotations was passed to the algorithm so we index by
      // position in that full array, but only update future slots (strict > currentMinutes).
      const updates = (isLiveGame ? rotationsToGenerate : allPlannedRotations)
        .map((rotation, index) => ({ rotation, generatedIndex: index }))
        .filter(({ rotation }) =>
          isLiveGame
            ? rotation.gameMinute >= currentMinutes - RECALC_GRACE_MINUTES
            : rotation.gameMinute > currentMinutes
        )
        .map(({ rotation, generatedIndex }) => {
          return client.models.PlannedRotation.update({
            id: rotation.id,
            plannedSubstitutions: JSON.stringify(generatedRotations[generatedIndex]?.substitutions || []),
          });
        });

      await Promise.all(updates);

      showSuccess('Rotations recalculated based on current availability! Review each rotation to verify.');      trackEvent(AnalyticsEvents.ROTATION_RECALCULATED.category, AnalyticsEvents.ROTATION_RECALCULATED.action);    } catch (error) {
      handleApiError(error, 'Failed to recalculate rotations');
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleEnsureRotationSchedule = async (input: { halfLengthMinutes: number; rotationIntervalMinutes: number }) => {
    if (gameState.status !== 'scheduled') return;
    // Use existing gamePlan or fetch a fresh one to handle stale-subscription race after first save.
    let activePlan = gamePlan;
    if (!activePlan) {
      try {
        const result = await client.models.GamePlan.list({ filter: { gameId: { eq: game.id } } });
        activePlan = (result.data?.[0] ?? null) as import('./types').GamePlan | null;
      } catch {
        // Could not fetch; nothing to reconcile.
      }
    }
    if (!activePlan) return;
    try {
      await normalizeAndCreateRotationSchedule({
        gamePlan: activePlan,
        plannedRotations,
        halfLengthMinutes: input.halfLengthMinutes,
        rotationIntervalMinutes: input.rotationIntervalMinutes,
        userId,
        team,
      });
    } catch (error) {
      handleApiError(error, 'Failed to update rotation schedule');
    }
  };

  const handleOpenCopyModal = useCallback(async () => {
    if (gameState.status !== 'scheduled') return;
    setPreviousGamesWithPlans(null); // null = loading state
    setIsCopyModalOpen(true);
    try {
      const [gamesResult, plansResult] = await Promise.all([
        client.models.Game.list({ filter: { teamId: { eq: team.id } } }),
        client.models.GamePlan.list(),
      ]);
      // Filter plans to only those whose gameId belongs to this team's games
      const teamGameIds = new Set(gamesResult.data.map(g => g.id));
      const planGameIds = new Set(
        plansResult.data
          .filter(p => teamGameIds.has(p.gameId as string))
          .map(p => p.gameId as string)
      );
      const previous = gamesResult.data
        .filter(g => g.id !== game.id && planGameIds.has(g.id))
        .sort((a, b) => {
          const da = a.gameDate ? new Date(a.gameDate as string).getTime() : 0;
          const db = b.gameDate ? new Date(b.gameDate as string).getTime() : 0;
          return db - da; // most recent first
        })
        .map(g => ({
          id: g.id,
          opponent: g.opponent as string,
          gameDate: (g.gameDate as string | null | undefined) ?? null,
        }));
      setPreviousGamesWithPlans(previous);
    } catch (error) {
      handleApiError(error, 'Failed to load previous games');
      setIsCopyModalOpen(false);
    }
  }, [gameState.status, team.id, game.id]);

  const handleCopyFromGame = useCallback(async (sourceGameId: string) => {
    if (gameState.status !== 'scheduled') return;
    setIsCopyingPlan(true);
    try {
      if (gamePlan) {
        const confirmed = await confirm({
          title: 'Replace Existing Plan?',
          message: 'This will overwrite your current game plan and all rotations. This cannot be undone.',
          confirmText: 'Replace',
          variant: 'warning',
        });
        if (!confirmed) {
          return;
        }
        const existingRotationsResult = await client.models.PlannedRotation.list({
          filter: { gamePlanId: { eq: gamePlan.id } },
        });
        await Promise.all(
          existingRotationsResult.data.map(r => client.models.PlannedRotation.delete({ id: r.id }))
        );
        await client.models.GamePlan.delete({ id: gamePlan.id });
      }

      let coachId = userId || (team.coaches as string[])?.[0];
      if (!coachId) {
        const currentUser = await getCurrentUser();
        coachId = currentUser.userId;
      }
      const coaches = coachId ? [coachId] : [];

      const newPlan = await copyGamePlan(sourceGameId, game.id, coaches);
      if (!newPlan) {
        showError('No plan found on the selected game.');
        return;
      }

      // Confirm the new plan exists in DynamoDB before closing modal
      let writeConfirmed = false;
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 400));
        const check = await client.models.GamePlan.list({
          filter: { gameId: { eq: game.id } },
        });
        if (check.data.some(p => p.id === newPlan.id)) {
          writeConfirmed = true;
          break;
        }
      }
      if (!writeConfirmed) {
        showError('Plan was copied but may not have loaded yet. Please refresh.');
        return;
      }

      trackEvent(AnalyticsEvents.COPY_PLAN_FROM_GAME.category, AnalyticsEvents.COPY_PLAN_FROM_GAME.action);
      showSuccess('Plan copied successfully!');
      setIsCopyModalOpen(false);
    } catch (error) {
      handleApiError(error, 'Failed to copy game plan');
    } finally {
      setIsCopyingPlan(false);
    }
  }, [gameState.status, gamePlan, game.id, team.coaches, userId, confirm]);

  const handleOpenEditGame = useCallback(() => {
    setEditGameOpponent(game.opponent ?? '');
    setEditGameDate(isoToDatetimeLocal(game.gameDate));
    setEditGameIsHome(game.isHome ?? true);
    setIsEditingGame(true);
  }, [game]);

  const handleHalfLengthChange = useCallback(async (minutes: number) => {
    if (gameState.status !== 'scheduled') return;
    const clamped = Math.max(1, Math.min(99, minutes));
    try {
      await mutations.updateGame(game.id, { halfLengthMinutes: clamped });
    } catch (error) {
      handleApiError(error, 'Failed to update half length');
    }
  }, [gameState.status, game.id, mutations]);

  const handleIntervalChange = useCallback(async () => {
    if (gameState.status !== 'scheduled') return;
    // Rotation interval persistence is managed by the useGamePlanner hook inside PlanTab.
  }, [gameState.status]);

  const handleUpdatePlannedRotations = useCallback(async (
    input: PlannedRotationsUpdateInput
  ): Promise<PlannerMutationResult> => {
    const computeFingerprintFor = (rotations: PlannedRotation[]) => computeRevisionFingerprint(
      {
        startingLineup: gamePlan?.startingLineup as string | null | undefined,
        halftimeLineup: gamePlan?.halftimeLineup as string | null | undefined,
        rotationIntervalMinutes: gamePlan?.rotationIntervalMinutes,
      },
      rotations
    );

    const currentFingerprint = computeFingerprintFor(plannedRotations);

    if (gameState.status !== 'scheduled' || !gamePlan?.id) {
      return {
        status: 'conflict',
        serverFingerprint: currentFingerprint,
        conflictReason: 'Planner is no longer editable in the current game state.',
      };
    }

    if (input.expectedFingerprint !== currentFingerprint) {
      return {
        status: 'conflict',
        serverFingerprint: currentFingerprint,
        conflictReason: 'Plan changed remotely. Refresh and re-apply your edits.',
      };
    }

    try {
      const { operations } = computeRotationDiff(plannedRotations, input.plannedRotations);
      const scopedOperations = orderPlannerOperationsForSaferApply(
        filterScopedDeletes(operations, gamePlan.id)
      );

      const getRotationKey = (rotation: Pick<PlannedRotation, 'half' | 'gameMinute'>): string => {
        return `${rotation.half}:${rotation.gameMinute}`;
      };

      const applyOperationToRows = (
        rows: PlannedRotation[],
        operation: RotationDiffOperation
      ): PlannedRotation[] => {
        if (operation.action === 'delete' && operation.current) {
          const keyToDelete = getRotationKey(operation.current);
          return rows.filter((row) => getRotationKey(row) !== keyToDelete);
        }

        if (operation.action === 'update' && operation.current && operation.desired) {
          const keyToUpdate = getRotationKey(operation.current);
          const next = rows.map((row) => {
            if (getRotationKey(row) !== keyToUpdate) {
              return row;
            }
            return {
              ...row,
              plannedSubstitutions: operation.desired?.plannedSubstitutions ?? row.plannedSubstitutions,
            };
          });
          return next;
        }

        if (operation.action === 'create' && operation.desired) {
          const createKey = getRotationKey(operation.desired);
          const withoutExisting = rows.filter((row) => getRotationKey(row) !== createKey);
          return [...withoutExisting, operation.desired];
        }

        return rows;
      };

      const readCurrentPlanState = async () => {
        const { data } = await client.models.PlannedRotation.list({
          filter: { gamePlanId: { eq: gamePlan.id } },
        });
        const rows = [...data].sort((a, b) => {
          const byRotation = (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0);
          if (byRotation !== 0) return byRotation;
          return (a.gameMinute ?? 0) - (b.gameMinute ?? 0);
        });
        return {
          rows,
          fingerprint: computeFingerprintFor(rows),
        };
      };

      // NOTE: Amplify's generated model APIs do not provide a cross-record transaction
      // for this write set. To fail closed under concurrent edits, re-check before each
      // write against the expected intermediate fingerprint and abort immediately on drift.
      const ensureExpectedFingerprint = async (expectedFingerprint: string): Promise<{
        ok: boolean;
        fingerprint: string;
      }> => {
        const latest = await readCurrentPlanState();
        return {
          ok: latest.fingerprint === expectedFingerprint,
          fingerprint: latest.fingerprint,
        };
      };

        let coachId = userId || team.coaches?.[0];
      if (!coachId) {
        const currentUser = await getCurrentUser();
        coachId = currentUser.userId;
      }

      let expectedRows = [...plannedRotations];
      let expectedFingerprint = input.expectedFingerprint;

      for (const operation of scopedOperations) {
        const preWrite = await ensureExpectedFingerprint(expectedFingerprint);
        if (!preWrite.ok) {
          return {
            status: 'conflict',
            serverFingerprint: preWrite.fingerprint,
            conflictReason: 'Plan changed while saving. No further edits were applied.',
          };
        }

        if (operation.action === 'delete' && operation.current?.id) {
          await client.models.PlannedRotation.delete({ id: operation.current.id });
        } else if (operation.action === 'update' && operation.current?.id && operation.desired) {
          await client.models.PlannedRotation.update({
            id: operation.current.id,
            plannedSubstitutions: operation.desired.plannedSubstitutions,
          });
        } else if (operation.action === 'create' && operation.desired) {
          await client.models.PlannedRotation.create({
            gamePlanId: gamePlan.id,
            rotationNumber: operation.desired.rotationNumber,
            gameMinute: operation.desired.gameMinute,
            half: operation.desired.half,
            plannedSubstitutions: operation.desired.plannedSubstitutions,
            coaches: [coachId],
          });
        }

        expectedRows = applyOperationToRows(expectedRows, operation);
        expectedFingerprint = computeFingerprintFor(expectedRows);
      }

      const latestAfterWrite = await readCurrentPlanState();

      return {
        status: 'ok',
        serverFingerprint: latestAfterWrite.fingerprint,
      };
    } catch (error) {
      handleApiError(error, 'Failed to update planned rotations');
      let latestFingerprint = currentFingerprint;
      try {
        const { data } = await client.models.PlannedRotation.list({
          filter: { gamePlanId: { eq: gamePlan.id } },
        });
        latestFingerprint = computeFingerprintFor(data);
      } catch {
        // Keep currentFingerprint fallback when follow-up read fails.
      }
      return {
        status: 'conflict',
        serverFingerprint: latestFingerprint,
        conflictReason: 'Unable to save rotation changes right now. Try again.',
      };
    }
    }, [gamePlan, gameState.status, plannedRotations, userId, team.coaches]);

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
    if (startGameInProgressRef.current || isStartingGame) {
      return;
    }

    if (startStatusRef.current !== 'scheduled') {
      return;
    }

    startGameInProgressRef.current = true;
    setIsStartingGame(true);

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
      if (!proceed) {
        setIsStartingGame(false);
        startGameInProgressRef.current = false;
        return;
      }
    }

    try {
      const latestGame = await client.models.Game.get({ id: game.id });
      const latestStatus = latestGame.data?.status;
      if (latestStatus && latestStatus !== 'scheduled') {
        startStatusRef.current = latestStatus;
        return;
      }

      const resolvedLocalStarters = lineup.filter(
        (l): l is typeof l & { playerId: string; positionId: string } =>
          l.isStarter && !!l.playerId && !!l.positionId
      );
      const resolvedLocalStarterCount = resolvedLocalStarters.length;
      const expectedStarterCount = team.maxPlayersOnField ?? resolvedLocalStarterCount;

      let starters: StarterSelection[] = resolvedLocalStarters.map((starter) => ({
        playerId: starter.playerId,
        positionId: starter.positionId,
      }));

      if (resolvedLocalStarterCount < expectedStarterCount) {
        const plannedStarters = parsePersistedStarterLineup(
          (gamePlan?.startingLineup as string | null | undefined) ?? null,
          getPlayerAvailability,
        );

        if (plannedStarters.length > starters.length) {
          starters = plannedStarters;
        }
      }

      if (starters.length < expectedStarterCount) {
        const fallbackAssignments = await client.models.LineupAssignment.list({
          filter: {
            gameId: { eq: game.id },
            isStarter: { eq: true },
          },
        });

        const dbStarters = fallbackAssignments.data.filter(
          (l): l is typeof l & { playerId: string; positionId: string } => !!l.playerId && !!l.positionId
        ).map((starter) => ({
          playerId: starter.playerId,
          positionId: starter.positionId,
        }));

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

      const persistedStart = await client.models.Game.get({ id: game.id });
      const persistedLastStartTime = persistedStart.data?.lastStartTime ?? null;
      const anotherClientWon =
        persistedStart.data?.status === 'in-progress'
        && typeof persistedLastStartTime === 'string'
        && persistedLastStartTime.length > 0
        && persistedLastStartTime !== startTime;
      if (anotherClientWon) {
        startStatusRef.current = persistedStart.data?.status ?? 'in-progress';
        showWarning('This game was started from another client. Refreshing live state.');
        return;
      }

      const starterPromises = starters.map(l =>
        mutations.createPlayTimeRecord({
          id: buildDeterministicStartPlayTimeRecordId({
            gameId: game.id,
            playerId: l.playerId,
            half: 1,
            startGameSeconds: currentTime,
          }),
          gameId: game.id,
          playerId: l.playerId,
          positionId: l.positionId,
          startGameSeconds: currentTime,
          coaches: team.coaches,
        })
      );

      await Promise.all(starterPromises);

      startStatusRef.current = 'in-progress';
      setGameState({ ...gameState, status: 'in-progress' });
      setIsRunning(true);
      trackEvent(AnalyticsEvents.GAME_STARTED.category, AnalyticsEvents.GAME_STARTED.action);
    } catch (error) {
      handleApiError(
        error,
        isStarterCountError(error) ? error.userMessage : 'Failed to start game'
      );
    } finally {
      setIsStartingGame(false);
      startGameInProgressRef.current = false;
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

      let starters: StarterSelection[] = resolvedLocalStarters.map((starter) => ({
        playerId: starter.playerId,
        positionId: starter.positionId,
      }));

      if (resolvedLocalStarterCount < expectedStarterCount) {
        const plannedSecondHalfStarters = parsePersistedStarterLineup(
          (gamePlan?.halftimeLineup as string | null | undefined)
          || (gamePlan?.startingLineup as string | null | undefined)
          || null,
          getPlayerAvailability,
        );

        if (plannedSecondHalfStarters.length > starters.length) {
          starters = plannedSecondHalfStarters;
        }
      }

      if (starters.length < expectedStarterCount) {
        const fallbackAssignments = await client.models.LineupAssignment.list({
          filter: {
            gameId: { eq: game.id },
            isStarter: { eq: true },
          },
        });

        const dbStarters = fallbackAssignments.data.filter(
          (l): l is typeof l & { playerId: string; positionId: string } => !!l.playerId && !!l.positionId
        ).map((starter) => ({
          playerId: starter.playerId,
          positionId: starter.positionId,
        }));

        if (dbStarters.length > resolvedLocalStarters.length) {
          starters = dbStarters;
        }
      }

      if (starters.length < expectedStarterCount) {
        throw new StarterCountError('handleStartSecondHalf', expectedStarterCount, starters.length);
      }
      
      const starterPromises = starters.map(l => {
        return mutations.createPlayTimeRecord({
          id: buildDeterministicStartPlayTimeRecordId({
            gameId: game.id,
            playerId: l.playerId,
            half: 2,
            startGameSeconds: resumeTime,
          }),
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

  // Reset tab when game status changes.
  // scheduled → stay/go to 'plan' (no live data needed)
  // in-progress / halftime → auto-switch from 'plan' to 'field' on transition; keep other tabs
  // completed → reset to 'field' (no tab nav shown, but keep state clean)
  useEffect(() => {
    if (gameState.status === 'scheduled') {
      setActiveTab('plan');
    } else if (gameState.status === 'in-progress' || gameState.status === 'halftime') {
      setActiveTab(prev => prev === 'plan' ? 'field' : prev);
    } else {
      setActiveTab('field');
    }
  }, [gameState.status]);

  // Clean up shared queue when game completes (delete any remaining queued substitutions)
  useEffect(() => {
    if (gameState.status !== 'completed') return;
    if (queuedSubstitutions.length === 0) return;

    for (const item of queuedSubstitutions) {
      void mutations.deleteQueuedSubstitution(item.id).catch((err) => {
        console.warn('[GameManagement] Failed to clean up queued substitution on completion:', err);
      });
    }
  // Only run when status transitions to 'completed'
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Duplicate check against merged queue
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

    // Generate deterministic id for this enqueue (game+player uniqueness)
    const newId = crypto.randomUUID();
    const newItem: SubQueue = { id: newId, playerId, positionId, createdAt: new Date().toISOString() };

    // Optimistic add
    pendingOptimisticAddsRef.current.set(newId, newItem);
    setOptimisticAddIds(prev => new Set([...prev, newId]));

    // Persist to backend; on failure, roll back optimistic add
    void mutations.createQueuedSubstitution({
      id: newId,
      gameId: game.id,
      playerId,
      positionId,
      coaches: team.coaches,
    }).catch((error) => {
      pendingOptimisticAddsRef.current.delete(newId);
      setOptimisticAddIds(prev => { const next = new Set(prev); next.delete(newId); return next; });
      handleApiError(error, 'Failed to queue substitution');
    });
  };

  const handleRemoveFromQueue = useCallback((queueId: string) => {
    // Optimistic remove
    setOptimisticRemoveIds(prev => new Set([...prev, queueId]));
    pendingOptimisticAddsRef.current.delete(queueId);

    void mutations.deleteQueuedSubstitution(queueId).catch((error) => {
      // Rollback optimistic remove on failure
      setOptimisticRemoveIds(prev => { const next = new Set(prev); next.delete(queueId); return next; });
      handleApiError(error, 'Failed to remove from substitution queue');
    });
  }, [mutations]);

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

  const handleAddTestTime = useCallback((minutes: number) => {
    setCurrentTime((previousTime) => {
      const newTime = previousTime + minutes * 60;
      resetAnchor(newTime);
      return newTime;
    });
  }, [resetAnchor]);

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
    currentUserId: userId,
    viewMode: lineupViewMode,
    onViewModeChange: handleLineupViewModeChange,
    onResetViewPreference: handleResetLineupViewPreference,
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
          onStartGame={handleStartGame}
          isStartPending={isStartingGame}
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
          onQueueAdd={handleQueueSubstitution}
          onQueueRemove={handleRemoveFromQueue}
          substitutionRequest={substitutionRequest}
          onSubstitutionRequestHandled={() => setSubstitutionRequest(null)}
          mutations={mutations}
        />

        {/* ── PRE-GAME ─────────────────────────────────────────────── */}
        {gameState.status === 'scheduled' && (
          <>
            <OfflineBanner isOnline={isOnline} pendingCount={pendingMutationCount} isSyncing={isSyncing} />
            <TabNav
              activeTab={activeTab}
              onTabChange={setActiveTab}
              substitutionQueueCount={substitutionQueue.length}
              tabPanelIdPrefix="game-tab-panel"
            />

            {activeTab === 'plan' && (
              <div
                className="pregame-layout game-tab-content game-tab-content--page-scroll"
                role="tabpanel"
                id="game-tab-panel-plan"
                aria-labelledby="game-tab-panel-tab-plan"
                tabIndex={0}
              >
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

                <PlanTab
                  readOnly={false}
                  gamePlan={gamePlan}
                  plannedRotations={plannedRotations}
                  planConflicts={getPlanConflicts()}
                  isRecalculating={isRecalculating}
                  onRecalculateRotations={handleRecalculateRotations}
                  onHalfLengthChange={handleHalfLengthChange}
                  onIntervalChange={handleIntervalChange}
                  onGenerateRotations={handleRecalculateRotations}
                  onEnsureRotationSchedule={handleEnsureRotationSchedule}
                  onUpdatePlannedRotations={handleUpdatePlannedRotations}
                  isCopyModalOpen={isCopyModalOpen}
                  previousGamesWithPlans={previousGamesWithPlans ?? undefined}
                  onOpenCopyModal={handleOpenCopyModal}
                  onCloseCopyModal={() => setIsCopyModalOpen(false)}
                  onCopyFromGame={handleCopyFromGame}
                  isCopyingPlan={isCopyingPlan}
                  {...sharedLineupPanelProps}
                />

                {!isEditingGame && (
                  <div className="pregame-start-cta">
                    <button onClick={handleStartGame} className="btn-primary btn-large" disabled={isStartingGame}>
                      {isStartingGame ? 'Starting...' : 'Start Game'}
                    </button>
                  </div>
                )}

                {!isEditingGame && deleteGameButton}
              </div>
            )}

            {activeTab === 'field' && (
              <div
                className="field-tab game-tab-content game-tab-content--page-scroll"
                role="tabpanel"
                id="game-tab-panel-field"
                aria-labelledby="game-tab-panel-tab-field"
                tabIndex={0}
              >
                <LineupPanel
                  {...sharedLineupPanelProps}
                  hideAvailablePlayers={true}
                />
              </div>
            )}

            {activeTab === 'bench' && (
              <div
                className="game-tab-content"
                role="tabpanel"
                id="game-tab-panel-bench"
                aria-labelledby="game-tab-panel-tab-bench"
                tabIndex={0}
              >
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
                  onSelectPlayer={() => undefined}
                />
              </div>
            )}

            {activeTab === 'goals' && (
              <div
                className="game-tab-content"
                role="tabpanel"
                id="game-tab-panel-goals"
                aria-labelledby="game-tab-panel-tab-goals"
                tabIndex={0}
              >
                <GoalTracker {...sharedGoalTrackerProps} />
              </div>
            )}

            {activeTab === 'notes' && (
              <div
                className="game-tab-content"
                role="tabpanel"
                id="game-tab-panel-notes"
                aria-labelledby="game-tab-panel-tab-notes"
                tabIndex={0}
              >
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
          </>
        )}

        {/* ── IN-PROGRESS ──────────────────────────────────────────── */}
        {gameState.status === 'in-progress' && (
          <>
            <OfflineBanner isOnline={isOnline} pendingCount={pendingMutationCount} isSyncing={isSyncing} />
            <TabNav
              activeTab={activeTab}
              onTabChange={setActiveTab}
              substitutionQueueCount={substitutionQueue.length}
              tabPanelIdPrefix="game-tab-panel"
            />

            {activeTab === 'plan' && (
              <div
                className="game-tab-content"
                role="tabpanel"
                id="game-tab-panel-plan"
                aria-labelledby="game-tab-panel-tab-plan"
                tabIndex={0}
              >
                <PlanTab
                  readOnly={true}
                  gamePlan={gamePlan}
                  plannedRotations={plannedRotations}
                  planConflicts={getPlanConflicts()}
                  isRecalculating={isRecalculating}
                  onRecalculateRotations={handleRecalculateRotations}
                  {...sharedLineupPanelProps}
                />
              </div>
            )}

            {activeTab === 'field' && (
              <div
                className="field-tab game-tab-content game-tab-content--page-scroll"
                role="tabpanel"
                id="game-tab-panel-field"
                aria-labelledby="game-tab-panel-tab-field"
                tabIndex={0}
              >
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
              <div
                className="game-tab-content"
                role="tabpanel"
                id="game-tab-panel-bench"
                aria-labelledby="game-tab-panel-tab-bench"
                tabIndex={0}
              >
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
              </div>
            )}

            {activeTab === 'goals' && (
              <div
                className="game-tab-content"
                role="tabpanel"
                id="game-tab-panel-goals"
                aria-labelledby="game-tab-panel-tab-goals"
                tabIndex={0}
              >
                <GoalTracker {...sharedGoalTrackerProps} />
              </div>
            )}

            {activeTab === 'notes' && (
              <div
                className="game-tab-content"
                role="tabpanel"
                id="game-tab-panel-notes"
                aria-labelledby="game-tab-panel-tab-notes"
                tabIndex={0}
              />
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
            ((gameState.status === 'scheduled' || gameState.status === 'in-progress') && activeTab === 'notes')
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
