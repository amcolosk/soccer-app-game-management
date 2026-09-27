// Short-name formatting helpers extracted from
// src/components/GameManagement/shape/LineupShapeView.tsx so they can also be
// used by the public Sideline Stat Tracker pitch view
// (src/components/FanMode/TrackerFieldLineup.tsx) without dragging in that
// file's own runtime imports (react-hot-toast, lineupInteractionAdapter,
// exportLineupShape, playTimeCalculations) -- see StatTrackerView.tsx's entry
// bundle concern documented in the feature plan. Pure, structural, and has no
// dependency on any Amplify-generated model type -- callers pass a plain
// { firstName, lastName } shape, coach-side or Lambda-payload-derived alike.

export interface PlayerNameParts {
  firstName?: string | null;
  lastName?: string | null;
}

export function normalizeNamePart(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

export function getInitialFromLastName(lastName: string): string | null {
  const alphaMatch = lastName.match(/\p{L}/u);
  if (alphaMatch?.[0]) {
    return alphaMatch[0].toLocaleUpperCase();
  }

  const alnumMatch = lastName.match(/[\p{L}\p{N}]/u);
  if (alnumMatch?.[0]) {
    return alnumMatch[0].toLocaleUpperCase();
  }

  return null;
}

export function formatPlayerShortLabel(player: PlayerNameParts | null | undefined): string {
  if (!player) {
    return "Unknown player";
  }

  const firstName = normalizeNamePart(player.firstName);
  const lastName = normalizeNamePart(player.lastName);
  const lastInitial = lastName ? getInitialFromLastName(lastName) : null;

  if (firstName && lastName) {
    return lastInitial ? `${firstName} ${lastInitial}` : "Unknown player";
  }

  if (firstName) {
    return firstName;
  }

  if (lastName) {
    return lastInitial ?? "Unknown player";
  }

  return "Unknown player";
}
