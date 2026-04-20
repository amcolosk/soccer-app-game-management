# Post-Game In-Game Notes and Gold Star Actions - Stage 1 Revision (Architecture Feedback Incorporated)

## Scope Lock

Implement post-game edit and delete actions for in-game notes with server-authoritative permissions, while keeping swipe interactions additive and accessible. This revision removes all prior ambiguity and is the planning baseline for coding.

## Authoritative Requirements (Locked)

1. In-game notes and gold stars support text-only edits.
2. Any team coach can edit.
3. Only the original author can delete.
4. Yellow and red card notes are editable but not deletable.
5. UI shows edited indicator with attribution and time.
6. Swipe actions on mobile are additive and must remain discoverable and accessible via non-swipe controls.
7. No 24-hour rule and no completedAt dependency.

## Mandatory Architecture Decisions (Final)

### 1) Edit audit source-of-truth

Decision: use GameNote.editedAt and GameNote.editedById only. Do not add hasBeenEdited.

Justification:
- hasBeenEdited is redundant because edited state is derived as editedAt != null.
- Single source-of-truth avoids dual-write drift.
- Supports attribution and timestamp directly from persisted record.

### 2) Shared policy module boundary

Decision: add a pure TypeScript policy module at shared/policies/gameNoteActionPolicy.ts.

Boundary and import constraints:
- Module contains only serializable domain types and pure predicate/decision helpers.
- No imports from aws-sdk, aws-lambda, React, browser globals, process.env, toast, or UI components.
- Lambda handlers and frontend components may both import this module.
- Any environment-specific lookups (DynamoDB reads, profile lookups, localization) stay outside this module in adapters/callers.

Primary exports:
- canEditGameNote(ctx)
- canDeleteGameNote(ctx)
- getGameNoteActionDecision(ctx) returning normalized capability object and reason code.

### 3) Schema/auth enforcement in amplify/data/resource.ts

Decision: make direct client GameNote delete impossible by removing model delete permission from GameNote auth and enforcing delete via custom mutation only.

Concrete schema decision:
- GameNote model auth becomes ownersDefinedIn(coaches).to([read]) only.
- Add custom mutation deleteSecureGameNote(id: string) with allow.authenticated() and Lambda handler.
- Keep createSecureGameNote and updateSecureGameNote as the only write paths for note create/update.

### 4) Offline queue backward compatibility

Decision: keep queued item shape stable (model: GameNote, operation: delete, payload object), and introduce deterministic translation for legacy delete payload variants at replay time.

Deterministic translation algorithm:
- If payload.id is a non-empty string, use it.
- Else if payload.gameNoteId is a non-empty string, translate to id.
- Else fail with canonical validation code for malformed payload.

No IndexedDB schema version bump is required; compatibility is handled in replay logic.

### 5) Server authorization algorithm and canonical error codes

Decision: all authorization resolves server-side via note -> game -> team coaches, never by trusting note.coaches.

Algorithm (delete and update validation path):
1. Authenticate caller sub.
2. Load note by id from GameNote table.
3. Load game by note.gameId from Game table.
4. Load team by game.teamId from Team table.
5. Authorize caller membership against team.coaches.
6. Apply note-type rule checks and author-only delete check.
7. Execute update/delete.

Canonical error codes (thrown as stable strings for UI mapping):
- AUTH_UNAUTHENTICATED
- NOT_FOUND_GAME_NOTE
- NOT_FOUND_GAME
- NOT_FOUND_TEAM
- AUTH_COACH_REQUIRED
- AUTH_DELETE_AUTHOR_REQUIRED
- RULE_DELETE_DISALLOWED_NOTE_TYPE
- VALIDATION_NOTES_ONLY_EDIT
- VALIDATION_NOTES_TOO_LONG
- VALIDATION_INVALID_DELETE_PAYLOAD

### 6) Reusable UI action contract for notes and goals

Decision: define one action contract and one renderer path used by both PlayerNotesPanel and GoalTracker to prevent UX drift.

Contract location:
- src/components/GameManagement/actions/actionContract.ts
- src/components/GameManagement/actions/GameActionRow.tsx

Contract scope:
- Declarative action descriptors: id, label, kind, availability, disabledReason, confirm requirement, callback.
- Shared ordering and semantics for Edit/Delete action slots.
- Shared accessibility behavior for keyboard focus, aria labels, and fallback action visibility.

### 7) Safe-delete/admin regression verification

Decision: include explicit regression verification to prove this change does not weaken existing safe-delete/admin guardrails.

Required verification tasks:
- Update amplify/data/resource.safe-delete-policy.test.ts to assert GameNote model delete is not granted and deleteSecureGameNote is declared.
- Add/adjust automated test coverage that existing deleteGameSafe/deleteTeamSafe/deletePlayerSafe/deleteFormationSafe flows still pass unchanged.
- Add a targeted e2e safe-delete smoke rerun task in validation sequence.

