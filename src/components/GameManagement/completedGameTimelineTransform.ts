/**
 * Pure transform module for the Completed Game Timeline.
 *
 * No React state, side effects, DOM reads, or mutations.
 * Accepts raw game data and emits a ready-to-render view model.
 */

import type { PlayerWithRoster, PlayTimeRecord, FormationPosition } from "./types";
import { normalizeCompletedRecords } from "../../utils/playTimeCalculations";
import { compareByJerseyNumber } from "./completedGameTimelineSort";

/** Minimum visual width (%) for any non-zero play-time segment. */
const MIN_WIDTH_PCT = 2;

/** Target number of axis tick marks. */
const TARGET_TICK_COUNT = 6;

// ---------------------------------------------------------------------------
// View model types
// ---------------------------------------------------------------------------

export interface TimelineSegment {
  key: string;
  /** Left edge of the segment as % of total duration. */
  leftPct: number;
  /** Visual width as % of total duration; at least MIN_WIDTH_PCT. */
  widthPct: number;
  positionLabel: string;
  /** Screen-reader description, e.g. "Defender from 12' to 18'". */
  accessibleText: string;
}

export interface TimelineLaneRow {
  playerId: string;
  /** Formatted player label, e.g. "#5 Alice Smith". */
  playerLabel: string;
  segments: TimelineSegment[];
}

export interface TimelineGoalMarker {
  key: string;
  /** Horizontal position as % of total duration (clamped). */
  leftPct: number;
  isForUs: boolean;
  /** Minute label, e.g. "23'". */
  minuteLabel: string;
  /** Screen-reader description, e.g. "Goal for us at 23'". */
  accessibleText: string;
}

export interface AxisTick {
  minuteLabel: string;
  leftPct: number;
}

export interface TimelineViewModel {
  isRenderableDuration: boolean;
  emptyStateReason?: string;
  laneRows: TimelineLaneRow[];
  goalMarkers: TimelineGoalMarker[];
  /** Left position (%) for the halftime divider, or null if out of bounds. */
  halftimeDividerPct: number | null;
  axisTicks: AxisTick[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toPercent(seconds: number, gameEndSeconds: number): number {
  return (seconds / gameEndSeconds) * 100;
}

function toMinuteLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}'`;
}

