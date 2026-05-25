import { describe, it, expect } from "vitest";
import { buildTimelineViewModel } from "./completedGameTimelineTransform";
import type { PlayerWithRoster, PlayTimeRecord, FormationPosition } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePlayer = (
  id: string,
  playerNumber: number | null | undefined,
  firstName = "Alice",
  lastName = "Smith"
): PlayerWithRoster =>
  ({
    id,
    playerNumber: playerNumber ?? undefined,
    firstName,
    lastName,
    isActive: true,
    preferredPositions: "",
  } as PlayerWithRoster);

const makeRecord = (
  id: string,
  playerId: string,
  startGameSeconds: number,
  endGameSeconds: number | null | undefined,
  positionId = "pos-1"
): PlayTimeRecord =>
  ({
    id,
    gameId: "game-1",
    playerId,
    positionId,
    startGameSeconds,
    endGameSeconds: endGameSeconds ?? null,
    coaches: [],
  } as unknown as PlayTimeRecord);

const makeGoal = (
  id: string,
  scoredByUs: boolean,
  gameSeconds: number
) => ({ id, scoredByUs, gameSeconds });

const makePosition = (id: string, positionName: string): FormationPosition =>
  ({ id, positionName } as unknown as FormationPosition);

const BASE_INPUT = {
  players: [makePlayer("p1", 5)],
  playTimeRecords: [],
  goals: [],
  positions: [makePosition("pos-1", "Forward")],
  gameEndSeconds: 3600, // 60 minutes
  halfLengthSeconds: 1800, // 30 minutes
};

// ---------------------------------------------------------------------------
// Duration guard
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – duration guard", () => {
  it.each([
    ["zero", 0],
    ["negative", -100],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("returns isRenderableDuration=false for %s gameEndSeconds", (_label, gameEndSeconds) => {
    const vm = buildTimelineViewModel({ ...BASE_INPUT, gameEndSeconds });
    expect(vm.isRenderableDuration).toBe(false);
    expect(vm.laneRows).toHaveLength(0);
    expect(vm.goalMarkers).toHaveLength(0);
    expect(vm.halftimeDividerPct).toBeNull();
    expect(vm.axisTicks).toHaveLength(0);
    expect(vm.emptyStateReason).toBeTruthy();
  });

  it("returns isRenderableDuration=true for a positive finite duration", () => {
    const vm = buildTimelineViewModel({ ...BASE_INPUT, gameEndSeconds: 3600 });
    expect(vm.isRenderableDuration).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Player sorting
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – player sort", () => {
  it("sorts players ascending by jersey number", () => {
    const players = [
      makePlayer("p3", 15, "Charlie", "Brown"),
      makePlayer("p1", 3, "Alice", "Smith"),
      makePlayer("p2", 9, "Bob", "Jones"),
    ];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, players });
    expect(vm.laneRows.map(r => r.playerId)).toEqual(["p1", "p2", "p3"]);
  });

  it("places null/undefined jersey numbers last", () => {
    const players = [
      makePlayer("p2", undefined, "No", "Number"),
      makePlayer("p1", 5, "Alice", "Smith"),
    ];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, players });
    expect(vm.laneRows[0].playerId).toBe("p1");
    expect(vm.laneRows[1].playerId).toBe("p2");
  });

  it("uses id as tie-breaker for two players with null jersey", () => {
    const players = [
      makePlayer("p-b", undefined, "Bob", "B"),
      makePlayer("p-a", undefined, "Alice", "A"),
    ];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, players });
    expect(vm.laneRows[0].playerId).toBe("p-a");
    expect(vm.laneRows[1].playerId).toBe("p-b");
  });
});

