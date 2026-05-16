# Game Shape View Phone Sizing + Jersey Marker Plan

## Scope
- Increase shape pitch footprint on small phone viewports (baseline 375x812).
- Replace assigned node card visual with a jersey-style marker while preserving existing tap interaction and core accessibility semantics.
- Keep changes localized to game shape view; avoid Formation Visual Editor changes unless unavoidable.

## Baseline and Constraints
- Baseline viewport: 375x812.
- Must keep tap targets >= 44x44.
- Maintain current non-overlap behavior for assigned nodes as much as possible.
- Preserve existing button semantics, keyboard access, and dialog flow.
- No third visual text row in assigned nodes on narrow screens.

## Proposed UI Strategy

### 1) Phone pitch sizing (375x812 baseline)
- Introduce phone-specific pitch sizing variables in shape view styles with explicit precedence:
  - Base rule (all viewports): `--shape-pitch-max-height: 58vh`.
  - `@media (max-width: 480px)`: `--shape-pitch-max-height: 68vh`.
  - `@media (max-height: 700px)`: `--shape-pitch-max-height: 54vh`.
  - CSS declaration order in `App.css` must be: base, `max-width: 480px`, then `max-height: 700px` so short-height override wins when both match.
- Effective token values by target viewport:
  - 375x812 baseline: width rule applies, short-height rule does not; effective max height = `68vh`.
  - 812x375 short-height landscape: short-height rule applies; effective max height = `54vh`.
- Keep width bounded by aspect ratio math (`2/3`) and container width to prevent horizontal overflow.
- Keep assigned-node fit-width formula as overlap guardrail; explicit width cap remains formula-bound.

### 2) Jersey marker node style
- Keep the existing tappable `button` as the interaction root.
- For assigned nodes, keep a fixed-height two-tier marker:
  - Upper jersey tier: short position abbreviation centered (e.g., GK, CB).
  - Lower label tier: player text as `FirstName + LastInitial` (e.g., Ava K).
- Do not render out-of-position status in this view; no separate third visual row is allowed on narrow screens.
- Keep empty nodes visually distinct and clearly actionable; do not remove empty-state affordance.
- Maintain selected and focus-visible states with clear contrast and ring visibility.

### 3) Non-overlap invariants
- Lock assigned marker sizing with explicit invariants:
  - Fixed max node height and fixed line-height per tier (no auto growth).
  - Player label line is single-line with ellipsis.
  - Position line is single-line.
  - Assigned node width keeps explicit cap via existing fit-width formula (`assigned-node-fit-width`) and does not exceed it.

### 4) Name-format normalization matrix (`FirstName + LastInitial`)
- Normalize input before formatting:
  - Trim leading/trailing whitespace for first/last names.
  - Collapse internal runs of whitespace to a single space.
- Deterministic output matrix:

| First Name | Last Name | Output |
|---|---|---|
| present | present | `FirstName + LastInitial` |
| present | missing/blank | `FirstName` |
| missing/blank | present | `LastInitial` if extractable, else fallback label |
| missing/blank | missing/blank | fallback label |

- Last-initial extraction rules:
  - Use first alphabetical Unicode letter in normalized last name as initial.
  - If no alphabetical letter exists (punctuation/symbol-only), fall back to first alphanumeric character.
  - If still unavailable, use default fallback label.
- Default fallback label: `Unknown player`.
- Apply truncation safeguards:
  - CSS single-line ellipsis on player tier.
  - Keep full context in `title` and existing button `aria-label`.

### 5) Accessibility and semantics
- Keep `button` controls and retain node labels without out-of-position status in this view.
- Ensure decorative jersey shape layers are `aria-hidden`.
- Preserve current keyboard tab order, `:focus-visible` outline, and disabled behavior.
- Verify touch target minimum remains >= 44px in both dimensions after visual redesign.

## File-by-File Change List
- [src/components/GameManagement/shape/LineupShapeView.tsx](src/components/GameManagement/shape/LineupShapeView.tsx)
  - Add helper for short marker label (`FirstName + LastInitial`).
  - Update assigned-node markup structure to support jersey body + player label line.
  - Preserve title behavior and quick-replace/substitute interaction logic while removing out-of-position status from shape-node labeling.
- [src/App.css](src/App.css)
  - Update `.lineup-shape-view` small-screen pitch sizing variables for larger phone footprint.
  - Add jersey marker styles under `.lineup-shape-node__tap-target` and new child classes.
  - Keep current overlap guard variables (`safe-inset`, `assigned-node-fit-width`, `gutter`) and adjust minimally if needed for phone stability.
  - Preserve/verify selected, empty, disabled, and focus-visible variants.
- [src/components/GameManagement/shape/LineupShapeView.test.tsx](src/components/GameManagement/shape/LineupShapeView.test.tsx)
  - Update text expectations from `#number + first name` to new short-name format.
  - Add/adjust test coverage for long-name fallback/title behavior.
  - Keep semantics checks (aria labels, role/button usage).
- [e2e/game-management-shape-view.spec.ts](e2e/game-management-shape-view.spec.ts)
  - Extend narrow-viewport checks with deterministic larger-pitch metric using ratio band (not exact pixels):
    - For 375x812, assert `pitchHeight / viewportHeight` is within stable tolerance band `0.58` to `0.66`.
  - Keep/confirm 44x44 target assertion and non-overlap assigned-node assertion.

## Data Model / API Impact
- No backend, schema, or API changes expected.
- Purely presentational and label-formatting changes in client UI.

## Dependencies and Sequencing
1. Update CSS variable strategy for phone pitch footprint and jersey marker styles.
2. Update `LineupShapeView.tsx` markup and label formatter to match new style tokens.
3. Update unit tests for label and structure expectations.
4. Update/extend E2E assertions for pitch occupancy and target sizing.
5. Run focused tests, then full commit gate (`npm run gate:commit`).

## Risks and Edge Cases
- Increased pitch height may reduce space for bench strip on short-height devices; keep max-height media query fallback.
- Jersey marker silhouette could reduce text legibility; require contrast checks and truncation behavior with fixed tier heights.
- Long first names with long last initials still risk clipping at narrow widths; title tooltip fallback must remain.
- Dense formations at narrow widths may regress overlap if marker width grows; preserve existing fit-width cap and verify via E2E overlap test.
- Punctuation-only surnames can break naive initial extraction; formatter must follow normalization matrix fallback path.

## Test Strategy
- Unit (Vitest):
  - `LineupShapeView.test.tsx` for name normalization matrix and deterministic fallback behavior.
  - Add assertions that no out-of-position indicator renders in shape view.
  - Existing semantics tests should still pass for roles, simplified node labeling, and unavailable/disabled behavior.
- E2E (Playwright):
  - Existing 375x812 scenario remains baseline.
  - Add ratio-band assertion for pitch vertical footprint (`pitchHeight / viewportHeight` in `0.58..0.66`) without brittle pixel locking.
  - Keep current no-horizontal-overflow, 44x44 minimum tap-target, and visible assigned-node non-overlap assertions.
- Validation command:
  - `npm run gate:commit` as final fail-fast gate.
