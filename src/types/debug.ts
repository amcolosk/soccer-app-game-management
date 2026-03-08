import type { GameTab } from '../components/GameManagement/TabNav';

export interface GamePlannerDebugContext {
  rotationIntervalMinutes: number;
  halfLengthMinutes: number;
  maxPlayersOnField: number;
  availablePlayerCount: number;
  players: Array<{
    number: number;
    status: string;
    availableFromMinute: number | null | undefined;
    availableUntilMinute: number | null | undefined;
    preferredPositionNames?: string[];
  }>;
  rotations?: Array<{
    rotationNumber: number;
    gameMinute: number;
    half: number;
    substitutions: Array<{
      playerOutNumber: number;
      playerInNumber: number;
      positionName: string;
    }>;
  }>;
}

export interface HomeDebugContext {
  teamCount: number;
  gameCount: number;
  scheduledCount: number;
  inProgressCount: number;   // includes 'halftime'
  completedCount: number;
  isCreatingGame: boolean;
}

export interface GameManagementDebugContext {
  gameIdPrefix: string;                          // first 8 chars of game.id
  status: string;                                // scheduled | in-progress | halftime | completed
  currentHalf: number;
  elapsedSeconds: number;
  halfLengthSeconds: number;
  isRunning: boolean;
  activeTab: GameTab;                            // field | bench | goals | notes
  rosterSize: number;
  lineupCount: number;
  starterCount: number;
  openPlayTimeRecordCount: number;
  closedPlayTimeRecordCount: number;
  ourScore: number;
  opponentScore: number;
  goalCount: number;
  gameNoteCount: number;
  availabilityByStatus: Record<string, number>;  // { available: N, absent: N, ... }
  planExists: boolean;
  plannedRotationCount: number;
  planConflictCount: number;
  substitutionQueueLength: number;
}

export interface SeasonReportDebugContext {
  teamIdPrefix: string;       // first 8 chars of team.id
  teamName: string;           // coach-entered team name
  rosterSize: number;
  totalGames: number;
  completedGames: number;
  scheduledGames: number;
  allSynced: boolean;
  loading: boolean;
  playerStatsCount: number;  // 0 during loading — use 'loading' flag to disambiguate
  hasSelectedPlayer: boolean;
}

export interface ManagementDebugContext {
  activeSection: string;             // teams | formations | players | sharing | app
  teamCount: number;
  playerCount: number;
  rosterCount: number;
  formationCount: number;
  formationPositionCount: number;
  editingTeamId: string | null;      // first 8 chars of editing team id, or null
  editingFormationId: string | null; // first 8 chars of editing formation id, or null
  birthYearFilterCount: number;
}

export interface UserProfileDebugContext {
  emailDomain: string;              // only the part after '@'; '(loading)' if not yet loaded
  pendingInvitationCount: number;
  invitationTeamCount: number;      // # of teams fetched for pending invitations (NOT user's own teams)
  isChangingPassword: boolean;
  isDeletingAccount: boolean;
}
