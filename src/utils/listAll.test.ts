import { describe, it, expect, vi } from "vitest";
import { listAll } from "./listAll";

describe("listAll", () => {
  it("follows nextToken across pages, including empty filtered-scan pages", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], nextToken: "t1" })
      .mockResolvedValueOnce({ data: [], nextToken: "t2" })
      .mockResolvedValueOnce({ data: [{ id: "b" }, { id: "c" }], nextToken: null });

    const rows = await listAll<{ id: string }>({ list }, { gamePlanId: { eq: "gp-1" } });

    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenNthCalledWith(1, { limit: 1000, filter: { gamePlanId: { eq: "gp-1" } } });
    expect(list).toHaveBeenNthCalledWith(2, { limit: 1000, filter: { gamePlanId: { eq: "gp-1" } }, nextToken: "t1" });
    expect(list).toHaveBeenNthCalledWith(3, { limit: 1000, filter: { gamePlanId: { eq: "gp-1" } }, nextToken: "t2" });
  });

  it("makes a single call when there is no nextToken", async () => {
    const list = vi.fn().mockResolvedValueOnce({ data: [{ id: "a" }] });
    expect(await listAll<{ id: string }>({ list })).toEqual([{ id: "a" }]);
    expect(list).toHaveBeenCalledWith({ limit: 1000 });
  });
});
