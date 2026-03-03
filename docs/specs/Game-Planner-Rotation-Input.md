# Game Planner — Coupled Rotation Input Spec

**Feature:** Coupled "Rotations per half" + "Interval (min)" inputs  
**Status:** Planned  
**Related plan:** Stage 1 complete (see chat — March 2 2026)

---

## 1. Motivation

The current rotation setup card shows three fixed pill buttons: **5 min · 10 min · 15 min**. Coaches who run non-standard half lengths (e.g. 25-min or 40-min halves) or who think in terms of *"I want 3 rotations per half"* rather than *"I want a rotation every 10 minutes"* have no way to express that intent. Both mental models should be equally valid entry points.

---

## 2. User Stories

| ID | Story |
|----|-------|
| RS-1 | As a coach with a 25-min half, I want to type "3 rotations per half" so the app calculates the right interval automatically. |
| RS-2 | As a coach, I want to type an interval (e.g. 7 min) and immediately see how many rotations that gives me per half so I can confirm the plan makes sense. |
| RS-3 | As a coach, I want both inputs always visible so I can understand the rotation schedule at a glance without mental math. |

---

## 3. Behaviour

### 3.1 Inputs

Two numeric steppers, always both visible and always coupled:

| Input | Label | Unit |
|-------|-------|------|
| A | Rotations / half | whole number |
| B | Every | minutes |

### 3.2 Coupling Math

Single source of truth: **`rotationIntervalMinutes`** (matches the existing `GamePlan.rotationIntervalMinutes` field — no schema change).

**Editing input A (rotations per half → derive interval):**
```
intervalMinutes = round(halfLengthMinutes / (rotationsPerHalf + 1))
```

**Editing input B (interval → derive rotations):**
```
rotationsPerHalf = floor(halfLengthMinutes / intervalMinutes) - 1
```
Input A immediately displays the derived value (display-only — never stored separately).

**Derivation example for a 30-min half:**

| Rotations typed | Derived interval | Interval typed | Derived rotations |
|-----------------|-----------------|----------------|-------------------|
| 1 | 15 min | 5 min | 5 |
| 2 | 10 min | 10 min | 2 |
| 3 | 8 min | 15 min | 1 |
| 5 | 5 min | 7 min | 3 |

### 3.3 Clamp / Validation Rules

| Condition | Clamp |
|-----------|-------|
| Interval < 1 | Clamp to 1 |
| Interval ≥ halfLengthMinutes | Clamp to halfLengthMinutes; rotations shows 0 |
| Rotations < 0 | Clamp to 0 (interval = halfLengthMinutes; halftime-only plan) |
| Rotations > floor(halfLengthMinutes / 2) | Clamp to that value |

### 3.4 Rotations = 0 (edge case)

When `rotationsPerHalf = 0`, the planner creates only a single halftime rotation record. This is a valid plan — no warning needed.

### 3.5 Non-divisible intervals

When `halfLengthMinutes % intervalMinutes ≠ 0`, rotation slots are floored to the nearest whole minute. No additional UI warning is needed; the timeline pills in the Rotations tab already show exact minutes.

### 3.6 "Update Plan" behaviour

The existing "Update Plan" / "Create Game Plan" button continues to use `rotationIntervalMinutes` as the persisted value. No change to save logic or schema.

---

## 4. UI / UX

### 4.1 Layout

Replace the current `.interval-pill-group` block in the **planner setup card** with a two-column stepper row:

```
┌───────────────────────────────────────┐
│  Rotations / half      Every           │
│  [ − ]  [ 2 ]  [ + ]  [ − ]  [ 10 ]  [ + ] min │
└───────────────────────────────────────┘
```

- Steppers sit side-by-side with equal column width
- Label above each stepper (small, secondary text weight)
- `+` / `−` tap targets ≥ 44×44 px (sideline-first requirement)
- Stepper value uses `<input type="number">` for direct keyboard entry, `min` constrained by clamp rules
- Display-only derived value updates instantly on every keystroke (no debounce needed — calculation is O(1))

### 4.2 Design Tokens

| Element | Token |
|---------|-------|
| Stepper background | `--card-background` |
| Stepper border | `--border-color` |
| Stepper value text | `--text-primary` |
| `+` / `−` button bg | `--hover-background` |
| `+` / `−` button active | `--primary-green`, white icon |
| Label | `--text-secondary`, 12 px |

### 4.3 Keyboard / Accessibility

- `aria-label="Rotations per half"` on input A  
- `aria-label="Rotation interval in minutes"` on input B  
- `inputmode="numeric"` on both inputs  
- Tab order: rotations stepper (−, value, +) → interval stepper (−, value, +) → "Update Plan" button

---

## 5. Files Affected

| File | Change |
|------|--------|
| `src/components/GamePlanner.tsx` | Replace pill buttons with two steppers; add `handleRotationsChange` + `handleIntervalChange` |
| `src/App.css` | Remove `.interval-pill*` rules; add `.rotation-stepper-row`, `.rotation-stepper` |
| `src/components/GamePlanner.test.ts` | Coupling round-trip tests; edge-case clamp tests |
| `e2e/game-planner.spec.ts` | **Update required** — `createRotationPlan()` at line ~345 references `.interval-selector select` (already stale vs current pill UI); update selector to target the new interval stepper input (e.g. `[aria-label="Rotation interval in minutes"]`) |

**No schema changes. No new state variables** — `rotationIntervalMinutes` remains the single source of truth.

> **Note (arch):** There is no existing `+` / `−` stepper pattern in the codebase. Management.tsx uses plain browser-native `<input type="number">` spinners. The stepper `+`/`−` buttons described in §4 are new UI; no component to copy from. Implementer should build inline in `GamePlanner.tsx` (no need for a shared component given single use site).

---

## 6. Test Cases

| ID | Scenario | Expected |
|----|----------|---------|
| TC-RS-1 | 30-min half, type 2 rotations | Interval shows 10 |
| TC-RS-2 | 30-min half, type 10 interval | Rotations shows 2 |
| TC-RS-3 | 30-min half, type 7 interval | Rotations shows 3 (floor) |
| TC-RS-4 | 30-min half, type 0 rotations | Clamped to 0; interval shows 30 |
| TC-RS-5 | 30-min half, type 31 interval | Clamped to 30; rotations shows 0 |
| TC-RS-6 | 25-min half, type 3 rotations | Interval shows 6 (round(25/4)) |
| TC-RS-7 | Load existing plan with interval=5 | Rotations stepper shows 5 (for 30-min half) |
| TC-RS-8 | Load existing plan with interval=15 | Rotations stepper shows 1 (for 30-min half) |
| TC-RS-9 | 30-min half: type 2 rotations → see interval 10 → type 10 back | Rotations shows 2 (no drift — divisible) |
| TC-RS-9b | 30-min half: type 3 rotations → derived interval 8 → type 8 back | Rotations shows 2 (one-step drift on non-divisible values — acceptable per §3.5) |

---

## 7. Out of Scope

- Per-half different rotation counts (e.g. 2 in H1, 3 in H2)
- Non-uniform rotation minutes (custom per-slot scheduling)
- Fractional or second-level intervals
- Storing `rotationsPerHalf` as a separate schema field
