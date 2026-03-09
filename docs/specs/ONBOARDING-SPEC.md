# Onboarding & Welcome Flow — Design Spec

> Status: Draft  
> Pattern: Quick-Start Checklist + one-time Welcome Modal  
> Target user: Coach who just created an account (zero data state)

---

## 1. Problem Statement

New coaches land on the Home (Games) tab and see a blank screen. There is no indication that they must first visit **Manage → Teams** to create a team before anything else becomes meaningful. The result is confusion and early drop-off.

Goal: orient the user immediately, surface the "Manage first" insight up front, then guide them step-by-step through the full workflow with a persistent but non-blocking checklist.

---

## 2. Flow Overview

```
Account created
      │
      ▼
Welcome Modal (3 slides, one-time)
  ├─ "Load sample team" CTA (optional demo data path)
  └─ "Open Quick Start" CTA
      │
      ▼
Quick Start Checklist (persistent card on Home tab)
  │  6 auto-tracking steps
  │  Each step navigates user to the right screen
  └─ Complete all 6 → Completion state → Dismissed forever
```

Re-entry at any time via **Help FAB → 📋 Quick Start Guide**.

---

## 3. Welcome Modal (Phase 1)

### Trigger
- Shown once, immediately after first authenticated load.
- Controlled by `localStorage.setItem('onboarding:welcomed', '1')`.
- Never shown again once set.

### Structure
Three slides with a dot-indicator and Back/Next navigation. Progress dots are tappable.

---

#### Slide 1 — "Welcome to TeamTrack"

```
┌────────────────────────────────┐
│          ⚽                    │
│   Welcome to TeamTrack         │
│                                │
│  Your game-day command center  │
│  for fair play and easy subs.  │
│                                │
│  ●  ○  ○                       │
│                                │
│   [  Let's get started →  ]    │
│         Skip setup             │
└────────────────────────────────┘
```

- **Headline:** "Welcome to TeamTrack"  
- **Body:** "Your game-day command center for fair play and easy subs."  
- **Primary CTA:** "Let's get started →" — advances to Slide 2  
- **Secondary CTA:** "Skip setup" (small, muted text link) — dismisses modal, checklist still appears on Home

---

#### Slide 2 — "How it works"

```
┌────────────────────────────────┐
│  How it works                  │
│                                │
│  ⚙️  Set up your team &        │
│      formation                 │
│                                │
│  📋  Plan fair rotations       │
│      before kickoff            │
│                                │
│  ⚽  Run the game live —       │
│      subs, scores, notes       │
│                                │
│  ○  ●  ○                       │
│  [ ← ]          [ → ]          │
└────────────────────────────────┘
```

Three bullet rows, icon + 1-line label. No explanatory prose — keep it scannable.

---

#### Slide 3 — "Your first step"

```
┌────────────────────────────────┐
│  Your first step               │
│                                │
│  ┌──────────────────────────┐  │
│  │ ⚙️ Tap the Manage tab   │  │
│  │ to create your team and  │  │
│  │ add your players first.  │  │
│  └──────────────────────────┘  │
│                                │
│  Want to explore first?        │
│  [ Load a sample team ]        │
│                                │
│  ○  ○  ●                       │
│  [ ← ]   [ Open Quick Start ] │
└────────────────────────────────┘
```

- **Callout box:** Highlighted card (accent border) pointing at the Manage tab. Copy: *"Tap the **Manage** tab ⚙️ to create your team and add your players first. Without a team, the Games tab will stay empty."*  
- **Optional CTA:** "Load a sample team" (secondary/ghost button) — see §5 Demo Data  
- **Primary CTA:** "Open Quick Start" — dismisses modal and ensures the checklist card is expanded on Home

---

### Modal Specs

| Property | Value |
|----------|-------|
| Width | `min(95vw, 480px)` (matches HelpModal) |
| Height | `auto`, max `85vh` |
| z-index | `1000` (same as `.modal-overlay`) |
| Backdrop | Semi-transparent, tap-to-dismiss only on Slide 1 (treat Slide 3 as intentional so skip is explicit) |
| Close button | ✕ top-right, always visible |
| Animation | Slide-in from bottom (matches HelpFab sheet pattern) |

---

## 4. Quick Start Checklist (Phase 2)

