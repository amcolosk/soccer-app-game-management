# Game Management Shape Field Parity Plan

## Goal

Update the game management shape view so its field proportions and markings visually match the formation visual editor's more realistic soccer field, without changing lineup interactions, substitution flows, export behavior, or bench strip behavior.

## Recommendation

Use a small shared presentational extraction for the pitch shell and markings, not a CSS-only reshaping and not a broad shared interaction abstraction.

Why:

- CSS-only changes would improve color and proportions in the game view, but they would leave two separate JSX pitch-marking implementations in the codebase and keep the current third visual language drift risk.
- A broad shared field abstraction would be too large for this change because the editor and game view have different node content, input models, and accessibility semantics.
- A small shared presentational component can unify the soccer field geometry, aspect ratio, and markings while letting each parent keep its own nodes, interactions, and state.
- The shared component must stay strictly presentational-only (no node rendering, no interaction state, no behavior branching by caller type).

## Proposed Shape

Add a shared soccer pitch shell component that:

- Owns the pitch container, aspect ratio, background, border, and field markings
- Accepts `children` so each caller renders its own nodes inside the same field geometry
- Uses children + className + role/aria-label + CSS custom properties for geometry and visual tokens (no coarse variant API)
- Forwards a ref to the actual pitch container element so the formation editor can continue measuring the same drag surface DOM node
- Keeps all decorative markings `aria-hidden="true"`, `pointer-events: none`, and non-focusable

Keep node rendering local:

- Formation editor continues to render draggable circular abbreviation nodes
- Game management shape view continues to render card-like tap targets with player info and current interaction adapter

## Explicit Sizing Decision

Use one shared pitch geometry contract but keep caller-specific sizing strategies:

- Formation editor keeps its existing modal-constrained sizing behavior (`2 / 3` aspect ratio, width derived from available modal height) because drag math and pointer behavior are already tuned to that surface.
- Game management shape view adopts the same `2 / 3` pitch geometry token for visual parity, with explicit precedence: width-led `2:3` field geometry is the baseline; min/max height clamps plus viewport cap are guardrails only; no horizontal overflow is a hard requirement.
- The game view keeps node-card sizing tokens local and introduces a pitch safe-inset token so dense assigned cards do not clip touchline/penalty markings on narrow devices.

Sizing precedence acceptance criteria:

- Width-led `2:3` geometry determines final field size first for game shape view parity.
- Height clamp and viewport cap tokens may constrain excessive vertical growth, but must not redefine geometry semantics.
- Horizontal overflow is forbidden for the pitch region and node container across supported breakpoints.

## File-by-File Plan

### 1. [src/components/shared/SoccerPitchSurface.tsx](src/components/shared/SoccerPitchSurface.tsx)

Add one new shared presentational component for the soccer pitch shell.

Responsibilities:

- Render the field wrapper and markings once
- Forward the container ref with `React.forwardRef<HTMLDivElement, ...>` to the root pitch element
- Preserve accessibility labels by allowing callers to pass `role`, `aria-label`, and class names
- Apply only presentational responsibilities (no interaction behavior, no knowledge of editor vs game state)
- Keep decorative markings strictly decorative (`aria-hidden="true"`, non-focusable, `pointer-events: none`)
- Do not own gesture policy or `touch-action`; callers remain responsible for interaction policy

Likely API:

- `children`
- `className`
- `role`
- `aria-label`
- `style` (for caller-supplied CSS custom properties)

CSS custom property contract (initial):

- `--soccer-pitch-aspect-ratio`
- `--soccer-pitch-border-radius`
- `--soccer-pitch-safe-inset`
- `--soccer-pitch-line-color`
- `--soccer-pitch-border-color`
- `--soccer-pitch-penalty-width`
- `--soccer-pitch-penalty-height`
- `--soccer-pitch-center-circle-width`

### 2. [src/components/shared/SoccerPitchSurface.css](src/components/shared/SoccerPitchSurface.css)

Add narrowly scoped shared styling for the new surface component.

Styling constraints:

