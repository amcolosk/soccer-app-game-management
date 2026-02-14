import { describe, it, expect } from 'vitest';
import {
  playerFormReducer,
  initialPlayerForm,
  formationFormReducer,
  initialFormationForm,
  teamFormReducer,
  initialTeamForm,
  rosterFormReducer,
  initialRosterForm,
} from './managementReducers';
import { DEFAULT_FORM_VALUES } from '../constants/gameConfig';

describe('playerFormReducer', () => {
  it('returns initial state', () => {
    expect(initialPlayerForm).toEqual({
      isCreating: false,
      editing: null,
      firstName: '',
      lastName: '',
    });
  });

  it('START_CREATE sets isCreating and resets fields', () => {
    const dirty = { ...initialPlayerForm, firstName: 'Alice', editing: {} as any };
    const result = playerFormReducer(dirty, { type: 'START_CREATE' });
    expect(result.isCreating).toBe(true);
    expect(result.firstName).toBe('');
    expect(result.editing).toBeNull();
  });

  it('SET_FIELD updates the specified field', () => {
    const result = playerFormReducer(initialPlayerForm, {
      type: 'SET_FIELD',
      field: 'firstName',
      value: 'Bob',
    });
    expect(result.firstName).toBe('Bob');
    expect(result.lastName).toBe('');
  });

  it('EDIT_PLAYER populates form from player', () => {
    const player = { firstName: 'Alice', lastName: 'Smith' } as any;
    const result = playerFormReducer(initialPlayerForm, { type: 'EDIT_PLAYER', player });
    expect(result.editing).toBe(player);
    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBe('Smith');
    expect(result.isCreating).toBe(false);
  });

  it('RESET returns initial state', () => {
    const dirty = { isCreating: true, editing: {} as any, firstName: 'X', lastName: 'Y' };
    const result = playerFormReducer(dirty, { type: 'RESET' });
    expect(result).toEqual(initialPlayerForm);
  });
});

describe('formationFormReducer', () => {
  it('returns initial state', () => {
    expect(initialFormationForm).toEqual({
      isCreating: false,
      editing: null,
      name: '',
      playerCount: '',
      sport: 'Soccer',
      positions: [],
    });
  });

  it('START_CREATE sets isCreating and resets fields', () => {
    const dirty = { ...initialFormationForm, name: 'test' };
    const result = formationFormReducer(dirty, { type: 'START_CREATE' });
    expect(result.isCreating).toBe(true);
    expect(result.name).toBe('');
  });

  it('SET_FIELD updates the specified field', () => {
    const result = formationFormReducer(initialFormationForm, {
      type: 'SET_FIELD',
      field: 'name',
      value: '4-3-3',
    });
    expect(result.name).toBe('4-3-3');
  });

  it('EDIT_FORMATION populates form from formation', () => {
    const formation = { name: '4-4-2', playerCount: 11, sport: 'Soccer' } as any;
    const positions = [{ positionName: 'GK', abbreviation: 'GK' }];
    const result = formationFormReducer(initialFormationForm, {
      type: 'EDIT_FORMATION',
      formation,
      positions,
    });
    expect(result.editing).toBe(formation);
    expect(result.name).toBe('4-4-2');
    expect(result.playerCount).toBe('11');
    expect(result.positions).toEqual(positions);
    expect(result.isCreating).toBe(false);
  });

  it('ADD_POSITION appends an empty position', () => {
    const result = formationFormReducer(initialFormationForm, { type: 'ADD_POSITION' });
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toEqual({ positionName: '', abbreviation: '' });
  });

  it('UPDATE_POSITION updates a specific position field', () => {
    const state = {
      ...initialFormationForm,
      positions: [{ positionName: '', abbreviation: '' }],
    };
    const result = formationFormReducer(state, {
      type: 'UPDATE_POSITION',
      index: 0,
      field: 'positionName',
      value: 'Goalkeeper',
    });
    expect(result.positions[0].positionName).toBe('Goalkeeper');
    expect(result.positions[0].abbreviation).toBe('');
  });

  it('REMOVE_POSITION removes position at index', () => {
    const state = {
      ...initialFormationForm,
      positions: [
        { positionName: 'GK', abbreviation: 'GK' },
        { positionName: 'CB', abbreviation: 'CB' },
      ],
    };
    const result = formationFormReducer(state, { type: 'REMOVE_POSITION', index: 0 });
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].positionName).toBe('CB');
  });

  it('RESET returns initial state', () => {
    const dirty = { ...initialFormationForm, name: 'test', isCreating: true };
    const result = formationFormReducer(dirty, { type: 'RESET' });
    expect(result).toEqual(initialFormationForm);
  });
});