// ---------------------------------------------------------------------------
// Interval clamping and filtering
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – interval clamping", () => {
  it("clamps intervals exceeding gameEndSeconds", () => {
    const records = [makeRecord("r1", "p1", 0, 5000)]; // ends beyond 3600
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    const seg = vm.laneRows[0].segments[0];
    // width% should be 100 (0 to 3600)
    expect(seg.leftPct).toBe(0);
    expect(seg.widthPct).toBeGreaterThanOrEqual(100);
  });

  it("clamps intervals with negative start to 0", () => {
    const records = [makeRecord("r1", "p1", -60, 600)]; // start before 0
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    const seg = vm.laneRows[0].segments[0];
    expect(seg.leftPct).toBe(0);
  });

  it("drops an interval that starts at or after gameEndSeconds", () => {
    const records = [makeRecord("r1", "p1", 3600, null)]; // starts exactly at end
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    expect(vm.laneRows[0].segments).toHaveLength(0);
  });

  it("drops an interval where end <= start after clamping", () => {
    const records = [makeRecord("r1", "p1", 3500, 3400)]; // end < start
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    expect(vm.laneRows[0].segments).toHaveLength(0);
  });

  it("normalizes null endGameSeconds to gameEndSeconds", () => {
    const records = [makeRecord("r1", "p1", 0, null)]; // open record
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    expect(vm.laneRows[0].segments).toHaveLength(1);
    // should span the full width
    expect(vm.laneRows[0].segments[0].widthPct).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Minimum width enforcement
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – minimum width", () => {
  it("enforces MIN_WIDTH_PCT for very short intervals", () => {
    // 1 second interval in a 3600 second game → 1/3600 * 100 ≈ 0.028%
    const records = [makeRecord("r1", "p1", 1800, 1801)];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    const seg = vm.laneRows[0].segments[0];
    expect(seg.widthPct).toBeGreaterThanOrEqual(2);
  });

  it("preserves natural width for intervals above the minimum", () => {
    // 900 second interval (25% of 3600s) should be near 25%
    const records = [makeRecord("r1", "p1", 0, 900)];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    const seg = vm.laneRows[0].segments[0];
    expect(seg.widthPct).toBeCloseTo(25, 1);
  });
});

// ---------------------------------------------------------------------------
// Position labels and accessible text
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – accessible text", () => {
  it("includes position name in segment accessible text", () => {
    const records = [makeRecord("r1", "p1", 720, 1080, "pos-1")]; // 12'–18'
    const vm = buildTimelineViewModel({
      ...BASE_INPUT,
      playTimeRecords: records,
      positions: [makePosition("pos-1", "Defender")],
    });
    expect(vm.laneRows[0].segments[0].accessibleText).toBe("Defender from 12' to 18'");
  });

  it("falls back to 'Pos' for unknown positionId", () => {
    const records = [makeRecord("r1", "p1", 0, 600, "unknown-pos")];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    expect(vm.laneRows[0].segments[0].accessibleText).toContain("Pos from");
  });

  it("falls back to 'Pos' for null positionId", () => {
    const records = [
      {
        ...makeRecord("r1", "p1", 0, 600, "pos-1"),
        positionId: null,
      },
    ];
    const vm = buildTimelineViewModel({
      ...BASE_INPUT,
      playTimeRecords: records as unknown as PlayTimeRecord[],
    });
    expect(vm.laneRows[0].segments[0].positionLabel).toBe("Pos");
  });
});

// ---------------------------------------------------------------------------
// Zero-play-time rows
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – zero-play-time rows", () => {
  it("includes a player row even when they have no play time", () => {
    const players = [
      makePlayer("p1", 5, "Alice", "Smith"),
      makePlayer("p2", 7, "Bob", "Jones"),
    ];
    // Only p1 has a record
    const records = [makeRecord("r1", "p1", 0, 900)];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, players, playTimeRecords: records });
    expect(vm.laneRows).toHaveLength(2);
    const bobRow = vm.laneRows.find(r => r.playerId === "p2");
    expect(bobRow).toBeDefined();
    expect(bobRow!.segments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Player label
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – player label", () => {
  it("includes jersey number when available", () => {
    const players = [makePlayer("p1", 10, "Alice", "Smith")];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, players });
    expect(vm.laneRows[0].playerLabel).toBe("#10 Alice Smith");
  });

  it("omits jersey prefix when playerNumber is null", () => {
    const players = [makePlayer("p1", null, "Alice", "Smith")];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, players });
    expect(vm.laneRows[0].playerLabel).toBe("Alice Smith");
  });
});

