# Implementation Plan: Export Rotation Plan as CSV

**Status:** Ready for implementation  
**Feature:** "Export Plan as CSV" button on the Plan Tab  
**Author:** planning-agent  
**Date:** 2025-07

---

## 1. Summary

Add a full-width `"Export Plan as CSV"` button to `PlanTab.tsx` that downloads a CSV file containing the rotation table (positions × time columns) and a playtime summary section. The button is visible whenever `gamePlan !== null` and is disabled (with tooltip) when no planned rotations exist yet.

No new npm dependencies. No backend changes. Pure client-side download via `URL.createObjectURL` → anchor → click → revoke.

---

## 2. Files to Create or Modify

| File | Action | Notes |
|------|--------|-------|
| `src/components/GameManagement/shape/exportRotationPlan.ts` | **CREATE** | New pure-function CSV utility |
| `src/components/GameManagement/shape/exportRotationPlan.test.ts` | **CREATE** | Unit tests for the utility |
| `src/components/GameManagement/PlanTab.tsx` | **MODIFY** | Add import, callback, button JSX |
| `src/components/GameManagement/PlanTab.test.tsx` | **MODIFY** | Add 2 button test cases + mock |
| `src/App.css` | **MODIFY** | Add `.plan-tab__export-btn` CSS rule |

---

## 3. File 1 — CREATE `src/components/GameManagement/shape/exportRotationPlan.ts`

### 3.1 Exports

```ts
export interface ExportRotationPlanParams {
  fileStem: string;
  positions: FormationPosition[];
  players: PlayerWithRoster[];
  startingLineup: Map<string, string>;               // positionId → playerId
  h1RotationRows: Array<{
    rotationNumber: number;
    gameMinute?: number | null;
    plannedSubstitutions: string;
  }>;
  h2RotationRows: Array<{
    rotationNumber: number;
    gameMinute?: number | null;
    plannedSubstitutions: string;
  }>;
  effectiveHalftimeLineup: Map<string, string>;
  projectedPlayTimeRows: Array<{ playerName: string; totalMinutes: number }>;
  exportedAtIso?: string;
}

export function buildRotationCsv(params: ExportRotationPlanParams): string { ... }
export function exportRotationPlanLocally(params: ExportRotationPlanParams): { filename: string } { ... }
```

### 3.2 Imports needed in this file

```ts
import type { FormationPosition, PlayerWithRoster } from "../types";
import { computeLineupAtRotation } from "../../../utils/gamePlannerUtils";
```

### 3.3 `buildRotationCsv` — algorithm

**Step 1: Build column header list**

```
columns = ["Position", "Start"]
  + h1RotationRows.map(r => r.gameMinute != null ? `R${r.rotationNumber} (${r.gameMinute}m)` : `R${r.rotationNumber}`)
  + ["HT"]
  + h2RotationRows.map(r => r.gameMinute != null ? `R${r.rotationNumber} (${r.gameMinute}m)` : `R${r.rotationNumber}`)
```

**Step 2: Build lineup snapshot Maps**

- `startSnap` = `startingLineup`
- `h1Snaps[i]` = `computeLineupAtRotation(startingLineup, h1RotationRows, h1RotationRows[i].rotationNumber)` for each i
- `htSnap` = `effectiveHalftimeLineup`
- `h2Snaps[i]` = `computeLineupAtRotation(effectiveHalftimeLineup, h2RotationRows, h2RotationRows[i].rotationNumber)` for each i

**Step 3: Build player lookup**

```ts
const playerById = new Map<string, PlayerWithRoster>(players.map(p => [p.id, p]));
function playerName(id: string | undefined): string {
  if (!id) return "";
  const p = playerById.get(id);
  if (!p) return `Unknown (${id})`;
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || id;
}
```

**Step 4: Build data rows**

For each position (in `positions` array order):
```
cells = [
  position.name,                         // "Position" column
  playerName(startSnap.get(pos.id)),    // "Start" column
  ...h1Snaps.map(snap => playerName(snap.get(pos.id))),
  playerName(htSnap.get(pos.id)),       // "HT" column
  ...h2Snaps.map(snap => playerName(snap.get(pos.id))),
]
```

**Step 5: Build playtime summary section**

