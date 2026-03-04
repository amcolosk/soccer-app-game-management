# Rotation Algorithm Fix Plan: 9v9 / 11v11 Playtime Guarantee

**Status:** Ready for implementation  
**Priority:** High — violates Rule 1.3 (50% minimum playtime guarantee)  
**Affected file (primary):** `src/services/rotationPlannerService.ts`  
**Affected file (tests):** `src/services/rotationPlannerService.test.ts`  
**Affected file (spec):** `docs/specs/Rotation-Algorithm-Requirements.md`

---

## 1. Problem Statement

In 9v9 games with 16 players and 30-minute halves (10-minute rotation intervals), at
least one player can finish with only 20 minutes of actual play time — 33% of the
60-minute game — violating the hard 50% minimum guaranteed by Rule 1.3 (threshold = 30 min).

The debug snapshot shows this happening on the bench side: a player accumulates 20 minutes
across H1 and the early part of H2, sits on the bench during the second-to-last H2 rotation
(R4), and although `mustOn` fires at the last rotation (R5), playing only the final 10-minute
segment brings their total to 30 minutes — exactly the threshold.  This is the *best-case
outcome* of the current logic. Under even slightly adverse conditions (fatigue cycling,
large bench competing for limited sub slots) the player does not get on at R5 in time and
finishes at 20 minutes.

---

## 2. Root Cause Analysis

### 2.1 Confirmed Failing Scenario (9v9 · 16 players · 10-min intervals)

Game timeline (rotNum → game-minute):

```
R1→10  R2→20  R3→30(HT)  R4→40  R5→50  [final: 50-60]
```

`baseSubsNeeded = Math.ceil(9 / 3) = 3`  — only 3 bench players come on per regular rotation.

With 7 bench players, at most **3 × 4 regular rotations = 12 bench-player slots** are
available across the whole game. 7 bench × 2 halves = 14 slots needed for everyone to
appear in both halves. The deficit forces some players to rely exclusively on the `mustOn`
safety-net at R4/R5.

**Scenario that produces 20 minutes with the current algorithm:**

| Minute | Player X state | X playtime tracked |
|--------|-----------------|-------------------|
| 0–10   | On field (starter) — step1 R1 adds 10 | 10 |
| 10–20  | Subbed off at R1 → bench | 10 |
| 20–30  | Still bench — step1 R2 & step1 HT: 0 added | 10 |
| 30–40  | Comes on at HT → on field — step1 R4 adds 10 | 20 |
| 40–50  | Subbed off at R4 → bench — step1 R5: 0 added | 20 |
| 50–60  | **`mustOn` fires at R5 (20+10=30≤30) → comes on** | **30 actual (not tracked)** |

The `playTimeMinutes` map never records the final 50–60 interval (there is no step1 at
`rotNum = totalRotations + 1`). The debug snapshot reading `playTimeMinutes` after the
algorithm finishes therefore shows **20** for this player.

More critically, if *fatigue* forces this player off field at R4 (they played the 30–40
interval as a striker with `continuousRotations = 1`), the guard check is:

```
played (20) + minutesRemaining (20) = 40 > 30  →  guard PASSES  →  player IS forced off
```

The guard correctly prevents removal only when `played + remaining ≤ threshold`.  Here
`40 > 30`, so the guard cannot help.  The player is benched at R4 with 20 minutes.  At R5
they are `mustOn` but now need 10 more minutes — which is exactly the final segment.  If
*any* complication (position lock, multi-player mustOn competition) prevents them from
coming on at R5, they end with 20 minutes.

### 2.2 The Competition Problem at R5 (Large Bench)

With 7 bench players, multiple players can simultaneously reach the `mustOn` condition at
R5.  `totalSubsNeeded` is correctly computed as `max(mustOn.length, baseSubsNeeded)`, so in
theory all mustOn players come on.  **But the window is razor-thin**: if they arrive at R5
with 20 minutes and the final segment is only 10 minutes they end at *exactly* 30, with no
margin.

The proactive fix below ensures these players are brought on **at R4** instead, giving them
the full 20 remaining minutes (10 from the R4→R5 interval + 10 from the final segment = 20
extra, yielding 40 total — well above the threshold).

### 2.3 The `baseSubsNeeded` Formula Is Format-Agnostic

`ceil(maxPlayersOnField / 3)` ignores bench size entirely:

| Format | maxOnField | baseSubsNeeded | Bench (16 players) | Bench slots / game |
|--------|-----------|----------------|-------------------|-------------------|
| 7v7    | 7         | 3              | 9                 | 12                |
| 9v9    | 9         | 3              | 7                 | 12                |
| 11v11  | 11        | 4              | 5                 | 16                |

For 9v9 / 16 players, `baseSubsNeeded = 3` is the same as 7v7 even though the bench is
smaller (7 vs 9) and has fewer total slots to distribute time.

### 2.4 Missing `positionMap.delete` in Regular Rotation Loop

The halftime substitution loop (lines 301–312) correctly calls `positionMap.delete(playerOut)`
after each substitution.  The **regular rotation** substitution loop (lines 420–430) does
**not** call `positionMap.delete(playerOutId)`.  This leaves stale position entries for
benched players, which:

- Can produce incorrect `nonGkField` filter results if a benched player's old GK-position
  entry persists into a subsequent rotation check.
