import { useState, useEffect, useReducer } from 'react';
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import { BugReport } from './BugReport';
import { InvitationManagement } from './InvitationManagement';
import type { Schema } from '../../amplify/data/resource';
import type { Team, Player, TeamRoster, Formation } from '../types/schema';
import { FORMATION_TEMPLATES } from '../../amplify/data/formation-templates';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import { showError, showWarning } from '../utils/toast';
import { handleApiError, logError } from '../utils/errorHandler';
import { togglePreferredPosition } from '../utils/gameCalculations';
import {
  BIRTH_YEAR_MIN,
  BIRTH_YEAR_MAX_FN,
  parseBirthYear,
  validateTeamFormData,
  validateFormationFormData,
} from '../utils/validation';
import { useConfirm } from './ConfirmModal';
import { deleteTeamCascade, deletePlayerCascade, deleteFormationCascade } from '../services/cascadeDeleteService';
import { useSwipeDelete } from '../hooks/useSwipeDelete';
import {
  playerFormReducer, initialPlayerForm,
  formationFormReducer, initialFormationForm,
  teamFormReducer, initialTeamForm,
  rosterFormReducer, initialRosterForm,
} from './managementReducers';
import { useAmplifyQuery } from '../hooks/useAmplifyQuery';
import { getAvailableBirthYears } from '../utils/rosterFilterUtils';

const client = generateClient<Schema>();

