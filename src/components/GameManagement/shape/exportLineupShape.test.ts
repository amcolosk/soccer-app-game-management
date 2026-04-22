import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { exportLineupShapeLocally } from "./exportLineupShape";
import type { LineupShapeNode } from "./lineupShapeDeterminism";
import type { LineupAssignment, PlayerWithRoster } from "../types";

describe("exportLineupShape", () => {
  const createObjectURL = vi.fn(() => "blob:test-url");
  const revokeObjectURL = vi.fn();
  const clickSpy = vi.fn();
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });

    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === "a") {
        return {
          href: "",
          download: "",
          rel: "",
          click: clickSpy,
        } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tagName);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports a local-only lineup shape payload with bench strip", async () => {
    const nodes: LineupShapeNode[] = [
      {
        positionId: "pos-gk",
        positionName: "Goalkeeper",
        abbreviation: "GK",
        lane: "gk",
        laneIndex: 3,
        slotIndex: 0,
        xPct: 50,
        yPct: 86,
      },
    ];

    const lineup = [
      {
        id: "la-gk",
        positionId: "pos-gk",
        playerId: "p1",
        isStarter: true,
      },
    ] as LineupAssignment[];

    const playersById = new Map<string, PlayerWithRoster>([
      [
        "p1",
        {
          id: "p1",
          firstName: "Ava",
          lastName: "Keeper",
          playerNumber: 1,
          isActive: true,
        } as unknown as PlayerWithRoster,
      ],
    ]);

    const result = exportLineupShapeLocally({
      fileStem: "game-123",
      layoutVersion: "soccer-shape-v1",
      nodes,
      lineup,
      playersById,
      benchStrip: [
        {
          playerId: "p2",
          playerNumber: 9,
          name: "Nia Bench",
          playTimeSeconds: 120,
        },
      ],
      exportedAtIso: "2026-04-22T00:00:00.000Z",
    });

    expect(result.filename).toBe("game-123.lineup-shape.json");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    const exportedRaw = await blobArg.text();
    const exported = JSON.parse(exportedRaw) as {
      meta: Record<string, unknown>;
    };

    expect(exported.meta).toMatchObject({
      exportedAt: "2026-04-22T00:00:00.000Z",
      localOnly: true,
      offlineFirst: true,
      layoutVersion: "soccer-shape-v1",
    });
    expect(exported.meta).not.toHaveProperty("exportedByUserId");
    expect(exportedRaw).not.toContain("coach-abc");
  });
});
