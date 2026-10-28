import { describe, expect, it } from "vitest";
import { exceedsPlayersDownCap, getPlayersDownCount, getSendOffSummaries, filterPlannedSubstitutions, filterRotationsForSendOffs, getLockedPositionIds, getSentOffPlayerIds, isActiveSendOff, withPendingSendOffs } from "./sendOffCalculations";

const positions = [
  { id: "gk", role: "GOALKEEPER" as const },
  { id: "cb", role: "DEFENDER" as const },
  { id: "st", role: "FORWARD" as const },
];

const note = (overrides: Record<string, unknown> = {}) => ({
  noteType: "red-card",
  playerId: "p1",
  positionId: "cb",
  rescindedAt: null,
  ...overrides,
}) as never;

describe("sendOffCalculations", () => {
  it("treats only un-rescinded red cards with a player as send-offs", () => {
    expect(isActiveSendOff(note())).toBe(true);
    expect(isActiveSendOff(note({ rescindedAt: "2026-10-26T00:00:00Z" }))).toBe(false);
    expect(isActiveSendOff(note({ noteType: "yellow-card" }))).toBe(false);
    expect(isActiveSendOff(note({ playerId: null }))).toBe(false);
  });

  it("collects sent-off players, including bench players with no position", () => {
    const ids = getSentOffPlayerIds([note(), note({ playerId: "p2", positionId: null }), note({ playerId: "p3", rescindedAt: "x" })]);
    expect([...ids].sort()).toEqual(["p1", "p2"]);
  });

  it("locks the vacated position of each active send-off (multiple cards supported)", () => {
    const ids = getLockedPositionIds([note(), note({ playerId: "p2", positionId: "st" })], positions);
    expect([...ids].sort()).toEqual(["cb", "st"]);
  });

  it("does not lock a position whose send-off was rescinded", () => {
    expect(getLockedPositionIds([note({ rescindedAt: "x" })], positions).size).toBe(0);
  });

  it("re-locks a position after a rescind followed by a new card there", () => {
    const ids = getLockedPositionIds([note({ rescindedAt: "x" }), note({ playerId: "p9" })], positions);
    expect([...ids]).toEqual(["cb"]);
  });

  it("never locks a goalkeeper position", () => {
    expect(getLockedPositionIds([note({ positionId: "gk" })], positions).size).toBe(0);
  });

  it("applies a locally recorded send-off before its note has synced", () => {
    const merged = withPendingSendOffs([], [{ playerId: "p1", positionId: "cb" }]);
    expect([...getSentOffPlayerIds(merged)]).toEqual(["p1"]);
    expect([...getLockedPositionIds(merged, positions)]).toEqual(["cb"]);
  });

  it("stops applying the pending entry once any card note for that player has synced (including a rescinded one)", () => {
    const rescinded = note({ rescindedAt: "x" });
    const merged = withPendingSendOffs([rescinded], [{ playerId: "p1", positionId: "cb" }]);
    expect(getSentOffPlayerIds(merged).size).toBe(0);
    expect(getLockedPositionIds(merged, positions).size).toBe(0);
  });

  it("ignores red cards without a vacated position", () => {
    expect(getLockedPositionIds([note({ positionId: null })], positions).size).toBe(0);
  });
});

describe("filterPlannedSubstitutions", () => {
  const subs = [
    { playerOutId: "a", playerInId: "b", positionId: "cb" },
    { playerOutId: "c", playerInId: "d", positionId: "st" },
    { playerOutId: "e", playerInId: "f", positionId: "mid" },
  ];

  it("drops subs into a locked position", () => {
    const out = filterPlannedSubstitutions(subs, new Set(["cb"]), new Set());
    expect(out.map((s) => s.positionId)).toEqual(["st", "mid"]);
  });

  it("drops subs where the sent-off player comes in or goes out", () => {
    const out = filterPlannedSubstitutions(subs, new Set(), new Set(["d", "e"]));
    expect(out.map((s) => s.positionId)).toEqual(["cb"]);
  });

  it("keeps everything when nothing is sent off", () => {
    expect(filterPlannedSubstitutions(subs, new Set(), new Set())).toEqual(subs);
  });
});

describe("filterRotationsForSendOffs", () => {
  const rotation = (id: string, subs: unknown) => ({ id, plannedSubstitutions: typeof subs === "string" ? subs : JSON.stringify(subs) });
  const cbSub = { playerOutId: "a", playerInId: "b", positionId: "cb" };
  const stSub = { playerOutId: "c", playerInId: "d", positionId: "st" };

  it("returns the same array when nobody is sent off", () => {
    const rotations = [rotation("r1", [cbSub])];
    expect(filterRotationsForSendOffs(rotations, new Set(), new Set())).toBe(rotations);
  });

  it("trims invalid subs and drops rotations that become empty", () => {
    const out = filterRotationsForSendOffs(
      [rotation("r1", [cbSub, stSub]), rotation("r2", [cbSub])],
      new Set(["cb"]),
      new Set(),
    );
    expect(out.map((r) => r.id)).toEqual(["r1"]);
    expect(JSON.parse(out[0].plannedSubstitutions)).toEqual([stSub]);
  });

  it("keeps rotations that were already empty or unparseable", () => {
    const out = filterRotationsForSendOffs(
      [rotation("r1", []), rotation("r2", "not json")],
      new Set(["cb"]),
      new Set(),
    );
    expect(out.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("getSendOffSummaries", () => {
  it("reports minutes played a player down and skips rescinded cards", () => {
    const out = getSendOffSummaries(
      [
        { ...note({ playerId: "late" }), gameSeconds: 2400 },
        { ...note({ playerId: "early" }), gameSeconds: 600 },
        { ...note({ playerId: "typo", rescindedAt: "2026-10-27T00:00:00Z" }), gameSeconds: 900 },
        { ...note({ noteType: "yellow-card", playerId: "yellow" }), gameSeconds: 100 },
      ],
      3600,
    );
    expect(out).toEqual([
      { playerId: "early", sentOffSeconds: 600, playedDownSeconds: 3000 },
      { playerId: "late", sentOffSeconds: 2400, playedDownSeconds: 1200 },
    ]);
  });
});

describe("players down", () => {
  it("counts active send-offs of on-field players, goalkeeper included", () => {
    expect(
      getPlayersDownCount([
        note({ playerId: "a", positionId: "gk" }),
        note({ playerId: "b", positionId: "cb" }),
        note({ playerId: "bench", positionId: null }),
        note({ playerId: "typo", positionId: "st", rescindedAt: "2026-10-27T00:00:00Z" }),
      ]),
    ).toBe(2);
  });

  it("caps the field once the team is a player down", () => {
    expect(exceedsPlayersDownCap(10, 11, 1)).toBe(true);
    expect(exceedsPlayersDownCap(9, 11, 1)).toBe(false);
    expect(exceedsPlayersDownCap(11, 11, 0)).toBe(false);
  });
});
