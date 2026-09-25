import { useState } from "react";
import { showSuccess } from "../../utils/toast";
import { trackEvent, AnalyticsEvents } from "../../utils/analytics";
import { handleApiError } from "../../utils/errorHandler";
import { PlayerSelect } from "../PlayerSelect";
import { isPlayerCurrentlyPlaying, getCurrentGoalkeeperId } from "../../utils/playTimeCalculations";
import { isPlayerInLineup } from "../../utils/lineupUtils";
import { deriveShotOutcomeWrites, type ShotOutcome } from "../../utils/shotOutcomeMapping";
import type { GameMutationInput, GoalCreateFields, SaveCreateFields } from "../../hooks/useOfflineMutations";
import type { Game, Team, PlayerWithRoster, PlayTimeRecord, LineupAssignment, FormationPosition } from "./types";

interface ShotOutcomeEntryProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  playTimeRecords: PlayTimeRecord[];
  lineup: LineupAssignment[];
  currentTime: number;
  mutations: GameMutationInput;
}

type FlowStep =
  | 'closed'
  | 'shooter'
  | 'outcome'
  | 'assist'
  | 'confirmKeeper'
  | 'keeperPicker'
  | 'confirm';

interface FlowState {
  step: FlowStep;
  forUs: boolean;
  shooterId: string;
  outcome: ShotOutcome | null;
  assistId: string;
  keeperId: string;
  confirmedKeeperName: string | null;
  // Which step the 'confirm' step's "Back" action returns to -- set at the
  // moment 'confirm' is entered, since different outcome/side combinations
  // reach it from different prior steps (assist for "Us"+Goal, outcome for
  // everything else that skips straight to confirm, keeperPicker for an
  // overridden "Them"+Saved keeper).
  confirmBackStep: FlowStep;
}

const CLOSED_FLOW: FlowState = {
  step: 'closed',
  forUs: true,
  shooterId: '',
  outcome: null,
  assistId: '',
  keeperId: '',
  confirmedKeeperName: null,
  confirmBackStep: 'outcome',
};

interface PendingRetry {
  kind: 'goal' | 'save';
  payload: GoalCreateFields | SaveCreateFields;
}

