/**
 * FVE Chrome Height Safeguard (MANDATORY INVARIANT)
 *
 * This module enforces a critical constraint for FormationVisualEditor sizing:
 * the pitch width formula must account for the total height consumed by FVE chrome
 * (header, banners, nudge controls, action buttons) to ensure the pitch remains
 * visible and usable on short/tall viewports.
 *
 * Constraint: On a 90vh viewport, the pitch must fit within available space after
 * subtracting chrome height, maintaining a 2:3 aspect ratio (width = height * 2/3).
 *
 * Chrome segments and their approximate heights:
 * - Modal header: 56px
 * - Conflict/error banners: 0-32px (conditional, shown when conflict or error)
 * - Nudge strip: 52px (shown when node selected)
 * - Action buttons: 64px
 * TOTAL CHROME: ~188px (excluding conditional banners in minimum case)
 *
 * Formula breakdown:
 * - Available height = max(MIN_WIDTH, 90vh - CHROME_HEIGHT)
 * - Pitch width = available height * 2/3 (aspect ratio)
 * - Clamped to [MIN_WIDTH, MAX_WIDTH]
 *
 * CRITICAL: If FVE chrome styling changes (e.g., header height, button dimensions),
 * the FVE_CHROME_HEIGHT_PX constant MUST be updated and verified via tests.
 * Failure to update this constant will result in pitch layout overflow on short viewports.
 *
 * See tests: FormationVisualEditor.test.tsx for comprehensive viewport testing.
 */

const FVE_CHROME_HEIGHT_PX = 188;
const FVE_PITCH_MIN_WIDTH_PX = 120;
const FVE_PITCH_MAX_WIDTH_PX = 320;

/**
 * Generates a CSS calc() expression that ensures the FVE pitch width fits
 * within the available viewport after accounting for chrome height.
 *
 * Formula: min(100%, clamp(MIN, calc(max(MIN, 90vh - CHROME) * 2/3), MAX))
 *
 * @returns CSS calc string for pitch width
 */
export function getFvePitchWidthStyle(): string {
  return `min(100%, clamp(${FVE_PITCH_MIN_WIDTH_PX}px, calc((max(${FVE_PITCH_MIN_WIDTH_PX}px, 90vh - ${FVE_CHROME_HEIGHT_PX}px)) * 2 / 3), ${FVE_PITCH_MAX_WIDTH_PX}px))`;
}
