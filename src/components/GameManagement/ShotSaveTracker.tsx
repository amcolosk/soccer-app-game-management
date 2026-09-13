import { useCallback, useState } from "react";
import { showWarning, showSuccess } from "../../utils/toast";
import { handleApiError } from "../../utils/errorHandler";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import { PlayerSelect } from "../PlayerSelect";
import { isPlayerCurrentlyPlaying } from "../../utils/playTimeCalculations";
import { isPlayerInLineup } from "../../utils/lineupUtils";
import type { GameMutationInput, ShotUpdateFields, SaveUpdateFields } from "../../hooks/useOfflineMutations";
import type { Game, Team, PlayerWithRoster, Shot, Save, PlayTimeRecord, LineupAssignment } from "./types";
import type { StatSubView } from "./StatsSubViewTabs";
import { GameActionRow } from "./actions/GameActionRow";
import type { GameActionDescriptor } from "./actions/actionContract";

type StatItem = Shot | Save;

interface ShotSaveTrackerProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  shots: Shot[];
  saves: Save[];
  /** Which of Shots/Saves this instance is currently displaying — selected
   *  by the shared StatsSubViewTabs segmented control (never "goals": the
   *  caller mounts GoalTracker for that sub-view instead). */
  statView: Exclude<StatSubView, "goals">;
  currentTime: number;
  mutations: GameMutationInput;
  playTimeRecords: PlayTimeRecord[];
  lineup: LineupAssignment[];
}

function isUsAttributed(statView: Exclude<StatSubView, "goals">, item: StatItem): boolean {
  return statView === "shots" ? (item as Shot).takenByUs : (item as Save).byUs;
}

const LABELS = {
  shots: { singular: "Shot", verb: "recorded", noun: "shot" },
  saves: { singular: "Save", verb: "recorded", noun: "save" },
} as const;