describe('teamFormReducer', () => {
  it('returns initial state with defaults from gameConfig', () => {
    expect(initialTeamForm.maxPlayers).toBe(DEFAULT_FORM_VALUES.maxPlayers);
    expect(initialTeamForm.halfLength).toBe(DEFAULT_FORM_VALUES.halfLength);
    expect(initialTeamForm.sport).toBe(DEFAULT_FORM_VALUES.sport);
    expect(initialTeamForm.gameFormat).toBe(DEFAULT_FORM_VALUES.gameFormat);
  });

  it('START_CREATE sets isCreating and preserves expandedTeamId', () => {
    const state = { ...initialTeamForm, expandedTeamId: 'team-1', name: 'old' };
    const result = teamFormReducer(state, { type: 'START_CREATE' });
    expect(result.isCreating).toBe(true);
    expect(result.expandedTeamId).toBe('team-1');
    expect(result.name).toBe('');
  });

  it('SET_FIELD updates the specified field', () => {
    const result = teamFormReducer(initialTeamForm, {
      type: 'SET_FIELD',
      field: 'name',
      value: 'Eagles',
    });
    expect(result.name).toBe('Eagles');
  });

  it('EDIT_TEAM populates form from team', () => {
    const team = {
      name: 'Hawks',
      maxPlayersOnField: 11,
      halfLengthMinutes: 45,
      formationId: 'f-1',
      sport: 'Soccer',
      gameFormat: 'Halves',
    } as any;
    const result = teamFormReducer(initialTeamForm, { type: 'EDIT_TEAM', team });
    expect(result.editing).toBe(team);
    expect(result.name).toBe('Hawks');
    expect(result.maxPlayers).toBe('11');
    expect(result.halfLength).toBe('45');
    expect(result.selectedFormation).toBe('f-1');
    expect(result.isCreating).toBe(false);
  });

  it('EDIT_TEAM uses defaults for missing optional fields', () => {
    const team = {
      name: 'Bare',
      maxPlayersOnField: 7,
      halfLengthMinutes: null,
      formationId: null,
      sport: null,
      gameFormat: null,
    } as any;
    const result = teamFormReducer(initialTeamForm, { type: 'EDIT_TEAM', team });
    expect(result.halfLength).toBe('30');
    expect(result.selectedFormation).toBe('');
    expect(result.sport).toBe(DEFAULT_FORM_VALUES.sport);
    expect(result.gameFormat).toBe(DEFAULT_FORM_VALUES.gameFormat);
  });

  it('TOGGLE_EXPAND toggles the expanded team id', () => {
    const result1 = teamFormReducer(initialTeamForm, { type: 'TOGGLE_EXPAND', teamId: 'team-1' });
    expect(result1.expandedTeamId).toBe('team-1');

    const result2 = teamFormReducer(result1, { type: 'TOGGLE_EXPAND', teamId: 'team-1' });
    expect(result2.expandedTeamId).toBeNull();

    const result3 = teamFormReducer(result1, { type: 'TOGGLE_EXPAND', teamId: 'team-2' });
    expect(result3.expandedTeamId).toBe('team-2');
  });

  it('RESET preserves expandedTeamId', () => {
    const dirty = { ...initialTeamForm, name: 'test', expandedTeamId: 'team-1', isCreating: true };
    const result = teamFormReducer(dirty, { type: 'RESET' });
    expect(result.name).toBe('');
    expect(result.isCreating).toBe(false);
    expect(result.expandedTeamId).toBe('team-1');
  });
});

describe('rosterFormReducer', () => {
  it('returns initial state', () => {
    expect(initialRosterForm).toEqual({
      isAdding: false,
      editing: null,
      selectedPlayer: '',
      playerNumber: '',
      preferredPositions: [],
      editFirstName: '',
      editLastName: '',
    });
  });

  it('START_ADD sets isAdding and resets fields', () => {
    const dirty = { ...initialRosterForm, playerNumber: '10' };
    const result = rosterFormReducer(dirty, { type: 'START_ADD' });
    expect(result.isAdding).toBe(true);
    expect(result.playerNumber).toBe('');
  });

  it('SET_FIELD updates the specified field', () => {
    const result = rosterFormReducer(initialRosterForm, {
      type: 'SET_FIELD',
      field: 'playerNumber',
      value: '7',
    });
    expect(result.playerNumber).toBe('7');
  });

  it('SET_PREFERRED_POSITIONS updates positions array', () => {
    const result = rosterFormReducer(initialRosterForm, {
      type: 'SET_PREFERRED_POSITIONS',
      positions: ['GK', 'CB'],
    });
    expect(result.preferredPositions).toEqual(['GK', 'CB']);
  });

  it('EDIT_ROSTER populates form from roster and player', () => {
    const roster = {
      playerNumber: 10,
      preferredPositions: 'GK, CB',
      playerId: 'p-1',
    } as any;
    const result = rosterFormReducer(initialRosterForm, {
      type: 'EDIT_ROSTER',
      roster,
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(result.editing).toBe(roster);
    expect(result.playerNumber).toBe('10');
    expect(result.preferredPositions).toEqual(['GK', 'CB']);
    expect(result.editFirstName).toBe('Alice');
    expect(result.editLastName).toBe('Smith');
    expect(result.isAdding).toBe(false);
  });

  it('EDIT_ROSTER handles null preferredPositions', () => {
    const roster = { playerNumber: 5, preferredPositions: null } as any;
    const result = rosterFormReducer(initialRosterForm, {
      type: 'EDIT_ROSTER',
      roster,
      firstName: '',
      lastName: '',
    });
    expect(result.preferredPositions).toEqual([]);
  });

  it('RESET returns initial state', () => {
    const dirty = { ...initialRosterForm, isAdding: true, playerNumber: '10' };
    const result = rosterFormReducer(dirty, { type: 'RESET' });
    expect(result).toEqual(initialRosterForm);
  });
});
