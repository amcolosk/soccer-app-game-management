# Implementation Plan: Stale Rotation Conflict Detection Fix

**Date:** 2026-04-04  
**Bugs fixed:** Post-injury-sub conflict persists / Halftime 2-minute stale window  
**Root cause:** Missing "effectively executed" check in three distinct code paths

---

## 1. Root Cause Analysis

### What "effectively executed" means

A `PlannedSubstitution { playerOutId, playerInId, positionId }` is **effectively executed** when:
- `playerIn` IS in `lineup` with `isStarter: true`
- `playerOut` is NOT in `lineup` with `isStarter: true`

A `PlannedRotation` is **fully executed** when **every** substitution in its `plannedSubstitutions` array is effectively executed.

### Where the bugs fire

| Code path | File | Bug triggered |
|---|---|---|
| `getNextRotation()` grace window | `RotationWidget.tsx:88–91` | Bug 2 — halftime rotation stays in countdown for 2 min |
| `rotationConflicts` local filter | `RotationWidget.tsx:173–185` | Bug 1 & 2 — fires ⚠️ badge when playerIn is on field regardless of playerOut state |
| `getPlanConflicts()` `'rotation'` block | `GameManagement.tsx:247–267` | Bug 1 — flags CC (injured, was playerOut) even though rotation completed |
| `getPlanConflicts()` `'on-field'` block | `GameManagement.tsx:270–298` | Bug 1 & 2 — fires conflict whenever playerIn is on field regardless of playerOut state |

### What "true on-field conflict" means

A sub is a **genuine** `'on-field'` conflict only when:
- `playerIn` IS in `lineup` with `isStarter: true`, **AND**
- `playerOut` IS ALSO in `lineup` with `isStarter: true`

This indicates the rotation is physically impossible: the incoming player is already playing, and the going-off player never left.

---

## 2. Files to Change

### 2.1 NEW — `src/utils/rotationConflictUtils.ts`

Create a single exported pure function shared across both component files.

```typescript
// Returns true when the substitution has already happened:
//   playerIn is on the field (isStarter) AND playerOut is not.
export function isSubEffectivelyExecuted(
  sub: { playerInId: string; playerOutId: string },
  lineup: Array<{ playerId: string; isStarter: boolean }>
): boolean {
  const isPlayerInOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerInId);
  const isPlayerOutOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerOutId);
  return isPlayerInOnField && !isPlayerOutOnField;
}
```

**Why a shared utility vs inline:** The check is used in 4 call sites across 2 component files. The function represents a distinct domain invariant ("was this sub already done?"). A named function also makes the intent clear in each call site without a comment.

---

### 2.2 NEW — `src/utils/rotationConflictUtils.test.ts`

Simple unit tests for the pure function:

| Test | Setup | Expected |
|---|---|---|
| playerIn on field, playerOut off field | playerIn in lineup (isStarter), playerOut not | `true` |
| playerIn on field, playerOut ALSO on field | both in lineup (isStarter) | `false` |
| neither on field | lineup empty | `false` |
| playerIn off field, playerOut on field | playerOut in lineup, playerIn not | `false` |
| isStarter: false does not count as on-field | playerIn in lineup with isStarter: false | `false` |

---

### 2.3 `src/components/GameManagement/RotationWidget.tsx`

#### Change A — `getNextRotation()` (lines 88–91)

**Before:**
```typescript
return plannedRotations.find(r => {
  return r.half === gameState.currentHalf &&
         r.gameMinute >= currentMinutes - 2;
}) || null;
```

**After:**
```typescript
return plannedRotations.find(r => {
  if (r.half !== gameState.currentHalf) return false;
  if (r.gameMinute < currentMinutes - 2) return false;
  // Skip rotations that have already been physically executed
  try {
    const subs: PlannedSubstitution[] = JSON.parse(r.plannedSubstitutions as string);
    if (subs.length > 0 && subs.every(sub => isSubEffectivelyExecuted(sub, lineup))) return false;
  } catch { /* on parse error, include rotation */ }
  return true;
}) || null;
```

