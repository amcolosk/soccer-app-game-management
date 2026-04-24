/**
 * TeamTrack Help System - Types and Content
 *
 * Single-module barrel for the Phase 1 context-aware help feature.
 * Exports HelpScreenKey (type) and HELP_CONTENT (value).
 *
 * Internal interfaces (HelpTask, HelpTip, ScreenHelpContent, HelpContentRegistry)
 * are not exported to avoid knip "unused export" warnings in Phase 1.
 * They can be exported in Phase 2 when additional consumers exist.
 *
 * Phase 2 note: OnboardingContent is intentionally omitted here until
 * OnboardingOverlay.tsx is implemented.
 */

// ---------------------------------------------------------------------------
// Exported types - these have consumers in Phase 1
// ---------------------------------------------------------------------------

/**
 * Identifies which help article to display.
 * One key per distinct screen context where help content differs meaningfully.
 *
 * GameManagement uses four keys - one per game state - because each state
 * surfaces different affordances and the coach's questions differ entirely.
 *
 * Management uses five keys - one per sub-section - because Teams setup help
 * is unrelated to Sharing/Permissions help.
 */
export type HelpScreenKey =
  // Home screen
  | 'home'
  // Game Management - four states derived from gameState.status
  | 'game-scheduled'
  | 'game-in-progress'
  | 'game-halftime'
  | 'game-completed'
  // Game Planner
  | 'game-planner'
  // Season Reports
  | 'season-reports'
  // Management - five sub-sections matching activeSection values
  | 'manage-teams'
  | 'manage-players'
  | 'manage-formations'
  | 'manage-sharing'
  | 'manage-app'
  // User Profile
  | 'profile'
  // Formation Visual Editor (modal, sub-context of manage-formations)
  | 'formation-visual-editor';

// ---------------------------------------------------------------------------
// Internal types - used for type-checking HELP_CONTENT; not exported in Phase 1
// ---------------------------------------------------------------------------

/**
 * A single "How do I...?" task entry.
 * Displayed as a numbered list of steps under a bolded title.
 */
interface HelpTask {
  /** e.g. "Make a substitution mid-game" */
  title: string;
  /** Ordered, imperative instructions. Max 6 steps per task. */
  steps: string[];
}

/**
 * A pro tip, shortcut, or important warning.
 * Displayed as a highlighted callout card with a green left border.
 */
interface HelpTip {
  /** Plain text only. No markdown, no HTML. Keep under 80 characters. */
  text: string;
}

/**
 * The complete help article for one screen context.
 */
interface ScreenHelpContent {
  /**
   * Display title in the modal header.
   * Should match the screen name as the coach sees it in the UI.
   */
  screenTitle: string;

  /**
  * 1-2 sentence plain-English description of what this screen is for.
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
   * Rendered as navigation affordances at the bottom of the modal.
   * Max 2 related screens.
   */
  relatedScreens?: HelpScreenKey[];
}

/**
 * The complete registry of all help articles, keyed by HelpScreenKey.
 * TypeScript enforces that all 13 keys are present.
 */
type HelpContentRegistry = Record<HelpScreenKey, ScreenHelpContent>;

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/**
 * The complete registry of all 13 screen help articles.
 * TypeScript's Record type ensures a compile error if any key is missing.
 */
