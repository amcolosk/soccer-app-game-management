# Voice Dictation Specification

Voice dictation enables coaches to capture in-game notes hands-free using the device's native browser speech recognition engine. Coaches tap once to start recording, tap once to stop (or let ten seconds of silence trigger an automatic stop), review and edit the appended transcript in the note textarea, and tap **Save** to persist through the existing secure mutation path. Manual typing always remains a first-class fallback.

The feature operates entirely within the live-note modal in `PlayerNotesPanel`. All three entry paths — the Notes tab, the in-progress CommandBand, and the halftime action row — share one canonical modal component, one `useSpeechToText` hook, and one save path through `useOfflineMutations`.

---

## Overview

Voice dictation adds browser-native speech capture to the in-game note modal. The modal uses a bottom-sheet layout on phone viewports that keeps recording controls visible when the software keyboard is open. The feature is designed for one-thumb operation on iPhone during live play.

**Entry points:** Notes tab player row actions, the in-progress CommandBand `Add note` trigger, and the halftime action-row `Add note` button. All three open the same modal through a shared controller owned by `GameManagement`.

**Non-goals:**
- Pre-game coaching notes
- Non-English language support (`lang` is always `"en-US"`)
- Background or always-on transcription
- Auto-save or transcript persistence to the backend
- Storage of confidence metadata in DynamoDB
- Legal or privacy policy updates related to voice capture

---

## Entry Points

Three entry paths open the shared live-note modal. The only behavioral difference between paths is the default note type on open.

| Entry Path | Active Game State | Trigger Location | Default Note Type | Common-Case Tap Target |
|------------|------------------|-----------------|-------------------|------------------------|
| Notes tab player action | `in-progress` | `PlayerNotesPanel` player row | Carries the tapped intent (Gold Star, Yellow Card, etc.) | ≤ 4 taps |
| CommandBand direct entry | `in-progress` | `CommandBand` right cell | `other` (display label: "Note") | ≤ 4 taps |
| Halftime action row | `halftime` | Halftime action-row `Add note` button | `other` (display label: "Note") | ≤ 4 taps |

The 4-tap common-case path for direct entry is: open modal → Start → Stop → Save.

For Notes tab gold-star and yellow-card flows: tap player row intent → modal opens with type preselected → Start → Stop → Save (≤ 4 taps).

### CommandBand Trigger Behavior

- At widths `≤ 430 px`, the trigger renders as icon-only with `aria-label="Add note"`.
- The trigger occupies the CommandBand right cell alongside the rotation badge. Both must remain present with hit targets `≥ 44 × 44 px`.
- **Collapse order at narrower widths** (non-collapsible elements never removed):
  1. Note text label hides first
  2. Rotation helper text hides next
  3. Note icon button, rotation icon, and rotation count remain visible at all widths
- Opening from CommandBand never triggers a tab change. Lineup and Bench tabs remain active while the modal is open.

### Halftime Surface of Truth

The halftime action-row `Add note` button is the authoritative direct-entry trigger for the `halftime` game state. CommandBand is not rendered during halftime. The halftime trigger uses the same modal open contract, accessibility contract, and accessible name (`"Add note"`) as the in-progress CommandBand trigger.

### Shared Controller

`GameManagement` owns one always-mounted shared note modal controller. Notes-tab actions and CommandBand/halftime actions dispatch through a source-discriminated `openNoteModal(intent)` API:

- `{ source: 'command-band', defaultType: 'other' }` — from CommandBand or halftime action row; `defaultType` must be `'other'`.
- `{ source: 'notes-tab' }` — from Notes tab; preserves existing Notes-tab defaults with no `defaultType` override.

Opening from any in-progress tab or halftime does not force a tab switch.

---

## Device Support and Capability Gating

The `useSpeechToText` hook evaluates three gates at runtime before activating voice capture. All three must pass simultaneously; any failure puts the modal into fallback-only mode without crashing or blocking the save path.

| Gate | Check | Failure Behavior |
|------|-------|-----------------|
| Secure context | `window.isSecureContext === true` | Fallback-only mode |
| API availability | `window.SpeechRecognition` or `window.webkitSpeechRecognition` exists | Fallback-only mode |
| User gesture | `recognition.start()` called inside a trusted click/tap event handler | No start attempt |

**Device support matrix:**

