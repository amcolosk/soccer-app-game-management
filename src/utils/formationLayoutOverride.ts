type FormationLayoutPosition = {
  id: string;
  xPct: number;
  yPct: number;
};

export type FormationLayoutOverride = {
  formationId: string;
  savedAt: number;
  positions: FormationLayoutPosition[];
};

export const FORMATION_LAYOUT_OVERRIDE_KEY_PREFIX = 'formation-layout-override:';
export const MAX_OVERRIDE_AGE_MS = 5 * 60 * 1000;

const MIN_COORD_PCT = 1;
const MAX_COORD_PCT = 99;

function getStorageKey(formationId: string): string {
  return `${FORMATION_LAYOUT_OVERRIDE_KEY_PREFIX}${formationId}`;
}

function clampCoordinate(value: number): number {
  return Math.min(MAX_COORD_PCT, Math.max(MIN_COORD_PCT, value));
}

function sanitizePosition(value: unknown): FormationLayoutPosition | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.xPct !== 'number' ||
    !Number.isFinite(candidate.xPct) ||
    typeof candidate.yPct !== 'number' ||
    !Number.isFinite(candidate.yPct)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    xPct: clampCoordinate(candidate.xPct),
    yPct: clampCoordinate(candidate.yPct),
  };
}

function isValidPosition(value: unknown): value is FormationLayoutPosition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.xPct === 'number' &&
    Number.isFinite(candidate.xPct) &&
    typeof candidate.yPct === 'number' &&
    Number.isFinite(candidate.yPct)
  );
}

function isValidOverride(value: unknown, expectedFormationId: string): value is FormationLayoutOverride {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.formationId !== expectedFormationId ||
    typeof candidate.savedAt !== 'number' ||
    !Number.isFinite(candidate.savedAt) ||
    !Array.isArray(candidate.positions)
  ) {
    return false;
  }

  return candidate.positions.every(isValidPosition);
}

export function setFormationLayoutOverride(
  formationId: string,
  positions: FormationLayoutPosition[],
): void {
  try {
    const payload: FormationLayoutOverride = {
      formationId,
      savedAt: Date.now(),
      positions,
    };
    localStorage.setItem(getStorageKey(formationId), JSON.stringify(payload));
  } catch {
    // Ignore storage failures (SSR/private mode/quota errors).
  }
}

export function getFormationLayoutOverride(formationId: string): FormationLayoutOverride | null {
  const storageKey = getStorageKey(formationId);

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isValidOverride(parsed, formationId)) {
      localStorage.removeItem(storageKey);
      return null;
    }

    if (Date.now() - parsed.savedAt > MAX_OVERRIDE_AGE_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }

    const sanitizedPositions = parsed.positions
      .map((position) => sanitizePosition(position))
      .filter((position): position is FormationLayoutPosition => position !== null);

    if (sanitizedPositions.length !== parsed.positions.length) {
      localStorage.removeItem(storageKey);
      return null;
    }

    return {
      formationId: parsed.formationId,
      savedAt: parsed.savedAt,
      positions: sanitizedPositions,
    };
  } catch {
    return null;
  }
}

export function clearFormationLayoutOverride(formationId: string): void {
  try {
    localStorage.removeItem(getStorageKey(formationId));
  } catch {
    // Ignore storage failures (SSR/private mode/quota errors).
  }
}