### Placement

A card rendered at the **top of the Home tab**, below the `"+ Schedule New Game"` button and above the game list. It is part of the page scroll (not a modal, not a FAB overlay).

```
Home (Games tab)
├─ [+ Schedule New Game]          ← existing
├─ ┌── Quick Start ───────────┐   ← new card
│  │  Get ready for game day  │
│  │  ███████░░░░  3 of 6     │
│  │                          │
│  │  ✓ Create your team      │
│  │  ✓ Add players           │
│  │  ○ Set your formation  → │
│  │  ○ Schedule a game     → │
│  │  ○ Plan your rotations → │
│  │  ○ Manage a live game  → │
│  │                     [✕] │
│  └──────────────────────────┘
├─ Active Games …
└─ Upcoming Games …
```

### Header

- Title: **"Get ready for game day"**
- Progress bar: thin bar + label `"N of 6 steps complete"`
- Collapse/expand: tapping the header row (or chevron) collapses the step list; summary label remains visible
- ✕ dismiss button: top-right — hides the card to a collapsed re-entry state (see §4.4)

### The 6 Steps

| # | Step title | Direction copy | Auto-complete condition |
|---|-----------|----------------|------------------------|
| 1 | Create your team | "Go to **Manage → Teams**" | `teams.length >= 1` |
| 2 | Add players to your roster | "Go to **Manage → Players**" | any team has `roster.length >= 1` |
| 3 | Set your formation | "Go to **Manage → Teams** and assign a formation" | any team has a non-null `formationId` |
| 4 | Schedule a game | "Tap **+ Schedule New Game** above" | `games.length >= 1` |
| 5 | Plan your rotations | "Tap **📋 Plan Game** on your game card" | any `GamePlan` record exists |
| 6 | Manage a live game | "On game day, tap **Start Game** to go live" | any game has status `in-progress` or `completed` |

Steps 1–3 must be sequentially completed before 4–6 become actionable. Steps that are blocked show a muted lock icon instead of an arrow and display: *"Complete step N first."*

### Step Row Anatomy

```
[✓ / ○]  Step title                          [→]
          Direction copy (small, muted)
```

- **Completed row:** filled green checkmark, title in muted text, no arrow  
- **Active row:** empty circle (accent color border), title in full weight, arrow → tapping navigates  
- **Locked row:** lock icon (gray), title muted, direction text replaced with "Complete the previous step first"  
- Tapping an **active** step row either: (a) navigates to the target screen, or (b) for step 4, smoothly scrolls up to the "Schedule New Game" button and briefly highlights it

### Navigation Targets

