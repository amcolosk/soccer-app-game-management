import { describe, it, expect } from 'vitest';
import {
  computeFormationPositionDiff,
  scrubDeletedPositionPreferences,
  type ExistingFormationPosition,
  type NewPositionFormData,
} from './formationUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function existing(id: string, positionName: string, abbreviation: string, sortOrder: number): ExistingFormationPosition {
  return { id, positionName, abbreviation, sortOrder };
}

function newPos(positionName: string, abbreviation: string): NewPositionFormData {
  return { positionName, abbreviation };
}

// ---------------------------------------------------------------------------
// computeFormationPositionDiff
// ---------------------------------------------------------------------------
describe('computeFormationPositionDiff', () => {

  it('same count: all positions are updated in-place, nothing created or deleted', () => {
    const existing3 = [
      existing('id-1', 'Goalkeeper', 'GK', 1),
      existing('id-2', 'Defender', 'DEF', 2),
      existing('id-3', 'Forward', 'FWD', 3),
    ];
    const newPositions = [
      newPos('Goalkeeper', 'GOL'),   // abbreviation changed
      newPos('Defender', 'DEF'),
      newPos('Striker', 'ST'),       // name + abbr changed
    ];

    const { toUpdate, toCreate, toDeleteIds } = computeFormationPositionDiff(existing3, newPositions);

    expect(toCreate).toHaveLength(0);
    expect(toDeleteIds).toHaveLength(0);
    expect(toUpdate).toHaveLength(3);

    // Critically: IDs must be preserved
    expect(toUpdate[0].id).toBe('id-1');
    expect(toUpdate[0].abbreviation).toBe('GOL');
    expect(toUpdate[1].id).toBe('id-2');
    expect(toUpdate[2].id).toBe('id-3');
    expect(toUpdate[2].positionName).toBe('Striker');
  });

  it('new count > old count: existing positions updated in-place, extras created', () => {
    const existing2 = [
      existing('id-1', 'Goalkeeper', 'GK', 1),
      existing('id-2', 'Defender', 'DEF', 2),
    ];
    const newPositions = [
      newPos('Goalkeeper', 'GK'),
      newPos('Defender', 'DEF'),
      newPos('Midfielder', 'MID'),
      newPos('Forward', 'FWD'),
    ];

    const { toUpdate, toCreate, toDeleteIds } = computeFormationPositionDiff(existing2, newPositions);

    expect(toDeleteIds).toHaveLength(0);
    expect(toUpdate).toHaveLength(2);
    expect(toUpdate[0].id).toBe('id-1');
    expect(toUpdate[1].id).toBe('id-2');

    expect(toCreate).toHaveLength(2);
    expect(toCreate[0]).toEqual({ positionName: 'Midfielder', abbreviation: 'MID', sortOrder: 3 });
    expect(toCreate[1]).toEqual({ positionName: 'Forward', abbreviation: 'FWD', sortOrder: 4 });
  });

  it('new count < old count: first positions updated in-place, excess IDs returned for deletion', () => {
    const existing4 = [
      existing('id-1', 'Goalkeeper', 'GK', 1),
      existing('id-2', 'Defender', 'DEF', 2),
      existing('id-3', 'Midfielder', 'MID', 3),
      existing('id-4', 'Forward', 'FWD', 4),
    ];
    const newPositions = [
      newPos('Goalkeeper', 'GK'),
      newPos('Defender', 'DEF'),
    ];

    const { toUpdate, toCreate, toDeleteIds } = computeFormationPositionDiff(existing4, newPositions);

    expect(toCreate).toHaveLength(0);
    expect(toUpdate).toHaveLength(2);
    expect(toUpdate[0].id).toBe('id-1');
    expect(toUpdate[1].id).toBe('id-2');

    expect(toDeleteIds).toHaveLength(2);
    expect(toDeleteIds).toContain('id-3');
    expect(toDeleteIds).toContain('id-4');
  });

  it('sortOrders are reassigned sequentially from 1 in the output', () => {
    const existing2 = [
      existing('id-1', 'GK', 'GK', 10), // non-sequential sortOrder
      existing('id-2', 'DEF', 'DEF', 20),
    ];
    const newPositions = [newPos('GK', 'GK'), newPos('DEF', 'DEF'), newPos('FWD', 'FWD')];

    const { toUpdate, toCreate } = computeFormationPositionDiff(existing2, newPositions);

    expect(toUpdate[0].sortOrder).toBe(1);
    expect(toUpdate[1].sortOrder).toBe(2);
    expect(toCreate[0].sortOrder).toBe(3);
  });

  it('existing positions are sorted by sortOrder before matching (not by array order)', () => {
    // Existing positions arrive in reverse sortOrder from the server
    const unsorted = [
      existing('id-3', 'Forward', 'FWD', 3),
      existing('id-1', 'Goalkeeper', 'GK', 1),
      existing('id-2', 'Defender', 'DEF', 2),
    ];
    const newPositions = [
      newPos('Goalkeeper', 'GOL'),
      newPos('Defender', 'DEF'),
      newPos('Striker', 'ST'),
    ];

    const { toUpdate } = computeFormationPositionDiff(unsorted, newPositions);

    // id-1 (sortOrder 1) should be matched to first new position
    expect(toUpdate[0].id).toBe('id-1');
    expect(toUpdate[0].abbreviation).toBe('GOL');
    expect(toUpdate[1].id).toBe('id-2');
    expect(toUpdate[2].id).toBe('id-3');
    expect(toUpdate[2].positionName).toBe('Striker');
  });

  it('no existing positions: everything is a create', () => {
    const { toUpdate, toCreate, toDeleteIds } = computeFormationPositionDiff([], [
      newPos('GK', 'GK'),
      newPos('DEF', 'DEF'),
    ]);

    expect(toUpdate).toHaveLength(0);
    expect(toDeleteIds).toHaveLength(0);
    expect(toCreate).toHaveLength(2);
    expect(toCreate[0].sortOrder).toBe(1);
    expect(toCreate[1].sortOrder).toBe(2);
  });

  it('no new positions: everything is a delete', () => {
    const existing2 = [
      existing('id-1', 'GK', 'GK', 1),
      existing('id-2', 'DEF', 'DEF', 2),
    ];

    const { toUpdate, toCreate, toDeleteIds } = computeFormationPositionDiff(existing2, []);

    expect(toUpdate).toHaveLength(0);
    expect(toCreate).toHaveLength(0);
    expect(toDeleteIds).toEqual(['id-1', 'id-2']);
  });

  it('empty both: returns empty diff', () => {
    const { toUpdate, toCreate, toDeleteIds } = computeFormationPositionDiff([], []);
    expect(toUpdate).toHaveLength(0);
    expect(toCreate).toHaveLength(0);
    expect(toDeleteIds).toHaveLength(0);
  });

  it('does not mutate the input arrays', () => {
    const input = [existing('id-1', 'GK', 'GK', 2), existing('id-2', 'DEF', 'DEF', 1)];
    const original = [...input];
    computeFormationPositionDiff(input, [newPos('GK', 'GK'), newPos('DEF', 'DEF')]);
    expect(input).toEqual(original);
  });

  // i-2: stable sort when multiple positions share the same sortOrder
  it('uses stable id-tiebreaker sort when two positions share the same sortOrder', () => {
    const input = [
      existing('id-b', 'DEF', 'DEF', 1),
      existing('id-a', 'GK',  'GK',  1), // same sortOrder as id-b
    ];
    const { toUpdate } = computeFormationPositionDiff(input, [newPos('GK', 'GK'), newPos('DEF', 'DEF')]);
    // id-a sorts before id-b lexicographically when sortOrder is equal
    expect(toUpdate[0].id).toBe('id-a');
    expect(toUpdate[1].id).toBe('id-b');
  });

  it('is deterministic across multiple calls with same-sortOrder positions', () => {
    const input = [
      existing('id-z', 'FWD', 'FWD', 0),
      existing('id-a', 'GK',  'GK',  0),
      existing('id-m', 'DEF', 'DEF', 0),
    ];
    const result1 = computeFormationPositionDiff(input, [newPos('A','A'), newPos('B','B'), newPos('C','C')]);
    const result2 = computeFormationPositionDiff(input, [newPos('A','A'), newPos('B','B'), newPos('C','C')]);
    expect(result1.toUpdate.map(p => p.id)).toEqual(result2.toUpdate.map(p => p.id));
  });
});

