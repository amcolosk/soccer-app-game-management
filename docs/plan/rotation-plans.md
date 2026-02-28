# Plan: Rotation Algorithm Upgrade to Meet Requirements Spec

## Context

The current `calculateFairRotations` function in `rotationPlannerService.ts` is a greedy rotation scheduler with basic playtime balancing. It does not enforce the 10 requirements defined in `docs/specs/Rotation-Algorithm-Requirements.md`. Specifically missing: 50% minimum playtime guarantee, goalie preference lock, positional fatigue/max-shift logic, per-half coverage guarantee, late-arrival/injury proportional playtime, and a "no eligible goalies" warning path. This plan upgrades the algorithm to be spec-compliant while preserving backward compatibility with callers.

---

## Phases

### Phase 1: Schema Migration
**File:** `amplify/data/resource.ts`

Add two optional integer fields to `PlayerAvailability`:
```ts
availableFromMinute: a.integer(),  // null = available from game start (0)
availableUntilMinute: a.integer(), // null = available until game end
```

These enable proportional 50% minimum for TC-07 (mid-game injury) and TC-08 (late arrival).

---

### Phase 2: Service Layer Rewrite
**File:** `src/services/rotationPlannerService.ts`

#### 2a. Updated `SimpleRoster` interface (add availability window)
```ts
export interface SimpleRoster {
  id: string;
  playerId: string;
  playerNumber: number;
  preferredPositions?: string;
  availableFromMinute?: number;   // NEW
  availableUntilMinute?: number;  // NEW
}
```

#### 2b. New types
```ts
interface RotationOptions {
  rotationIntervalMinutes: number;
  halfLengthMinutes: number;
  positions?: Array<{ id: string; abbreviation?: string | null }>;
}

interface RotationResult {
  rotations: Array<{ substitutions: PlannedSubstitution[] }>;
  warnings: string[];
}
```

#### 2c. Position group inference helper (Rule 2.3)
```ts
type PositionGroup = 'GOALKEEPER' | 'STRIKER' | 'MIDFIELDER' | 'DEFENDER' | 'UNKNOWN';

function inferPositionGroup(abbreviation?: string | null): PositionGroup
```
Abbreviation mappings (case-insensitive):
- `GK, G, GOAL` → GOALKEEPER
- `FW, FWD, ST, S, CF, LW, RW, W, WF` → STRIKER
- `MF, MID, CM, RM, LM, AM, DM, CAM, CDM` → MIDFIELDER
- `DF, DEF, CB, LB, RB, LWB, RWB` → DEFENDER

Max continuous rotation units per group (hardcoded defaults):
- GOALKEEPER: Infinity (locked for full half)
- STRIKER / WING: 1 (one rotation interval)
- MIDFIELDER: 2
- DEFENDER: 2

#### 2d. Updated `calculateFairRotations` signature
```ts
export function calculateFairRotations(
  availablePlayers: SimpleRoster[],
  startingLineup: Array<{ playerId: string; positionId: string }>,
  totalRotations: number,
  rotationsPerHalf: number,
  maxPlayersOnField: number,
  goaliePositionId?: string,
  halftimeLineup?: Array<{ playerId: string; positionId: string }>,
  options?: RotationOptions   // NEW — backward-compatible optional
): RotationResult              // CHANGED from array to result object
```

#### 2e. Algorithm logic additions

**Pre-loop validation:**
- **TC-09 (Rule 1.5):** Check if any available player has "GK"/"G"/"GOAL" in `preferredPositions`. If none and `goaliePositionId` is set → push warning: `"No eligible goalies available. Please assign a goalkeeper manually."` Continue generating field-player rotations, leaving GK slot handled by starting lineup only.
- **TC-10 Short bench:** `noSubsAvailable = availablePlayers.length <= maxPlayersOnField`. If true, skip fatigue rules.

**New state per rotation loop:**
- `playTimeMinutes: Map<string, number>` — actual minutes accrued (calculated as `rotationIntervalMinutes` units per rotation interval; halftime does not add play time)
- `continuousRotations: Map<string, number>` — consecutive rotation intervals on field (reset to 0 on bench)
- `halfOnField: { first: Set<string>; second: Set<string> }` — which players were on field each half (for Rule 2.5)
- `positionGroupMap: Map<positionId, PositionGroup>` — built once from `options.positions`

**Per rotation — additional logic (in order):**

1. **Accumulate play time** — before computing subs, add `rotationIntervalMinutes` to each on-field player's `playTimeMinutes`. Track first/second half field status.

2. **Fatigue/must-off list (Rule 2.3)** — find on-field non-GK players whose `continuousRotations` equals the max for their position group. These are forced off (added to the "must sub out" candidates) before the normal most-time-first selection.

3. **50% risk — must-on list (Rules 1.3, 2.2)** — for each bench player, compute their available time:
   - `availableTime = (player.availableUntilMinute ?? totalGameMinutes) - (player.availableFromMinute ?? 0)`
   - `50threshold = availableTime * 0.5`
   - `minutesRemaining = totalGameMinutes - currentGameMinute`
   - If `playTimeMinutes[player.id] + minutesRemaining <= 50threshold`, player is at risk → mark as "must come on"
   - At-risk players can be placed in non-preferred positions (Rule 2.2) but NOT in GK (Rule 1.5)

4. **Goalie preference lock (Rule 1.5)** — when filling any position, if `positionId === goaliePositionId`, only players with GK in `preferredPositions` are eligible candidates.

5. **Per-half coverage (Rule 2.5)** — In the final rotation of each half (rotNum === rotationsPerHalf for first half; rotNum === totalRotations for second half), check if any players haven't been on field yet in that half. Prioritize them for inclusion in the final sub-set if bench slots are available.