- Causes inconsistent state if the same player cycles through GK at halftime and then a
  regular rotation later surfaces the stale entry.

---

## 3. Proposed Fixes

Four targeted changes to `rotationPlannerService.ts`, presented in dependency order.

---

### Fix 1 — Add `nextRotationIsHalftime` flag  
**File:** `src/services/rotationPlannerService.ts`  
**Location:** Lines 214–216 (inside the `for (let rotNum …)` loop, after `isLastRotation`)

**Reason:** The proactive `mustOn` check (Fix 2) must not fire when halftime immediately
follows, because the halftime rotation already guarantees all bench players come on
(`subsNeeded = min(maxPlayersOnField, bench.length)`).

**Current code (lines 214–216):**
```typescript
    const isLastFirstHalfRotation = rotNum === rotationsPerHalf;
    const isLastRotation = rotNum === totalRotations;
    const substitutions: PlannedSubstitution[] = [];
```

**New code:**
```typescript
    const isLastFirstHalfRotation = rotNum === rotationsPerHalf;
    const isLastRotation = rotNum === totalRotations;
    // True when the very next rotation is the halftime rotation.
    // Used by the proactive mustOn check: halftime guarantees all bench players
    // get time, so we don't need to fire mustOn one rotation early in that case.
    const nextRotationIsHalftime = (rotNum + 1 === rotationsPerHalf + 1);
    const substitutions: PlannedSubstitution[] = [];
```

---

### Fix 2 — Proactive `mustOn` (one-rotation look-ahead)  
**File:** `src/services/rotationPlannerService.ts`  
**Location:** Lines 360–370 (the `mustOn` accumulation loop inside the regular-rotation `else` branch)

**Reason:** The current condition `played + minutesRemaining <= threshold` fires only when a
bench player *cannot possibly* reach the threshold even with unlimited remaining field time.
This is the correct *last-resort* check, but for large benches (7 players, 3 sub slots per
rotation) it fires too late — at R5, when only 10 minutes remain.  A player needing 30
minutes total who sits through R4 at 20 minutes will get exactly 30 if brought on at R5,
but only if nothing goes wrong.

The proactive condition flags players one rotation earlier: *"if this bench player is skipped
this rotation AND the next rotation is also a regular rotation, they will be unable to reach
the threshold."*  Mathematically: `played + minutesRemaining - rotationIntervalMinutes ≤ threshold`.

For the 9v9 / 16-player scenario at R4 (remaining = 20, interval = 10, threshold = 30):
- Player with 20 min: `20 + 20 - 10 = 30 ≤ 30` → **proactive mustOn fires at R4** ✓  
- Player with 10 min: `10 + 20 - 10 = 20 ≤ 30` → also fires (already covered by standard check)
- Player with 30 min: `30 + 20 - 10 = 40 > 30` → no mustOn (correctly excluded)

The proactive condition is gated by two guards:
1. `!isLastRotation` — no point doing lookahead at the last rotation; standard check is enough.
2. `!nextRotationIsHalftime` — if halftime is next, it will bring all bench players on anyway.

**Current code (lines 360–370):**
```typescript
        // Must-on: 50% risk bench players (Rules 1.3, 2.2)
        const mustOn: string[] = [];
        for (const id of eligibleBench) {
          const p = playerById.get(id)!;
          const availTime = (p.availableUntilMinute ?? totalGameMinutes) - (p.availableFromMinute ?? 0);
          const threshold = availTime * 0.5;
          const played = playTimeMinutes.get(id) ?? 0;
          if (played + minutesRemaining <= threshold) {
            mustOn.push(id);
          }
        }
```

**New code:**
```typescript
        // Must-on: 50% risk bench players (Rules 1.3, 2.2)
        const mustOn: string[] = [];
        for (const id of eligibleBench) {
          const p = playerById.get(id)!;
          const availTime = (p.availableUntilMinute ?? totalGameMinutes) - (p.availableFromMinute ?? 0);
          const threshold = availTime * 0.5;
          const played = playTimeMinutes.get(id) ?? 0;

          // Standard: player cannot reach 50% even with all time remaining.
          const isAtRisk = played + minutesRemaining <= threshold;

          // Proactive (one-rotation look-ahead): if this player is skipped THIS
          // rotation AND the following rotation is also a regular rotation (not
          // halftime, not the last rotation), they will arrive at that next
          // rotation already unable to meet the threshold.
          // Condition: played + (remaining after missing this interval) <= threshold
          //          = played + minutesRemaining - rotationIntervalMinutes <= threshold
          // Only fires when bench is large enough that some players will be left out
          // of this rotation's substitutions (i.e., there is real competition for slots).
          const isProactive =
            !isLastRotation &&
            !nextRotationIsHalftime &&
            played + minutesRemaining - rotationIntervalMinutes <= threshold;

          if (isAtRisk || isProactive) {
            mustOn.push(id);
          }
        }
```

**Worked example confirming the fix resolves the described bug:**

