# TeamTrack Context-Specific Help — Phase 1 Implementation Plan

**Based on:** `docs/specs/HELP-CONTENT-SPEC.md` v1.0  
**Status:** Ready for implementation  
**Target:** Phase 1 only (Context-Aware Reference Help Modal)

---

## Table of Contents

1. [Implementation Order & Dependency Graph](#1-implementation-order--dependency-graph)
2. [File 1 — `src/help/types.ts` (NEW)](#2-file-1--srchelptstypes-ts-new)
3. [File 2 — `src/help/content.ts` (NEW)](#3-file-2--srchelptscontent-ts-new)
4. [File 3 — `src/help/index.ts` (NEW)](#4-file-3--srchelptindex-ts-new)
5. [File 4 — `src/contexts/HelpFabContext.tsx` (MODIFY)](#5-file-4--srccontextshelpfabcontexttsx-modify)
6. [File 5 — `src/components/HelpModal.tsx` (NEW)](#6-file-5--srccomponentshelpmodaltsx-new)
7. [File 6 — `src/components/HelpModal.css` (NEW)](#7-file-6--srccomponentshelpmodalcss-new)
8. [File 7 — `src/components/HelpFab.tsx` (MODIFY)](#8-file-7--srccomponentshelpfabtsx-modify)
9. [File 8 — `src/components/Home.tsx` (MODIFY)](#9-file-8--srccomponentshometsx-modify)
10. [File 9 — `src/components/GameManagement/GameManagement.tsx` (MODIFY)](#10-file-9--srccomponentsgamemanagementgamemanagementtsx-modify)
11. [File 10 — `src/components/GamePlanner.tsx` (MODIFY)](#11-file-10--srccomponentsgameplannertsx-modify)
12. [File 11 — `src/components/SeasonReport.tsx` (MODIFY)](#12-file-11--srccomponentsseasonreporttsx-modify)
13. [File 12 — `src/components/Management.tsx` (MODIFY)](#13-file-12--srccomponentsmanagementtsx-modify)
14. [File 13 — `src/components/UserProfile.tsx` (MODIFY)](#14-file-13--srccomponentsuserprofiletsx-modify)
15. [Test Coverage Plan](#15-test-coverage-plan)
16. [Edge Cases & Risk Mitigations](#16-edge-cases--risk-mitigations)
17. [Acceptance Criteria Checklist](#17-acceptance-criteria-checklist)

---

## 1. Implementation Order & Dependency Graph

Implement files **strictly in the order listed below**. Each layer depends on everything above it.

```
Layer 0 — Pure data, no imports from app
  └─ src/help/types.ts          (TypeScript types only)

Layer 1 — Content data, depends on Layer 0
  └─ src/help/content.ts        (HELP_CONTENT registry, imports types.ts)

Layer 2 — Barrel export, depends on Layer 0+1
  └─ src/help/index.ts          (re-exports types + content)

Layer 3 — Context extension, depends on Layer 0
  └─ src/contexts/HelpFabContext.tsx   (adds helpContext/setHelpContext)

Layer 4 — New UI component, depends on Layer 2
  ├─ src/components/HelpModal.tsx      (depends on src/help/index.ts)
  └─ src/components/HelpModal.css      (standalone, no dependencies)

Layer 5 — FAB wiring, depends on Layer 3 + 4
  └─ src/components/HelpFab.tsx        (adds openHelpAfterClose, HelpModal render)

Layer 6 — Screen wiring (all parallel after Layer 3), depends on Layer 3 only
  ├─ src/components/Home.tsx
  ├─ src/components/GameManagement/GameManagement.tsx
  ├─ src/components/GamePlanner.tsx
  ├─ src/components/SeasonReport.tsx
  ├─ src/components/Management.tsx
  └─ src/components/UserProfile.tsx
```

**Key constraints:**
- `HelpModal.tsx` must not be implemented until `src/help/index.ts` exists (it imports from it).
- `HelpFab.tsx` must not be modified until `HelpModal.tsx` exists and `HelpFabContext.tsx` is extended.
- All six screen wiring files can be done in any order; they only depend on Layer 3.
- Tests for each file are written immediately after the file is implemented (not batched at the end).

---

## 2. File 1 — `src/help/types.ts` (NEW)

### Purpose
Pure TypeScript type definitions. No React, no app imports. The single source of truth for the help system's data model.

### Complete file content

```typescript
/**
 * Identifies which help article to display.
 * One key per distinct screen context where help content differs meaningfully.
 *
 * GameManagement uses four keys — one per game state — because each state
 * surfaces different affordances and the coach's questions differ entirely.
 *
 * Management uses five keys — one per sub-section — because Teams setup help
 * is unrelated to Sharing/Permissions help.
 */
export type HelpScreenKey =
  // Home screen
  | 'home'
  // Game Management — four states derived from gameState.status
  | 'game-scheduled'
  | 'game-in-progress'
  | 'game-halftime'
  | 'game-completed'
  // Game Planner
  | 'game-planner'
  // Season Reports
  | 'season-reports'
  // Management — five sub-sections matching activeSection values
  | 'manage-teams'
  | 'manage-players'
  | 'manage-formations'
  | 'manage-sharing'
  | 'manage-app'
  // User Profile
  | 'profile';

/**
 * A single "How do I...?" task entry.
 * Displayed as a numbered list of steps under a bolded title.
 */
export interface HelpTask {
  /** e.g. "Make a substitution mid-game" */
  title: string;
  /** Ordered, imperative instructions. Max 6 steps per task. */
  steps: string[];
}

/**
 * A pro tip, shortcut, or important warning.
 * Displayed as a highlighted callout card with a green left border.
 */
export interface HelpTip {
  /** Plain text only. No markdown, no HTML. Keep under 80 characters. */
  text: string;
}

/**
 * The complete help article for one screen context.
 */
export interface ScreenHelpContent {
  /**
   * Display title in the modal header.
   * Should match the screen name as the coach sees it in the UI.
   */
  screenTitle: string;

  /**
   * 1–2 sentence plain-English description of what this screen is for.
   * Written for a first-time coach, not a developer.
   */
  overview: string;

  /**
   * "How do I...?" task entries. Each renders as a titled numbered step list.
   * Limit to 4 tasks per screen. Most common questions first.
   */
  tasks: HelpTask[];

  /**
   * Pro tips, shortcuts, or important warnings.
   * Limit to 3 per screen.
   */
  tips: HelpTip[];

  /**
   * Optional. Other screen keys a coach might need next.
   * Rendered as navigation affordances (pill buttons) at the bottom of the modal.
   * Max 2 related screens.
   */
  relatedScreens?: HelpScreenKey[];
}

/**
 * The complete registry of all help articles, keyed by HelpScreenKey.
 * TypeScript enforces that all 14 keys are present at compile time.
 * A missing key is a compiler error — not a runtime crash.
 */
export type HelpContentRegistry = Record<HelpScreenKey, ScreenHelpContent>;

/**
 * Onboarding content type (Phase 2 — defined here for type completeness).
 * Intentionally distinct from ScreenHelpContent: different shape, different trigger.
 * Used by OnboardingOverlay.tsx (not implemented in Phase 1).
 */
export interface OnboardingContent {
  headline: string;
  body: string;
  /** Max 4 features */
  features: Array<{ icon: string; label: string }>;
  ctaLabel: string;
}
```

### Acceptance criteria
- [ ] TypeScript compiles with zero errors
- [ ] `HelpScreenKey` union has exactly 14 members: `home`, `game-scheduled`, `game-in-progress`, `game-halftime`, `game-completed`, `game-planner`, `season-reports`, `manage-teams`, `manage-players`, `manage-formations`, `manage-sharing`, `manage-app`, `profile` — **note: that is 13 keys, not 14 — recount from spec §5: `home`(1) + 4 game keys(5) + `game-planner`(6) + `season-reports`(7) + 5 manage keys(12) + `profile`(13) = 13 total. The spec says 14 in §5 headline but lists 13 distinct values. Use the explicit list of values, not the count.**
- [ ] `HelpContentRegistry = Record<HelpScreenKey, ScreenHelpContent>` — omitting any key in `content.ts` is a TS error
- [ ] `OnboardingContent` is exported even though it is unused in Phase 1 (future-proofs Phase 2)
- [ ] No React imports, no app imports — this file is pure TypeScript interfaces

---

## 3. File 2 — `src/help/content.ts` (NEW)

### Purpose
The single HELP_CONTENT registry object. All 13 screen help articles authored in full prose. No logic — pure data.

### Structure

```typescript
import type { HelpContentRegistry } from './types';

export const HELP_CONTENT: HelpContentRegistry = {
  // ... all 13 keys
};
```

### Per-screen content requirements

Each article must satisfy the **Content Authoring Guidelines** from spec §6:

| Rule | Enforcement |
|------|-------------|
| `overview`: max 2 sentences, no jargon | Author review |
| `tasks`: max 4 per screen | Author review |
| Task `steps`: max 6 per task, imperative mood ("Tap X", "Select Y") | Author review |
| `tips`: max 3 per screen | Author review |
| No markdown, no HTML in strings | TypeScript `string` type has no enforcement; author discipline |
| No relative time references | Author review |
| `relatedScreens`: max 2 | TypeScript `HelpScreenKey[]` with max 2 entries — author review |

### Required content for all 13 keys

Below is the minimum content spec for each article. The **implementation author must write the full prose** — the bullets here define the required topics, not the final copy.

#### `'home'` — Games List
- **screenTitle:** `'Games List'`
- **overview:** What the home screen shows (games list by status)
- **tasks (up to 4):**
  1. Schedule a new game (5 steps: tap "+ Schedule New Game", pick team, enter opponent + date, toggle Home/Away, tap Create)
  2. Open an existing game (1 step: tap the game card)
  3. Delete a game (describe long-press or swipe-delete pattern if available, or navigate to game and use delete)
- **tips (up to 3):**
  - Active / in-progress games appear at the top
  - Completed games appear at the bottom, most recent first
- **relatedScreens:** `['game-scheduled', 'manage-teams']`

#### `'game-scheduled'` — Game Management — Pre-Game
- **screenTitle:** `'Game Management — Pre-Game'`
- **overview:** What this screen does before kick-off (roster availability, start game)
- **tasks:**
  1. Mark a player's availability (tap the availability chip, cycle through statuses)
  2. Understand availability statuses (Available / Absent / Late Arrival — explain Late Arrival especially)
  3. Open the Game Planner before the game (tap "Game Planner" button)
  4. Start the game (tap "Start Game")
- **tips:**
  - Setting availability before kick-off enables fair rotation calculations in the planner
  - Late Arrival players are included in rotation plans from their expected arrival time
- **relatedScreens:** `['game-planner', 'game-in-progress']`

#### `'game-in-progress'` — Game Management — In Progress
- **screenTitle:** `'Game Management — In Progress'`
- **overview:** Track the live game — manage the lineup, record goals, monitor rotations
- **tasks:**
  1. Make a substitution (Lineup tab → tap a position → select bench player → confirm)
  2. Record a goal (Goals tab → "+ Home Goal" or "+ Away Goal" → optionally select scorer)
  3. Log a player note — yellow card, red card, or gold star (Notes tab → tap the icon next to player name)
  4. Find the next player to substitute in (Bench tab — sorted by least play time)
- **tips:**
  - The rotation widget in the command band shows when the next planned rotation is due
  - Bench tab sorts automatically by least play time to guide fair rotation decisions
  - Pausing the timer during stoppages keeps play-time records accurate
- **relatedScreens:** `['game-planner', 'game-halftime']`

#### `'game-halftime'` — Game Management — Halftime
- **screenTitle:** `'Game Management — Halftime'`
- **overview:** Adjust the lineup for the second half before restarting
- **tasks:**
  1. Change a player's starting position for the second half (Lineup tab shows halftime lineup — drag or tap to swap)
  2. Understand the halftime lineup (it defaults to the second-half rotation from the planner, or the current lineup if no planner is set)
  3. Start the second half (tap "Start 2nd Half")
- **tips:**
  - Changes made to the lineup here do not affect play-time records from the first half
  - If the planner has a second-half rotation set, the halftime lineup is pre-populated from it
- **relatedScreens:** `['game-planner', 'game-in-progress']`

#### `'game-completed'` — Game Management — Completed
- **screenTitle:** `'Game Management — Completed'`
- **overview:** Review the final result and play-time summary for this game
- **tasks:**
  1. View play-time per player (play-time summary is shown on the completed game screen)
  2. Navigate to the full season report (tap "Season Report" or navigate via bottom nav)
- **tips:**
  - Play-time data from this game feeds the Season Report automatically
  - Completed games cannot be restarted; contact support if a game was ended in error
- **relatedScreens:** `['season-reports', 'home']`

#### `'game-planner'` — Game Planner
- **screenTitle:** `'Game Planner'`
- **overview:** Plan your rotation schedule before the game — set starting lineup, mark availability, and generate fair rotations
- **tasks:**
  1. Set the starting lineup (Lineup tab — drag players from the bench onto field positions)
  2. Set a player's availability for this game (Availability tab — tap the status chip)
  3. Generate a fair rotation plan (tap "Calculate Rotations" — the planner uses play-time fairness to distribute minutes)
  4. Copy a plan from a previous game (tap "Copy from Previous Game")
- **tips:**
  - The rotation interval (default 10 minutes) determines how often rotations happen per half
  - The planner accounts for Late Arrival players automatically
  - Changes to the plan here are reflected in the game-in-progress rotation widget
- **relatedScreens:** `['game-scheduled', 'game-in-progress']`

#### `'season-reports'` — Season Reports
- **screenTitle:** `'Season Reports'`
- **overview:** View cumulative play-time, goals, and statistics for every player across all completed games
- **tasks:**
  1. Read a player's season stats (find the player row — columns show play time, goals, assists, cards)
  2. Sort by a different column (tap the column header to sort)
  3. Filter by team (if you have multiple teams, use the team selector at the top)
- **tips:**
  - Only completed games are included in season totals
  - Gold stars and cards are tracked per game and summed here
- **relatedScreens:** `['game-completed', 'home']`

#### `'manage-teams'` — Management — Teams
- **screenTitle:** `'Management — Teams'`
- **overview:** Create and configure your teams, including half length and maximum players on field
- **tasks:**
  1. Create a new team (tap "+ Add Team", fill in name, half length, max players, assign a formation)
  2. Edit an existing team (tap the team name to expand, then tap "Edit")
  3. Delete a team (swipe the team row left, or tap Edit then Delete — caution: deletes all associated roster and games)
- **tips:**
  - Half length and max players on field affect the rotation planner's calculations
  - You can share a team with another coach from the Sharing tab
- **relatedScreens:** `['manage-formations', 'manage-sharing']`

#### `'manage-players'` — Management — Players
- **screenTitle:** `'Management — Players'`
- **overview:** Manage your player roster — add players, assign jersey numbers, and set preferred positions
- **tasks:**
  1. Add a new player (tap "+ Add Player", enter name and jersey number)
  2. Assign a player to a team (use the roster assignment section under the team)
  3. Set preferred positions for a player (expand the player, tap position chips to toggle)
  4. Remove a player from a team roster (swipe the roster entry left)
- **tips:**
  - Jersey numbers are used to sort players in the bench and lineup views
  - Preferred positions are used by the rotation planner when assigning positions
- **relatedScreens:** `['manage-teams', 'game-planner']`

#### `'manage-formations'` — Management — Formations
- **screenTitle:** `'Management — Formations'`
- **overview:** Create and manage field formations that define the positions available in the lineup
- **tasks:**
  1. Create a formation (tap "+ Add Formation", name it, add position slots)
  2. Assign a formation to a team (go to the Teams tab, edit the team, select the formation)
  3. Delete a formation (swipe left on the formation row — only possible if no team is using it)
- **tips:**
  - A formation defines the position names and field layout used in the Game Planner and live game
  - Built-in formation templates are available to start from common configurations
- **relatedScreens:** `['manage-teams', 'game-planner']`

#### `'manage-sharing'` — Management — Sharing & Permissions
- **screenTitle:** `'Management — Sharing & Permissions'`
- **overview:** Invite other coaches to view or co-manage your team
- **tasks:**
  1. Invite a coach to a team (tap "Invite Coach", enter their email, select the team)
  2. Check pending invitations you have sent (the invitations list shows status: pending / accepted)
  3. Accept or decline an invitation sent to you (go to your Profile — pending invitations appear there)
- **tips:**
  - Invited coaches can view game data but cannot delete the team or send further invitations
  - Invitations expire after 7 days if not accepted
- **relatedScreens:** `['manage-teams', 'profile']`

#### `'manage-app'` — Management — App Settings
- **screenTitle:** `'Management — App Settings'`
- **overview:** Configure app-wide preferences and view version information
- **tasks:**
  1. View the app version (shown at the bottom of this section)
  2. Report a bug (use the ? FAB button → "Report a Bug")
- **tips:**
  - App settings here affect all teams, not just one
- **relatedScreens:** `['profile']`

#### `'profile'` — User Profile
- **screenTitle:** `'Profile'`
- **overview:** Manage your account, change your password, accept team invitations, and sign out
- **tasks:**
  1. Change your password (fill in current password and new password, tap "Change Password")
  2. Accept a pending team invitation (pending invitations appear at the top of this screen)
  3. Sign out (tap "Sign Out" at the bottom)
  4. Delete your account (tap "Delete Account" — this is permanent and removes all your data)
- **tips:**
  - Pending team invitations from other coaches appear here, not in the Manage section
  - Deleting your account cannot be undone
- **relatedScreens:** `['manage-sharing']`

### Implementation notes for content.ts
- The `HelpContentRegistry` type on `HELP_CONTENT` means TypeScript will error if any key is missing or misspelled. Do not use `as HelpContentRegistry` type assertion — let the compiler infer it from the type annotation.
- Keep string values as plain text. No template literals, no concatenation — every value is a simple string literal.
- `relatedScreens` is `undefined` if not specified (TypeScript `?:` optional field). Do not use `[]` — use `undefined` by omitting the field.

---

## 4. File 3 — `src/help/index.ts` (NEW)

### Purpose
Barrel re-export so consumers import from `'../help'` rather than `'../help/types'` or `'../help/content'` directly.

### Complete file content

```typescript
export type {
  HelpScreenKey,
  ScreenHelpContent,
  HelpTask,
  HelpTip,
  HelpContentRegistry,
  OnboardingContent,
} from './types';

export { HELP_CONTENT } from './content';
```

### Acceptance criteria
- [ ] All 6 types exported
- [ ] `HELP_CONTENT` constant exported
- [ ] No default exports — named exports only (consistent with rest of codebase)

---

## 5. File 4 — `src/contexts/HelpFabContext.tsx` (MODIFY)

### Current state (read from source)
- Exports: `HelpFabProvider`, `useHelpFab`
- Context value interface: `{ debugContext: string | null; setDebugContext: (ctx: string | null) => void }`
- Provider state: single `useState<string | null>(null)` for `debugContext`

### Required changes

**1. Add import for `HelpScreenKey` type:**
```typescript
import type { HelpScreenKey } from '../help/types';
```
> Import from `'../help/types'` (not from `'../help'`) to avoid a circular dependency at the barrel level — `HelpFabContext` is referenced by screen components, which are not in the `help/` directory.

**2. Extend the interface:**
```typescript
interface HelpFabContextValue {
  // Existing — unchanged
  debugContext: string | null;
  setDebugContext: (ctx: string | null) => void;

  // New
  // null  → no screen has registered a context; "Get Help" stays disabled
  // key   → active screen registered; "Get Help" becomes active
  helpContext: HelpScreenKey | null;
  setHelpContext: (key: HelpScreenKey | null) => void;
}
```

**3. Add second useState in provider:**
```typescript
export function HelpFabProvider({ children }: HelpFabProviderProps) {
  const [debugContext, setDebugContext] = useState<string | null>(null);
  const [helpContext, setHelpContext] = useState<HelpScreenKey | null>(null);  // NEW

  return (
    <HelpFabContext.Provider value={{ debugContext, setDebugContext, helpContext, setHelpContext }}>
      {children}
    </HelpFabContext.Provider>
  );
}
```

**4. No changes to `useHelpFab`** — it returns the full context value, which now includes the new fields automatically.

### What does NOT change
- `useHelpFab` hook signature and guard
- `debugContext` / `setDebugContext` behavior
- Provider tree structure
- Existing callers (`HelpFab.tsx`, `GamePlanner.tsx`) — they only use the fields they destructure

### Acceptance criteria
- [ ] TypeScript compiles — `HelpFabContextValue` is satisfied by the provider's value object
- [ ] `debugContext` and `helpContext` are independent state variables (setting one does not affect the other)
- [ ] `useHelpFab()` throws if called outside `HelpFabProvider` (existing guard unchanged)
- [ ] Existing `GamePlanner.tsx` which calls `const { setDebugContext } = useHelpFab()` continues to compile and work without modification

---

## 6. File 5 — `src/components/HelpModal.tsx` (NEW)

### Purpose
A dialog modal that displays a `ScreenHelpContent` article looked up by `HelpScreenKey`. Opened by `HelpFab` after the bottom-sheet close animation completes. Stateless beyond props.

### Props interface
```typescript
interface HelpModalProps {
  helpContext: HelpScreenKey;
  onClose: () => void;
  onNavigate?: (key: HelpScreenKey) => void; // Phase 1: optional, closes modal only
}
```

### Internal structure (DOM tree)
```
<div className="help-modal-overlay" onClick={onClose}>           ← backdrop
  <div
    className="help-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="help-modal-title"
    onClick={(e) => e.stopPropagation()}
  >
    <div className="help-modal-header">
      <h2
        id="help-modal-title"
        ref={headingRef}
        tabIndex={-1}                                            ← focusable but not in tab order
        className="help-modal-title"
      >
        {content.screenTitle}
      </h2>
      <button
        className="help-modal-close"
        onClick={onClose}
        aria-label="Close help"
        type="button"
      >✕</button>
    </div>

    <div
      className="help-modal-body"
      role="region"
      aria-label="Help content"
      tabIndex={0}                                               ← keyboard scrollable
    >
      <p className="help-modal-overview">{content.overview}</p>

      {content.tasks.length > 0 && (
        <section className="help-modal-section">
          <h3 className="help-modal-section-heading">How to…</h3>
          {content.tasks.map((task, i) => (
            <div key={i} className="help-task">
              <p className="help-task-title">{task.title}</p>
              <ol className="help-task-steps">
                {task.steps.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}

      {content.tips.length > 0 && (
        <section className="help-modal-section">
          <h3 className="help-modal-section-heading">Tips</h3>
          {content.tips.map((tip, i) => (
            <div key={i} className="help-tip-card">
              {tip.text}
            </div>
          ))}
        </section>
      )}

      {content.relatedScreens && content.relatedScreens.length > 0 && (
        <section className="help-modal-section">
          <h3 className="help-modal-section-heading">You might also need</h3>
          <div className="help-related-screens">
            {content.relatedScreens.map((key) => (
              <button
                key={key}
                type="button"
                className="help-related-pill"
                onClick={() => {
                  onNavigate ? onNavigate(key) : onClose();
                }}
              >
                {HELP_CONTENT[key].screenTitle}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  </div>
</div>
```

### useEffect hooks required

**Focus on open (accessibility):**
```typescript
const headingRef = useRef<HTMLHeadingElement>(null);
const previousFocusRef = useRef<Element | null>(null);

useEffect(() => {
  // Capture element that had focus before modal opened (for restoration on close)
  previousFocusRef.current = document.activeElement;
  // Move focus into modal
  headingRef.current?.focus();

  // Restore focus on cleanup (modal close)
  return () => {
    if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
    }
  };
}, []);
```

**Escape key:**
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [onClose]);
```

**Focus trap:**
```typescript
useEffect(() => {
  const modal = modalRef.current;
  if (!modal) return;

  const focusableSelectors = [
    'button:not(:disabled)',
    '[href]',
    'input:not(:disabled)',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: wrap from first to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: wrap from last to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  modal.addEventListener('keydown', handleKeyDown);
  return () => modal.removeEventListener('keydown', handleKeyDown);
}, []);
```
> Attach `modalRef` to the `.help-modal` div. The heading's `tabIndex={-1}` means it is focusable (receives focus on open) but is NOT in the trap's cycle — the trap cycles between the close button and related-screen pills only. This is correct: the heading is only programmatically focused on open.

**Defensive content fallback:**
```typescript
const content = HELP_CONTENT[helpContext];

if (!content) {
  // Should be impossible with correct TypeScript types, but guard against
  // runtime mismatches (partial deploys, cache mismatch).
  return (
    <div className="help-modal-overlay" onClick={onClose}>
      <div className="help-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="help-modal-header">
          <h2 id="help-modal-title" className="help-modal-title">Help</h2>
          <button className="help-modal-close" onClick={onClose} aria-label="Close help" type="button">✕</button>
        </div>
        <div className="help-modal-body">
          <p>Help content is not available for this screen yet.</p>
        </div>
      </div>
    </div>
  );
}
```

### Required imports
```typescript
import { useEffect, useRef } from 'react';
import { HELP_CONTENT } from '../help';
import type { HelpScreenKey } from '../help';
import './HelpModal.css';
```

### Acceptance criteria
- [ ] `role="dialog"`, `aria-modal="true"`, `aria-labelledby="help-modal-title"` present
- [ ] `<h2>` has `id="help-modal-title"` and `tabIndex={-1}`
- [ ] Focus moves to `<h2>` on mount
- [ ] Focus is restored to previously focused element on close (ref capture in `useEffect`)
- [ ] Escape key calls `onClose`
- [ ] Backdrop click calls `onClose`; click inside modal card does not
- [ ] Focus trap: Tab/Shift+Tab cycle within modal interactive elements
- [ ] `content.tasks.length === 0` → tasks section is not rendered (empty array guard)
- [ ] `content.tips.length === 0` → tips section is not rendered
- [ ] `content.relatedScreens` is `undefined` → related section is not rendered
- [ ] Defensive fallback renders "Help content is not available for this screen yet." when `HELP_CONTENT[helpContext]` is falsy
- [ ] Related screen pill click calls `onNavigate(key)` when `onNavigate` is provided, else calls `onClose()`
- [ ] Component is stateless (no useState calls)

---

## 7. File 6 — `src/components/HelpModal.css` (NEW)

### Design tokens to use (from `src/index.css`)
| Token | Value |
|-------|-------|
| `--primary-green` | `#1a472a` |
| `--accent-green` | `#4caf50` |
| `--text-primary` | `#212121` |
| `--text-secondary` | `#757575` |
| `--border-color` | `#e0e0e0` |
| `--hover-background` | `#f0f0f0` |
| `--card-background` | `#ffffff` |

### Required classes and their specifications

```css
/* Backdrop overlay — same pattern as .bug-report-overlay and .confirm-overlay */
.help-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);   /* Slightly darker than sheet's 0.3 — modal is full-screen */
  z-index: 1000;                     /* Same layer as BugReport and ConfirmModal */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

/* Modal card */
.help-modal {
  background: var(--card-background);
  border-radius: 12px;
  width: min(95vw, 480px);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;                  /* Children handle their own overflow */
  animation: helpModalFadeIn 200ms ease-out;
  will-change: transform, opacity;
}

/* Entrance animation */
@keyframes helpModalFadeIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Sticky header inside the card */
.help-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;                    /* Header does not scroll away */
}

.help-modal-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  /* tabIndex={-1} means this receives programmatic focus — no visible focus ring needed
     unless the coach uses keyboard navigation, in which case the default outline is fine */
}

.help-modal-title:focus {
  outline: none;                     /* Focus is programmatic-only on open; not user-initiated */
}

/* Close button (top-right ✕) */
.help-modal-close {
  background: none;
  border: none;
  font-size: 1rem;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1;
  flex-shrink: 0;
  font-family: inherit;
}

.help-modal-close:hover {
  background: var(--hover-background);
  color: var(--text-primary);
}

/* Scrollable body — everything below the header */
.help-modal-body {
  overflow-y: auto;
  padding: 16px 20px 20px;
  flex: 1;
}

/* Overview paragraph */
.help-modal-overview {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0 0 16px;
}

/* Section container (tasks, tips, related) */
.help-modal-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

/* Section heading — "How to…", "Tips", "You might also need" */
.help-modal-section-heading {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin: 0 0 12px;
}

/* Individual task block */
.help-task {
  margin-bottom: 16px;
}

.help-task:last-child {
  margin-bottom: 0;
}

/* Task title — bold label ("Make a substitution") */
.help-task-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-primary);
  margin: 0 0 6px;
}

/* Numbered steps list */
.help-task-steps {
  margin: 0;
  padding-left: 20px;
  color: var(--text-primary);
  font-size: 0.9rem;
  line-height: 1.6;
}

.help-task-steps li {
  margin-bottom: 4px;
}

/* Tip callout card — green-tinted, left border accent */
.help-tip-card {
  background: rgba(76, 175, 80, 0.08);     /* --accent-green at 8% opacity */
  border-left: 3px solid var(--accent-green);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 0.9rem;
  color: var(--text-primary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.help-tip-card:last-child {
  margin-bottom: 0;
}

/* Related screens — pill buttons row */
.help-related-screens {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.help-related-pill {
  border: 1px solid var(--border-color);
  border-radius: 20px;
  background: none;
  padding: 6px 14px;
  font-size: 0.85rem;
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.help-related-pill:hover {
  background: var(--hover-background);
  border-color: var(--primary-green);
}

/* Reduced motion — mirrors HelpFab.css pattern exactly */
@media (prefers-reduced-motion: reduce) {
  .help-modal {
    animation-duration: 0.001ms;
  }
}
```

### Acceptance criteria
- [ ] Modal card is `min(95vw, 480px)` wide, `max-height: 85vh`
- [ ] Header does not scroll (sticky via `flex-shrink: 0`)
- [ ] Body scrolls independently (`overflow-y: auto; flex: 1`)
- [ ] Tip cards have `rgba(76, 175, 80, 0.08)` background and `3px solid var(--accent-green)` left border
- [ ] `z-index: 1000` on overlay (matches `BugReport` and `ConfirmModal`)
- [ ] `@media (prefers-reduced-motion: reduce)` block present, sets `animation-duration: 0.001ms`
- [ ] No hardcoded hex colors except the tip card RGBA (use CSS variables for all others)

---

## 8. File 7 — `src/components/HelpFab.tsx` (MODIFY)

### Current state (read from source)
- Imports: `useState`, `useEffect`, `useRef`, `BugReport`, `useHelpFab`, `HelpFab.css`
- Context destructure: `const { debugContext } = useHelpFab()`
- Ref: `openBugReportAfterClose`
- State: `sheetOpen`, `isClosing`, `bugReportOpen`
- Two places where `openBugReportAfterClose.current` is checked: in `handleAnimationEnd` and the `setTimeout` fallback in `closeSheet`

### Required changes — detailed diff

**Change 1: Extend imports**
```typescript
// BEFORE:
import { BugReport } from './BugReport';
import { useHelpFab } from '../contexts/HelpFabContext';

// AFTER:
import { BugReport } from './BugReport';
import { HelpModal } from './HelpModal';           // NEW
import { useHelpFab } from '../contexts/HelpFabContext';
```

**Change 2: Extend context destructure**
```typescript
// BEFORE:
const { debugContext } = useHelpFab();

// AFTER:
const { debugContext, helpContext } = useHelpFab();
```

**Change 3: Add new state and ref**
```typescript
// ADD after the existing openBugReportAfterClose ref:
const [helpModalOpen, setHelpModalOpen] = useState(false);          // NEW state
const openHelpAfterClose = useRef(false);                           // NEW ref — mirrors openBugReportAfterClose
```

**Change 4: Update `closeSheet` setTimeout fallback**

The `setTimeout` block in `closeSheet` currently reads:
```typescript
setTimeout(() => {
  setSheetOpen(false);
  setIsClosing(false);
  if (openBugReportAfterClose.current) {
    openBugReportAfterClose.current = false;
    setBugReportOpen(true);
  }
}, 300);
```

Must become:
```typescript
setTimeout(() => {
  setSheetOpen(false);
  setIsClosing(false);
  if (openBugReportAfterClose.current) {
    openBugReportAfterClose.current = false;
    setBugReportOpen(true);
  }
  if (openHelpAfterClose.current) {             // NEW block — same pattern
    openHelpAfterClose.current = false;
    setHelpModalOpen(true);
  }
}, 300);
```

**Change 5: Update `handleAnimationEnd`**

Currently:
```typescript
if (isClosing) {
  setSheetOpen(false);
  setIsClosing(false);
  if (openBugReportAfterClose.current) {
    openBugReportAfterClose.current = false;
    setBugReportOpen(true);
  }
}
```

Must become:
```typescript
if (isClosing) {
  setSheetOpen(false);
  setIsClosing(false);
  if (openBugReportAfterClose.current) {
    openBugReportAfterClose.current = false;
    setBugReportOpen(true);
  }
  if (openHelpAfterClose.current) {             // NEW block
    openHelpAfterClose.current = false;
    setHelpModalOpen(true);
  }
}
```

**Change 6: Add `handleOpenHelp` function**
```typescript
// ADD after handleOpenBugReport:
function handleOpenHelp() {
  openHelpAfterClose.current = true;
  closeSheet();
}
```

**Change 7: Replace the disabled "Get Help" button**

Remove:
```tsx
<button
  className="help-fab-sheet-option help-fab-sheet-option--disabled"
  role="menuitem"
  aria-disabled="true"
  disabled
  type="button"
>
  <span className="help-fab-sheet-option__icon">📖</span>
  <div>
    <span className="help-fab-sheet-option__label">Get Help</span>
    <span className="help-fab-sheet-option__subtitle">Coming soon</span>
  </div>
</button>
```

Replace with:
```tsx
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

**Change 8: Add HelpModal render** (after the existing BugReport render block)
```tsx
{helpModalOpen && helpContext && (
  <HelpModal
    helpContext={helpContext}
    onClose={() => setHelpModalOpen(false)}
  />
)}
```

> `onNavigate` is intentionally omitted in Phase 1. The prop is optional in `HelpModalProps`.

### What does NOT change
- The FAB button (`?`) and its `aria-label`
- The backdrop and sheet DOM structure
- The `openBugReportAfterClose` pattern and `BugReport` render
- The Escape key handler
- The focus-to-first-item `useEffect`
- `HelpFab.css` — no new CSS needed; existing `.help-fab-sheet-option--disabled` covers the conditional disabled state

### Acceptance criteria
- [ ] `helpModalOpen` state initializes to `false`
- [ ] "Get Help" button is enabled (no `disabled` attribute, no `--disabled` class) when `helpContext` is non-null
- [ ] "Get Help" button is disabled when `helpContext` is `null`
- [ ] "Coming soon" subtitle is visible only when `helpContext` is `null`
- [ ] `handleOpenHelp` sets `openHelpAfterClose.current = true` and calls `closeSheet()`
- [ ] Both the `setTimeout` fallback and `handleAnimationEnd` check `openHelpAfterClose.current`
- [ ] Both checks reset `openHelpAfterClose.current = false` before calling `setHelpModalOpen(true)` (prevents double-open)
- [ ] `HelpModal` renders when `helpModalOpen && helpContext` is truthy
- [ ] `HelpModal` does not render when `helpModalOpen` is `false`
- [ ] `BugReport` behavior is completely unchanged — `openBugReportAfterClose` logic is untouched
- [ ] TypeScript compiles — no `any` introduced

---

## 9. File 8 — `src/components/Home.tsx` (MODIFY)

### Confirmed context from source
- Component: `export function Home()`
- Existing imports: `useState`, `useEffect`, `useNavigate`, AWS Amplify imports, local types/utils
- No existing `useHelpFab` usage

### Required changes

**Add import:**
```typescript
import { useHelpFab } from '../contexts/HelpFabContext';
```

**Add inside the `Home` function body, near the top (after existing hook calls):**
```typescript
const { setHelpContext } = useHelpFab();

useEffect(() => {
  setHelpContext('home');
  return () => setHelpContext(null);
}, [setHelpContext]);
```

> Place this `useEffect` immediately after the `useAmplifyQuery` calls, before any event handler functions. This keeps it grouped with the other initialization effects.

### Acceptance criteria
- [ ] `setHelpContext('home')` is called on mount
- [ ] `setHelpContext(null)` is called on unmount
- [ ] No other changes to Home.tsx

---

## 10. File 9 — `src/components/GameManagement/GameManagement.tsx` (MODIFY)

### Confirmed context from source
- Component: `export function GameManagement({ game, team, onBack }: GameManagementProps)`
- `gameState` comes from `useGameSubscriptions` hook: `const { gameState, ... } = useGameSubscriptions(...)`
- `gameState.status` is a string from the database
- No existing `useHelpFab` usage

### Required changes

**Add imports:**
```typescript
import { useHelpFab } from '../../contexts/HelpFabContext';
import type { HelpScreenKey } from '../../help/types';
```

**Add inside `GameManagement` function body, after `const { gameState, ... } = useGameSubscriptions(...)`:**
```typescript
const { setHelpContext } = useHelpFab();

// Map game status → help key. Reactive: re-runs when game status transitions.
useEffect(() => {
  const statusToHelpKey: Partial<Record<string, HelpScreenKey>> = {
    'scheduled':   'game-scheduled',
    'in-progress': 'game-in-progress',
    'halftime':    'game-halftime',
    'completed':   'game-completed',
  };
  const key = statusToHelpKey[gameState.status];
  if (key) setHelpContext(key);
  return () => setHelpContext(null);
}, [gameState.status, setHelpContext]);
```

### Why `Partial<Record<string, HelpScreenKey>>`
`gameState.status` is a database string, not a TypeScript enum. Before the first subscription delivery, it may be `undefined` or an unrecognised value. `Partial` + `if (key)` guard keeps the help button disabled (rather than crashing) until a known status is confirmed.

### Existing tests: `GameManagement.test.tsx` impact
The existing test file mocks `useGameSubscriptions` (which provides `gameState`) and does not mock `HelpFabContext`. **After this change, `GameManagement.tsx` calls `useHelpFab()`, which requires a `HelpFabProvider` ancestor.** The existing tests will throw:
```
Error: useHelpFab must be used within a HelpFabProvider
```
**Resolution:** Add a mock for `HelpFabContext` to `GameManagement.test.tsx`:
```typescript
vi.mock('../../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({ setHelpContext: vi.fn(), helpContext: null, debugContext: null, setDebugContext: vi.fn() }),
}));
```
This must be added to the existing test file as part of this change. See §15 for the full test plan.

### Acceptance criteria
- [ ] `setHelpContext` is called reactively when `gameState.status` changes
- [ ] `setHelpContext(null)` is called on unmount (returned from effect)
- [ ] Unknown / undefined `gameState.status` silently keeps help disabled (no crash)
- [ ] Existing `GameManagement.test.tsx` tests continue to pass after adding the mock

---

## 11. File 10 — `src/components/GamePlanner.tsx` (MODIFY)

### Confirmed context from source
- Component: `export function GamePlanner({ game, team, onBack }: GamePlannerProps)`
- **Already imports and uses `useHelpFab`:**
  ```typescript
  import { useHelpFab } from '../contexts/HelpFabContext';
  ```
  And destructures: `const { setDebugContext } = useHelpFab();` (for debug snapshot)
- Has an existing `useEffect` that calls `setDebugContext` whenever debug-relevant state changes

### Required changes

**Extend the existing `useHelpFab` destructure:**
```typescript
// BEFORE:
const { setDebugContext } = useHelpFab();

// AFTER:
const { setDebugContext, setHelpContext } = useHelpFab();
```

**Add a new `useEffect` for the help context (separate from the existing debug effect):**
```typescript
// Add after the existing setDebugContext effect
useEffect(() => {
  setHelpContext('game-planner');
  return () => setHelpContext(null);
}, [setHelpContext]);
```

> The spec is explicit: add `setHelpContext` as a **separate** `useEffect`, not merged into the existing debug snapshot effect. The two effects have different dependency arrays and different cleanup semantics.

### Acceptance criteria
- [ ] `setHelpContext('game-planner')` is called on mount
- [ ] `setHelpContext(null)` is called on unmount
- [ ] The existing `setDebugContext` effect and its dependencies are unchanged
- [ ] The two effects remain separate

---

## 12. File 11 — `src/components/SeasonReport.tsx` (MODIFY)

### Confirmed context from source
- Component: `interface TeamReportProps { team: Team }` — the main report component appears to be `TeamReport` (or similar) exported from this file, not named `SeasonReport`
- **Action required before implementing:** Read lines 30–60 of `SeasonReport.tsx` to confirm the exported function name
- No existing `useHelpFab` usage

### Required changes

**Add import:**
```typescript
import { useHelpFab } from '../contexts/HelpFabContext';
```

**Add inside the component function body:**
```typescript
const { setHelpContext } = useHelpFab();

useEffect(() => {
  setHelpContext('season-reports');
  return () => setHelpContext(null);
}, [setHelpContext]);
```

> **Important:** If `SeasonReport.tsx` exports multiple components (e.g., a `SeasonReportRoute` wrapper and a `SeasonReport` inner component), add the effect to the **inner component** that represents the actual screen view — not the route wrapper. Route wrappers do not register screen context per spec §17.

### Acceptance criteria
- [ ] `setHelpContext('season-reports')` is called on mount of the screen component
- [ ] `setHelpContext(null)` is called on unmount

---

## 13. File 12 — `src/components/Management.tsx` (MODIFY)

### Confirmed context from source (lines 118)
```typescript
const [activeSection, setActiveSection] = useState<'teams' | 'formations' | 'players' | 'sharing' | 'app'>('teams');
```
The variable name is **`activeSection`** — confirmed. The type union is `'teams' | 'formations' | 'players' | 'sharing' | 'app'`. Default is `'teams'`.

### Required changes

**Add imports:**
```typescript
import { useHelpFab } from '../contexts/HelpFabContext';
import type { HelpScreenKey } from '../help/types';
```

**Add inside `Management` function body, after the `activeSection` useState declaration:**
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

> Note: `?? 'manage-teams'` is a safety fallback. Because `activeSection` is TypeScript-typed as the exact union, and the `Record` covers all members exhaustively, the `??` fallback will never actually be reached — but it satisfies the compiler without requiring a non-null assertion.

### Acceptance criteria
- [ ] `setHelpContext` is called reactively whenever `activeSection` changes
- [ ] On the Teams tab: `setHelpContext('manage-teams')`
- [ ] On the Formations tab: `setHelpContext('manage-formations')`
- [ ] On the Players tab: `setHelpContext('manage-players')`
- [ ] On the Sharing tab: `setHelpContext('manage-sharing')`
- [ ] On the App tab: `setHelpContext('manage-app')`
- [ ] `setHelpContext(null)` is called on unmount

---

## 14. File 13 — `src/components/UserProfile.tsx` (MODIFY)

### Confirmed context from source
- Component: `export function UserProfile()`
- Existing imports: `useState`, `useEffect`, `useAuthenticator`, `useOutletContext`, AWS Auth imports, types
- No existing `useHelpFab` usage

### Required changes

**Add import:**
```typescript
import { useHelpFab } from '../contexts/HelpFabContext';
```

**Add inside `UserProfile` function body:**
```typescript
const { setHelpContext } = useHelpFab();

useEffect(() => {
  setHelpContext('profile');
  return () => setHelpContext(null);
}, [setHelpContext]);
```

### Acceptance criteria
- [ ] `setHelpContext('profile')` is called on mount
- [ ] `setHelpContext(null)` is called on unmount

---

## 15. Test Coverage Plan

### Testing stack (confirmed from codebase)
- **Runner:** Vitest with `jsdom` environment
- **Assertions:** `@testing-library/jest-dom/vitest`
- **Render:** `@testing-library/react`
- **User interaction:** `@testing-library/user-event`
- **Mock framework:** `vi.mock`, `vi.hoisted`, `vi.fn()`
- **Setup file:** `src/test/setup.ts` (runs `cleanup` after each test)

---

### Test File 1 — `src/help/content.test.ts` (NEW)

**Path:** `src/help/content.test.ts` (plain TypeScript, no JSX)

**What to test:**

```typescript
import { describe, it, expect } from 'vitest';
import { HELP_CONTENT } from './content';
import type { HelpScreenKey } from './types';

const ALL_KEYS: HelpScreenKey[] = [
  'home', 'game-scheduled', 'game-in-progress', 'game-halftime', 'game-completed',
  'game-planner', 'season-reports', 'manage-teams', 'manage-players',
  'manage-formations', 'manage-sharing', 'manage-app', 'profile',
];
```

**Test cases:**

| Test | Description |
|------|-------------|
| All 13 keys present | `ALL_KEYS.forEach(key => expect(HELP_CONTENT[key]).toBeDefined())` |
| Each entry has a non-empty screenTitle | `expect(typeof HELP_CONTENT[key].screenTitle).toBe('string')` and `expect(HELP_CONTENT[key].screenTitle.length).toBeGreaterThan(0)` |
| Each entry has a non-empty overview | same pattern |
| Each entry has at least 1 task | `expect(HELP_CONTENT[key].tasks.length).toBeGreaterThanOrEqual(1)` |
| Each task has at least 1 step | for each task: `expect(task.steps.length).toBeGreaterThanOrEqual(1)` |
| Each entry has at least 1 tip | `expect(HELP_CONTENT[key].tips.length).toBeGreaterThanOrEqual(1)` |
| Max tasks constraint (4) | `expect(HELP_CONTENT[key].tasks.length).toBeLessThanOrEqual(4)` |
| Max tips constraint (3) | `expect(HELP_CONTENT[key].tips.length).toBeLessThanOrEqual(3)` |
| Max related screens (2) | `if (relatedScreens) expect(relatedScreens.length).toBeLessThanOrEqual(2)` |
| Related screen keys are valid | related screen keys exist in `ALL_KEYS` |
| No empty step strings | `task.steps.every(s => s.trim().length > 0)` |
| No empty tip text | `content.tips.every(t => t.text.trim().length > 0)` |

> These tests enforce the content authoring guidelines at the data level, guarding against accidentally empty strings or violated constraints.

---

### Test File 2 — `src/components/HelpModal.test.tsx` (NEW)

**Path:** `src/components/HelpModal.test.tsx`

**Mock strategy:** `vi.mock('../help', ...)` to inject controlled content. Do NOT test against the real `HELP_CONTENT` — that is `content.test.ts`'s job.

```typescript
vi.mock('../help', () => ({
  HELP_CONTENT: {
    'home': {
      screenTitle: 'Games List',
      overview: 'This is the home screen.',
      tasks: [
        { title: 'Schedule a game', steps: ['Tap the button.', 'Fill the form.'] },
      ],
      tips: [{ text: 'Active games appear first.' }],
      relatedScreens: ['game-scheduled'],
    },
    'game-scheduled': {
      screenTitle: 'Game — Pre-Game',
      overview: 'Pre-game screen.',
      tasks: [{ title: 'Mark availability', steps: ['Tap a player.'] }],
      tips: [{ text: 'Set availability before kick-off.' }],
      relatedScreens: undefined,
    },
    // Minimal entries for the rest of the keys (to satisfy Record<HelpScreenKey, ...>)
    // ... can use a simple object spread or a helper
  },
}));
```

**Test cases:**

| Test | What it verifies |
|------|-----------------|
| Renders `screenTitle` in heading | `getByRole('heading', { name: 'Games List' })` |
| Renders `overview` text | `getByText('This is the home screen.')` |
| Renders task title | `getByText('Schedule a game')` |
| Renders task steps | `getByText('Tap the button.')` |
| Renders tip text | `getByText('Active games appear first.')` |
| Renders related screen pill | `getByRole('button', { name: 'Game — Pre-Game' })` |
| Does NOT render related section when `relatedScreens` is undefined | render `'game-scheduled'` (no relatedScreens) → `queryByText('You might also need')` is null |
| `onClose` called on backdrop click | `userEvent.click(overlay element)` → `onClose` spy called |
| `onClose` NOT called on modal card click | `userEvent.click(modal card)` → `onClose` not called |
| `onClose` called on Escape key | `userEvent.keyboard('{Escape}')` → `onClose` called |
| Close button calls `onClose` | `userEvent.click(getByRole('button', { name: 'Close help' }))` → called |
| `role="dialog"` attribute present | `getByRole('dialog')` |
| `aria-modal="true"` present | `getByRole('dialog').toHaveAttribute('aria-modal', 'true')` |
| `aria-labelledby` links to `h2` id | modal div has `aria-labelledby="help-modal-title"`, h2 has `id="help-modal-title"` |
| Focus moves to heading on mount | `expect(document.activeElement).toBe(getByRole('heading', ...))` after render |
| `onNavigate` called with related screen key when pill clicked | pill click → spy called with `'game-scheduled'` |
| Fallback renders when content is missing | Override mock to return `undefined` for a key; verify "not available" message |

**Note on focus trap testing:** Focus trap behavior (Tab/Shift+Tab cycling) is difficult to test in jsdom because `userEvent.tab()` does not respect `tabIndex` fully. Test the trap handler logic with a keyboard event dispatch rather than relying on full tab simulation.

---

### Test File 3 — `src/contexts/HelpFabContext.test.tsx` (NEW)

**Path:** `src/contexts/HelpFabContext.test.tsx`

**Test cases:**

| Test | What it verifies |
|------|-----------------|
| `useHelpFab` throws outside provider | Render a component that calls `useHelpFab()` without `HelpFabProvider` → `expect(() => render(...)).toThrow('useHelpFab must be used within a HelpFabProvider')` |
| Initial `helpContext` is `null` | Render with provider → `helpContext` is `null` |
| `setHelpContext` updates `helpContext` | Call `setHelpContext('home')` → `helpContext` becomes `'home'` |
| `setHelpContext(null)` clears `helpContext` | Set then clear → `helpContext` returns to `null` |
| `debugContext` is independent from `helpContext` | Set `helpContext('home')` → `debugContext` remains `null` |
| Set both simultaneously | Set `debugContext('debug data')` AND `setHelpContext('home')` → both values are correct independently |
| `setHelpContext` is stable between renders | Ref equality check: `setHelpContext` from two renders is the same function reference (confirming useState setter stability) |

---

### Test File 4 — `src/components/HelpFab.test.tsx` (NEW or EXTEND)

**Check if `HelpFab.test.tsx` already exists.** If it does, extend it. If not, create it.

**Mock strategy:**
```typescript
vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: vi.fn(),
}));
vi.mock('./BugReport', () => ({ BugReport: () => <div data-testid="bug-report" /> }));
vi.mock('./HelpModal', () => ({ HelpModal: (props: any) => <div data-testid="help-modal" data-context={props.helpContext} /> }));
```

**Helper:**
```typescript
function mockHelpFab({ helpContext = null, debugContext = null } = {}) {
  (useHelpFab as ReturnType<typeof vi.fn>).mockReturnValue({
    helpContext,
    debugContext,
    setHelpContext: vi.fn(),
    setDebugContext: vi.fn(),
  });
}
```

**Test cases:**

| Test | What it verifies |
|------|-----------------|
| "Get Help" button is disabled when `helpContext` is `null` | `getByRole('menuitem', { name: /Get Help/ })` has `disabled` attribute |
| "Get Help" shows "Coming soon" subtitle when `helpContext` is `null` | `getByText('Coming soon')` present |
| "Get Help" button is enabled when `helpContext` is `'home'` | button does NOT have `disabled` attribute |
| "Coming soon" subtitle hidden when `helpContext` is set | `queryByText('Coming soon')` is null |
| "Get Help" click opens HelpModal (via animation) | Click "Get Help" → eventually `getByTestId('help-modal')` appears |
| HelpModal receives correct `helpContext` prop | `getByTestId('help-modal').dataset.context === 'home'` |
| HelpModal closes when `onClose` is called | `HelpModal` mock calls `props.onClose()` → modal disappears |
| "Report a Bug" click opens BugReport (unchanged behavior) | Click "Report a Bug" → eventually `getByTestId('bug-report')` appears |
| BugReport opens even when `helpContext` is set | Both paths work simultaneously |
| Sheet closes on backdrop click | Click backdrop → sheet disappears |
| Sheet closes on Escape key | Press Escape → sheet disappears |

> The animation-dependent open sequence (the `openHelpAfterClose` ref + setTimeout/animationend) makes direct timing tests fragile in jsdom. Use `vi.useFakeTimers()` to advance timers past the 300ms fallback, then assert modal presence.

---

### Test File 5 — `src/components/GameManagement/GameManagement.test.tsx` (MODIFY)

**Required addition** (not a new file — add to existing test):

```typescript
// Add to the vi.mock block:
vi.mock('../../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    setHelpContext: vi.fn(),
    helpContext: null,
    debugContext: null,
    setDebugContext: vi.fn(),
  }),
}));
```

**New test cases to add to the existing describe block:**

| Test | What it verifies |
|------|-----------------|
| `setHelpContext` called with `'game-halftime'` for halftime status | `mockGame.status = 'halftime'` → assert mock was called (requires capturing the mock) |
| `setHelpContext` called with `'game-in-progress'` for in-progress status | Same pattern with `status: 'in-progress'` |

> To test these, change the mock from a plain `vi.fn()` to a captured spy that can be inspected: `const mockSetHelpContext = vi.fn(); vi.mock(..., () => ({ useHelpFab: () => ({ setHelpContext: mockSetHelpContext, ... }) }))`.

---

### Test File 6 — Screen wiring smoke tests

For each of the 5 simpler screen components (Home, GamePlanner, SeasonReport, Management, UserProfile), the existing test file (if present) should be extended with a single wiring test. If no test file exists for that component, create a minimal one.

**Pattern (example for Home.tsx):**

```typescript
// src/components/Home.test.tsx (NEW or EXTEND)
const { mockSetHelpContext } = vi.hoisted(() => ({
  mockSetHelpContext: vi.fn(),
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    setHelpContext: mockSetHelpContext,
    helpContext: null,
    debugContext: null,
    setDebugContext: vi.fn(),
  }),
}));

// ... other mocks required by Home.tsx (AWS Amplify, useAmplifyQuery, etc.)

it("registers 'home' help context on mount", () => {
  render(<Home />);
  expect(mockSetHelpContext).toHaveBeenCalledWith('home');
});

it("clears help context on unmount", () => {
  const { unmount } = render(<Home />);
  unmount();
  expect(mockSetHelpContext).toHaveBeenLastCalledWith(null);
});
```

Repeat this pattern for `GamePlanner`, `SeasonReport`, `UserProfile`.

For `Management.tsx`, add:
```typescript
it("registers 'manage-teams' on mount (default section)", () => {
  render(<Management />);
  expect(mockSetHelpContext).toHaveBeenCalledWith('manage-teams');
});

it("updates to 'manage-players' when Players tab is activated", async () => {
  const user = userEvent.setup();
  render(<Management />);
  await user.click(screen.getByRole('button', { name: /Players/i }));
  expect(mockSetHelpContext).toHaveBeenCalledWith('manage-players');
});
```

> **Note:** Screen wiring tests for Home, GamePlanner, SeasonReport, Management, and UserProfile require mocking AWS Amplify (they all call `generateClient`). Follow the same `vi.mock('aws-amplify/data', ...)` pattern used in `GameManagement.test.tsx`.

---

## 16. Edge Cases & Risk Mitigations

### Risk 1 — Content drift as UI evolves
**Mitigation:**
- `HelpContentRegistry = Record<HelpScreenKey, ScreenHelpContent>` enforces all keys at compile time — adding a new key to the union requires content authoring before the code compiles.
- Add a `// @help-content: <key>` comment inline in screen components near any UI element that is documented. Example in `GameManagement.tsx` near the substitution logic: `// @help-content: game-in-progress`. This makes content-maintenance PRs searchable by `grep '@help-content'`.
- Document the screen registration requirement in `CLAUDE.md` under a new "Help System" section.

### Risk 2 — `gameState.status` undefined on initial render
**Mitigation (already in plan):** The `Partial<Record<string, HelpScreenKey>>` pattern in the `GameManagement` `useEffect` means `undefined` / unknown values silently do nothing — `setHelpContext` is not called, the button stays disabled. This is confirmed safe.

**Additional guard:** The `game` prop passed to `GameManagement` always has a `status` field (it is a persisted DynamoDB record). The risk window is only the first few milliseconds before the subscription delivers. This is cosmetically acceptable.

### Risk 3 — Focus management conflicts with existing screen focus
**Mitigation (in HelpModal implementation):** `previousFocusRef.current = document.activeElement` captured at mount, restored in `useEffect` cleanup. The most likely `activeElement` before opening is the `help-fab` button itself — restoring to it is semantically correct (coach tapped the FAB, help closes, FAB is focused again).

### Risk 4 — `Management.tsx` variable name
**Verified from source (lines 118):** Variable is `activeSection`. Plan references confirmed name throughout.

### Risk 5 — New screens without wiring
**Mitigation:**
- Document in `CLAUDE.md`: any new top-level screen component MUST call `setHelpContext(key)` on mount and `setHelpContext(null)` on unmount.
- Add to PR template checklist: "If this PR adds a new screen, is `setHelpContext` called?"
- The button simply stays disabled on unwired screens — no crash, no error. Silent degradation is acceptable.

### Risk 6 — Focus trap implementation
**Mitigation (already in plan):** The trap is implemented as a `keydown` listener on the modal `<div>`. The query for focusable elements uses the standard selector set. The `tabIndex={-1}` heading is intentionally excluded from the trap cycle. The trap is tested at unit level.

**Fallback if trap is too complex:** Use the HTML `inert` attribute on the backdrop:
```tsx
<div className="help-modal-overlay" onClick={onClose} inert={undefined}>
```
Wait — `inert` on the overlay itself is wrong. The correct `inert` pattern is:
```tsx
// Set inert on all siblings of the modal (everything outside it)
// This is more invasive and not recommended over the keydown trap.
```
Stick with the `keydown` trap as specified.

### Risk 7 — Double-fire of `openHelpAfterClose` (both setTimeout and animationend fire)
**Analysis:** The `setTimeout(300ms)` fallback and `handleAnimationEnd` can both fire if the animation completes normally. Currently the `openBugReportAfterClose` has the same potential — examine how it's handled.

**From source:** Both blocks unconditionally set the ref to `false` and then call `setBugReportOpen(true)`. If both fire, `setBugReportOpen(true)` is called twice — React batches this as a no-op (setting state to the same value). The modal does not double-mount.

**Conclusion:** Same behavior applies to `openHelpAfterClose`. Setting `helpModalOpen` to `true` twice is benign. The plan mirrors the existing pattern exactly.

### Risk 8 — SeasonReport exported component name
**Action required:** Before implementing the `SeasonReport.tsx` wiring, read lines 30–80 of the file to confirm the component export name. The file begins with `interface TeamReportProps { team: Team }` (observed from source), which suggests an internal `TeamReport` component — the `setHelpContext` call should be in whichever component represents the visible screen, not a helper component.

### Risk 9 — `onNavigate` prop on related screen pills (Phase 1 behavior)
**Spec §8.5:** In Phase 1, tapping a related screen pill only closes the modal. The implementation plan handles this:
```typescript
onClick={() => {
  onNavigate ? onNavigate(key) : onClose();
}}
```
When `HelpFab.tsx` renders `HelpModal` without `onNavigate`, clicking a pill calls `onClose()`. This is correct and intentional.

### Risk 10 — `setHelpContext` reference stability
**The spec notes:** "`setHelpContext` function reference is stable (wrapped in `useCallback` in the provider, or stable by virtue of being a `useState` setter)."

**From source:** `HelpFabContext.tsx` uses plain `useState` — the setter is stable by React's guarantee (not wrapped in `useCallback`). Including it in `useEffect` dependency arrays is correct and will not cause extra renders. This is confirmed consistent with how `setDebugContext` is already used in `GamePlanner.tsx`.

---

## 17. Acceptance Criteria Checklist

### End-to-end behavior
- [ ] On every authenticated screen that is wired, the "Get Help" menu item is enabled (no `disabled` attribute, no "Coming soon" text)
- [ ] On any unwired screen, "Get Help" remains disabled with "Coming soon" — no crash
- [ ] Tapping "Get Help" on a wired screen closes the bottom sheet, then opens `HelpModal` with the correct article
- [ ] The `HelpModal` displays the `screenTitle` matching the current screen
- [ ] The `HelpModal` displays the `overview`, all tasks, and all tips for the current screen
- [ ] Related screen pills appear only when `relatedScreens` is defined; they close the modal when tapped (Phase 1)
- [ ] Pressing Escape closes `HelpModal`
- [ ] Tapping the backdrop closes `HelpModal`
- [ ] Tapping ✕ closes `HelpModal`
- [ ] After `HelpModal` closes, focus returns to the element that had focus before (most likely the FAB button)
- [ ] "Report a Bug" behavior is completely unchanged — opens `BugReport` regardless of `helpContext`
- [ ] `GameManagement` updates the help context reactively as the game transitions: `scheduled → in-progress → halftime → completed`
- [ ] `Management` updates the help context as the coach switches between Teams / Players / Formations / Sharing / App tabs

### TypeScript compilation
- [ ] `tsc --noEmit` exits 0 with all new files included
- [ ] Omitting any `HelpScreenKey` from `HELP_CONTENT` is a compile error (not a runtime error)
- [ ] No `any` type introduced in any new or modified file

### Accessibility
- [ ] `HelpModal` has `role="dialog"`, `aria-modal="true"`, `aria-labelledby="help-modal-title"`
- [ ] `<h2>` has `id="help-modal-title"` and `tabIndex={-1}`
- [ ] Focus moves to the heading on modal open
- [ ] Focus is restored to the triggering element on modal close
- [ ] Escape key dismisses the modal (from any focused element within)
- [ ] Focus trap: Tab cycles within the modal; focus does not escape to the document behind
- [ ] `@media (prefers-reduced-motion: reduce)` disables the modal entrance animation

### Tests
- [ ] `content.test.ts` passes — all 13 entries have valid structure
- [ ] `HelpModal.test.tsx` passes — rendering, close behavior, accessibility attributes, focus, fallback
- [ ] `HelpFabContext.test.tsx` passes — independence of `debugContext` and `helpContext`
- [ ] `HelpFab.test.tsx` passes — enabled/disabled state, modal open sequence, BugReport unchanged
- [ ] `GameManagement.test.tsx` existing tests continue to pass after adding `HelpFabContext` mock
- [ ] Screen wiring smoke tests pass for all 6 screen components

### Bundle
- [ ] `vite build` produces no warnings about circular imports involving the `help/` module
- [ ] No new `npm` packages are installed (zero new dependencies)

---

*End of implementation plan.*
