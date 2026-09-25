import { useCallback, useState } from "react";
import { showSuccess } from "../../utils/toast";
import { handleApiError } from "../../utils/errorHandler";
import { PlayerSelect } from "../PlayerSelect";
import { getCurrentGoalkeeperId } from "../../utils/playTimeCalculations";
import type { GameMutationInput, ShotUpdateFields, SaveUpdateFields } from "../../hooks/useOfflineMutations";
import type { Game, PlayerWithRoster, Shot, Save, PlayTimeRecord, FormationPosition } from "./types";
import type { StatSubView } from "./StatsSubViewTabs";
import { GameActionRow } from "./actions/GameActionRow";
import type { GameActionDescriptor } from "./actions/actionContract";

type StatItem = Shot | Save;

interface ShotSaveTrackerProps {
  gameState: Game;
  players: PlayerWithRoster[];
  shots: Shot[];
  saves: Save[];
  /** Which of Shots/Saves this instance is currently displaying — selected
   *  by the shared StatsSubViewTabs segmented control (never "goals": the
   *  caller mounts GoalTracker for that sub-view instead). */
  statView: Exclude<StatSubView, "goals">;
  mutations: GameMutationInput;
  playTimeRecords: PlayTimeRecord[];
  positions: FormationPosition[];
}

function isUsAttributed(statView: Exclude<StatSubView, "goals">, item: StatItem): boolean {
  return statView === "shots" ? (item as Shot).takenByUs : (item as Save).byUs;
}

const LABELS = {
  shots: { singular: "Shot", verb: "recorded", noun: "shot" },
  saves: { singular: "Save", verb: "recorded", noun: "save" },
} as const;

// Color-coded per the Shots-list outcome badge (Q2/UI review) -- an
// application of UI-SPEC §5.7's existing Status-Badge visual language, not a
// new ad hoc badge system. green=GOAL, blue=SAVED, gray=BLOCKED/WIDE.
function outcomeBadgeClass(outcome: Shot['outcome'] | null | undefined): string {
  switch (outcome) {
    case 'GOAL':
      return 'shot-outcome-badge shot-outcome-badge--goal';
    case 'SAVED':
      return 'shot-outcome-badge shot-outcome-badge--saved';
    case 'BLOCKED':
    case 'WIDE':
      return 'shot-outcome-badge shot-outcome-badge--neutral';
    default:
      // Unreachable in practice (every new write always populates outcome),
      // but a.enum() can't be .required() at the schema level, so a
      // hand-edited/legacy-shaped row must still render without crashing.
      return 'shot-outcome-badge shot-outcome-badge--neutral';
  }
}

function outcomeBadgeLabel(outcome: Shot['outcome'] | null | undefined): string {
  switch (outcome) {
    case 'GOAL': return 'Goal';
    case 'SAVED': return 'Saved';
    case 'BLOCKED': return 'Blocked';
    case 'WIDE': return 'Wide';
    default: return 'Unknown outcome';
  }
}

// Shot's edit-visibility gate (UI review Major, M1 addendum): `isUs` OR a
// BLOCKED/WIDE outcome -- an opponent-attributed Shot with one of those two
// outcomes has a genuinely editable field (the outcome itself), unlike
// GOAL/SAVED/null which stay read-only-or-nothing. Save's gate is unchanged,
// `isUs`-only -- an opponent Save row still has nothing editable.
function isEditVisible(statView: Exclude<StatSubView, "goals">, item: StatItem, isUs: boolean): boolean {
  if (statView === "saves") return isUs;
  const outcome = (item as Shot).outcome;
  return isUs || outcome === 'BLOCKED' || outcome === 'WIDE';
}

// M1: the edit modal's outcome control is editable ONLY when the shot's
// current, seeded outcome is BLOCKED or WIDE -- GOAL/SAVED/null render a
// read-only label instead ("delete and re-log to change the outcome"),
// since editing those in place would silently corrupt the exact outcome
// this guardrail exists to protect (see the plan's "Accepted risk: sibling
// drift" section).
function isOutcomeEditable(outcome: Shot['outcome'] | null | undefined): boolean {
  return outcome === 'BLOCKED' || outcome === 'WIDE';
}

