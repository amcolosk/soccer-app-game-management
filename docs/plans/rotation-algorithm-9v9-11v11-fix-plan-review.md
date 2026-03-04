# Architecture Review: Rotation Algorithm Fix Plan (9v9 / 11v11)

**Reviewer:** Senior Architect  
**Plan under review:** `docs/plans/rotation-algorithm-9v9-11v11-fix-plan.md`  
**Source reviewed:** `src/services/rotationPlannerService.ts`  
**Status:** ✅ Approved with corrections — one fix is redundant and must be simplified before
implementation

---

## Summary Verdict

The plan correctly identifies all root causes, proposes the right logical remedies, and stays
within the minimal-change constraint.  Three of the four fixes are correct as written.  One
fix (Fix 1) introduces a redundant flag that should be removed and replaced with the existing
variable `isLastFirstHalfRotation`.  All other logic, formulas, and test cases are sound.

---

## Review Item 1 — Are the four proposed fixes correct and minimal?

**Finding: Yes, with one redundancy (Fix 1 — see Item 2).**

- Fix 4 (`positionMap.delete`) is the safest change: one line, zero risk.  
- Fix 1 (`nextRotationIsHalftime` flag) is logically harmless but algebraically redundant
  (detailed in Item 2).  
- Fix 2 (proactive `mustOn`) is the core correctness fix.  
- Fix 3 (`baseSubsNeeded` bench-proportional formula) is the fairness fix that prevents
  Fix 2 from being the only safety net.

The four changes are genuinely local to the regular-rotation `else` branch.  No halftime
branch, no exported types, no callers are touched.  The minimal-change requirement is met.

---

## Review Item 2 — `nextRotationIsHalftime` flag: `(rotNum + 1 === rotationsPerHalf + 1)`

**Finding: ⚠️ DEFECT — the flag is algebraically identical to the already-defined
`isLastFirstHalfRotation` and must not be introduced as a separate variable.**

### Proof

```
nextRotationIsHalftime = (rotNum + 1 === rotationsPerHalf + 1)
                       ⟺  rotNum + 1 = rotationsPerHalf + 1
                       ⟺  rotNum     = rotationsPerHalf
                       ⟺  isLastFirstHalfRotation            (line 214, already defined)
```

The two expressions are identical under all inputs.  Introducing a second name for the same
value creates a false impression of independent semantics and a maintenance trap: a future
reader might modify one without updating the other.

### Required correction

**Remove Fix 1 entirely.**  Instead, use `isLastFirstHalfRotation` directly in the Fix 2
proactive guard.  The corrected Fix 2 condition becomes:

```typescript
const isProactive =
  !isLastRotation &&
  !isLastFirstHalfRotation &&          // ← replaces nextRotationIsHalftime
  played + minutesRemaining - rotationIntervalMinutes <= threshold;
```

This requires no new code at all, and the semantic intent is equally clear because
`isLastFirstHalfRotation` already means "the very next rotation is halftime."

### Edge cases — no new risk after the correction

| `rotationsPerHalf` | At what rotNum does `isLastFirstHalfRotation` fire? | Correct? |
|--------------------|-----------------------------------------------------|----------|
| 0 (no H1 rotations) | Never (rotNum starts at 1, never equals 0)         | ✓ — proactive never disabled |
| 1                  | rotNum = 1 (first and only H1 rotation)             | ✓ — proactive disabled at R1 |
| 2 (baseline)       | rotNum = 2 (R2 in the 5-rotation game)              | ✓ — proactive disabled at R2 |
| 3                  | rotNum = 3                                          | ✓ — proactive disabled at R3 |

The plan's Risk 3 (`rotationsPerHalf = 0`) is a non-issue regardless of which name is used.

---

## Review Item 3 — Proactive `mustOn` condition: `played + minutesRemaining - rotationIntervalMinutes <= threshold`

**Finding: ✅ Correct.**

### Mathematical derivation

`minutesRemaining` is computed *after* step 1 time accumulation, so at rotation `rotNum` it
equals `totalGameMinutes − currentGameMinute` — the time remaining *from this rotation
boundary onward*.

If a bench player is **skipped** at the current rotation, at the *next* regular rotation
they will have:
- The same `played` value (they earned no new time)
- `minutesRemaining − rotationIntervalMinutes` time remaining (one interval shorter)