- Namespace all selectors under a single component prefix (for example, `.soccer-pitch-surface*`)
- Do not add broad global pitch selectors or generic element selectors
- Keep decorative marking layers non-interactive and `aria-hidden`
- Expose geometry through CSS custom properties only; do not encode caller variants in global CSS
- Use token-based shared pitch colors/borders via scoped CSS variables; do not introduce new hardcoded field colors unless documented as an explicit exception in this plan/spec update

### 3. [src/components/FormationVisualEditor.tsx](src/components/FormationVisualEditor.tsx#L463)

Replace the inline pitch wrapper and duplicated markings with the shared pitch shell.

Planned changes:

- Keep the modal layout, sizing math, drag handlers, keyboard movement, and save/reset/cancel behavior intact
- Preserve the existing `2:3` field ratio, dark green pitch, and centered markings that already match the desired look
- Pass the existing drag-measured ref (`canvasRef`) directly to the shared pitch container so drag calculations keep using the same measured DOM node
- Keep circular draggable nodes rendered by the editor itself
- Move any remaining editor-only pitch style details into CSS variables passed to the shared surface

### 4. [src/components/GameManagement/shape/LineupShapeView.tsx](src/components/GameManagement/shape/LineupShapeView.tsx#L399)

Swap the current pitch wrapper markup for the shared pitch shell while preserving all existing shape-view interactions.

Planned changes:

- Keep `buildLineupShapeNodes(positions)` as the source of node coordinates
- Keep all current node buttons, dialog flows, export action, halftime helper, and bench strip logic untouched except for the pitch container structure they render inside
- Use the shared pitch geometry and markings so the game shape view visually matches the editor
- Keep role/image semantics caller-owned by passing `role="img"` and `aria-label="Soccer lineup shape"` into the shared surface
- Apply game-view sizing through local CSS custom properties (no variant prop), including safe inset and viewport height cap tokens
- Keep width-led `2:3` geometry as primary sizing baseline and enforce no horizontal overflow in layout/CSS contract
- Keep interactive children caller-rendered; the shared surface only renders decorative markings
- Preserve state affordances/readability for empty, assigned, selected, and unavailable node states after extraction

### 5. [src/App.css](src/App.css#L1837)

Refactor the current lineup shape pitch styling to consume the shared visual language.

Planned changes:

- Remove duplicated game-view-only pitch marking structure/styles that move into the shared surface stylesheet
- Keep lineup shape node sizing and state styles local to lineup selectors
- Define lineup shape sizing tokens at the view scope and pass them via CSS variables to the shared surface
- Keep game layout behavior fit-to-container with explicit viewport cap token, while preserving editor parity geometry tokens
- Preserve the current mobile breakpoints and 44x44 minimum hit target behavior for node buttons
- Add explicit `:focus-visible` styling for node tap targets with sufficient contrast on dark field backgrounds
- Keep unavailable/disabled/selected/assigned/empty state readability and visual differentiation unchanged or improved

### 6. [src/components/GameManagement/shape/LineupShapeView.test.tsx](src/components/GameManagement/shape/LineupShapeView.test.tsx#L1)

Update tests to cover the shared pitch shell integration without weakening interaction coverage.

Planned assertions:

- Shape view still renders the accessible pitch region/image label
- Node buttons still invoke quick replace for `scheduled` and `halftime` assigned slots
- Node buttons still invoke substitution for `in-progress`
- Export and bench strip behavior remain unchanged
- Dense-card safety: add a targeted assertion/fixture that assigned-card wrappers remain within pitch bounds contract classes/tokens at narrow test widths
- If the shared pitch shell exposes a stable testable marker, add one lightweight assertion that the shared field rendering is present
- Accessibility: verify field region role/name remains stable after extraction and decorative layers are not focusable/interactive
- Accessibility: verify node controls show visible `:focus-visible` class/state hook (or equivalent deterministic style contract)

### 7. [src/components/FormationVisualEditor.test.tsx](src/components/FormationVisualEditor.test.tsx#L1)

Update tests only as needed for the extracted pitch shell.

Planned assertions:

- Editor still renders a `2:3` field with the expected node coordinates
- Drag/keyboard/nudge/save conflict behaviors remain unchanged
- Drag-surface integrity: assert drag operations still compute against the same pitch container (ref-forwarded root) by validating unchanged pointer-to-coordinate movement behavior
- If the pitch shell introduces a stable accessible or class-level contract, add one focused assertion for it rather than snapshotting the whole modal DOM