6. **Halftime handling** — existing logic preserved. At halftime: mark which players played first half. Post-halftime: reset `continuousRotations` for all players.

---

### Phase 3: Update Callers

**File: `src/components/GamePlanner.tsx` (line ~605)**
```ts
const { rotations: generatedRotations, warnings: planWarnings } = calculateFairRotations(
  availableRoster,
  lineupArray,
  rotations.length,
  rotationsPerHalf,
  team.maxPlayersOnField || positions.length,
  goaliePositionId,
  halftimeLineupArray,
  { rotationIntervalMinutes, halfLengthMinutes, positions }
);
// Display planWarnings inline near the "Generate Plan" button if non-empty
```

The `availableRoster` map must also include availability windows:
```ts
.map(p => ({
  id: p.id,
  playerId: p.id,
  playerNumber: p.playerNumber || 0,
  preferredPositions: p.preferredPositions,
  availableFromMinute: availabilityRecords.find(a => a.playerId === p.id)?.availableFromMinute ?? undefined,
  availableUntilMinute: availabilityRecords.find(a => a.playerId === p.id)?.availableUntilMinute ?? undefined,
}))
```

**File: `src/components/GameManagement/GameManagement.tsx` (line ~215)**
```ts
const { rotations: generatedRotations } = calculateFairRotations(
  availableRoster,
  lineupArray,
  plannedRotations.length,
  rotationsPerHalf,
  team.maxPlayersOnField || positions.length,
  goaliePositionId,  // Derive same way as GamePlanner (abbr === 'GK' || 'G')
  undefined,
  { rotationIntervalMinutes, halfLengthMinutes, positions }
);
```

---

### Phase 4: Availability Window UI

**File: `src/components/PlayerAvailabilityGrid.tsx`**
- When status cycles to `"late-arrival"`: set `availableFromMinute = halfLengthMinutes` (default — player expected at halftime). Show a small editable minute input next to the status if needed.
- When status cycles to `"injured"`: pass current elapsed game seconds ÷ 60 as `availableUntilMinute`. (GameManagement.tsx currently passes game state to child components — wire through elapsedSeconds prop.)

**File: `src/services/rotationPlannerService.ts` — `updatePlayerAvailability`**
Add `availableFromMinute?: number` and `availableUntilMinute?: number` to the function signature and the create/update calls.

---

### Phase 5: Tests

**File: `src/services/rotationPlannerService.test.ts`**

**Breaking change:** All existing calls to `calculateFairRotations` returning an array must be updated to destructure `{ rotations }` from the `RotationResult`.

**New test suite: "Spec Compliance — TC-01 through TC-10"**

Baseline fixture (5v5, 7 players, 40-min game, 20-min halves, 5-min intervals):
- Positions: `pos-gk` (GK), `pos-def1` (DF), `pos-def2` (DF), `pos-fwd1` (FW), `pos-fwd2` (FW)
- 7 players p1–p7, all positions preferred
- `rotationsPerHalf = 3`, `totalRotations = 6`, `rotationIntervalMinutes = 5`, `halfLengthMinutes = 20`
- Options: `{ rotationIntervalMinutes: 5, halfLengthMinutes: 20, positions: [...] }`

| TC | Assertion |
|----|-----------|
| TC-01 | All 7 players: 25–30 min; each in first AND second half; exactly 1 GK sub (at halftime) |
| TC-02 | Only GK-preferred players ever assigned to `pos-gk`; GK plays full half each |
| TC-03 | No player appears in two positions at same rotation; no field-to-field direct swap |
| TC-04 | Player with only FWD preference gets DEF minutes to hit 50% minimum; NOT assigned GK |
| TC-05 | FWD player max 1 continuous rotation (5 min); DEF player up to 2 (10 min) |
| TC-06 | Single GK plays full 40 min; 6 field players 25–28 min each |
| TC-07 | Player F `availableUntilMinute=10` → min 5 min played before; remaining 6 players still hit 20-min min |
| TC-08 | Player G `availableFromMinute=20` → scheduled ≥10 min in 2nd half; no error for missing 1st half |
| TC-09 | No GK-preferred player → `warnings` contains "No eligible goalies available" |
| TC-10 | Exactly 5 players → all play 40 min (100%); no fatigue-based subs attempted |

---

## Critical Files

| File | Change |
|------|--------|
| `amplify/data/resource.ts` | Add `availableFromMinute`, `availableUntilMinute` to `PlayerAvailability` |
| `src/services/rotationPlannerService.ts` | Core algorithm rewrite |
| `src/services/rotationPlannerService.test.ts` | Update existing tests; add TC-01—TC-10 |
| `src/components/GamePlanner.tsx` | Update call site; display warnings |
| `src/components/GameManagement/GameManagement.tsx` | Update call site; pass options |
| `src/components/PlayerAvailabilityGrid.tsx` | Pass `availableFromMinute`/`availableUntilMinute` |

---

## Verification

1. **Unit tests:** `npm run test:run` — all existing tests pass (after destructuring update); all 10 new TCs pass
2. **TypeScript:** `npm run build` — no type errors
3. **Manual E2E smoke test (GamePlanner):** Create 7-player team, mark all available, generate plan → verify plan shows balanced minutes + no GK-preference warning
4. **TC-09 smoke test:** Create team with no GK-preferred players → GamePlanner shows warning banner after generating plan
5. **TC-08 smoke test:** Mark 1 player as "late arrival" → generated plan excludes them from 1st-half rotations, schedules ≥50% of 2nd half