// ---------------------------------------------------------------------------
// Goal markers
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – goal markers", () => {
  it("emits a marker for each valid goal", () => {
    const goals = [
      makeGoal("g1", true, 900),
      makeGoal("g2", false, 2700),
    ];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers).toHaveLength(2);
  });

  it("marks team goals as isForUs=true", () => {
    const goals = [makeGoal("g1", true, 900)];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers[0].isForUs).toBe(true);
  });

  it("marks opponent goals as isForUs=false", () => {
    const goals = [makeGoal("g1", false, 900)];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers[0].isForUs).toBe(false);
  });

  it("generates correct accessible text for a team goal", () => {
    const goals = [makeGoal("g1", true, 1380)]; // 23 minutes
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers[0].accessibleText).toBe("Goal for us at 23'");
  });

  it("generates correct accessible text for an opponent goal", () => {
    const goals = [makeGoal("g1", false, 2460)]; // 41 minutes
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers[0].accessibleText).toBe("Goal against at 41'");
  });

  it("clamps goal markers that exceed gameEndSeconds", () => {
    const goals = [makeGoal("g1", true, 5000)];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers[0].leftPct).toBe(100);
  });

  it("clamps goal markers below 0 to 0", () => {
    const goals = [makeGoal("g1", false, -100)];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers[0].leftPct).toBe(0);
  });

  it("filters goals with null gameSeconds", () => {
    const goals = [{ id: "g1", scoredByUs: true, gameSeconds: null }];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers).toHaveLength(0);
  });

  it("filters goals with null scoredByUs", () => {
    const goals = [{ id: "g1", scoredByUs: null, gameSeconds: 900 }];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers).toHaveLength(0);
  });

  it("sorts markers ascending by position", () => {
    const goals = [
      makeGoal("g2", false, 2700),
      makeGoal("g1", true, 900),
    ];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, goals });
    expect(vm.goalMarkers[0].key).toBe("g1");
    expect(vm.goalMarkers[1].key).toBe("g2");
  });
});

// ---------------------------------------------------------------------------
// Halftime divider
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – halftime divider", () => {
  it("returns a halftime position when halfLengthSeconds is within bounds", () => {
    const vm = buildTimelineViewModel({
      ...BASE_INPUT,
      gameEndSeconds: 3600,
      halfLengthSeconds: 1800,
    });
    expect(vm.halftimeDividerPct).toBeCloseTo(50, 1);
  });

  it("returns null when halfLengthSeconds equals gameEndSeconds", () => {
    const vm = buildTimelineViewModel({
      ...BASE_INPUT,
      gameEndSeconds: 1800,
      halfLengthSeconds: 1800,
    });
    expect(vm.halftimeDividerPct).toBeNull();
  });

  it("returns null when halfLengthSeconds is 0", () => {
    const vm = buildTimelineViewModel({ ...BASE_INPUT, halfLengthSeconds: 0 });
    expect(vm.halftimeDividerPct).toBeNull();
  });

  it("returns null when halfLengthSeconds exceeds gameEndSeconds", () => {
    const vm = buildTimelineViewModel({
      ...BASE_INPUT,
      gameEndSeconds: 3600,
      halfLengthSeconds: 4000,
    });
    expect(vm.halftimeDividerPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Axis ticks
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – axis ticks", () => {
  it("generates ticks for a standard 60-minute game", () => {
    const vm = buildTimelineViewModel({ ...BASE_INPUT, gameEndSeconds: 3600 });
    expect(vm.axisTicks.length).toBeGreaterThanOrEqual(4);
    // First tick should be at 10' (10/60 * 100 ≈ 16.7%)
    expect(vm.axisTicks[0].minuteLabel).toBe("10'");
  });

  it("all ticks are within [0, 100]%", () => {
    const vm = buildTimelineViewModel({ ...BASE_INPUT, gameEndSeconds: 3600 });
    for (const tick of vm.axisTicks) {
      expect(tick.leftPct).toBeGreaterThan(0);
      expect(tick.leftPct).toBeLessThan(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic interval ordering within a lane
// ---------------------------------------------------------------------------

describe("buildTimelineViewModel – deterministic interval ordering", () => {
  it("sorts segments by startGameSeconds ascending", () => {
    const records = [
      makeRecord("r2", "p1", 900, 1800),
      makeRecord("r1", "p1", 0, 600),
    ];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    const segs = vm.laneRows[0].segments;
    expect(segs[0].key).toBe("r1");
    expect(segs[1].key).toBe("r2");
  });

  it("uses id as tie-breaker for equal start/end", () => {
    const records = [
      makeRecord("r-b", "p1", 0, 600),
      makeRecord("r-a", "p1", 0, 600),
    ];
    const vm = buildTimelineViewModel({ ...BASE_INPUT, playTimeRecords: records });
    const segs = vm.laneRows[0].segments;
    expect(segs[0].key).toBe("r-a");
    expect(segs[1].key).toBe("r-b");
  });
});
