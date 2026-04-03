import type { PlannedRotation } from "../types/schema";
import type { PlannedSubstitution } from "../services/rotationPlannerService";

export type RotationSelection = number | 'starting' | 'halftime';

export interface RotationTimelineItem {
  key: string;
  label: string;
  selection: RotationSelection;
  substitutionsCount: number;
  rotation?: PlannedRotation;
  gameMinute?: number;
  variant: 'starting' | 'rotation' | 'halftime';
}

function parsePlannedSubstitutions(
  plannedSubstitutions: PlannedRotation['plannedSubstitutions'],
): PlannedSubstitution[] {
  try {
    const parsed = JSON.parse((plannedSubstitutions as string) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed as PlannedSubstitution[] : [];
  } catch {
    return [];
  }
}

function getRotationSubstitutionsCount(rotation: Pick<PlannedRotation, 'plannedSubstitutions'>): number {
  return parsePlannedSubstitutions(rotation.plannedSubstitutions).length;
}

function getRotationsPerHalf(halfLengthMinutes: number, intervalMinutes: number): number {
  return Math.max(0, Math.floor(halfLengthMinutes / intervalMinutes) - 1);
}

function getRotationMinute(
  rotationNumber: number,
  rotationsPerHalf: number,
  halfLengthMinutes: number,
  rotationIntervalMinutes: number,
): number {
  if (rotationNumber <= rotationsPerHalf) {
    return rotationNumber * rotationIntervalMinutes;
  }

  const secondHalfIndex = rotationNumber - rotationsPerHalf - 1;
  return halfLengthMinutes + (secondHalfIndex * rotationIntervalMinutes);
}

export function buildRotationTimelineItems(
  rotations: PlannedRotation[],
  halftimeRotationNumber?: number,
): RotationTimelineItem[] {
  const items: RotationTimelineItem[] = [
    {
      key: 'starting',
      label: 'Start',
      selection: 'starting',
      substitutionsCount: 0,
      variant: 'starting',
    },
  ];

  if (rotations.length === 0) {
    items.push({
      key: 'halftime',
      label: 'HT',
      selection: 'halftime',
      substitutionsCount: 0,
      variant: 'halftime',
    });
    return items;
  }

  for (const rotation of rotations) {
    const isHalftime = rotation.rotationNumber === halftimeRotationNumber;
    if (isHalftime) {
      const halftimeKey = rotation.id ? `halftime-${rotation.id}` : `halftime-${rotation.rotationNumber}-${rotation.gameMinute}`;
      items.push({
        key: halftimeKey,
        label: 'HT',
        selection: 'halftime',
        substitutionsCount: getRotationSubstitutionsCount(rotation),
        rotation,
        variant: 'halftime',
      });
      continue;
    }

    items.push({
      key: rotation.id
        ? `rotation-${rotation.rotationNumber}-${rotation.id}`
        : `rotation-${rotation.rotationNumber}-${rotation.gameMinute}`,
      label: `R${rotation.rotationNumber}`,
      selection: rotation.rotationNumber,
      substitutionsCount: getRotationSubstitutionsCount(rotation),
      rotation,
      gameMinute: rotation.gameMinute,
      variant: 'rotation',
    });
  }

  if (!items.some((item) => item.selection === 'halftime')) {
    items.splice(1, 0, {
      key: 'halftime',
      label: 'HT',
      selection: 'halftime',
      substitutionsCount: 0,
      variant: 'halftime',
    });
  }

  return items;
}

export function buildPrePlanTimelineItems(
  halfLengthMinutes: number,
  rotationIntervalMinutes: number,
): RotationTimelineItem[] {
  const rotationsPerHalf = getRotationsPerHalf(halfLengthMinutes, rotationIntervalMinutes);
  const halftimeRotationNumber = rotationsPerHalf > 0 ? rotationsPerHalf + 1 : 1;
  const totalRotations = rotationsPerHalf * 2 + 1;

  const items: RotationTimelineItem[] = [
    {
      key: 'starting',
      label: 'Start',
      selection: 'starting',
      substitutionsCount: 0,
      variant: 'starting',
    },
  ];

  for (let rotationNumber = 1; rotationNumber <= totalRotations; rotationNumber++) {
    const gameMinute = getRotationMinute(
      rotationNumber,
      rotationsPerHalf,
      halfLengthMinutes,
      rotationIntervalMinutes,
    );

    if (rotationNumber === halftimeRotationNumber) {
      items.push({
        key: `halftime-${rotationNumber}-${gameMinute}`,
        label: 'HT',
        selection: 'halftime',
        substitutionsCount: 0,
        gameMinute,
        variant: 'halftime',
      });
      continue;
    }

    items.push({
      key: `rotation-${rotationNumber}-${gameMinute}-synthetic`,
      label: `R${rotationNumber}`,
      selection: rotationNumber,
      substitutionsCount: 0,
      gameMinute,
      variant: 'rotation',
    });
  }

  return items;
}

function getSelectionKey(item: RotationTimelineItem): string {
  if (item.selection === 'starting') return 'starting';
  if (item.selection === 'halftime') return 'halftime';
  return `rotation-${item.selection}`;
}

function getSemanticSelectionKey(selectionKey: string): string | null {
  if (selectionKey === 'starting') return 'starting';
  if (selectionKey === 'halftime' || selectionKey.startsWith('halftime-')) return 'halftime';

  const rotationMatch = /^rotation-(\d+)(?:-|$)/.exec(selectionKey);
  if (rotationMatch) {
    return `rotation-${rotationMatch[1]}`;
  }

  if (/^rotation-[^-]+$/.test(selectionKey)) {
    return selectionKey;
  }

  return null;
}

function findTimelineItemBySemanticKey(
  timelineItems: RotationTimelineItem[],
  semanticSelectionKey: string,
): RotationTimelineItem | undefined {
  return timelineItems.find((item) => getSelectionKey(item) === semanticSelectionKey);
}

export function reconcileSelectionKey(
  timelineItems: RotationTimelineItem[],
  currentSelectionKey: string,
): string {
  if (timelineItems.some((item) => item.key === currentSelectionKey)) {
    return currentSelectionKey;
  }

  const semanticSelectionKey = getSemanticSelectionKey(currentSelectionKey);
  if (semanticSelectionKey) {
    const semanticMatch = findTimelineItemBySemanticKey(timelineItems, semanticSelectionKey);
    if (semanticMatch) {
      return semanticMatch.key;
    }
  }

  const startItem = timelineItems.find((item) => item.selection === 'starting');
  if (startItem) return startItem.key;

  return timelineItems[0]?.key ?? 'starting';
}