The standard `mustOn` check at that next rotation would fire if:

```
played + (minutesRemaining − rotationIntervalMinutes) ≤ threshold
```

This is precisely the proposed condition.  The proactive check is therefore equivalent to:
*"this player would trigger standard `mustOn` at the next rotation if skipped now; fire it
one rotation early to give them two intervals instead of one."*

### Worked verification (9v9, 16 players, R4)

| Condition | Value | Outcome |
|-----------|-------|---------|
| `played` | 20 min | — |
| `minutesRemaining` | 20 min (game min 40, total 60) | — |
| `rotationIntervalMinutes` | 10 min | — |
| `threshold` | 30 min (50% of 60) | — |
| `played + remaining − interval` | `20 + 20 − 10 = 30 ≤ 30` | **Proactive fires at R4** ✓ |
| Player subbed on at R4: earns R4→R5 + final segment | `+10 + 10 = 20 more` | Total: 40 min, above threshold ✓ |

### Behaviour table across all rotation slots

| rotNum | `!isLastRot` | `!isLastFirstHalfRot` | Proactive fires when played ≤ |
|--------|--------------|-----------------------|-------------------------------|
| R1     | ✓            | ✓                     | `played ≤ 50−10−30 = 10` (very conservative in H1, rarely triggers) |
| R2     | ✓            | **✗** (is last H1)    | **Disabled** — halftime follows |
| R3(HT) | —           | —                     | Halftime branch — not evaluated |
| R4     | ✓            | ✓                     | `played ≤ 20` ← **core fix** |
| R5     | **✗** (last) | —                     | **Disabled** — standard check only |

### Interaction with the fatigue guard (line 354)

The fatigue guard on field players uses `played + minutesRemaining ≤ threshold` (standard
condition) to *prevent* forced rotation.  The proactive bench condition uses
`played + minutesRemaining − interval ≤ threshold` (one interval earlier) to *trigger*
substitution.  These are complementary: the proactive threshold is strictly tighter, and
both conditions apply to mutually exclusive sets (field vs bench), so there is no conflict.

### Early-rotation over-triggering concern

At R1 with 50 minutes remaining, the proactive condition fires only if `played ≤ 10`.  A
fresh bench player has `played = 0`, so `0 + 50 − 10 = 40 > 30` — **does not fire at R1**.
The proactive check is naturally conservative early in the game.

---

## Review Item 4 — `regularRotationsRemaining` calculation

**Finding: ✅ Correct for all standard symmetric-half games, with one implicit assumption
that should be documented.**

### Formula verification

```typescript
const regularRotationsRemaining = isSecondHalf
  ? (totalRotations - rotNum)
  : (rotationsPerHalf - rotNum) + rotationsPerHalf;
```

**Second half** (`isSecondHalf = rotNum > rotationsPerHalf + 1`):

All remaining rotations after `rotNum` are regular second-half rotations.  Count =
`totalRotations − rotNum`. ✓

**First half** (`rotNum ≤ rotationsPerHalf`):

Remaining H1 regular rotations = `rotationsPerHalf − rotNum`.  
All H2 regular rotations = `totalRotations − rotationsPerHalf − 1` (excludes halftime).

For a symmetric game, `totalRotations = 2 × rotationsPerHalf + 1`, so:
```
H2 regular rotations = 2×rotationsPerHalf + 1 − rotationsPerHalf − 1 = rotationsPerHalf
```

Therefore:
```
regularRotationsRemaining = (rotationsPerHalf − rotNum) + rotationsPerHalf
                          = 2 × rotationsPerHalf − rotNum          (simplified)
```

This is exactly `totalRotations − 1 − rotNum` under the symmetric-halves assumption — a
form that is also correct and arguably more self-documenting.

### Worked example (9v9, rotationsPerHalf=2, totalRotations=5)

| rotNum | branch | formula | result | expected | ✓ |
|--------|--------|---------|--------|----------|---|
| R1 | H1 | (2−1)+2 | **3** | R2, R4, R5 = 3 | ✓ |
| R2 | H1 | (2−2)+2 | **2** | R4, R5 = 2 | ✓ |
| R3 | halftime | N/A | N/A | not computed | ✓ |
| R4 | H2 | 5−4 | **1** | R5 = 1 | ✓ |
| R5 | H2 | 5−5 | **0** | (none) = 0 | ✓ |

