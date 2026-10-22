import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLineupTemplates } from "./useLineupTemplates";
import type { LineupTemplate } from "../../../utils/planTemplateUtils";

const { mockTeamGet, mockTeamUpdate } = vi.hoisted(() => ({
  mockTeamGet: vi.fn(),
  mockTeamUpdate: vi.fn(),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: vi.fn(() => ({
    models: { Team: { get: mockTeamGet, update: mockTeamUpdate } },
  })),
}));

function tpl(id: string, name = id): LineupTemplate {
  return {
    id,
    name,
    startingLineup: [{ positionId: "gk", playerId: "p1" }],
    savedAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
  };
}

function serverHolds(list: LineupTemplate[] | string | null) {
  mockTeamGet.mockResolvedValue({
    data: { id: "team-1", lineupTemplates: typeof list === "string" || list === null ? list : JSON.stringify(list) },
  });
}

function lastWritten(): LineupTemplate[] {
  const call = mockTeamUpdate.mock.calls.at(-1)![0];
  return JSON.parse(call.lineupTemplates) as LineupTemplate[];
}

describe("useLineupTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamUpdate.mockResolvedValue({ data: { id: "team-1" } });
  });

  it("loads templates from Team.get, not from props", async () => {
    serverHolds([tpl("a")]);
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    expect(result.current.templates).toBeUndefined();
    await act(async () => result.current.refresh());
    expect(result.current.templates?.map((t) => t.id)).toEqual(["a"]);
  });

  it("save re-fetches and appends to the fresh list, preserving a template added by another writer", async () => {
    serverHolds([tpl("a")]);
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await act(async () => result.current.refresh());

    serverHolds([tpl("a"), tpl("from-other-coach")]);
    await act(async () =>
      result.current.saveTemplate({ name: "  New  ", startingLineup: [{ positionId: "gk", playerId: "p2" }] })
    );

    expect(lastWritten().map((t) => t.id).slice(0, 2)).toEqual(["a", "from-other-coach"]);
    expect(lastWritten()).toHaveLength(3);
    expect(lastWritten()[2].name).toBe("New");
    expect(result.current.templates).toHaveLength(3);
  });

  it("shows a saved template immediately without a remount", async () => {
    serverHolds([]);
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await act(async () => result.current.refresh());
    await act(async () => {
      await result.current.saveTemplate({ name: "Fresh", startingLineup: [] });
    });
    expect(result.current.templates?.map((t) => t.name)).toEqual(["Fresh"]);
  });

  it("refuses to save past the 10 template cap and writes nothing", async () => {
    serverHolds(Array.from({ length: 10 }, (_, i) => tpl(`t${i}`)));
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await expect(result.current.saveTemplate({ name: "Eleventh", startingLineup: [] })).rejects.toThrow(/up to 10/);
    expect(mockTeamUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty name without writing", async () => {
    serverHolds([]);
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await expect(result.current.saveTemplate({ name: "   ", startingLineup: [] })).rejects.toThrow(/name/i);
    expect(mockTeamUpdate).not.toHaveBeenCalled();
  });

  it("rename updates only the named template, even with duplicate names", async () => {
    serverHolds([tpl("a", "Same"), tpl("b", "Same")]);
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await act(async () => result.current.renameTemplate("b", "Renamed"));
    expect(lastWritten().map((t) => t.name)).toEqual(["Same", "Renamed"]);
  });

  it("deleting the last template writes the string [] rather than omitting the field", async () => {
    serverHolds([tpl("a")]);
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await act(async () => result.current.deleteTemplate("a"));
    expect(mockTeamUpdate).toHaveBeenCalledWith({ id: "team-1", lineupTemplates: "[]" });
    expect(result.current.templates).toEqual([]);
  });

  it("makes no write when the stored JSON cannot be parsed", async () => {
    serverHolds("{broken");
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await expect(result.current.saveTemplate({ name: "x", startingLineup: [] })).rejects.toThrow();
    expect(mockTeamUpdate).not.toHaveBeenCalled();
  });

  it("reports a load error and falls back to an empty list when the stored JSON is unreadable", async () => {
    serverHolds("{broken");
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await act(async () => result.current.refresh());
    expect(result.current.loadError).toBeTruthy();
    expect(result.current.templates).toEqual([]);
  });

  it("shows valid templates despite one malformed entry, but refuses to write over unreadable data", async () => {
    serverHolds(JSON.stringify([tpl("a"), { id: "bad" }]));
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await act(async () => result.current.refresh());
    expect(result.current.loadError).toBeNull();
    expect(result.current.templates?.map((t) => t.id)).toEqual(["a"]);
    await expect(result.current.deleteTemplate("a")).rejects.toThrow(/unexpected format/i);
    expect(mockTeamUpdate).not.toHaveBeenCalled();
  });

  it("surfaces an update failure and leaves state unchanged", async () => {
    serverHolds([tpl("a")]);
    mockTeamUpdate.mockResolvedValue({ data: null, errors: [{ message: "boom" }] });
    const { result } = renderHook(() => useLineupTemplates("team-1"));
    await act(async () => result.current.refresh());
    await expect(result.current.deleteTemplate("a")).rejects.toThrow("boom");
    expect(result.current.templates).toHaveLength(1);
  });
});
