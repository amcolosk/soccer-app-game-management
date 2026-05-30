import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { PlayerAvailabilityGrid } from "../PlayerAvailabilityGrid";
import { PlannerLineupView } from "./PlannerLineupView";
import { useGamePlanner } from "./hooks/useGamePlanner";
import { useConfirm } from "../ConfirmModal";
import { generateCanonicalKey } from "../../utils/plannerKeyUtils";
import { calculatePlayTime } from "../../services/rotationPlannerService";
import type { PlannedSubstitution } from "../../services/rotationPlannerService";
import { buildRotationTimelineItems, reconcileSelectionKey } from "../../utils/gamePlannerTimeline";
import type { RotationTimelineItem } from "../../utils/gamePlannerTimeline";
import {
  applyRotationEditWithSameHalfCascade,
  computeLineupAtRotation,
  computeLineupDiff,
} from "../../utils/gamePlannerUtils";
import { exportRotationPlanLocally } from "./shape/exportRotationPlan";
import type { RotationPlanColumn } from "./shape/exportRotationPlan";
import {
  mergeHalftimeLineup,
  deriveExplicitOverrides,
  projectHalftimeRotation,
} from "../../utils/halftimeProjectionUtils";
import type {
  Game,
  Team,
  PlayerWithRoster,
  FormationPosition,
  LineupAssignment,
  PlayTimeRecord,
  GamePlan,
  PlannedRotation,
} from "./types";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";

interface PlanConflict {
  playerId: string;
  playerName: string;
  status: string;
  type: 'starter' | 'rotation' | 'on-field';
  rotationNumbers: number[];
}

export interface PlannedRotationsUpdateInput {
  expectedFingerprint: string;
  plannedRotations: PlannedRotation[];
}

export interface PlannerMutationResult {
  status: "ok" | "conflict";
  serverFingerprint: string;
  conflictReason?: string;
}

export interface PreviousGameSummary {
  id: string;
  opponent: string;
  gameDate: string | null;
}

export interface GenerateRotationsOptions {
  skipConfirm?: boolean;
  plannerSnapshot?: { startingLineup: Map<string, string>; halftimeLineup?: Map<string, string>; halfLengthMinutes: number; rotationIntervalMinutes: number };
}

function applyUniqueAssignment(
  baseLineup: Map<string, string>,
  positionId: string,
  playerId: string
): Map<string, string> {
  const next = new Map(baseLineup);

  if (!playerId) {
    next.delete(positionId);
    return next;
  }

  const currentAtTarget = next.get(positionId);
  const existingPositions: string[] = [];
  for (const [posId, assignedId] of next.entries()) {
    if (assignedId === playerId && posId !== positionId) {
      existingPositions.push(posId);
    }
  }

  for (const posId of existingPositions) {
    next.delete(posId);
  }

  if (existingPositions.length > 0 && currentAtTarget && currentAtTarget !== playerId) {
    next.set(existingPositions[0], currentAtTarget);
  }

  next.set(positionId, playerId);
  return next;
}

interface PlanTabProps {
  /** When true, hides availability grid and mutation controls (for in-progress/halftime viewing). */
  readOnly: boolean;
  gamePlan: GamePlan | null;
  plannedRotations?: PlannedRotation[];
  planConflicts: PlanConflict[];
  isRecalculating: boolean;
  onRecalculateRotations: () => void;
  // Forwarded to PlayerAvailabilityGrid
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  onSubstitute: (position: FormationPosition) => void;
  mutations: GameMutationInput;
  currentUserId?: string;
  viewMode?: "list" | "shape";
  onViewModeChange?: (mode: "list" | "shape") => void;
  onResetViewPreference?: () => void;
  /** Called when half length changes; GameManagement persists to Game record. Scheduled only. */
  onHalfLengthChange?: (minutes: number) => Promise<void>;
  /** Called when rotation interval changes; optional parent notification. */
  onIntervalChange?: (minutes: number) => Promise<void>;
  /** External halftime lineup override (Map<positionId, playerId>). Falls back to planner draft. */
  halftimeLineup?: Map<string, string>;
  /** External handler for halftime lineup changes. Falls back to planner.updateHalftimeLineup. */
  onHalftimeLineupChange?: (lineup: Map<string, string>) => Promise<void>;
  /** Calls calculateFairRotations and persists PlannedRotations. Status-gated in parent. Scheduled only. */
  onGenerateRotations?: (options?: GenerateRotationsOptions) => void | Promise<void>;
  /** Reconciles rotation schedule rows without computing substitutions. Scheduled only. */
  onEnsureRotationSchedule?: (input: { halfLengthMinutes: number; rotationIntervalMinutes: number }) => Promise<void>;
  /** Canonical parent-owned PlannedRotation mutation entrypoint with precondition check. */
  onUpdatePlannedRotations?: (input: PlannedRotationsUpdateInput) => Promise<PlannerMutationResult>;
  /** Previous games that have a saved plan (for copy feature). undefined = loading, [] = none found. Scheduled only. */
  previousGamesWithPlans?: PreviousGameSummary[];
  isCopyModalOpen?: boolean;
  onOpenCopyModal?: () => void;
  onCloseCopyModal?: () => void;
  onCopyFromGame?: (sourceGameId: string) => Promise<void>;
  isCopyingPlan?: boolean;
}