**Effect:** The 2-minute grace window is preserved for normal upcoming rotations. A fully-executed rotation (all playerIns on field, all playerOuts off field) is hidden regardless of where it falls in the grace window. This clears the halftime banner immediately once halftime subs are applied.

**Edge cases:**
- Parse error in `plannedSubstitutions`: `catch` block returns `false` (keep showing rotation) to avoid silently hiding a rotation with bad data.
- Empty `subs` array: `subs.length > 0` guard ensures the rotation is NOT treated as "fully executed" if there are no substitutions — it stays visible.

#### Change B — `rotationConflicts` local filter (lines 173–185)

**Before:**
```typescript
return subs.filter(sub => {
  const inStatus = getPlayerAvailability(sub.playerInId);
  const outStatus = getPlayerAvailability(sub.playerOutId);
  const isAlreadyOnField = lineup?.some(l => l.isStarter && l.playerId === sub.playerInId) ?? false;
  return (
    isAlreadyOnField ||
    inStatus === 'absent' || inStatus === 'injured' ||
    outStatus === 'absent' || outStatus === 'injured'
  );
});
```

**After:**
```typescript
return subs.filter(sub => {
  // Effectively executed: playerIn arrived on field, playerOut already left — not a conflict
  if (isSubEffectivelyExecuted(sub, lineup ?? [])) return false;

  const isPlayerInOnField = lineup?.some(l => l.isStarter && l.playerId === sub.playerInId) ?? false;
  const isPlayerOutOnField = lineup?.some(l => l.isStarter && l.playerId === sub.playerOutId) ?? false;

  // True on-field conflict: both are currently on the field, rotation is impossible as planned
  if (isPlayerInOnField && isPlayerOutOnField) return true;

  // Availability conflict: someone in this sub is injured or absent
  const inStatus = getPlayerAvailability(sub.playerInId);
  const outStatus = getPlayerAvailability(sub.playerOutId);
  return (
    inStatus === 'absent' || inStatus === 'injured' ||
    outStatus === 'absent' || outStatus === 'injured'
  );
});
```

**Effect:** The ⚠️ badge is suppressed for effectively-executed subs. "Both on field" still correctly fires a conflict. Injured/absent checks are preserved but only for non-executed subs.

---

### 2.4 `src/components/GameManagement/GameManagement.tsx`

Add import of `isSubEffectivelyExecuted` from `../../utils/rotationConflictUtils`.

#### Change A — `getPlanConflicts()` `'rotation'` block (lines ~247–267)

**Before (inner loop):**
```typescript
for (const sub of subs) {
  for (const pid of [sub.playerOutId, sub.playerInId]) {
    const status = getPlayerAvailability(pid);
    if (status === 'absent' || status === 'injured') {
      // ... add 'rotation' conflict
    }
  }
}
```

**After:**
```typescript
for (const sub of subs) {
  // Skip: this sub was already physically executed (playerIn on field, playerOut left)
  if (isSubEffectivelyExecuted(sub, lineup)) continue;

  for (const pid of [sub.playerOutId, sub.playerInId]) {
    const status = getPlayerAvailability(pid);
    if (status === 'absent' || status === 'injured') {
      // ... (unchanged) add 'rotation' conflict
    }
  }
}
```

**Effect:** If CC got injured AFTER being subbed off (playerOut, now off field, EE playerIn now on field), the effectively-executed guard fires — no `'rotation'` conflict emitted for CC. Bug 1 fixed.

**Edge case:** This iterates ALL `plannedRotations`, including past halftime rotations. The effectively-executed check works correctly for past rotations — once executed, they no longer produce `'rotation'` conflicts.

#### Change B — `getPlanConflicts()` `'on-field'` block (lines ~270–298)

**Before:**
```typescript
for (const sub of subs) {
  const isOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerInId);
  if (isOnField) {
    // add 'on-field' conflict
  }
}
```

**After:**
```typescript
for (const sub of subs) {
  const isPlayerInOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerInId);
  const isPlayerOutOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerOutId);
  // Only a true on-field conflict if BOTH players are currently on the field
  if (isPlayerInOnField && isPlayerOutOnField) {
    // add 'on-field' conflict (playerName = sub.playerInId as before)
  }
}
```

