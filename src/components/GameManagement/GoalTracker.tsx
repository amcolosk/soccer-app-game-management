import { useState } from "react";
import { showWarning } from "../../utils/toast";
import { trackEvent, AnalyticsEvents } from "../../utils/analytics";
import { handleApiError } from "../../utils/errorHandler";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import { PlayerSelect } from "../PlayerSelect";
import { isPlayerCurrentlyPlaying } from "../../utils/playTimeCalculations";
import { isPlayerInLineup } from "../../utils/lineupUtils";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";
import type { Game, Team, PlayerWithRoster, Goal, PlayTimeRecord, LineupAssignment } from "./types";

interface GoalTrackerProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  goals: Goal[];
  currentTime: number;
  onScoreUpdate: (ourScore: number, opponentScore: number) => void;
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
  onScoreUpdate,
  mutations,
  playTimeRecords,
  lineup,
}: GoalTrackerProps) {
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalScoredByUs, setGoalScoredByUs] = useState(true);
  const [goalScorerId, setGoalScorerId] = useState("");
  const [goalAssistId, setGoalAssistId] = useState("");
  const [goalNotes, setGoalNotes] = useState("");

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

      const newOurScore = goalScoredByUs ? (gameState.ourScore || 0) + 1 : (gameState.ourScore || 0);
      const newOpponentScore = !goalScoredByUs ? (gameState.opponentScore || 0) + 1 : (gameState.opponentScore || 0);

      await mutations.updateGame(game.id, {
        ourScore: newOurScore,
        opponentScore: newOpponentScore,
      });

      onScoreUpdate(newOurScore, newOpponentScore);
      setShowGoalModal(false);
      trackEvent(AnalyticsEvents.GOAL_RECORDED.category, AnalyticsEvents.GOAL_RECORDED.action, goalScoredByUs ? 'own' : 'opponent');
    } catch (error) {
      handleApiError(error, 'Failed to record goal');
    }
  };

  return (
    <>
      {/* Goal Buttons */}
      {gameState.status !== 'scheduled' && gameState.status !== 'completed' && (
        <div className="goal-buttons">
          <button onClick={() => handleOpenGoalModal(true)} className="btn-goal btn-goal-us">
            ⚽ Goal - Us
          </button>
          <button onClick={() => handleOpenGoalModal(false)} className="btn-goal btn-goal-opponent">
            ⚽ Goal - {gameState.opponent}
          </button>
        </div>
      )}

      {/* Goals List */}
      {goals.length > 0 && (
        <div className="goals-section">
          <h3>Goals</h3>
          <div className="goals-list">
            {goals.map((goal) => {
              const scorer = goal.scorerId ? players.find(p => p.id === goal.scorerId) : null;
              const assist = goal.assistId ? players.find(p => p.id === goal.assistId) : null;
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
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Goal Recording Modal */}
      {showGoalModal && (
        <div className="modal-overlay" onClick={() => setShowGoalModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Record Goal</h2>
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
    </>
  );
}
