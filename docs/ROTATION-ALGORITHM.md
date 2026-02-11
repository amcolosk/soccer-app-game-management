# Rotation Algorithm

This document describes how the auto-generate rotations feature works. The algorithm lives in [`src/services/rotationPlannerService.ts`](../src/services/rotationPlannerService.ts) and is invoked from two places:

- **Game Planner** — the "🔄 Auto-Generate Rotations" button (`handleAutoGenerateRotations`)
- **Game Management** — the "🔄 Recalculate Rotations" button inside the plan-conflicts banner (`handleRecalculateRotations`)

Both call the same `calculateFairRotations` function with the same inputs.

---

## Inputs

| Parameter | Description |
|---|---|
| `availablePlayers` | Roster entries for players whose availability is `available` or `late-arrival`. Each entry includes `playerId`, `playerNumber`, and an optional `preferredPositions` string. |
| `startingLineup` | Array of `{ playerId, positionId }` pairs representing who starts in which position. |
| `totalRotations` | Total number of rotation slots across the game (e.g. 4 for two 30-minute halves with 10-minute intervals). |
| `rotationsPerHalf` | How many rotations fall in the first half. Used to detect the halftime boundary. |
| `maxPlayersOnField` | Maximum number of players on the field at once (e.g. 6 for U8 7v7 minus the goalie). |

## Outputs

An array of rotation objects, each containing a `substitutions` array of `{ playerOutId, playerInId, positionId }`.

---

## Core Concepts

### Play-Time Tracking

The algorithm tracks play time in **rotation units** (not minutes). Each rotation unit is one interval where a player is on the field. At the end of each rotation loop, every player currently on the field gets their counter incremented by 1.

Starters begin with 1 unit of play time; bench players begin with 0.

### Preferred Positions

Each player may have a `preferredPositions` string — a comma-separated list of formation position IDs (e.g. `"pos1, pos3"`). The algorithm parses these into a lookup map at the start and uses them during position assignment.

---

## Algorithm Flow

### 1. Initialization

```
preferredPositionsMap = Map<playerId, Set<positionId>>   (parsed from comma-separated strings)
currentField          = Set<playerId>                     (from startingLineup)
positionMap           = Map<playerId, positionId>         (who is in which position)
playTimeRotations     = Map<playerId, number>             (starters = 1, bench = 0)
```

### 2. For Each Rotation (1 → totalRotations)

The algorithm branches based on whether the current rotation is the **halftime swap** or a **regular rotation**.

#### Halftime Swap (rotNum = rotationsPerHalf + 1)

The goal is to give bench players maximum playing time by swapping as many field players out as possible.