**Effect:** Narrows the condition to the true conflict case. Effectively-executed sub (playerIn on field, playerOut left) → condition is now false → no conflict. Bug 1 cleared by this path as well. The existing `rotation.gameMinute <= currentMinutes` past-rotation guard is unchanged and stays as the outer filter.

**Rationale for NOT calling `isSubEffectivelyExecuted` here:** The condition change from `if (isOnField)` to `if (isPlayerInOnField && isPlayerOutOnField)` is semantically complete and minimal. Adding an explicit `isSubEffectivelyExecuted` call would be redundant — the narrowed condition naturally handles the "effectively executed" case by requiring playerOut to still be on field.

---

### 2.5 `src/components/GameManagement/GameManagement.test.tsx`

#### Update existing test (Group A — "on-field detection")

The test `"detects 'on-field' conflict when playerIn is already a starter in a future rotation during in-progress game"` currently has `player-D` (playerOut) **not** in lineup. Under the new rules this is "effectively executed" — not a conflict. The test must be updated to represent a **true** conflict by adding player-D to the lineup:

```typescript
// Before:
lineup: [
  { id: 'la-C', gameId: 'game-1', playerId: 'player-C', positionId: 'pos2', isStarter: true },
],

// After (player-D also on field — true conflict):
lineup: [
  { id: 'la-C', gameId: 'game-1', playerId: 'player-C', positionId: 'pos2', isStarter: true },
  { id: 'la-D', gameId: 'game-1', playerId: 'player-D', positionId: 'pos1', isStarter: true },
],
```

This represents Scenario B: plan says "sub player-D off, bring player-C into pos1" but player-C is already at pos2 AND player-D is still at pos1 — a genuine conflict.

#### New tests to add in the same `describe` group (Group A)

1. **Effectively-executed sub does NOT produce 'on-field' conflict**: playerIn (`player-C`) on field, playerOut (`player-D`) NOT in lineup → `getPlanConflicts()` returns no `'on-field'` entry.

2. **Effectively-executed sub does NOT produce 'rotation' conflict even if playerOut is injured**: playerOut (`player-C`) injured + not on field, playerIn (`player-E`) on field → no conflict of any type from `getPlanConflicts()`.

3. **'rotation' conflict still fires for non-executed sub with injured playerIn**: future rotation, `playerIn` is injured, `playerOut` IS still on field (not executed) → `'rotation'` conflict fires with correct rotationNumbers.

4. **'on-field' conflict preserved when both players are on field** *(this replaces the updated existing test)*: already described above.

---

### 2.6 `src/components/GameManagement/RotationWidget.test.tsx`

Add new tests to the existing `describe("RotationWidget")` block:

1. **Fully executed rotation hidden from countdown**: When every sub in a rotation has playerIn on field with isStarter and playerOut not in lineup, the countdown banner is NOT rendered (even within the 2-minute grace window, e.g. `currentTime = 1140s = 19min`, `gameMinute = 20`).

2. **Normal upcoming rotation still shows in countdown**: When playerIn is NOT on field, the countdown banner renders normally.

3. **No conflict badge for effectively-executed sub**: `rotationConflicts` yields 0 items when rotation is effectively executed → no `⚠️` badge rendered.

4. **Conflict badge rendered when both playerIn and playerOut are on field**: lineup includes both players as starters → `⚠️` conflict badge is rendered on the countdown banner.

5. **'rotation' conflict (injured playerIn, playerOut on field) still shows ⚠️ badge**: playerIn is injured (not on field), playerOut on field → banner shows with conflict badge.

---

### 2.7 NEW — `docs/specs/Rotation-Conflict-Detection-Spec.md`

Full spec document (see Section 4 below for content requirements).

---

