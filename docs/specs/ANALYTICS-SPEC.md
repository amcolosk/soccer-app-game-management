# Analytics Specification — TeamTrack

**Tool:** Google Analytics 4 (via `react-ga4`)  
**Implementation file:** `src/utils/analytics.ts`  
**Initialization:** `src/main.tsx` — reads `custom.ga_measurement_id` from `amplify_outputs.json`

---

## Goals & Key Questions

As a coaching tool, the metrics that matter most are:

1. **Activation** — Do coaches complete the setup flow (team → players → formation → first game)?
2. **Game day engagement** — Is the live game management feature (substitutions, rotation, goals) actually used?
3. **Retention signal** — Are coaches returning for multiple games / viewing season reports?
4. **Collaboration** — Is multi-coach sharing being used?
5. **Quality** — Are users encountering issues (bug reports, help views)?

---

## Page Views

Tracked automatically on every route change by `AppLayout.tsx`.

| Path | Screen |
|------|--------|
| `/` | Home / Games list |
| `/game/:id` | Live game management |
| `/game/:id/plan` | Game planner |
| `/reports/:teamId` | Season report |
| `/manage` | Team/player/formation management |
| `/profile` | User profile & invitations |
| `/invitation/:token` | Invitation acceptance |

---

## Custom Events

All events use the schema: `trackEvent(category, action, label?)`.

### Category: `Landing`

| Action | Label | Trigger |
|--------|-------|---------|
| `Click Get Started` | — | "Get Started" button on landing page |
| `Click Log In` | — | "Log In" button on landing page |

### Category: `Team`

| Action | Label | Trigger |
|--------|-------|---------|
| `Create Team` | — | Team successfully created |
| `Delete Team` | — | Team confirmed deleted |

### Category: `Player`

| Action | Label | Trigger |
|--------|-------|---------|
| `Add Player` | — | New global player created |
| `Add Player to Roster` | — | Existing player added to a team's roster |
| `Delete Player` | — | Player confirmed deleted |

### Category: `Formation`

| Action | Label | Trigger |
|--------|-------|---------|
| `Create Formation` | — | Formation saved |
| `Delete Formation` | — | Formation confirmed deleted |

### Category: `Game`

| Action | Label | Trigger |
|--------|-------|---------|
| `Create Game` | — | Game scheduled |
| `Start Game` | — | First half begins |
| `Halftime` | — | Coach taps "End Half" |
| `Start Second Half` | — | Second half begins |
| `Complete Game` | — | Game marked complete |
| `Delete Game` | — | Game confirmed deleted |

### Category: `GameDay`

High-frequency in-game actions tracked separately from coarse game lifecycle events.

| Action | Label | Trigger |
|--------|-------|---------|
| `Substitution Made` | — | Any substitution executed (immediate or from queue) |
| `All Substitutions Executed` | — | "Execute All" subs applied at once |
| `Rotation Recalculated` | — | Mid-game "Recalculate Rotations" |
| `Rotation Widget Opened` | — | Rotation preview modal opened |
| `Goal Recorded` | `own` \| `opponent` | Goal scored or conceded |
| `Player Marked Injured` | — | Player marked unavailable mid-game |

### Category: `GamePlanner`

| Action | Label | Trigger |
|--------|-------|---------|
| `Plan Saved` | — | Game plan saved/updated |
| `Auto-Generate Rotations` | — | Rotation algorithm executed |
| `Copy Plan From Game` | — | Plan copied from a previous game |

### Category: `Availability`

| Action | Label | Trigger |
|--------|-------|---------|
| `Mark Player` | `available` \| `absent` \| `late` | Availability status toggled for a player |

### Category: `Report`

| Action | Label | Trigger |
|--------|-------|---------|
| `View Season Report` | — | Season report component loaded |

### Category: `Sharing`

| Action | Label | Trigger |
|--------|-------|---------|
| `Send Invitation` | — | Invitation email sent |
| `Accept Invitation` | — | Invited coach accepts |
| `Decline Invitation` | — | Invited coach declines |

### Category: `Help`

| Action | Label | Trigger |
|--------|-------|---------|
| `Open Help` | `<helpContextKey>` | Help article opened (label = screen key e.g. `game-management`) |
| `Open Bug Report` | — | Bug report form opened from FAB |

### Category: `BugReport`

| Action | Label | Trigger |
|--------|-------|---------|
| `Submit` | `bug` \| `feature-request` | Report successfully submitted to GitHub |

### Category: `Account`

| Action | Label | Trigger |
|--------|-------|---------|
| `Change Password` | — | Password successfully changed |
| `Delete Account` | — | Account deleted |

---

## Events Intentionally Not Tracked

| Action | Reason |
|--------|--------|
| Timer pause/resume | High noise, low signal — timers are paused and unpaused frequently during normal play |
| Per-player lineup drag-and-drop | Too granular; track plan save instead |
| Individual note additions (yellow card, gold star) | Low decision value |
| Every availability toggle in bulk-edit mode | Track per-toggle to see engagement, but de-duplicate at analysis time |
| Formation position edits | Low frequency, negligible signal |

---

## Implementation Status

| Event | Status |
|-------|--------|
| Page views | ✅ Implemented |
| Landing → Click Get Started | ✅ Implemented |
| Landing → Click Log In | ✅ Implemented |
| Team → Create Team | ✅ Implemented |
| Player → Add Player | ✅ Implemented |
| Game → Start Game | ✅ Implemented |
| Game → Complete Game | ✅ Implemented |
| Report → View Season Report | ✅ Implemented |
| Sharing → Send Invitation | ✅ Implemented |
| Game → Create Game | ✅ Implemented |
| Game → Delete Game | ✅ Implemented |
| Game → Halftime | ✅ Implemented |
| Game → Start Second Half | ✅ Implemented |
| GameDay → Substitution Made | ✅ Implemented |
| GameDay → All Substitutions Executed | ✅ Implemented |
| GameDay → Rotation Recalculated | ✅ Implemented |
| GameDay → Rotation Widget Opened | ✅ Implemented |
| GameDay → Goal Recorded | ✅ Implemented |
| GameDay → Player Marked Injured | ✅ Implemented |
| GamePlanner → Plan Saved | ✅ Implemented |
| GamePlanner → Auto-Generate Rotations | ✅ Implemented |
| GamePlanner → Copy Plan From Game | ✅ Implemented |
| Availability → Mark Player | ✅ Implemented |
| Team → Delete Team | ✅ Implemented |
| Player → Add Player to Roster | ✅ Implemented |
| Player → Delete Player | ✅ Implemented |
| Formation → Create Formation | ✅ Implemented |
| Formation → Delete Formation | ✅ Implemented |
| Sharing → Accept Invitation | ✅ Implemented |
| Sharing → Decline Invitation | ✅ Implemented |
| Help → Open Help | ✅ Implemented |
| Help → Open Bug Report | ✅ Implemented |
| BugReport → Submit | ✅ Implemented |
| Account → Change Password | ✅ Implemented |
| Account → Delete Account | ✅ Implemented |
