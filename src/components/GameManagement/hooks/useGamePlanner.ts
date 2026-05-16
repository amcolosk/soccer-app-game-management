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
import { computeRevisionFingerprint } from "../../../utils/rotationDiffUtils";
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
  /** Immediately saves the new starting lineup to GamePlan. Does not write PlannedRotation records. */
  updateStartingLineup: (lineup: Map<string, string>) => Promise<void>;
  updateHalftimeLineup: (lineup: Map<string, string>) => Promise<void>;
  selectTimelineKey: (key: string | null) => void;
  /** Saves rotationIntervalMinutes + current startingLineup + current halftimeLineup to GamePlan. Does not write PlannedRotation records. */
  savePlan: () => Promise<void>;
  computeHalftimeRotation: () => PlannedRotation | null;
}

interface PlannerDraftState {
  rotationIntervalMinutes: number;
  startingLineup: Map<string, string>;
  halftimeLineup: Map<string, string>;
  selectedTimelineKey: string | null;
}

function parseStartingLineupFromPlan(startingLineupRaw: string | null | undefined): Map<string, string> {
  const startingLineup = new Map<string, string>();
  if (!startingLineupRaw) {
    return startingLineup;
  }

  try {
    const entries = JSON.parse(startingLineupRaw) as Array<{
      playerId: string;
      positionId: string;
    }>;
    for (const entry of entries) {
      startingLineup.set(entry.positionId, entry.playerId);
    }
  } catch (e) {
    console.error("[useGamePlanner] Failed to parse startingLineup:", e);
  }

  return startingLineup;
}

function lineupFromAssignments(assignments: LineupAssignment[]): Map<string, string> {
  const startingLineup = new Map<string, string>();
  for (const assignment of assignments) {
    if (assignment.positionId && assignment.playerId) {
      startingLineup.set(assignment.positionId, assignment.playerId);
    }
  }
  return startingLineup;
}

function serializeStartingLineup(lineup: Map<string, string>): string {
  return JSON.stringify(
    Array.from(lineup.entries())
      .map(([positionId, playerId]) => ({ playerId, positionId }))
      .sort((a, b) => a.positionId.localeCompare(b.positionId))
  );
}

