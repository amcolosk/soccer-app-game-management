# TeamTrack Help System — Content & Architecture Specification

**Version:** 1.0
**Status:** Draft — For Review
**Audience:** Developer implementation
**Depends on:** UI-SPEC.md §9 (Help & Bug Report FAB)

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Option Evaluation](#2-option-evaluation)
3. [Recommended Architecture](#3-recommended-architecture)
4. [HelpFabContext Extension](#4-helpfabcontext-extension)
5. [Help Screen Key Design](#5-help-screen-key-design)
6. [Content Model](#6-content-model)
7. [Component Architecture](#7-component-architecture)
8. [UX Patterns & Display](#8-ux-patterns--display)
9. [Onboarding vs. Reference Help](#9-onboarding-vs-reference-help)
10. [Game Management Multi-State Design](#10-game-management-multi-state-design)
11. [Inline Contextual Icons — v1 Decision](#11-inline-contextual-icons--v1-decision)
12. [Help Tour — Decision & Deferral](#12-help-tour--decision--deferral)
13. [Accessibility Requirements](#13-accessibility-requirements)
14. [z-index Integration](#14-z-index-integration)
15. [Bundle Size & Performance](#15-bundle-size--performance)
16. [File & Directory Structure](#16-file--directory-structure)
17. [Per-Screen Wiring Guide](#17-per-screen-wiring-guide)
18. [Implementation Phases](#18-implementation-phases)
19. [Risks & Open Questions](#19-risks--open-questions)

---

## 1. Purpose & Scope

This document specifies the architecture, content model, component design, and UX patterns for the TeamTrack context-sensitive help system. It fulfills the placeholder referenced in UI-SPEC.md §9.9:

> *"A separate Help Content Specification document will define the help content, structure, and delivery mechanism. The FAB UI and bottom-sheet pattern remain unchanged when help is enabled — only the 'Get Help' row transitions from disabled to active."*

### What this spec covers

- Architectural decision between delivery options (static vs. dynamic, modal vs. inline)
- How `HelpFabContext` is extended without breaking existing `debugContext` functionality
- The TypeScript content model (`HelpScreenKey`, `ScreenHelpContent`, etc.)
- How `HelpFab.tsx` activates the "Get Help" path
- The `HelpModal` component design and opening sequence
- First-run onboarding design (Phase 2)
- Accessibility, z-index, and motion requirements
- Per-screen wiring instructions for all 14 screen/state contexts
- Phased implementation plan

### What this spec does NOT cover

- The exact prose copy for each help article (that is content authoring work, to be done during implementation)
- Visual design tokens (inherited from UI-SPEC.md)
- Bug report behavior (unchanged; see BUG-REPORT-SYSTEM.md)

---

## 2. Option Evaluation

Four architectural options were evaluated against the hard constraints:  
**offline-first PWA · mobile-first sideline use · no new external dependencies · FAB as entry point · consistent with existing UI patterns**.

### Option A — Static Inline Help Modal

Help content stored as TypeScript constants. `HelpFabContext` extended with a screen identifier. A `HelpModal` component renders pre-written content from the identifier. Ships with the bundle; no server required.

| Criterion | Assessment |
|-----------|-----------|
| Offline | ✅ Fully offline — zero network dependency |
| Mobile-first | ✅ Modal pattern already established in the app |
| No new deps | ✅ Zero new packages |
| Consistent UI | ✅ Mirrors BugReport modal flow exactly |
| Content updates | ⚠️ Requires app release for every text change |
| Onboarding | ❌ No first-run path |
| Extensibility | ⚠️ Cannot extract to CMS later without interface changes if designed naively |

**Verdict:** Solid foundation, but incomplete on its own — lacks onboarding and the content model design matters for future extensibility.

---

### Option B — Progressive Disclosure with Tooltip Cards

Inline collapsible info cards injected into each screen. FAB "Get Help" highlights or expands the cards. Cards dismissed via localStorage.

| Criterion | Assessment |
|-----------|-----------|
| Offline | ✅ |
| Mobile-first | ❌ **Disqualifying.** Inline cards steal vertical real estate that is severely constrained on the In-Progress screen (CommandBand + TabNav + field already fills the viewport). Highlighting/expanding cards during a live game would overlay the SubstitutionPanel and RotationWidget — functionally dangerous for a coach mid-game. |
| No new deps | ✅ |
| Consistent UI | ❌ No existing inline card patterns; would require a new visual language |
| FAB as entry point | ⚠️ Partially — the FAB role is reduced to "highlighting" rather than delivering content |
| First-visit auto-tips | ⚠️ Disruptive on sideline; coach may open app at kick-off |

**Verdict:** Rejected. Screen real estate is the binding constraint for a sideline-first PWA. Injecting help cards into live game screens is incompatible with the "Glanceable" and "Minimal chrome" design principles from UI-SPEC.md §1.

---

### Option C — External Documentation Links + Search

"Get Help" opens a modal with links to an external wiki, Notion page, or CMS. Searchable articles served externally.

| Criterion | Assessment |
|-----------|-----------|
| Offline | ❌ **Disqualifying.** A coach on a grass sideline routinely has poor or no connectivity. The offline PWA constraint is non-negotiable. |
| No new deps | ❌ External service dependency |
| Content sync | ❌ External docs drift out of sync with app UI inevitably |
| Content updates | ✅ Updates without an app release |

**Verdict:** Rejected. Violates the offline hard constraint. External documentation may be a useful supplement in Phase 3 for desktop use, but cannot be the primary delivery mechanism.

---

### Option D — Hybrid: Context-Aware Modal + First-Run Onboarding

FAB "Get Help" opens a context-aware help modal with screen-specific content (Option A foundation). Separately, a first-run onboarding overlay is shown once to new users. Both share the same TypeScript content model. Content can be extracted to a CMS in Phase 3 without changing any interfaces.

| Criterion | Assessment |
|-----------|-----------|
| Offline | ✅ All content ships in the bundle |
| Mobile-first | ✅ Modal pattern; no screen real estate consumed |
| No new deps | ✅ Zero new packages for Phase 1 and 2 |
| Consistent UI | ✅ HelpModal mirrors BugReport modal opening sequence exactly |
| Onboarding | ✅ First-run overlay (Phase 2) |
| Extensibility | ✅ `HelpScreenKey` and `ScreenHelpContent` types are stable across CMS migration |
| Complexity | ⚠️ More components than Option A alone; two maintenance surfaces (reference + onboarding content) |

**Verdict:** Recommended. Fulfills all constraints, adds onboarding, and is designed for future CMS extraction without breaking changes to the interface.

---

### Evaluation Summary

| | A | B | C | D |
|---|---|---|---|---|
| Offline | ✅ | ✅ | ❌ | ✅ |
| Screen real estate | ✅ | ❌ | ✅ | ✅ |
| No new deps | ✅ | ✅ | ❌ | ✅ |
| Consistent UI patterns | ✅ | ❌ | ➖ | ✅ |
| Onboarding support | ❌ | ✅ | ➖ | ✅ |
| CMS extensibility | ❌ | ➖ | ✅ | ✅ |
| **Recommended** | | | | ✅ |

---

## 3. Recommended Architecture

**Option D — Hybrid, delivered in two phases.**

### Phase 1: Context-Aware Reference Help (Help Modal)

The "Get Help" FAB menu item becomes active whenever a screen sets a `helpContext`. Tapping it closes the bottom sheet and opens a `HelpModal` that displays static content looked up from a `HelpContentRegistry` keyed by `HelpScreenKey`. Content is authored as TypeScript objects in `src/help/content.ts`.

### Phase 2: First-Run Onboarding

An `OnboardingOverlay` is shown once to new users on their first authenticated session. It is triggered from `AppLayout.tsx` via a `localStorage` flag. It uses the same visual modal layer but is a distinct component with distinct content — not re-using `HelpModal`.

### Phase 3 (Future, Not Specified Here)

Optional extraction of `HELP_CONTENT` to a remote CMS (headless Contentful, Sanity, etc.) if content volume or update frequency justifies it. The `HelpScreenKey` union type and `ScreenHelpContent` interface form a stable API contract that a CMS schema can satisfy without changing any consuming components.

### Core Design Principles for This Architecture

1. **The `debugContext` and `helpContext` values are separate and independent.** They serve different consumers (BugReport vs. HelpModal), carry different shapes (serialized runtime JSON vs. typed enum key), and are set on different triggers. They must remain separate fields in `HelpFabContext`.

2. **The HelpModal opening sequence mirrors BugReport exactly.** The bottom sheet closes with its slide-down animation, then the modal opens. This prevents z-index conflicts (sheet at 950, modal at 1000) and maintains animation continuity.

3. **Each screen component owns its `helpContext`.** It calls `setHelpContext(key)` on mount and clears it on unmount via the `useEffect` cleanup. This is the same pattern GamePlanner already uses for `setDebugContext`.

4. **Help content is a pure data file.** `src/help/content.ts` exports a single `HELP_CONTENT` constant. It has no imports from React, no component logic. It is easy to find, easy to edit, and easy to test.

---

## 4. HelpFabContext Extension

### Current State

```typescript
// src/contexts/HelpFabContext.tsx (current)
interface HelpFabContextValue {
  debugContext: string | null;
  setDebugContext: (ctx: string | null) => void;
}
```

### Proposed Extension

```typescript
// src/contexts/HelpFabContext.tsx (extended)
import type { HelpScreenKey } from '../help/types';

interface HelpFabContextValue {
  // Existing — unchanged. Consumed by BugReport modal.
  debugContext: string | null;
  setDebugContext: (ctx: string | null) => void;

  // New — consumed by HelpModal.
  // null  → no screen has registered; "Get Help" stays disabled
  // key   → active screen context; "Get Help" becomes active
  helpContext: HelpScreenKey | null;
  setHelpContext: (key: HelpScreenKey | null) => void;
}
```

`HelpFabProvider` adds a second `useState<HelpScreenKey | null>(null)` alongside the existing `debugContext` state. No other changes to the provider.

### Why NOT merge `debugContext` and `helpContext`

| | `debugContext` | `helpContext` |
|---|---|---|
| **Type** | `string \| null` (serialized JSON runtime state) | `HelpScreenKey \| null` (typed enum) |
| **Consumer** | `BugReport.tsx` — appended to bug report text | `HelpModal.tsx` — content lookup key |
| **Set trigger** | State changes within a screen (e.g., availability changes, rotation interval changes) | Screen mount / game status change |
| **Set by** | Currently: `GamePlanner.tsx` via `buildDebugSnapshot()` | Will be: every screen component on mount |
| **Cleaned up on unmount?** | Yes, in GamePlanner | Yes, in all screens |

Merging them would require HelpModal to parse a JSON string to determine what to display, and would prevent GamePlanner from updating its bug-report snapshot independently of the help key. They are structurally incompatible.

### `useHelpFab` Hook — No Breaking Changes

The existing `useHelpFab()` hook continues to return the full context value. All existing callers (`HelpFab.tsx`, `GamePlanner.tsx`) require no changes to their existing calls — they simply gain access to two new fields (`helpContext`, `setHelpContext`).

---

## 5. Help Screen Key Design

```typescript
// src/help/types.ts

/**
 * Identifies which help article to display.
 * One key per distinct screen context where help content differs meaningfully.
 *
 * GameManagement uses four keys — one per game state — because each state
 * surfaces different affordances and the coach's questions differ entirely.
 *
 * Manage uses four keys — one per sub-section — because Teams setup help
 * is unrelated to Invitations help.
 */
export type HelpScreenKey =
  // Home
  | 'home'
  // Game Management — four states
  | 'game-scheduled'
  | 'game-in-progress'
  | 'game-halftime'
  | 'game-completed'
  // Game Planner
  | 'game-planner'
  // Season Reports
  | 'season-reports'
  // Manage — five sub-sections
  | 'manage-teams'
  | 'manage-players'
  | 'manage-formations'
  | 'manage-sharing'
  | 'manage-app'
  // Profile
  | 'profile';
```

**14 total keys.** This is the exhaustive set for v1.

### Rationale for Game Management sub-keys

The single `GameManagement.tsx` component renders four structurally different UIs based on `gameState.status`. Help content for each state is completely different:

| State | Coach's likely questions |
|-------|--------------------------|
| `scheduled` | How do I mark who's available? What does "Late Arrival" mean? How do I start the game? |
| `in-progress` | How do I make a substitution? How do I track a goal? What is the rotation widget? What is the bench tab for? |
| `halftime` | How do I change the lineup for the second half? What is the halftime lineup? |
| `completed` | How do I see full stats? How do I view the season report? |

Serving a single `game-management` article that covers all four states would be either too long to be useful in context or too sparse to be actionable.

### Rationale for Manage sub-keys

`Management.tsx` tracks `activeSection` internally with five tabs: Teams, Formations, Players, Sharing & Permissions, and App. Each tab exposes entirely different functionality. A coach who taps "Get Help" while on the Sharing tab needs help about inviting other coaches — not about formation templates. These are as different as separate screens.

---

## 6. Content Model

### TypeScript Types

All types live in `src/help/types.ts`.

```typescript
// src/help/types.ts

export type HelpScreenKey =
  | 'home'
  | 'game-scheduled'
  | 'game-in-progress'
  | 'game-halftime'
  | 'game-completed'
  | 'game-planner'
  | 'season-reports'
  | 'manage-teams'
  | 'manage-players'
  | 'manage-formations'
  | 'manage-sharing'
  | 'manage-app'
  | 'profile';

/**
 * A single "How do I...?" task entry.
 * Displayed as a numbered list of steps under a bolded title.
 */
export interface HelpTask {
  title: string;    // e.g., "Make a substitution mid-game"
  steps: string[];  // Ordered, imperative instructions. Max 6 steps per task.
}

/**
 * A pro tip, shortcut, or important warning.
 * Displayed as a highlighted callout card.
 */
export interface HelpTip {
  text: string;     // Keep under 80 characters. No markdown.
}

/**
 * The complete help article for one screen context.
 */
export interface ScreenHelpContent {
  /** Display title in the modal header. Should match the screen name in the UI. */
  screenTitle: string;

  /**
   * 1–2 sentence plain-English description of what this screen is for.
   * Written for a first-time coach, not a developer.
   */
  overview: string;

  /**
   * "How do I...?" task entries. Each is rendered as a titled step list.
   * Limit to 4 tasks per screen. The most common questions first.
   */
  tasks: HelpTask[];

  /**
   * Pro tips, shortcuts, or important warnings.
   * Limit to 3 per screen.
   */
  tips: HelpTip[];

  /**
   * Optional. Other screen keys a coach might need next.
   * Rendered as navigation affordances at the bottom of the modal.
   * Max 2 related screens.
   */
  relatedScreens?: HelpScreenKey[];
}

/**
 * The complete registry of all help articles, keyed by HelpScreenKey.
 * TypeScript enforces that all 14 keys are present.
 */
export type HelpContentRegistry = Record<HelpScreenKey, ScreenHelpContent>;

/**
 * Onboarding content type (Phase 2).
 * Intentionally distinct from ScreenHelpContent — different shape, different trigger.
 */
export interface OnboardingContent {
  headline: string;
  body: string;
  features: Array<{ icon: string; label: string }>;
  ctaLabel: string;
}
```

### Content File

```typescript
// src/help/content.ts
import type { HelpContentRegistry } from './types';

export const HELP_CONTENT: HelpContentRegistry = {
  'home': {
    screenTitle: 'Games List',
    overview: 'This is your home screen. It shows all your games grouped by status — active, upcoming, and past.',
    tasks: [
      {
        title: 'Schedule a new game',
        steps: [
          'Tap "+ Schedule New Game" at the top of the screen.',
          'Select the team from the dropdown.',
          'Enter the opponent name and date/time.',
          'Check "Home Game" if you are playing at home.',
          'Tap "Create".',
        ],
      },
      // ... additional tasks
    ],
    tips: [
      { text: 'Tap a game card to open it. Active games appear at the top.' },
      // ...
    ],
    relatedScreens: ['game-scheduled', 'manage-teams'],
  },

  'game-scheduled': { /* ... */ },
  'game-in-progress': { /* ... */ },
  'game-halftime': { /* ... */ },
  'game-completed': { /* ... */ },
  'game-planner': { /* ... */ },
  'season-reports': { /* ... */ },
  'manage-teams': { /* ... */ },
  'manage-players': { /* ... */ },
  'manage-formations': { /* ... */ },
  'manage-sharing': { /* ... */ },
  'manage-app': { /* ... */ },
  'profile': { /* ... */ },
};
```

> **Note:** The TypeScript type `HelpContentRegistry = Record<HelpScreenKey, ScreenHelpContent>` ensures the compiler will fail if any of the 14 keys is missing from `HELP_CONTENT`. This is the primary guard against incomplete content during implementation.

### Content Authoring Guidelines

These rules apply to all entries in `HELP_CONTENT`:

| Rule | Rationale |
|------|-----------|
| `overview`: max 2 sentences, no jargon | Coach reads this in 3 seconds standing on a sideline |
| `tasks`: max 4 per screen | More than 4 tasks indicates the article scope is too broad; split by sub-key |
| Task `steps`: max 6 steps, imperative mood ("Tap X", "Select Y") | Numbered steps are scannable; imperative mood eliminates ambiguity |
| `tips`: max 3 per screen | Tips are secondary; don't bury the tasks |
| No markdown, no HTML in strings | The `HelpModal` renders content as plain text; styled via CSS classes |
| No relative time references ("currently", "new in v1.1") | Help content should not age; remove anything version-specific |
| No screenshot references | Screenshots are not embedded in the modal; content must stand alone |
| `relatedScreens`: max 2 | Navigation affordances are supplemental; more than 2 are distracting |

### index.ts Re-export

```typescript
// src/help/index.ts
export type { HelpScreenKey, ScreenHelpContent, HelpTask, HelpTip, HelpContentRegistry, OnboardingContent } from './types';
export { HELP_CONTENT } from './content';
```

---

## 7. Component Architecture

### 7.1 HelpModal (`src/components/HelpModal.tsx`)

A dialog modal component that displays a `ScreenHelpContent` article. Opened by `HelpFab` after the bottom sheet animation completes.

**Props:**

```typescript
interface HelpModalProps {
  helpContext: HelpScreenKey;    // Which article to display
  onClose: () => void;           // Called when modal is dismissed
  onNavigate?: (key: HelpScreenKey) => void; // Called when a relatedScreen link is tapped
}
```

**Internal structure:**

```
HelpModal
├── Backdrop div (onClick → onClose)
└── Modal card (onClick stopPropagation)
    ├── Header
    │   ├── screenTitle (h2, id="help-modal-title")
    │   └── Close button (aria-label="Close help")
    └── Scrollable content area (tabIndex=0, role="region", aria-label="Help content")
        ├── Overview paragraph
        ├── Tasks section (h3 + numbered step list per task)
        ├── Tips section (h3 + tip cards)
        └── Related Screens section (optional, pill buttons)
```

**State:** None. Stateless beyond what's passed as props. The open/close lifecycle is managed by `HelpFab`.

**Rendering logic:**

```typescript
import { useEffect, useRef } from 'react';
import { HELP_CONTENT } from '../help';
import type { HelpScreenKey } from '../help';

export function HelpModal({ helpContext, onClose, onNavigate }: HelpModalProps) {
  const content = HELP_CONTENT[helpContext];
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to heading when modal opens (accessibility)
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Escape key dismissal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="help-modal-overlay" onClick={onClose}>
      <div
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ... render content ... */}
      </div>
    </div>
  );
}
```

### 7.2 HelpFab Changes (`src/components/HelpFab.tsx`)

Three additions to the existing `HelpFab` component:

**1. Read `helpContext` from context:**

```typescript
const { debugContext, helpContext } = useHelpFab();
```

**2. Add the `openHelpAfterClose` ref (mirrors the existing `openBugReportAfterClose` pattern exactly):**

```typescript
const openHelpAfterClose = useRef(false);

function handleOpenHelp() {
  openHelpAfterClose.current = true;
  closeSheet();
}
```

The existing `handleAnimationEnd` and the `setTimeout` fallback in `closeSheet` both check `openBugReportAfterClose.current`. The same blocks must also check `openHelpAfterClose.current`:

```typescript
// In both handleAnimationEnd and the setTimeout fallback:
if (openHelpAfterClose.current) {
  openHelpAfterClose.current = false;
  setHelpModalOpen(true);
}
```

**3. Conditionally enable the "Get Help" button:**

```tsx
// Replace the existing disabled "Get Help" button with:
<button
  className={`help-fab-sheet-option${!helpContext ? ' help-fab-sheet-option--disabled' : ''}`}
  role="menuitem"
  aria-disabled={!helpContext}
  disabled={!helpContext}
  onClick={helpContext ? handleOpenHelp : undefined}
  type="button"
>
  <span className="help-fab-sheet-option__icon">📖</span>
  <div>
    <span className="help-fab-sheet-option__label">Get Help</span>
    {!helpContext && (
      <span className="help-fab-sheet-option__subtitle">Coming soon</span>
    )}
  </div>
</button>
```

**4. Render HelpModal when open:**

```tsx
{helpModalOpen && helpContext && (
  <HelpModal
    helpContext={helpContext}
    onClose={() => setHelpModalOpen(false)}
    onNavigate={(key) => {
      setHelpModalOpen(false);
      // Navigation to related screens is handled by the caller's routing context.
      // HelpFab itself does not navigate — it calls an optional callback.
      // Screen components that support this can pass a handler via context extension (Phase 3).
    }}
  />
)}
```

> **Note on `onNavigate`:** In Phase 1, related screen navigation can simply close the modal. Tapping "Related Screens" navigation pills is a Phase 2 enhancement if needed. Leave the prop in the interface but treat it as optional.

### 7.3 OnboardingOverlay (`src/components/OnboardingOverlay.tsx`) — Phase 2

**Trigger:** `AppLayout.tsx` checks `localStorage.getItem('teamtrack:onboarding-v1-seen')` on mount. If absent, renders `<OnboardingOverlay>`.

**On dismiss:** Sets `localStorage.setItem('teamtrack:onboarding-v1-seen', 'true')`.

**Props:**

```typescript
interface OnboardingOverlayProps {
  onDismiss: () => void;
}
```

**Content shape:** Uses `OnboardingContent` type (defined in §6). Not `ScreenHelpContent` — different structure, different purpose.

**z-index:** 1000, same as `HelpModal`. Shown before any user interaction, so no conflict with `CommandBand` (200) or `TabNav` (190).

**Accessibility:**
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby="onboarding-title"`
- Focus moves to the dismiss button on mount
- Escape key dismisses

---

## 8. UX Patterns & Display

### 8.1 Opening Sequence (Phase 1)

The complete flow from FAB tap to HelpModal open:

```
Coach taps FAB (z-index 90)
  ↓
Bottom sheet slides up (z-index 950), 250ms ease-out
  ↓
Coach taps "Get Help" (active when helpContext is set)
  ↓
openHelpAfterClose.current = true
closeSheet() called
  ↓
Bottom sheet slides down (z-index 950), 200ms ease-in
  ↓
handleAnimationEnd fires (or 300ms timeout fallback)
  setSheetOpen(false)
  openHelpAfterClose.current = false
  setHelpModalOpen(true)
  ↓
HelpModal renders (z-index 1000)
```

This sequence is identical to the existing `BugReport` flow. There is never a moment where both the sheet (950) and the modal (1000) are visible simultaneously.

### 8.2 HelpModal Layout

```
┌─────────────────────────────────────────┐  ← modal card (white, border-radius 12px)
│  Game Management — In Progress    [✕]   │  ← header (sticky within modal)
├─────────────────────────────────────────┤
│  What this screen is for                │  ← overview (text-secondary)
│  Track the live game: manage your       │
│  lineup, record goals, and follow the   │
│  rotation plan.                         │
│                                         │
│  ──────────────────────────────────     │
│  How to…                                │  ← tasks section heading (h3)
│                                         │
│  Make a substitution                    │  ← task title (bold)
│  1. Tap the player's position on the    │
│     field in the Lineup tab.            │
│  2. Select the bench player to bring in │
│  3. Tap "Confirm Substitution"          │
│                                         │
│  Record a goal                          │
│  1. Tap the Goals tab.                  │
│  2. Tap "+ Home Goal" or "+ Away Goal"  │
│  3. Optionally select a scorer.         │
│                                         │
│  ──────────────────────────────────     │
│  Tips                                   │  ← tips section heading (h3)
│                                         │
│  ╔═══════════════════════════════════╗  │  ← tip card (green-tinted callout)
│  ║ 💡 The Bench tab sorts players by  ║  │
│  ║    least play time — use it to     ║  │
│  ║    decide who to sub in next.      ║  │
│  ╚═══════════════════════════════════╝  │
│                                         │
│  ──────────────────────────────────     │
│  You might also need                    │  ← relatedScreens heading
│                                         │
│  [  Game Planner  ]  [  Bench Tab  ]    │  ← pill buttons
└─────────────────────────────────────────┘
```

**Dimensions (phone):**
- Width: `min(95vw, 480px)`
- Max-height: `85vh`
- Overflow: `auto` on the content area (header is sticky within the card)
- Backdrop: `rgba(0,0,0,0.5)`

### 8.3 Why Not an Accordion

The alternative of collapsible sections (tasks collapsed by default, tips collapsed) was considered and rejected for Phase 1.

Reasons:
- A coach on a sideline needs answers in the fewest taps possible. Expanding sections adds a tap.
- Content volume per screen is small (2–4 tasks, 1–3 tips). There is no length problem that an accordion solves.
- Flat, scrollable content is faster to scan than a collapsed accordion on a small screen.

If a future screen's help content becomes long enough to warrant progressive disclosure, this can be revisited per-screen at that time.

### 8.4 Tip Card Visual Treatment

Tips use a distinct visual treatment to separate them from instructional steps:

- Background: a light green tint (`rgba(76, 175, 80, 0.08)` — derived from `--accent-green`)
- Left border: `3px solid var(--accent-green)`
- Border-radius: `6px`
- Padding: `10px 12px`
- Icon: `💡` prefix in the tip text is optional (content authors' choice)

This is a new CSS class (`.help-tip-card`) defined in `HelpModal.css`. It does not affect any existing styles.

### 8.5 Related Screens Navigation Pills

Related screens are rendered as pill-shaped ghost buttons (`border: 1px solid var(--border-color)`, `border-radius: 20px`). Tapping one closes the modal. In Phase 1, tapping a related screen pill only closes the modal — it does not navigate. Actual navigation requires the coach to use the bottom nav. This is intentional: forcing navigation from inside a help modal is complex (requires router access in `HelpFab`) and rarely necessary when the bottom nav is always visible.

In Phase 2, if `onNavigate` is wired to a routing callback, pills can navigate directly.

### 8.6 Animation

- **Modal entrance:** Fade in + slight upward translate (`translateY(12px)` → `translateY(0)`) over `200ms ease-out`. Consistent with the FAB's own entrance animation.
- **Modal exit:** Fade out over `150ms ease-in`.
- **`prefers-reduced-motion`:** Both animations are disabled, matching the existing `HelpFab.css` pattern.

---

## 9. Onboarding vs. Reference Help

These are separate systems that share type definitions but nothing else.

| Dimension | Reference Help | Onboarding |
|-----------|---------------|------------|
| **Trigger** | Coach taps FAB → "Get Help" (manual, intentional) | First authenticated session (automatic) |
| **Timing** | Any time, repeatedly | Once per installation |
| **Content** | Screen-specific task lists and tips | App-level welcome, 3–4 feature highlights |
| **Component** | `HelpModal.tsx` | `OnboardingOverlay.tsx` |
| **Content type** | `ScreenHelpContent` | `OnboardingContent` |
| **Persistence** | None (stateless) | `localStorage` flag `teamtrack:onboarding-v1-seen` |
| **Dismissal** | Close button, backdrop tap, Escape | "Get Started" CTA button, Escape |
| **Revisitable** | Always | Only if localStorage flag is cleared |

### Why NOT unify them

The onboarding experience serves a completely different purpose from reference help. Onboarding fires before the coach has any context about a specific screen — it is an app-level introduction. Reference help fires in response to a specific problem the coach has on a specific screen. Unifying them into a single component would mean either:

a) The onboarding content would need a `HelpScreenKey` key, which is semantically wrong (onboarding has no screen context), or  
b) `HelpModal` would need conditional rendering logic to distinguish onboarding vs. reference modes, making both harder to understand and test.

### Onboarding Content Design

`OnboardingContent` (Phase 2) is a single object — no `Record<HelpScreenKey, ...>` needed:

```typescript
export interface OnboardingContent {
  headline: string;      // "Welcome to TeamTrack"
  body: string;          // 2–3 sentence app description
  features: Array<{
    icon: string;        // emoji
    label: string;       // short feature name
  }>;                    // Max 4 features
  ctaLabel: string;      // "Let's Go" or "Get Started"
}
```

### Onboarding Timing & Placement

The check fires in `AppLayout.tsx`, not in any individual screen. This ensures it appears once regardless of which route the coach lands on first. The overlay mounts over whatever the initial screen is.

```typescript
// In AppLayout.tsx (Phase 2 addition)
const [showOnboarding, setShowOnboarding] = useState(
  !localStorage.getItem('teamtrack:onboarding-v1-seen')
);

function dismissOnboarding() {
  localStorage.setItem('teamtrack:onboarding-v1-seen', 'true');
  setShowOnboarding(false);
}
```

The `v1` in the localStorage key is intentional. If the onboarding content is significantly updated in a future version, incrementing to `v2` re-shows the updated onboarding to existing users.

---

## 10. Game Management Multi-State Design

`GameManagement.tsx` is a single component that renders four structurally different UIs based on `gameState.status`. The `helpContext` must track this state reactively.

### Wiring Pattern

```typescript
// In GameManagement.tsx
import { useHelpFab } from '../../contexts/HelpFabContext';
import type { HelpScreenKey } from '../../help/types';

export function GameManagement({ game, team, onBack }: GameManagementProps) {
  const { setHelpContext } = useHelpFab();

  // Map game status → help key. Reactive to status changes.
  useEffect(() => {
    const statusToHelpKey: Partial<Record<string, HelpScreenKey>> = {
      'scheduled':   'game-scheduled',
      'in-progress': 'game-in-progress',
      'halftime':    'game-halftime',
      'completed':   'game-completed',
    };
    const key = statusToHelpKey[gameState.status];
    if (key) setHelpContext(key);
    return () => setHelpContext(null); // Clear on unmount
  }, [gameState.status, setHelpContext]);

  // ...existing component body...
}
```

**Why a `Partial<Record<...>>` instead of `Record<...>` here?** `gameState.status` is a string from the database, not a TypeScript enum. Before subscription data arrives, it may be an unexpected value. Using `Partial` with an `if (key)` guard ensures the help button stays disabled rather than crashing if an unknown status value arrives.

### Per-State Content Summary

The content itself is authored in `src/help/content.ts`. Below is a guide for what each article should cover:

| Key | `screenTitle` | Primary tasks to cover |
|-----|--------------|----------------------|
| `game-scheduled` | "Game Management — Pre-Game" | Mark player availability, understand availability statuses (available/absent/late), start the game, navigate to the planner |
| `game-in-progress` | "Game Management — In Progress" | Make a substitution, record a goal, track notes (yellow card, red card, star), use the bench tab to find the next sub, read the rotation widget |
| `game-halftime` | "Game Management — Halftime" | Change the lineup for the second half, understand what the halftime lineup is, start the second half, recalculate rotations |
| `game-completed` | "Game Management — Completed" | Read the final play time summary, navigate to full season report |

### State Transition Edge Case

When `gameState.status` transitions (e.g., from `scheduled` to `in-progress` when "Start Game" is tapped), the `useEffect` dependency on `gameState.status` fires immediately. If the help modal happens to be open at the moment of transition (unlikely but possible), the `HelpModal` will not automatically update its content because it receives `helpContext` as a prop at mount time. This is acceptable behaviour: the modal shows the pre-transition content and the coach closes it. The updated content is available the next time they open help.

---

## 11. Inline Contextual Icons — v1 Decision

**Decision: FAB-only for v1. One controlled exception.**

### Why not widespread inline "?" icons in v1

- The CommandBand and TabNav (z-index 190–200) on the In-Progress screen are dense UI. Adding tap targets for help would compete with functional controls.
- Every inline icon is a separate content maintenance concern — it cannot reuse the `ScreenHelpContent` articles without significant engineering overhead.
- The FAB provides a single consistent affordance. Introducing inline icons alongside it creates competing patterns that undermine discoverability.
- The sideline-first design principle ("Minimal chrome") explicitly discourages non-functional decorative elements on the game screens.

### The One Controlled Exception

The **Rotation Interval field** in Game Planner (`rotationIntervalMinutes`) is a non-obvious setting. Setting it incorrectly (e.g., `15` minutes for a `30`-minute half) silently produces a rotation plan with only one rotation per half. A coach might not notice until the game starts.

A single `ⓘ` icon adjacent to the "Rotation Interval" label is justified. It shows a short tooltip on tap:

> "Sets how often players rotate. For a 30-minute half with 10-minute intervals, you get 3 rotations."

**Implementation:** This is a **self-contained tooltip**, not a `HelpModal` trigger. It is implemented as a `<abbr>` element with `title` attribute for desktop, or a small popover (`<div role="tooltip" id="rotation-hint">`) for mobile. It does NOT interact with `HelpFabContext` in any way.

This exception is scoped to Game Planner and explicitly bounded. Additional inline icons require explicit approval as new scope.

---

## 12. Help Tour — Decision & Deferral

**Decision: Deferred. Not in Phase 1 or Phase 2.**

### Why deferred

Step-by-step UI tours (Shepherd.js, Driver.js, Intro.js) were evaluated and rejected for the following reasons:

1. **Dependencies:** All tour libraries are external dependencies, violating the stated constraint.
2. **DOM fragility:** Tour steps target specific DOM elements by selector or ref. UI changes break tours silently — there is no TypeScript enforcement between tour step targets and actual rendered elements.
3. **Mobile awkwardness:** Tour libraries are primarily designed for desktop. Popovers clip on small viewports, scroll synchronisation is unreliable, and overlay placement during live game management (CommandBand obscuring popovers) is unworkable.
4. **Cognitive load during gameplay:** A coach who triggers a tour during an active game (e.g., `game-in-progress`) would have navigation overlays covering live game data. This is a safety concern, not just a UX issue.
5. **Diminishing returns:** The "What is this screen?" overview + numbered task lists in `ScreenHelpContent` are functionally equivalent to a tour for a text-navigated help system on mobile. The content authoring effort is the same; the engineering risk is eliminated.

### Future consideration

If a tour-like feature is revisited, the correct approach is a coach-controlled "sandbox mode" (a demo game with fake data) rather than an overlay tour of the live UI. This is outside the scope of the help system.

### Phase 3 Re-evaluation Criteria

Reconsider the help tour deferral only if **all three** of the following conditions are met:

1. **Evidence of confusion at scale:** >25% of submitted bug reports reference confusion about basic workflows (as measured by tagging bug reports with the `workflow-confusion` label in the issue tracker).
2. **Sandbox mode is available:** A demo game with fake data exists, removing the safety concern about tours running over live game data.
3. **No new tour dependencies:** A custom, dependency-free tour implementation (using the existing `HelpContentRegistry` task steps as tour content) is feasible within the engineering budget.

If these criteria are not all met, the deferred status holds.

---

## 13. Accessibility Requirements

All requirements are derived from WCAG 2.1 AA and the existing patterns in the codebase (`ConfirmModal`, `HelpFab`).

### HelpModal

| Requirement | Implementation |
|-------------|---------------|
| Dialog role | `role="dialog"` (not `alertdialog` — help is informational, not interruptive) |
| Modal semantics | `aria-modal="true"` |
| Labelled by title | `aria-labelledby="help-modal-title"` on modal card; `id="help-modal-title"` on the `<h2>` |
| Focus on open | `useEffect` moves focus to `<h2>` with `tabIndex={-1}` so it's focusable without being in tab order |
| Focus trap | Tab/Shift+Tab cycle within modal; focus does not escape to the document behind |
| Escape key | Calls `onClose()` — implemented via `keydown` listener in `useEffect` with cleanup |
| Close button label | `aria-label="Close help"` |
| Scrollable region | `tabIndex={0}` on scroll container so keyboard users can scroll with arrow keys |
| Related screen buttons | Plain `<button>` elements, inheriting standard keyboard focusability |

### Focus Trap Implementation Note

The existing `BugReport.tsx` modal does **not** implement a focus trap — it moves focus to the first element on open but does not prevent Tab from escaping. `HelpModal` must implement a proper trap because it contains multiple interactive elements (task list, close button, related screen pills). A focus trap can be implemented with a small `useEffect` that intercepts `keydown` and wraps focus, or by using the HTML `inert` attribute on the backdrop. A third-party focus-trap library should not be added — implement it manually to avoid a new dependency.

### Reduced Motion

```css
/* HelpModal.css */
@media (prefers-reduced-motion: reduce) {
  .help-modal {
    animation-duration: 0.001ms;
  }
}
```

This mirrors the existing pattern in `HelpFab.css` exactly.

### FAB Button Update (when help is enabled)

When `helpContext` is set, the "Get Help" button:
- Removes `disabled` attribute
- Removes `aria-disabled="true"`
- Removes "Coming soon" subtitle text
- Gains `onClick` handler

No `aria-label` change is needed on the FAB button itself (`aria-label="Help and bug report"` remains correct).

### OnboardingOverlay Accessibility (Phase 2)

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby="onboarding-title"`
- Focus on the "Get Started" / dismiss button on mount (not the heading, since the CTA is the primary action)
- Escape key dismisses

---

## 14. z-index Integration

From UI-SPEC.md §10, the existing z-index stack:

| Layer | z-index | Element |
|-------|---------|---------|
| Help FAB | 90 | `.help-fab` |
| Bottom navigation | 100 | `.bottom-nav` |
| Game tab navigation | 190 | `.game-tab-nav` |
| Command band | 200 | `.command-band` |
| Help FAB bottom sheet | 950 | `.help-fab-sheet` |
| Modal overlays | 1000 | `.modal-overlay` |
| Toast notifications | 9999+ | `react-hot-toast` |

### New entries (add to UI-SPEC.md §10)

| Layer | z-index | Element |
|-------|---------|---------|
| **Help modal** | **1000** | `.help-modal-overlay` |
| **Onboarding overlay** | **1000** | `.onboarding-overlay` |

Both `HelpModal` and `OnboardingOverlay` are at z-index 1000, the same layer as `ConfirmModal` and `BugReport`. This is correct and intentional: they are peer modal overlays, never shown simultaneously.

### Conflict Analysis

| Scenario | Safe? | Reason |
|----------|-------|--------|
| Help modal open during CommandBand (200) | ✅ | Modal at 1000 > CommandBand at 200 |
| Help modal open with Toast notification | ✅ | Toast at 9999 > modal at 1000; toast shows above modal |
| Help sheet and help modal simultaneously | ✅ Impossible | `openHelpAfterClose` pattern ensures sheet closes before modal opens |
| Help modal and ConfirmModal simultaneously | ✅ Impossible | Neither `HelpModal` nor `ConfirmModal` triggers the other |
| Onboarding overlay with bottom sheet | ✅ | Onboarding is shown on first app load before any FAB interaction |

---

## 15. Bundle Size & Performance

### Estimation

All help content ships in the main JavaScript bundle.

| Item | Raw size | Gzipped |
|------|---------|---------|
| `src/help/types.ts` (interfaces only) | ~1 KB | ~0.3 KB |
| `src/help/content.ts` (14 articles × ~250 words avg) | ~18–25 KB | ~4–6 KB |
| `HelpModal.tsx` + `HelpModal.css` | ~4–6 KB | ~1–2 KB |
| `OnboardingOverlay.tsx` + CSS (Phase 2) | ~2–3 KB | ~0.8 KB |
| **Total addition** | **~25–35 KB** | **~6–9 KB** |

This is well within acceptable bundle size for a PWA. The app already lazily loads `Management.tsx`, `UserProfile.tsx`, `SeasonReportRoute.tsx`, and `DevDashboardRoute.tsx` (visible in `App.tsx`). The help module does not need code-splitting in Phase 1.

### Future Splitting Strategy (Phase 3 Only)

If help content grows significantly (e.g., multi-language, >30 KB), `HELP_CONTENT` can be extracted to a separate chunk via dynamic import:

```typescript
// Lazy-load the content registry on first "Get Help" interaction
const content = await import('../help/content').then(m => m.HELP_CONTENT);
```

The `HelpScreenKey` type and `ScreenHelpContent` interface remain in the main bundle (they are referenced by `HelpFabContext`). Only the data object is deferred. This migration requires no changes to `HelpFabContext`, `HelpFab`, or any screen components.

---

## 16. File & Directory Structure

### New files to create

```
src/
  help/
    types.ts                 — HelpScreenKey, ScreenHelpContent, HelpTask, HelpTip,
                               HelpContentRegistry, OnboardingContent
    content.ts               — HELP_CONTENT: HelpContentRegistry  (all 14 articles)
    index.ts                 — barrel re-export

  components/
    HelpModal.tsx            — help article modal component (Phase 1)
    HelpModal.css            — modal styles (Phase 1)
    OnboardingOverlay.tsx    — first-run welcome overlay (Phase 2)
    OnboardingOverlay.css    — overlay styles (Phase 2)
```

### Existing files to modify

```
src/
  contexts/
    HelpFabContext.tsx       — Add helpContext + setHelpContext to interface and provider

  components/
    HelpFab.tsx              — Add openHelpAfterClose ref, handleOpenHelp,
                               conditional enable/disable of "Get Help" button,
                               render HelpModal when open

    AppLayout.tsx            — Phase 2: Add OnboardingOverlay with localStorage gate

  components/GameManagement/
    GameManagement.tsx       — Add useEffect to call setHelpContext(key) based on gameState.status

  components/
    GamePlanner.tsx          — Add setHelpContext('game-planner') on mount
    Home.tsx                 — Add setHelpContext('home') on mount
    SeasonReport.tsx         — Add setHelpContext('season-reports') on mount
    Management.tsx           — Add setHelpContext per active section
    UserProfile.tsx          — Add setHelpContext('profile') on mount
```

### Files NOT to modify

```
src/components/BugReport.tsx          — No changes. Bug report is unaffected.
src/components/HelpFab.css            — Existing styles cover the disabled button. One new
                                        class may be needed only if the enabled "Get Help"
                                        button needs distinct styling (unlikely).
src/types/debug.ts                    — No changes. GamePlannerDebugContext is unchanged.
```

---

## 17. Per-Screen Wiring Guide

Each screen component must call `setHelpContext` on mount and clear it on unmount. The pattern is identical to how `GamePlanner.tsx` already uses `setDebugContext`.

### Pattern Template

```typescript
// Add to any screen component
const { setHelpContext } = useHelpFab();

useEffect(() => {
  setHelpContext('SCREEN_KEY_HERE');
  return () => setHelpContext(null);  // REQUIRED: prevents stale context
}, [setHelpContext]);
```

The `setHelpContext` function reference is stable (wrapped in `useCallback` in the provider, or stable by virtue of being a `useState` setter). Including it in the dependency array is correct but will not cause re-renders.

### Screen-by-Screen Instructions

| Component | File | Key to set | Notes |
|-----------|------|-----------|-------|
| `Home` | `Home.tsx` | `'home'` | Set on mount. Stable key — no dependency on game state. |
| `GameManagement` | `GameManagement/GameManagement.tsx` | `'game-scheduled'` / `'game-in-progress'` / `'game-halftime'` / `'game-completed'` | Reactive `useEffect` on `gameState.status`. See §10 for exact implementation. |
| `GamePlanner` | `GamePlanner.tsx` | `'game-planner'` | Set on mount. This component already calls `setDebugContext` — add `setHelpContext` as a separate `useEffect`. |
| `SeasonReport` | `SeasonReport.tsx` | `'season-reports'` | Set on mount. |
| `Management` | `Management.tsx` | `'manage-teams'` / `'manage-players'` / `'manage-formations'` / `'manage-sharing'` / `'manage-app'` | Reactive `useEffect` on `activeSection` state (values: `'teams'`, `'players'`, `'formations'`, `'sharing'`, `'app'`). Default to `'manage-teams'` if section is indeterminate. |
| `UserProfile` | `UserProfile.tsx` | `'profile'` | Set on mount. |

### Management.tsx Wiring Detail

The internal section state in `Management.tsx` is `activeSection` with values `'teams' | 'formations' | 'players' | 'sharing' | 'app'`. The wiring:

```typescript
const { setHelpContext } = useHelpFab();

useEffect(() => {
  const sectionToKey: Record<'teams' | 'formations' | 'players' | 'sharing' | 'app', HelpScreenKey> = {
    teams:       'manage-teams',
    players:     'manage-players',
    formations:  'manage-formations',
    sharing:     'manage-sharing',
    app:         'manage-app',
  };
  const key = sectionToKey[activeSection] ?? 'manage-teams';
  setHelpContext(key);
  return () => setHelpContext(null);
}, [activeSection, setHelpContext]);
```

### Route Components (no wiring needed)

The route wrapper components in `src/components/routes/` (`GameManagementRoute.tsx`, `GamePlannerRoute.tsx`, `SeasonReportRoute.tsx`) do not call `setHelpContext`. The actual screen components they render do. Route wrappers exist only to handle data fetching and route params — they do not have screen context awareness.

---

## 18. Implementation Phases

### Phase 1: Context-Aware Reference Help

**Goal:** "Get Help" becomes active on all authenticated screens and opens a context-appropriate help article.

**Deliverables:**
1. `src/help/types.ts` — all types defined
2. `src/help/content.ts` — all 14 articles authored (prose content, not just structure)
3. `src/help/index.ts` — barrel export
4. `HelpFabContext.tsx` — extended with `helpContext` / `setHelpContext`
5. `HelpModal.tsx` + `HelpModal.css` — fully implemented with accessibility requirements
6. `HelpFab.tsx` — `openHelpAfterClose` ref, conditional enable, `HelpModal` render
7. All 6 screen components wired (see §17)

**Definition of done:**
- "Get Help" is disabled on all screens until the screen registers its context
- Tapping "Get Help" on any authenticated screen shows the correct article
- Tapping "Get Help" when no context is set (edge case) does not crash; button remains disabled
- HelpModal passes: `role="dialog"`, `aria-modal`, focus management, Escape key, reduced-motion
- `HELP_CONTENT` TypeScript compilation fails if any of the 14 keys is absent

**Testing:**
- Unit tests for `HelpModal`: renders correct content per key, closes on Escape, closes on backdrop click, focus moves to heading on mount
- Unit tests for extended `HelpFabContext`: both `debugContext` and `helpContext` are independent
- Integration test: HelpFab opens BugReport unaffected when `helpContext` is also set

### Phase 2: First-Run Onboarding

**Goal:** New coaches see a welcome overlay on first login.

**Deliverables:**
1. `OnboardingContent` type added to `src/help/types.ts`
2. Onboarding content object authored
3. `OnboardingOverlay.tsx` + `OnboardingOverlay.css`
4. `AppLayout.tsx` wired with localStorage check

**Definition of done:**
- Overlay shown on first authenticated session
- Overlay not shown on subsequent sessions
- Dismissable via CTA button and Escape key
- `localStorage` key `teamtrack:onboarding-v1-seen` is set on dismiss
- Overlay does not appear on `/invite/:id` or `/dev` routes (these are outside `AppLayout`)

### Phase 3 (Future — Not Specified)

- Remote CMS content delivery (Contentful, Sanity, etc.)
- Per-screen `onNavigate` wiring for related screen navigation pills
- Inline rotation-interval tooltip (documented in §11 as an exception; may be built independently of the help system)
- Re-evaluation of help tour approach

---

## 19. Risks & Open Questions

### Risk 1 — Content drift as UI evolves

**Description:** When the UI changes (new tab added to Game Management, new availability status, etc.), `HELP_CONTENT` must be manually updated. There is no automated link between UI code and help content.

**Mitigation:** 
- Co-locate `src/help/content.ts` with the app source (not a separate repo or CMS) so it is changed in the same PR as UI changes.
- Add a `// @help-content: game-in-progress` comment near any UI element that is documented in a help article. This creates a searchable marker but does not enforce the link.
- The `HelpContentRegistry = Record<HelpScreenKey, ScreenHelpContent>` type ensures that adding a new `HelpScreenKey` to the union forces a compiler error until content is authored.

**Open question:** Should a lint rule be introduced to warn when a `HelpScreenKey` is added to the type but not to `HELP_CONTENT`? TypeScript's `Record<>` already enforces this at compile time — a lint rule would be redundant.

---

### Risk 2 — `gameState.status` before subscription data arrives

**Description:** `GameManagement.tsx` derives `gameState` from a real-time subscription. Before the first subscription event arrives, `gameState.status` may be its initial local value (set from the `game` prop on mount). If the game prop does not include a `status` field, `gameState.status` may be `undefined`.

**Mitigation:** The `Partial<Record<...>>` pattern in the `useEffect` (§10) handles this: if `gameState.status` is `undefined` or an unrecognised value, `key` is `undefined`, the `if (key)` guard skips `setHelpContext`, and the button stays disabled. The help button becoming active slightly after page load (on first subscription delivery) is acceptable behaviour.

---

### Risk 3 — Focus management conflicts with existing screen focus patterns

**Description:** Some screens manage focus explicitly (e.g., moving focus to a newly added player in Management, or the CommandBand's first focusable element). Opening and closing `HelpModal` must not disrupt the screen's own focus state.

**Mitigation:** On modal close, `HelpModal` should return focus to the element that was focused before the modal opened. Capture `document.activeElement` in a ref on modal mount, and call `.focus()` on that element in the cleanup. This is standard accessible modal practice. The FAB button itself (`help-fab`) is the most likely prior-focused element.

---

### Risk 4 — `Management.tsx` internal section state variable name

**Description:** The wiring instructions in §17 assume an `activeSection` state variable in `Management.tsx`. The actual variable name must be confirmed by reading the component before implementation.

**Mitigation:** Implementation step: read `Management.tsx` to identify the correct state variable. The `useEffect` pattern is otherwise identical regardless of the variable name.

---

### Risk 5 — "Get Help" disabled state on screens without a wired `setHelpContext`

**Description:** If a new authenticated screen is added to the app and its component does not call `setHelpContext`, the "Get Help" button will silently remain disabled on that screen. There is no compiler warning.

**Mitigation:** Document the wiring requirement in `CLAUDE.md` (the project's development guide) under a "Screen Registration" section. Add a `// TODO(help): set helpContext here` comment in the screen component template if one exists.

---

### Risk 6 — Accessibility: Focus trap implementation

**Description:** `HelpModal` requires a focus trap. Writing a correct, cross-browser focus trap from scratch is non-trivial (must handle all focusable element types, `tabindex`, `inert`, shadow DOM considerations).

**Mitigation:** Implement a minimal but correct focus trap using the `inert` attribute on the backdrop (setting `inert` on all elements outside the modal makes them unfocusable). `inert` is supported in all modern browsers as of 2023 and does not require a polyfill for the target audience (coaches with modern iOS/Android devices). Fallback: a `keydown` interceptor on the modal that wraps Tab/Shift+Tab focus manually. This is ~20 lines of code, well within scope.

---

### Open Question 1 — Should `helpContext` be surfaced to `BugReport`?

**Decision status:** Pending review

The `debugContext` (attached to bug reports) currently only comes from `GamePlanner`. Should bug reports automatically include `helpContext` (the current screen key) as part of the system info? 

**Recommendation:** Yes, as a low-effort addition. When `BugReport.tsx` builds the `systemInfo` object, it can read `helpContext` from `useHelpFab()` and include it as `currentScreen: helpContext ?? 'unknown'`. This gives developers more context about where a bug was reported from without requiring the coach to do anything.

---

### Open Question 2 — What happens when `helpContext` is set but `HELP_CONTENT[helpContext]` lookup fails?

**Decision status:** Recommendation accepted — implement defensive fallback

This should be impossible if TypeScript compilation succeeds (the `Record<HelpScreenKey, ...>` type guarantees all keys are present). However, at runtime after a partial deploy or cache mismatch, the lookup could theoretically return `undefined`.

**Recommendation:** `HelpModal` should include a defensive fallback:

```typescript
const content = HELP_CONTENT[helpContext];
if (!content) {
  // Render a generic "Help is not available for this screen yet" message
  // rather than throwing or showing an empty modal.
}
```

---

### Open Question 3 — Should `OnboardingOverlay` be shown again after a major version update?

**Decision status:** Pending review

The current design uses a versioned localStorage key (`teamtrack:onboarding-v1-seen`) to allow re-showing the onboarding when content is significantly updated. What constitutes a "major update" that warrants re-showing?

**Recommendation:** Increment the key version (to `v2`, `v3`) only when there are breaking workflow changes a returning coach must know about (e.g., a renamed tab, a removed feature, a new game status). Regular feature additions do not warrant re-showing onboarding. Increment intentionally with a product decision — not automatically on app version bumps.

---

*End of specification.*
