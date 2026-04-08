import type {
  Formation,
  FormationPosition,
  Player,
  Team,
  TeamRoster,
} from '../../types/schema';

export interface ManagementQueryFixtures {
  Team: Team[];
  Player: Player[];
  TeamRoster: TeamRoster[];
  Formation: Formation[];
  FormationPosition: FormationPosition[];
}

export function teamFixture(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Thunder FC',
    formationId: null,
    maxPlayersOnField: 7,
    halfLengthMinutes: 25,
    sport: 'Soccer',
    gameFormat: 'Halves',
    coaches: ['test-user-id'],
    ...overrides,
  } as Team;
}

export function playerFixture(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    firstName: 'Alex',
    lastName: 'Riley',
    birthYear: 2013,
    coaches: ['test-user-id'],
    ...overrides,
  } as Player;
}

export function formationFixture(overrides: Partial<Formation> = {}): Formation {
  return {
    id: 'formation-1',
    name: '4-3-3',
    playerCount: 7,
    sport: 'Soccer',
    coaches: ['test-user-id'],
    ...overrides,
  } as Formation;
}

export function formationPositionFixture(
  overrides: Partial<FormationPosition> = {},
): FormationPosition {
  return {
    id: 'position-1',
    formationId: 'formation-1',
    positionName: 'Goalkeeper',
    abbreviation: 'GK',
    sortOrder: 1,
    coaches: ['test-user-id'],
    ...overrides,
  } as FormationPosition;
}

export function teamRosterFixture(overrides: Partial<TeamRoster> = {}): TeamRoster {
  return {
    id: 'roster-1',
    teamId: 'team-1',
    playerId: 'player-1',
    playerNumber: 10,
    preferredPositions: '',
    coaches: ['test-user-id'],
    ...overrides,
  } as TeamRoster;
}

export function managementFixtures(
  overrides: Partial<ManagementQueryFixtures> = {},
): ManagementQueryFixtures {
  return {
    Team: [],
    Player: [],
    TeamRoster: [],
    Formation: [],
    FormationPosition: [],
    ...overrides,
  };
}
