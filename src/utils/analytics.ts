import ReactGA from 'react-ga4';

// Initialize GA4 with your Measurement ID
export const initGA = (measurementId: string) => {
  ReactGA.initialize(measurementId);
};

// Track page views
export const trackPageView = (path: string) => {
  ReactGA.send({ hitType: "pageview", page: path });
};

// Track custom events
export const trackEvent = (category: string, action: string, label?: string) => {
  ReactGA.event({
    category,
    action,
    label,
  });
};

// Pre-defined events for consistency
export const AnalyticsEvents = {
  // Team
  TEAM_CREATED: { category: 'Team', action: 'Create Team' },
  TEAM_DELETED: { category: 'Team', action: 'Delete Team' },

  // Player
  PLAYER_ADDED: { category: 'Player', action: 'Add Player' },
  PLAYER_ADDED_TO_ROSTER: { category: 'Player', action: 'Add Player to Roster' },
  PLAYER_DELETED: { category: 'Player', action: 'Delete Player' },

  // Formation
  FORMATION_CREATED: { category: 'Formation', action: 'Create Formation' },
  FORMATION_DELETED: { category: 'Formation', action: 'Delete Formation' },

  // Game lifecycle
  GAME_CREATED: { category: 'Game', action: 'Create Game' },
  GAME_STARTED: { category: 'Game', action: 'Start Game' },
  GAME_HALFTIME: { category: 'Game', action: 'Halftime' },
  GAME_SECOND_HALF_STARTED: { category: 'Game', action: 'Start Second Half' },
  GAME_COMPLETED: { category: 'Game', action: 'Complete Game' },
  GAME_DELETED: { category: 'Game', action: 'Delete Game' },
  GAME_OPENED: { category: 'Game', action: 'Open Game' },

  // In-game actions
  SUBSTITUTION_MADE: { category: 'GameDay', action: 'Substitution Made' },
  ALL_SUBSTITUTIONS_EXECUTED: { category: 'GameDay', action: 'All Substitutions Executed' },
  ROTATION_RECALCULATED: { category: 'GameDay', action: 'Rotation Recalculated' },
  ROTATION_WIDGET_OPENED: { category: 'GameDay', action: 'Rotation Widget Opened' },
  GOAL_RECORDED: { category: 'GameDay', action: 'Goal Recorded' },
  PLAYER_MARKED_INJURED: { category: 'GameDay', action: 'Player Marked Injured' },
  PLAYER_RECOVERED_FROM_INJURY: { category: 'GameDay', action: 'Player Recovered From Injury' },

  // Game planner
  PLAN_SAVED: { category: 'GamePlanner', action: 'Plan Saved' },
  AUTO_GENERATE_ROTATIONS: { category: 'GamePlanner', action: 'Auto-Generate Rotations' },
  COPY_PLAN_FROM_GAME: { category: 'GamePlanner', action: 'Copy Plan From Game' },

  // Player availability
  AVAILABILITY_MARKED: { category: 'Availability', action: 'Mark Player' },

  // Reports
  SEASON_REPORT_VIEWED: { category: 'Report', action: 'View Season Report' },

  // Sharing
  INVITATION_SENT: { category: 'Sharing', action: 'Send Invitation' },
  INVITATION_ACCEPTED: { category: 'Sharing', action: 'Accept Invitation' },
  INVITATION_DECLINED: { category: 'Sharing', action: 'Decline Invitation' },

  // Help
  HELP_OPENED: { category: 'Help', action: 'Open Help' },
  BUG_REPORT_OPENED: { category: 'Help', action: 'Open Bug Report' },

  // Bug report
  BUG_REPORT_SUBMITTED: { category: 'BugReport', action: 'Submit' },

  // Account
  PASSWORD_CHANGED: { category: 'Account', action: 'Change Password' },
  ACCOUNT_DELETED: { category: 'Account', action: 'Delete Account' },

  // Onboarding
  ONBOARDING_STEP_COMPLETE: { category: 'Onboarding', action: 'Step Complete' },
  DEMO_TEAM_CREATED: { category: 'Onboarding', action: 'Demo Team Created' },
  DEMO_TEAM_REMOVED: { category: 'Onboarding', action: 'Demo Team Removed' },
  WELCOME_MODAL_OPENED: { category: 'Onboarding', action: 'Welcome Modal Opened' },
  WELCOME_MODAL_SKIPPED: { category: 'Onboarding', action: 'Welcome Modal Skipped' },
  QUICK_START_OPENED: { category: 'Onboarding', action: 'Quick Start Opened' },
  QUICK_START_DISMISSED: { category: 'Onboarding', action: 'Quick Start Dismissed' },
};