| Platform / Browser | API | Support Level |
|-------------------|-----|--------------|
| iPhone Safari | `webkitSpeechRecognition` | Primary target — full voice capture |
| iPhone Chrome | `webkitSpeechRecognition` or `SpeechRecognition` | Primary target — full voice capture |
| iOS constrained WebView or unsupported version | API absent or insecure context | Fallback-only — accepted |
| Desktop Safari / Chrome | API may be present | Full capture if gates pass; no viewport-specific optimization |
| Any other browser | — | Fallback-only — accepted |

### Fallback-Only Mode

When the device or browser fails any capability gate, the modal enters fallback-only mode:

- The active mic control (Start Dictation button) is hidden.
- An inline message is shown with `aria-live="assertive"` priority:
  > "Voice capture is not supported in this browser. Type your note manually, or use iPhone keyboard dictation (tap the microphone key on the keyboard)."
- Manual textarea entry, note-type selection, and Save remain fully available and unchanged.
- Fallback-only mode is not an error state; it is an explicitly supported end-to-end path.

---

## Speech Recognition FSM

The `useSpeechToText` hook manages an explicit finite-state machine with four states. There is no persistent `stopped` state in the hook implementation — all terminal events transition directly to `idle`.

### States

| State | Description |
|-------|-------------|
| `idle` | No active session; voice controls are available for a new dictation |
| `starting` | Microphone acquisition in progress; engine not yet streaming results |
| `listening` | Engine is active and streaming interim and final transcript results |
| `stopping` | Coach has tapped Stop; hook is awaiting engine `onend` confirmation |

### Allowed Transitions

| From | To | Trigger | Terminal Reason |
|------|----|---------|----------------|
| `idle` | `starting` | Mic button tap (trusted user gesture) | — |
| `starting` | `listening` | Engine `onstart` fires successfully | — |
| `starting` | `idle` | Engine `onerror` fires on start failure | `onerror` (`start-failed` or `not-allowed`) |
| `listening` | `stopping` | Coach taps Stop | — (reason recorded on `onend`) |
| `listening` | `idle` | Silence timeout after 10 seconds | `timeout` |
| `listening` | `idle` | Engine `onend` fires naturally | `onend` |
| `listening` | `idle` | Engine `onerror` fires | `onerror` |
| `listening` | `idle` | Modal close or cancel | `modal-close` |
| `listening` | `idle` | `visibilitychange` hidden or `pagehide` | `visibility-hide` |
| `stopping` | `idle` | Engine `onend` confirms end | `manual-stop` |

The six terminal stop reasons are: `manual-stop`, `timeout`, `onend`, `onerror`, `modal-close`, `visibility-hide`. All terminal transitions call `finalizeSession(reason)` and converge on the same cleanup path.

### Idempotent Finalisation

`finalizeSession(reason)` is the single cleanup entry point for all terminal events. It is guarded by two refs:

- `sessionTokenRef` — set to a unique value when a session starts; identifies the current session.
- `finalizedTokenRef` — records the session token of the most recently finalized session.

The first terminal event whose session token matches `sessionTokenRef` wins. Any subsequent terminal event for the same token is a no-op. This ensures that, for example, a coach tapping Stop followed immediately by engine `onend` does not produce duplicate state updates.

Cleanup on every terminal transition: clear the silence-detection timer, detach all engine event listeners, transition FSM to `idle`.

---

## Transcript Handling

### Normalisation Pipeline

Before any dictated segment is merged into nota textarea state, it passes through this pipeline in order:

1. Unicode normalise to NFKC
2. Replace all line breaks (`\n`, `\r`) and tab characters with a single space
3. Collapse runs of multiple spaces to one space
4. Trim leading and trailing whitespace

The pipeline applies to all results. Interim results are displayed in the textarea for live feedback only; only the final confirmed result is committed into `noteText` state.

### Append Behaviour

Dictated text is always appended to the end of existing note content. It never replaces existing content without explicit user action. When existing text is non-empty and does not end with a space, a single space is inserted before the appended segment.

Confidence metadata is UI-only and is never persisted to the backend.

### 500-Character Enforcement

The 500-character limit is enforced at three independent points:

| Enforcement point | Mechanism |
|------------------|-----------|
| Textarea input | `maxLength={500}` attribute on the `<textarea>` element |
| Dictation merge | Merged text is clamped to 500 characters before `setNoteText` is called |
| Save | Character count is re-validated before the mutation is dispatched; truncates if needed |