function buildAxisTicks(gameEndSeconds: number): AxisTick[] {
  const gameEndMinutes = Math.ceil(gameEndSeconds / 60);
  // Round up to nearest 5 minutes, targeting ~TARGET_TICK_COUNT ticks.
  const rawInterval = gameEndMinutes / TARGET_TICK_COUNT;
  const tickIntervalMinutes = Math.max(5, Math.ceil(rawInterval / 5) * 5);

  const ticks: AxisTick[] = [];
  for (let minute = tickIntervalMinutes; minute < gameEndMinutes; minute += tickIntervalMinutes) {
    ticks.push({
      minuteLabel: `${minute}'`,
      leftPct: toPercent(minute * 60, gameEndSeconds),
    });
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Input type for goals (duck-typed for compatibility with Schema Goal[])
// ---------------------------------------------------------------------------

export interface GoalInput {
  id: string;
  scoredByUs: boolean | null | undefined;
  gameSeconds: number | null | undefined;
}

// ---------------------------------------------------------------------------
// Main transform
// ---------------------------------------------------------------------------

export function buildTimelineViewModel(input: {
  players: PlayerWithRoster[];
  playTimeRecords: PlayTimeRecord[];
  goals: GoalInput[];
  positions: FormationPosition[];
  gameEndSeconds: number;
  halfLengthSeconds: number;
}): TimelineViewModel {
  const { players, playTimeRecords, goals, positions, gameEndSeconds, halfLengthSeconds } = input;

  // ── Duration guard ──────────────────────────────────────────────────────
  if (!Number.isFinite(gameEndSeconds) || gameEndSeconds <= 0) {
    return {
      isRenderableDuration: false,
      emptyStateReason: "Game duration is not available.",
      laneRows: [],
      goalMarkers: [],
      halftimeDividerPct: null,
      axisTicks: [],
    };
  }

  // ── Position lookup ─────────────────────────────────────────────────────
  const positionMap = new Map<string, string>();
  for (const p of positions) {
    positionMap.set(p.id, p.positionName || "Pos");
  }

  // ── Normalize play-time records ──────────────────────────────────────────
  const normalizedRecords = normalizeCompletedRecords(playTimeRecords, gameEndSeconds);

  // ── Build lane rows ──────────────────────────────────────────────────────
  const sortedPlayers = [...players].sort(compareByJerseyNumber);

  const laneRows: TimelineLaneRow[] = sortedPlayers.map(player => {
    const playerRecords = normalizedRecords.filter(r => r.playerId === player.id);

    // Deterministic ordering: start asc → end asc → id asc
    const sortedRecords = [...playerRecords].sort((a, b) => {
      if (a.startGameSeconds !== b.startGameSeconds) {
        return a.startGameSeconds - b.startGameSeconds;
      }
      const aEnd = a.endGameSeconds ?? gameEndSeconds;
      const bEnd = b.endGameSeconds ?? gameEndSeconds;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return a.id.localeCompare(b.id);
    });

    const segments: TimelineSegment[] = [];
    for (const record of sortedRecords) {
      const start = Math.max(0, record.startGameSeconds);
      const end = Math.min(gameEndSeconds, record.endGameSeconds ?? gameEndSeconds);

      // Drop invalid intervals after clamping
      if (end <= start) continue;

      const rawLeftPct = toPercent(start, gameEndSeconds);
      const rawWidthPct = toPercent(end - start, gameEndSeconds);
      const widthPct = Math.max(rawWidthPct, MIN_WIDTH_PCT);

      const positionLabel = record.positionId
        ? (positionMap.get(record.positionId) ?? "Pos")
        : "Pos";

      const startMinute = Math.floor(start / 60);
      const endMinute = Math.floor(end / 60);
      const accessibleText = `${positionLabel} from ${startMinute}' to ${endMinute}'`;

      segments.push({
        key: record.id,
        leftPct: rawLeftPct,
        widthPct,
        positionLabel,
        accessibleText,
      });
    }

    const num = player.playerNumber;
    const name = `${player.firstName} ${player.lastName}`;
    const playerLabel = num != null ? `#${num} ${name}` : name;

    return {
      playerId: player.id,
      playerLabel,
      segments,
    };
  });

  // ── Goal markers ─────────────────────────────────────────────────────────
  const goalMarkers: TimelineGoalMarker[] = goals
    .filter(
      (g): g is GoalInput & { gameSeconds: number; scoredByUs: boolean } =>
        g.gameSeconds != null &&
        Number.isFinite(g.gameSeconds) &&
        g.scoredByUs != null
    )
    .map(goal => {
      const clamped = Math.max(0, Math.min(gameEndSeconds, goal.gameSeconds));
      const minuteLabel = toMinuteLabel(clamped);
      const accessibleText = goal.scoredByUs
        ? `Goal for us at ${minuteLabel}`
        : `Goal against at ${minuteLabel}`;
      return {
        key: goal.id,
        leftPct: toPercent(clamped, gameEndSeconds),
        isForUs: goal.scoredByUs,
        minuteLabel,
        accessibleText,
      };
    })
    .sort((a, b) => a.leftPct - b.leftPct);

  // ── Halftime divider ─────────────────────────────────────────────────────
  const halftimeDividerPct =
    halfLengthSeconds > 0 && halfLengthSeconds < gameEndSeconds
      ? toPercent(halfLengthSeconds, gameEndSeconds)
      : null;

  // ── Axis ticks ───────────────────────────────────────────────────────────
  const axisTicks = buildAxisTicks(gameEndSeconds);

  return {
    isRenderableDuration: true,
    laneRows,
    goalMarkers,
    halftimeDividerPct,
    axisTicks,
  };
}