## Permission Matrix (Server Authoritative)

| Note type | Edit | Delete |
|---|---|---|
| gold-star | any team coach | original author only |
| other | any team coach | original author only |
| yellow-card | any team coach | never |
| red-card | any team coach | never |

Additional rule lock:
- Text-only edits means only notes is mutable for this post-game flow.
- noteType, playerId, gameSeconds, half, authorId are immutable in this flow.

## Stage 3 UI Findings Incorporated (Explicit Requirements)

### 1) Destructive confirmation modal behavior/content for delete actions

Modal requirements (notes and goals via shared action row contract):
- Trigger conditions:
	- Required before every delete action, including swipe-originated delete intent.
	- Never bypassed by keyboard shortcut or direct callback path.
- Content contract:
	- Title: `Delete note?` for notes, `Delete goal?` for goals.
	- Body (notes deletable types): `This permanently removes this note from the game timeline.`
	- Body (goals): `This permanently removes this goal event from the game timeline.`
	- Body (author-only reminder when deletable): `Only the original author can confirm this delete.`
	- Primary CTA label: `Delete`.
	- Secondary CTA label: `Cancel`.
- Interaction behavior:
	- Initial focus lands on `Cancel` to reduce accidental destructive confirmation.
	- `Escape` activates cancel path.
	- Enter/Space on focused control triggers only that control.
	- On cancel, close modal and return focus to the exact invoking action control.
	- On confirm success, close modal and move focus to nearest stable container heading for the affected list.
	- On confirm failure, keep modal open, announce error via aria-live, and preserve focus on primary CTA.

### 2) Permission-state UX matrix by note type and actor

The backend remains authoritative. UI must reflect capabilities with disabled reasons and screen-reader text.

| Note type | Actor | Edit UI | Delete UI | Visible disabled reason | Required sr-only text |
|---|---|---|---|---|---|
| gold-star | author coach | enabled | enabled | n/a | `Edit note available. Delete note available.` |
| gold-star | non-author coach | enabled | disabled | `Only the author can delete this note.` | `Delete note unavailable: only the original author can delete this note.` |
| other | author coach | enabled | enabled | n/a | `Edit note available. Delete note available.` |
| other | non-author coach | enabled | disabled | `Only the author can delete this note.` | `Delete note unavailable: only the original author can delete this note.` |
| yellow-card | author coach | enabled | disabled | `Yellow card notes cannot be deleted.` | `Delete note unavailable: yellow card notes are non-deletable.` |
| yellow-card | non-author coach | enabled | disabled | `Yellow card notes cannot be deleted.` | `Delete note unavailable: yellow card notes are non-deletable.` |
| red-card | author coach | enabled | disabled | `Red card notes cannot be deleted.` | `Delete note unavailable: red card notes are non-deletable.` |
| red-card | non-author coach | enabled | disabled | `Red card notes cannot be deleted.` | `Delete note unavailable: red card notes are non-deletable.` |

UI policy lock mirrored from functional lock:
- Any team coach can edit text.
- Author-only delete.
- Yellow/red non-deletable.
- No time-window-based disable reason is allowed.

### 3) Responsive parity requirements (phone/tablet/desktop)

Action parity requirements for notes and goals:
- Phone (<768px):
	- Swipe reveal remains additive only; explicit action controls are still present.
	- Action controls align to trailing edge of card row and remain reachable without horizontal overflow.
	- Interactive controls retain minimum visual size and touch target parity with goal action controls.
- Tablet (>=768px):
	- Action placement remains trailing-aligned and visually consistent across notes and goals.
	- Do not introduce a note-specific overflow menu if goals remain inline actions (or vice versa).
	- Spacing, icon size, and button height must match between note and goal action rows.
- Desktop (>=1024px):
	- Same action order and labels as tablet/phone.
	- Hover affordance may be added, but keyboard and touch-equivalent affordance remains visible.
- Cross-breakpoint consistency:
	- Action order is always `Edit` then `Delete`.
	- Disabled-state appearance and helper text treatment are identical between notes and goals where policy semantics match.

### 4) Accessibility contract

Required accessibility acceptance criteria:
- Target sizing:
	- All tappable action controls, including icon-only affordances, expose at least 44x44 px hit area.
- Keyboard order:
	- Per note/goal row tab sequence: row metadata -> edit action -> delete action -> next row.
	- No hidden swipe-only action can receive focus when not visibly presented.
- Focus return rules:
	- Cancel destructive modal -> return focus to invoker control.
	- Confirm delete success -> focus nearest stable section heading/container anchor.
	- Edit save success -> return focus to edited row action group.
	- Any save/delete failure -> keep focus in current interaction surface and expose error via aria-live.