When a dictation segment is clipped at the merge step, a truncation warning appears near the character counter: "Note limit reached — transcript was trimmed." Save remains enabled.

The character counter `div` does not carry an `aria-live` attribute. A live region on the counter was removed to prevent duplicate announcements with the transcript status region.

---

## UI States

This section describes control labels, enabled/disabled rules, and helper copy for each FSM state, plus the brief finalization window and post-dictation advisory.

### `idle`

| Element | Behavior |
|---------|----------|
| Mic button | Enabled; displayed label "Tap to Dictate"; accessible name "Start English dictation" |
| Language hint | "English only" — visible near mic control |
| Note-type chips | Enabled |
| Textarea | Editable |
| Save | Enabled when form is valid (note type set; text non-empty or intent-only save allowed) |

### `starting`

Microphone acquisition is in progress. This state is typically brief (< 1 second on supported devices).

| Element | Behavior |
|---------|----------|
| Mic button | Disabled |
| Helper copy | "Starting microphone..." — inline, near mic control; announced via polite live region |
| Note-type chips | Disabled |
| Textarea | Editable |
| Save | Enabled |

### `listening`

The engine is active. Interim transcript updates appear in the textarea in real time.

| Element | Behavior |
|---------|----------|
| Mic button | Enabled; displayed label "Tap to Stop"; accessible name "Stop dictation" |
| Recording indicator | "Recording..." — visible with optional subtle pulse animation |
| Note-type chips | Disabled (type switching not allowed while recording) |
| Textarea | Editable; updated with interim transcript |
| Save | Enabled |

### `stopping`

The coach has tapped Stop. The hook is waiting for engine `onend` confirmation.

| Element | Behavior |
|---------|----------|
| Mic button (both start and stop variants) | Disabled |
| Helper copy | "Stopping microphone..." — inline, near mic control; announced via polite live region |
| Note-type chips | Disabled |
| Textarea | Editable |
| Save | Enabled |

### Finalization Lock Window

After `onend` fires and before the final transcript merge completes, Save is briefly disabled and helper copy reads "Finalizing transcript..." This window targets a maximum of 500 ms. Textarea remains editable throughout.

### End Cue

When dictation ends from any terminal reason, the end cue fires:

1. Helper copy reads "Dictation ended." — announced via polite live region.
2. `navigator.vibrate(120)` is called when available. This call is always guarded by a capability check (`typeof navigator.vibrate === 'function'`); it is never invoked in environments where it is not supported.

### Post-Dictation Low Confidence

If the average confidence across final segments is `< 0.70`, an advisory appears inline near the textarea:

> "Transcription may be inaccurate. Please review before saving."

Save remains enabled. Confidence is advisory-only and never blocks persistence. Confidence metadata is not stored in DynamoDB.

---

## Error Handling

### Error Codes

| Code | Trigger |
|------|---------|
| `not-allowed` | Microphone permission denied by user or browser policy |
| `network` | Network failure during speech service communication |
| `no-speech` | 10-second silence timeout fires with no speech detected |
| `aborted` | Engine aborted by runtime (tab switch, incoming call, system interruption) |
| `start-failed` | `recognition.start()` threw synchronously; engine could not initialise |
| `unknown` | Any other error code returned via recognition `onerror` |

All error codes are terminal — each halts the active session and transitions the hook to `idle`.

### Toast vs. Inline Routing

| Error code | Toast | Inline message |
|-----------|-------|----------------|
| `not-allowed` | "Microphone access denied." | "To use dictation, allow microphone access in browser settings. You can still type your note manually." |
| `network` | "Speech service unavailable." | "No speech detected. Try again or type your note manually." |
| `no-speech` | "No speech detected." | "No speech detected. Try again or type your note manually." |
| `aborted` | None | None (session ends silently; existing transcript is preserved) |
| `start-failed` | "Could not start dictation." | "Voice capture is not available right now. Type your note manually." |
| `unknown` | "Dictation error." | "An error occurred. Try again or type your note manually." |

**Rules:**
- Toast confirms the ephemeral event; inline message provides actionable recovery guidance that remains visible until an action is taken. Both may appear together for the same code.
- `aborted` is silent — no toast, no inline — because it is commonly triggered by system interruptions where a user-facing message adds noise rather than guidance.
- Inline error messages use `aria-live="assertive"` priority (see Accessibility Contract §).
- Inline messages do not auto-dismiss. They clear when the coach starts a new dictation session or closes the modal.
- Manual typing and Save remain available after all errors.

