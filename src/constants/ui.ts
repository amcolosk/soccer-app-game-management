/**
 * UI interaction constants
 * Values for animations, gestures, and user interactions
 */

export const UI_CONSTANTS = {
  // Scroll behavior
  SCROLL: {
    DELAY_MS: 100,
    BEHAVIOR: 'smooth' as ScrollBehavior,
    INLINE: 'center' as ScrollLogicalPosition,
    BLOCK: 'nearest' as ScrollLogicalPosition,
  },

  // Swipe/Drag gesture thresholds (in pixels)
  SWIPE: {
    MAX_DISTANCE_PX: 100,      // Maximum distance a swipe can travel
    THRESHOLD_PX: 50,           // Minimum distance to trigger swipe action
    OPEN_WIDTH_PX: 80,          // Width when swipe is opened (for delete button reveal)
  },
} as const;