### The `regularRotationsRemaining = 0` edge case

When `regularRotationsRemaining = 0` (at the final rotation), the conditional:

```typescript
const minSubsForEquity =
  benchSize > 0 && regularRotationsRemaining > 0
    ? Math.ceil(benchSize / regularRotationsRemaining)
    : benchSize;
```

correctly falls back to `benchSize` — every remaining bench player gets a sub at the last
rotation.  This is the correct terminal behaviour. ✓

### Implicit assumption — symmetric halves

The H1 branch of the formula implicitly assumes `totalRotations = 2 × rotationsPerHalf + 1`.
If this invariant ever broke (asymmetric halves), the formula would under-count H2 regular
rotations.  **Recommendation: add a one-line comment** to make this assumption explicit:

```typescript
// Assumes symmetric halves: totalRotations = 2*rotationsPerHalf + 1.
// H2 regular rotation count = totalRotations - rotationsPerHalf - 1 = rotationsPerHalf.
const regularRotationsRemaining = isSecondHalf
  ? (totalRotations - rotNum)
  : (rotationsPerHalf - rotNum) + rotationsPerHalf;
```

No code change is required — just the comment.

### `totalSubsNeeded` receiving the `nonGkField.length` cap

The new `nonGkField.length` cap on `totalSubsNeeded` is correct and defensive.  The existing
code omits this cap, meaning in theory `totalSubsNeeded` could request more players off the
field than are physically available as non-GK field players.  Adding the cap is a good
hardening change. ✓

---

## Review Item 5 — `positionMap.delete` missing bug

**Finding: ✅ Real bug, worth fixing.  The severity claim about `nonGkField` is slightly
overstated — the actual impact is stale state and a narrower set of risks than described.**

### Confirmation

The regular-rotation substitution loop (lines 420–430) does not call
`positionMap.delete(playerOutId)` after executing a substitution.  The halftime loop
(lines 301–312) does.  The asymmetry is a real inconsistency.

### Corrected severity analysis

The plan states the stale entry "can produce incorrect `nonGkField` filter results."  This
claim is **overstated**:

```typescript
// Line 391–393 in the source:
const nonGkField = Array.from(currentField).filter(
  id => !goaliePositionId || positionMap.get(id) !== goaliePositionId
);
```

`nonGkField` is filtered from `currentField`.  Since `currentField.delete(playerOutId)` is
correctly called before the missing `positionMap.delete`, a benched player is already
excluded from `currentField` and therefore excluded from `nonGkField` — regardless of
whether their stale `positionMap` entry exists.  The `nonGkField` filter is **not** corrupted
by this bug under current code.

### Where the stale entry does create real risk

1. **GK guard in the fatigue section** (line 341):
   ```typescript
   if (goaliePositionId && positionMap.get(id) === goaliePositionId) continue;
   ```
   This iterates `currentField`, so it also does not see benched players.  Not affected.

2. **`positionsToFill` derivation** (line 414):
   ```typescript
   const positionsToFill = allPlayersOut
     .map(id => positionMap.get(id))
     .filter(...)
   ```
   `allPlayersOut` is derived from `currentField`-based filters, so benched players'
   stale entries are not looked up here either.

3. **The real, reproducible risk**: if a player is benched in rotation N and re-enters
   in rotation N+k in a *different position*, their `positionMap` entry is overwritten
   correctly by `positionMap.set(assignment.playerId, position)`.  No direct corruption.

4. **Future code risk**: any future code that iterates `positionMap` directly to enumerate
   current field occupants (instead of going through `currentField`) would silently include
   benched players.  This is the most significant risk.

5. **State inconsistency between `currentField` and `positionMap`**: after the fix, the
   invariant `positionMap.keys() ⊆ currentField` is maintained throughout regular
   rotations, matching the halftime branch.  This invariant is worth preserving.

### Verdict

Fix 4 is correct and low-risk.  It should be applied.  The plan's description is slightly
misleading in implicating `nonGkField` directly, but the fix itself and the implementation
order are both right.

---

## Additional Finding — `currentGameMinute` formula consistency

**Not a bug — confirmation of correctness.**

