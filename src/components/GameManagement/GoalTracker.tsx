import { useState, useCallback } from "react";
import { showWarning, showSuccess } from "../../utils/toast";
import { trackEvent, AnalyticsEvents } from "../../utils/analytics";
import { handleApiError } from "../../utils/errorHandler";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import { PlayerSelect } from "../PlayerSelect";
import { isPlayerCurrentlyPlaying } from "../../utils/playTimeCalculations";
import { isPlayerInLineup } from "../../utils/lineupUtils";
import type { GameMutationInput, GoalUpdateFields } from "../../hooks/useOfflineMutations";
import type { Game, Team, PlayerWithRoster, Goal, PlayTimeRecord, LineupAssignment } from "./types";
import { GameActionRow } from "./actions/GameActionRow";
import type { GameActionDescriptor } from "./actions/actionContract";

interface GoalTrackerProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  goals: Goal[];
  currentTime: number;
  mutations: GameMutationInput;
  playTimeRecords: PlayTimeRecord[];
  lineup: LineupAssignment[];
}

export function GoalTracker({
  gameState,
  game,
  team,
  players,
  goals,
  currentTime,
  mutations,
  playTimeRecords,
  lineup,
}: GoalTrackerProps) {
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalScoredByUs, setGoalScoredByUs] = useState(true);
  const [goalScorerId, setGoalScorerId] = useState("");
  const [goalAssistId, setGoalAssistId] = useState("");
  const [goalNotes, setGoalNotes] = useState("");

  const [showEditGoalModal, setShowEditGoalModal] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editScorerId, setEditScorerId] = useState('');
  const [editAssistId, setEditAssistId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [error, setError] = useState('');

  const onFieldPlayerIds = players
    .filter(p =>
      isPlayerCurrentlyPlaying(p.id, playTimeRecords) ||
      isPlayerInLineup(p.id, lineup)
    )
    .map(p => p.id);

  const getCurrentGameTime = () => currentTime;

  const handleOpenGoalModal = (scoredByUs: boolean) => {
    setGoalScoredByUs(scoredByUs);
    setGoalScorerId("");
    setGoalAssistId("");
    setGoalNotes("");
    setShowGoalModal(true);
  };

  const handleRecordGoal = async () => {
    if (goalScoredByUs && !goalScorerId) {
      showWarning("Please select who scored the goal");
      return;
    }

    try {
      await mutations.createGoal({
        gameId: game.id,
        scoredByUs: goalScoredByUs,
        gameSeconds: getCurrentGameTime(),
        half: gameState.currentHalf || 1,
        scorerId: goalScoredByUs && goalScorerId ? goalScorerId : undefined,
        assistId: goalScoredByUs && goalAssistId ? goalAssistId : undefined,
        notes: goalNotes || undefined,
        timestamp: new Date().toISOString(),
        coaches: team.coaches,
      });

      // In completed state, GameManagement will auto-reconcile score from goals.
      // In active states, score is derived from goals array (no manual write).
      if (gameState.status === 'completed') {
        const newOurScore = goalScoredByUs ? (gameState.ourScore || 0) + 1 : (gameState.ourScore || 0);
        const newOpponentScore = !goalScoredByUs ? (gameState.opponentScore || 0) + 1 : (gameState.opponentScore || 0);
        showSuccess(`Goal added. Final score updated to ${newOurScore}–${newOpponentScore}.`);
      }

      setShowGoalModal(false);
      trackEvent(AnalyticsEvents.GOAL_RECORDED.category, AnalyticsEvents.GOAL_RECORDED.action, goalScoredByUs ? 'own' : 'opponent');
    } catch (error) {
      handleApiError(error, 'Failed to record goal');
    }
  };

  const handleOpenEditGoalModal = useCallback((goal: Goal) => {
    setEditGoal(goal);
    setEditScorerId(goal.scorerId ?? '');
    setEditAssistId(goal.assistId ?? '');
    setEditNotes(goal.notes ?? '');
    setError('');
    setShowEditGoalModal(true);
  }, []);

  const handleCloseEditGoalModal = useCallback(() => {
    setShowEditGoalModal(false);
    setEditGoal(null);
  }, []);

  const handleSaveEditGoal = useCallback(async () => {
    if (!editGoal) return;
    if (editGoal.scoredByUs && !editScorerId) {
      setError('A scorer is required for our goals.');
      return;
    }
    setIsSavingEdit(true);
    try {
      await mutations.updateGoal(editGoal.id, {
        scorerId: editScorerId || undefined,
        assistId: editAssistId || undefined,
        notes: editNotes || undefined,
      } as GoalUpdateFields);
      
      showSuccess('Goal updated.');
      
      handleCloseEditGoalModal();
    } catch (err) {
      handleApiError(err, 'Failed to save goal');
    } finally {
      setIsSavingEdit(false);
    }
  }, [editGoal, editScorerId, editAssistId, editNotes, mutations, handleCloseEditGoalModal]);

  const handleDeleteGoal = useCallback(async (goal: Goal) => {
    try {
      await mutations.deleteGoal(goal.id);
      
      // In completed state, GameManagement will auto-reconcile score from remaining goals.
      // In active states, score is derived from goals array (no manual write).
      if (gameState.status === 'completed') {
        const newOurScore = goal.scoredByUs
          ? Math.max(0, (gameState.ourScore ?? 0) - 1)
          : (gameState.ourScore ?? 0);
        const newOpponentScore = goal.scoredByUs
          ? (gameState.opponentScore ?? 0)
          : Math.max(0, (gameState.opponentScore ?? 0) - 1);
        showSuccess(`Goal deleted. Final score updated to ${newOurScore}–${newOpponentScore}.`);
      }
    } catch (err) {
      handleApiError(err, 'Failed to delete goal');
      throw err;
    }
  }, [gameState, mutations]);

  return (
    <>
      {/* Goal Buttons */}
      {gameState.status !== 'scheduled' && (
        <div className="goal-buttons">
          <button onClick={() => handleOpenGoalModal(true)} className="btn-goal btn-goal-us">
            ⚽ Goal - Us
          </button>
          <button onClick={() => handleOpenGoalModal(false)} className="btn-goal btn-goal-opponent">
            ⚽ Goal - {gameState.opponent}
          </button>
        </div>
      )}

      {/* Empty State for Completed */}
      {gameState.status === 'completed' && goals.length === 0 && (
        <div className="goals-empty-state">
          <p>No goals recorded yet. Add a goal to correct the final score.</p>
        </div>
      )}

      {/* Goals List */}
      {goals.length > 0 && (
        <div className="goals-section">
          <h3 id="goals-heading" tabIndex={-1}>Goals</h3>
          <div className="goals-list">
            {goals.map((goal) => {
              const scorer = goal.scorerId ? players.find(p => p.id === goal.scorerId) : null;
              const assist = goal.assistId ? players.find(p => p.id === goal.assistId) : null;
              const minute = Math.floor((goal.gameSeconds ?? 0) / 60);
              const teamLabel = goal.scoredByUs ? 'Us' : (gameState.opponent ?? 'Opponent');
              const actionDescriptors: GameActionDescriptor[] = [
                {
                  id: 'edit',
                  label: 'Edit',
                  kind: 'primary',
                  ariaLabel: `Edit ${teamLabel} goal at ${minute}'`,
                  onAction: async () => {
                    handleOpenEditGoalModal(goal);
                  },
                },
                {
                  id: 'delete',
                  label: 'Delete',
                  kind: 'destructive',
                  ariaLabel: `Delete ${teamLabel} goal at ${minute}'`,
                  confirmDialog: {
                    title: 'Delete goal?',
                    body: 'This permanently removes this goal event from the game timeline.',
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                  },
                  onAction: async () => {
                    await handleDeleteGoal(goal);
                  },
                },
              ];
              return (
                <div key={goal.id} className={`goal-card ${goal.scoredByUs ? 'goal-us' : 'goal-opponent'}`}>
                  <div className="goal-icon">⚽</div>
                  <div className="goal-info">
                    <div className="goal-header">
                      <span className="goal-minute">{Math.floor(goal.gameSeconds / 60)}'</span>
                      <span className="goal-half">({goal.half === 1 ? '1st' : '2nd'} Half)</span>
                    </div>
                    {goal.scoredByUs ? (
                      <>
                        {scorer && (
                          <div className="goal-scorer">
                            #{scorer.playerNumber} {scorer.firstName} {scorer.lastName}
                          </div>
                        )}
                        {assist && (
                          <div className="goal-assist">
                            Assist: #{assist.playerNumber} {assist.firstName}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="goal-opponent-label">{gameState.opponent}</div>
                    )}
                    {goal.notes && <div className="goal-notes">{goal.notes}</div>}
                  </div>
                  <div className="goal-card-actions">
                    <GameActionRow actions={actionDescriptors} headingIdForDeleteSuccessFocus="goals-heading" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Goal Recording Modal */}
      {showGoalModal && (
        <div className="modal-overlay" onClick={() => setShowGoalModal(false)} role="dialog" aria-modal="true" aria-labelledby="record-goal-modal-title">
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="record-goal-modal-title">Record Goal</h2>
            <p className="modal-subtitle">
              {goalScoredByUs ? 'Our Goal' : `${gameState.opponent} Goal`} - {formatGameTimeDisplay(getCurrentGameTime(), gameState.currentHalf || 1)}
            </p>

            {goalScoredByUs && (
              <>
                <div className="form-group">
                  <label htmlFor="goalScorer">Who Scored? *</label>
                  <PlayerSelect
                    id="goalScorer"
                    players={players}
                    value={goalScorerId}
                    onChange={setGoalScorerId}
                    placeholder="Select player..."
                    className="w-full"
                    onFieldPlayerIds={onFieldPlayerIds}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="goalAssist">Assisted By (optional)</label>
                  <PlayerSelect
                    id="goalAssist"
                    players={players}
                    value={goalAssistId}
                    onChange={setGoalAssistId}
                    excludeId={goalScorerId}
                    placeholder="No assist / Select player..."
                    className="w-full"
                    onFieldPlayerIds={onFieldPlayerIds}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="goalNotes">Notes (optional)</label>
                  <textarea
                    id="goalNotes"
                    value={goalNotes}
                    onChange={(e) => setGoalNotes(e.target.value)}
                    placeholder="e.g., header, penalty, great shot..."
                    rows={3}
                    maxLength={500}
                    style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
                  />
                </div>
              </>
            )}

            {!goalScoredByUs && (
              <div className="form-group">
                <label htmlFor="goalNotes">Notes (optional)</label>
                <textarea
                  id="goalNotes"
                  value={goalNotes}
                  onChange={(e) => setGoalNotes(e.target.value)}
                  placeholder="Any notes about the goal..."
                  rows={3}
                  maxLength={500}
                  style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
                />
              </div>
            )}

            <div className="form-actions">
              <button onClick={handleRecordGoal} className="btn-primary">
                Record Goal
              </button>
              <button onClick={() => setShowGoalModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Goal Modal */}
      {showEditGoalModal && editGoal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-goal-modal-title">
          <div className="modal-content">
            <h2 id="edit-goal-modal-title">
              {editGoal.scoredByUs ? 'Edit Our Goal' : `Edit ${gameState.opponent ?? 'Opponent'} Goal`}
            </h2>
            <p className="modal-subtitle">
              {editGoal.scoredByUs ? 'Our Goal' : `${gameState.opponent ?? 'Opponent'} Goal`}
              {' — '}
              Half {editGoal.half}, {Math.floor((editGoal.gameSeconds ?? 0) / 60)}'
            </p>

            {editGoal.scoredByUs && (
              <>
                <div className="form-group">
                  <label>Scorer</label>
                  <PlayerSelect
                    id="editScorer"
                    players={players}
                    value={editScorerId}
                    onChange={setEditScorerId}
                    placeholder="Select scorer"
                  />
                </div>
                <div className="form-group">
                  <label>Assist (optional)</label>
                  <PlayerSelect
                    id="editAssist"
                    players={players}
                    value={editAssistId}
                    onChange={setEditAssistId}
                    placeholder="No assist / Select player..."
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Optional notes"
                rows={3}
                maxLength={500}
                autoFocus={!editGoal.scoredByUs}
              />
            </div>

            {error && <p className="error-message">{error}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveEditGoal}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCloseEditGoalModal}
                disabled={isSavingEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
