import type { Schema } from '../../amplify/data/resource';
import { DEFAULT_FORM_VALUES } from '../constants/gameConfig';

type Team = Schema['Team']['type'];
type Player = Schema['Player']['type'];
type TeamRoster = Schema['TeamRoster']['type'];
type Formation = Schema['Formation']['type'];

// ============================================================
// Player Form Reducer
// ============================================================

export interface PlayerFormState {
  isCreating: boolean;
  editing: Player | null;
  firstName: string;
  lastName: string;
}

export type PlayerFormAction =
  | { type: 'START_CREATE' }
  | { type: 'SET_FIELD'; field: 'firstName' | 'lastName'; value: string }
  | { type: 'EDIT_PLAYER'; player: Player }
  | { type: 'RESET' };

export const initialPlayerForm: PlayerFormState = {
  isCreating: false,
  editing: null,
  firstName: '',
  lastName: '',
};

export function playerFormReducer(state: PlayerFormState, action: PlayerFormAction): PlayerFormState {
  switch (action.type) {
    case 'START_CREATE':
      return { ...initialPlayerForm, isCreating: true };
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'EDIT_PLAYER':
      return {
        isCreating: false,
        editing: action.player,
        firstName: action.player.firstName,
        lastName: action.player.lastName,
      };
    case 'RESET':
      return initialPlayerForm;
    default:
      return state;
  }
}

// ============================================================
// Formation Form Reducer
// ============================================================

export interface FormationPosition {
  positionName: string;
  abbreviation: string;
}

export interface FormationFormState {
  isCreating: boolean;
  editing: Formation | null;
  name: string;
  playerCount: string;
  sport: string;
  positions: FormationPosition[];
}

export type FormationFormAction =
  | { type: 'START_CREATE' }
  | { type: 'SET_FIELD'; field: 'name' | 'playerCount' | 'sport'; value: string }
  | { type: 'EDIT_FORMATION'; formation: Formation; positions: FormationPosition[] }
  | { type: 'ADD_POSITION' }
  | { type: 'UPDATE_POSITION'; index: number; field: 'positionName' | 'abbreviation'; value: string }
  | { type: 'REMOVE_POSITION'; index: number }
  | { type: 'RESET' };

export const initialFormationForm: FormationFormState = {
  isCreating: false,
  editing: null,
  name: '',
  playerCount: '',
  sport: 'Soccer',
  positions: [],
};

export function formationFormReducer(state: FormationFormState, action: FormationFormAction): FormationFormState {
  switch (action.type) {
    case 'START_CREATE':
      return { ...initialFormationForm, isCreating: true };
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'EDIT_FORMATION':
      return {
        isCreating: false,
        editing: action.formation,
        name: action.formation.name,
        playerCount: action.formation.playerCount.toString(),
        sport: action.formation.sport || 'Soccer',
        positions: action.positions,
      };
    case 'ADD_POSITION':
      return { ...state, positions: [...state.positions, { positionName: '', abbreviation: '' }] };
    case 'UPDATE_POSITION': {
      const updated = [...state.positions];
      updated[action.index] = { ...updated[action.index], [action.field]: action.value };
      return { ...state, positions: updated };
    }
    case 'REMOVE_POSITION':
      return { ...state, positions: state.positions.filter((_, i) => i !== action.index) };
    case 'RESET':
      return initialFormationForm;
    default:
      return state;
  }
}

// ============================================================
// Team Form Reducer
// ============================================================

export interface TeamFormState {
  isCreating: boolean;
  editing: Team | null;
  name: string;
  maxPlayers: string;
  halfLength: string;
  selectedFormation: string;
  sport: string;
  gameFormat: string;
  expandedTeamId: string | null;
}

export type TeamFormAction =
  | { type: 'START_CREATE' }
  | { type: 'SET_FIELD'; field: 'name' | 'maxPlayers' | 'halfLength' | 'selectedFormation' | 'sport' | 'gameFormat'; value: string }
  | { type: 'EDIT_TEAM'; team: Team }
  | { type: 'TOGGLE_EXPAND'; teamId: string }
  | { type: 'RESET' };

export const initialTeamForm: TeamFormState = {
  isCreating: false,
  editing: null,
  name: '',
  maxPlayers: DEFAULT_FORM_VALUES.maxPlayers,
  halfLength: DEFAULT_FORM_VALUES.halfLength,
  selectedFormation: '',
  sport: DEFAULT_FORM_VALUES.sport,
  gameFormat: DEFAULT_FORM_VALUES.gameFormat,
  expandedTeamId: null,
};

export function teamFormReducer(state: TeamFormState, action: TeamFormAction): TeamFormState {
  switch (action.type) {
    case 'START_CREATE':
      return { ...initialTeamForm, isCreating: true, expandedTeamId: state.expandedTeamId };
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'EDIT_TEAM':
      return {
        ...state,
        isCreating: false,
        editing: action.team,
        name: action.team.name,
        maxPlayers: action.team.maxPlayersOnField.toString(),
        halfLength: (action.team.halfLengthMinutes || 30).toString(),
        selectedFormation: action.team.formationId || '',
        sport: action.team.sport || DEFAULT_FORM_VALUES.sport,
        gameFormat: action.team.gameFormat || DEFAULT_FORM_VALUES.gameFormat,
      };
    case 'TOGGLE_EXPAND':
      return { ...state, expandedTeamId: state.expandedTeamId === action.teamId ? null : action.teamId };
    case 'RESET':
      return { ...initialTeamForm, expandedTeamId: state.expandedTeamId };
    default:
      return state;
  }
}

// ============================================================
// Roster Form Reducer
// ============================================================

export interface RosterFormState {
  isAdding: boolean;
  editing: TeamRoster | null;
  selectedPlayer: string;
  playerNumber: string;
  preferredPositions: string[];
  editFirstName: string;
  editLastName: string;
}

export type RosterFormAction =
  | { type: 'START_ADD' }
  | { type: 'SET_FIELD'; field: 'selectedPlayer' | 'playerNumber' | 'editFirstName' | 'editLastName'; value: string }
  | { type: 'SET_PREFERRED_POSITIONS'; positions: string[] }
  | { type: 'EDIT_ROSTER'; roster: TeamRoster; firstName: string; lastName: string }
  | { type: 'RESET' };

export const initialRosterForm: RosterFormState = {
  isAdding: false,
  editing: null,
  selectedPlayer: '',
  playerNumber: '',
  preferredPositions: [],
  editFirstName: '',
  editLastName: '',
};

export function rosterFormReducer(state: RosterFormState, action: RosterFormAction): RosterFormState {
  switch (action.type) {
    case 'START_ADD':
      return { ...initialRosterForm, isAdding: true };
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_PREFERRED_POSITIONS':
      return { ...state, preferredPositions: action.positions };
    case 'EDIT_ROSTER':
      return {
        isAdding: false,
        editing: action.roster,
        selectedPlayer: '',
        playerNumber: action.roster.playerNumber?.toString() || '',
        preferredPositions: action.roster.preferredPositions ? action.roster.preferredPositions.split(', ') : [],
        editFirstName: action.firstName,
        editLastName: action.lastName,
      };
    case 'RESET':
      return initialRosterForm;
    default:
      return state;
  }
}