- Live region announcements:
	- Save success: announce `Note updated`.
	- Delete success: announce `Note deleted`.
	- Save failure: announce mapped canonical error.
	- Delete failure: announce mapped canonical error.
	- Edited indicator render/update: announce `Note edited by {displayName} at {time}` once after save success.

### 5) Edited indicator rendering specification

Rendered text pattern:
- `Edited by {displayName} at {time}`

Attribution fallback behavior:
- Preferred attribution: coach display name from profile mapping.
- Fallback 1: `You` when editedById matches current user.
- Fallback 2: `Coach` when no display name is resolvable.

Time format behavior:
- Use local device timezone.
- Same-day edits: short time format (for example, `3:42 PM`).
- Prior-day edits: abbreviated date + time (for example, `Apr 18, 3:42 PM`).
- Invalid/missing editedAt when editedById exists: show `Edited` without time and log non-blocking telemetry.

Placement and visual behavior:
- Place directly beneath note body metadata area, before action controls.
- Style as secondary meta text and keep line wrapping stable across breakpoints.
- Must render identically in notes and any goal timeline location that reuses edited-state metadata.

## File-by-File Change Plan (Concrete)

### Backend and schema

1. amplify/data/resource.ts
- Add GameNote.editedAt and GameNote.editedById fields.
- Change GameNote model authorization to read-only model access for coaches.
- Add deleteSecureGameNote mutation definition wired to new Lambda function.

2. amplify/functions/delete-game-note/resource.ts (new)
- Define delete-game-note Lambda resource for custom mutation handler.

3. amplify/functions/delete-game-note/handler.ts (new)
- Implement note -> game -> team authorization algorithm.
- Enforce type/author delete policy and canonical error codes.

4. amplify/functions/delete-game-note/handler.test.ts (new)
- Cover all permission matrix delete paths and canonical error code outputs.

5. amplify/functions/update-game-note/handler.ts
- Enforce notes-only update payload.
- Resolve coach authorization via note -> game -> team.
- Set editedAt and editedById only when notes actually changes.
- Return canonical error codes for policy/validation failures.

6. amplify/functions/update-game-note/handler.test.ts
- Add notes-only mutation tests, edit attribution tests, team-coach authorization tests, and canonical error code assertions.

7. amplify/functions/create-game-note/handler.ts
- Initialize editedAt and editedById as null on create response and persistence payload.

8. amplify/functions/create-game-note/handler.test.ts
- Verify initialized edit audit fields and unchanged create authorization semantics.

9. amplify/backend.ts
- Register deleteGameNote function.
- Grant read/write on GameNote table, read on Game and Team tables.
- Add GAME_NOTE_TABLE, GAME_TABLE, TEAM_TABLE env vars for delete/update handlers where needed.

10. amplify/data/resource.safe-delete-policy.test.ts
- Extend blocked-delete assertions to include GameNote.
- Assert presence of deleteSecureGameNote mutation.

11. shared/policies/gameNoteActionPolicy.ts (new)
- Implement pure reusable predicates and reason-code outputs.

12. shared/policies/gameNoteActionPolicy.test.ts (new)
- Unit tests for all note-type and author/coach combinations.

### Frontend mutation and offline replay

13. src/hooks/useOfflineMutations.ts
- Add executeSecureDeleteGameNote helper calling client.mutations.deleteSecureGameNote.
- Route online deleteGameNote through secure mutation.
- Route queued GameNote delete replay through secure mutation.
- Add deterministic legacy delete payload translator.
- Map canonical backend codes to user-facing errors without losing code semantics.

14. src/hooks/useOfflineMutations.test.ts
- Replace model-delete expectations with deleteSecureGameNote expectations.
- Add replay tests for both payload.id and payload.gameNoteId legacy forms.
- Add malformed legacy payload failure test.

15. src/components/GameManagement/types.ts
- Include editedAt and editedById in GameNote typing surface used by UI.

### UI action contract and components

16. src/components/GameManagement/actions/actionContract.ts (new)
- Define reusable action descriptor interfaces and factories.
- Include destructive modal descriptor fields (title/body/cta labels) and accessibility metadata hooks.

17. src/components/GameManagement/actions/GameActionRow.tsx (new)
- Shared renderer with button/menu fallback and accessibility behavior.
- Enforce fixed action order (Edit, Delete), 44x44 targets, disabled reason rendering, and sr-only status text hooks.

18. src/components/GameManagement/PlayerNotesPanel.tsx
- Use shared contract/renderer for note actions.
- Add text-only edit flow for in-game notes.
- Render edited indicator with attribution/time.
- Keep swipe reveal additive (action row always available by button/menu).
- Wire destructive confirmation modal content contract and focus return rules.
- Implement note permission UX matrix states and disabled reason text per note type/actor.
- Ensure cross-breakpoint action placement/sizing parity with GoalTracker.