```
"" (blank separator row)
["Player", "Minutes"]
...projectedPlayTimeRows.map(r => [r.playerName, String(r.totalMinutes)])
```

**Step 6: CSV escaping helper**

```ts
function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}
```

**Step 7: Assemble**

```ts
const lines: string[] = [
  csvRow(headerRow),
  ...dataRows.map(csvRow),
  "",   // blank separator
  csvRow(["Player", "Minutes"]),
  ...projectedPlayTimeRows.map(r => csvRow([r.playerName, String(r.totalMinutes)])),
];
return lines.join("\r\n");
```

> **Note:** Use `\r\n` line endings for maximum Excel compatibility.

### 3.4 `exportRotationPlanLocally` — download trigger

Mirrors `exportLineupShapeLocally` exactly:

```ts
export function exportRotationPlanLocally(params: ExportRotationPlanParams): { filename: string } {
  const csv = buildRotationCsv(params);
  const filename = `${params.fileStem}.rotation-plan.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return { filename };
}
```

---

## 4. File 2 — CREATE `src/components/GameManagement/shape/exportRotationPlan.test.ts`

### 4.1 Stub setup (mirrors `exportLineupShape.test.ts` lines 6–32)

```ts
describe("exportRotationPlan", () => {
  const createObjectURL = vi.fn(() => "blob:test-url");
  const revokeObjectURL = vi.fn();
  const clickSpy = vi.fn();
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === "a") {
        return { href: "", download: "", rel: "", click: clickSpy } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tagName);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
```

### 4.2 Shared test fixture

```ts
const positions: FormationPosition[] = [
  { id: "pos-gk", name: "Goalkeeper", abbreviation: "GK" } as FormationPosition,
  { id: "pos-fw", name: "Forward", abbreviation: "FW" } as FormationPosition,
];
const players: PlayerWithRoster[] = [
  { id: "p1", firstName: "Alice", lastName: "Smith", playerNumber: 1 } as PlayerWithRoster,
  { id: "p2", firstName: "Bob", lastName: "Jones", playerNumber: 7 } as PlayerWithRoster,
  { id: "p3", firstName: "Carol", lastName: "Lee", playerNumber: 9 } as PlayerWithRoster,
];
const startingLineup = new Map([["pos-gk", "p1"], ["pos-fw", "p2"]]);
const h1RotationRows = [
  {
    rotationNumber: 1,
    gameMinute: 10,
    plannedSubstitutions: JSON.stringify([
      { positionId: "pos-fw", playerOutId: "p2", playerInId: "p3" }
    ]),
  },
];
const h2RotationRows: typeof h1RotationRows = [];
const effectiveHalftimeLineup = new Map([["pos-gk", "p1"], ["pos-fw", "p3"]]);
const projectedPlayTimeRows = [
  { playerName: "Alice Smith", totalMinutes: 60 },
  { playerName: "Bob Jones", totalMinutes: 30 },
  { playerName: "Carol Lee", totalMinutes: 30 },
];
const baseParams = {
  fileStem: "game-123",
  positions,
  players,
  startingLineup,
  h1RotationRows,
  h2RotationRows,
  effectiveHalftimeLineup,
  projectedPlayTimeRows,
  exportedAtIso: "2026-01-01T00:00:00.000Z",
};
```

### 4.3 Test cases

1. **Filename** — `result.filename === "game-123.rotation-plan.csv"`
2. **Trigger mechanics** — `createObjectURL` called once, `clickSpy` called once, `revokeObjectURL` called with `"blob:test-url"`
3. **Header row** — CSV contains line starting with `Position,Start,R1 (10m),HT`
4. **Start column** — row for Goalkeeper contains `Alice Smith` in Start column
5. **H1 rotation column** — row for Forward contains `Carol Lee` after R1 substitution
6. **HT column** — row for Forward has `Carol Lee` in HT column (from `effectiveHalftimeLineup`)
7. **Playtime summary** — CSV contains `Player,Minutes` section below a blank line; contains `Alice Smith,60`
8. **Comma quoting** — cell value `"Smith, Jr."` is wrapped in double-quotes in output

For test 8, call `buildRotationCsv` directly with a player whose name contains a comma.

### 4.4 Reading blob content in tests

```ts
const blobArg = createObjectURL.mock.calls[0][0] as Blob;
const csv = await blobArg.text();
// then assert on csv string
```

---

## 5. File 3 — MODIFY `src/components/GameManagement/PlanTab.tsx`

### 5.1 Add import

After the existing import block (line ~31), add:

```ts
import { exportRotationPlanLocally } from "./shape/exportRotationPlan";
```

### 5.2 Add `handleExportPlan` useCallback

After `handleResetHalfLengthToDefault` (which ends at line 815), insert:

```ts
const handleExportPlan = useCallback(() => {
  exportRotationPlanLocally({
    fileStem: game.id,
    positions,
    players,
    startingLineup: planner.draft.startingLineup,
    h1RotationRows: h1RotationRows.map((r) => ({
      ...r,
      gameMinute:
        effectivePlannedRotations.find((er) => er.rotationNumber === r.rotationNumber)
          ?.gameMinute ?? null,
    })),
    h2RotationRows: h2RotationRows.map((r) => ({
      ...r,
      gameMinute:
        effectivePlannedRotations.find((er) => er.rotationNumber === r.rotationNumber)
          ?.gameMinute ?? null,
    })),
    effectiveHalftimeLineup,
    projectedPlayTimeRows,
  });
}, [
  game.id,
  positions,
  players,
  planner.draft.startingLineup,
  h1RotationRows,
  h2RotationRows,
  effectivePlannedRotations,
  effectiveHalftimeLineup,
  projectedPlayTimeRows,
]);
```

> **Context note:** `h1RotationRows` and `h2RotationRows` in `PlanTab.tsx` (lines 316–338) are already computed from `effectivePlannedRotations`, but they omit `gameMinute`. The callback above merges `gameMinute` from `effectivePlannedRotations` at call time so the CSV column headers are accurate.

### 5.3 Add button JSX

**Location:** After the closing `</div>` of the `projected-playtime` block (line 1280) and before `{/* 9. Copy-from-game modal */}` (line 1282).

**Exact `old_str` for the edit tool:**

```
      {/* 9. Copy-from-game modal */}
      {isCopyModalOpen && onCloseCopyModal && (
```

**New `new_str`:**

```
      {/* 8b. Export Plan as CSV */}
      {gamePlan && (
        <div className="plan-tab__export-section">
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
        </div>
      )}

      {/* 9. Copy-from-game modal */}
      {isCopyModalOpen && onCloseCopyModal && (
```

---

## 6. File 4 — MODIFY `src/components/GameManagement/PlanTab.test.tsx`

### 6.1 Add mock

Add after the last `vi.mock(...)` call and before `import { useGamePlanner }` (line 75):

```ts
vi.mock("./shape/exportRotationPlan", () => ({
  exportRotationPlanLocally: vi.fn().mockReturnValue({ filename: "game-1.rotation-plan.csv" }),
}));
```

Then add the named import after the vi.mock declaration:

```ts
import { exportRotationPlanLocally } from "./shape/exportRotationPlan";
```

> **Vitest hoisting note:** `vi.mock` calls are hoisted above imports automatically. The import for `exportRotationPlanLocally` must appear after the `vi.mock` declaration in source order so TypeScript resolves the type — Vitest will still hoist the mock factory ahead of the module resolution.

### 6.2 Add test cases (append inside `describe("PlanTab")` block)

**Test A — button enabled when rotations present:**

```ts
it("renders Export Plan as CSV button enabled when gamePlan and rotations exist", () => {
  render(<PlanTab {...defaultProps} />);
  const btn = screen.getByRole("button", { name: /export plan as csv/i });
  expect(btn).toBeInTheDocument();
  expect(btn).toBeEnabled();
  expect(btn).toHaveAttribute("type", "button");
});
```

**Test B — button disabled with tooltip when no rotations (required by UI review):**

```ts
it("disables Export Plan as CSV button with title when no planned rotations exist", () => {
  render(<PlanTab {...defaultProps} plannedRotations={[]} />);
  const btn = screen.getByRole("button", { name: /export plan as csv/i });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute("title", "No rotations to export yet");
});
```

**Test C — click invokes export utility:**

```ts
it("calls exportRotationPlanLocally when Export Plan as CSV button is clicked", async () => {
  const user = userEvent.setup();
  render(<PlanTab {...defaultProps} />);
  const btn = screen.getByRole("button", { name: /export plan as csv/i });
  await user.click(btn);
  expect(exportRotationPlanLocally).toHaveBeenCalledOnce();
  expect(exportRotationPlanLocally).toHaveBeenCalledWith(
    expect.objectContaining({ fileStem: "game-1" })
  );
});
```

---

## 7. File 5 — MODIFY `src/App.css`

### 7.1 Insertion point

After `.plan-tab__save-btn, .plan-tab__generate-btn` rule (lines 6605–6608).

**Exact `old_str` for edit tool:**

```css
.plan-tab__save-btn,
.plan-tab__generate-btn {
  width: 100%;
}
```

**New `new_str`:**

```css
.plan-tab__save-btn,
.plan-tab__generate-btn {
  width: 100%;
}

.plan-tab__export-section {
  margin-top: 0.75rem;
}

.plan-tab__export-btn {
  width: 100%;
  min-height: 44px;
}
```

---

## 8. Data Model / API Impacts

**None.** Pure client-side operation. No new props on `PlanTab`. No new Amplify schema fields.

---

## 9. Sequencing

1. `exportRotationPlan.ts` — pure function, no React dependency, simplest to write
2. `exportRotationPlan.test.ts` — validate utility in isolation
3. `PlanTab.tsx` — wire import, callback, button JSX
4. `PlanTab.test.tsx` — add mock and 3 test cases
5. `App.css` — add CSS rules
6. Run `npm run gate:commit`

---

## 10. Risks and Edge Cases

| Risk | Mitigation |
|------|-----------|
| Position with no player assigned | Cell renders as `""` (empty string) |
| Player ID in lineup Map not found in `players` array | Falls back to `Unknown (${id})` |
| CSV cell contains comma, `"`, or newline | `csvCell()` wraps in `"..."`, escapes inner `"` as `""` |
| `h1RotationRows` or `h2RotationRows` empty | Columns for that half simply absent; no crash |
| `projectedPlayTimeRows` is empty | Section renders header only; no crash |
| `game.id` contains characters invalid in filenames | Accepted risk — mirrors existing `exportLineupShape` behavior |
| `gamePlan !== null` but `effectivePlannedRotations.length === 0` | Button renders disabled with tooltip — tested explicitly (Test B) |
| `URL.createObjectURL` unavailable in test environment | Stubbed globally per `exportLineupShape.test.ts` pattern |
| `gameMinute` is `null` or `undefined` on a rotation | Column label falls back to `R{rotationNumber}` (no parenthetical) |

---

## 11. UI Behavior Contract

| Property | Value |
|----------|-------|
| Button label | `Export Plan as CSV` |
| `type` attribute | `type="button"` |
| Visibility gate | `gamePlan !== null` |
| Disabled condition | `effectivePlannedRotations.length === 0` |
| Disabled `title` | `"No rotations to export yet"` |
| Enabled `title` | `undefined` (no tooltip) |
| Placement | After projected play time section; before copy-from-game modal |
| Layout | Full-width, `min-height: 44px` |
| CSS classes | `btn-secondary plan-tab__export-btn` |
| Download feedback | Browser-native download only — **no toast** |
| Anchor `rel` | `"noopener"` |
| Filename | `{game.id}.rotation-plan.csv` |

---

## 12. CSV Format

```
Position,Start,R1 (10m),R2 (20m),HT,R3 (35m)
Goalkeeper,Alice Smith,Alice Smith,Alice Smith,Alice Smith,Alice Smith
Forward,Bob Jones,Carol Lee,Carol Lee,Carol Lee,Carol Lee
                                            ← blank row separator
Player,Minutes
Alice Smith,60
Bob Jones,10
Carol Lee,50
```

- Line endings: `\r\n` (CRLF — maximises Excel compatibility)
- Blob MIME type: `text/csv;charset=utf-8;`
- Cells with `,`, `"`, or newline are double-quoted; inner `"` doubled

---

## 13. Not in Scope

- `docs/specs/UI-SPEC.md` update — minimal feature, no spec update required
- Jersey number column — not included (keeping minimal)
- Toast notification — explicitly excluded
- Server persistence of exports — local-only