### Message Priority Order

When multiple messages compete for the same inline region, only the highest-priority message is shown:

1. Blocking / terminal errors (`not-allowed`, `start-failed`, unsupported fallback guidance)
2. Transient processing copy (`starting`, `stopping`, `finalizing`)
3. Low-confidence advisory
4. Informational hints (English-only notice, keyboard dictation tip)

A higher-priority message replaces a lower-priority one in the same region. Toasts are managed independently and follow their own dismissal lifecycle.

---

## Accessibility Contract

### Focus Behaviour

- **On open:** Initial focus is placed on the modal `<h2>` title (`tabIndex={-1}`), giving screen readers context for the modal before interactive controls are announced. Subsequent Tab steps reach note-type chips, dictation controls, textarea, Save, and Cancel in logical order.
- **On close:** Focus returns to the exact control that triggered the modal: the specific Notes tab player row action, the CommandBand `Add note` button, or the halftime action-row `Add note` button.
- **Focus trap:** Focus is trapped inside the modal while open. Pressing Escape closes the modal unless the finalization lock window is active.
- **Keyboard `Done`:** The virtual keyboard `Done` / `Return` key on iPhone must not close the modal or discard draft text.

### ARIA Live Regions

| Region | Priority | Content Announced |
|--------|----------|-------------------|
| Status region | `aria-live="polite"` | State transitions ("Recording started", "Recording stopped", "Dictation ended."), transient helper copy ("Starting microphone…", "Stopping microphone…", "Finalizing transcript…"), low-confidence advisory |
| Error region | `aria-live="assertive"` | Blocking and terminal error recovery guidance (`not-allowed`, `start-failed`, `network`, `unknown`, unsupported fallback message) |
| Character counter | No `aria-live` | Not announced via live region (avoids duplicate announcements with status region) |

Duplicate consecutive announcements in the same live region are suppressed. A message is not re-announced if the state has not changed since the last announcement.

### Stable Accessible Names

Mic button accessible names do not change during `starting` or `stopping` transient states. Busy semantics are communicated via the inline status copy in the polite live region, not through renaming the control.

| FSM State | Accessible Name | Button State |
|-----------|----------------|-------------|
| `idle` | "Start English dictation" | Enabled |
| `starting` | "Start English dictation" | Disabled |
| `listening` | "Stop dictation" | Enabled |
| `stopping` | "Stop dictation" | Disabled |

### Keyboard Operability

- All controls are reachable via Tab in logical order.
- Enter and Space activate the mic button, note-type chips, Save, and Cancel.
- Escape closes the modal (blocked only during the finalization lock window).

### CommandBand Trigger Accessibility

- Accessible name: `"Add note"` via `aria-label` on the icon-only button element.
- Focus ring: high-contrast 2 px ring using the existing design system focus token; ring must remain visible against the CommandBand background.
- Touch target: minimum 44 × 44 CSS px.
- No persistent tooltip on touch-only iPhone. Desktop/pointer devices show a tooltip on hover/focus.

---

## Mobile Layout Contract

### Bottom-Sheet Modal

The live-note modal uses a bottom-sheet pattern at phone-width viewports:

- Full-width, anchored to the bottom edge of the viewport.
- `max-height: 100dvh` (dynamic viewport units) to prevent layout shift when the software keyboard opens.
- Page content behind the modal is scroll-locked while the modal is open.

### Sticky Control Rail

Note-type chips and the mic control cluster occupy a sticky rail at the top of the modal body:

- The rail remains visible while the textarea scrolls.
- The rail is never pushed off-screen by the software keyboard opening.

### Sticky Footer

Save and Cancel are pinned to the bottom of the modal:

- `padding-bottom: env(safe-area-inset-bottom)` keeps actions above the home indicator on notched iPhones.
- Footer is always visible and tappable when the keyboard is open.

### Keyboard-Open Guarantees

When the software keyboard is open on iPhone Safari or iPhone Chrome:

1. The modal height adjusts to the remaining viewport (`100dvh` minus keyboard height).
2. The modal body scrolls internally if content overflows.
3. The Stop control (while `listening`) and the Save button remain visible and tappable without additional scrolling.
4. At least 4 lines of textarea text remain visible.
5. No primary action (Stop, Save) is hidden behind the keyboard or the home-indicator safe area.