At R4 (9v9, 16 players, rotationsPerHalf=2, interval=10, remaining=20, threshold=30):
- `isLastRotation = false` (R5 is last)
- `nextRotationIsHalftime = false` (R5 is a regular rotation, not HT)
- Bench players with 20 min: `20 + 20 - 10 = 30 ≤ 30` → **proactive mustOn**
- `totalSubsNeeded = max(mustOn.length, baseSubsNeeded)` now includes these players
- They come on at R4, play 40–50 (tracked at step1 R5) + 50–60 (final segment) = **20 more minutes**
- Final total: 20 + 20 = **40 minutes** — well above the 30-minute threshold ✓

**Proactive check behaviour across all rotation slots (9v9 baseline):**

| rotNum | remaining | isLastRot | nextIsHT | Proactive fires when played ≤ |
|--------|-----------|-----------|----------|-------------------------------|
| R1     | 50        | false     | false    | `played ≤ 50-10-30 = 10` (very conservative in H1) |
| R2     | 40        | false     | **true** | **Disabled** (halftime follows) |
| R3(HT) | —        | —         | —        | Halftime branch — not applicable |
| R4     | 20        | false     | false    | `played ≤ 20-10-30+threshold = played ≤ 20` ← key fix |
| R5     | 10        | **true**  | —        | **Disabled** (isLastRotation); standard check only |

---

### Fix 3 — Bench-proportional `baseSubsNeeded`  
**File:** `src/services/rotationPlannerService.ts`  
**Location:** Lines 390–402 (the `nonGkField` / `baseSubsNeeded` / `totalSubsNeeded` block)

**Reason:** `ceil(maxPlayersOnField / MIN_PLAYERS_PER_GROUP)` is designed for the 7v7
baseline and does not scale when there are more bench players than can be served by 3
subs/rotation.  The bench-proportional formula `ceil(benchSize / regularRotationsRemaining)`
computes the *minimum* number of substitutions at each rotation to ensure every bench player
gets at least one rotation of exposure before the end of the game.  This is a fairness
improvement (Rule 2.4) that also reduces the number of players who arrive at R4/R5 needing
the safety-net mustOn check.

`regularRotationsRemaining` counts only the regular (non-halftime) rotations that still
remain *after* the current one, because halftime rotations use a separate mechanism.

**Worked example (9v9, 7 bench, rotationsPerHalf=2, totalRotations=5):**

| rotNum | isSecondHalf | regularRotationsRemaining | minSubsForEquity | baseSubsNeeded (new) | baseSubsNeeded (old) |
|--------|-------------|--------------------------|-----------------|---------------------|---------------------|
| R1     | false       | (2-1)+2 = 3              | ceil(7/3) = 3   | max(3,3) = **3**    | 3                   |
| R2     | false       | (2-2)+2 = 2              | ceil(7/2) = 4   | max(3,4) = **4**    | 3                   |
| R4     | true        | 5-4 = 1                  | ceil(7/1) = 7   | min(max(3,7),7,8) = **7** | 3            |
| R5     | true        | 5-5 = 0                  | benchSize = 7   | min(max(3,7),7,8) = **7** | 3            |

With the new formula, by R4 the algorithm naturally rotates all 7 remaining bench players,
instead of waiting for `mustOn` to catch them one at a time at R5.

Note: `totalSubsNeeded` also gains a `nonGkField.length` cap (defensive fix) to ensure the
algorithm never requests more players to come off than are physically available on the
non-GK field.

**Current code (lines 390–402):**
```typescript
        // How many subs?
        const nonGkField = Array.from(currentField).filter(
          id => !goaliePositionId || positionMap.get(id) !== goaliePositionId
        );
        const baseSubsNeeded = Math.min(
          Math.ceil(maxPlayersOnField / GAME_CONFIG.ROTATION_CALCULATION.MIN_PLAYERS_PER_GROUP),
          eligibleBench.length,
          nonGkField.length
        );
        const totalSubsNeeded = Math.min(
          Math.max(forcedOff.length, Math.max(mustOn.length, baseSubsNeeded)),
          eligibleBench.length
        );
```

**New code:**
```typescript
        // How many subs?
        const nonGkField = Array.from(currentField).filter(
          id => !goaliePositionId || positionMap.get(id) !== goaliePositionId
        );

        // Bench-proportional minimum: distribute bench players evenly across the
        // remaining regular (non-halftime) rotations so everyone gets adequate exposure.
        // regularRotationsRemaining counts rotations AFTER the current one, halftime excluded.
        const benchSize = eligibleBench.length;
        const regularRotationsRemaining = isSecondHalf
          ? (totalRotations - rotNum)
          : (rotationsPerHalf - rotNum) + rotationsPerHalf;
        const minSubsForEquity =
          benchSize > 0 && regularRotationsRemaining > 0
            ? Math.ceil(benchSize / regularRotationsRemaining)
            : benchSize;

        const baseSubsNeeded = Math.min(
          Math.max(
            Math.ceil(maxPlayersOnField / GAME_CONFIG.ROTATION_CALCULATION.MIN_PLAYERS_PER_GROUP),
            minSubsForEquity,
          ),
          eligibleBench.length,
          nonGkField.length,
        );
        const totalSubsNeeded = Math.min(
          Math.max(forcedOff.length, Math.max(mustOn.length, baseSubsNeeded)),
          eligibleBench.length,
          nonGkField.length, // defensive: never request more off-subs than available field players
        );
```

---

### Fix 4 — Add missing `positionMap.delete` in regular rotation loop  
**File:** `src/services/rotationPlannerService.ts`  
**Location:** Lines 426–430 (inside the `for (const playerOutId of allPlayersOut)` loop)

