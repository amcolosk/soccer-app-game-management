# Lineup Shape View

## Scope

- Game states: `scheduled`, `in-progress`, `halftime`
- Fixed soccer orientation (forwards at top, goalkeeper at bottom)
- Fit-to-width field layout only
- Uses existing substitution/assignment flow (no new mutation contracts)
- Own lineup rendering only

## Determinism Contract

- Layout version: `soccer-shape-v1`
- Node placement comes from deterministic lane inference + stable sort by `sortOrder`, abbreviation, position name, then id
- Golden fixture for this contract lives at:
  - `src/components/GameManagement/shape/__fixtures__/lineup-shape-golden-v1.json`

## Interaction Parity

- Shared adapter drives list + shape interaction behavior:
  - Scheduled/Halftime empty nodes: tap enters existing assignment/substitution modal
  - In-progress assigned nodes: tap enters existing substitution modal

## View Mode Persistence

- Persisted key scope: `lineup-view-mode:<userId>:<gameId>`
- Default: `list`
- Reset behavior:
  - Explicit reset button in lineup header
  - Automatic reset + key removal when game exits supported states

## Bench Strip + Export

- Locked bench strip: non-draggable, label and sorting semantics visible in UI
- Sort order:
  - Lowest play time first
  - Positional-fit tie-break when a target position is selected
- Export:
  - Local file download only (`*.lineup-shape.json`)
  - Includes lineup nodes + bench strip snapshot
  - Metadata marks export as local-only and offline-first
