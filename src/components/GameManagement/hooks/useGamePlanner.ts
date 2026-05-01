/**
 * useGamePlanner Hook
 * 
 * Orchestrates planner state, mutations, and draft-safe hydration for scheduled games.
 * Implements status-gated mutations, dirty-draft hydration guards, and idempotent persistence.
 */

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { generateClient } from "aws-amplify/data";
import { getCurrentUser } from "aws-amplify/auth";
import type { Schema } from "../../../../amplify/data/resource";
import type {
  Game,
  Team,
  GamePlan,
  PlannedRotation,
  LineupAssignment,
} from "../types";
import { computeRotationDiff, computeRevisionFingerprint } from "../../../utils/rotationDiffUtils";
import {
  projectHalftimeRotation,
  parseHalftimeLineup,
  serializeHalftimeLineup,
} from "../../../utils/halftimeProjectionUtils";
import { showError } from "../../../utils/toast";

const client = generateClient<Schema>();

export interface PlannerDraft {
  rotationIntervalMinutes: number;
  startingLineup: Map<string, string>;
  halftimeLineup: Map<string, string>;
  selectedTimelineKey: string | null;
}

export interface UseGamePlannerResult {
  draft: PlannerDraft;
  isDirty: boolean;
  remoteFingerprint: string;
  localFingerprint: string;
  isLocked: boolean;
  errors: string[];
  updateRotationInterval: (minutes: number) => Promise<void>;
  updateHalftimeLineup: (lineup: Map<string, string>) => Promise<void>;
  selectTimelineKey: (key: string | null) => void;
  savePlan: () => Promise<void>;
  computeHalftimeRotation: () => PlannedRotation | null;
}

interface PlannerDraftState {
  rotationIntervalMinutes: number;
  startingLineup: Map<string, string>;
  halftimeLineup: Map<string, string>;
  selectedTimelineKey: string | null;
}