**Reason:** The halftime loop at lines 307–312 correctly calls `positionMap.delete(playerOut)`
after each substitution.  The equivalent regular-rotation loop does not, leaving stale
position entries for subbed-off players.  This creates an inconsistency: a player benched
mid-H1 still has their GK or position entry in `positionMap`, which could produce incorrect
results in the `nonGkField` filter or future `positionMap.get` lookups in subsequent
rotations.

**Current code (lines 426–430):**
```typescript
              substitutions.push({ playerOutId, playerInId: assignment.playerId, positionId: position });
              currentField.delete(playerOutId);
              currentField.add(assignment.playerId);
              positionMap.set(assignment.playerId, position);
            }
```

**New code:**
```typescript
              substitutions.push({ playerOutId, playerInId: assignment.playerId, positionId: position });
              currentField.delete(playerOutId);
              currentField.add(assignment.playerId);
              positionMap.set(assignment.playerId, position);
              positionMap.delete(playerOutId); // remove stale entry — mirrors halftime loop
            }
```

---

## 4. Summary of All Line Changes

| Fix | Lines (current) | Change type | Risk |
|-----|----------------|-------------|------|
| 1 — `nextRotationIsHalftime` flag | After line 215 (insert) | Addition | None — read-only flag |
| 2 — Proactive `mustOn` | 367–369 (expand condition) | Logic change | Medium — increases mustOn set; covered by new tests |
| 3 — `baseSubsNeeded` + `totalSubsNeeded` | 394–402 (replace block) | Logic change | Medium — increases subs per rotation; covered by new tests |
| 4 — `positionMap.delete` | After line 429 (insert) | Bug fix | Low — removes stale entries; no existing test broke |

All four changes are **local to the regular-rotation `else` branch** of the main `for` loop
and do **not** touch the halftime branch, `calculatePlayTime`, `validateRotationPlan`, or
any exported public types.

---

## 5. New Test Cases

Add a new `describe` block immediately after the closing `});` of the existing
`'Spec Compliance — TC-01 through TC-10'` block (after line 1395).  This block reuses the
`computePlayMinutes` helper already defined inside that block, so it must be placed in the
same outer `describe('calculateFairRotations', …)` scope.  The helper should be extracted
to a shared scope (see Section 5.1 below).

### 5.1 Extract `computePlayMinutes` to shared scope

`computePlayMinutes` is currently defined inside `'Spec Compliance'` (line 1164).  It should
be moved up to the `describe('calculateFairRotations', …)` level so the new 9v9/11v11
describe block can use it.

**Move the function from inside `'Spec Compliance — TC-01 through TC-10'` to just before
`it('TC-01 …'`**, or define a second copy inside the new describe block (simpler approach).

The second copy approach is used below for self-contained tests.

---

### 5.2 New `describe` block to append

Insert the following block at the end of `describe('calculateFairRotations', …)`, after the
closing `});` at line 1395 and before the `describe('calculatePlayTime', …)` block at
line 593.

