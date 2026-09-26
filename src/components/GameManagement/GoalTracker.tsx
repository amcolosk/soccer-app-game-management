import { useState, useCallback } from "react";
import { showSuccess } from "../../utils/toast";
import { handleApiError } from "../../utils/errorHandler";
import { PlayerSelect } from "../PlayerSelect";
import type { GameMutationInput, GoalUpdateFields } from "../../hooks/useOfflineMutations";
import type { Game, PlayerWithRoster, Goal } from "./types";
import { GameActionRow } from "./actions/GameActionRow";
import type { GameActionDescriptor } from "./actions/actionContract";

interface GoalTrackerProps {
  gameState: Game;
  players: PlayerWithRoster[];
  goals: Goal[];
  mutations: GameMutationInput;
}

// Goal CREATION now happens exclusively through the unified
// ShotOutcomeEntry.tsx flow ("Log Shot – Us"/"Log Shot – Them" -> outcome
// GOAL, see the Unified Shot-Outcome Tracking plan) -- this component keeps
// only the Goals list, edit modal, and delete flow. GameManagement.tsx still
// passes it the larger `sharedGoalTrackerProps` object (game/team/
// currentTime/playTimeRecords/lineup included) via JSX spread; those extra
// fields are simply unused here now, not a type error, since JSX spread
// isn't subject to excess-property checks.
export function GoalTracker({
  gameState,
  players,
  goals,
  mutations,
}: GoalTrackerProps) {
  const [showEditGoalModal, setShowEditGoalModal] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editScorerId, setEditScorerId] = useState('');
  const [editAssistId, setEditAssistId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [error, setError] = useState('');

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
      {/* Empty State for Completed -- reworded (m6/UI review) since the
          dedicated Goal-only entry button this copy used to reference no
          longer exists; points at the new two-button unified flow instead. */}
      {gameState.status === 'completed' && goals.length === 0 && (
        <div className="goals-empty-state">
          <p>No goals recorded yet. To correct the final score, tap Log Shot – Us or Log Shot – Them, then choose Goal.</p>
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
                    // i4: the matching Shot row (if any) is a separate,
                    // unlinked-by-design record -- deleting this Goal never
                    // touches it, so say so explicitly rather than leaving
                    // an apparently-orphaned Shot row as a surprise.
                    body: 'This permanently removes this goal event from the game timeline. The matching shot stays in the Shots list.',
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
                    {goal.loggedVia === 'HELPER' && (
                      <div className="stat-logged-via-helper">Logged via helper</div>
                    )}
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