1. Identify all bench players and sort by **least play time** (ascending).
2. Determine how many subs are needed: `min(maxPlayersOnField, benchPlayers.length)`.
3. Collect the positions being vacated from the field players being subbed out.
4. **Assign bench players to positions** using the [position matching algorithm](#position-matching).
5. Execute the swaps — update `currentField`, `positionMap`.

#### Regular Rotation (all other rotations)

The goal is to rotate roughly ⅓ of the field each time, subbing out whoever has played the most for whoever has played the least.

1. Sort field players by **most play time** (descending) → candidates to come off.
2. Sort bench players by **least play time** (ascending) → candidates to come on.
3. Calculate subs needed:  
   ```
   min(ceil(maxPlayersOnField / 3), benchPlayers.length, fieldPlayers.length)
   ```
4. Take the top `subsNeeded` field players (most time) and collect their positions.
5. **Assign bench players to positions** using the [position matching algorithm](#position-matching).
6. Execute the swaps.

#### After Each Rotation

Every player currently on the field gets `+1` to their play-time counter.

---

## Position Matching

When multiple bench players are entering and multiple positions are open, the algorithm uses a two-pass assignment to respect preferred positions:

### Pass 1 — Preference Match

Iterate through bench candidates (already sorted by least play time). For each candidate, scan the available positions. If the candidate's `preferredPositions` set contains one of the open positions, assign them there immediately.

This means a player with less play time gets first pick of their preferred positions.

### Pass 2 — Fallback Fill

Any remaining unassigned bench players are slotted into remaining open positions in play-time order (least first). No position preference is considered — it's purely time-fairness.

### Result

Each bench player inherits a specific position on the field. The substitution records which position they're filling and who they're replacing.

---

## Rotation Timing

Rotation timing is calculated by `calculateRotationMinute`:

| Half | Formula |
|---|---|
| First half | `rotationNumber × rotationIntervalMinutes` |
| Second half | `halfLengthMinutes + (rotationInSecondHalf × rotationIntervalMinutes)` |

For example, with 30-minute halves and 10-minute intervals:

| Rotation | Half | Game Minute |
|---|---|---|
| 1 | 1 | 10 |
| 2 | 1 | 20 |
| 3 | 2 | 40 |
| 4 | 2 | 50 |

Rotation 3 is the first rotation of the second half, which triggers the halftime swap.

---

## Worked Example

**Setup:** 8 players, 6 field positions, 30-min halves, 10-min intervals (4 rotations, 2 per half).

| Player | Preferred Positions | Starting |
|---|---|---|
| P1 | pos1 | pos1 (field) |
| P2 | pos2 | pos2 (field) |
| P3 | pos3 | pos3 (field) |
| P4 | pos4 | pos4 (field) |
| P5 | pos5 | pos5 (field) |
| P6 | pos6 | pos6 (field) |
| P7 | pos1 | bench |
| P8 | pos2 | bench |

**Rotation 1 (minute 10) — Regular:**
- Field players sorted by most time: P1–P6 all have 1 unit.
- Bench sorted by least time: P7 (0), P8 (0).
- Subs needed: `ceil(6/3) = 2`, capped to 2 bench players.
- Players out: P1, P2 (first two with most time — tied, so order is as iterated).
- Positions vacated: pos1, pos2.
- **Pass 1:** P7 prefers pos1 → assigned. P8 prefers pos2 → assigned.
- Result: P7→pos1, P8→pos2.

**Rotation 2 (minute 20) — Regular:**
- Field: P3, P4, P5, P6 (time=2), P7, P8 (time=1).
- Bench: P1, P2 (time=1).
- Subs needed: 2.
- Players out: P3, P4 (most time = 2).
- P1 prefers pos3? No. P2 prefers pos4? No.
- **Pass 2 fallback:** P1→pos3, P2→pos4.

**Rotation 3 (minute 40) — Halftime Swap:**
- Field: P5, P6 (time=3), P7, P8 (time=2), P1, P2 (time=2).
- Bench: P3, P4 (time=2).
- Only 2 bench players, so 2 subs (not a full 6-player swap).
- Players out: P5, P6 (first two field players).
- P3 prefers pos3 (not pos5/pos6). P4 prefers pos4 (not pos5/pos6).
- **Pass 2 fallback:** P3→pos5, P4→pos6.

**Rotation 4 (minute 50) — Regular:**
- Continues the same pattern, subbing out the two with the most accumulated time.

---

## Conflict Detection & Recalculation

In **Game Management**, the `getPlanConflicts` function scans the starting lineup and all planned rotations for players whose availability is `absent` or `injured`. If conflicts are found:

1. A **⚠️ Plan Conflicts** banner is shown listing the affected players.
2. A **🔄 Recalculate Rotations** button appears.
3. Clicking it calls `calculateFairRotations` with only available players and updates all `PlannedRotation` records in the database.

The recalculation also filters unavailable starters out of the starting lineup before computing, so the algorithm only works with players who can actually play.

---

## Related Functions

| Function | Purpose |
|---|---|
| `calculateFairRotations` | Core algorithm described above |
| `calculateRotationMinute` | Computes game minute for a given rotation number |
| `calculatePlayTime` | Projects total minutes per player from a rotation plan |
| `validateRotationPlan` | Checks for duplicate subs, field overflow, etc. |
| `copyGamePlan` | Copies a plan (with rotations) from another game |
| `updatePlayerAvailability` | Sets a player's availability status for a game |

## Test Coverage

The algorithm has 31 tests in [`rotationPlannerService.test.ts`](../src/services/rotationPlannerService.test.ts) covering:

- Correct number of rotations generated
- Even play-time distribution
- Various roster sizes (6, 7, 8, 12 players)
- Halftime full swap behavior
- Preferred position matching (single and multiple preferences)
- Fallback when no preferred positions are set
- Halftime position preference matching
- Play-time calculation accuracy
- Rotation validation edge cases
- Rotation minute calculation for different intervals