## 3. Risks, Assumptions, and Edge Cases

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Existing Group A test failure after narrowing 'on-field' condition | High (expected) | Plan explicitly updates the test fixture as described in §2.5 |
| Parse error in `plannedSubstitutions` inside `getNextRotation()` silently hides rotation | Medium | `catch` block returns `false` → rotation stays visible on parse error |
| Empty `subs` array in `getNextRotation()` treated as "fully executed" | Medium | `subs.length > 0 &&` guard prevents false positive |
| `lineup` is `undefined`/`null` in `rotationConflicts` | Low | `lineup ?? []` defensive guard already present in existing code; `isSubEffectivelyExecuted` receives `[]` → returns `false` → rotation stays visible |

### Assumptions

1. The `lineup` variable in `GameManagement.tsx`'s `getPlanConflicts()` is the live `LineupAssignment[]` from `useGameSubscriptions` — confirmed by code inspection (line 102, destructured from the subscriptions hook). No prop-passing change needed.
2. `PlannedSubstitution` type from `rotationPlannerService.ts` has `playerInId` and `playerOutId` fields — confirmed in `RotationWidget.tsx` and `GameManagement.tsx` imports.
3. `isStarter: true` is the canonical on-field indicator for lineup assignments — confirmed by existing conflict code that already uses this check.
4. The `currentTime` in `getNextRotation()` is wall-clock-derived game seconds (not minutes). The `Math.floor(currentTime / 60)` conversion is already present — unchanged.

### Edge cases confirmed handled

- **Partial execution** (only some subs in a multi-sub rotation executed): `subs.every()` in `getNextRotation()` means the rotation stays visible until ALL subs are executed.
- **Game not yet in-progress**: `getNextRotation()` checks `r.half === gameState.currentHalf` which prevents showing rotations from a wrong half.
- **`gameState.status !== 'in-progress'`** guard on `RotationWidget`: the entire widget returns `null`, so none of these paths execute.
- **`getPlanConflicts()` 'on-field' block already guarded by `gameState.status === 'in-progress'`**: no change needed there.
- **Halftime rotation past-rotation guard**: the existing `rotation.gameMinute <= currentMinutes` check in the 'on-field' block would skip the halftime rotation at the start of second half anyway. The real halftime fix comes from `getNextRotation()` + `rotationConflicts` in RotationWidget (where the 2-minute grace window is the issue).

---

## 4. Spec Document Content

`docs/specs/Rotation-Conflict-Detection-Spec.md` must include:

### 4.1 Purpose and scope
Defines rules for when a planned rotation should appear in the countdown banner and when it should generate a plan conflict warning.

### 4.2 Definitions
- **Effectively executed sub**: `playerIn` in lineup with `isStarter: true` AND `playerOut` NOT in lineup with `isStarter: true`
- **Fully executed rotation**: All `plannedSubstitutions` in a `PlannedRotation` are effectively executed
- **True on-field conflict**: `playerIn` in lineup with `isStarter: true` AND `playerOut` ALSO in lineup with `isStarter: true`

### 4.3 Conflict type table

| Scenario | `playerOut` state | `playerIn` state | Result |
|---|---|---|---|
| Normal upcoming rotation | on field (isStarter) | on bench / available | Show in countdown, no conflict |
| Injured playerIn (future) | on field (isStarter) | injured / absent | `'rotation'` conflict |
| Injured playerOut (future) | injured / absent | on bench | `'rotation'` conflict |
| Emergency sub executed (CC/EE) | **NOT** on field | on field (isStarter) | **Effectively executed — skip all conflicts** |
| True on-field conflict | on field (isStarter) | on field (isStarter) at **different** position | `'on-field'` conflict |
| Halftime subs applied | NOT on field | on field (isStarter) | **Effectively executed — clear from countdown** |

### 4.4 `isSubEffectivelyExecuted` invariant
```
isSubEffectivelyExecuted(sub, lineup) = true
  iff lineup contains sub.playerInId with isStarter:true
  AND lineup does NOT contain sub.playerOutId with isStarter:true
```

### 4.5 Countdown banner visibility rules
A planned rotation appears in the countdown banner when ALL of:
1. `rotation.half === gameState.currentHalf`
2. `rotation.gameMinute >= currentMinutes - 2` (2-minute advance notice + grace window)
3. NOT fully executed (at least one sub is not effectively executed)

### 4.6 Scenarios

