# Rotation Conflict Detection Specification

## 1. Overview

Rotation conflict detection surfaces warnings when a planned substitution can no longer be executed as planned — either because a player became unavailable (injured/absent) or because live lineup state has diverged from the rotation plan. The system computes conflicts on demand via `getPlanConflicts()` in `GameManagement.tsx` and inline within the countdown banner in `RotationWidget.tsx`.

Conflict detection must distinguish between two fundamentally different conditions:

1. **A genuine conflict** — the rotation cannot be executed and requires coach intervention.
2. **An effectively-executed sub** — the rotation was already physically performed; it should be silently skipped, not flagged.

---

## 2. Conflict Types

| Type | Source | Description |
|---|---|---|
| `'starter'` | `getPlanConflicts()` | A player in the planned starting lineup is marked `absent` or `injured` |
| `'rotation'` | `getPlanConflicts()` | A player in a future rotation is marked `absent` or `injured` |
| `'on-field'` | `getPlanConflicts()` | Both `playerIn` and `playerOut` for a future rotation are simultaneously on the field as starters |
| *(none)* | — | Sub is **effectively executed** — not a conflict; silently skipped |

---

## 3. Effectively Executed Definition

A `PlannedSubstitution { playerOutId, playerInId }` is **effectively executed** when all of the following are true:

- `playerIn` **IS** in the live lineup with `isStarter: true`
- `playerOut` is **NOT** in the live lineup with `isStarter: true`

`isStarter === true` is the **only** authoritative check for "currently on field". Bench entries, `isStarter: false` rows, and absence from the lineup array all count as "off field".

A `PlannedRotation` is **fully executed** when **ALL** its `plannedSubstitutions` are effectively executed. An empty substitutions array is never considered fully executed.

---

## 4. Conflict Detection Decision Table

| `playerOut` state | `playerIn` state | Result |
|---|---|---|
| on field (`isStarter: true`) | on bench (not in lineup) | *(normal upcoming rotation)* — no conflict |
| on field (`isStarter: true`) | `injured` or `absent` | `'rotation'` conflict |
| `injured` or `absent` (off field) | on bench | `'rotation'` conflict |
| NOT on field (executed or absent) | on field (`isStarter: true`) | **Effectively executed** — skip silently |
| on field (`isStarter: true`) | on field (`isStarter: true`) | `'on-field'` conflict |

---

## 5. Scenarios

### Scenario A — Emergency injury substitution (Bug 1)

**Setup:** CC is on the field. CC becomes injured. Coach manually substitutes EE in for CC. The rotation plan still contains `{ playerOut: CC, playerIn: EE }`.

**Before fix:** The plan banner shows a `'rotation'` conflict because CC is injured. The conflict survives even though EE is already on the field.

**After fix:**
- EE is in lineup with `isStarter: true`.
- CC is NOT in lineup with `isStarter: true`.
- `isSubEffectivelyExecuted({ playerOut: CC, playerIn: EE }, lineup)` → `true`.
- The `'rotation'` conflict loop skips this sub (guarded: in-progress only).
- No conflict is raised.

---

### Scenario B — Bench injury, emergency fill (true `'on-field'` conflict)

**Setup:** B is injured from the bench. Coach manually puts C on the field to fill B's vacancy. The rotation plan still contains `{ playerOut: A, playerIn: C }` for a future rotation.

**State:** A is `isStarter: true`, C is also `isStarter: true`.

- `playerInOnField` (C) = `true`
- `playerOutOnField` (A) = `true`
- `isTrueOnFieldConflict` = `true`

**Result:** `'on-field'` conflict fires. The plan is inconsistent and requires coach action.

---

### Scenario C — Halftime substitutions applied (Bug 2)

**Setup:** The coach applies halftime substitutions through the halftime panel. Second half starts with (say) B replacing A and D replacing C at their respective positions.

**State after halftime subs:**
- B and D are `isStarter: true` in lineup.
- A and C are NOT in lineup.

**Rotation plan:** Halftime rotation still has `{ playerOut: A, playerIn: B }` and `{ playerOut: C, playerIn: D }`.

**Before fix:** These subs linger in the countdown banner for ~2 minutes as conflicts because A/C are off-field but still in `playerAvailabilities` with no `injured`/`absent` status — the `isAlreadyOnField` check fires on B/D.

**After fix:**
- Each sub is effectively executed (`playerIn` on field, `playerOut` off field).
- `isRotationFullyExecuted(rotation.plannedSubstitutions, lineup)` → `true`.
- `getNextRotation()` skips this rotation entirely.
- No countdown or conflict badge is shown.

---

### Scenario D — Future injury, rotation not yet executed

**Setup:** A future rotation has `{ playerOut: A, playerIn: B }`. Before the rotation fires, B becomes injured.

**State:**
- A is `isStarter: true` (still on field).
- B is marked `injured` in `playerAvailabilities`.
- B is NOT in lineup as a starter.

`isSubEffectivelyExecuted` returns `false` (B is not on field). The injury check `inStatus === 'injured'` fires normally.

**Result:** `'rotation'` conflict raised for player B. Coach is alerted to recalculate or manually adjust.

---

## 6. Implementation Notes

### Utility Functions

Defined in `src/utils/rotationConflictUtils.ts`:

- **`isSubEffectivelyExecuted(sub, lineup)`** — Returns `true` when playerIn is a starter and playerOut is not.
- **`isRotationFullyExecuted(plannedSubstitutionsJson, lineup)`** — Parses JSON; returns `true` only when ALL subs are effectively executed. Empty array returns `false`. Malformed JSON returns `false`.

### `getPlanConflicts()` — `src/components/GameManagement/GameManagement.tsx`

- **`'rotation'` loop guard:** Before checking `absent`/`injured` for a sub, skip it if `gameState.status === 'in-progress' && isSubEffectivelyExecuted(sub, lineup)`. This guard is **only activated in `in-progress` state** — in `scheduled` state the lineup represents the pre-game starting lineup, not live substitution state, so effectively-executed skipping would incorrectly suppress real conflicts.
- **`'on-field'` conflict:** Both `playerInOnField && playerOutOnField` must be true (`isTrueOnFieldConflict`). The outer `gameState.status === 'in-progress'` guard already exists and must be preserved.

### `RotationWidget.tsx` — `src/components/GameManagement/RotationWidget.tsx`

- **`getNextRotation()`:** Uses `isRotationFullyExecuted` to skip fully-executed rotations from the countdown banner. The 2-minute grace window (`gameMinute >= currentMinutes - 2`) is preserved for normal upcoming rotations.
- **`rotationConflicts` filter:** Uses `isSubEffectivelyExecuted` to skip executed subs before applying availability and on-field checks.
