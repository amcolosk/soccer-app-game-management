const FVE_CHROME_HEIGHT_PX = 188;
const FVE_PITCH_MIN_WIDTH_PX = 120;
const FVE_PITCH_MAX_WIDTH_PX = 320;

export function getFvePitchWidthStyle(): string {
  return `min(100%, clamp(${FVE_PITCH_MIN_WIDTH_PX}px, calc((max(${FVE_PITCH_MIN_WIDTH_PX}px, 90vh - ${FVE_CHROME_HEIGHT_PX}px)) * 2 / 3), ${FVE_PITCH_MAX_WIDTH_PX}px))`;
}
