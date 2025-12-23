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
  TEAM_CREATED: { category: 'Team', action: 'Create Team' },
  GAME_CREATED: { category: 'Game', action: 'Create Game' },
  SEASON_REPORT_VIEWED: { category: 'Report', action: 'View Season Report' },
  PLAYER_ADDED: { category: 'Player', action: 'Add Player' },
  GAME_STARTED: { category: 'Game', action: 'Start Game' },
  GAME_COMPLETED: { category: 'Game', action: 'Complete Game' },
  INVITATION_SENT: { category: 'Sharing', action: 'Send Invitation' },
};