```typescript
  // ─────────────────────────────────────────────────────────────────
  // 9v9 and 11v11 scenarios — Rule 1.3 (50 % minimum playtime)
  // ─────────────────────────────────────────────────────────────────
  describe('9v9 and 11v11 scenarios — 50% playtime guarantee', () => {
    /**
     * Simulate actual play minutes from calculateFairRotations output.
     * Mirrors the helper used in the TC-01–TC-10 suite.
     */
    function computePlayMinutes(
      startingLineup: Array<{ playerId: string; positionId: string }>,
      rotations: Array<{ substitutions: PlannedSubstitution[] }>,
      rotationMinutes: number[],
      gameEndMinute: number,
    ): Map<string, number> {
      const field = new Map<string, string>();
      startingLineup.forEach(({ playerId, positionId }) => field.set(playerId, positionId));
      const playMin = new Map<string, number>();
      let lastMin = 0;
      for (let i = 0; i < rotations.length; i++) {
        const min = rotationMinutes[i];
        for (const pid of field.keys()) {
          playMin.set(pid, (playMin.get(pid) ?? 0) + (min - lastMin));
        }
        lastMin = min;
        for (const sub of rotations[i].substitutions) {
          field.delete(sub.playerOutId);
          field.set(sub.playerInId, sub.positionId);
        }
      }
      // Final segment after the last rotation
      for (const pid of field.keys()) {
        playMin.set(pid, (playMin.get(pid) ?? 0) + (gameEndMinute - lastMin));
      }
      return playMin;
    }

    // Shared position definitions for 9v9 (1 GK + 4 DEF + 2 MID + 1 LW + 1 ST)
    const positions9v9 = [
      { id: 'gk',  abbreviation: 'GK'  },
      { id: 'cb1', abbreviation: 'CB'  },
      { id: 'cb2', abbreviation: 'CB'  },
      { id: 'ld',  abbreviation: 'LB'  },
      { id: 'rd',  abbreviation: 'RB'  },
      { id: 'cm1', abbreviation: 'CM'  },
      { id: 'cm2', abbreviation: 'CM'  },
      { id: 'lw',  abbreviation: 'LW'  }, // STRIKER — max 1 continuous rotation
      { id: 'st',  abbreviation: 'ST'  }, // STRIKER — max 1 continuous rotation
    ];

    // Shared position definitions for 11v11 (1 GK + 4 DEF + 3 MID + 2 FWD + 1 CAM)
    const positions11v11 = [
      { id: 'gk',   abbreviation: 'GK'  },
      { id: 'lb',   abbreviation: 'LB'  },
      { id: 'cb1',  abbreviation: 'CB'  },
      { id: 'cb2',  abbreviation: 'CB'  },
      { id: 'rb',   abbreviation: 'RB'  },
      { id: 'lm',   abbreviation: 'LM'  },
      { id: 'cm',   abbreviation: 'CM'  },
      { id: 'rm',   abbreviation: 'RM'  },
      { id: 'cam',  abbreviation: 'CAM' },
      { id: 'lw',   abbreviation: 'LW'  }, // STRIKER
      { id: 'st',   abbreviation: 'ST'  }, // STRIKER
    ];

    // Common game parameters: 60-min game, 30-min halves, 10-min intervals
    // rotationsPerHalf=2, totalRotations=5
    // Rotation minutes: 10, 20, 30(HT), 40, 50 — game ends at 60
    const ROTATION_MINUTES_60 = [10, 20, 30, 40, 50];
    const GAME_END_60 = 60;
    const HALF_LENGTH_60 = 30;
    const INTERVAL_10 = 10;
    const MIN_PLAYTIME_50PCT = GAME_END_60 * 0.5; // 30 minutes

    // ── TC-9v9-01 ───────────────────────────────────────────────────
    it('TC-9v9-01: 9v9, 14 players (5 bench) — all players meet 50% minimum', () => {
      // 14 players: 9 starters + 5 bench.
      // All outfield players prefer their starting position for determinism.
      // Includes 2 STRIKER positions (LW, ST) to exercise fatigue cycling.
      const ALL_9V9_POSITIONS = 'gk, cb1, cb2, ld, rd, cm1, cm2, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk' },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'cb1' },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb2' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'ld' },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rd' },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'cm1' },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm2' },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'lw' },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'st' },
        // Bench — flexible across all outfield positions
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r14', playerId: 'p14', playerNumber: 14, preferredPositions: ALL_9V9_POSITIONS },
      ];

      const startingLineup = [
        { playerId: 'gk', positionId: 'gk'  },
        { playerId: 'p2', positionId: 'cb1' },
        { playerId: 'p3', positionId: 'cb2' },
        { playerId: 'p4', positionId: 'ld'  },
        { playerId: 'p5', positionId: 'rd'  },
        { playerId: 'p6', positionId: 'cm1' },
        { playerId: 'p7', positionId: 'cm2' },
        { playerId: 'p8', positionId: 'lw'  },
        { playerId: 'p9', positionId: 'st'  },
      ];

      const opts = {
        rotationIntervalMinutes: INTERVAL_10,
        halfLengthMinutes: HALF_LENGTH_60,
        positions: positions9v9,
      };

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5,    // totalRotations
        2,    // rotationsPerHalf
        9,    // maxPlayersOnField
        'gk', // goaliePositionId
        undefined,
        opts,
      );

      expect(rotations).toHaveLength(5);

      // Rule 1.1 / 1.2: no player both in and out in the same rotation
      rotations.forEach(rotation => {
        const outs = rotation.substitutions.map(s => s.playerOutId);
        const ins  = rotation.substitutions.map(s => s.playerInId);
        expect(new Set(outs).size).toBe(outs.length);
        expect(new Set(ins).size).toBe(ins.length);
        outs.forEach(id => expect(ins).not.toContain(id));
      });

      // Rule 1.3: all 14 players must reach the 50% threshold (30 minutes)
      const minutes = computePlayMinutes(
        startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60,
      );
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });
    });

    // ── TC-9v9-02 ───────────────────────────────────────────────────
    it('TC-9v9-02: 9v9, 16 players (7 bench) — all players meet 50% minimum [regression]', () => {
      // This is the exact configuration described in the bug report.
      // 16 players: 9 starters + 7 bench. baseSubsNeeded=3 (old formula) leaves
      // bench players underserved — this test MUST expose the bug without the fix
      // and MUST pass after applying Fixes 1–3.
      const ALL_9V9_POSITIONS = 'gk, cb1, cb2, ld, rd, cm1, cm2, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk'  },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'cb1' },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb2' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'ld'  },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rd'  },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'cm1' },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm2' },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'lw'  },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'st'  },
        // 7 bench players — all flexible
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r14', playerId: 'p14', playerNumber: 14, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r15', playerId: 'p15', playerNumber: 15, preferredPositions: ALL_9V9_POSITIONS },
        { id: 'r16', playerId: 'p16', playerNumber: 16, preferredPositions: ALL_9V9_POSITIONS },
      ];

      const startingLineup = [
        { playerId: 'gk', positionId: 'gk'  },
        { playerId: 'p2', positionId: 'cb1' },
        { playerId: 'p3', positionId: 'cb2' },
        { playerId: 'p4', positionId: 'ld'  },
        { playerId: 'p5', positionId: 'rd'  },
        { playerId: 'p6', positionId: 'cm1' },
        { playerId: 'p7', positionId: 'cm2' },
        { playerId: 'p8', positionId: 'lw'  },
        { playerId: 'p9', positionId: 'st'  },
      ];

      const opts = {
        rotationIntervalMinutes: INTERVAL_10,
        halfLengthMinutes: HALF_LENGTH_60,
        positions: positions9v9,
      };

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5, 2, 9, 'gk', undefined, opts,
      );

      expect(rotations).toHaveLength(5);

      // Rule 1.2: no field-to-field shuffles (a player subbed out must not appear in
      // the same rotation as playerIn for a different sub in the same rotation)
      rotations.forEach(rotation => {
        const outs = rotation.substitutions.map(s => s.playerOutId);
        const ins  = rotation.substitutions.map(s => s.playerInId);
        outs.forEach(id => expect(ins).not.toContain(id));
      });

      // Rule 1.3: EVERY player must reach 30 min (50% of 60)
      const minutes = computePlayMinutes(
        startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60,
      );
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });

      // Sanity: no one exceeds 60 min
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeLessThanOrEqual(GAME_END_60);
      });
    });

    // ── TC-11v11-01 ──────────────────────────────────────────────────
    it('TC-11v11-01: 11v11, 16 players (5 bench) — all players meet 50% minimum', () => {
      // 16 players: 11 starters + 5 bench.
      // Formation uses 2 STRIKER positions (LW, ST) for fatigue coverage.
      const ALL_11V11_POSITIONS = 'gk, lb, cb1, cb2, rb, lm, cm, rm, cam, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk'  },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'lb'  },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb1' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'cb2' },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rb'  },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'lm'  },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm'  },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'rm'  },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'cam' },
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: 'lw'  },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: 'st'  },
        // 5 bench — flexible
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_11V11_POSITIONS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_11V11_POSITIONS },
        { id: 'r14', playerId: 'p14', playerNumber: 14, preferredPositions: ALL_11V11_POSITIONS },
        { id: 'r15', playerId: 'p15', playerNumber: 15, preferredPositions: ALL_11V11_POSITIONS },
        { id: 'r16', playerId: 'p16', playerNumber: 16, preferredPositions: ALL_11V11_POSITIONS },
      ];

      const startingLineup = [
        { playerId: 'gk',  positionId: 'gk'  },
        { playerId: 'p2',  positionId: 'lb'  },
        { playerId: 'p3',  positionId: 'cb1' },
        { playerId: 'p4',  positionId: 'cb2' },
        { playerId: 'p5',  positionId: 'rb'  },
        { playerId: 'p6',  positionId: 'lm'  },
        { playerId: 'p7',  positionId: 'cm'  },
        { playerId: 'p8',  positionId: 'rm'  },
        { playerId: 'p9',  positionId: 'cam' },
        { playerId: 'p10', positionId: 'lw'  },
        { playerId: 'p11', positionId: 'st'  },
      ];

      const opts = {
        rotationIntervalMinutes: INTERVAL_10,
        halfLengthMinutes: HALF_LENGTH_60,
        positions: positions11v11,
      };

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5, 2, 11, 'gk', undefined, opts,
      );

      expect(rotations).toHaveLength(5);

      // Rule 1.4: GK never subbed in regular rotations (indices 0,1,3,4)
      for (const idx of [0, 1, 3, 4]) {
        rotations[idx].substitutions.forEach(s => {
          expect(s.playerOutId).not.toBe('gk');
          expect(s.positionId).not.toBe('gk');
        });
      }

      // Rule 1.3: all 16 players ≥ 30 min
      const minutes = computePlayMinutes(
        startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60,
      );
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });
    });

    // ── TC-11v11-02 ──────────────────────────────────────────────────
    it('TC-11v11-02: 11v11, 13 players (2 bench) — all players meet 50% minimum', () => {
      // Tight bench: only 2 substitutes. The algorithm must still ensure both get
      // their 30-minute minimum across a 60-minute game.
      // With 2 bench and 4 regular rotation slots (R1, R2, R4, R5), there is enough
      // capacity to give each bench player ≥ 2 rotations of field time.
      const ALL_11V11_POSITIONS = 'gk, lb, cb1, cb2, rb, lm, cm, rm, cam, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk'  },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'lb'  },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb1' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'cb2' },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rb'  },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'lm'  },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm'  },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'rm'  },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'cam' },
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: 'lw'  },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: 'st'  },
        // 2 bench players only
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_11V11_POSITIONS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_11V11_POSITIONS },
      ];

      const startingLineup = [
        { playerId: 'gk',  positionId: 'gk'  },
        { playerId: 'p2',  positionId: 'lb'  },
        { playerId: 'p3',  positionId: 'cb1' },
        { playerId: 'p4',  positionId: 'cb2' },
        { playerId: 'p5',  positionId: 'rb'  },
        { playerId: 'p6',  positionId: 'lm'  },
        { playerId: 'p7',  positionId: 'cm'  },
        { playerId: 'p8',  positionId: 'rm'  },
        { playerId: 'p9',  positionId: 'cam' },
        { playerId: 'p10', positionId: 'lw'  },
        { playerId: 'p11', positionId: 'st'  },
      ];

      const opts = {
        rotationIntervalMinutes: INTERVAL_10,
        halfLengthMinutes: HALF_LENGTH_60,
        positions: positions11v11,
      };

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5, 2, 11, 'gk', undefined, opts,
      );

      expect(rotations).toHaveLength(5);

      // Rule 2.5: both bench players (p12, p13) must appear on field at some point
      const allSubs = rotations.flatMap(r => r.substitutions);
      expect(allSubs.some(s => s.playerInId === 'p12')).toBe(true);
      expect(allSubs.some(s => s.playerInId === 'p13')).toBe(true);

      // Rule 1.3: all 13 players ≥ 30 min
      const minutes = computePlayMinutes(
        startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60,
      );
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });
    });
  }); // end describe '9v9 and 11v11 scenarios'
```