| Step | Action on tap |
|------|--------------|
| 1 | `navigate('/manage')` + set Management sub-view to Teams |
| 2 | `navigate('/manage')` + set sub-view to Players |
| 3 | `navigate('/manage')` + set sub-view to Teams |
| 4 | Scroll to `+ Schedule New Game` button, animate highlight |
| 5 | If a scheduled game exists: navigate to `/game/:firstScheduledGameId/plan`. Else: no-op (shouldn't be reachable unlocked). |
| 6 | Navigate to `/game/:firstNonCompletedGameId`. If none: highlight step 4 instead. |

> For steps 1–3, `Management.tsx` needs to accept a query param (e.g., `?section=teams`) so the checklist can deep-link to the right sub-view.

### Completion State

Once all 6 steps are checked, the card transitions:

```
┌──────────────────────────────┐
│  🎉 You're ready!            │
│  All set — enjoy game day    │
│                              │
│  [ Got it ]                  │
└──────────────────────────────┘
```

- Auto-dismisses after 4 seconds or on "Got it" tap  
- Sets `localStorage.setItem('onboarding:dismissed', '1')` — checklist never shown again  
- The "Quick Start Guide" option in the Help FAB sheet changes to: `"📋 Quick Start — complete ✓"` (disabled/grayed)

### 4.4 — Re-Entry After Dismiss (Before Completion)

If the user taps ✕ before completing all steps:
- The checklist card collapses to a compact **resume banner** at the top of Home: `"📋 Setup: 3 of 6 complete — Resume →"`
- Tapping the banner re-expands the card
- Alternatively accessible via **Help FAB → 📋 Quick Start Guide** (see §6)

### Persistence Model

| Key | Value | Meaning |
|-----|-------|---------|
| `onboarding:welcomed` | `'1'` | Welcome modal already shown — never show again |
| `onboarding:dismissed` | `'1'` | Checklist permanently dismissed (all done or explicitly closed after completion) |
| `onboarding:collapsed` | `'1'` | Card is collapsed but not dismissed — show resume banner |

Step completion is derived **live from real data** (no stored state). The checklist re-evaluates on every render of the Home tab using the same `teams[]` and `games[]` already loaded.

---

## 5. Demo Data (Optional Path)

Triggered by "Load a sample team" on Welcome Modal Slide 3.

### What gets created

| Record | Value |
|--------|-------|
| Team | "Eagles Demo" (tagged as demo) |
| Formation | "4-3-3" (from existing templates) |
| Players | 12 players: "Sam", "Alex", "Jordan", "Riley", "Casey", "Taylor", "Morgan", "Drew", "Quinn", "Blake", "Avery", "Reese" |
| Game | "Eagles Demo vs Lions" — status `scheduled`, today + 3 days |

Steps 1–4 auto-mark as complete after seed. The checklist opens at step 5 "Plan your rotations."

### Demo data indicator

- The "Eagles Demo" team card in Manage shows a `Demo` badge
- A subtle banner on the Home card: *"Playing with demo data"*

### Removal

- **Manage → App → Remove demo data** — deletes the demo team and all associated records with a confirmation modal ("This will delete Eagles Demo and all related data.")
- The checklist is unaffected — completed steps remain checked if real data exists, or uncheck if demo data was the only data.

---

## 6. Help FAB Additions

A new third menu item is added to the `HelpFab` bottom sheet, between "Get Help" and the existing footer:

```
┌─────────────────────────────────┐
│ 🐛 Report a Bug                 │
│ 📖 Get Help                     │  (enabled/disabled per existing logic)
│ 📋 Quick Start Guide      ────  │  (new)
│    Resume your setup checklist  │
└─────────────────────────────────┘
```

**"Quick Start Guide" behavior:**

| Onboarding state | Button state | Tap action |
|-----------------|-------------|------------|
| Not dismissed, any progress | Enabled | Navigate to `/`, expand checklist card |
| Permanently dismissed | Disabled | Label: "Quick Start — complete ✓", subtitle: "All done!" |
| `welcomed` not set yet | Hidden | (user hasn't seen modal; modal will show on next Home visit) |

---

## 7. Copywriting — Step Guidance Detail

Full copy for each step's direction text:

**Step 1 — Create your team**
> Go to **Manage ⚙️ → Teams**. Tap "Add Team", give it a name, and choose how many players are on the field.

**Step 2 — Add players**
> Go to **Manage ⚙️ → Players**. Tap "Add Player" to build your roster. You'll need at least as many players as your formation has positions.

**Step 3 — Set your formation**
> Go to **Manage ⚙️ → Teams**, open your team, and assign a formation. Formations define how many players are in each line.

**Step 4 — Schedule a game**
> Tap **+ Schedule New Game** (top of this screen). Pick your team, opponent, and date.

**Step 5 — Plan your rotations**
> Tap **📋 Plan Game** on your game card below. TeamTrack will auto-generate a fair rotation so every player gets equal time.

**Step 6 — Manage a live game**
> On game day, open your game and tap **Start Game**. Use the Lineup tab for substitutions, the score tracker at the top, and Notes to flag standout plays or cards.

---

## 8. Accessibility & Responsive Notes

- The checklist card must be fully keyboard-navigable and announced by screen readers
- Step rows use `role="button"` with `aria-label="Go to [step title]"` and `aria-disabled` for locked steps
- Progress bar: `role="progressbar" aria-valuenow={completed} aria-valuemax={6} aria-label="Onboarding progress"`
- Welcome modal uses the same focus-trap pattern as `HelpModal.tsx` (focus on h2 on open, restored on close)
- On narrow phones (≤ 375px), step rows stack the direction text below the title (already the default flow layout)
- The checklist card does not cover the bottom nav — it is in-scroll, not fixed

---

## 9. Implementation Notes (for Implementer)

### New files
- `src/components/Onboarding/WelcomeModal.tsx` + `.css`
- `src/components/Onboarding/QuickStartChecklist.tsx` + `.css`
- `src/contexts/OnboardingContext.tsx` — provides `{ welcomed, collapsed, dismissed, markWelcomed, collapse, dismiss, resetOnboarding }` with localStorage backing
- `src/hooks/useOnboardingProgress.ts` — derives step completion from `teams[]`, `games[]`, and Amplify data; returns `{ steps: StepState[], completedCount: number }`

### Modified files
| File | Change |
|------|--------|
| `src/components/Home.tsx` | Render `<WelcomeModal>` (if `!welcomed`) and `<QuickStartChecklist>` (if `!dismissed`) |
| `src/components/HelpFab.tsx` | Add "📋 Quick Start Guide" menu option |
| `src/components/AppLayout.tsx` | Wrap with `<OnboardingProvider>` |
| `src/components/Management.tsx` | Accept `?section=teams\|players\|formations` query param to open sub-view |
| `src/help.ts` | No changes needed (Welcome flow is separate from the Help system) |

### Demo data
- Reuse the existing `client.models.*` creation pattern from `seed.ts`
- Add `isDemo: Boolean` field to `Team` schema (or use a name-convention tag if schema change is undesirable)
- Gate the "Remove demo data" action behind a `window.confirm` modal (use existing `ConfirmModal.tsx`)

### No new HelpScreenKey needed
The checklist is not a screen — it does not register a `helpContext`. The Help FAB "Quick Start Guide" option drives directly to the checklist, bypassing `HelpModal`.

---

## 10. Out of Scope

- Multi-coach invitation step: not included in the checklist. The Manage → Sharing section will surface this naturally once a team exists. A tooltip or callout there can be added in a follow-up.
- In-game first-use tooltips (Command Band, SubstitutionPanel): front-loaded into Step 6 copy above. No separate triggers.
- Analytics events for onboarding steps: tracked as `onboarding_step_complete` with `{ step: number, stepName: string }` per the existing analytics pattern in `src/utils/analytics.ts`.

---

## 11. Plan Amendments (from Architect Review)

### C1 � useOnboardingProgress step 2: use flat 	eamRosters list
	.roster?.length does not work with Amplify Gen2 lazy-loading. Pass 	eamRosters: TeamRoster[] as a 4th parameter:
- Step 2: 	eamRosters.some(r => teams.some(t => t.id === r.teamId))
- In Home.tsx: add useAmplifyQuery('TeamRoster') and pass to hook

### M1 � removeDemoData must delete orphaned Players
cascadeDeleteService.deleteTeamCascade does not delete underlying Player records. demoDataService.removeDemoData must:
1. Fetch all TeamRoster entries for the demo team
2. Extract playerId values  
3. Call deletePlayerCascade(playerId) for each
4. Then call deleteTeamCascade(teamId)
Rename emoveDemoTeam ? emoveDemoData.

### M2 � Demo data: skip Formation creation entirely
Do not create a Formation in createDemoTeam. Set ormationId: null on the demo Team.
Step 3 ("Set your formation") becomes a genuine user task � better UX.
This removes 7�8 extra FormationPosition create calls from the demo flow.

### M3 � coaches array is mandatory on EVERY create in demoDataService
Every client.models.X.create() call MUST include coaches: [currentUserId].
Affected: Team, 12� Player, 12� TeamRoster, Game. (49 total field values across 26 creates.)

### M4 � Management ?section= is read-only; no useEffect to write back URL
Read the param once in useState(() => searchParams.get('section') ?? 'teams').
Do NOT add a useEffect that calls setSearchParams on every tab change � breaks back-button.
The query param is a one-way entry point for checklist navigation only.

### M5 � Switch Home.tsx teams loading to subscription-based useAmplifyQuery
Replace imperative client.models.Team.list() + useState<Team[]> with useAmplifyQuery('Team').
This ensures steps 1, 2, 3 mark complete in real-time after team creation without a page reload.
loadTeams() function and its useState can be removed.

### Minor amendments incorporated
- Min3: All isDemo checks use 	eam.isDemo === true (not !team.isDemo) to handle null on existing records
- Min4: Check 
avigator.onLine before createDemoTeam; show error toast if offline
- Min5: Remove step locking concept � all 6 steps show evaluated completion state; no locked UI state
