/**
 * Game configuration constants
 * Default values for game settings and calculations
 */

export const GAME_CONFIG = {
  // Default game settings
  DEFAULT_HALF_LENGTH_MINUTES: 30,
  DEFAULT_MAX_PLAYERS_ON_FIELD: 7,

  // Time-related constants
  SECONDS_PER_MINUTE: 60,

  // Rotation planning
  ROTATION_CALCULATION: {
    // Minimum players needed per rotation group for fair distribution
    MIN_PLAYERS_PER_GROUP: 3,
  },
} as const;

/**
 * Default form values used in UI components
 */
export const DEFAULT_FORM_VALUES = {
  maxPlayers: '7',
  halfLength: '25',
  sport: 'Soccer',
  gameFormat: 'Halves',
} as const;