export function useGamePlanner(
  game: Game,
  team: Team,
  gamePlan: GamePlan | null,
  plannedRotations: PlannedRotation[],
  startingLineupAssignments: LineupAssignment[]
): UseGamePlannerResult {
  const [draft, setDraft] = useState<PlannerDraftState>(() => {
    const startingLineup = new Map<string, string>();
    if (gamePlan?.startingLineup) {
      try {
        const entries = JSON.parse(gamePlan.startingLineup as string) as Array<{
          playerId: string;
          positionId: string;
        }>;
        for (const entry of entries) {
          startingLineup.set(entry.positionId, entry.playerId);
        }
      } catch (e) {
        console.error("[useGamePlanner] Failed to parse startingLineup:", e);
      }
    } else {
      for (const assignment of startingLineupAssignments) {
        if (assignment.positionId && assignment.playerId) {
          startingLineup.set(assignment.positionId, assignment.playerId);
        }
      }
    }

    const halftimeLineup = parseHalftimeLineup(gamePlan?.halftimeLineup as string | null | undefined);

    return {
      rotationIntervalMinutes: gamePlan?.rotationIntervalMinutes || 10,
      startingLineup,
      halftimeLineup,
      selectedTimelineKey: null,
    };
  });

  const [dirtyKeys, setDirtyKeys] = useState<Set<keyof PlannerDraftState>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const mutationInFlightRef = useRef(false);

  const remoteFingerprint = useMemo(
    () =>
      computeRevisionFingerprint(
        {
          startingLineup: gamePlan?.startingLineup as string | null | undefined,
          halftimeLineup: gamePlan?.halftimeLineup as string | null | undefined,
          rotationIntervalMinutes: gamePlan?.rotationIntervalMinutes,
        },
        plannedRotations
      ),
    [gamePlan, plannedRotations]
  );

  const localFingerprint = useMemo(() => {
    const startingLineupStr = JSON.stringify(
      Array.from(draft.startingLineup.entries())
    );
    const halftimeLineupStr = serializeHalftimeLineup(draft.halftimeLineup);

    return computeRevisionFingerprint(
      {
        startingLineup: startingLineupStr,
        halftimeLineup: halftimeLineupStr,
        rotationIntervalMinutes: draft.rotationIntervalMinutes,
      },
      plannedRotations
    );
  }, [draft, plannedRotations]);

  const isLocked = game.status !== "scheduled";

  const assertScheduledStatus = useCallback(() => {
    if (game.status !== "scheduled") {
      throw new Error(`[useGamePlanner] Status ${game.status} does not permit mutations`);
    }
  }, [game.status]);

  const updateRotationInterval = useCallback(
    async (minutes: number) => {
      assertScheduledStatus();
      if (mutationInFlightRef.current) return;

      try {
        mutationInFlightRef.current = true;
        const clamped = Math.max(1, Math.min(minutes, 99));
        setDraft(prev => ({
          ...prev,
          rotationIntervalMinutes: clamped,
        }));
        setDirtyKeys(prev => new Set([...prev, "rotationIntervalMinutes"]));
      } finally {
        mutationInFlightRef.current = false;
      }
    },
    [assertScheduledStatus]
  );

  const updateHalftimeLineup = useCallback(
    async (lineup: Map<string, string>) => {
      assertScheduledStatus();
      if (mutationInFlightRef.current) return;

      try {
        mutationInFlightRef.current = true;
        setDraft(prev => ({
          ...prev,
          halftimeLineup: new Map(lineup),
        }));
        setDirtyKeys(prev => new Set([...prev, "halftimeLineup"]));
      } finally {
        mutationInFlightRef.current = false;
      }
    },
    [assertScheduledStatus]
  );

  const selectTimelineKey = useCallback((key: string | null) => {
    setDraft(prev => ({ ...prev, selectedTimelineKey: key }));
  }, []);

  const computeHalftimeRotation = useCallback((): PlannedRotation | null => {
    if (draft.startingLineup.size === 0) return null;

    const payload = projectHalftimeRotation(
      draft.startingLineup,
      draft.halftimeLineup
    );
    return {
      ...payload,
      id: "",
      gamePlanId: gamePlan?.id || "",
      coaches: team.coaches || [],
    } as unknown as PlannedRotation;
  }, [draft, gamePlan, team]);

  const savePlan = useCallback(async () => {
    assertScheduledStatus();
    if (mutationInFlightRef.current) return;

    try {
      mutationInFlightRef.current = true;
      setErrors([]);

      const freshGameResp = await client.models.Game.get({ id: game.id });
      const freshGame = freshGameResp?.data as Game | null;
      if (freshGame?.status !== "scheduled") {
        throw new Error(
          `Status changed during save: ${freshGame?.status || "unknown"}`
        );
      }

      const startingLineupStr = JSON.stringify(
        Array.from(draft.startingLineup.entries()).map(([posId, playerId]) => ({
          playerId,
          positionId: posId,
        }))
      );
      const halftimeLineupStr = serializeHalftimeLineup(draft.halftimeLineup);

      let planId = gamePlan?.id;

      if (!planId) {
        const user = await getCurrentUser();
        const createResult = await client.models.GamePlan.create({
          gameId: game.id,
          rotationIntervalMinutes: draft.rotationIntervalMinutes,
          totalRotations: 0,
          startingLineup: startingLineupStr,
          halftimeLineup: halftimeLineupStr,
          coaches: [user.userId],
        } as Parameters<typeof client.models.GamePlan.create>[0]);
        const createdPlan = createResult?.data as GamePlan | null;
        if (!createdPlan?.id) {
          throw new Error("Failed to create GamePlan");
        }
        planId = createdPlan.id;
      } else {
        await client.models.GamePlan.update({
          id: planId,
          rotationIntervalMinutes: draft.rotationIntervalMinutes,
          startingLineup: startingLineupStr,
          halftimeLineup: halftimeLineupStr,
        });
      }

      const freshGamePhase2Resp = await client.models.Game.get({ id: game.id });
      const freshGamePhase2 = freshGamePhase2Resp?.data as Game | null;
      if (freshGamePhase2?.status !== "scheduled") {
        throw new Error(
          `Status changed during Phase 2: ${freshGamePhase2?.status || "unknown"}`
        );
      }

      // In the planner, we only persist the halftime rotation marker
      const desiredRotations: PlannedRotation[] = [];
      
      const haltimeRot = computeHalftimeRotation();
      if (haltimeRot) {
        desiredRotations.push({
          ...haltimeRot,
          rotationNumber: 999,
          gameMinute: (game.halfLengthMinutes ?? team.halfLengthMinutes) || 30,
          half: 2,
        } as PlannedRotation);
      }

      const { operations, errors: diffErrors } = computeRotationDiff(
        plannedRotations,
        desiredRotations
      );

      if (diffErrors.length > 0) {
        console.warn("[useGamePlanner] Diff errors:", diffErrors);
      }

      const user = await getCurrentUser();
      for (const op of operations) {
        if (op.action === "delete" && op.current) {
          await client.models.PlannedRotation.delete({
            id: op.current.id,
          });
        } else if (op.action === "update" && op.desired) {
          await client.models.PlannedRotation.update({
            id: op.desired.id,
            plannedSubstitutions: op.desired.plannedSubstitutions,
          });
        } else if (op.action === "create" && op.desired) {
          await client.models.PlannedRotation.create({
            gamePlanId: planId,
            rotationNumber: op.desired.rotationNumber,
            gameMinute: op.desired.gameMinute,
            half: op.desired.half,
            plannedSubstitutions: op.desired.plannedSubstitutions,
            coaches: [user.userId],
          });
        }
      }

      const finalGameResp = await client.models.Game.get({ id: game.id });
      const finalGame = finalGameResp?.data as Game | null;
      if (finalGame?.status !== "scheduled") {
        throw new Error(
          `Status changed during Phase 4: ${finalGame?.status || "unknown"}`
        );
      }

      setDirtyKeys(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors([msg]);
      showError(msg);
      throw err;
    } finally {
      mutationInFlightRef.current = false;
    }
  }, [game, team, draft, gamePlan, plannedRotations, assertScheduledStatus, computeHalftimeRotation]);

  useEffect(() => {
    if (dirtyKeys.size > 0) {
      return;
    }

    if (remoteFingerprint === localFingerprint) {
      return;
    }

    const startingLineup = new Map<string, string>();
    if (gamePlan?.startingLineup) {
      try {
        const entries = JSON.parse(gamePlan.startingLineup as string) as Array<{
          playerId: string;
          positionId: string;
        }>;
        for (const entry of entries) {
          startingLineup.set(entry.positionId, entry.playerId);
        }
      } catch (e) {
        console.error("[useGamePlanner rehydrate] Failed to parse:", e);
      }
    }

    const halftimeLineup = parseHalftimeLineup(gamePlan?.halftimeLineup as string | null | undefined);

    setDraft({
      rotationIntervalMinutes: gamePlan?.rotationIntervalMinutes || 10,
      startingLineup,
      halftimeLineup,
      selectedTimelineKey: null,
    });
  }, [gamePlan, plannedRotations, remoteFingerprint, localFingerprint, dirtyKeys]);

  return {
    draft: {
      rotationIntervalMinutes: draft.rotationIntervalMinutes,
      startingLineup: draft.startingLineup,
      halftimeLineup: draft.halftimeLineup,
      selectedTimelineKey: draft.selectedTimelineKey,
    },
    isDirty: dirtyKeys.size > 0,
    remoteFingerprint,
    localFingerprint,
    isLocked,
    errors,
    updateRotationInterval,
    updateHalftimeLineup,
    selectTimelineKey,
    savePlan,
    computeHalftimeRotation,
  };
}