19. src/components/GameManagement/GoalTracker.tsx
- Switch goal card actions to shared contract/renderer while preserving goal authorization semantics.
- Match note action placement, sizing, disabled-state styling, and modal interaction semantics for parity.

20. src/hooks/useSwipeDelete.ts
- Generalize hook naming/shape from delete-specific semantics to generic trailing actions while preserving directional lock behavior.

21. src/components/GameManagement/PlayerNotesPanel.test.tsx
- Add permission matrix UI gating tests and edited-indicator rendering tests.
- Add swipe plus non-swipe discoverability/accessibility tests.
- Add destructive modal content/focus-return assertions and aria-live success/error announcement assertions.

22. src/components/GameManagement/GoalTracker.test.tsx
- Add action-contract parity tests to prevent drift.
- Add responsive action placement and sizing parity assertions versus notes.

23. src/components/GameManagement/GameManagement.test.tsx
- Add integration assertions for edit/delete note pathways and surfaced backend policy errors.
- Add keyboard order and post-action focus return integration checks.

### End-to-end and docs

24. e2e/game-management-direct-note.mobile.spec.ts
- Add completed-state mobile swipe action coverage with fallback button discoverability assertion.

25. e2e/full-workflow.spec.ts
- Add coach-edit and author-delete rule scenarios, including yellow/red non-delete behavior.

26. e2e/safe-deletes.spec.ts
- Add/adjust explicit regression step confirming existing safe-delete admin flows still work.

27. docs/specs/Game-Management-Spec.md
- Document final note action rules, attribution indicator, and canonical error mapping expectations.

28. docs/specs/UI-SPEC.md
- Document additive swipe interaction and non-swipe fallback requirements.
- Add post-game note and goal action section covering:
	- destructive modal title/body/CTA/focus behavior,
	- permission-state UX matrix with disabled reason copy and sr-only text,
	- responsive parity requirements for phone/tablet/desktop,
	- accessibility contract (44x44 targets, keyboard order, focus return, aria-live messaging),
	- edited indicator rendering text/time/placement/fallback attribution rules.

## Data Model and API Impacts

Data model changes:
- GameNote adds editedAt: datetime|null and editedById: string|null.
- No hasBeenEdited field is introduced.

API changes:
- Add mutation deleteSecureGameNote(id: string).
- updateSecureGameNote behavior narrows to notes-only updates in this flow.

Auth changes:
- Direct GameNote model delete removed from client authorization surface.

## Implementation Sequence (Enforced)

1. Lock schema and auth in amplify/data/resource.ts.
2. Add delete-game-note function resource, handler, backend wiring, and environment variables.
3. Introduce shared pure policy module and adopt it in update/delete note handlers.
4. Add/update backend tests for canonical error codes and policy matrix.
5. Switch frontend mutation paths and replay logic to secure delete with legacy payload translation.
6. Introduce shared UI action contract and renderer.
7. Apply action contract to PlayerNotesPanel and GoalTracker.
8. Add component/integration tests and mobile/e2e coverage.
9. Run explicit safe-delete/admin regression checks.
10. Update specs/documentation.

## Risks and Mitigations

1. Legacy offline queued deletes may have inconsistent payloads.
- Mitigation: deterministic translator with explicit validation error code.

2. Team membership changes between queue time and replay may cause expected authorization failures.
- Mitigation: preserve queue failure behavior, map canonical auth codes clearly in UI.

3. Swipe-only discoverability regressions on touch screens.
- Mitigation: enforce always-visible fallback action controls and add explicit tests.

4. Action UI drift between notes and goals over time.
- Mitigation: shared action contract + shared renderer + parity tests.

5. Accessibility regressions introduced by modal/focus lifecycle changes.
- Mitigation: explicit focus-return integration tests and aria-live announcement assertions.

6. Breakpoint-specific divergence between notes and goals action rows.
- Mitigation: responsive parity tests at phone/tablet/desktop widths in component and e2e coverage.

## Test Strategy

Unit:
- shared policy predicates and canonical reason codes.
- create/update/delete note handlers for authorization, immutable fields, and edit attribution.
- offline mutation secure delete path and legacy translator behavior.

Component/Integration:
- PlayerNotesPanel action visibility and edit/delete behavior.
- GoalTracker action contract parity.
- GameManagement integration for surfaced auth/validation outcomes.
- Modal behavior and focus return verification for destructive actions.
- Accessibility checks for keyboard order, target sizing, and aria-live announcements.
- Edited indicator text/time/placement/fallback attribution rendering coverage.

E2E:
- Completed game note policy matrix across coach roles.
- Mobile swipe reveal with fallback controls.
- Safe-delete/admin regression smoke.

Commit gate:
- npm run gate:commit

## Explicitly Excluded

- Any 24-hour lock behavior.
- Any completedAt-based logic.
- Archive lock feature.
