# TeamTrack UI Specification

**Version:** 1.0
**Date:** 2026-03-01
**Audience:** Designer handoff
**App:** TeamTrack — Game Management for Coaches (PWA)

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Design Tokens](#2-design-tokens)
3. [Typography](#3-typography)
4. [Breakpoints & Layout Grid](#4-breakpoints--layout-grid)
5. [Component Library](#5-component-library)
6. [Navigation Shell](#6-navigation-shell)
7. [Screen Specs](#7-screen-specs)
   - [Landing Page (unauthenticated)](#71-landing-page-unauthenticated)
   - [Home — Games List](#72-home--games-list)
   - [Game Management — Scheduled](#73-game-management--scheduled-state)
   - [Game Management — In Progress](#74-game-management--in-progress-state)
   - [Game Management — Halftime](#75-game-management--halftime-state)
   - [Game Management — Completed](#76-game-management--completed-state)
   - [Game Planner](#77-game-planner)
   - [Season Reports](#78-season-reports)
   - [Manage (Teams, Players, Formations)](#79-manage)
   - [Profile](#710-profile)
   - [Invitation Flow](#711-invitation-flow)
8. [Modal & Overlay Patterns](#8-modal--overlay-patterns)
9. [Help & Bug Report FAB](#9-help--bug-report-fab)
10. [z-index Stack](#10-z-index-stack)
11. [PWA / Platform Behavior](#11-pwa--platform-behavior)
12. [Issue #7 Fix — Pinch-to-Zoom Disabled](#12-issue-7-fix--pinch-to-zoom-disabled)

---

## 1. Design Principles

| Principle | Description |
|-----------|-------------|
| **Sideline-first** | The primary context is a coach standing on a grass sideline, one hand on a phone, partial attention. Every tap target must be reachable with a thumb, every label readable in direct sunlight. |
| **Glanceable** | Critical information (score, game clock, next rotation) is always visible without scrolling. |
| **Forgiving** | Destructive or irreversible actions (end game, delete player) always require confirmation. No accidental misclicks should cause data loss. |
| **Native feel** | The PWA mimics a native app: no browser chrome visible when installed, no pinch-to-zoom (issue #7), full-bleed layouts, smooth transitions. |
| **Minimal chrome** | Screen real estate is precious on a phone. Navigation is bottom-tab (always reachable by thumb). Headers are compact. |

---

## 2. Design Tokens

Defined in `src/index.css :root`. All components must use these variables — no hardcoded color values.

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--primary-green` | `#1a472a` | Primary actions, active nav, headings |
| `--light-green` | `#2d6d3f` | Hover state for primary-green elements |
| `--accent-green` | `#4caf50` | CTA buttons, success indicators |
| `--background` | `#f5f5f5` | App background (off-white) |
| `--card-background` | `#ffffff` | Card/panel surfaces |
| `--text-primary` | `#212121` | Body text, headings |
| `--text-secondary` | `#757575` | Captions, meta, placeholders |
| `--border-color` | `#e0e0e0` | Dividers, input borders, card outlines |
| `--danger-red` | `#d32f2f` | Delete actions, red card indicators, error states |
| `--hover-background` | `#f0f0f0` | Row hover, secondary button bg |

### Semantic Color Usage

| Context | Token |
|---------|-------|
| Active game badge | `--accent-green` bg, white text |
| Scheduled badge | `--border-color` bg, `--text-secondary` text |
| Completed badge | `--hover-background` bg, `--text-secondary` text |
| Halftime badge | amber `#f59e0b` bg, white text |
| Yellow card | `#ffc107` |
| Gold star | `#ffd700` |
| Red card | `--danger-red` |
| BETA badge | `#f59e0b` bg, white text |

---

## 3. Typography

**Font stack:** `Inter, system-ui, Avenir, Helvetica, Arial, sans-serif`

| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| App name (h1) | `2em` | 700 | Landing only |
| Section heading (h2) | `1.5em` | 600 | With `margin-bottom: 1rem` |
| Card title (h3) | `1.1em` | 600 | |
| Body / input | `1em` | 400 | Inherits from `<body>` |
| Meta / caption | `0.85–0.95em` | 400 | `--text-secondary` |
| Button | `1em` | 500 | `font-family: inherit` |
| BETA badge | `0.65em` | 700 | Uppercase, letter-spacing 0.08em |

---

## 4. Breakpoints & Layout Grid

TeamTrack targets two form factors:

| Breakpoint | Width | Layout |
|------------|-------|--------|
| **Phone** | < 768px | Single-column, full-width, bottom nav |
| **Tablet** | ≥ 768px | Two-column where content allows; bottom nav persists |

### Phone Layout (< 768px)

- Content fills 100% viewport width with `16px` horizontal padding
- Bottom navigation always visible (60px tall, z-index 100)
- App header: compact, `48px` tall
- Tap targets: minimum `44 × 44px`
- Cards: full-width, stacked vertically

### Tablet Layout (≥ 768px)

Tablet breakpoint activates at `768px`. Suggested adaptations per screen:

| Screen | Phone | Tablet |
|--------|-------|--------|
| Games List | Single column cards | Two-column card grid (upcoming + active side by side) |
| Game Management | Full-width tabs | CommandBand spans full width; Lineup + Bench in two columns |
| Manage | Single-column lists | Master-detail (list left, form right) |
| Reports | Single-column table | Wider table with more visible columns |
| Landing | Stacked | Hero with side-by-side text + screenshot |

Bottom navigation persists on tablet (does not switch to sidebar nav in v1).

---

## 5. Component Library

### 5.1 Buttons

| Class | Background | Text | Use |
|-------|-----------|------|-----|
| `.btn-primary` | `--primary-green` | white | Primary action |
| `.btn-secondary` | `--hover-background` | `--text-primary` | Cancel / secondary |
| `.btn-delete` | transparent | `--danger-red` | Destructive (small icon button) |
| `.btn-back` | transparent | `--primary-green` | Back navigation |
| `.btn-signout` | transparent | `--text-secondary` | Sign out |
| `.cta-primary` | `--accent-green` | white | Landing page CTAs |
| `.cta-secondary` | rgba white | white | Landing page secondary CTA |

All buttons: `border-radius: 8px`, `padding: 0.7em 1.5em`, `font-size: 1em`, `transition: all 0.2s ease`. Disabled: `opacity: 0.5`, `cursor: not-allowed`.

### 5.2 Cards

- Background: `--card-background` (white)
- Border: `1px solid --border-color`
- Border-radius: `8–12px`
- Box-shadow: `0 2px 4px rgba(0,0,0,0.06)` (subtle elevation)
- Active game card: left border accent `4px solid --accent-green`
- Completed game card: muted (reduced opacity or grayscale treatment)

### 5.3 Inputs

- Border: `1px solid --border-color`, `border-radius: 6px`
- Focus: border becomes `--primary-green`, no outline ring
- Width: `100%` by default
- Font: inherits body

### 5.4 Empty States

Class `.empty-state`: centered, `--text-secondary` color, italic, `padding: 2em`.

Every list/collection screen must define an empty state. See screen specs below.

### 5.5 Toast Notifications

Positioned `top-center`, max-width `90vw`.
- Success: `--accent-green` tint, duration 2.5s
- Error: `--danger-red` tint, duration 4s

### 5.6 Confirmation Modals

Used for all irreversible actions. Pattern: overlay + centered card with title, message, and two buttons (`.btn-primary` confirm + `.btn-secondary` cancel). z-index 1000.

### 5.7 Status Badges

Inline pill badges on game cards:

| Status | Label | Style |
|--------|-------|-------|
| scheduled | `📅 Scheduled` | Gray pill |
| in-progress | `⚽ In Progress` | Green pill |
| halftime | `⏸️ Halftime` | Amber pill |
| completed | `✅ Completed` | Gray pill |

---

## 6. Navigation Shell

### App Header (`AppLayout`)

- Height: ~`56px`
- Background: `--primary-green`
- Content: `⚽ TeamTrack` logo (h1) + tagline
- Visible on all authenticated screens inside `AppLayout`
- Hidden on: Game Management in-progress/halftime (CommandBand takes over visual prominence), Landing page, Invitation flow, Dev Dashboard

### Bottom Navigation

- Height: `60px`
- z-index: `100`
- Background: white, top border `1px solid --border-color`
- Four tabs: **Games** (⚽), **Reports** (📊), **Manage** (⚙️), **Profile** (👤)
- Active tab: `--primary-green` icon and label
- Inactive tab: `--text-secondary`
- Label: `0.75em`, below icon

### Routes Outside AppLayout

- `/invite/:invitationId` — full screen, no bottom nav
- `/dev` — developer dashboard, full screen, no bottom nav

---

## 7. Screen Specs

### 7.1 Landing Page (unauthenticated)

**Route:** `/` (before auth)
**File:** `src/components/LandingPage.tsx`

#### Header
- Sticky, white, box-shadow
- Left: `⚽ TeamTrack` + BETA badge
- Right: `Log In` ghost button (green border, green text → white on hover)

#### Hero Section
- Full-width green gradient (`--primary-green` → `--light-green`)
- **Phone:** stacked (text above, screenshot hidden below 600px)
- **Tablet/Desktop:** side-by-side — text left (max 600px), phone screenshot right (220px wide)
- Eyebrow: "Free during beta" (small caps)
- H1: "Fair play time for every player, every game." — `2.75rem`, bold
- Tagline: `1.15rem`, 0.9 opacity
- CTAs: `Get Started Free` (accent-green pill) + `Log In` (ghost pill)
- Beta disclaimer: `0.85rem`, 0.75 opacity

#### Feature Grid
- 6 cards in `auto-fit minmax(280px, 1fr)` grid
- Each: icon (2.25rem emoji) + h3 (primary-green) + body text

#### Screenshots
- 3-column grid on desktop, 2-column on tablet/mobile
- Phone-style screenshots with border-radius 20px, soft shadow

#### How It Works
- Numbered steps (1–4), green circle number
- max-width 800px, centered

#### CTA Section
- Green gradient (matches hero)
- BETA badge + h2 + body + `Create Free Account` pill button

#### Footer
- Dark (`#1a1a1a`) bg, muted text
- BETA note in amber

**Empty states:** N/A (marketing page, no data)

---

### 7.2 Home — Games List

**Route:** `/`
**File:** `src/components/Home.tsx`

#### Layout
- Content below app header, above bottom nav
- `16px` horizontal padding

#### Actions
- Top of page: `+ Schedule New Game` primary button (full-width on phone)

#### Create Game Form (inline, replaces button)
- Appears in-place when button tapped
- Fields: Team selector (dropdown), Opponent name (text), Date/time (datetime-local), Home Game (checkbox)
- Actions: `Create` (primary) + `Cancel` (secondary)
- Required fields: Team + Opponent (validation toast if missing)

#### Game Sections (when games exist)

Games grouped into three sections, in display order:

1. **Active Games** — `in-progress` or `halftime` status
2. **Upcoming Games** — `scheduled` status
3. **Past Games** — `completed` status

Each game card:
- Status badge (top)
- Team name vs Opponent (h4)
- Home/Away icon + formatted date (meta line)
- Tap → navigate to game management

Upcoming game cards also show a `📋 Plan Game` action button (does not navigate to game, opens planner).

Active game cards: left-border accent treatment.

#### Empty States

| Condition | Message |
|-----------|---------|
| No games at all | "No games scheduled yet. Click the button above to schedule your first game, or go to the Manage tab to create seasons and teams." |
| Section empty (active/upcoming/past) | Section is hidden (not rendered) |

#### Tablet Adaptation
- Game cards in a 2-column grid
- Create form in a centered card (max-width 480px)

---

### 7.3 Game Management — Scheduled State

**Route:** `/game/:gameId`
**File:** `src/components/GameManagement/GameManagement.tsx`
**State block:** `scheduled`

#### Layout
- App header visible
- Pre-game layout: vertical stack

#### Components Rendered
1. **GameHeader** — opponent, date, home/away, team name
2. **PlayerAvailabilityGrid** — mark each roster player as Available / Absent / Late
3. **Plan Conflict Banner** — shown if a saved game plan conflicts with current availability; prompts coach to review planner
4. **Start Game button** — `.btn-primary`, starts timer, transitions to `in-progress`
5. **📋 Plan Game button** — navigates to game planner route

#### Empty States
| Condition | Message |
|-----------|---------|
| No players on roster | "No players on roster. Add players in the Manage tab." |
| No game plan | Plan conflict banner not shown; "Plan Game" CTA prominent |

---

### 7.4 Game Management — In Progress State

**Route:** `/game/:gameId`
**State block:** `in-progress`

#### Layout
- **CommandBand** — sticky top, z-index 200 (always visible)
- **TabNav** — sticky below CommandBand, z-index 190
- Tab content area fills remaining viewport height, scrollable

#### CommandBand Contents
- Score: `Home X – Y Away` (large, centered)
- Goal buttons: `+ Home Goal` / `+ Away Goal`
- Game clock (counting up)
- Rotation countdown: "Next rotation in X:XX"

#### Tabs (TabNav)

| Tab | Contents |
|-----|----------|
| **Lineup** | `LineupPanel` with `hideAvailablePlayers=true`; shows current field positions |
| **Bench** | `BenchTab` — bench players with play time, sorted by least time |
| **Notes** | `PlayerNotesPanel` — per-player annotations: ⭐ gold star, 🟨 yellow card, 🟥 red card, other |

#### Always-Mounted Modals (not in tabs)
- `RotationWidget` — slide-up modal for next planned rotation preview
- `SubstitutionPanel` — slide-up modal triggered by tapping a field position

#### Empty States
| Condition | Message |
|-----------|---------|
| No lineup assigned | "No lineup set. Tap a position to assign a player." |
| All players on field (no bench) | Bench tab: "All players are on the field." |

---

### 7.5 Game Management — Halftime State

**Route:** `/game/:gameId`
**State block:** `halftime`

#### Layout
- No CommandBand (game is paused)
- App header visible
- **Halftime layout:** vertical stack

#### Components Rendered
1. **GameHeader** — scores, half indicator
2. **GameTimer** with `hidePrimaryCta=true` — shows elapsed time, Resume / End Half controls without the primary start button
3. **LineupPanel** — lineup review (available players shown for reassignment)
4. **RotationWidget** (modal, triggered by coach)
5. **SubstitutionPanel** (modal, triggered by tapping position)

#### Notes
- Halftime is the window for deliberate lineup changes
- Timer is explicitly paused; coach taps "Start 2nd Half" to resume

---

### 7.6 Game Management — Completed State

**Route:** `/game/:gameId`
**State block:** `completed`

#### Layout
- App header visible
- Summary layout

#### Components Rendered
1. **GameHeader** — final score
2. Play time summary table (player → total minutes)
3. Game notes summary (gold stars, cards)
4. `View Full Report` link → navigates to `/reports/:teamId`

---

### 7.7 Game Planner

**Route:** `/game/:gameId/plan`
**File:** `src/components/GamePlanner.tsx`

#### Purpose
Pre-game rotation planning. Coach marks availability then generates or manually edits a rotation schedule.

#### Layout
- App header visible
- Full-page vertical stack
- **No inline bug-report button in the sticky header.** Bug reporting is accessed via the global Help FAB (§9), which automatically attaches Game Planner debug context (rotation settings, player availability snapshot) when triggered from this screen.

#### Sections

1. **Player Availability** — same grid as scheduled state; changes here sync back to game
2. **Rotation Settings** — two coupled numeric steppers in the setup card (see §7.7.1 below)
3. **Lineup Builder** — drag-and-drop player-to-position assignment for starting lineup
4. **Planned Rotations** — timeline of rotations with players in/out per interval
5. **Auto-Generate button** — runs fair rotation algorithm
6. **Save Plan button** — persists `GamePlan` + `PlannedRotation` records

#### 7.7.1 Rotation Settings Control

Three numeric steppers inside the setup card, arranged in two rows:

**Row 1 — Half length (full width):**

| Stepper | Label | Clamp | Notes |
|---------|-------|-------|-------|
| C | **Half length (min)** | `[1, 99]` | Per-game override; saves to `Game` immediately. When value ≠ team default, a small "Reset to team default (N min)" link appears below the stepper. |

**Row 2 — Coupled rotation inputs (side-by-side):**

| Stepper | Label | Behaviour |
|---------|-------|-----------|
| A | **Rotations / half** | Editing derives interval: `round(halfLength ÷ (rotations + 1))` |
| B | **Every (min)** | Editing derives rotations: `floor(halfLength ÷ interval) - 1` |

- Steppers sit side-by-side with equal column width inside the setup card
- Label above each stepper; secondary text weight, 12 px
- `+` / `−` tap targets ≥ 44 × 44 px
- Direct keyboard entry via `<input type="number" inputmode="numeric">`
- Derived value in each stepper updates **instantly** on every change — no debounce
- Single source of truth persisted: `GamePlan.rotationIntervalMinutes` (no new schema field)
- Full coupling rules and clamp logic: `docs/specs/Game-Planner-Rotation-Input.md`

**Design tokens:**

| Element | Token |
|---------|-------|
| Stepper border | `--border-color` |
| Stepper value | `--text-primary` |
| `+` / `−` background | `--hover-background` |
| `+` / `−` active | `--primary-green`, white icon |
| Label | `--text-secondary` |

#### Empty States
| Condition | Message |
|-----------|---------|
| No players available | "Mark players as available above to generate a rotation plan." |
| No plan generated | "Tap 'Auto-Generate' to create a balanced rotation, or build one manually." |

#### Tablet Adaptation
- Availability grid + settings on left column
- Lineup + rotation timeline on right column

---

### 7.8 Season Reports

**Route:** `/reports` or `/reports/:teamId`
**File:** `src/components/SeasonReport.tsx`

#### Layout
- Team selector at top (dropdown if multiple teams)
- Summary stats row: W / L / D record, total games
- Play time table (sortable by player name or total minutes)
- Per-player drill-down (tap row → expand or navigate to player detail)

#### Empty States
| Condition | Message |
|-----------|---------|
| No teams | "Create a team in the Manage tab to start tracking." |
| Team has no completed games | "No completed games yet. Play some games to see reports here." |
| Player has 0 minutes | Show row with 0:00 (don't hide — highlights absence from field) |

#### Tablet Adaptation
- Wider table with more columns visible (position breakdown inline)
- Player detail panel opens as right-column rather than full-screen

---

### 7.9 Manage

**Route:** `/manage`
**File:** `src/components/Management.tsx`

#### Sections (tabbed or accordion)
1. **Teams** — create/edit/delete teams; set name, formation, field size, max players
2. **Players** — add players to a team; set name, jersey number, preferred positions; swipe-to-delete
3. **Formations** — select or edit formation templates (4-3-3, 4-4-2, etc.); define positions
4. **Invitations** — invite assistant coaches by email; view pending invitations

#### Empty States
| Condition | Message |
|-----------|---------|
| No teams | "No teams yet. Create your first team to get started." |
| No players on team | "No players on this team. Add players to build your roster." |
| No pending invitations | "No pending invitations." |

#### Tablet Adaptation
- Master list (left column) + detail/form (right column) pattern

---

### 7.10 Profile

**Route:** `/profile`
**File:** `src/components/UserProfile.tsx`

#### Contents
- Email address (read-only)
- Account actions: Sign Out
- App info: version number

#### Bug Report Access
Bug reporting is accessed via the global Help FAB (§9) visible on all authenticated screens. The Profile page no longer contains a dedicated bug-report button.

> **Migration note:** The previous inline "Report Issue" card in the Manage tab and the "Report a Bug" button in the Game Planner header are both replaced by the Help FAB.

---

### 7.11 Invitation Flow

**Route:** `/invite/:invitationId`
**Full-screen, outside AppLayout**

#### States
| State | Display |
|-------|---------|
| Loading | Spinner + "Loading invitation…" |
| Valid (logged out) | "You've been invited to join [Team Name]" + Sign In / Create Account CTA |
| Valid (logged in) | "Accept invitation to join [Team Name]?" + Accept / Decline buttons |
| Already accepted | "You're already a coach on this team." + link to home |
| Expired / invalid | "This invitation is no longer valid." |

---

## 8. Modal & Overlay Patterns

All modals share:
- Backdrop: `rgba(0,0,0,0.5)`, z-index `1000`
- Modal card: white, `border-radius: 12px`, centered (or slide-up on phone)
- Dismiss: tap backdrop or explicit close button
- No scroll lock required (modals are small; page behind doesn't scroll)

### Rotation Widget
- Slide-up sheet on phone
- Shows next planned rotation: players in, players out, position changes
- Confirm / Skip buttons

### Substitution Panel
- Slide-up sheet triggered by tapping any field position
- Shows: current player in position + play time, bench players with play time
- Tap bench player → confirm substitution

### Confirm Modal
- Centered overlay card
- Title + message + `Confirm` (primary, sometimes danger red) + `Cancel` (secondary)

---

## 9. Help & Bug Report FAB

A single, consistent affordance for bug reporting and (future) context-sensitive help, present on every authenticated screen.

### 9.1 Rationale

Previously, bug reporting was scattered across different screens with different placements (inline button in Game Planner header, card in Manage tab, link on Profile page). This created visual clutter, especially on mobile where the Game Planner header button competed with navigation. A floating action button (FAB) provides a uniform, unobtrusive entry point that:

- Never competes with page-specific navigation or sticky headers
- Is always accessible regardless of scroll position
- Provides a natural home for future help features
- Collects page-specific debug context automatically

### 9.2 Visual Design

| Property | Value |
|----------|-------|
| Shape | Circle, `44 × 44px` (meets minimum tap target) |
| Icon | `?` (question mark), white, `1.25em`, weight 700 |
| Background | `--primary-green` at 90% opacity |
| Border | `2px solid rgba(255,255,255,0.2)` |
| Shadow | `0 2px 8px rgba(0,0,0,0.15)` |
| Border-radius | `50%` |
| z-index | `90` (below bottom nav at 100, so it doesn't overlay navigation) |

### 9.3 Positioning

| Breakpoint | Position |
|------------|----------|
| **Phone** (< 768px) | Fixed, `bottom: 76px` (16px above the 60px bottom nav), `right: 16px` |
| **Tablet** (≥ 768px) | Fixed, `bottom: 76px`, `right: 24px` |

The FAB sits above the bottom navigation bar and below any modal overlays. It must not overlap the CommandBand, tab nav, or bottom nav.

### 9.4 Visibility Rules

| Context | FAB visible? |
|---------|--------------|
| All authenticated screens (Home, Game Management, Planner, Reports, Manage, Profile) | ✅ Yes |
| Landing page (unauthenticated) | ❌ No |
| Invitation flow (`/invite/:id`) | ❌ No |
| Dev Dashboard (`/dev`) | ❌ No |
| Any open modal overlay (z-index 1000) | Hidden (FAB is below modal z-index) |

### 9.5 Interaction: Bottom Sheet Menu

Tapping the FAB opens a bottom-sheet overlay with the following options:

| Option | Icon | State | Behavior |
|--------|------|-------|----------|
| **Report a Bug** | 🐛 | Active | Opens the `BugReport` modal with page-specific debug context attached (see §9.6) |
| **Get Help** | 📖 | Disabled / Coming Soon | Grayed out with "Coming soon" subtitle. Future: opens context-specific help for the current screen. |

#### Bottom Sheet Design

| Property | Value |
|----------|-------|
| Backdrop | `rgba(0,0,0,0.3)`, tapping dismisses |
| Sheet | White, `border-radius: 12px 12px 0 0`, slides up from bottom |
| Max height | `40vh` |
| z-index | `950` (above FAB, below full modals at 1000) |
| Options | Full-width rows, `56px` tall, left icon + label + optional subtitle |
| Dismiss | Tap backdrop, swipe down, or tap a close affordance |

### 9.6 Page-Specific Debug Context

When "Report a Bug" is selected, the FAB component automatically captures debug context for the current screen and passes it to the `BugReport` modal. This replaces the previous per-screen `gamePlannerContext` pattern with an extensible approach.

| Screen | Debug context attached | Status |
|--------|----------------------|--------|
| Game Planner | Rotation settings, player availability, half length, max-on-field | ✅ Implemented |
| Game Management | Game status, elapsed time, current half, lineup count | 🔮 Future |
| Home | Active game count, scheduled game count | 🔮 Future |
| All other screens | Screen name only | Default |

Debug context is collected via a React context provider (`HelpFabContext`) that each screen can optionally populate. If no context is provided, only the current route/screen name is included.

### 9.7 Animation

- **FAB entrance:** Fades in with slight upward translate (`translateY(8px)` → `translateY(0)`) over `200ms ease-out` on route mount.
- **Bottom sheet:** Slides up from off-screen over `250ms ease-out`. Dismisses by sliding down over `200ms ease-in`.
- **FAB press:** Subtle scale (`0.95`) on `:active` for tactile feedback.

### 9.8 Accessibility

- `aria-label="Help and bug report"`
- Bottom sheet menu items are focusable with `role="menuitem"`
- Sheet container has `role="menu"` and `aria-label="Help menu"`
- Disabled "Get Help" item has `aria-disabled="true"`
- Escape key dismisses the bottom sheet
- Focus is trapped inside the bottom sheet while open

### 9.9 Future: Help Feature Integration

The Help FAB is designed to be the entry point for a future context-sensitive help system. When implemented, the "Get Help" option will:

- Display page-specific guidance (e.g., "How to set up rotations" on the Game Planner)
- Show onboarding tips for new coaches
- Link to external documentation or FAQs
- Provide context-aware suggestions based on current page state

A separate **Help Content Specification** document will define the help content, structure, and delivery mechanism. The FAB UI and bottom-sheet pattern remain unchanged when help is enabled — only the "Get Help" row transitions from disabled to active.

---

## 10. z-index Stack

| Layer | z-index | Element |
|-------|---------|---------|
| Help FAB | 90 | `.help-fab` |
| Bottom navigation | 100 | `.bottom-nav` |
| Game tab navigation | 190 | `.game-tab-nav` |
| Command band | 200 | `.command-band` |
| Help FAB bottom sheet | 950 | `.help-fab-sheet` |
| Modal overlays | 1000 | `.modal-overlay` |
| Toast notifications | 9999+ | `react-hot-toast` |

---

## 11. PWA / Platform Behavior

- **Installed as PWA:** no browser chrome; full viewport used
- **Status bar:** `black-translucent` on iOS; theme color `#1a472a`
- **Pinch-to-zoom:** disabled globally (see §11)
- **Offline:** service worker caches app shell; Amplify API calls cached for 24 hours (Workbox runtime caching)
- **Install prompt:** not shown automatically; coach installs via browser share sheet

---

## 12. Issue #7 Fix — Pinch-to-Zoom Disabled

**Issue:** Coaches accidentally zoomed in while managing a live game, making the UI unusable.

**Solution:** Set `user-scalable=no` and `maximum-scale=1.0` on the viewport meta tag in `index.html`. This is the standard approach for native-feel PWAs.

**Before:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

**After:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

**Scope:** Global — applies to all screens including landing page, game management, reports, and manage.

**Accessibility note:** Disabling zoom is generally discouraged for accessibility (WCAG 1.4.4 Resize Text). For TeamTrack, the trade-off is intentional: the primary user (coach on sideline) is significantly harmed by accidental zoom, and the app uses relative font sizes (`em`/`rem`) that scale with OS-level text size settings. Coaches who need larger text can use iOS/Android system accessibility settings instead.