async function confirmAndDelete(
  confirmFn: ReturnType<typeof useConfirm>,
  opts: { title: string; message: string; confirmText?: string; deleteFn: () => Promise<unknown>; entityName: string },
) {
  const confirmed = await confirmFn({
    title: opts.title,
    message: opts.message,
    confirmText: opts.confirmText || 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;
  try {
    await opts.deleteFn();
  } catch (error) {
    handleApiError(error, `Failed to delete ${opts.entityName}`);
  }
}

const BIRTH_YEAR_MAX = BIRTH_YEAR_MAX_FN();

function validateTeamForm(form: { name: string; maxPlayers: string; halfLength: string }) {
  const result = validateTeamFormData(form);
  if ('error' in result) { showWarning(result.error); return null; }
  return result;
}

async function resolveFormationId(selectedFormation: string, currentUserId: string) {
  if (selectedFormation.startsWith('template-')) {
    const templateIndex = parseInt(selectedFormation.replace('template-', ''));
    const template = FORMATION_TEMPLATES[templateIndex];
    if (template) {
      const newFormation = await client.models.Formation.create({
        name: template.name,
        playerCount: template.playerCount,
        sport: 'Soccer',
        coaches: [currentUserId],
      });
      if (newFormation.data) {
        for (let i = 0; i < template.positions.length; i++) {
          const pos = template.positions[i];
          await client.models.FormationPosition.create({
            formationId: newFormation.data.id,
            positionName: pos.name,
            abbreviation: pos.abbr,
            sortOrder: i + 1,
            coaches: [currentUserId],
          });
        }
        return newFormation.data.id;
      }
    }
  }
  return selectedFormation || undefined;
}

function validateFormationForm(form: { name: string; playerCount: string; positions: { positionName: string; abbreviation: string }[] }) {
  const result = validateFormationFormData(form);
  if ('error' in result) { showWarning(result.error); return null; }
  return result;
}

async function createFormationPositions(
  formationId: string,
  positions: { positionName: string; abbreviation: string }[],
  coaches: string[],
) {
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    await client.models.FormationPosition.create({
      formationId,
      positionName: pos.positionName,
      abbreviation: pos.abbreviation,
      sortOrder: i + 1,
      coaches,
    });
  }
}

export function Management() {
  const confirm = useConfirm();
  const { data: teams } = useAmplifyQuery('Team');
  const { data: players } = useAmplifyQuery('Player');
  const { data: teamRosters } = useAmplifyQuery('TeamRoster');
  const { data: formations } = useAmplifyQuery('Formation');
  const { data: formationPositions } = useAmplifyQuery('FormationPosition');
  const [activeSection, setActiveSection] = useState<'teams' | 'formations' | 'players' | 'sharing' | 'app'>('teams');
  const [showBugReport, setShowBugReport] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  const [rosterView, setRosterView] = useState<'roster' | 'positions'>('roster');
  const [birthYearFilters, setBirthYearFilters] = useState<string[]>([]);

  // Sharing state
  const [sharingResourceType, setSharingResourceType] = useState<'team' | null>(null);
  const [sharingResourceId, setSharingResourceId] = useState<string>('');
  const [sharingResourceName, setSharingResourceName] = useState<string>('');

  // Form state (useReducer)
  const [teamForm, teamDispatch] = useReducer(teamFormReducer, initialTeamForm);
  const [rosterForm, rosterDispatch] = useReducer(rosterFormReducer, initialRosterForm);

  // Swipe-to-delete
  const { getSwipeProps, getSwipeStyle, close: closeSwipe, swipedItemId } = useSwipeDelete();

  const [formationForm, formationDispatch] = useReducer(formationFormReducer, initialFormationForm);
  const [playerForm, playerDispatch] = useReducer(playerFormReducer, initialPlayerForm);

  useEffect(() => {
    loadCurrentUser();
  }, []);


  async function loadCurrentUser() {
    try {
      const user = await getCurrentUser();
      setCurrentUserId(user.userId);
    } catch (error) {
      logError('getCurrentUser', error);
    }
  }

  const handleCreateTeam = async () => {
    const validated = validateTeamForm(teamForm);
    if (!validated) return;
    if (!currentUserId) { showError('User not authenticated'); return; }

    try {
      const formationId = await resolveFormationId(teamForm.selectedFormation, currentUserId);
      await client.models.Team.create({
        name: teamForm.name,
        coaches: [currentUserId],
        formationId,
        maxPlayersOnField: validated.maxPlayersNum,
        halfLengthMinutes: validated.halfLengthNum,
        sport: teamForm.sport,
        gameFormat: teamForm.gameFormat,
      });
      teamDispatch({ type: 'RESET' });
      trackEvent(AnalyticsEvents.TEAM_CREATED.category, AnalyticsEvents.TEAM_CREATED.action);
    } catch (error) {
      handleApiError(error, 'Failed to create team');
    }
  };

  const handleEditTeam = (team: Team) => {
    teamDispatch({ type: 'EDIT_TEAM', team });
  };

  const handleUpdateTeam = async () => {
    if (!teamForm.editing) return;
    const validated = validateTeamForm(teamForm);
    if (!validated) return;

    try {
      const formationId = await resolveFormationId(teamForm.selectedFormation, currentUserId);
      await client.models.Team.update({
        id: teamForm.editing.id,
        name: teamForm.name,
        formationId,
        maxPlayersOnField: validated.maxPlayersNum,
        halfLengthMinutes: validated.halfLengthNum,
        sport: teamForm.sport,
        gameFormat: teamForm.gameFormat,
      });
      teamDispatch({ type: 'RESET' });
    } catch (error) {
      handleApiError(error, 'Failed to update team');
    }
  };

  const handleCancelTeamEdit = () => {
    teamDispatch({ type: 'RESET' });
  };

  const handleDeleteTeam = (id: string) => confirmAndDelete(confirm, {
    title: 'Delete Team',
    message: 'Are you sure you want to delete this team? This will also delete all players, positions, and games.',
    deleteFn: () => deleteTeamCascade(id),
    entityName: 'team',
  });

  const toggleBirthYearFilter = (year: string) => {
    setBirthYearFilters(prev => {
      const next = prev.includes(year) ? prev.filter(y => y !== year) : [...prev, year];
      // Deselect the currently chosen player if they no longer match the new filter
      if (rosterForm.selectedPlayer) {
        const selected = players.find(p => p.id === rosterForm.selectedPlayer);
        // Deselect if: player has a birth year that doesn't match, OR player has no birth year
        // (null-birthYear players are hidden by the filter predicate, so must also be deselected)
        const stillVisible = selected &&
          selected.birthYear != null &&
          next.includes(String(selected.birthYear));
        if (!stillVisible) {
          rosterDispatch({ type: 'SET_FIELD', field: 'selectedPlayer', value: '' });
        }
      }
      return next;
    });
  };

  const handleAddPlayerToRoster = async (teamId: string) => {
    if (!rosterForm.selectedPlayer || !rosterForm.playerNumber.trim()) {
      showWarning('Please select a player and enter a player number');
      return;
    }

    const num = parseInt(rosterForm.playerNumber);
    if (isNaN(num) || num < 1 || num > 99) {
      showWarning('Please enter a valid player number (1-99)');
      return;
    }

    // Check if player is already on this team's roster
    if (teamRosters.some(r => r.teamId === teamId && r.playerId === rosterForm.selectedPlayer)) {
      showWarning('This player is already on the team roster');
      return;
    }

    // Check if number is already in use on this team
    if (teamRosters.some(r => r.teamId === teamId && r.playerNumber === num)) {
      showWarning('This player number is already in use on this team');
      return;
    }

    const team = teams.find(t => t.id === teamId);
    if (!team) {
      showError('Team not found');
      return;
    }

    try {
      await client.models.TeamRoster.create({
        teamId,
        playerId: rosterForm.selectedPlayer,
        playerNumber: num,
        preferredPositions: rosterForm.preferredPositions.length > 0
          ? rosterForm.preferredPositions.join(', ')
          : undefined,
        coaches: team.coaches, // Copy coaches array from team
      });

      rosterDispatch({ type: 'RESET' });
      setBirthYearFilters([]);
    } catch (error) {
      handleApiError(error, 'Failed to add player to roster');
    }
  };

  const handleRemovePlayerFromRoster = (rosterId: string) => confirmAndDelete(confirm, {
    title: 'Remove from Roster',
    message: 'Are you sure you want to remove this player from the team roster?',
    confirmText: 'Remove',
    deleteFn: () => client.models.TeamRoster.delete({ id: rosterId }),
    entityName: 'player from roster',
  });

  const handleEditRoster = (roster: TeamRoster) => {
    const player = players.find(p => p.id === roster.playerId);
    rosterDispatch({
      type: 'EDIT_ROSTER',
      roster,
      firstName: player?.firstName || '',
      lastName: player?.lastName || '',
    });
  };

  const handleUpdateRoster = async () => {
    if (!rosterForm.editing) return;

    if (!rosterForm.playerNumber.trim()) {
      showWarning('Please enter a player number');
      return;
    }

    const num = parseInt(rosterForm.playerNumber);
    if (isNaN(num) || num < 1 || num > 99) {
      showWarning('Player number must be between 1 and 99');
      return;
    }

    // Check if number is already in use by another player on this team
    if (teamRosters.some(r => r.teamId === rosterForm.editing!.teamId && r.playerNumber === num && r.id !== rosterForm.editing!.id)) {
      showWarning('This player number is already in use on this team');
      return;
    }

    if (!rosterForm.editFirstName.trim() || !rosterForm.editLastName.trim()) {
      showWarning('Please enter first name and last name');
      return;
    }

    try {
      // Update player name
      await client.models.Player.update({
        id: rosterForm.editing.playerId,
        firstName: rosterForm.editFirstName,
        lastName: rosterForm.editLastName,
      });

      // Update roster entry
      await client.models.TeamRoster.update({
        id: rosterForm.editing.id,
        playerNumber: num,
        preferredPositions: rosterForm.preferredPositions.length > 0
          ? rosterForm.preferredPositions.join(', ')
          : undefined,
      });

      rosterDispatch({ type: 'RESET' });
    } catch (error) {
      handleApiError(error, 'Failed to update roster');
    }
  };

  const handleCancelRosterEdit = () => {
    rosterDispatch({ type: 'RESET' });
    setBirthYearFilters([]);
  };

  const handleDeletePlayer = (id: string) => confirmAndDelete(confirm, {
    title: 'Delete Player',
    message: 'Are you sure you want to delete this player? This will remove them from all team rosters.',
    deleteFn: () => deletePlayerCascade(id),
    entityName: 'player',
  });

  const handleTogglePlayerPosition = async (rosterId: string, positionId: string, add: boolean) => {
    const roster = teamRosters.find(r => r.id === rosterId);
    if (!roster) return;

    try {
      await client.models.TeamRoster.update({
        id: rosterId,
        preferredPositions: togglePreferredPosition(roster.preferredPositions, positionId, add),
      });
    } catch (error) {
      handleApiError(error, 'Failed to update position assignment');
    }
  };

  const getTeamFormationPositions = (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team?.formationId) return [];
    return formationPositions.filter(fp => fp.formationId === team.formationId);
  };


  const handleCreatePlayer = async () => {
    if (!playerForm.firstName.trim() || !playerForm.lastName.trim()) {
      showWarning('Please enter first name and last name');
      return;
    }

    const birthYear = parseBirthYear(playerForm.birthYear);
    if (birthYear === null) {
      showWarning(`Birth year must be between ${BIRTH_YEAR_MIN} and ${BIRTH_YEAR_MAX}`);
      return;
    }

    if (!currentUserId) {
      showError('User not authenticated');
      return;
    }

    try {
      await client.models.Player.create({
        firstName: playerForm.firstName,
        lastName: playerForm.lastName,
        birthYear,
        coaches: [currentUserId],
      });

      trackEvent(AnalyticsEvents.PLAYER_ADDED.category, AnalyticsEvents.PLAYER_ADDED.action);
      playerDispatch({ type: 'RESET' });
    } catch (error) {
      handleApiError(error, 'Failed to create player');
    }
  };

  const handleEditPlayer = (player: Player) => {
    playerDispatch({ type: 'EDIT_PLAYER', player });
  };

  const handleUpdatePlayer = async () => {
    if (!playerForm.editing) return;

    if (!playerForm.firstName.trim() || !playerForm.lastName.trim()) {
      showWarning('Please enter first name and last name');
      return;
    }

    const birthYear = parseBirthYear(playerForm.birthYear);
    if (birthYear === null) {
      showWarning(`Birth year must be between ${BIRTH_YEAR_MIN} and ${BIRTH_YEAR_MAX}`);
      return;
    }

    try {
      await client.models.Player.update({
        id: playerForm.editing.id,
        firstName: playerForm.firstName,
        lastName: playerForm.lastName,
        birthYear,
      });

      playerDispatch({ type: 'RESET' });
    } catch (error) {
      handleApiError(error, 'Failed to update player');
    }
  };

  const handleCancelPlayerEdit = () => {
    playerDispatch({ type: 'RESET' });
  };

  const handleCreateFormation = async () => {
    const validated = validateFormationForm(formationForm);
    if (!validated) return;
    if (!currentUserId) { showError('User not authenticated'); return; }

    try {
      const formation = await client.models.Formation.create({
        name: formationForm.name,
        playerCount: validated.count,
        sport: formationForm.sport,
        coaches: [currentUserId],
      });
      if (formation.data) {
        await createFormationPositions(formation.data.id, formationForm.positions, [currentUserId]);
      }
      formationDispatch({ type: 'RESET' });
    } catch (error) {
      handleApiError(error, 'Failed to create formation');
    }
  };

  const handleEditFormation = (formation: Formation) => {
    // Load existing positions for this formation
    const existingPositions = formationPositions
      .filter(p => p.formationId === formation.id)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(p => ({ positionName: p.positionName, abbreviation: p.abbreviation }));

    formationDispatch({ type: 'EDIT_FORMATION', formation, positions: existingPositions });
  };

  const handleUpdateFormation = async () => {
    if (!formationForm.editing) return;
    const validated = validateFormationForm(formationForm);
    if (!validated) return;

    try {
      await client.models.Formation.update({
        id: formationForm.editing.id,
        name: formationForm.name,
        playerCount: validated.count,
        sport: formationForm.sport,
      });

      // Delete all existing positions, then recreate
      const existingPositions = formationPositions.filter(p => p.formationId === formationForm.editing!.id);
      for (const pos of existingPositions) {
        await client.models.FormationPosition.delete({ id: pos.id });
      }
      await createFormationPositions(formationForm.editing.id, formationForm.positions, formationForm.editing.coaches || []);

      formationDispatch({ type: 'RESET' });
    } catch (error) {
      handleApiError(error, 'Failed to update formation');
    }
  };

  const handleCancelFormationEdit = () => {
    formationDispatch({ type: 'RESET' });
  };

  const handleDeleteFormation = (id: string) => confirmAndDelete(confirm, {
    title: 'Delete Formation',
    message: 'Are you sure you want to delete this formation? This will also delete all positions in the formation.',
    deleteFn: () => deleteFormationCascade(id),
    entityName: 'formation',
  });

  const updateFormationPosition = (index: number, field: 'positionName' | 'abbreviation', value: string) => {
    formationDispatch({ type: 'UPDATE_POSITION', index, field, value });
  };

  const getFormationName = (formationId: string | null | undefined) => {
    if (!formationId) return null;
    return formations.find(f => f.id === formationId)?.name || null;
  };


  // Filter formations to only show those where user is a coach OR used by teams the user has access to
  const accessibleFormations = formations.filter(formation => 
    formation.coaches?.includes(currentUserId) || 
    teams.some(team => team.formationId === formation.id)
  );

  // Filter players to show those on rosters for accessible teams OR where user is a coach
  const teamIds = new Set(teams.map(t => t.id));
  const accessiblePlayerIds = new Set(
    teamRosters
      .filter(roster => teamIds.has(roster.teamId))
      .map(roster => roster.playerId)
  );
  const accessiblePlayers = players.filter(player => 
    player.coaches?.includes(currentUserId) || accessiblePlayerIds.has(player.id)
  );

  // Filter templates based on max players on field, preserving global index
  const getFilteredTemplates = () => {
    const maxPlayersNum = parseInt(teamForm.maxPlayers);
    const indexed = FORMATION_TEMPLATES.map((template, globalIndex) => ({ ...template, globalIndex }));
    if (isNaN(maxPlayersNum) || maxPlayersNum < 1) {
      return indexed;
    }
    return indexed.filter(template => template.playerCount === maxPlayersNum);
  };

  return (
    <div className="management">

      <div className="management-tabs">
        <button
          className={`management-tab ${activeSection === 'teams' ? 'active' : ''}`}
          onClick={() => setActiveSection('teams')}
        >
          Teams ({teams.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'formations' ? 'active' : ''}`}
          onClick={() => setActiveSection('formations')}
        >
          Formations ({accessibleFormations.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'players' ? 'active' : ''}`}
          onClick={() => setActiveSection('players')}
        >
          Players ({accessiblePlayers.length})
        </button>
        <button
          className={`management-tab ${activeSection === 'sharing' ? 'active' : ''}`}
          onClick={() => setActiveSection('sharing')}
        >
          Sharing
        </button>
        <button
          className={`management-tab ${activeSection === 'app' ? 'active' : ''}`}
          onClick={() => setActiveSection('app')}
        >
          App
        </button>
      </div>

      {activeSection === 'teams' && (
        <div className="management-section">
          {!teamForm.isCreating && !teamForm.editing && (
            <button onClick={() => teamDispatch({ type: 'START_CREATE' })} className="btn-primary">
              + Create New Team
            </button>
          )}

          {teamForm.editing && (
            <div className="create-form">
              <h3>Edit Team</h3>
              <label>
                Team Name *
                <input
                  type="text"
                  placeholder="Enter team name"
                  value={teamForm.name}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
                />
              </label>
              <label>
                Max Players on Field *
                <input
                  type="number"
                  placeholder="Enter max players"
                  value={teamForm.maxPlayers}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'maxPlayers', value: e.target.value })}
                  min="1"
                />
              </label>
              <label>
                Half Length (minutes) *
                <input
                  type="number"
                  placeholder="Enter half length"
                  value={teamForm.halfLength}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'halfLength', value: e.target.value })}
                  min="1"
                />
              </label>
              <label>
                Sport
                <select
                  value={teamForm.sport}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'sport', value: e.target.value })}
                >
                  <option value="Soccer">Soccer</option>
                </select>
              </label>
              <label>
                Game Format
                <select
                  value={teamForm.gameFormat}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'gameFormat', value: e.target.value })}
                >
                  <option value="Halves">Halves</option>
                  <option value="Quarters">Quarters</option>
                </select>
              </label>
              <label>
                Formation
                <select
                  value={teamForm.selectedFormation}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'selectedFormation', value: e.target.value })}
                >
                  <option value="">Select formation (optional)</option>
                  <optgroup label="My Formations">
                    {accessibleFormations.map((formation) => (
                      <option key={formation.id} value={formation.id}>
                        {formation.name} ({formation.playerCount} players)
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Standard Templates">
                    {getFilteredTemplates().map((template) => (
                      <option key={`template-${template.globalIndex}`} value={`template-${template.globalIndex}`}>
                        {template.name} ({template.playerCount} players)
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <div className="form-actions">
                <button onClick={handleUpdateTeam} className="btn-primary">
                  Update
                </button>
                <button
                  onClick={handleCancelTeamEdit}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {teamForm.isCreating && (
            <div className="create-form">
              <h3>Create New Team</h3>
              <label>
                Team Name *
                <input
                  type="text"
                  placeholder="Enter team name"
                  value={teamForm.name}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
                />
              </label>
              <label>
                Max Players on Field *
                <input
                  type="number"
                  placeholder="Enter max players"
                  value={teamForm.maxPlayers}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'maxPlayers', value: e.target.value })}
                  min="1"
                />
              </label>
              <label>
                Half Length (minutes) *
                <input
                  type="number"
                  placeholder="Enter half length"
                  value={teamForm.halfLength}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'halfLength', value: e.target.value })}
                  min="1"
                />
              </label>
              <label>
                Sport
                <select
                  value={teamForm.sport}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'sport', value: e.target.value })}
                >
                  <option value="Soccer">Soccer</option>
                </select>
              </label>
              <label>
                Game Format
                <select
                  value={teamForm.gameFormat}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'gameFormat', value: e.target.value })}
                >
                  <option value="Halves">Halves</option>
                  <option value="Quarters">Quarters</option>
                </select>
              </label>
              <label>
                Formation
                <select
                  value={teamForm.selectedFormation}
                  onChange={(e) => teamDispatch({ type: 'SET_FIELD', field: 'selectedFormation', value: e.target.value })}
                >
                  <option value="">Select formation (optional)</option>
                  <optgroup label="My Formations">
                    {accessibleFormations.map((formation) => (
                      <option key={formation.id} value={formation.id}>
                        {formation.name} ({formation.playerCount} players)
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Standard Templates">
                    {getFilteredTemplates().map((template) => (
                      <option key={`template-${template.globalIndex}`} value={`template-${template.globalIndex}`}>
                        {template.name} ({template.playerCount} players)
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <div className="form-actions">
                <button onClick={handleCreateTeam} className="btn-primary">
                  Create
                </button>
                <button
                  onClick={() => teamDispatch({ type: 'RESET' })}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {teams.length === 0 ? (
              <p className="empty-message">No teams yet. Create your first team!</p>
            ) : (
              teams.map((team) => {
                const teamRosterList = teamRosters.filter(r => r.teamId === team.id);
                const isExpanded = teamForm.expandedTeamId === team.id;
                const isSwiped = swipedItemId === team.id;

                return (
                  <div key={team.id} className={`team-card-wrapper ${isExpanded ? 'expanded' : ''}`}>
                    <div className="swipeable-item-container">
                      <div
                        className="item-card"
                        style={getSwipeStyle(team.id)}
                        {...getSwipeProps(team.id)}
                      >
                        <div className="item-info">
                          <h3>{team.name}</h3>
                          <p className="item-meta">
                            {team.maxPlayersOnField} players • {team.halfLengthMinutes} min halves
                            {getFormationName(team.formationId) && (
                              <> • Formation: {getFormationName(team.formationId)}</>
                            )}
                          </p>
                          <p className="item-meta">Roster: {teamRosterList.length} player(s)</p>
                        </div>
                        <div className="card-actions">
                          <button
                            onClick={() => teamDispatch({ type: 'TOGGLE_EXPAND', teamId: team.id })}
                            className="btn-edit"
                            aria-label={isExpanded ? "Hide roster" : "Show roster"}
                            title={isExpanded ? "Hide roster" : "Show roster"}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          <button
                            onClick={() => handleEditTeam(team)}
                            className="btn-edit"
                            aria-label="Edit team"
                          >
                            ✎
                          </button>
                        </div>
                      </div>
                      {isSwiped && (
                        <div className="delete-action">
                          <button
                            onClick={() => {
                              handleDeleteTeam(team.id);
                              closeSwipe();
                            }}
                            className="btn-delete-swipe"
                            aria-label="Delete team"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {isExpanded && (
                      <div className="team-roster-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <h4 style={{ margin: 0 }}>Team Roster</h4>
                          {getTeamFormationPositions(team.id).length > 0 && (
                            <div className="view-toggle">
                              <button
                                className={rosterView === 'roster' ? 'active' : ''}
                                onClick={() => setRosterView('roster')}
                              >
                                Roster
                              </button>
                              <button
                                className={rosterView === 'positions' ? 'active' : ''}
                                onClick={() => setRosterView('positions')}
                              >
                                Positions
                              </button>
                            </div>
                          )}
                        </div>

                        {rosterView === 'positions' && getTeamFormationPositions(team.id).length > 0 ? (
                          <div className="position-assignments">
                            {getTeamFormationPositions(team.id).map(position => {
                              const assignedRosters = teamRosterList.filter(r =>
                                r.preferredPositions?.split(', ').includes(position.id)
                              );
                              const unassignedRosters = teamRosterList.filter(r =>
                                !r.preferredPositions?.split(', ').includes(position.id)
                              );

                              return (
                                <div key={position.id} className="position-assignment-card">
                                  <div className="position-assignment-header">
                                    <strong>{position.abbreviation} — {position.positionName}</strong>
                                    <span className="position-count">{assignedRosters.length}</span>
                                  </div>
                                  {assignedRosters.length > 0 && (
                                    <div className="position-assigned-players">
                                      {assignedRosters.map(roster => {
                                        const player = players.find(p => p.id === roster.playerId);
                                        if (!player) return null;
                                        return (
                                          <div key={roster.id} className="position-player-tag">
                                            <span>#{roster.playerNumber} {player.firstName} {player.lastName}</span>
                                            <button
                                              onClick={() => handleTogglePlayerPosition(roster.id, position.id, false)}
                                              className="btn-remove-tag"
                                              aria-label={`Remove ${player.firstName} from ${position.abbreviation}`}
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {unassignedRosters.length > 0 && (
                                    <select
                                      className="player-select"
                                      value=""
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          handleTogglePlayerPosition(e.target.value, position.id, true);
                                        }
                                      }}
                                    >
                                      <option value="">+ Add player...</option>
                                      {unassignedRosters.map(roster => {
                                        const player = players.find(p => p.id === roster.playerId);
                                        if (!player) return null;
                                        return (
                                          <option key={roster.id} value={roster.id}>
                                            #{roster.playerNumber} {player.firstName} {player.lastName}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                        <>
                        {!rosterForm.isAdding && !rosterForm.editing && (
                          <button
                            onClick={() => rosterDispatch({ type: 'START_ADD' })}
                            className="btn-secondary" 
                            style={{ marginBottom: '1rem' }}
                          >
                            + Add Player to Roster
                          </button>
                        )}
                        
                        {rosterForm.isAdding && (
                          <div className="create-form" style={{ marginBottom: '1rem' }}>
                            <h5>Add Player to Roster</h5>
                            {(() => {
                              const availablePlayers = players.filter(p => !teamRosterList.some(r => r.playerId === p.id));
                              const years = getAvailableBirthYears(availablePlayers);
                              return years.length > 0 ? (
                                <div className="checkbox-group birth-year-filter">
                                  <div className="birth-year-filter__header">
                                    <label className="group-label">Filter by Birth Year</label>
                                    {birthYearFilters.length > 0 && (
                                      <button
                                        type="button"
                                        className="btn-link"
                                        onClick={() => {
                                          setBirthYearFilters([]);
                                          rosterDispatch({ type: 'SET_FIELD', field: 'selectedPlayer', value: '' });
                                        }}
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                  <div className="birth-year-filter__options">
                                    {years.map(year => (
                                      <label key={year} className="checkbox-label">
                                        <input
                                          type="checkbox"
                                          checked={birthYearFilters.includes(String(year))}
                                          onChange={() => toggleBirthYearFilter(String(year))}
                                        />
                                        <span>{year}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              ) : null;
                            })()}
                            <select
                              value={rosterForm.selectedPlayer}
                              onChange={(e) => rosterDispatch({ type: 'SET_FIELD', field: 'selectedPlayer', value: e.target.value })}
                            >
                              <option value="">Select Player *</option>
                              {players
                                .filter(p => !teamRosterList.some(r => r.playerId === p.id))
                                .filter(p => birthYearFilters.length === 0 || (p.birthYear != null && birthYearFilters.includes(String(p.birthYear))))
                                .map(player => (
                                  <option key={player.id} value={player.id}>
                                    {player.firstName} {player.lastName}
                                    {player.birthYear ? ` (${player.birthYear})` : ''}
                                  </option>
                                ))}
                            </select>
                            <input
                              type="number"
                              placeholder="Player Number *"
                              value={rosterForm.playerNumber}
                              onChange={(e) => rosterDispatch({ type: 'SET_FIELD', field: 'playerNumber', value: e.target.value })}
                              min="1"
                              max="99"
                            />
                            {getTeamFormationPositions(team.id).length > 0 && (
                              <div className="checkbox-group">
                                <label className="group-label">Preferred Positions (optional)</label>
                                {getTeamFormationPositions(team.id).map((position) => (
                                  <label key={position.id} className="checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={rosterForm.preferredPositions.includes(position.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          rosterDispatch({ type: 'SET_PREFERRED_POSITIONS', positions: [...rosterForm.preferredPositions, position.id] });
                                        } else {
                                          rosterDispatch({ type: 'SET_PREFERRED_POSITIONS', positions: rosterForm.preferredPositions.filter(id => id !== position.id) });
                                        }
                                      }}
                                    />
                                    {position.abbreviation} - {position.positionName}
                                  </label>
                                ))}
                              </div>
                            )}
                            <div className="form-actions">
                              <button onClick={() => handleAddPlayerToRoster(team.id)} className="btn-primary">
                                Add
                              </button>
                              <button
                                onClick={handleCancelRosterEdit}
                                className="btn-secondary"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {teamRosterList.length === 0 ? (
                          <p className="empty-message" style={{ fontSize: '0.9em' }}>No players on roster yet.</p>
                        ) : (
                          <div className="roster-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {teamRosterList.map((roster) => {
                              const player = players.find(p => p.id === roster.playerId);
                              if (!player) return null;

                              const isEditingRoster = rosterForm.editing?.id === roster.id;

                              if (isEditingRoster) {
                                return (
                                  <div key={roster.id} className="create-form" style={{ marginBottom: '0.25rem' }}>
                                    <h5>Edit Roster Entry</h5>
                                    <label>
                                      First Name *
                                      <input
                                        type="text"
                                        placeholder="Enter first name"
                                        value={rosterForm.editFirstName}
                                        onChange={(e) => rosterDispatch({ type: 'SET_FIELD', field: 'editFirstName', value: e.target.value })}
                                      />
                                    </label>
                                    <label>
                                      Last Name *
                                      <input
                                        type="text"
                                        placeholder="Enter last name"
                                        value={rosterForm.editLastName}
                                        onChange={(e) => rosterDispatch({ type: 'SET_FIELD', field: 'editLastName', value: e.target.value })}
                                      />
                                    </label>
                                    <label>
                                      Player Number *
                                      <input
                                        type="number"
                                        placeholder="Player Number"
                                        value={rosterForm.playerNumber}
                                        onChange={(e) => rosterDispatch({ type: 'SET_FIELD', field: 'playerNumber', value: e.target.value })}
                                        min="1"
                                        max="99"
                                      />
                                    </label>
                                    {getTeamFormationPositions(team.id).length > 0 && (
                                      <div className="checkbox-group">
                                        <label className="group-label">Preferred Positions (optional)</label>
                                        {getTeamFormationPositions(team.id).map((position) => (
                                          <label key={position.id} className="checkbox-label">
                                            <input
                                              type="checkbox"
                                              checked={rosterForm.preferredPositions.includes(position.id)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  rosterDispatch({ type: 'SET_PREFERRED_POSITIONS', positions: [...rosterForm.preferredPositions, position.id] });
                                                } else {
                                                  rosterDispatch({ type: 'SET_PREFERRED_POSITIONS', positions: rosterForm.preferredPositions.filter(id => id !== position.id) });
                                                }
                                              }}
                                            />
                                            {position.abbreviation} - {position.positionName}
                                          </label>
                                        ))}
                                      </div>
                                    )}
                                    <div className="form-actions">
                                      <button onClick={handleUpdateRoster} className="btn-primary">
                                        Update
                                      </button>
                                      <button onClick={handleCancelRosterEdit} className="btn-secondary">
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div key={roster.id} className="roster-item" style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '0.5rem',
                                  background: '#f5f5f5',
                                  borderRadius: '4px'
                                }}>
                                  <span>
                                    #{roster.playerNumber} {player.firstName} {player.lastName}
                                  </span>
                                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                      onClick={() => handleEditRoster(roster)}
                                      className="btn-edit"
                                      style={{ fontSize: '0.9em' }}
                                      aria-label="Edit roster entry"
                                    >
                                      ✎
                                    </button>
                                    <button
                                      onClick={() => handleRemovePlayerFromRoster(roster.id)}
                                      className="btn-delete"
                                      style={{ fontSize: '0.9em' }}
                                      aria-label="Remove from roster"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeSection === 'formations' && (
        <div className="management-section">
          {!formationForm.isCreating && !formationForm.editing && (
            <button onClick={() => formationDispatch({ type: 'START_CREATE' })} className="btn-primary">
              + Create Formation
            </button>
          )}

          {formationForm.editing && (
            <div className="create-form">
              <h3>Edit Formation</h3>
              <input
                type="text"
                placeholder="Formation Name (e.g., 4-3-3) *"
                value={formationForm.name}
                onChange={(e) => formationDispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
              />
              <input
                type="number"
                placeholder="Number of Players on Field *"
                value={formationForm.playerCount}
                onChange={(e) => formationDispatch({ type: 'SET_FIELD', field: 'playerCount', value: e.target.value })}
                min="1"
              />
              <div className="form-group">
                <label>Sport</label>
                <select
                  value={formationForm.sport}
                  onChange={(e) => formationDispatch({ type: 'SET_FIELD', field: 'sport', value: e.target.value })}
                >
                  <option value="Soccer">Soccer</option>
                </select>
              </div>
              <div className="form-group">
                <label>Positions {formationForm.playerCount && !isNaN(parseInt(formationForm.playerCount)) ? `(${formationForm.positions.length})` : ''}</label>
                {formationForm.positions.length === 0 && (
                  <p className="empty-message">Enter the number of players above to define positions.</p>
                )}
                {formationForm.positions.map((pos, index) => (
                  <div key={index} className="position-row">
                    <span className="position-number">{index + 1}.</span>
                    <input
                      type="text"
                      placeholder="Position Name (e.g., Left Forward)"
                      value={pos.positionName}
                      onChange={(e) => updateFormationPosition(index, 'positionName', e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="text"
                      placeholder="Abbr (e.g., LF)"
                      value={pos.abbreviation}
                      onChange={(e) => updateFormationPosition(index, 'abbreviation', e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                ))}
              </div>
              <div className="form-actions">
                <button onClick={handleUpdateFormation} className="btn-primary">
                  Update
                </button>
                <button
                  onClick={handleCancelFormationEdit}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {formationForm.isCreating && (
            <div className="create-form">
              <h3>Create New Formation</h3>
              <input
                type="text"
                placeholder="Formation Name (e.g., 4-3-3) *"
                value={formationForm.name}
                onChange={(e) => formationDispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
              />
              <input
                type="number"
                placeholder="Number of Players on Field *"
                value={formationForm.playerCount}
                onChange={(e) => formationDispatch({ type: 'SET_FIELD', field: 'playerCount', value: e.target.value })}
                min="1"
              />
              <div className="form-group">
                <label>Sport</label>
                <select
                  value={formationForm.sport}
                  onChange={(e) => formationDispatch({ type: 'SET_FIELD', field: 'sport', value: e.target.value })}
                >
                  <option value="Soccer">Soccer</option>
                </select>
              </div>
              <div className="form-group">
                <label>Positions {formationForm.playerCount && !isNaN(parseInt(formationForm.playerCount)) ? `(${formationForm.positions.length})` : ''}</label>
                {formationForm.positions.length === 0 && (
                  <p className="empty-message">Enter the number of players above to define positions.</p>
                )}
                {formationForm.positions.map((pos, index) => (
                  <div key={index} className="position-row">
                    <span className="position-number">{index + 1}.</span>
                    <input
                      type="text"
                      placeholder="Position Name (e.g., Left Forward)"
                      value={pos.positionName}
                      onChange={(e) => updateFormationPosition(index, 'positionName', e.target.value)}
                      style={{ flex: 2 }}
                    />
                    <input
                      type="text"
                      placeholder="Abbr (e.g., LF)"
                      value={pos.abbreviation}
                      onChange={(e) => updateFormationPosition(index, 'abbreviation', e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                ))}
              </div>
              <div className="form-actions">
                <button onClick={handleCreateFormation} className="btn-primary">
                  Create
                </button>
                <button
                  onClick={() => formationDispatch({ type: 'RESET' })}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {accessibleFormations.length === 0 ? (
              <p className="empty-message">No formations yet. Create your first formation!</p>
            ) : (
              accessibleFormations.map((formation) => {
                const formationPositionList = formationPositions.filter(p => p.formationId === formation.id);
                const isSwiped = swipedItemId === formation.id;

                return (
                  <div key={formation.id} className="swipeable-item-container">
                    <div
                      className="item-card"
                      style={getSwipeStyle(formation.id)}
                      {...getSwipeProps(formation.id)}
                    >
                      <div className="item-info">
                        <h3>{formation.name}</h3>
                        <p className="item-meta">
                          {formation.playerCount} players • {formation.sport || 'Soccer'}
                        </p>
                        {formationPositionList.length > 0 && (
                          <p className="item-meta" style={{ marginTop: '0.5rem' }}>
                            Positions: {formationPositionList
                              .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
                              .map(p => p.abbreviation)
                              .join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="card-actions">
                        <button
                          onClick={() => handleEditFormation(formation)}
                          className="btn-edit"
                          aria-label="Edit formation"
                        >
                          ✎
                        </button>
                      </div>
                    </div>
                    {isSwiped && (
                      <div className="delete-action">
                        <button
                          onClick={() => {
                            handleDeleteFormation(formation.id);
                            closeSwipe();
                          }}
                          className="btn-delete-swipe"
                          aria-label="Delete formation"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeSection === 'players' && (
        <div className="management-section">
          {!playerForm.isCreating && !playerForm.editing && (
            <button onClick={() => playerDispatch({ type: 'START_CREATE' })} className="btn-primary">
              + Add Player
            </button>
          )}

          {playerForm.isCreating && (
            <div className="create-form">
              <h3>Add New Player</h3>
              <input
                type="text"
                placeholder="First Name *"
                value={playerForm.firstName}
                onChange={(e) => playerDispatch({ type: 'SET_FIELD', field: 'firstName', value: e.target.value })}
              />
              <input
                type="text"
                placeholder="Last Name *"
                value={playerForm.lastName}
                onChange={(e) => playerDispatch({ type: 'SET_FIELD', field: 'lastName', value: e.target.value })}
              />
              <input
                type="number"
                placeholder="Birth Year (optional, e.g. 2015)"
                value={playerForm.birthYear}
                onChange={(e) => playerDispatch({ type: 'SET_FIELD', field: 'birthYear', value: e.target.value })}
                min={BIRTH_YEAR_MIN}
                max={BIRTH_YEAR_MAX}
              />
              <p className="form-hint">Players can be assigned to teams in the Team Management section.</p>
              <div className="form-actions">
                <button onClick={handleCreatePlayer} className="btn-primary">
                  Add
                </button>
                <button
                  onClick={() => playerDispatch({ type: 'RESET' })}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="items-list">
            {accessiblePlayers.length === 0 ? (
              <p className="empty-message">No players yet. Add your first player!</p>
            ) : (
              accessiblePlayers.map((player) => {
                // Get all team rosters for this player
                const playerRosters = teamRosters.filter(r => r.playerId === player.id);
                const teamsList = playerRosters.map(r => {
                  const team = teams.find(t => t.id === r.teamId);
                  return team ? `${team.name} #${r.playerNumber}` : '';
                }).filter(Boolean).join(', ');
                const isSwiped = swipedItemId === player.id;
                const isEditing = playerForm.editing?.id === player.id;

                if (isEditing) {
                  return (
                    <div key={player.id} className="create-form" style={{ marginBottom: '0.5rem' }}>
                      <h4>Edit Player</h4>
                      <input
                        type="text"
                        placeholder="First Name *"
                        value={playerForm.firstName}
                        onChange={(e) => playerDispatch({ type: 'SET_FIELD', field: 'firstName', value: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="Last Name *"
                        value={playerForm.lastName}
                        onChange={(e) => playerDispatch({ type: 'SET_FIELD', field: 'lastName', value: e.target.value })}
                      />
                      <input
                        type="number"
                        placeholder="Birth Year (optional, e.g. 2015)"
                        value={playerForm.birthYear}
                        onChange={(e) => playerDispatch({ type: 'SET_FIELD', field: 'birthYear', value: e.target.value })}
                        min={BIRTH_YEAR_MIN}
                        max={BIRTH_YEAR_MAX}
                      />
                      <div className="form-actions">
                        <button onClick={handleUpdatePlayer} className="btn-primary">
                          Save
                        </button>
                        <button onClick={handleCancelPlayerEdit} className="btn-secondary">
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={player.id} className="swipeable-item-container">
                    <div
                      className="item-card"
                      style={getSwipeStyle(player.id)}
                      {...getSwipeProps(player.id)}
                    >
                      <div className="item-info">
                        <h3>{player.firstName} {player.lastName}{player.birthYear ? ` (${player.birthYear})` : ''}</h3>
                        <p className="item-meta">
                          {teamsList || 'Not assigned to any team'}
                        </p>
                      </div>
                      <div className="card-actions">
                        <button
                          onClick={() => handleEditPlayer(player)}
                          className="btn-edit"
                          aria-label="Edit player"
                        >
                          ✎
                        </button>
                      </div>
                    </div>
                    {isSwiped && (
                      <div className="delete-action">
                        <button
                          onClick={() => {
                            handleDeletePlayer(player.id);
                            closeSwipe();
                          }}
                          className="btn-delete-swipe"
                          aria-label="Delete player"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeSection === 'sharing' && (
        <div className="management-section">
          <h2>Sharing & Permissions</h2>
          <p className="section-description">
            Manage who has access to your teams. Invite other coaches to collaborate or add parents for read-only access.
          </p>

          {!sharingResourceType && (
            <div className="sharing-selection">
              <h3>Select a team to share:</h3>
              
              <div className="resource-list">
                {teams.length === 0 ? (
                  <p className="empty-message">No teams yet</p>
                ) : (
                  teams.map((team) => {
                    return (
                      <div key={team.id} className="resource-item">
                        <div className="resource-info">
                          <strong>{team.name}</strong>
                        </div>
                        <button
                          onClick={() => {
                            setSharingResourceType('team');
                            setSharingResourceId(team.id);
                            setSharingResourceName(team.name);
                          }}
                          className="btn-primary"
                        >
                          Manage Sharing
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {sharingResourceType && sharingResourceId && (
            <div className="sharing-details">
              <button
                onClick={() => {
                  setSharingResourceType(null);
                  setSharingResourceId('');
                  setSharingResourceName('');
                }}
                className="btn-secondary"
                style={{ marginBottom: '20px' }}
              >
                ← Back to Selection
              </button>
              
              <InvitationManagement
                type={sharingResourceType}
                resourceId={sharingResourceId}
                resourceName={sharingResourceName}
              />
            </div>
          )}
        </div>
      )}

      {activeSection === 'app' && (
        <div className="management-section">
          <div className="app-info-section">
            <div className="app-info-card">
              <h3>📱 App Information</h3>
              <div className="app-info-item">
                <span className="info-label">Version:</span>
                <span className="info-value">{import.meta.env.VITE_APP_VERSION || '1.0.0'}</span>
              </div>
              <div className="app-info-item">
                <span className="info-label">Build Date:</span>
                <span className="info-value">
                  {import.meta.env.VITE_BUILD_TIMESTAMP 
                    ? new Date(import.meta.env.VITE_BUILD_TIMESTAMP).toLocaleString()
                    : 'Unknown'}
                </span>
              </div>
              <div className="app-info-item">
                <span className="info-label">Source Code:</span>
                <span className="info-value">
                  <a 
                    href="https://github.com/amcol/soccer-app-game-management" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#2e8555', textDecoration: 'underline' }}
                  >
                    GitHub Repository
                  </a>
                </span>
              </div>
            </div>

            <div className="app-info-card">
              <h3>🐛 Report an Issue</h3>
              <p className="info-description">
                Found a bug or have feedback? Let us know so we can improve the app.
              </p>
              <button 
                onClick={() => setShowBugReport(true)} 
                className="btn-primary"
              >
                Report Issue
              </button>
            </div>
          </div>

          {showBugReport && (
            <BugReport onClose={() => setShowBugReport(false)} />
          )}
        </div>
      )}
    </div>
  );
}