export function ShotSaveTracker({
  gameState,
  players,
  shots,
  saves,
  statView,
  mutations,
  playTimeRecords,
  positions,
}: ShotSaveTrackerProps) {
  const items: StatItem[] = statView === "shots" ? shots : saves;
  const label = LABELS[statView];

  const [showEditModal, setShowEditModal] = useState(false);
  const [editItem, setEditItem] = useState<StatItem | null>(null);
  const [editPlayerId, setEditPlayerId] = useState("");
  // Seeded from the item's current outcome at open time -- only ever sent
  // back on save when the editable control was actually shown (BLOCKED/WIDE)
  // AND its value changed, per M1's corrected guardrail.
  const [editOutcome, setEditOutcome] = useState<Shot['outcome'] | null>(null);
  const [initialEditOutcome, setInitialEditOutcome] = useState<Shot['outcome'] | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [error, setError] = useState("");

  const handleOpenEditModal = useCallback((item: StatItem) => {
    setEditItem(item);
    // Only prefill a derived goalkeeper when the item has NO existing
    // playerId -- never clobber an already-recorded attribution. Uses the
    // *current* goalkeeper (not a point-in-time lookup at the item's
    // gameSeconds) -- see the plan's Edge Cases section: this is the
    // mandated, only behavior for the edit modal, not an oversight.
    const derivedGoalkeeperId =
      statView === "saves" && !item.playerId ? getCurrentGoalkeeperId(playTimeRecords, positions) : null;
    setEditPlayerId(item.playerId ?? derivedGoalkeeperId ?? "");
    const currentOutcome = statView === "shots" ? (item as Shot).outcome ?? null : null;
    setEditOutcome(currentOutcome);
    setInitialEditOutcome(currentOutcome);
    setError("");
    setShowEditModal(true);
  }, [statView, playTimeRecords, positions]);

  const handleCloseEditModal = useCallback(() => {
    setShowEditModal(false);
    setEditItem(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editItem) return;
    if (statView === "shots" && (editItem as Shot).takenByUs && !editPlayerId) {
      setError("A shooter is required for our shots.");
      return;
    }
    setIsSavingEdit(true);
    try {
      if (statView === "shots") {
        const outcomeChanged = isOutcomeEditable(initialEditOutcome) && editOutcome !== initialEditOutcome;
        await mutations.updateShot(editItem.id, {
          playerId: editPlayerId || undefined,
          // M1: `outcome` is omitted from the payload entirely unless the
          // editable control was shown (current outcome BLOCKED/WIDE) AND
          // its value actually changed -- never send a field the coach
          // never had the ability to meaningfully edit.
          ...(outcomeChanged && editOutcome ? { outcome: editOutcome } : {}),
        } as ShotUpdateFields);
      } else {
        await mutations.updateSave(editItem.id, {
          playerId: editPlayerId || undefined,
        } as SaveUpdateFields);
      }

      showSuccess(`${label.singular} updated.`);
      handleCloseEditModal();
    } catch (err) {
      handleApiError(err, `Failed to save ${label.noun}`);
    } finally {
      setIsSavingEdit(false);
    }
  }, [editItem, editPlayerId, editOutcome, initialEditOutcome, statView, mutations, label, handleCloseEditModal]);

  const handleDeleteItem = useCallback(async (item: StatItem) => {
    try {
      if (statView === "shots") {
        await mutations.deleteShot(item.id);
      } else {
        await mutations.deleteSave(item.id);
      }
    } catch (err) {
      handleApiError(err, `Failed to delete ${label.noun}`);
      throw err;
    }
  }, [statView, mutations, label]);

  const headingId = `${statView}-heading`;

  return (
    <>
      {/* Empty State for Completed */}
      {gameState.status === "completed" && items.length === 0 && (
        <div className="stats-empty-state">
          <p>No {statView} recorded yet.</p>
        </div>
      )}

      {/* Stats List */}
      {items.length > 0 && (
        <div className="stats-section">
          <h3 id={headingId} tabIndex={-1}>{statView === "shots" ? "Shots" : "Saves"}</h3>
          <div className="stats-list">
            {items.map((item) => {
              const isUs = isUsAttributed(statView, item);
              const player = item.playerId ? players.find(p => p.id === item.playerId) : null;
              const minute = Math.floor((item.gameSeconds ?? 0) / 60);
              const teamLabel = isUs ? "Us" : (gameState.opponent ?? "Opponent");
              const actionDescriptors: GameActionDescriptor[] = [
                ...(isEditVisible(statView, item, isUs) ? [{
                  id: 'edit' as const,
                  label: 'Edit',
                  kind: 'primary' as const,
                  ariaLabel: `Edit ${teamLabel} ${label.noun} at ${minute}'`,
                  onAction: async () => {
                    handleOpenEditModal(item);
                  },
                }] : []),
                {
                  id: 'delete',
                  label: 'Delete',
                  kind: 'destructive',
                  ariaLabel: `Delete ${teamLabel} ${label.noun} at ${minute}'`,
                  confirmDialog: {
                    title: `Delete ${label.noun}?`,
                    // i4: Shot/Save stay unlinked siblings by design -- say
                    // so explicitly rather than leaving an apparently
                    // orphaned Shot/Goal row as a surprise afterward.
                    body: statView === "shots"
                      ? `This permanently removes this shot event from the game timeline. Any matching goal or save stays in its own list.`
                      : `This permanently removes this save event from the game timeline. The matching shot stays in the Shots list.`,
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                  },
                  onAction: async () => {
                    await handleDeleteItem(item);
                  },
                },
              ];
              return (
                <div key={item.id} className={`stat-card ${isUs ? "stat-us" : "stat-opponent"}`}>
                  <div className="stat-icon">{statView === "shots" ? "🎯" : "🧤"}</div>
                  <div className="stat-info">
                    <div className="stat-header">
                      <span className="stat-minute">{minute}'</span>
                      <span className="stat-half">({item.half === 1 ? "1st" : "2nd"} Half)</span>
                      {statView === "shots" && (
                        <span className={outcomeBadgeClass((item as Shot).outcome)}>
                          {outcomeBadgeLabel((item as Shot).outcome)}
                        </span>
                      )}
                    </div>
                    {isUs ? (
                      player && (
                        <div className="stat-player">
                          #{player.playerNumber} {player.firstName} {player.lastName}
                        </div>
                      )
                    ) : (
                      <div className="stat-opponent-label">{gameState.opponent}</div>
                    )}
                    {item.loggedVia === 'HELPER' && (
                      <div className="stat-logged-via-helper">Logged via helper</div>
                    )}
                  </div>
                  <div className="stat-card-actions">
                    <GameActionRow actions={actionDescriptors} headingIdForDeleteSuccessFocus={headingId} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editItem && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={`edit-${statView}-modal-title`}>
          <div className="modal-content">
            <h2 id={`edit-${statView}-modal-title`}>
              {isUsAttributed(statView, editItem) ? `Edit Our ${label.singular}` : `Edit ${gameState.opponent ?? 'Opponent'} ${label.singular}`}
            </h2>
            <p className="modal-subtitle">
              {isUsAttributed(statView, editItem) ? `Our ${label.singular}` : `${gameState.opponent ?? 'Opponent'} ${label.singular}`}
              {' — '}
              Half {editItem.half}, {Math.floor((editItem.gameSeconds ?? 0) / 60)}'
            </p>

            {isUsAttributed(statView, editItem) && (
              <div className="form-group">
                <label>{statView === "shots" ? "Shooter" : "Goalkeeper"}</label>
                <PlayerSelect
                  id={`edit${statView}Player`}
                  players={players}
                  value={editPlayerId}
                  onChange={setEditPlayerId}
                  placeholder="Select player"
                />
              </div>
            )}

            {statView === "shots" && (
              <div className="form-group">
                <label htmlFor="editShotOutcome">Outcome</label>
                {isOutcomeEditable(initialEditOutcome) ? (
                  <select
                    id="editShotOutcome"
                    value={editOutcome ?? ''}
                    onChange={(e) => setEditOutcome(e.target.value as Shot['outcome'])}
                  >
                    <option value="BLOCKED">Blocked</option>
                    <option value="WIDE">Wide</option>
                  </select>
                ) : (
                  // M1: read-only -- correcting a genuinely wrong Goal/Saved
                  // outcome is delete-and-re-log through the unified entry
                  // flow, never an in-place outcome edit. Reuses the
                  // codebase's existing readonly-field visual convention.
                  <p id="editShotOutcome" className="shot-outcome-readonly">
                    {outcomeBadgeLabel(initialEditOutcome)} — delete and re-log to change the outcome
                  </p>
                )}
              </div>
            )}

            {error && <p className="error-message">{error}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCloseEditModal}
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