### 8. [e2e/game-management-shape-view.spec.ts](e2e/game-management-shape-view.spec.ts#L1)

Extend targeted Playwright validation for mobile sizing and clipping risk.

Planned assertions:

- Portrait phone validation (375x812): shape pitch remains visible and usable, with no horizontal overflow and no control occlusion regressions
- Short-height landscape validation (812x375): width-led geometry persists while height guardrails apply without clipping core interactions
- Dense-card scenario: with long assigned player names near touchlines, tap targets remain at least 44x44 and do not render outside safe pitch bounds

### 9. Optional spec/doc touch

If implementation materially changes the lineup shape field contract, update:

- [docs/specs/Lineup-Shape-View.md](docs/specs/Lineup-Shape-View.md#L1)

Most likely update:

- Clarify that game shape view uses shared field-geometry tokens with a viewport-capped fit-to-container behavior.

## Data Model / API Impact

None.

- No schema changes
- No GraphQL changes
- No mutation/query contract changes
- No changes to `buildLineupShapeNodes` determinism contract

## Dependencies and Sequencing

1. Extract shared pitch shell and shared styling contract
2. Migrate `FormationVisualEditor` to the shared shell first, because it is the source visual reference
3. Migrate `LineupShapeView` to the same shell
4. Apply game-view-specific sizing/inset tokens and viewport cap behavior
5. Update unit tests for editor drag-surface integrity and game-view parity
6. Update mobile-focused Playwright checks for height/overflow/clipping risk
7. Run targeted UI and interaction validation, then commit gate

## Risks

- The game shape view currently uses larger card nodes than the editor. A direct visual clone can reduce readable space or cause overlap near the touchline on narrow phones.
- Moving from height-driven to aspect-ratio-driven layout can change the amount of vertical space consumed in the Lineup tab and may interact with sticky UI above it.
- Shared pitch markup must not break editor drag behavior or game-view tap behavior by intercepting pointer events.
- Ref forwarding mistakes can silently shift editor drag math if the measured element changes.
- Broad CSS selectors can create regressions outside game management/editor surfaces.
- Adopting shared `2 / 3` geometry in game view can increase vertical footprint and surface clipping risk in dense-card states.
- If shared shell introduces `touch-action` defaults, caller gestures could regress in one surface while appearing correct in another.
- Hardcoded color values introduced during extraction can drift from design tokens and create low-contrast focus/readability failures on dark grass backgrounds.

## Edge Cases

- Very small mobile widths where assigned player cards are at their maximum density
- Formations with many central positions that already sit close together in deterministic layout
- Empty slots versus assigned slots, where card width changes significantly
- Halftime and scheduled states, where quick replace depends on the same node hit area and focus behavior
- Completed/unsupported states, where disabled nodes still need correct visual affordance and accessible titles
- Narrow viewports with many assigned cards and long player names near touchlines/penalty edges
- Portrait and short-height landscape phone rotations where height guardrails engage
- Focus traversal across dense nodes where decorative layers must remain unfocusable and non-interactive

## Test Strategy

Unit / component:

- Update `LineupShapeView` tests to prove interaction parity and preserve accessible labels
- Update `FormationVisualEditor` tests to prove the shared shell did not alter positioning and editor behaviors
- Add drag-surface integrity assertions proving pointer drag behavior still references the ref-forwarded pitch root
- Add accessibility assertions for stable pitch role/name, decorative-layer non-interactivity, and visible focus treatment contract for node controls

Targeted browser / E2E:

- Run the game-management shape-view Playwright coverage for portrait (375x812), short-height landscape (812x375), and dense long-name assigned-card scenarios near touchlines
- Smoke-check the formation visual editor manually or with existing tests because its drag surface and pointer capture are sensitive to container changes

Validation emphasis:

- No change in lineup mutation behavior
- No change in export payload behavior
- No regression in node tap targets, focus return, or dialog accessibility
- Decorative field layers remain non-interactive (`aria-hidden`, no pointer interception)
- Shared shell remains presentational-only and does not set gesture policy / `touch-action`
- Token-based pitch colors/borders are used via scoped CSS variables, with any hardcoded exception documented