---

## 6. Spec Updates (`Rotation-Algorithm-Requirements.md`)

Append the following two sections to the end of the document.

### 6.1 Section to append — 9v9 test suite

```markdown
# Test Suite: 9v9 Rotation Algorithm (14- and 16-Player Rosters)

**Baseline Testing Environment:**
* **Game Duration:** 60 minutes (Two 30-minute halves)
* **Minimum Playtime (50%):** 30 minutes per player
* **Rotation Interval:** 10 minutes — 2 rotations per half, 5 total (including halftime)
* **Rotation Schedule:** R1→10 min, R2→20 min, R3→30 min (HT), R4→40 min, R5→50 min
* **Positions:** 1 GK, 2 CB, 1 LB, 1 RB, 2 CM, 1 LW (Striker), 1 ST (Striker)
* **Bench sizes tested:** 5 players (14-player roster) and 7 players (16-player roster)

---

**TC-9v9-01: 14-Player Roster — All Players Meet 50%**
* **Objective:** Validate Rule 1.3 for 9v9 with a moderate bench (5 players).
* **Setup:** 9 starters (including GK), 5 bench. All bench players flexible across positions.
  Two striker positions (LW, ST) with max-1-continuous-rotation fatigue rule active.
* **Expected Result:**
    * (Rule 1.3) All 14 players accumulate ≥ 30 minutes of actual playing time.
    * (Rule 1.2) No field-to-field direct position reassignments occur in any rotation.
    * (Rule 1.4) GK position is not substituted in regular rotations (R1, R2, R4, R5).

**TC-9v9-02: 16-Player Roster — All Players Meet 50% [Regression Test]**
* **Objective:** Validate Rule 1.3 for 9v9 with a large bench (7 players). This is the
  configuration from the reported bug where one player received only 20 minutes of play.
* **Setup:** 9 starters (including GK), 7 bench. `baseSubsNeeded` (old formula) = 3,
  which provides only 12 sub-slots across 4 regular rotations for 7 bench players.
* **Root Cause (pre-fix):** With 7 bench players and only 3 subs per rotation, a bench
  player with 20 minutes who is not flagged `mustOn` at R4 (since `20+20=40>30`) can be
  skipped at R4, left with only the final 10-minute segment available — resulting in
  exactly 30 minutes under ideal conditions and below 30 minutes under any adverse
  condition (fatigue cycling, competing mustOn players).
* **Expected Result (post-fix):**
    * (Rule 1.3) All 16 players accumulate ≥ 30 minutes.
    * (Rule 2.4) Playtime variance across all 16 players is minimised; no player receives
      more than 60 minutes or fewer than 30 minutes.
    * (Rule 1.2) No field-to-field shuffles in any rotation.
    * (Rule 1.4) GK not subbed in regular rotations.
```