export function useGamePlanner(
  game: Game,
  team: Team,
  gamePlan: GamePlan | null,
  plannedRotations: PlannedRotation[],
  startingLineupAssignments: LineupAssignment[]
): UseGamePlannerResult {
  const [draft, setDraft] = useState<PlannerDraftState>(() => {
    const startingLineup = gamePlan?.startingLineup
      ? parseStartingLineupFromPlan(gamePlan.startingLineup as string)
      : lineupFromAssignments(startingLineupAssignments);

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

  const remoteFingerprint = useMemo(() => {
    const fallbackStartingLineup = lineupFromAssignments(startingLineupAssignments);
    const startingLineupStr = gamePlan?.startingLineup
      ? (gamePlan.startingLineup as string)
      : serializeStartingLineup(fallbackStartingLineup);

    return computeRevisionFingerprint(
      {
        startingLineup: startingLineupStr,
        halftimeLineup: (gamePlan?.halftimeLineup as string | null | undefined) ?? "[]",
        rotationIntervalMinutes: gamePlan?.rotationIntervalMinutes ?? 10,
      },
      plannedRotations
    );
  }, [gamePlan, plannedRotations, startingLineupAssignments]);

  const localFingerprint = useMemo(() => {
    const startingLineupStr = serializeStartingLineup(draft.startingLineup);
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

  const updateStartingLineup = useCallback(
    async (lineup: Map<string, string>) => {
      assertScheduledStatus();
      if (mutationInFlightRef.current) return;

      try {
        mutationInFlightRef.current = true;
        setErrors([]);

        // Optimistically update local state.
        setDraft(prev => ({ ...prev, startingLineup: new Map(lineup) }));
        setDirtyKeys(prev => new Set([...prev, "startingLineup"]));

        const freshGameResp = await client.models.Game.get({ id: game.id });
        const freshGame = freshGameResp?.data as Game | null;
        if (freshGame?.status !== "scheduled") {
          throw new Error(`Status changed during save: ${freshGame?.status || "unknown"}`);
        }

        const startingLineupStr = JSON.stringify(
          Array.from(lineup.entries()).map(([positionId, playerId]) => ({ playerId, positionId }))
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
          if (!createdPlan?.id) throw new Error("Failed to create GamePlan");
          planId = createdPlan.id;
        } else {
          await client.models.GamePlan.update({
            id: planId,
            startingLineup: startingLineupStr,
            halftimeLineup: halftimeLineupStr,
            rotationIntervalMinutes: draft.rotationIntervalMinutes,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrors([msg]);
        showError(msg);
        throw err;
      } finally {
        mutationInFlightRef.current = false;
      }
    },
    [game, draft, gamePlan, assertScheduledStatus]
  );

  const updateHalftimeLineup = useCallback(
    async (lineup: Map<string, string>) => {
      assertScheduledStatus();
      if (mutationInFlightRef.current) return;

      try {
        mutationInFlightRef.current = true;
        setErrors([]);

        // Optimistically update local state.
        setDraft(prev => ({
          ...prev,
          halftimeLineup: new Map(lineup),
        }));
        setDirtyKeys(prev => new Set([...prev, "halftimeLineup"]));

        const freshGameResp = await client.models.Game.get({ id: game.id });
        const freshGame = freshGameResp?.data as Game | null;
        if (freshGame?.status !== "scheduled") {
          throw new Error(`Status changed during save: ${freshGame?.status || "unknown"}`);
        }

        const startingLineupStr = JSON.stringify(
          Array.from(draft.startingLineup.entries()).map(([positionId, playerId]) => ({ playerId, positionId }))
        );
        const halftimeLineupStr = serializeHalftimeLineup(lineup);

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
          if (!createdPlan?.id) throw new Error("Failed to create GamePlan");
          planId = createdPlan.id;
        } else {
          await client.models.GamePlan.update({
            id: planId,
            startingLineup: startingLineupStr,
            halftimeLineup: halftimeLineupStr,
            rotationIntervalMinutes: draft.rotationIntervalMinutes,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrors([msg]);
        showError(msg);
        throw err;
      } finally {
        mutationInFlightRef.current = false;
      }
    },
    [game, draft, gamePlan, assertScheduledStatus]
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
  }, [draft.startingLineup, draft.halftimeLineup, gamePlan, team]);

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

      const finalGameResp = await client.models.Game.get({ id: game.id });
      const finalGame = finalGameResp?.data as Game | null;
      if (finalGame?.status !== "scheduled") {
        throw new Error(
          `Status changed during save completion: ${finalGame?.status || "unknown"}`
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
  }, [game, draft, gamePlan, assertScheduledStatus]);

  useEffect(() => {
    if (dirtyKeys.size > 0) {
      // If remote fingerprint has caught up with our local draft, the subscription confirmed
      // our save. Clear the dirty guard so future remote changes can rehydrate normally.
      if (remoteFingerprint === localFingerprint) {
        setDirtyKeys(new Set());
      }
      return;
    }

    if (remoteFingerprint === localFingerprint) {
      return;
    }

    const startingLineup = gamePlan?.startingLineup
      ? parseStartingLineupFromPlan(gamePlan.startingLineup as string)
      : lineupFromAssignments(startingLineupAssignments);

    const halftimeLineup = parseHalftimeLineup(gamePlan?.halftimeLineup as string | null | undefined);

    setDraft((prev) => {
      let hasChanges = false;
      if (prev.rotationIntervalMinutes !== (gamePlan?.rotationIntervalMinutes || 10)) {
        hasChanges = true;
      }

      if (!hasChanges) {
        if (prev.startingLineup.size !== startingLineup.size) {
          hasChanges = true;
        } else {
          for (const [k, v] of startingLineup.entries()) {
            if (prev.startingLineup.get(k) !== v) {
              hasChanges = true;
              break;
            }
          }
        }
      }

      if (!hasChanges) {
        if (prev.halftimeLineup.size !== halftimeLineup.size) {
          hasChanges = true;
        } else {
          for (const [k, v] of halftimeLineup.entries()) {
            if (prev.halftimeLineup.get(k) !== v) {
              hasChanges = true;
              break;
            }
          }
        }
      }

      if (!hasChanges) {
        return prev;
      }

      return {
        ...prev,
        rotationIntervalMinutes: gamePlan?.rotationIntervalMinutes || 10,
        startingLineup,
        halftimeLineup,
      };
    });
  }, [gamePlan, plannedRotations, remoteFingerprint, localFingerprint, dirtyKeys, startingLineupAssignments]);

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
    updateStartingLineup,
    updateHalftimeLineup,
    selectTimelineKey,
    savePlan,
    computeHalftimeRotation,
  };
}