// ---------------------------------------------------------------------------
// scrubDeletedPositionPreferences
// ---------------------------------------------------------------------------
describe('scrubDeletedPositionPreferences', () => {
  it('removes deleted IDs from a comma-separated string', () => {
    const result = scrubDeletedPositionPreferences(
      'id-1, id-2, id-3',
      new Set(['id-2']),
    );
    expect(result).toBe('id-1, id-3');
  });

  it('returns null when all IDs are deleted', () => {
    const result = scrubDeletedPositionPreferences(
      'id-1, id-2',
      new Set(['id-1', 'id-2']),
    );
    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    expect(scrubDeletedPositionPreferences(null, new Set(['id-1']))).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(scrubDeletedPositionPreferences(undefined, new Set())).toBeNull();
  });

  it('returns null for empty string input', () => {
    expect(scrubDeletedPositionPreferences('', new Set(['id-1']))).toBeNull();
  });

  it('preserves IDs not in the deleted set', () => {
    const result = scrubDeletedPositionPreferences('id-1, id-3', new Set(['id-2']));
    expect(result).toBe('id-1, id-3');
  });

  it('handles IDs with extra whitespace', () => {
    const result = scrubDeletedPositionPreferences(
      '  id-1 ,  id-2  ,  id-3  ',
      new Set(['id-2']),
    );
    expect(result).toBe('id-1, id-3');
  });

  it('handles empty deleted set (no-op)', () => {
    const result = scrubDeletedPositionPreferences('id-1, id-2', new Set());
    expect(result).toBe('id-1, id-2');
  });
  // i-3: single ID string with no comma
  it('handles a single ID string with no comma — keeps it when not deleted', () => {
    expect(scrubDeletedPositionPreferences('id-1', new Set(['id-2']))).toBe('id-1');
  });

  it('handles a single ID string with no comma — removes it when deleted', () => {
    expect(scrubDeletedPositionPreferences('id-1', new Set(['id-1']))).toBeNull();
  });});