**Scenario A — Emergency injury substitution (CC/EE)**
1. CC is on field. CC gets injured.
2. Coach subs CC off; EE enters CC's position (emergency sub).
3. Coach marks CC as injured on bench.
4. Plan had rotation: `{ playerOut: CC, playerIn: EE, position: P1 }`.
5. **Result**: Rotation is fully executed (EE on field, CC not on field) → banner clears, no conflict fired. CC's injured status triggers no `'rotation'` conflict because the sub skips the injury check via the effectively-executed guard.

**Scenario B — Bench injury, emergency fill (true conflict)**
1. A is on field at P1. B is on bench, injured.
2. Emergency: A is moved to cover B's absence; C (planned only for bench) fills A's spot at P1.
3. Plan had rotation: `{ playerOut: A, playerIn: C, position: P1 }`.
4. A is still on field at P1. C is ALSO now on field (different position).
5. **Result**: Both A (playerOut) and C (playerIn) are on field with `isStarter: true` → true `'on-field'` conflict fires correctly.

**Scenario C — Halftime subs applied**
1. Coach applies all planned halftime substitutions at halftime.
2. Second half starts. `currentMinutes = halfLengthMinutes = 30`. Halftime rotation has `gameMinute = 30`.
3. Grace window: `30 >= 30 - 2 = 28` → still visible for ~2 minutes.
4. All halftime playerOuts have left the field; all halftime playerIns are on field.
5. **Result**: All subs are effectively executed → `getNextRotation()` returns `null` → banner clears immediately regardless of the 2-minute grace window.

**Scenario D — Future rotation, playerIn is injured**
1. Future rotation at minute 40: `{ playerOut: X, playerIn: injuredPlayer, position: P2 }`.
2. X is currently on field (isStarter). injuredPlayer is marked injured and NOT on field.
3. **Result**: Sub is NOT effectively executed (playerIn not on field) → injury check runs → `'rotation'` conflict fires correctly because `injuredPlayer` is `injured`.

### 4.7 Recalculate button
When `getPlanConflicts()` returns any conflict, the Recalculate Rotations button appears in the RotationWidget modal. Effectively-executed rotations produce no conflicts — the button is hidden when all plan deviations are execution-based rather than conflict-based.

---

## 5. Sequencing

1. Create `rotationConflictUtils.ts` and its test file
2. Update `RotationWidget.tsx` (import + 2 changes)
3. Update `GameManagement.tsx` (import + 2 changes inside `getPlanConflicts`)
4. Update `GameManagement.test.tsx` (1 update + 3 new tests)
5. Update `RotationWidget.test.tsx` (5 new tests)
6. Create `Rotation-Conflict-Detection-Spec.md`

All changes can be delivered in a single coding-agent session; no staging required.

---

## 6. Test strategy

- **Pure unit tests**: `rotationConflictUtils.test.ts` tests `isSubEffectivelyExecuted` in isolation
- **Component tests**: `GameManagement.test.tsx` tests `getPlanConflicts()` via `mockCaptures.rotationWidgetProps.getPlanConflicts()` (existing pattern from Group A)
- **Widget render tests**: `RotationWidget.test.tsx` tests banner visibility and conflict badge via rendered DOM
- **No E2E tests needed** for this fix — the logic change is unit-testable and the E2E layer already covers basic game management flows

---  

## 7. Data model impact

None. No DynamoDB schema changes. No new subscriptions. No Lambda changes.

---

## 8. Artifacts

| Artifact | Type | Status |
|---|---|---|
| `src/utils/rotationConflictUtils.ts` | New file | To create |
| `src/utils/rotationConflictUtils.test.ts` | New file | To create |
| `src/components/GameManagement/RotationWidget.tsx` | Edit | 2 changes |
| `src/components/GameManagement/GameManagement.tsx` | Edit | 2 changes in `getPlanConflicts` |
| `src/components/GameManagement/GameManagement.test.tsx` | Edit | 1 update + 3 new tests |
| `src/components/GameManagement/RotationWidget.test.tsx` | Edit | 5 new tests |
| `docs/specs/Rotation-Conflict-Detection-Spec.md` | New file | To create |