### Tap-Target Minimums

| Control | Minimum size |
|---------|-------------|
| Mic button, note-type chips, Save, Cancel | 44 × 44 CSS px |
| CommandBand `Add note` trigger | 44 × 44 CSS px |
| Halftime `Add note` button | 44 × 44 CSS px |
| Minimum gap between adjacent controls | 8 CSS px |

---

## Persistence Contract

### Explicit Save Only

Every voice lifecycle event — `onresult`, `onend`, `onerror`, silence timeout, modal close, and `visibilitychange` / `pagehide` — is prohibited from calling any note mutation. Only the Save button triggers note persistence. This rule has no exceptions.

### No Auto-Save

There is no auto-save, no draft persistence to `localStorage`, and no side-channel write path for voice data. If the coach dismisses the modal without saving, the draft including all dictated text is discarded.

### Save Lifecycle States

| State | Save button | 
|-------|------------|
| `idle` (form valid) | Enabled |
| `saving` | Disabled; shows "Saving..." label; duplicate taps are blocked |
| `success` | Modal closes; success feedback shown |
| `failed` | Modal stays open; inline error shown; Save re-enabled; draft retained |

On failed save, all content (note text, selected note type, selected player, dictated transcript) is preserved for retry.

### Single Canonical Mutation Path

All note saves use the existing path exclusively:

- `mutations.createGameNote(...)` — for new notes
- `mutations.updateGameNote(...)` — for updates to existing notes

Both are dispatched through `useOfflineMutations`, which routes to the IndexedDB offline queue when the device has no connectivity. No additional GraphQL calls, no new Lambda functions, and no new DynamoDB fields are introduced for voice metadata.

### Offline Behaviour

When the device is offline at Save time:
- The note is enqueued in the offline queue and the modal closes with normal success feedback.
- The queued note syncs when connectivity is restored, following the same ordering guarantees as all other offline game mutations.

When the device is offline at dictation time:
- Speech recognition may fail if the browser's speech engine requires a network connection. The hook surfaces a `network` error code.
- An inline message directs the coach to type manually.
- The manual typing and Save paths remain fully functional offline.

---

## Related Files

| File | Role |
|------|------|
| `src/components/GameManagement/hooks/useSpeechToText.ts` | Speech recognition hook: FSM, capability gating, transcript normalisation, silence timer, idempotent finalisation |
| `src/components/GameManagement/hooks/useSpeechToText.test.ts` | Unit tests: FSM transitions, idempotency, error code mapping, normalisation pipeline, race sequences |
| `src/components/GameManagement/PlayerNotesPanel.tsx` | Live-note modal: voice controls, bottom-sheet layout, accessibility contract, 500-char enforcement, toast/inline routing |
| `src/components/GameManagement/PlayerNotesPanel.test.tsx` | Component tests: capability gating, UI states, transcript merge and clamping, low-confidence display, save/discard paths |
| `src/components/GameManagement/CommandBand.tsx` | CommandBand: icon-only direct-entry trigger, right-cell coexistence with rotation badge at narrow widths |
| `src/components/GameManagement/CommandBand.test.tsx` | Tests: icon-only rendering, accessible name, 44 × 44 tap target, narrow-viewport coexistence rules |
| `src/components/GameManagement/GameManagement.tsx` | Shared note modal controller: owns `openNoteModal(intent)`, routes all entry paths without tab switching |
| `src/components/GameManagement/GameManagement.test.tsx` | Integration tests: direct modal open from Lineup/Bench/halftime, focus return, keyboard assertions |
| `src/App.css` | Bottom-sheet, sticky rail, safe-area padding, mic button states, recording indicator, 44 × 44 tap targets |
| `e2e/game-management-direct-note.mobile.spec.ts` | Mobile E2E: icon-only trigger, halftime / field-tab direct entry, Stop and Save visibility with keyboard open |
| `docs/plans/VOICE-TO-TEXT-LIVE-GAME-NOTES-PLAN.md` | Phase 1 implementation plan — voice capture in the Notes tab |
| `docs/plans/VOICE-NOTE-DIRECT-ENTRY-PHASE2-CONCEPT-PLAN.md` | Phase 2 implementation plan — CommandBand and halftime direct entry |
| `docs/specs/UI-SPEC.md` | §7.4 (CommandBand direct trigger), §7.5 (halftime trigger surface of truth), §8 (live note modal and voice behavior) |