// The two "Log Shot – Us"/"Log Shot – Them" entry points plus the multi-step
// modal flow, replacing GoalTracker's and ShotSaveTracker's separate
// creation modals. One submission always writes a Shot, and conditionally a
// Goal (outcome GOAL) or a Save (outcome SAVED) -- see
// src/utils/shotOutcomeMapping.ts for the shared outcome -> records mapping,
// reused verbatim on the public helper page's StatTrackerView.tsx.
export function ShotOutcomeEntry({
  gameState,
  game,
  team,
  players,
  positions,
  playTimeRecords,
  lineup,
  currentTime,
  mutations,
}: ShotOutcomeEntryProps) {
  const [flow, setFlow] = useState<FlowState>(CLOSED_FLOW);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<PendingRetry | null>(null);

  const onFieldPlayerIds = players
    .filter(p =>
      isPlayerCurrentlyPlaying(p.id, playTimeRecords) ||
      isPlayerInLineup(p.id, lineup)
    )
    .map(p => p.id);

  function openUs() {
    if (isSubmitting) return;
    setFlow({ ...CLOSED_FLOW, step: 'shooter', forUs: true });
  }

  function openThem() {
    if (isSubmitting) return;
    setFlow({ ...CLOSED_FLOW, step: 'outcome', forUs: false });
  }

  function handleClose() {
    setFlow(CLOSED_FLOW);
    setPendingRetry(null);
    setIsSubmitting(false);
  }

  // Backdrop-tap-to-dismiss mirrors every other entry modal in this codebase
  // (GoalTracker.tsx, ShotSaveTracker.tsx) EXCEPT while a retry is pending
  // (UI review Major) -- a stray tap on a live sideline screen must not
  // silently discard the only path to complete the already-in-flight second
  // write. The explicit Cancel/Close button below stays available either
  // way (a deliberate tap, not an accidental one).
  function handleBackdropClick() {
    if (pendingRetry) return;
    handleClose();
  }

  function continueFromShooter() {
    setFlow({ ...flow, step: 'outcome' });
  }

  function pickOutcome(outcome: ShotOutcome) {
    if (outcome === 'BLOCKED' || outcome === 'WIDE') {
      // Q1: fast, low-stakes, immediate-submit-on-tap -- already correctable
      // in place via the M1 edit-modal path.
      void performSubmit({ ...flow, outcome });
      return;
    }

    if (outcome === 'GOAL') {
      if (flow.forUs) {
        setFlow({ ...flow, outcome, step: 'assist' });
      } else {
        // Opponent goals carry no scorer/assist attribution.
        setFlow({ ...flow, outcome, step: 'confirm', confirmBackStep: 'outcome' });
      }
      return;
    }

    // outcome === 'SAVED'
    if (flow.forUs) {
      // "Us" + Saved: no keeper attribution possible (no opponent roster) --
      // plain confirm.
      setFlow({ ...flow, outcome, step: 'confirm', confirmBackStep: 'outcome' });
      return;
    }

    // "Them" + Saved: auto-prefill the current on-field goalkeeper when
    // unambiguous, mirroring StatTrackerView.tsx's existing confirmKeeper
    // pattern.
    const autoKeeperId = getCurrentGoalkeeperId(playTimeRecords, positions);
    const autoKeeper = autoKeeperId ? players.find(p => p.id === autoKeeperId) : null;
    if (autoKeeper) {
      setFlow({
        ...flow,
        outcome,
        keeperId: autoKeeper.id,
        confirmedKeeperName: `${autoKeeper.firstName} ${autoKeeper.lastName}`,
        step: 'confirmKeeper',
      });
    } else {
      setFlow({ ...flow, outcome, step: 'keeperPicker' });
    }
  }

  function continueFromAssist() {
    setFlow({ ...flow, step: 'confirm', confirmBackStep: 'assist' });
  }

  function pickDifferentKeeper() {
    setFlow({ ...flow, keeperId: '', confirmedKeeperName: null, step: 'keeperPicker' });
  }

  function continueFromKeeperPicker() {
    setFlow({ ...flow, confirmedKeeperName: null, step: 'confirm', confirmBackStep: 'keeperPicker' });
  }

  function confirmBack() {
    setFlow({ ...flow, step: flow.confirmBackStep });
  }

  function handleWriteSuccess(outcome: ShotOutcome, forUs: boolean) {
    if (outcome === 'GOAL') {
      trackEvent(AnalyticsEvents.GOAL_RECORDED.category, AnalyticsEvents.GOAL_RECORDED.action, forUs ? 'own' : 'opponent');
      // In completed state, GameManagement will auto-reconcile score from
      // goals; gameState.ourScore/opponentScore is the authoritative,
      // persisted score in that state (only written at creation/completion,
      // per CLAUDE.md). In active states, score is derived from the goals
      // array (no manual write here).
      if (gameState.status === 'completed') {
        const newOurScore = forUs ? (gameState.ourScore || 0) + 1 : (gameState.ourScore || 0);
        const newOpponentScore = !forUs ? (gameState.opponentScore || 0) + 1 : (gameState.opponentScore || 0);
        showSuccess(`Goal added. Final score updated to ${newOurScore}–${newOpponentScore}.`);
      } else {
        showSuccess('Goal recorded.');
      }
    } else if (outcome === 'SAVED') {
      showSuccess('Save recorded.');
    } else {
      showSuccess('Shot recorded.');
    }
    handleClose();
  }

  async function performSubmit(f: FlowState) {
    if (!f.outcome) return;
    setIsSubmitting(true);

    const gameSeconds = currentTime;
    const half = gameState.currentHalf || 1;
    // Computed once (i4) and reused for both writes -- a second
    // `new Date().toISOString()` call for the second write would silently
    // break the shared gameId/timestamp/gameSeconds correlation.
    const timestamp = new Date().toISOString();
    const commonFields = {
      gameId: game.id,
      gameSeconds,
      half,
      timestamp,
      loggedVia: 'COACH' as const,
      coaches: team.coaches,
    };

    const derived = deriveShotOutcomeWrites({
      forUs: f.forUs,
      outcome: f.outcome,
      playerId: f.shooterId || null,
      assistPlayerId: f.assistId || null,
      keeperPlayerId: f.keeperId || null,
    });

    try {
      await mutations.createShot({ ...commonFields, ...derived.shot });
    } catch (err) {
      // m6/M1: a first-write (Shot) failure never triggers a second write --
      // nothing was recorded, so the modal stays open at its current step
      // for a clean retry of the WHOLE submission (there's nothing partial
      // to resume from yet).
      handleApiError(err, 'Failed to record shot');
      setIsSubmitting(false);
      return;
    }

    if (!derived.goal && !derived.save) {
      // BLOCKED/WIDE -- nothing more to write.
      handleWriteSuccess(f.outcome, f.forUs);
      return;
    }

    const secondWrite: PendingRetry = derived.goal
      ? { kind: 'goal', payload: { ...commonFields, ...derived.goal } }
      : { kind: 'save', payload: { ...commonFields, ...derived.save! } };

    try {
      if (secondWrite.kind === 'goal') {
        await mutations.createGoal(secondWrite.payload as GoalCreateFields);
      } else {
        await mutations.createSave(secondWrite.payload as SaveCreateFields);
      }
      handleWriteSuccess(f.outcome, f.forUs);
    } catch (err) {
      // m5: the Shot already succeeded and must not be re-sent -- keep the
      // modal open with a "Retry saving goal/save" action that re-sends only
      // this already-derived payload, never "re-log the whole event".
      handleApiError(err, `Failed to record ${secondWrite.kind}`);
      setPendingRetry(secondWrite);
      setIsSubmitting(false);
    }
  }

  async function handleRetry() {
    if (!pendingRetry || !flow.outcome) return;
    setIsSubmitting(true);
    try {
      if (pendingRetry.kind === 'goal') {
        await mutations.createGoal(pendingRetry.payload as GoalCreateFields);
      } else {
        await mutations.createSave(pendingRetry.payload as SaveCreateFields);
      }
      handleWriteSuccess(flow.outcome, flow.forUs);
    } catch (err) {
      handleApiError(err, `Failed to record ${pendingRetry.kind}`);
      setIsSubmitting(false);
    }
  }

  const opponentName = gameState.opponent ?? 'Opponent';
  const outcomeVerb = flow.outcome === 'GOAL' ? 'Goal' : 'Save';

  function confirmSummary(): string {
    const side = flow.forUs ? 'Us' : opponentName;
    const parts = [`${outcomeVerb} — ${side}`];
    if (flow.forUs && flow.outcome === 'GOAL') {
      const shooter = flow.shooterId ? players.find(p => p.id === flow.shooterId) : null;
      if (shooter) parts.push(`#${shooter.playerNumber}`);
      const assist = flow.assistId ? players.find(p => p.id === flow.assistId) : null;
      if (assist) parts.push(`assist #${assist.playerNumber}`);
    }
    if (!flow.forUs && flow.outcome === 'SAVED') {
      const keeper = flow.keeperId ? players.find(p => p.id === flow.keeperId) : null;
      if (keeper) parts.push(`keeper #${keeper.playerNumber}`);
    }
    return parts.join(', ');
  }

  return (
    <>
      {/* Entry Buttons -- carried over from the components this replaces
          (m6): hidden while the game hasn't started yet. */}
      {gameState.status !== 'scheduled' && (
        <div className="stat-buttons">
          <button onClick={openUs} className="btn-stat btn-stat-us">
            <span aria-hidden="true">🎯</span> Log Shot – Us
          </button>
          <button onClick={openThem} className="btn-stat btn-stat-opponent">
            <span aria-hidden="true">🎯</span> Log Shot – {opponentName}
          </button>
        </div>
      )}

      {flow.step !== 'closed' && (
        <div
          className="modal-overlay"
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shot-outcome-modal-title"
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="shot-outcome-modal-title">
              {flow.forUs ? 'Log Shot – Us' : `Log Shot – ${opponentName}`}
            </h2>

            {pendingRetry ? (
              <div className="shot-outcome-retry">
                <p className="error-message" role="alert">
                  The shot itself was saved — if this doesn't complete, delete it from the Shots list and log the whole thing again.
                </p>
                <div className="form-actions">
                  <button type="button" className="btn-primary" onClick={() => void handleRetry()} disabled={isSubmitting}>
                    {isSubmitting ? 'Retrying…' : `Retry saving ${pendingRetry.kind}`}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {flow.step === 'shooter' && (
                  <div className="form-group">
                    <label htmlFor="shotShooter">Who Took the Shot? (optional)</label>
                    <PlayerSelect
                      id="shotShooter"
                      players={players}
                      value={flow.shooterId}
                      onChange={(v) => setFlow({ ...flow, shooterId: v })}
                      placeholder="Skip / unknown player"
                      className="w-full"
                      onFieldPlayerIds={onFieldPlayerIds}
                    />
                    <div className="form-actions">
                      <button type="button" className="btn-primary" onClick={continueFromShooter}>
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {flow.step === 'outcome' && (
                  <div className="shot-outcome-picker">
                    <button type="button" className="shot-outcome-btn shot-outcome-btn--goal" onClick={() => pickOutcome('GOAL')}>
                      Goal
                    </button>
                    <button type="button" className="shot-outcome-btn shot-outcome-btn--saved" onClick={() => pickOutcome('SAVED')}>
                      Saved
                    </button>
                    <button type="button" className="shot-outcome-btn shot-outcome-btn--blocked" onClick={() => pickOutcome('BLOCKED')}>
                      Blocked
                    </button>
                    <button type="button" className="shot-outcome-btn shot-outcome-btn--wide" onClick={() => pickOutcome('WIDE')}>
                      Wide
                    </button>
                  </div>
                )}

                {flow.step === 'assist' && (
                  <div className="form-group">
                    <label htmlFor="shotAssist">Assisted By (optional)</label>
                    <PlayerSelect
                      id="shotAssist"
                      players={players}
                      value={flow.assistId}
                      onChange={(v) => setFlow({ ...flow, assistId: v })}
                      excludeId={flow.shooterId}
                      placeholder="No assist / Select player..."
                      className="w-full"
                      onFieldPlayerIds={onFieldPlayerIds}
                    />
                    <div className="form-actions">
                      <button type="button" className="btn-primary" onClick={continueFromAssist}>
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {flow.step === 'confirmKeeper' && (
                  <div className="form-group">
                    <p>{flow.confirmedKeeperName} made the save?</p>
                    <div className="form-actions">
                      <button type="button" className="btn-primary" onClick={() => void performSubmit(flow)} disabled={isSubmitting}>
                        {isSubmitting ? 'Logging…' : 'Log Save'}
                      </button>
                    </div>
                    <button type="button" className="btn-secondary" onClick={pickDifferentKeeper} disabled={isSubmitting}>
                      Not right? Pick another keeper
                    </button>
                  </div>
                )}

                {flow.step === 'keeperPicker' && (
                  <div className="form-group">
                    <label htmlFor="shotKeeper">Which keeper?</label>
                    <PlayerSelect
                      id="shotKeeper"
                      players={players}
                      value={flow.keeperId}
                      onChange={(v) => setFlow({ ...flow, keeperId: v })}
                      placeholder="Skip / unknown player"
                      className="w-full"
                      onFieldPlayerIds={onFieldPlayerIds}
                    />
                    <div className="form-actions">
                      <button type="button" className="btn-primary" onClick={continueFromKeeperPicker}>
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {flow.step === 'confirm' && (
                  <div className="form-group">
                    <p className="modal-subtitle">{confirmSummary()}</p>
                    <div className="form-actions">
                      {/* Q1: the final confirm/submit control reads
                          "Log Goal"/"Log Save" specifically -- this step is
                          only ever reached for GOAL/SAVED outcomes. */}
                      <button type="button" className="btn-primary" onClick={() => void performSubmit(flow)} disabled={isSubmitting}>
                        {isSubmitting ? 'Logging…' : `Log ${outcomeVerb}`}
                      </button>
                      <button type="button" className="btn-secondary" onClick={confirmBack} disabled={isSubmitting}>
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <button type="button" className="btn-secondary" onClick={handleClose} disabled={isSubmitting}>
              {pendingRetry ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