export function ShotSaveTracker({
  gameState,
  game,
  team,
  players,
  shots,
  saves,
  statView,
  currentTime,
  mutations,
  playTimeRecords,
  lineup,
}: ShotSaveTrackerProps) {
  const items: StatItem[] = statView === "shots" ? shots : saves;
  const label = LABELS[statView];

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [entryIsUs, setEntryIsUs] = useState(true);
  const [entryPlayerId, setEntryPlayerId] = useState("");
  const [entryOnTarget, setEntryOnTarget] = useState(true);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editItem, setEditItem] = useState<StatItem | null>(null);
  const [editPlayerId, setEditPlayerId] = useState("");
  const [editOnTarget, setEditOnTarget] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [error, setError] = useState("");

  const onFieldPlayerIds = players
    .filter(p =>
      isPlayerCurrentlyPlaying(p.id, playTimeRecords) ||
      isPlayerInLineup(p.id, lineup)
    )
    .map(p => p.id);

  const getCurrentGameTime = () => currentTime;

  const handleOpenEntryModal = (isUs: boolean) => {
    setEntryIsUs(isUs);
    setEntryPlayerId("");
    setEntryOnTarget(true);
    setShowEntryModal(true);
  };

  const handleRecordStat = async () => {
    if (statView === "shots" && entryIsUs && !entryPlayerId) {
      showWarning("Please select who took the shot");
      return;
    }

    try {
      const gameSeconds = getCurrentGameTime();
      const half = gameState.currentHalf || 1;
      const timestamp = new Date().toISOString();

      if (statView === "shots") {
        await mutations.createShot({
          gameId: game.id,
          takenByUs: entryIsUs,
          onTarget: entryOnTarget,
          gameSeconds,
          half,
          playerId: entryIsUs && entryPlayerId ? entryPlayerId : undefined,
          timestamp,
          loggedVia: "COACH",
          coaches: team.coaches,
        });
      } else {
        await mutations.createSave({
          gameId: game.id,
          byUs: entryIsUs,
          gameSeconds,
          half,
          playerId: entryIsUs && entryPlayerId ? entryPlayerId : undefined,
          timestamp,
          loggedVia: "COACH",
          coaches: team.coaches,
        });
      }

      setShowEntryModal(false);
      showSuccess(`${label.singular} ${label.verb}.`);
    } catch (err) {
      handleApiError(err, `Failed to record ${label.noun}`);
    }
  };

  const handleOpenEditModal = useCallback((item: StatItem) => {
    setEditItem(item);
    setEditPlayerId(item.playerId ?? "");
    setEditOnTarget(statView === "shots" ? (item as Shot).onTarget ?? true : true);
    setError("");
    setShowEditModal(true);
  }, [statView]);

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
        await mutations.updateShot(editItem.id, {
          playerId: editPlayerId || undefined,
          onTarget: editOnTarget,
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
  }, [editItem, editPlayerId, editOnTarget, statView, mutations, label, handleCloseEditModal]);

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
      {/* Entry Buttons */}
      {gameState.status !== "scheduled" && (
        <div className="stat-buttons">
          <button onClick={() => handleOpenEntryModal(true)} className="btn-stat btn-stat-us">
            {statView === "shots" ? "🎯" : "🧤"} {label.singular} - Us
          </button>
          <button onClick={() => handleOpenEntryModal(false)} className="btn-stat btn-stat-opponent">
            {statView === "shots" ? "🎯" : "🧤"} {label.singular} - {gameState.opponent}
          </button>
        </div>
      )}

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
                // Edit is suppressed on opponent-attributed rows: neither Shot
                // nor Save has a `notes` field, so an opponent row (no player,
                // no assist, no notes) has nothing meaningful to edit.
                ...(isUs ? [{
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
                    body: `This permanently removes this ${label.noun} event from the game timeline.`,
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
                        <span className="stat-on-target">{(item as Shot).onTarget ? "On target" : "Off target"}</span>
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

      {/* Entry Modal */}
      {showEntryModal && (
        <div className="modal-overlay" onClick={() => setShowEntryModal(false)} role="dialog" aria-modal="true" aria-labelledby={`record-${statView}-modal-title`}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id={`record-${statView}-modal-title`}>Record {label.singular}</h2>
            <p className="modal-subtitle">
              {entryIsUs ? `Our ${label.singular}` : `${gameState.opponent} ${label.singular}`} - {formatGameTimeDisplay(getCurrentGameTime(), gameState.currentHalf || 1)}
            </p>

            {entryIsUs && (
              <div className="form-group">
                <label htmlFor={`${statView}Player`}>
                  {statView === "shots" ? "Who Took the Shot? *" : "Goalkeeper (optional)"}
                </label>
                <PlayerSelect
                  id={`${statView}Player`}
                  players={players}
                  value={entryPlayerId}
                  onChange={setEntryPlayerId}
                  placeholder="Select player..."
                  className="w-full"
                  onFieldPlayerIds={onFieldPlayerIds}
                />
              </div>
            )}

            {statView === "shots" && (
              <div className="form-group">
                <label htmlFor="shotOnTarget">On Target?</label>
                <select
                  id="shotOnTarget"
                  value={entryOnTarget ? "yes" : "no"}
                  onChange={(e) => setEntryOnTarget(e.target.value === "yes")}
                >
                  <option value="yes">On target</option>
                  <option value="no">Off target</option>
                </select>
              </div>
            )}

            <div className="form-actions">
              <button onClick={handleRecordStat} className="btn-primary">
                Record {label.singular}
              </button>
              <button onClick={() => setShowEntryModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal (Us-attributed rows only) */}
      {showEditModal && editItem && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={`edit-${statView}-modal-title`}>
          <div className="modal-content">
            <h2 id={`edit-${statView}-modal-title`}>Edit Our {label.singular}</h2>
            <p className="modal-subtitle">
              Our {label.singular}
              {' — '}
              Half {editItem.half}, {Math.floor((editItem.gameSeconds ?? 0) / 60)}'
            </p>

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

            {statView === "shots" && (
              <div className="form-group">
                <label htmlFor="editShotOnTarget">On Target?</label>
                <select
                  id="editShotOnTarget"
                  value={editOnTarget ? "yes" : "no"}
                  onChange={(e) => setEditOnTarget(e.target.value === "yes")}
                >
                  <option value="yes">On target</option>
                  <option value="no">Off target</option>
                </select>
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