The `currentGameMinute` formula at line 227–229 uses the condition
`rotNum <= rotationsPerHalf + 1`:

```typescript
const currentGameMinute = rotNum <= rotationsPerHalf + 1
  ? rotNum * rotationIntervalMinutes
  : halfLengthMinutes + (rotNum - rotationsPerHalf - 1) * rotationIntervalMinutes;
```

At the halftime boundary (rotNum = rotationsPerHalf + 1):
`currentGameMinute = (rotationsPerHalf + 1) × interval = halfLengthMinutes` ✓

This means the `minutesRemaining` value used in the proactive condition is correctly
computed as `totalGameMinutes − halfLengthMinutes = halfLengthMinutes` at halftime —
but that branch is never reached by the regular-rotation logic.  No issue.

---

## Additional Finding — Interaction between Fix 2 and Fix 3 at R4 (9v9/16 players)

The two fixes are **complementary and mutually reinforcing**, not conflicting.

At R4 with 7 bench players all having ≤ 20 minutes:

- **Fix 2** adds those players to `mustOn` via the proactive condition.
- **Fix 3** independently raises `baseSubsNeeded` to 7 via `minSubsForEquity = ceil(7/1) = 7`.
- `totalSubsNeeded = min(max(forcedOff.length, max(mustOn.length, 7)), 7, 8) = 7`.

Both fixes arrive at the same `totalSubsNeeded = 7` via different reasoning.  If either fix
were applied alone, the result at R4 would still be correct for this scenario.  Together
they provide defense-in-depth.

The resulting large substitution batch (7 players at once at R4) is noted as Risk 2 in the
plan.  The `nonGkField.length` cap in Fix 3 (`totalSubsNeeded ≤ nonGkField.length = 8`)
correctly prevents any arithmetic overflow of this batch. ✓

---

## Additional Finding — TC-11v11-02 test (2 bench, 11v11)

This test is likely to pass **without** the new fixes, because with only 2 bench players
the existing `baseSubsNeeded = ceil(11/3) = 4` and standard `mustOn` together are already
more than sufficient.  This is correct test design — it is a regression guard to confirm
the new fixes do not break the tight-bench case, not a new failure case.

The plan should note this explicitly to avoid confusion during TDD red-phase setup:
`TC-11v11-02` is expected to be *green before and after* the fixes.

---

## Required Change Summary

| # | Item | Action | Risk |
|---|------|--------|------|
| **R-1** | Fix 1: remove `nextRotationIsHalftime` flag entirely | Replace with `isLastFirstHalfRotation` in the Fix 2 `isProactive` condition | **None** — algebraically equivalent |
| R-2 | Fix 3: add comment documenting symmetric-halves assumption | Comment only | None |
| R-3 | Plan: note that TC-11v11-02 is green before and after fixes | Documentation only | None |

No other corrections are required.  Fixes 2, 3, and 4 are approved as written (modulo R-1
above for Fix 2's guard expression).

---

## Recommended Final Implementation of Fix 2 (incorporating R-1)

```typescript
// Must-on: 50% risk bench players (Rules 1.3, 2.2)
const mustOn: string[] = [];
for (const id of eligibleBench) {
  const p = playerById.get(id)!;
  const availTime = (p.availableUntilMinute ?? totalGameMinutes) - (p.availableFromMinute ?? 0);
  const threshold = availTime * 0.5;
  const played = playTimeMinutes.get(id) ?? 0;

  // Standard: player cannot reach 50% even with all remaining time.
  const isAtRisk = played + minutesRemaining <= threshold;

  // Proactive (one-rotation look-ahead): if this player is skipped this rotation
  // AND the next rotation is a regular rotation (not halftime, not the last),
  // they will be unable to reach the threshold at that next rotation.
  // isLastFirstHalfRotation serves as the halftime-next guard because
  // halftimeRotation ≡ rotationsPerHalf + 1, so "next is halftime" ≡ rotNum === rotationsPerHalf.
  const isProactive =
    !isLastRotation &&
    !isLastFirstHalfRotation &&
    played + minutesRemaining - rotationIntervalMinutes <= threshold;

  if (isAtRisk || isProactive) {
    mustOn.push(id);
  }
}
```

Fix 1 (adding `nextRotationIsHalftime`) is eliminated entirely.  No other changes to the
plan are needed.
