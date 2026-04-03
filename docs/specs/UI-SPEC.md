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
   - [Pre-Game Notes & Attribution](#711-pre-game-notes--attribution)
   - [Onboarding](#712-onboarding)
   - [Invitation Flow](#713-invitation-flow)
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
- Direct note trigger: `Add note`

#### Direct Note Trigger (In Progress)
- The in-progress CommandBand includes an `Add note` action that opens the shared live-note modal without switching tabs.
- Narrow iPhone widths (375/390/430) use icon-only presentation for the note trigger.
- Direct-entry default note type is always `other` (display label: `Note`).
- Rotation badge and note trigger must coexist in the right cell with both hit targets staying at least `44 x 44px`.
- Collapse behavior at narrow widths: note label hides first, then rotation helper text hides; icon button and rotation count remain visible.

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
- Halftime direct note entry surface-of-truth is the halftime action-row `Add note` control (not CommandBand).
- Halftime `Add note` opens the same shared live-note modal/editor/save path used by Notes tab and in-progress direct entry.

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

#### Layout
- App header visible
- Content area with vertical stack

#### Sections

##### Profile Form
Coach profile for pre-game note attribution. Names visible only to coaches on the same team.

**Form fields (Phone: single column; Tablet: two-column):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| First Name | text | No | Auto-capitalize on input; trim on blur; max 50 chars; normalized to null if blank after trim |
| Last Name | text | No | Auto-capitalize on input; trim on blur; max 50 chars; normalized to null if blank after trim |
| Share last name with team coaches | toggle / checkbox | Yes | Default: on (true); when off, only first name shown in pre-game notes |

**Phone layout (< 768px):**
- Full-width single column
- Each field stacked vertically
- Input width: 100% with 16px padding
- Toggle sits below last name field
- Button row: Save Profile button (full-width primary) + Cancel button (full-width secondary, stacked below Save)
- Cancel button prompts "Discard changes?" confirmation if form is dirty (any field differs from saved state); confirm clears unsaved edits and returns to profile view

**Tablet layout (≥ 768px):**
- Two-column grid for first name + last name (side-by-side)
- Privacy toggle below, full-width
- Button row: Save (primary) + Cancel (secondary), side-by-side
- Form max-width: 500px, centered or left-aligned

**Input styling:**
- Border: `1px solid --border-color`
- Focus: border `--primary-green`, box-shadow `0 0 0 3px rgba(26, 71, 42, 0.1)`
- Font: inherit from body
- Touch target minimum: `44 × 44px` (including labels)
- Labels: `--text-primary`, `0.9em`, bold, `margin-bottom: 0.5em`

**Toggle styling (for privacy checkbox):**
- Style as checkbox with custom styling or toggle switch
- Touch target minimum: `44 × 44px`
- Checked state: `--primary-green` background or checkmark
- Label text: Share my last name with coaches (gray hint below if space available on phone)

**Normalization feedback:**
- When user leaves first/last name field: non-visible trim operation occurs
- If all whitespace was entered: field clears silently (normalized to null)
- No inline validation error (graceful normalization)
- Optional: subtle caption Names are trimmed on save

**Validation rules:**
- Save button is **disabled** when normalized `firstName` (after trim + blank-to-null) is empty or null
- Show inline caption below First Name field: "First name required" (`--text-secondary`, `0.85em`)
- Caption is cleared as soon as first name has non-whitespace text
- Last name and privacy toggle have no validation; both optional

**States and responses:**

| State | Display |
|-------|----------|
| **Idle/loaded** | Form fields prepopulated with current profile data (if exists); Save button enabled if firstName is non-blank, otherwise disabled |
| **Editing** | Fields accept input; Save button enabled/disabled based on firstName; no change persisted until Submit |
| **Loading (on Save)** | Save button disabled, shows spinner or Saving... text |
| **Success** | Toast notification Profile updated (success green, 2.5s) OR inline success message below form; focus remains on form |
| **Error** | Toast or inline error: Could not save profile. Please try again. (red, 4s); Save button re-enabled |
| **Conflict (concurrent edit)** | **Persistent inline alert** (not auto-dismiss) positioned above form: Your profile was updated elsewhere. + **Retry** button + **Discard** button. Editing remains enabled while conflict is shown. After successful Retry, alert clears and focus returns to First Name input. Discard button clears the conflict alert without refetching. |

**Accessibility:**
- Each input has associated `<label>` with `for` attribute
- Toggle has `aria-label` or associated label
- Submit button keyboard accessible (Enter to submit)
- Form has `role="form"` or standard `<form>` element
- Focus management: focus returns to Save button after successful submission
- Error/success messages announced via `aria-live="polite"`

##### Account & App Info
- Email address (read-only, gray label + value)
- Sign Out button (secondary style, `--text-secondary` text)
- App version (caption text, bottom of page)

#### Bug Report Access
Bug reporting is accessed via the global Help FAB (§9) visible on all authenticated screens.

#### Empty States
| Condition | Display |
|-----------|---------|
| First time (no profile) | Form fields empty; Save button prompts user to enter at least a first name for team attribution |
| Profile already exists | Form prepopulated with current values |

---

### 7.11 Pre-Game Notes & Attribution

**Component:** `src/components/GameManagement/PreGameNotesPanel.tsx`
**Used in:** Game Management — In Progress state, Notes tab

#### Attribution Display Rules and Rendering Matrix

Each pre-game note shows an author attribution label in the note footer. The label is determined by the note's `authorId` and current team coach profiles:

| Author Scenario | Attribution Label | Font & Styling | Context |
|-----------------|-------------------|-----------------|------------|
| `authorId === null` | `Unknown Author` | 0.9em, `--text-secondary` italic | Legacy notes with missing author |
| `authorId === currentUserId` | `You` | 0.9em, `--primary-green` bold | Current coach's own notes—**render only label text, no Coach N suffix** |
| Author in team coaches but no profile | `Coach` | 0.9em, `--text-secondary` normal | Profile not yet created |
| Author in team coaches with profile (privacy on) | `FirstName LastInitial.` | 0.9em, `--text-primary` normal | Example: Alice M. |
| Author in team coaches with profile (privacy off) | `FirstName` | 0.9em, `--text-primary` normal | Example: Alice |
| Author formerly on team (removed from Team.coaches) | `Former Coach` | 0.9em, `--text-secondary` italic | Historical note, author no longer on team; same styling as Coach fallback |
| Duplicate display names within team | `DisplayName (Coach 1)`, `DisplayName (Coach 2)`, etc. | base label in 0.9em `--text-primary` normal; ordinal suffix `(Coach N)` in `--text-secondary` normal | Deterministic ordinal suffix to disambiguate; ordinal suffix is not applied to You label |

**Placement and formatting:**
- Attribution label sits as a footer caption line below note text and above action buttons
- Format: `Created by: [label]`
- Line spacing: `0.5em` margin-top from note text, `0.5em` margin-bottom from action row
- No raw Cognito IDs exposed in UI

#### Duplicate Disambiguation Algorithm

When multiple coaches have the same normalized first name (and same last initial if privacy allows), the UI appends a team-scoped ordinal:

1. Group coaches by base display name (after privacy filtering)
2. For each collision group, sort by coach ID lexicographically
3. Assign 1-based ordinal within group
4. Render as: `DisplayName (Coach 1)`, `DisplayName (Coach 2)`, etc.

Example: Two coaches both named Alex on same team rendered as Alex (Coach 1) and Alex (Coach 2) (deterministic, stable across sessions).

#### Attribution Data Flow and Refresh Behavior

1. When Notes tab is active, `GameManagement.tsx` fetches team coach profiles via `useTeamCoachProfiles` hook (60-second freshness target)
2. Pass profile map to `PreGameNotesPanel` component
3. Component resolves each note's `authorId` to display-ready label using attribution matrix above
4. **Refresh runs silently every 60 seconds with no staleness badge or indicator displayed to user**
5. No manual refresh button; data auto-updates in background if profile changes are detected
6. Immediate refetch triggers: team change, notes tab focus entry, window focus regain

---

### 7.12 Onboarding

**Components:** `src/components/Onboarding/QuickStartChecklist.tsx`, `src/components/Onboarding/WelcomeModal.tsx`
**Shown on:** Home tab for first-time coaches

#### Quick Start Checklist

**Purpose:** Guide new coaches through a seven-step setup model required to run a live game.

**Display:**
- Sticky card-style checklist on Home tab, above game list (if not dismissed)
- Can be collapsed to a small resume banner; expands on tap
- Auto-dismisses when all steps complete (shows completion state for 4 seconds)

**Steps (in order):**

| # | Title | Completion Signal | Direction Text | Screen |
|---|-------|-------------------|-----------------|--------|
| 1 | Create your team | Team created | Go to Manage ⚙️ → Teams | /manage (Teams section) |
| 2 | Complete your profile | First name filled (non-null after trim) | Go to Profile 👤 | /profile (Profile form) |
| 3 | Add players to your roster | >= 1 player added to team | Go to Manage ⚙️ → Players | /manage (Players section) |
| 4 | Set your formation | Formation assigned to team | Go to Manage ⚙️ → Teams and assign a formation | /manage (Teams section) |
| 5 | Schedule a game | >= 1 game created | Tap + Schedule New Game above | /home (inline create form) |
| 6 | Plan your rotations | >= 1 game plan created | Tap 📋 Plan Game on your game card | /game/:id/plan |
| 7 | Manage a live game | >= 1 game with status `in-progress` or `completed` | On game day, tap Start Game | /game/:id |

**Layout:**
- Card background: `--card-background` with `1px solid --border-color`
- Title: h2, `--primary-green`
- Progress bar: width = `(completed / 7) * 100%`, `--accent-green` background
- Each step: checkbox (checked/unchecked) + step title + direction text
- Font: step number in circle (optional), title bold, direction gray caption
- Actions: Expand/Collapse button (if collapsed) + Dismiss button (X icon)

**Persistence and visibility:**
- Checklist dismissal flag uses active key `quickStartChecklistDismissed` with compatibility key `onboarding:dismissed`
- Snapshot key `onboarding:lastCompletedSteps` stores a boolean[7] completion snapshot captured at dismiss time
- Checklist is **auto-hidden (dismissed) when all 7 steps are complete**; shows completion state for 4 seconds then auto-dismisses
- After auto-dismiss, checklist remains hidden on subsequent visits unless a valid snapshot regression is detected
- **Reopen conditions (snapshot-only):** Reopen only when dismissed is true, profile state is resolved, checklist source data is synced, snapshot is valid, and at least one previously true step regresses to false
- No fallback reopen path exists when the snapshot is missing or invalid
- Missing, malformed, or invalid snapshots (wrong length or non-boolean entries) do not reopen the checklist
- `onboarding:lastCompletedSteps` is removed only when a valid regression reopen occurs
- Checklist state persists across sign-out/sign-in

**States:**
- **Not started** — all steps unchecked; checklist visible
- **In progress** — mix of checked and unchecked; checklist visible
- **Complete** — all 7 steps checked; shows brief "All set!" message, auto-dismisses after 4 seconds, then hides until valid regression reopen conditions are met

#### Welcome Modal

**Purpose:** First-time greeting modal on app load; introduces profile concept and privacy assurance.

**Display:**
- Modal overlay on home page load (only shown once per browser profile; dismissed state persisted in localStorage)
- Centered card with white background
- z-index: `1000` (standard modal)

**Content:**

```
[Optional icon: Handshake or Welcome emoji]  27px

Hey there, Coach! 👋

Welcome to TeamTrack. Before you dive in, take a moment to complete 
your profile on the Profile tab (👤). Your first name helps teammates 
identify your notes during games.

[Privacy callout box, light green background:]
  🔒 Your profile is shared only with coaches on your teams.
  You control what others see (first name only, or with last initial).

[Buttons:]
  Get Started (primary button)
  [Optional: Learn more link (secondary)]
```

**Mobile layout (< 768px):**
- Modal takes 90vw width, max 320px
- Single column
- Buttons stacked vertically or side-by-side if space

**Tablet layout (≥ 768px):**
- Modal takes 400px width
- Same layout, buttons may be side-by-side

**Persistence and dismissal:**
- Shown on first app load; dismissed state is persisted in localStorage (active key `welcomeModalDismissed`, compatibility key `onboarding:welcomed`)
- **Welcome dismissal persists across sign-out and sign-in** (based on localStorage, not per-user backend state)
- New app install or cleared localStorage resets dismissal and shows modal again on next login

**Interactions:**
- Get Started button dismisses modal AND navigates to `/profile` tab
- Learn more link (future): opens help for profile completion
- Backdrop tap dismisses modal and returns to Home tab (no navigation)

**Accessibility:**
- Modal has `role="alertdialog"` or `role="dialog"`
- Focus trapped inside modal while open
- Escape key dismisses
- Heading uses `<h2>` or `<h1>` inside modal

---

### 7.13 Invitation Flow

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

### Live Note Modal (Shared Controller)
- One always-mounted shared live-note modal controller is owned by `GameManagement`.
- Entry paths: Notes tab note actions, in-progress CommandBand `Add note`, and halftime action-row `Add note`.
- All entry paths use one canonical editor and one canonical save path through `useOfflineMutations` secure note mutations.

#### Voice Behavior (iPhone Safari/Chrome focus)
- Dictation support target: iPhone Safari and iPhone Chrome.
- Explicit save only: no speech lifecycle event may persist notes.
- Low-confidence advisory appears when average final confidence is below `70%`.
- Silence auto-stop timeout is `10 seconds`.
- End cue includes visual confirmation plus short vibration when `navigator.vibrate` is available.

#### Keyboard + Accessibility Contract
- On open, initial focus lands on the modal title (h2) for screen reader context announcement; subsequent Tab reaches note type and dictation controls. Software keyboard may open on touch devices.
- `Stop` (while listening) and `Save` remain visible and tappable with keyboard open; modal body scrolls while footer actions stay sticky.
- Focus returns to the opening control when modal closes.
- Dictation controls provide stable accessible names: `Start English dictation` and `Stop dictation`.
- Message routing uses polite live updates for status and assertive announcements for blocking/error recovery guidance.

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