export const HELP_CONTENT: HelpContentRegistry = {
  // @help-content: home
  'home': {
    screenTitle: 'Games List',
    overview: 'This is your home screen - it shows all your games grouped by status: active, upcoming, and past. Tap any game card to open it.',
    tasks: [
      {
        title: 'Schedule a new game',
        steps: [
          'Tap "+ Schedule New Game" at the top of the screen.',
          'Select your team from the dropdown.',
          'Enter the opponent name and choose a date and time.',
          'Toggle "Home Game" on if you are playing at your home field.',
          'Tap "Create" to save the game.',
        ],
      },
      {
        title: 'Open an existing game',
        steps: [
          'Tap the game card in the list to open it.',
        ],
      },
      {
        title: 'Delete a game',
        steps: [
          'Tap the game card to open it.',
          'Scroll to the bottom of the game screen.',
          'Tap "Delete Game" and confirm.',
        ],
      },
    ],
    tips: [
      { text: 'Active and in-progress games always appear at the top of the list.' },
      { text: 'Completed games appear at the bottom, sorted most recent first.' },
    ],
    relatedScreens: ['game-scheduled', 'manage-teams'],
  },

  // @help-content: game-scheduled
  'game-scheduled': {
    screenTitle: 'Game Management - Pre-Game',
    overview: 'Before kick-off, mark which players are available and open the Game Planner to set your rotation. When the roster is ready, tap "Start Game" to begin.',
    tasks: [
      {
        title: 'Mark a player\'s availability',
        steps: [
          'Find the player in the availability grid.',
          'Tap their availability chip to cycle through statuses.',
          'Choose Available, Absent, or Late Arrival.',
        ],
      },
      {
        title: 'Understand availability statuses',
        steps: [
          'Available - player is present and ready to play from kick-off.',
          'Absent - player is not at the game; excluded from all rotations.',
          'Late Arrival - player will arrive partway through the game.',
          'For Late Arrival, enter the expected arrival minute so the planner accounts for them.',
        ],
      },
      {
        title: 'Open the Game Planner before kick-off',
        steps: [
          'Tap the "Game Planner" button on this screen.',
          'Set your starting lineup and generate rotations.',
          'Return here when ready to start the game.',
        ],
      },
      {
        title: 'Start the game',
        steps: [
          'Confirm all availability is set correctly.',
          'Tap "Start Game" to begin the first half.',
        ],
      },
    ],
    tips: [
      { text: 'Setting availability before kick-off enables fair rotation calculations.' },
      { text: 'Late Arrival players are included in rotations from their expected arrival time.' },
    ],
    relatedScreens: ['game-planner', 'game-in-progress'],
  },

  // @help-content: game-in-progress
  'game-in-progress': {
    screenTitle: 'Game Management - In Progress',
    overview: 'Manage the live game: swap players in and out, record goals, log notes, and track who needs more time on the field.',
    tasks: [
      {
        title: 'Make a substitution',
        steps: [
          'Go to the Lineup tab.',
          'Tap the position you want to change.',
          'Select the bench player you want to bring on.',
          'Confirm the substitution.',
        ],
      },
      {
        title: 'Record a goal',
        steps: [
          'Go to the Goals tab.',
          'Tap "+ Home Goal" or "+ Away Goal".',
          'Optionally select the goal scorer from your roster.',
          'Tap "Save Goal".',
        ],
      },
      {
        title: 'Log a player note (card or gold star)',
        steps: [
          'Go to the Notes tab.',
          'Tap the icon next to the player\'s name.',
          'Choose Yellow Card, Red Card, or Gold Star.',
        ],
      },
      {
        title: 'Find the next player to bring on',
        steps: [
          'Go to the Bench tab.',
          'Players are sorted by least play time - bring on the player at the top.',
        ],
      },
    ],
    tips: [
      { text: 'The rotation widget shows when the next planned rotation is due.' },
      { text: 'Bench tab automatically sorts by least play time to guide fair rotation.' },
      { text: 'Pause the timer during stoppages to keep play-time records accurate.' },
    ],
    relatedScreens: ['game-planner', 'game-halftime'],
  },

  // @help-content: game-halftime
  'game-halftime': {
    screenTitle: 'Game Management - Halftime',
    overview: 'Adjust your lineup for the second half before restarting. The halftime lineup defaults to the second-half rotation from your Game Planner.',
    tasks: [
      {
        title: 'Change a player\'s starting position for the second half',
        steps: [
          'The Lineup tab shows the proposed halftime lineup.',
          'Tap a position to swap the player assigned to it.',
          'Select the replacement player from the list.',
        ],
      },
      {
        title: 'Understand the halftime lineup',
        steps: [
          'If you have a Game Planner rotation set, the halftime lineup is pre-populated from it.',
          'If no planner is set, the halftime lineup mirrors the end-of-first-half lineup.',
          'Changes here do not affect first-half play-time records.',
        ],
      },
      {
        title: 'Start the second half',
        steps: [
          'Review the halftime lineup on the Lineup tab.',
          'Tap "Start 2nd Half" when ready.',
        ],
      },
    ],
    tips: [
      { text: 'Changes to the lineup at halftime don\'t affect first-half play-time records.' },
      { text: 'If the planner has a second-half rotation, the halftime lineup is pre-filled.' },
    ],
    relatedScreens: ['game-planner', 'game-in-progress'],
  },

  // @help-content: game-completed
  'game-completed': {
    screenTitle: 'Game Management - Completed',
    overview: 'Review the final result and play-time summary for each player. This game\'s data is automatically included in your Season Report.',
    tasks: [
      {
        title: 'View play time per player',
        steps: [
          'The completed game screen shows a play-time summary for each player.',
          'Scroll down to see all players and their minutes played.',
        ],
      },
      {
        title: 'Navigate to the Season Report',
        steps: [
          'Tap the Reports tab in the bottom navigation.',
          'Select your team to view cumulative season stats.',
        ],
      },
    ],
    tips: [
      { text: 'Play-time data from this game feeds the Season Report automatically.' },
      { text: 'Completed games cannot be restarted. Contact support if ended in error.' },
    ],
    relatedScreens: ['season-reports', 'home'],
  },

  // @help-content: game-planner
  'game-planner': {
    screenTitle: 'Game Planner',
    overview: 'Plan your rotation schedule before the game - set a starting lineup, mark availability, and generate fair rotations so every player gets equal time.',
    tasks: [
      {
        title: 'Set the starting lineup',
        steps: [
          'Go to the Lineup tab.',
          'Drag players from the bench list onto the field positions.',
          'All positions must be filled before you can generate rotations.',
        ],
      },
      {
        title: 'Set a player\'s availability for this game',
        steps: [
          'Go to the Availability tab.',
          'Tap a player\'s status chip to change it.',
          'For Late Arrival, enter the expected arrival minute.',
        ],
      },
      {
        title: 'Generate a fair rotation plan',
        steps: [
          'Set your starting lineup and confirm availability first.',
          'Tap "Calculate Rotations".',
          'The planner distributes minutes fairly across available players.',
          'Review the rotation timeline and adjust if needed.',
        ],
      },
      {
        title: 'Copy a plan from a previous game',
        steps: [
          'Tap "Copy from Previous Game".',
          'Select a past game with a saved plan.',
          'The plan is applied to this game - edit as needed.',
        ],
      },
    ],
    tips: [
      { text: 'The rotation interval (default 10 min) controls how often swaps happen per half.' },
      { text: 'Late Arrival players are automatically included from their arrival minute.' },
      { text: 'Changes made here are reflected in the in-game rotation widget.' },
    ],
    relatedScreens: ['game-scheduled', 'game-in-progress'],
  },

  // @help-content: season-reports
  'season-reports': {
    screenTitle: 'Season Reports',
    overview: 'View cumulative play time, goals, and statistics for every player across all completed games in the season.',
    tasks: [
      {
        title: 'Read a player\'s season stats',
        steps: [
          'Find the player row in the stats table.',
          'Columns show total play time, goals, assists, gold stars, and cards.',
          'Tap the player row to expand their game-by-game breakdown.',
        ],
      },
      {
        title: 'Sort the stats table',
        steps: [
          'Tap a column header (e.g., "Play Time" or "Goals") to sort by that column.',
          'Tap again to reverse the sort order.',
        ],
      },
      {
        title: 'Filter by team',
        steps: [
          'If you manage multiple teams, use the team selector at the top.',
          'Select a team to show stats for that team only.',
        ],
      },
    ],
    tips: [
      { text: 'Only completed games are included in season totals.' },
      { text: 'Gold stars and cards are tracked per game and summed here.' },
    ],
    relatedScreens: ['game-completed', 'home'],
  },

  // @help-content: manage-teams
  'manage-teams': {
    screenTitle: 'Management - Teams',
    overview: 'Create and configure your teams, including half length, maximum players on field, and the formation used for lineups.',
    tasks: [
      {
        title: 'Create a new team',
        steps: [
          'Tap "+ Add Team".',
          'Enter the team name.',
          'Set the half length in minutes.',
          'Set the maximum number of players on the field.',
          'Choose a formation from the list.',
          'Tap "Save" to create the team.',
        ],
      },
      {
        title: 'Edit an existing team',
        steps: [
          'Tap the team name to expand its settings.',
          'Tap "Edit" to change the team details.',
          'Update the fields and tap "Save".',
        ],
      },
      {
        title: 'Delete a team',
        steps: [
          'Swipe the team row to the left to reveal the delete action.',
          'Tap "Delete" and confirm.',
          'Warning: deleting a team removes all associated roster entries and games.',
        ],
      },
    ],
    tips: [
      { text: 'Half length and max players affect the rotation planner\'s calculations.' },
      { text: 'You can share a team with another coach from the Sharing tab.' },
    ],
    relatedScreens: ['manage-formations', 'manage-sharing'],
  },

  // @help-content: manage-players
  'manage-players': {
    screenTitle: 'Management - Players',
    overview: 'Manage your player roster - add players, assign jersey numbers, set preferred positions, and assign players to teams.',
    tasks: [
      {
        title: 'Add a new player',
        steps: [
          'Tap "+ Add Player".',
          'Enter the player\'s first and last name.',
          'Enter their jersey number.',
          'Tap "Save" to add the player.',
        ],
      },
      {
        title: 'Assign a player to a team',
        steps: [
          'Find the player in the players list.',
          'Expand their entry and tap "Add to Team".',
          'Select the team from the dropdown.',
          'Tap "Save".',
        ],
      },
      {
        title: 'Set preferred positions for a player',
        steps: [
          'Expand the player\'s entry.',
          'Tap position chips to toggle them on or off.',
          'Selected positions are the player\'s preferences for the rotation planner.',
        ],
      },
      {
        title: 'Remove a player from a team',
        steps: [
          'Find the player in the team\'s roster.',
          'Swipe their roster entry to the left.',
          'Tap "Remove" and confirm.',
        ],
      },
    ],
    tips: [
      { text: 'Jersey numbers are used to sort players in the bench and lineup views.' },
      { text: 'Preferred positions guide the rotation planner when assigning field spots.' },
    ],
    relatedScreens: ['manage-teams', 'game-planner'],
  },

  // @help-content: manage-formations
  'manage-formations': {
    screenTitle: 'Management - Formations',
    overview: 'Create and manage field formations that define the position slots available in your lineup and Game Planner.',
    tasks: [
      {
        title: 'Create a new formation',
        steps: [
          'Tap "+ Add Formation".',
          'Enter a name for the formation (e.g., "4-3-3").',
          'Set the number of field players.',
          'Add position slots with names and abbreviations.',
          'Tap "Save".',
        ],
      },
      {
        title: 'Assign a formation to a team',
        steps: [
          'Go to the Teams tab.',
          'Expand the team and tap "Edit".',
          'Select the formation from the dropdown.',
          'Tap "Save".',
        ],
      },
      {
        title: 'Delete a formation',
        steps: [
          'Swipe the formation row to the left.',
          'Tap "Delete" and confirm.',
          'Note: formations in use by a team cannot be deleted.',
        ],
      },
    ],
    tips: [
      { text: 'A formation defines the position names shown in the Game Planner and live game.' },
      { text: 'Built-in formation templates are available to start from common configurations.' },
    ],
    relatedScreens: ['manage-teams', 'game-planner'],
  },

  // @help-content: manage-sharing
  'manage-sharing': {
    screenTitle: 'Management - Sharing & Permissions',
    overview: 'Invite other coaches to view or co-manage your team. Manage pending invitations you have sent and accept ones sent to you.',
    tasks: [
      {
        title: 'Invite a coach to your team',
        steps: [
          'Tap "Invite Coach".',
          'Enter the coach\'s email address.',
          'Select which team to share.',
          'Tap "Send Invitation".',
        ],
      },
      {
        title: 'Check pending invitations you have sent',
        steps: [
          'Scroll down to the "Sent Invitations" list.',
          'Each entry shows the recipient email and status (Pending or Accepted).',
        ],
      },
      {
        title: 'Accept an invitation sent to you',
        steps: [
          'Go to your Profile (tap the Profile tab in the bottom nav).',
          'Pending invitations appear at the top of the Profile screen.',
          'Tap "Accept" or "Decline" next to the invitation.',
        ],
      },
    ],
    tips: [
      { text: 'Invited coaches can view game data but cannot delete the team or send invitations.' },
      { text: 'Invitations expire after 7 days if not accepted.' },
    ],
    relatedScreens: ['manage-teams', 'profile'],
  },

  // @help-content: manage-app
  'manage-app': {
    screenTitle: 'Management - App Settings',
    overview: 'Configure app-wide preferences, view the current app version, and access developer tools. Settings here apply to all teams.',
    tasks: [
      {
        title: 'View the app version',
        steps: [
          'The current app version is shown at the bottom of this section.',
        ],
      },
      {
        title: 'Report a bug or give feedback',
        steps: [
          'Tap the ? button in the bottom-right corner of any screen.',
          'Tap "Report a Bug" in the menu.',
          'Describe the issue and tap "Submit Report".',
        ],
      },
    ],
    tips: [
      { text: 'App settings here affect all your teams, not just one.' },
    ],
    relatedScreens: ['profile'],
  },

  // @help-content: profile
  'profile': {
    screenTitle: 'Profile',
    overview: 'Manage your account details, change your password, accept team invitations from other coaches, and sign out.',
    tasks: [
      {
        title: 'Change your password',
        steps: [
          'Enter your current password in the "Current Password" field.',
          'Enter your new password in "New Password".',
          'Confirm the new password in "Confirm Password".',
          'Tap "Change Password".',
        ],
      },
      {
        title: 'Accept a pending team invitation',
        steps: [
          'Pending invitations appear at the top of this screen.',
          'Tap "Accept" to join the team, or "Decline" to reject the invitation.',
        ],
      },
      {
        title: 'Sign out',
        steps: [
          'Scroll to the bottom of the Profile screen.',
          'Tap "Sign Out".',
        ],
      },
      {
        title: 'Delete your account',
        steps: [
          'Scroll to the bottom of the Profile screen.',
          'Tap "Delete Account".',
          'Read the warning carefully - this action is permanent.',
          'Confirm deletion.',
        ],
      },
    ],
    tips: [
      { text: 'Pending team invitations from other coaches appear here, not in Manage.' },
      { text: 'Deleting your account is permanent and removes all your data.' },
    ],
    relatedScreens: ['manage-sharing'],
  },

  // @help-content: formation-visual-editor
  'formation-visual-editor': {
    screenTitle: 'Customize Formation Layout',
    overview: "Drag position nodes to reposition them on the pitch. On mobile, select a node then use the arrow buttons to nudge it. Tap Save when you're happy with the layout.",
    tasks: [
      {
        title: 'Move a position node',
        steps: [
          'On desktop: click and drag the position node to the new location.',
          'On mobile: tap a node to select it, then tap the arrow buttons below the pitch.',
          'Use the keyboard arrow keys when a node is focused for fine-grained control.',
        ],
      },
      {
        title: 'Save or discard your layout',
        steps: [
          'Tap Save to write the layout to the database.',
          'Tap Reset to revert to the last saved layout without closing the editor.',
          'Tap Cancel to exit without saving (you will be asked to confirm if you have unsaved changes).',
        ],
      },
    ],
    tips: [
      { text: 'Forward positions should be near the top; the goalkeeper near the bottom.' },
      { text: "If another coach saves while you have the editor open, a conflict warning will appear and Save will be blocked until you reload." },
    ],
    relatedScreens: ['manage-formations'],
  },
};