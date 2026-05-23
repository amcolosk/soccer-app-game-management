import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  csvEscapeField,
  buildRotationPlanCsv,
  exportRotationPlanLocally,
} from "./exportRotationPlan";
import type { ExportRotationPlanParams, RotationPlanColumn } from "./exportRotationPlan";

// ── csvEscapeField ───────────────────────────────────────────────────────────

describe("csvEscapeField", () => {
  it("returns plain value when no special characters are present", () => {
    expect(csvEscapeField("Goalkeeper")).toBe("Goalkeeper");
    expect(csvEscapeField("Player One")).toBe("Player One");
    expect(csvEscapeField("")).toBe("");
  });

  it("wraps value in double-quotes when it contains a comma", () => {
    expect(csvEscapeField("Smith, Jr.")).toBe('"Smith, Jr."');
  });

  it("wraps value in double-quotes when it contains a double-quote and escapes internal quotes", () => {
    expect(csvEscapeField('say "hello"')).toBe('"say ""hello"""');
  });

  it("wraps value when it contains a newline", () => {
    expect(csvEscapeField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps value when it contains a carriage return", () => {
    expect(csvEscapeField("line1\rline2")).toBe('"line1\rline2"');
  });
});

// ── buildRotationPlanCsv ─────────────────────────────────────────────────────

describe("buildRotationPlanCsv", () => {
  const positions = [
    { id: "pos-gk", positionName: "Goalkeeper" },
    { id: "pos-fw", positionName: "Forward" },
  ];

  const playersById = new Map<string, string>([
    ["p1", "Ava Keeper"],
    ["p2", "Nia Forward"],
    ["p3", "Sam Sub"],
  ]);

  const startCol: RotationPlanColumn = {
    label: "Start",
    lineup: new Map([
      ["pos-gk", "p1"],
      ["pos-fw", "p2"],
    ]),
  };

  const r1Col: RotationPlanColumn = {
    label: "R1 10'",
    lineup: new Map([
      ["pos-gk", "p1"],
      ["pos-fw", "p3"],
    ]),
  };

  const htCol: RotationPlanColumn = {
    label: "HT",
    lineup: new Map([
      ["pos-gk", "p1"],
      ["pos-fw", "p3"],
    ]),
  };

  const playTimeRows = [
    { playerName: "Ava Keeper", totalMinutes: 60 },
    { playerName: "Nia Forward", totalMinutes: 10 },
    { playerName: "Sam Sub", totalMinutes: 50 },
  ];

  const baseParams: ExportRotationPlanParams = {
    fileStem: "game-abc",
    positions,
    columns: [startCol, r1Col, htCol],
    playTimeRows,
    playersById,
  };

  it("produces a header row with Position and column labels", () => {
    const csv = buildRotationPlanCsv(baseParams);
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toBe("Position,Start,R1 10',HT");
  });

  it("produces one data row per position with correct player names", () => {
    const csv = buildRotationPlanCsv(baseParams);
    const lines = csv.split("\n");
    // Goalkeeper row
    expect(lines[1]).toBe("Goalkeeper,Ava Keeper,Ava Keeper,Ava Keeper");
    // Forward row
    expect(lines[2]).toBe("Forward,Nia Forward,Sam Sub,Sam Sub");
  });

  it("emits an empty cell when no player is assigned to a position in a column", () => {
    const emptyCol: RotationPlanColumn = {
      label: "R2 20'",
      lineup: new Map([["pos-gk", "p1"]]), // pos-fw is unassigned
    };
    const csv = buildRotationPlanCsv({ ...baseParams, columns: [emptyCol] });
    const lines = csv.split("\n");
    expect(lines[2]).toBe("Forward,");
  });

  it("falls back to playerId when player is not in playersById map", () => {
    const unknownCol: RotationPlanColumn = {
      label: "Start",
      lineup: new Map([["pos-gk", "unknown-player-id"]]),
    };
    const csv = buildRotationPlanCsv({
      ...baseParams,
      columns: [unknownCol],
      positions: [{ id: "pos-gk", positionName: "Goalkeeper" }],
    });
    const lines = csv.split("\n");
    expect(lines[1]).toBe("Goalkeeper,unknown-player-id");
  });

  it("separates rotation grid from play-time section with a blank line", () => {
    const csv = buildRotationPlanCsv(baseParams);
    const lines = csv.split("\n");
    // lines[0] = header, lines[1] = GK, lines[2] = FW, lines[3] = blank
    expect(lines[3]).toBe("");
  });

  it("includes Projected Play Time header and player rows", () => {
    const csv = buildRotationPlanCsv(baseParams);
    const lines = csv.split("\n");
    expect(lines[4]).toBe("Projected Play Time");
    expect(lines[5]).toBe("Player,Minutes");
    expect(lines[6]).toBe("Ava Keeper,60");
    expect(lines[7]).toBe("Nia Forward,10");
    expect(lines[8]).toBe("Sam Sub,50");
  });

  it("escapes player names that contain commas", () => {
    const commaPlayer = new Map<string, string>([["p1", "Smith, Jr."]]);
    const col: RotationPlanColumn = {
      label: "Start",
      lineup: new Map([["pos-gk", "p1"]]),
    };
    const csv = buildRotationPlanCsv({
      ...baseParams,
      positions: [{ id: "pos-gk", positionName: "Goalkeeper" }],
      columns: [col],
      playersById: commaPlayer,
      playTimeRows: [{ playerName: "Smith, Jr.", totalMinutes: 30 }],
    });
    const lines = csv.split("\n");
    expect(lines[1]).toBe('Goalkeeper,"Smith, Jr."');
    expect(lines[5]).toBe('"Smith, Jr.",30');
  });

  it("handles an empty columns array gracefully", () => {
    const csv = buildRotationPlanCsv({ ...baseParams, columns: [] });
    expect(csv.split("\n")[0]).toBe("Position");
    // Position rows still present, just no player cells
    expect(csv.split("\n")[1]).toBe("Goalkeeper");
  });

  it("handles an empty playTimeRows array gracefully", () => {
    const csv = buildRotationPlanCsv({ ...baseParams, playTimeRows: [] });
    const lines = csv.split("\n");
    expect(lines[4]).toBe("Projected Play Time");
    expect(lines[5]).toBe("Player,Minutes");
    expect(lines.length).toBe(6);
  });
});

// ── exportRotationPlanLocally ────────────────────────────────────────────────

describe("exportRotationPlanLocally", () => {
  const createObjectURL = vi.fn(() => "blob:test-rotation-url");
  const revokeObjectURL = vi.fn();
  const clickSpy = vi.fn();
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    clickSpy.mockClear();

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

  const minimalParams: ExportRotationPlanParams = {
    fileStem: "game-xyz",
    positions: [{ id: "pos-gk", positionName: "Goalkeeper" }],
    columns: [
      {
        label: "Start",
        lineup: new Map([["pos-gk", "p1"]]),
      },
    ],
    playTimeRows: [{ playerName: "Ava Keeper", totalMinutes: 60 }],
    playersById: new Map([["p1", "Ava Keeper"]]),
  };

  it("returns the correct filename", () => {
    const { filename } = exportRotationPlanLocally(minimalParams);
    expect(filename).toBe("game-xyz.rotation-plan.csv");
  });

  it("creates an object URL, clicks the anchor, and revokes the URL", () => {
    exportRotationPlanLocally(minimalParams);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-rotation-url");
  });

  it("sets anchor rel=noopener", () => {
    let capturedAnchor: { rel: string } | null = null;
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === "a") {
        const a = {
          href: "",
          download: "",
          rel: "",
          click: clickSpy,
        } as unknown as HTMLAnchorElement;
        capturedAnchor = a;
        return a;
      }
      return originalCreateElement(tagName);
    });

    exportRotationPlanLocally(minimalParams);
    expect(capturedAnchor?.rel).toBe("noopener");
  });

  it("serialises CSV content into the Blob with correct MIME type", async () => {
    exportRotationPlanLocally(minimalParams);

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    const content = await blobArg.text();
    // jsdom/Node TextDecoder strips the UTF-8 BOM during decoding (spec-compliant);
    // the BOM bytes are still present in the raw Blob payload and will be visible
    // to Excel in a real browser.
    expect(content).toContain("Position,Start");
    expect(content).toContain("Goalkeeper,Ava Keeper");
    expect(content).toContain("Projected Play Time");
    expect(blobArg.type).toContain("text/csv");
  });

  it("revokes the object URL even if an error is thrown during anchor setup", () => {
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === "a") {
        return {
          get href() {
            return "";
          },
          set href(_v: string) {
            throw new Error("simulated DOM error");
          },
          download: "",
          rel: "",
          click: clickSpy,
        } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tagName);
    });

    expect(() => exportRotationPlanLocally(minimalParams)).toThrow("simulated DOM error");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-rotation-url");
  });
});