### 6.2 Section to append — 11v11 test suite

```markdown
# Test Suite: 11v11 Rotation Algorithm (13- and 16-Player Rosters)

**Baseline Testing Environment:**
* **Game Duration:** 60 minutes (Two 30-minute halves)
* **Minimum Playtime (50%):** 30 minutes per player
* **Rotation Interval:** 10 minutes — 2 rotations per half, 5 total (including halftime)
* **Positions:** 1 GK, 1 LB, 2 CB, 1 RB, 1 LM, 1 CM, 1 RM, 1 CAM, 1 LW (Striker), 1 ST (Striker)
* **Bench sizes tested:** 2 players (13-player roster) and 5 players (16-player roster)

---

**TC-11v11-01: 16-Player Roster — All Players Meet 50%**
* **Objective:** Validate Rule 1.3 for 11v11 with a moderate bench (5 players).
* **Setup:** 11 starters (including GK), 5 bench. All bench players flexible across
  positions. Two striker positions active with fatigue cycling.
* **Expected Result:**
    * (Rule 1.3) All 16 players accumulate ≥ 30 minutes.
    * (Rule 1.4) GK not subbed in regular rotations.
    * (Rule 1.2) No field-to-field shuffles.

**TC-11v11-02: 13-Player Roster — Tight Bench (2 players)**
* **Objective:** Validate that with only 2 bench players (TC-10 boundary case for 11v11),
  both players still receive their minimum playtime and both appear on field in both halves.
* **Setup:** 11 starters, 2 bench players. Both bench players flexible across positions.
* **Expected Result:**
    * (Rule 1.3) Both bench players accumulate ≥ 30 minutes.
    * (Rule 2.5) Both bench players are subbed onto the field at least once.
    * (Rule 1.4) GK not subbed in regular rotations.
```

---

## 7. Acceptance Criteria

The implementation is complete and correct when **all** of the following are true:

| # | Criterion |
|---|-----------|
| AC-1 | `TC-9v9-02` passes: all 16 players in a 9v9 game have ≥ 30 minutes of actual play time |
| AC-2 | `TC-9v9-01` passes: all 14 players in a 9v9 game have ≥ 30 minutes |
| AC-3 | `TC-11v11-01` passes: all 16 players in an 11v11 game have ≥ 30 minutes |
| AC-4 | `TC-11v11-02` passes: both bench players in a 13-player 11v11 game have ≥ 30 minutes |
| AC-5 | All existing tests in `TC-01` through `TC-10` continue to pass without modification |
| AC-6 | The existing striker-fatigue regression test (line 495–590, `'should not drop a striker below 50% threshold'`) continues to pass |
| AC-7 | No new TypeScript compiler errors introduced |
| AC-8 | The `positionMap` after each regular rotation contains entries only for players currently on the field (Fix 4 verified) |

---

## 8. Implementation Order and Dependencies

Apply the fixes in this order to minimise risk of merge conflicts and to keep each commit
independently reviewable:

```
Step 1:  Fix 4 (positionMap.delete) — isolated, no logic change, no test impact
Step 2:  Fix 1 (nextRotationIsHalftime flag) — prerequisite for Fix 2
Step 3:  Fix 2 (proactive mustOn) — depends on Fix 1
Step 4:  Fix 3 (baseSubsNeeded + totalSubsNeeded) — independent of Fix 2 but complementary
Step 5:  New test cases (TC-9v9-01/02, TC-11v11-01/02) — written before Fix 2/3 to
         confirm they fail on the unfixed code, then re-run after to confirm they pass
Step 6:  Spec appendix — documentation only, no test impact
```

---

## 9. Risks and Mitigations

### Risk 1 — Proactive `mustOn` increases substitution count at R4

**Impact:** At R4 with 7 bench players and several having 20 minutes, `mustOn` may now
include 3–5 players, raising `totalSubsNeeded` above `baseSubsNeeded`.  This produces more
substitutions than a coach might expect at that rotation.

**Mitigation:** `totalSubsNeeded` is still capped by `Math.min(..., eligibleBench.length, nonGkField.length)`,
so it can never exceed the number of available field positions.  The increase is expected and
correct per Rule 2.4 (minimise playtime variance).  Add a comment in the code explaining
why R4 may have more substitutions than earlier rotations.

### Risk 2 — Bench-proportional `baseSubsNeeded` increases rotation churn

**Impact:** At R4 with 7 bench players and `regularRotationsRemaining = 1`, `minSubsForEquity = 7`,
and `baseSubsNeeded` rises to 7 (capped by `nonGkField.length = 8`).  Seven players rotate
at once — effectively a second-half version of the halftime swap.  This is logically correct
but may feel aggressive in the UI.

**Mitigation:** This is only triggered when nearly all bench players are still waiting for
their second-half stint.  The halftime rotation handles this naturally for large benches
(9 or 11 players on field) — the new formula brings regular rotations in line with the same
fairness principle.  Run manual end-to-end tests with the 9v9/16-player scenario in the
game-planner UI to validate the visual output before shipping.

### Risk 3 — `nextRotationIsHalftime` edge case with `rotationsPerHalf = 0`

**Impact:** If `rotationsPerHalf = 0` (no first-half rotations; the single rotation is
halftime), `rotNum + 1 = 1` and `rotationsPerHalf + 1 = 1`, so `nextRotationIsHalftime`
would be `true` at `rotNum = 0` — which is unreachable (loop starts at 1).  No issue.

**Mitigation:** Confirm the existing coach-set halftime lineup test (lines 336–384, which
uses `totalRotations=1, rotationsPerHalf=0`) continues to pass unchanged.

### Risk 4 — `regularRotationsRemaining` calculation in edge-case `rotationsPerHalf` values

**Impact:** For `rotationsPerHalf = 1` (one rotation per half), `R1` is in H1, `R2` is
halftime, `R3` is the only H2 rotation.  At `R3` (isSecondHalf=true, rotNum=3, totalRotations=3):
`regularRotationsRemaining = 3 - 3 = 0`.  The formula uses `benchSize` directly when
`regularRotationsRemaining = 0`.

**Mitigation:** Verify `TC-11v11-02` (which uses the same 5-rotation setup) covers this.
Also run the existing `'should create 1 rotation per half for 30-min halves with 15-min intervals'`
test (line 1430) to confirm.

---

## 10. Files Changed (Summary)

| File | Change |
|------|--------|
| `src/services/rotationPlannerService.ts` | 4 targeted changes: `nextRotationIsHalftime` flag (insert ~line 216), proactive `mustOn` (replace lines 367–369), bench-proportional `baseSubsNeeded` + `totalSubsNeeded` cap (replace lines 394–402), `positionMap.delete` (insert after line 429) |
| `src/services/rotationPlannerService.test.ts` | Append `describe('9v9 and 11v11 scenarios …')` block after line 1395 with 4 new `it()` tests |
| `docs/specs/Rotation-Algorithm-Requirements.md` | Append two new test suite sections for 9v9 and 11v11 |
| `src/constants/gameConfig.ts` | **No changes** — `MIN_PLAYERS_PER_GROUP: 3` remains valid as a denominator in the updated formula |