export function PlanTab({
  readOnly,
  gamePlan,
  plannedRotations = [],
  planConflicts,
  isRecalculating,
  onRecalculateRotations,
  gameState,
  game,
  team,
  players,
  positions,
  lineup,
  viewMode,
  onViewModeChange,
  onHalfLengthChange,
  onIntervalChange,
  halftimeLineup: externalHalftimeLineup,
  onHalftimeLineupChange: externalOnHalftimeLineupChange,
  onGenerateRotations,
  onEnsureRotationSchedule,
  onUpdatePlannedRotations,
  previousGamesWithPlans,
  isCopyModalOpen = false,
  onOpenCopyModal,
  onCloseCopyModal,
  onCopyFromGame,
  isCopyingPlan = false,
}: PlanTabProps) {
  const lineupPlayerIds = lineup.filter(l => l.isStarter).map(l => l.playerId);
  const isScheduled = game.status === "scheduled";

  const startingLineupAssignments = useMemo(
    () => lineup.filter(l => l.isStarter),
    [lineup]
  );

  const planner = useGamePlanner(game, team, gamePlan, plannedRotations, startingLineupAssignments);
  const confirm = useConfirm();

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ State Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [rotationConflictMessage, setRotationConflictMessage] = useState<string | null>(null);
  const [rotationErrorMessage, setRotationErrorMessage] = useState<string | null>(null);
  const [cascadeAffectedLabels, setCascadeAffectedLabels] = useState<string[] | null>(null);
  const [localRotationOverrides, setLocalRotationOverrides] = useState<Map<string, PlannedRotation>>(new Map());

  const derivedHalfLength = (gameState.halfLengthMinutes ?? team.halfLengthMinutes) || 30;
  const [halfLengthInput, setHalfLengthInput] = useState<number>(derivedHalfLength);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Refs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const selectedPillRef = useRef<HTMLButtonElement>(null);
  const timelineItemsRef = useRef<RotationTimelineItem[]>([]);
  const rotationSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRotationPayloadRef = useRef<{ rotations: PlannedRotation[]; fingerprint: string; changedNumbers: number[] } | null>(null);
  const pendingAfterInflightRef = useRef<{ rotations: PlannedRotation[]; fingerprint: string; changedNumbers: number[] } | null>(null);
  const rotationWriteInflightRef = useRef(false);
  const cascadeIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const halfLengthEditingRef = useRef(false);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Sync half-length from subscription Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!halfLengthEditingRef.current) {
      setHalfLengthInput(derivedHalfLength);
    }
  }, [derivedHalfLength]);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Effective planned rotations (local overrides merged with server) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const effectivePlannedRotations = useMemo(() => {
    if (localRotationOverrides.size === 0) {
      return [...plannedRotations].sort((a, b) => {
        const byRotationNumber = (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0);
        if (byRotationNumber !== 0) return byRotationNumber;
        return (a.gameMinute ?? 0) - (b.gameMinute ?? 0);
      });
    }

    const mergedByKey = new Map<string, PlannedRotation>();
    for (const rotation of plannedRotations) {
      try {
        mergedByKey.set(generateCanonicalKey(rotation.half, rotation.gameMinute, false), rotation);
      } catch {
        // Ignore malformed rows.
      }
    }

    for (const [key, override] of localRotationOverrides.entries()) {
      mergedByKey.set(key, override);
    }

    return Array.from(mergedByKey.values()).sort((a, b) => {
      const byRotationNumber = (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0);
      if (byRotationNumber !== 0) return byRotationNumber;
      return (a.gameMinute ?? 0) - (b.gameMinute ?? 0);
    });
  }, [localRotationOverrides, plannedRotations]);

  // Evict local overrides once the server confirms them.
  useEffect(() => {
    if (localRotationOverrides.size === 0) return;

    const serverByKey = new Map<string, PlannedRotation>();
    for (const rotation of plannedRotations) {
      try {
        serverByKey.set(generateCanonicalKey(rotation.half, rotation.gameMinute, false), rotation);
      } catch {
        // Ignore malformed rows.
      }
    }

    setLocalRotationOverrides((previous) => {
      let changed = false;
      const next = new Map(previous);

      for (const [key, override] of previous.entries()) {
        const serverRotation = serverByKey.get(key);
        if (!serverRotation) {
          next.delete(key);
          changed = true;
          continue;
        }
        if (serverRotation.plannedSubstitutions === override.plannedSubstitutions) {
          next.delete(key);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [localRotationOverrides, plannedRotations]);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Derived rotation counts Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const rotationsPerHalf =
    halfLengthInput > 0 && planner.draft.rotationIntervalMinutes > 0
      ? Math.max(0, Math.floor(halfLengthInput / planner.draft.rotationIntervalMinutes) - 1)
      : 0;
  const halftimeRotationNumber = rotationsPerHalf + 1;

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Timeline Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const timelineItems = useMemo(
    () => buildRotationTimelineItems(effectivePlannedRotations, halftimeRotationNumber),
    [effectivePlannedRotations, halftimeRotationNumber]
  );

  const selectedKeyCandidate = planner.draft.selectedTimelineKey || timelineItems[0]?.key || "starting";
  const selectedKey = reconcileSelectionKey(timelineItems, selectedKeyCandidate);

  useEffect(() => {
    if (selectedKey !== planner.draft.selectedTimelineKey) {
      planner.selectTimelineKey(selectedKey);
    }
    // planner.selectTimelineKey is stable (no deps in its useCallback); only re-run when the
    // derived key or the stored key actually changes to avoid spurious resets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, planner.draft.selectedTimelineKey]);

  const selectedTimelineItem = useMemo(
    () => timelineItems.find((item) => item.key === selectedKey) ?? null,
    [selectedKey, timelineItems]
  );

  const selectedRotation = selectedTimelineItem?.rotation ?? null;
  const isStartingSelected = selectedTimelineItem?.variant === 'starting';
  const isHalftimeSelected = selectedTimelineItem?.variant === 'halftime';
  const hasNoPlans = !gamePlan;

  // Keep ref in sync for async callbacks.
  useEffect(() => {
    timelineItemsRef.current = timelineItems;
  }, [timelineItems]);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ H2 seeding Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const isSelectedH2 = selectedTimelineItem?.rotation?.half === 2;

  // Explicit halftime overrides from persisted data/draft (may be partial).
  const explicitHalftimeLineup = externalHalftimeLineup ?? planner.draft.halftimeLineup;

  // H2-only rows for computing lineups seeded from halftime.
  const h2RotationRows = useMemo(
    () =>
      effectivePlannedRotations
        .filter((r) => r.half === 2)
        .sort((a, b) => (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0))
        .map((r) => ({
          rotationNumber: r.rotationNumber ?? 0,
          plannedSubstitutions: (r.plannedSubstitutions as string) ?? "[]",
        })),
    [effectivePlannedRotations]
  );

  const h1RotationRows = useMemo(
    () =>
      effectivePlannedRotations
        .filter((r) => r.half === 1)
        .sort((a, b) => (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0))
        .map((r) => ({
          rotationNumber: r.rotationNumber ?? 0,
          plannedSubstitutions: (r.plannedSubstitutions as string) ?? "[]",
        })),
    [effectivePlannedRotations]
  );

  const endOfFirstHalfLineup = useMemo(() => {
    if (h1RotationRows.length === 0) {
      return new Map(planner.draft.startingLineup);
    }
    const lastH1RotationNumber = h1RotationRows[h1RotationRows.length - 1].rotationNumber;
    return computeLineupAtRotation(planner.draft.startingLineup, h1RotationRows, lastH1RotationNumber);
  }, [planner.draft.startingLineup, h1RotationRows]);

  // H2 must always start from a full lineup: end-of-H1 plus any explicit halftime overrides.
  // explicit override contract: missing key => inherit, non-empty => override, "" => clear
  const effectiveHalftimeLineup = useMemo(
    () => mergeHalftimeLineup(endOfFirstHalfLineup, explicitHalftimeLineup),
    [endOfFirstHalfLineup, explicitHalftimeLineup]
  );

  const rotationRowsForLineup = useMemo(
    () =>
      [...effectivePlannedRotations]
        .sort((a, b) => (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0))
        .map((rotation) => ({
          rotationNumber: rotation.rotationNumber ?? 0,
          plannedSubstitutions: (rotation.plannedSubstitutions as string) ?? "[]",
        })),
    [effectivePlannedRotations]
  );

  const selectedRotationNumber = selectedRotation?.rotationNumber ?? null;

  // Lineup state just BEFORE the selected rotation (seed for diff computation).
  const selectedRotationBeforeLineup = useMemo(() => {
    if (!selectedRotationNumber || selectedRotationNumber <= 0) {
      return new Map(isSelectedH2 ? effectiveHalftimeLineup : planner.draft.startingLineup);
    }
    if (isSelectedH2) {
      return computeLineupAtRotation(effectiveHalftimeLineup, h2RotationRows, selectedRotationNumber - 1);
    }
    return computeLineupAtRotation(planner.draft.startingLineup, rotationRowsForLineup, selectedRotationNumber - 1);
  }, [isSelectedH2, planner.draft.startingLineup, effectiveHalftimeLineup, rotationRowsForLineup, h2RotationRows, selectedRotationNumber]);

  // Lineup state AT the selected rotation (shown in PlannerLineupView).
  const selectedRotationCurrentLineup = useMemo(() => {
    if (!selectedRotationNumber || selectedRotationNumber <= 0) {
      return new Map(isSelectedH2 ? effectiveHalftimeLineup : planner.draft.startingLineup);
    }
    if (isSelectedH2) {
      return computeLineupAtRotation(effectiveHalftimeLineup, h2RotationRows, selectedRotationNumber);
    }
    return computeLineupAtRotation(planner.draft.startingLineup, rotationRowsForLineup, selectedRotationNumber);
  }, [isSelectedH2, planner.draft.startingLineup, effectiveHalftimeLineup, rotationRowsForLineup, h2RotationRows, selectedRotationNumber]);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Computed game parameters Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const halfLengthMinutes = halfLengthInput;
  const hasPendingHalfLengthSave = isScheduled && !readOnly && halfLengthInput !== derivedHalfLength;
  const totalGameMinutes = Math.max(0, halfLengthMinutes * 2);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Synthetic HT sentinel for projected play time Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const syntheticHtRotation = useMemo(() => {
    if (endOfFirstHalfLineup.size === 0) return null;
    const payload = projectHalftimeRotation(endOfFirstHalfLineup, effectiveHalftimeLineup);
    // Skip sentinel if no actual HT changes - empty subs corrupt play-time calc (gameMinute: 0)
    let htSubs: unknown[] = [];
    try { htSubs = JSON.parse(payload.plannedSubstitutions as string) as unknown[]; } catch { /* ignore */ }
    if (htSubs.length === 0) return null;
    return {
      ...payload,
      id: "",
      gamePlanId: gamePlan?.id ?? "",
      coaches: team.coaches ?? [],
    } as unknown as PlannedRotation;
  }, [endOfFirstHalfLineup, effectiveHalftimeLineup, gamePlan?.id, team.coaches]);

  const effectivePlannedRotationsWithHt = useMemo(() => {
    const htExists = effectivePlannedRotations.some(
      (r) => r.rotationNumber === halftimeRotationNumber
    );
    if (htExists || !syntheticHtRotation) return effectivePlannedRotations;
    return [...effectivePlannedRotations, {
      ...syntheticHtRotation,
      rotationNumber: halftimeRotationNumber,
    }].sort((a, b) => (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0));
  }, [effectivePlannedRotations, halftimeRotationNumber, syntheticHtRotation]);

  // Projected play time rows (rendered at the bottom).
  const projectedPlayTimeRows = useMemo(() => {
    const playerNameById = new Map<string, string>();
    for (const player of players) {
      const displayName = `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim() || player.id;
      playerNameById.set(player.id, displayName);
    }

    const startingLineupArr = Array.from(planner.draft.startingLineup.entries())
      .filter(([, playerId]) => Boolean(playerId))
      .map(([positionId, playerId]) => ({ positionId, playerId }));

    const sanitizedRotations = effectivePlannedRotationsWithHt.map((rotation) => {
      try {
        const parsed = JSON.parse((rotation.plannedSubstitutions as string) ?? "[]");
        if (Array.isArray(parsed)) return rotation;
      } catch {
        // Fall through.
      }
      return { ...rotation, plannedSubstitutions: "[]" };
    });

    // Issue #119: Normalize the HT rotation for play-time projection.
    // (a) The stored PlannedRotation may have stale or empty plannedSubstitutions when the
    //     halftime lineup was changed via the lineup builder after rotations were generated.
    // (b) The synthetic HT sentinel has gameMinute:0 — normalize to halfLengthMinutes so
    //     calculatePlayTime computes correct segment durations in both H1 and H2.
    const projectionRotations = sanitizedRotations.map((rotation) => {
      if (rotation.rotationNumber !== halftimeRotationNumber) return rotation;
      return {
        ...rotation,
        gameMinute: halfLengthMinutes,
        ...(syntheticHtRotation !== null
          ? { plannedSubstitutions: syntheticHtRotation.plannedSubstitutions }
          : {}),
      };
    });

    const playTimeMap = calculatePlayTime(
      projectionRotations,
      startingLineupArr,
      planner.draft.rotationIntervalMinutes,
      totalGameMinutes
    );

    // Fallback: when no players have play time yet, show all available players with 0m.
    if (playTimeMap.size === 0 && players.length > 0) {
      for (const player of players) {
        playTimeMap.set(player.id, { playerId: player.id, totalMinutes: 0, rotations: [] });
      }
    }

    const rows = Array.from(playTimeMap.values()).map((pt) => ({
      playerId: pt.playerId,
      playerName: playerNameById.get(pt.playerId) ?? `Unknown Player (${pt.playerId})`,  
      totalMinutes: pt.totalMinutes,
      barPercent: 0,
    }));

    const maxMinutes = Math.max(...rows.map((r) => r.totalMinutes), 1);
    for (const row of rows) {
      row.barPercent = Math.round((row.totalMinutes / maxMinutes) * 100);
    }

    return rows.sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [players, planner.draft.startingLineup, planner.draft.rotationIntervalMinutes, effectivePlannedRotationsWithHt, totalGameMinutes, halfLengthMinutes, syntheticHtRotation, halftimeRotationNumber]);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Callbacks Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /** Persists rotation changes to server with in-flight guard and re-schedule on concurrency. */
  const persistRotationChange = useCallback(async (payload: { rotations: PlannedRotation[]; fingerprint: string; changedNumbers: number[] }) => {
    if (rotationWriteInflightRef.current) {
      pendingAfterInflightRef.current = payload;
      return;
    }
    if (!onUpdatePlannedRotations) return;

    rotationWriteInflightRef.current = true;
    try {
      const result = await onUpdatePlannedRotations({
        expectedFingerprint: payload.fingerprint,
        plannedRotations: payload.rotations,
      });

      if (result.status === "conflict") {
        setRotationConflictMessage(result.conflictReason ?? "Plan changed remotely. Review latest data and retry.");
        setLocalRotationOverrides((prev) => {
          const next = new Map(prev);
          for (const rotation of payload.rotations) {
            try { next.delete(generateCanonicalKey(rotation.half, rotation.gameMinute, false)); } catch { /* ignore */ }
          }
          return next;
        });
      } else {
        setRotationConflictMessage(null);
        setRotationErrorMessage(null);
        const affectedLabels = payload.changedNumbers
          .slice(1)
          .map((rotNum) => {
            const item = timelineItemsRef.current.find((i) => i.rotation?.rotationNumber === rotNum);
            return item?.label ?? `R${rotNum}`;
          });
        if (affectedLabels.length > 0) setCascadeAffectedLabels(affectedLabels);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save rotation.";
      setRotationErrorMessage(message);
      setLocalRotationOverrides((prev) => {
        const next = new Map(prev);
        for (const rotation of payload.rotations) {
          try { next.delete(generateCanonicalKey(rotation.half, rotation.gameMinute, false)); } catch { /* ignore */ }
        }
        return next;
      });
    } finally {
      rotationWriteInflightRef.current = false;
      const pending = pendingAfterInflightRef.current;
      if (pending) {
        pendingAfterInflightRef.current = null;
        void persistRotationChange(pending);
      }
    }
  }, [onUpdatePlannedRotations]);

  /** Immediate-save for starting lineup position assignment. */
  const handleStartingLineupChange = useCallback(
    async (positionId: string, playerId: string) => {
      if (!isScheduled || readOnly) return;
      const newLineup = applyUniqueAssignment(planner.draft.startingLineup, positionId, playerId);
      await planner.updateStartingLineup(newLineup);
    },
    [isScheduled, readOnly, planner]
  );

  /**
   * Internal: persists a new effective halftime lineup via the explicit-override contract.
   * Derives the minimal override map (including "" sentinels for cleared positions),
   * saves it, and cascades H2 rotations so playerOutId labels stay consistent.
   */
  const applyHalftimeLineupChange = useCallback(
    async (nextEffectiveLineup: Map<string, string>) => {
      // Derive minimal explicit overrides; "" = explicit clear sentinel.
      const nextExplicitOverrides = deriveExplicitOverrides(nextEffectiveLineup, endOfFirstHalfLineup);
      if (externalOnHalftimeLineupChange) {
        await externalOnHalftimeLineupChange(nextExplicitOverrides);
      } else {
        await planner.updateHalftimeLineup(nextExplicitOverrides);
      }
      // Cascade H2 rotations so their playerOutId values stay consistent with the
      // new halftime lineup. Without this, stale subs overwrite the new halftime
      // assignment when H2 lineups are computed. (Rule 1.4 — halftime is the only
      // GK substitution point.)
      if (onUpdatePlannedRotations) {
        const sortedH2 = effectivePlannedRotations
          .filter((r) => r.half === 2)
          .sort((a, b) => (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0));
        if (sortedH2.length > 0) {
          const firstH2 = sortedH2[0];
          let firstH2Subs: PlannedSubstitution[] = [];
          try {
            const parsed = JSON.parse((firstH2.plannedSubstitutions as string) ?? "[]");
            if (Array.isArray(parsed)) firstH2Subs = parsed as PlannedSubstitution[];
          } catch {
            // Leave empty — cascade still rebinds downstream rotations.
          }
          // Rebind each sub's playerOutId to whoever is NOW in that position.
          // Use "" for cleared positions so stale playerOut labels do not persist.
          const reboundFirstH2Subs = firstH2Subs.map((sub) => ({
            ...sub,
            playerOutId: nextEffectiveLineup.get(sub.positionId) ?? "",
          }));
          const cascadeResult = applyRotationEditWithSameHalfCascade(
            planner.draft.startingLineup,
            effectivePlannedRotations,
            firstH2.rotationNumber ?? 0,
            reboundFirstH2Subs,
            nextEffectiveLineup,
          );
          if (cascadeResult.changedRotationNumbers.length > 0) {
            setLocalRotationOverrides((prev) => {
              const next = new Map(prev);
              for (const rotNum of cascadeResult.changedRotationNumbers) {
                const updated = cascadeResult.rotations.find((r) => r.rotationNumber === rotNum);
                if (!updated) continue;
                try {
                  const key = generateCanonicalKey(updated.half, updated.gameMinute, false);
                  const serverRot = plannedRotations.find((r) => r.rotationNumber === rotNum);
                  if (serverRot?.plannedSubstitutions === updated.plannedSubstitutions) {
                    next.delete(key);
                  } else {
                    next.set(key, updated);
                  }
                } catch {
                  /* ignore malformed keys */
                }
              }
              return next;
            });
            void persistRotationChange({
              rotations: cascadeResult.rotations,
              fingerprint: planner.remoteFingerprint,
              changedNumbers: cascadeResult.changedRotationNumbers,
            });
          }
        }
      }
    },
    [
      endOfFirstHalfLineup,
      externalOnHalftimeLineupChange,
      planner,
      onUpdatePlannedRotations,
      effectivePlannedRotations,
      plannedRotations,
      persistRotationChange,
    ]
  );

  /** Immediate-save for halftime lineup position assignment. */
  const handleHtPositionChange = useCallback(
    async (positionId: string, playerId: string) => {
      if (!isScheduled || readOnly) return;
      const nextEffectiveLineup = applyUniqueAssignment(effectiveHalftimeLineup, positionId, playerId);
      await applyHalftimeLineupChange(nextEffectiveLineup);
    },
    [isScheduled, readOnly, effectiveHalftimeLineup, applyHalftimeLineupChange]
  );

  /** Clears all halftime position assignments after confirmation. Halftime-only. */
  const handleClearHalftimeLineup = useCallback(async () => {
    if (!isScheduled || readOnly) return;
    const confirmed = await confirm({
      title: "Clear Halftime Lineup",
      message: "Remove all players from the halftime lineup? H2 rotations will also be updated.",
      confirmText: "Clear All",
      variant: "warning",
    });
    if (!confirmed) return;
    await applyHalftimeLineupChange(new Map());
  }, [isScheduled, readOnly, confirm, applyHalftimeLineupChange]);

  /** Debounced (300 ms) immediate-save for rotation slot changes. */
  const handleRotationPositionChange = useCallback(
    (positionId: string, playerId: string) => {
      if (!isScheduled || readOnly || selectedRotationNumber == null || !onUpdatePlannedRotations) return;
      const newRotationLineup = applyUniqueAssignment(selectedRotationCurrentLineup, positionId, playerId);
      const editedSubs = computeLineupDiff(selectedRotationBeforeLineup, newRotationLineup);

      // H2 cascade seed: project halftime lineup from H1 rotations + HT override.
      let h2CascadeSeed: Map<string, string> | undefined;
      if (isSelectedH2) {
        const seed = new Map(endOfFirstHalfLineup);
        for (const [posId, pid] of effectiveHalftimeLineup.entries()) {
          if (pid) { seed.set(posId, pid); } else { seed.delete(posId); }
        }
        h2CascadeSeed = seed.size > 0 ? seed : undefined;
      }

      const cascadeResult = applyRotationEditWithSameHalfCascade(
        planner.draft.startingLineup,
        effectivePlannedRotations,
        selectedRotationNumber,
        editedSubs,
        h2CascadeSeed ?? effectiveHalftimeLineup,
      );

      setLocalRotationOverrides((prev) => {
        const next = new Map(prev);
        for (const rotNum of cascadeResult.changedRotationNumbers) {
          const updated = cascadeResult.rotations.find((r) => r.rotationNumber === rotNum);
          if (!updated) continue;
          try {
            const key = generateCanonicalKey(updated.half, updated.gameMinute, false);
            const serverRot = plannedRotations.find((r) => r.rotationNumber === rotNum);
            if (serverRot?.plannedSubstitutions === updated.plannedSubstitutions) { next.delete(key); } else { next.set(key, updated); }
          } catch { /* ignore */ }
        }
        return next;
      });

      const newPayload = {
        rotations: cascadeResult.rotations,
        fingerprint: planner.remoteFingerprint,
        changedNumbers: cascadeResult.changedRotationNumbers,
      };
      pendingRotationPayloadRef.current = newPayload;
      if (rotationSaveTimerRef.current !== null) clearTimeout(rotationSaveTimerRef.current);
      rotationSaveTimerRef.current = setTimeout(() => {
        rotationSaveTimerRef.current = null;
        const p = pendingRotationPayloadRef.current;
        if (p) { pendingRotationPayloadRef.current = null; void persistRotationChange(p); }
      }, 300);
    },
    [
      isScheduled, readOnly, selectedRotationNumber, onUpdatePlannedRotations,
      selectedRotationCurrentLineup, selectedRotationBeforeLineup,
      isSelectedH2, planner.draft.startingLineup, planner.remoteFingerprint,
      effectivePlannedRotations, effectiveHalftimeLineup, plannedRotations, persistRotationChange,
      endOfFirstHalfLineup,
    ]
  );

  /** Resets a rotation back to its last server-confirmed state. */
  const handleResetRotation = useCallback(
    async (rotationNumber: number) => {
      if (!isScheduled || readOnly || !onUpdatePlannedRotations) return;
      const originalRotation = plannedRotations.find((r) => r.rotationNumber === rotationNumber);
      if (!originalRotation) return;
      if (rotationSaveTimerRef.current !== null) {
        clearTimeout(rotationSaveTimerRef.current);
        rotationSaveTimerRef.current = null;
        pendingRotationPayloadRef.current = null;
      }
      try {
        const result = await onUpdatePlannedRotations({
          expectedFingerprint: planner.remoteFingerprint,
          plannedRotations: effectivePlannedRotations.map((r) =>
            r.rotationNumber === rotationNumber ? originalRotation : r
          ),
        });
        if (result.status === "ok") {
          setLocalRotationOverrides((prev) => {
            const next = new Map(prev);
            try { next.delete(generateCanonicalKey(originalRotation.half, originalRotation.gameMinute, false)); } catch { /* ignore */ }
            return next;
          });
          setCascadeAffectedLabels(null);
        }
      } catch (err) {
        setRotationErrorMessage(err instanceof Error ? err.message : "Failed to reset rotation.");
      }
    },
    [isScheduled, readOnly, onUpdatePlannedRotations, plannedRotations, effectivePlannedRotations, planner.remoteFingerprint]
  );

  // Auto-clear cascade indicator after 4 seconds.
  useEffect(() => {
    if (!cascadeAffectedLabels) return;
    if (cascadeIndicatorTimerRef.current) clearTimeout(cascadeIndicatorTimerRef.current);
    cascadeIndicatorTimerRef.current = setTimeout(() => { setCascadeAffectedLabels(null); }, 4000);
    return () => { if (cascadeIndicatorTimerRef.current) clearTimeout(cascadeIndicatorTimerRef.current); };
  }, [cascadeAffectedLabels]);

  const handleSavePlan = useCallback(async () => {
    if (!isScheduled || readOnly) return;
    setIsSavingPlan(true);
    try {
      // Capture immutable snapshots before any async work.
      const snapshotHalfLength = Math.max(1, Math.min(99, halfLengthInput));
      const snapshotInterval = planner.draft.rotationIntervalMinutes;
      const hasPendingHalfLengthChange = halfLengthInput !== derivedHalfLength;
      const hasPendingRotationIntervalChange =
        planner.draft.rotationIntervalMinutes !== (gamePlan?.rotationIntervalMinutes ?? 10);
      const scheduleAffectingChange = hasPendingHalfLengthChange || hasPendingRotationIntervalChange;
      if (hasPendingHalfLengthChange) {
        halfLengthEditingRef.current = false;
        setHalfLengthInput(snapshotHalfLength);
        if (onHalfLengthChange) {
          await onHalfLengthChange(snapshotHalfLength);
        }
      }
      const isNewPlan = !gamePlan;
      if (planner.isDirty || isNewPlan) {
        await planner.savePlan();
      }

      if ((scheduleAffectingChange || isNewPlan) && onEnsureRotationSchedule) {
        await onEnsureRotationSchedule({ halfLengthMinutes: snapshotHalfLength, rotationIntervalMinutes: snapshotInterval });
      }
    } finally {
      setIsSavingPlan(false);
    }
  }, [
    isScheduled,
    readOnly,
    gamePlan,
    planner,
    halfLengthInput,
    derivedHalfLength,
    onHalfLengthChange,
    onEnsureRotationSchedule,
  ]);

  const handleRotationIntervalChange = useCallback(
    async (minutes: number) => {
      if (!isScheduled || readOnly) return;
      const clamped = Math.max(1, Math.min(99, minutes));
      await planner.updateRotationInterval(clamped);
      if (onIntervalChange) {
        await onIntervalChange(clamped);
      }
    },
    [isScheduled, planner, onIntervalChange, readOnly]
  );

  const saveHalfLength = useCallback(
    async (value: number) => {
      if (game.status !== 'scheduled') return;
      const clamped = Math.max(1, Math.min(99, value));
      setHalfLengthInput(clamped);
      if (onHalfLengthChange) {
        await onHalfLengthChange(clamped);
      }
    },
    [game.status, onHalfLengthChange]
  );

  const handleResetHalfLengthToDefault = useCallback(async () => {
    await saveHalfLength(team.halfLengthMinutes ?? 30);
  }, [saveHalfLength, team.halfLengthMinutes]);

  /** Exports the current rotation plan as a CSV file and triggers a browser download. */
  const handleExportPlan = useCallback(() => {
    if (!gamePlan) return;

    const exportHalfLength = Math.max(1, halfLengthInput || derivedHalfLength || 30);

    const h1Rotations = effectivePlannedRotations
      .filter((r) => r.half === 1)
      .sort((a, b) => (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0));
    const h2Rotations = effectivePlannedRotations
      .filter((r) => r.half === 2)
      .sort((a, b) => (a.rotationNumber ?? 0) - (b.rotationNumber ?? 0));
    const h2VisibleRotations = h2Rotations.filter((r) => {
      if (typeof r.gameMinute !== "number") return true;
      return r.gameMinute > exportHalfLength;
    });

    const h1Rows = h1Rotations.map((r) => ({
      rotationNumber: r.rotationNumber ?? 0,
      plannedSubstitutions: (r.plannedSubstitutions as string) ?? "[]",
    }));
    const h2Rows = h2Rotations.map((r) => ({
      rotationNumber: r.rotationNumber ?? 0,
      plannedSubstitutions: (r.plannedSubstitutions as string) ?? "[]",
    }));

    const columns: RotationPlanColumn[] = [];
    columns.push({ label: "Start", lineup: new Map(planner.draft.startingLineup) });

    for (const [index, rot] of h1Rotations.entries()) {
      const rotNum = rot.rotationNumber ?? 0;
      const lineup = computeLineupAtRotation(planner.draft.startingLineup, h1Rows, rotNum);
      columns.push({ label: `R${index + 1} ${rot.gameMinute ?? "?"}′`, lineup });
    }

    columns.push({ label: `HT ${exportHalfLength}′`, lineup: new Map(effectiveHalftimeLineup) });

    const h2LabelOffset = h1Rotations.length;
    for (const [index, rot] of h2VisibleRotations.entries()) {
      const rotNum = rot.rotationNumber ?? 0;
      const lineup = computeLineupAtRotation(effectiveHalftimeLineup, h2Rows, rotNum);
      columns.push({ label: `R${h2LabelOffset + index + 1} ${rot.gameMinute ?? "?"}′`, lineup });
    }

    const playersById = new Map<string, string>();
    for (const player of players) {
      playersById.set(
        player.id,
        `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim() || player.id
      );
    }

    exportRotationPlanLocally({
      fileStem: `game-${game.id}`,
      positions: positions.map((p) => ({
        id: p.id,
        positionName: p.positionName ?? p.abbreviation ?? p.id,
      })),
      columns,
      playTimeRows: projectedPlayTimeRows.map((r) => ({
        playerName: r.playerName,
        totalMinutes: r.totalMinutes,
      })),
      playersById,
    });
  }, [
    gamePlan,
    planner.draft.startingLineup,
    effectivePlannedRotations,
    effectiveHalftimeLineup,
    players,
    positions,
    projectedPlayTimeRows,
    game.id,
    halfLengthInput,
    derivedHalfLength,
  ]);

  const requestTimelineSelection = useCallback((nextKey: string): boolean => {
    if (nextKey === selectedKey) return true;

    // Flush any pending debounced rotation write before navigating away.
    if (rotationSaveTimerRef.current !== null) {
      clearTimeout(rotationSaveTimerRef.current);
      rotationSaveTimerRef.current = null;
      const payload = pendingRotationPayloadRef.current;
      if (payload) {
        pendingRotationPayloadRef.current = null;
        void persistRotationChange(payload);
      }
    }

    planner.selectTimelineKey(nextKey);
    return true;
  }, [planner, selectedKey, persistRotationChange]);

  const handleTimelineKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selectedKey || timelineItems.length === 0) return;

    const keys = timelineItems.map((item) => item.key);
    const currentIndex = keys.indexOf(selectedKey);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % keys.length;
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + keys.length) % keys.length;
      e.preventDefault();
    } else if (e.key === "Home") {
      nextIndex = 0;
      e.preventDefault();
    } else if (e.key === "End") {
      nextIndex = keys.length - 1;
      e.preventDefault();
    }

    if (nextIndex !== currentIndex) {
      const nextKey = keys[nextIndex];
      const didSelect = requestTimelineSelection(nextKey);
      if (!didSelect) return;
      setTimeout(() => {
        const pill = timelineContainerRef.current?.querySelector(
          `[data-timeline-key="${nextKey}"]`
        ) as HTMLButtonElement;
        if (pill) {
          pill.focus({ preventScroll: true });
          pill.scrollIntoView({ inline: "nearest", block: "nearest" });
        }
      }, 0);
    }
  }, [selectedKey, timelineItems, requestTimelineSelection]);

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Render Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  return (
    <div className="plan-tab">
      {/* 1. Read-only banner */}
      {readOnly && (
        <div className="plan-tab__readonly-banner" role="note">
          Game in progress &mdash; plan is read-only during live play.
        </div>
      )}

      {/* 2. Rotation Settings card */}
      {isScheduled && !readOnly && (
        <div className="rotation-settings-card">
          <h3>Rotation Settings</h3>
          <div className="rotation-stepper-row">
            <div className="rotation-stepper">
              <label htmlFor="half-length-input" className="planner-setup-label">
                Half length (minutes)
              </label>
              <div className="rotation-stepper-controls">
                <button
                  type="button"
                  className="rotation-stepper-btn"
                  aria-label="Decrease half length"
                  onClick={() => void saveHalfLength(halfLengthInput - 1)}
                  disabled={halfLengthInput <= 1}
                >
                  &minus;
                </button>
                <input
                  id="half-length-input"
                  type="number"
                  min="1"
                  max="99"
                  inputMode="numeric"
                  value={halfLengthInput}
                  className="rotation-stepper-input"
                  onChange={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val)) setHalfLengthInput(val);
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val)) void saveHalfLength(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      halfLengthEditingRef.current = false;
                      void saveHalfLength(halfLengthInput);
                      e.currentTarget.blur();
                    }
                  }}
                  onFocus={() => { halfLengthEditingRef.current = true; }}
                />
                <button
                  type="button"
                  className="rotation-stepper-btn"
                  aria-label="Increase half length"
                  onClick={() => void saveHalfLength(halfLengthInput + 1)}
                  disabled={halfLengthInput >= 99}
                >
                  +
                </button>
              </div>
            </div>
            {halfLengthInput !== (team.halfLengthMinutes ?? 30) && (
              <button
                type="button"
                className="half-length-reset-btn"
                onClick={handleResetHalfLengthToDefault}
              >
                Reset to team default ({team.halfLengthMinutes ?? 30} min)
              </button>
            )}
          </div>

          <div className="rotation-stepper-row">
            <div className="rotation-stepper">
              <label className="planner-setup-label">Rotations / half</label>
              <div className="rotation-stepper-controls" aria-live="polite">
                <span className="rotation-derived-value">
                  {rotationsPerHalf}
                </span>
              </div>
            </div>

            <div className="rotation-stepper">
              <label htmlFor="rotation-interval-input" className="planner-setup-label">
                Every (min)
              </label>
              <div className="rotation-stepper-controls">
                <button
                  type="button"
                  className="rotation-stepper-btn"
                  aria-label="Decrease rotation interval"
                  onClick={() => void handleRotationIntervalChange(planner.draft.rotationIntervalMinutes - 1)}
                  disabled={planner.draft.rotationIntervalMinutes <= 1}
                >
                  &minus;
                </button>
                <input
                  id="rotation-interval-input"
                  type="number"
                  min="1"
                  max="99"
                  inputMode="numeric"
                  value={planner.draft.rotationIntervalMinutes}
                  className="rotation-stepper-input"
                  onChange={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val)) {
                      void handleRotationIntervalChange(val);
                    }
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val)) void handleRotationIntervalChange(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseInt(e.currentTarget.value, 10);
                      if (!isNaN(val)) void handleRotationIntervalChange(val);
                      e.currentTarget.blur();
                    }
                  }}
                />
                <button
                  type="button"
                  className="rotation-stepper-btn"
                  aria-label="Increase rotation interval"
                  onClick={() => void handleRotationIntervalChange(planner.draft.rotationIntervalMinutes + 1)}
                  disabled={planner.draft.rotationIntervalMinutes >= 99}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={handleSavePlan}
            disabled={isSavingPlan || isRecalculating || (!!gamePlan && !planner.isDirty && !hasPendingHalfLengthSave)}
            className="btn-primary plan-tab__save-btn"
          >
            {isSavingPlan ? "Saving Plan..." : "Save Plan"}
          </button>

          <p className="rotation-settings-section-label">Populate Rotations</p>

          {onGenerateRotations && (
            <button
              onClick={() => void onGenerateRotations({
                plannerSnapshot: {
                  startingLineup: new Map(planner.draft.startingLineup),
                  halftimeLineup: new Map(effectiveHalftimeLineup),
                  halfLengthMinutes: halfLengthInput,
                  rotationIntervalMinutes: planner.draft.rotationIntervalMinutes,
                },
              })}
              disabled={isRecalculating}
              className="btn-secondary plan-tab__generate-btn"
            >
              {isRecalculating ? "Generating..." : "Generate Rotations"}
            </button>
          )}

          {!readOnly && onOpenCopyModal && (
            <button
              type="button"
              onClick={onOpenCopyModal}
              disabled={isCopyingPlan || isRecalculating}
              className="btn-secondary plan-tab__generate-btn"
            >
              Copy from game
            </button>
          )}

          {hasNoPlans && (
            <p className="plan-tab__empty-state">
              No plan yet. Set rotation settings and lineup to create your plan.
            </p>
          )}

          {!hasNoPlans && effectivePlannedRotations.length === 0 && (
            <p className="plan-tab__empty-state">
              Configure schedule settings and save to create your timeline.
            </p>
          )}
        </div>
      )}

      {/* 3. Conflict / error banners */}
      {rotationConflictMessage && (
        <div className="plan-conflict-banner" role="status" aria-live="polite">
          <h4>Plan Updated Elsewhere</h4>
          <p>{rotationConflictMessage}</p>
        </div>
      )}

      {rotationErrorMessage && (
        <div className="plan-conflict-banner" role="alert">
          <h4>Unable to Save Rotation</h4>
          <p>{rotationErrorMessage}</p>
        </div>
      )}

      {/* 4. Plan conflict banner */}
      {gamePlan && planConflicts.length > 0 && (
        <div className="plan-conflict-banner">
          <h4>&#9888;&#65039; Plan Conflicts</h4>
          <p>The following players are in the game plan but currently unavailable:</p>
          <ul>
            {planConflicts.map(c => (
              <li key={c.playerId}>
                <strong>{c.playerName}</strong> &mdash; {c.status}
                {c.type === 'starter' && ' (starting lineup)'}
                {c.rotationNumbers.length > 0 && ` \u00b7 Rotation${c.rotationNumbers.length > 1 ? 's' : ''} ${c.rotationNumbers.join(', ')}`}
              </li>
            ))}
          </ul>
          <p className="conflict-hint">Update availability or adjust the game plan before starting.</p>
          {!readOnly && (
            <button
              onClick={onRecalculateRotations}
              disabled={isRecalculating}
              className="btn-secondary"
              style={{ marginTop: '8px' }}
            >
              {isRecalculating ? '\u23f3 Recalculating...' : '\ud83d\udd04 Recalculate Rotations'}
            </button>
          )}
        </div>
      )}

      {/* 5. Player Availability Grid */}
      {isScheduled && !readOnly && players.length > 0 && (
        <PlayerAvailabilityGrid
          players={players}
          gameId={game.id}
          coaches={team.coaches || []}
          lineupPlayerIds={lineupPlayerIds}
        />
      )}

      {/* 6. Timeline pills */}
      {timelineItems.length > 0 && (
        <div className="plan-tab__timeline-section">
          <h4>Plan Timeline</h4>
          <div
            ref={timelineContainerRef}
            className="planner-timeline-strip"
            role="tablist"
            aria-label="Plan timeline"
            onKeyDown={handleTimelineKeyDown}
          >
            {timelineItems.map((item) => {
              const isHalftime = item.selection === "halftime";
              const isPillSelected = item.key === selectedKey;
              const key = item.key;
              const pillarId = `plan-timeline-tab-${key}`;

              return (
                <button
                  key={key}
                  ref={isPillSelected ? selectedPillRef : null}
                  data-timeline-key={key}
                  id={pillarId}
                  role="tab"
                  aria-selected={isPillSelected}
                  aria-controls={`plan-timeline-panel-${key}`}
                  tabIndex={isPillSelected ? 0 : -1}
                  className={`planner-timeline-pill ${isPillSelected ? 'planner-timeline-pill--active' : ''} ${isHalftime ? 'planner-timeline-pill--halftime' : ''}`}
                  onClick={() => { requestTimelineSelection(key); }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. Timeline details panel Ã¢â‚¬â€ live lineup view driven by selected state */}
      {selectedKey && selectedTimelineItem && (
        <div
          id={`plan-timeline-panel-${selectedKey}`}
          role="tabpanel"
          aria-labelledby={`plan-timeline-tab-${selectedKey}`}
          className="plan-tab__timeline-panel"
        >
          {isStartingSelected ? (
            <div className="plan-tab__rotation-details">
              <h4>Starting Formation</h4>
              <PlannerLineupView
                displayLineup={planner.draft.startingLineup}
                positions={positions}
                players={players}
                onPositionAssign={!readOnly && isScheduled ? handleStartingLineupChange : undefined}
                isReadOnly={readOnly || !isScheduled}
                label="Starting lineup"
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                game={game}
                team={team}
              />
            </div>
          ) : isHalftimeSelected ? (
            <div className="plan-tab__halftime-editor">
              <div className="plan-tab__halftime-header">
                <h4>Halftime Lineup</h4>
                {!readOnly && isScheduled && effectiveHalftimeLineup.size > 0 && (
                  <button
                    type="button"
                    className="btn-clear-lineup"
                    onClick={() => void handleClearHalftimeLineup()}
                  >
                    Clear All Positions
                  </button>
                )}
              </div>
              <PlannerLineupView
                displayLineup={effectiveHalftimeLineup}
                positions={positions}
                players={players}
                onPositionAssign={!readOnly && isScheduled ? handleHtPositionChange : undefined}
                isReadOnly={readOnly || !isScheduled}
                label="Halftime lineup"
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                game={game}
                team={team}
              />
            </div>
          ) : (
            <div className="plan-tab__rotation-details">
              <h4>{selectedTimelineItem.label} &mdash; Minute {selectedRotation?.gameMinute ?? '?'}</h4>

              {cascadeAffectedLabels && cascadeAffectedLabels.length > 0 && (
                <p className="plan-tab__cascade-note" aria-live="polite">
                  Cascade updated: {cascadeAffectedLabels.join(', ')}
                </p>
              )}

              {selectedRotation && (
                <div className="plan-tab__subs-summary" aria-label="Rotation substitutions summary">
                  <h5>Who goes off/on</h5>
                  <RotationSubstitutionsList
                    substitutions={(selectedRotation.plannedSubstitutions as string) ?? "[]"}
                    players={players}
                    positions={positions}
                    beforeLineup={selectedRotationBeforeLineup}
                  />
                </div>
              )}

              <PlannerLineupView
                displayLineup={selectedRotationCurrentLineup}
                positions={positions}
                players={players}
                onPositionAssign={!readOnly && isScheduled ? handleRotationPositionChange : undefined}
                isReadOnly={readOnly || !isScheduled}
                label={`${selectedTimelineItem.label} lineup`}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                game={game}
                team={team}
              />

              {!readOnly && isScheduled && selectedRotation && (
                <>
                  <button
                    type="button"
                    className="btn-tertiary plan-tab__reset-rotation-btn"
                    onClick={() => void handleResetRotation(selectedRotation.rotationNumber)}
                    title="Revert this rotation to the last saved version from the server"
                  >
                    Reset to saved
                  </button>
                  <p className="plan-tab__reset-help">
                    Reverts this rotation to your last saved plan.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 8. Projected play time Ã¢â‚¬â€ BOTTOM */}
      {projectedPlayTimeRows.length > 0 && (
        <div className="projected-playtime">
          <h4>Projected Play Time</h4>
          <div className="playtime-bars">
            {projectedPlayTimeRows.map((row) => (
              <div key={row.playerId} className="playtime-bar-container">
                <span className="playtime-label">{row.playerName}</span>
                <div className="playtime-bar-wrapper">
                  <div
                    className="playtime-bar"
                    style={{ width: `${row.barPercent}%` }}
                    aria-label={`Projected minutes for ${row.playerName}: ${row.totalMinutes} minutes`}
                  />
                </div>
                <span className="playtime-minutes">{row.totalMinutes}m</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 9. Export plan as CSV */}
      {gamePlan && (
        <button
          type="button"
          className="btn-secondary plan-tab__export-btn"
          onClick={handleExportPlan}
          disabled={effectivePlannedRotations.length === 0}
          title={
            effectivePlannedRotations.length === 0
              ? "No rotations to export yet"
              : undefined
          }
        >
          Export Plan as CSV
        </button>
      )}

      {/* 10. Copy-from-game modal */}
      {isCopyModalOpen && onCloseCopyModal && (
        <div
          className="modal-overlay"
          onClick={onCloseCopyModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="copy-plan-modal-title"
          aria-busy={isCopyingPlan}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="copy-plan-modal-title">Copy Plan from Game</h2>

            {isCopyingPlan && (
              <p aria-live="polite" className="copy-plan-status">Copying plan\u2026</p>
            )}

            <div aria-live="polite">
              {previousGamesWithPlans === undefined ? (
                <p>Loading games\u2026</p>
              ) : previousGamesWithPlans.length === 0 ? (
                <p className="empty-state">No other games with plans found.</p>
              ) : (
                <ul className="previous-games-list">
                  {previousGamesWithPlans.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        className="game-option"
                        disabled={isCopyingPlan}
                        onClick={() => void onCopyFromGame?.(g.id)}
                      >
                        <div className="game-info">
                          <strong>{g.opponent}</strong>
                          {g.gameDate && (
                            <span>{new Date(g.gameDate).toLocaleDateString()}</span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={onCloseCopyModal}
              disabled={isCopyingPlan}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Sub-components Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/**
 * Rotation Substitutions List Ã¢â‚¬â€ read-only summary of substitutions for a rotation.
 * Exported for consumers that want to display a sub diff alongside a lineup view.
 */
export interface RotationSubstitutionsListProps {
  substitutions: string; // JSON stringified PlannedSubstitution[]
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  /** The lineup just before this rotation executes. Used to resolve blank playerOutId values. */
  beforeLineup?: Map<string, string>;
}

export function RotationSubstitutionsList({
  substitutions,
  players,
  positions,
  beforeLineup,
}: RotationSubstitutionsListProps) {
  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(substitutions);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }, [substitutions]);

  const playerMap = useMemo(
    () => new Map(players.map(p => [p.id, p])),
    [players]
  );
  const positionMap = useMemo(
    () => new Map(positions.map(p => [p.id, p])),
    [positions]
  );

  if (parsed.length === 0) {
    return <p className="plan-tab__empty-state">No substitutions scheduled.</p>;
  }

  return (
    <div className="rotation-subs-list">
      {parsed.map((sub: PlannedSubstitution, idx: number) => {
        // Prefer the computed before-lineup when present so chained substitutions show
        // the immediate outgoing player for this rotation; fall back to stored playerOutId.
        const resolvedPlayerOutId = beforeLineup?.get(sub.positionId) || sub.playerOutId || '';
        const playerOut = playerMap.get(resolvedPlayerOutId);
        const playerIn = playerMap.get(sub.playerInId);
        const position = positionMap.get(sub.positionId);
        const playerOutName = playerOut
          ? `${playerOut.firstName ?? ''} ${playerOut.lastName ?? ''}`.trim() || 'Unknown'
          : resolvedPlayerOutId ? 'Unknown' : '(unfilled)';
        const playerInName = playerIn
          ? `${playerIn.firstName ?? ''} ${playerIn.lastName ?? ''}`.trim() || 'Unknown'
          : sub.playerInId ? 'Unknown' : '(unfilled)';
        const posLabel = position?.abbreviation || position?.positionName || 'Pos';
        return (
          <div key={idx} className="rotation-subs-list__item">
            <span className="rotation-subs-list__label rotation-subs-list__label--out">OFF</span>
            <span className="rotation-subs-list__out">{playerOutName}</span>
            <span className="rotation-subs-list__arrow">&rarr;</span>
            <span className="rotation-subs-list__label rotation-subs-list__label--in">ON</span>
            <span className="rotation-subs-list__in">{playerInName}</span>
            <span className="rotation-subs-list__position">({posLabel})</span>
          </div>
        );
      })}
    </div>
  );
}

