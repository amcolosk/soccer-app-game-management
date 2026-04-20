import { useCallback, useEffect, useRef, useState } from "react";
import { handleApiError } from "../../utils/errorHandler";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import { showWarning } from "../../utils/toast";
import { resolveAttributionLabel, type TeamCoachProfileDTO } from "../../services/coachDisplayNameService";
import { PlayerSelect } from "../PlayerSelect";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";
import { useSwipeActions } from "../../hooks/useSwipeDelete";
import { getGameNoteActionDecision } from "../../../shared/policies/gameNoteActionPolicy";
import type { Game, Team, PlayerWithRoster, GameNote } from "./types";
import { useSpeechToText, type StopReason } from "./hooks/useSpeechToText";
import type { GameActionDescriptor } from "./actions/actionContract";
import { GameActionRow } from "./actions/GameActionRow";

const MAX_NOTE_LENGTH = 500;

export type LiveNoteType = "gold-star" | "yellow-card" | "red-card" | "other";
export type LiveNoteSource = "notes-tab" | "command-band" | "halftime-action";

export interface OpenLiveNoteIntent {
  source: LiveNoteSource;
  defaultType: LiveNoteType;
}

interface PlayerNotesPanelProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  gameNotes: GameNote[];
  currentTime: number;
  mutations: GameMutationInput;
  showPanelContent?: boolean;
  isNoteModalOpen?: boolean;
  noteModalRequestId?: number;
  noteModalIntent?: OpenLiveNoteIntent | null;
  onRequestOpenNote?: (intent: OpenLiveNoteIntent, trigger: HTMLElement | null) => void;
  onRequestCloseNote?: () => void;
  onNoteSaved?: () => void;
  currentUserId?: string;
  profileMap?: Map<string, TeamCoachProfileDTO>;
}

export function PlayerNotesPanel({
  gameState,
  game,
  team,
  players,
  gameNotes,
  currentTime,
  mutations,
  showPanelContent = true,
  isNoteModalOpen,
  noteModalRequestId,
  noteModalIntent,
  onRequestOpenNote,
  onRequestCloseNote,
  onNoteSaved,
  currentUserId,
  profileMap = new Map(),
}: PlayerNotesPanelProps) {
  const isExternallyControlled =
    typeof isNoteModalOpen === "boolean" &&
    typeof onRequestOpenNote === "function" &&
    typeof onRequestCloseNote === "function";

  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const [noteType, setNoteType] = useState<LiveNoteType>("other");
  const [notePlayerId, setNotePlayerId] = useState("");
  const [noteText, setNoteText] = useState("");
  const [truncatedByDictation, setTruncatedByDictation] = useState(false);
  const [showEndCue, setShowEndCue] = useState(false);
  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");
  const [actionPoliteMessage, setActionPoliteMessage] = useState("");
  const [actionAssertiveMessage, setActionAssertiveMessage] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [lastStopReason, setLastStopReason] = useState<StopReason | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const { getSwipeProps, getSwipeStyle, close: closeSwipe } = useSwipeActions({ openWidthPx: 156, maxDistancePx: 180 });

  const returnFocusRef = useRef<HTMLElement | null>(null);
  const modalTextRef = useRef<HTMLTextAreaElement | null>(null);
  const modalTitleRef = useRef<HTMLHeadingElement | null>(null);
  const notesSectionRef = useRef<HTMLDivElement | null>(null);
  const prevOpenRef = useRef(false);

  const showNoteModal = isExternallyControlled ? Boolean(isNoteModalOpen) : internalModalOpen;

  const activeIntent = noteModalIntent ?? { source: "notes-tab" as const, defaultType: noteType };

  const clampToLimit = useCallback((text: string): string => {
    if (text.length <= MAX_NOTE_LENGTH) return text;
    return text.slice(0, MAX_NOTE_LENGTH);
  }, []);

  const mergeDictationText = useCallback((incoming: string, confidence: number | null) => {
    void confidence;
    if (!incoming) return;

    setNoteText((previousText) => {
      const merged = previousText.trim().length > 0
        ? `${previousText.trim()} ${incoming}`
        : incoming;
      const clamped = clampToLimit(merged);
      if (clamped.length < merged.length) {
        setTruncatedByDictation(true);
      }
      return clamped;
    });
  }, [clampToLimit]);

  const handleSessionEnd = useCallback((reason: StopReason, errorCode: string | null) => {
    setLastStopReason(reason);
    setLastErrorCode(errorCode);
    setShowEndCue(true);
    setIsFinalizing(true);
    window.setTimeout(() => setIsFinalizing(false), 300);
    window.setTimeout(() => setShowEndCue(false), 1800);

    if (navigator.vibrate) {
      navigator.vibrate(120);
    }
  }, []);

  const {
    isSupported,
    status,
    isListening,
    interimTranscript,
    errorCode,
    lowConfidenceDetected,
    start,
    stop,
  } = useSpeechToText({
    isModalOpen: showNoteModal,
    onFinalTranscript: mergeDictationText,
    onSessionEnd: handleSessionEnd,
  });
  const inGameNotes = gameNotes.filter(
    (note) => note.noteType !== 'coaching-point'
  );

  const getCurrentGameTime = () => currentTime;

  const formatEditedTime = (isoTimestamp: string | null | undefined): string => {
    if (!isoTimestamp) return '';
    const parsed = new Date(isoTimestamp);
    if (Number.isNaN(parsed.getTime())) return '';

    const now = new Date();
    const sameDay =
      parsed.getFullYear() === now.getFullYear() &&
      parsed.getMonth() === now.getMonth() &&
      parsed.getDate() === now.getDate();

    if (sameDay) {
      return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const getEditedAttribution = (editedById: string | null | undefined): string => {
    if (!editedById) return 'Coach';
    if (currentUserId && editedById === currentUserId) return 'You';
    const resolved = resolveAttributionLabel(editedById, currentUserId, profileMap);
    if (!resolved || resolved === 'Unknown Author' || resolved === 'Former Coach') return 'Coach';
    return resolved;
  };

  const getEditedIndicatorText = (note: GameNote): string | null => {
    if (!note.editedById) return null;

    const attribution = getEditedAttribution(note.editedById);
    const editedTime = formatEditedTime(note.editedAt);
    if (!editedTime) {
      return `Edited by ${attribution}`;
    }
    return `Edited by ${attribution} at ${editedTime}`;
  };

  const startEditingNote = (note: GameNote) => {
    closeSwipe();
    setEditingNoteId(note.id);
    setEditingNoteText(note.notes ?? '');
  };

  const cancelEditingNote = () => {
    setEditingNoteId(null);
    setEditingNoteText('');
    setIsSavingEdit(false);
  };

  const saveEditedNote = async () => {
    if (!editingNoteId) return;
    setIsSavingEdit(true);
    try {
      await mutations.updateGameNote(editingNoteId, { notes: clampToLimit(editingNoteText.trim()) });
      const attribution = getEditedAttribution(currentUserId ?? null);
      const time = formatEditedTime(new Date().toISOString());
      setActionPoliteMessage(`Note updated. Note edited by ${attribution} at ${time}`);
      setActionAssertiveMessage('');
      cancelEditingNote();
      onNoteSaved?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update note';
      setActionAssertiveMessage(message);
      setActionPoliteMessage('');
      handleApiError(error, 'Failed to update note');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteNote = async (note: GameNote) => {
    closeSwipe();
    await mutations.deleteGameNote(note.id);
    setActionPoliteMessage('Note deleted');
    setActionAssertiveMessage('');
    onNoteSaved?.();
  };

  const isTransientVoiceState = status === "starting" || status === "stopping" || isFinalizing;

  const openNoteModal = (intent: OpenLiveNoteIntent, trigger: HTMLElement | null) => {
    returnFocusRef.current = trigger;
    if (isExternallyControlled && onRequestOpenNote) {
      onRequestOpenNote(intent, trigger);
      return;
    }

    setNoteType(intent.defaultType);
    setNotePlayerId("");
    setNoteText("");
    setTruncatedByDictation(false);
    setShowEndCue(false);
    setInternalModalOpen(true);
  };

  const closeNoteModal = () => {
    if (isExternallyControlled && onRequestCloseNote) {
      onRequestCloseNote();
    } else {
      setInternalModalOpen(false);
    }
  };

  const handleOpenNoteModal = (
    type: LiveNoteType,
    trigger: HTMLElement | null,
    source: LiveNoteSource = "notes-tab"
  ) => {
    openNoteModal({ source, defaultType: type }, trigger);
  };

  const handleSaveNote = async () => {
    try {
      // For completed games, use the total game time; otherwise use current half time
      const timeInSeconds = gameState.status === 'completed' ? currentTime : getCurrentGameTime();

      await mutations.createGameNote({
        gameId: game.id,
        noteType,
        playerId: notePlayerId || undefined,
        gameSeconds: timeInSeconds,
        half: gameState.currentHalf || 2,
        notes: clampToLimit(noteText.trim()) || undefined,
        timestamp: new Date().toISOString(),
        coaches: team.coaches,
      });

      closeNoteModal();
      onNoteSaved?.();
    } catch (error) {
      handleApiError(error, 'Failed to save note');
    }
  };

  useEffect(() => {
    const openedNow = showNoteModal && !prevOpenRef.current;
    if (!openedNow) {
      if (!showNoteModal && prevOpenRef.current) {
        returnFocusRef.current?.focus({ preventScroll: true });
      }
      prevOpenRef.current = showNoteModal;
      return;
    }

    setNoteType(activeIntent.defaultType);
    setNotePlayerId("");
    setNoteText("");
    setTruncatedByDictation(false);
    setShowEndCue(false);
    setPoliteMessage("");
    setAssertiveMessage("");
    setLastStopReason(null);
    setLastErrorCode(null);

    window.setTimeout(() => {
      modalTitleRef.current?.focus();
    }, 0);

    prevOpenRef.current = showNoteModal;
  }, [activeIntent.defaultType, showNoteModal]);

  useEffect(() => {
    if (!noteModalRequestId || !showNoteModal) return;
    setNoteType(activeIntent.defaultType);
  }, [activeIntent.defaultType, noteModalRequestId, showNoteModal]);

  useEffect(() => {
    if (!showNoteModal) return;

    if (status === "starting") {
      setPoliteMessage("Starting microphone...");
      return;
    }

    if (status === "listening") {
      setPoliteMessage("Recording started.");
      return;
    }

    if (status === "stopping") {
      setPoliteMessage("Stopping microphone...");
      return;
    }

    if (lastStopReason) {
      setPoliteMessage("Recording stopped.");
    }
  }, [lastStopReason, showNoteModal, status]);

  useEffect(() => {
    if (!showNoteModal || !interimTranscript) return;
    setPoliteMessage(`Listening: ${interimTranscript}`);
  }, [interimTranscript, showNoteModal]);

  useEffect(() => {
    if (!notesSectionRef.current) return;

    // Defensive accessibility guard: hidden swipe-reveal controls must not receive keyboard focus.
    const hiddenSwipeButtons = notesSectionRef.current.querySelectorAll<HTMLButtonElement>(
      '.game-card-swipe-reveal button, .delete-action button, .btn-edit-swipe, .btn-delete-swipe, .btn-delete-swipe-game'
    );

    hiddenSwipeButtons.forEach((button) => {
      button.tabIndex = -1;
      button.setAttribute('aria-hidden', 'true');
      button.setAttribute('inert', '');
    });
  }, [inGameNotes.length]);

  useEffect(() => {
    if (!showNoteModal) return;
    const code = errorCode ?? lastErrorCode;
    if (!code) return;

    if (code === "not-allowed") {
      setAssertiveMessage("Microphone permission denied. Type your note manually or use keyboard dictation.");
      showWarning("Microphone permission denied.");
      return;
    }

    if (code === "no-speech") {
      setAssertiveMessage("No speech detected. Try again or type note manually.");
      showWarning("No speech detected. Try again.");
      return;
    }

    if (code === "network") {
      setAssertiveMessage("Speech recognition network error. You can continue by typing your note.");
      showWarning("Speech recognition network error.");
      return;
    }

    if (code === "start-failed") {
      setAssertiveMessage("Unable to start dictation on this device. Type your note manually.");
      return;
    }
  }, [errorCode, lastErrorCode, showNoteModal]);

  const getNoteIcon = (type: string) => {
    switch (type) {
      case 'gold-star': return '⭐';
      case 'yellow-card': return '🟨';
      case 'red-card': return '🟥';
      default: return '📝';
    }
  };

  const getNoteLabel = (type: string) => {
    switch (type) {
      case 'gold-star': return 'Gold Star';
      case 'yellow-card': return 'Yellow Card';
      case 'red-card': return 'Red Card';
      default: return 'Note';
    }
  };

  const saveDisabled = noteText.trim().length === 0 || isTransientVoiceState;

  const dictationUnavailableText = "Voice capture is not supported in this browser. Type your note manually, or use iPhone keyboard dictation (tap the microphone key on the keyboard).";

  return (
    <>
      {/* Note Buttons */}
      {showPanelContent && gameState.status !== 'scheduled' && (
        <div className="note-buttons">
          {gameState.status === 'completed' ? (
            <>
              <button
                onClick={(event) => handleOpenNoteModal('gold-star', event.currentTarget)}
                className="btn-note btn-note-gold"
              >
                ⭐ Gold Star
              </button>
              <button
                onClick={(event) => handleOpenNoteModal('other', event.currentTarget)}
                className="btn-note btn-note-other"
              >
                📝 Note
              </button>
            </>
          ) : (
            <>
              <button
                onClick={(event) => handleOpenNoteModal('gold-star', event.currentTarget)}
                className="btn-note btn-note-gold"
              >
                ⭐ Gold Star
              </button>
              <button
                onClick={(event) => handleOpenNoteModal('yellow-card', event.currentTarget)}
                className="btn-note btn-note-yellow"
              >
                🟨 Yellow Card
              </button>
              <button
                onClick={(event) => handleOpenNoteModal('red-card', event.currentTarget)}
                className="btn-note btn-note-red"
              >
                🟥 Red Card
              </button>
              <button
                onClick={(event) => handleOpenNoteModal('other', event.currentTarget)}
                className="btn-note btn-note-other"
              >
                📝 Note
              </button>
            </>
          )}
        </div>
      )}

      {/* Game Notes List */}
      {inGameNotes.length > 0 && (
        <div className="notes-section" ref={notesSectionRef}>
          <h3 id="game-notes-heading" tabIndex={-1}>Game Notes</h3>
          <div className="sr-only" aria-live="polite">{actionPoliteMessage}</div>
          <div className="sr-only" aria-live="assertive">{actionAssertiveMessage}</div>
          <div className="notes-list">
            {inGameNotes.map((note) => {
              const noteTypeValue = (note.noteType ?? 'other') as 'gold-star' | 'yellow-card' | 'red-card' | 'other' | 'coaching-point';
              const notePlayer = note.playerId ? players.find(p => p.id === note.playerId) : null;
              const decision = getGameNoteActionDecision({
                noteType: noteTypeValue,
                isTeamCoach: Boolean(currentUserId && team.coaches?.includes(currentUserId)),
                isAuthor: Boolean(currentUserId && note.authorId === currentUserId),
              });

              const deleteDisabledReason =
                noteTypeValue === 'yellow-card'
                  ? 'Yellow card notes cannot be deleted.'
                  : noteTypeValue === 'red-card'
                    ? 'Red card notes cannot be deleted.'
                    : 'Only the author can delete this note.';

              const actionDescriptors: GameActionDescriptor[] = [
                {
                  id: 'edit',
                  label: 'Edit',
                  kind: 'primary',
                  ariaLabel: 'Edit note',
                  disabled: !decision.canEdit,
                  srStatusText: decision.canEdit ? 'Edit note available.' : 'Edit note unavailable.',
                  onAction: async () => {
                    startEditingNote(note);
                  },
                },
                {
                  id: 'delete',
                  label: 'Delete',
                  kind: 'destructive',
                  ariaLabel: 'Delete note',
                  disabled: !decision.canDelete,
                  disabledReason: !decision.canDelete ? deleteDisabledReason : undefined,
                  srStatusText: decision.canDelete
                    ? 'Delete note available.'
                    : `Delete note unavailable: ${deleteDisabledReason}`,
                  confirmDialog: {
                    title: 'Delete note?',
                    body: 'This permanently removes this note from the game timeline.',
                    authorReminder: 'Only the original author can confirm this delete.',
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                  },
                  onAction: async () => {
                    await deleteNote(note);
                  },
                },
              ];

              const editedIndicator = getEditedIndicatorText(note);
              return (
                <div key={note.id} className="swipeable-item-container">
                  <div className={`note-card note-${noteTypeValue}`} {...getSwipeProps(note.id)} style={getSwipeStyle(note.id)}>
                    <div className="note-icon">{getNoteIcon(noteTypeValue)}</div>
                    <div className="note-info">
                      <div className="note-header">
                        <span className="note-type">{getNoteLabel(noteTypeValue)}</span>
                        <span className="note-time">{note.gameSeconds != null ? `${Math.floor(note.gameSeconds / 60)}'` : '--'} ({note.half === 1 ? '1st' : '2nd'} Half)</span>
                      </div>
                      {notePlayer && (
                        <div className="note-player">
                          #{notePlayer.playerNumber} {notePlayer.firstName} {notePlayer.lastName}
                        </div>
                      )}
                      {note.notes && <div className="note-text">{note.notes}</div>}
                      {editedIndicator && <div className="note-edited-meta">{editedIndicator}</div>}
                      <GameActionRow
                        actions={actionDescriptors}
                        headingIdForDeleteSuccessFocus="game-notes-heading"
                        onActionError={(message) => {
                          setActionAssertiveMessage(message);
                          setActionPoliteMessage('');
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editingNoteId && (
        <div className="modal-overlay" onClick={cancelEditingNote} role="dialog" aria-modal="true" aria-labelledby="edit-note-modal-title">
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="edit-note-modal-title">Edit Note</h2>
            <p className="modal-subtitle">Text-only edit</p>
            <div className="form-group">
              <label htmlFor="editNoteText">Note</label>
              <textarea
                id="editNoteText"
                value={editingNoteText}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(e) => setEditingNoteText(clampToLimit(e.target.value))}
                placeholder="Update note text"
                rows={4}
                autoFocus
              />
              <div className="char-counter">{editingNoteText.length} / {MAX_NOTE_LENGTH}</div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn-primary" onClick={() => void saveEditedNote()} disabled={isSavingEdit}>
                {isSavingEdit ? 'Saving…' : 'Save Changes'}
              </button>
              <button type="button" className="btn-secondary" onClick={cancelEditingNote} disabled={isSavingEdit}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note Modal */}
      {showNoteModal && (
        <div className="modal-overlay" onClick={closeNoteModal}>
          <div className="modal-content note-modal note-modal--live" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="live-note-modal-title">
            <h2 id="live-note-modal-title" ref={modalTitleRef} tabIndex={-1}>{getNoteIcon(noteType)} {getNoteLabel(noteType)}</h2>
            <div className="sr-only" aria-live="polite">{politeMessage}</div>
            <div className="sr-only" aria-live="assertive">{assertiveMessage}</div>
            {gameState.status === 'completed' ? (
              <p className="modal-subtitle">
                Post-Game Note
              </p>
            ) : (
              <p className="modal-subtitle">
                {formatGameTimeDisplay(getCurrentGameTime(), gameState.currentHalf || 1)}
              </p>
            )}

            <div className="note-modal__type-row">
              <button type="button" className={`note-modal__type-chip ${noteType === "gold-star" ? "active" : ""}`} onClick={() => setNoteType("gold-star")} disabled={isTransientVoiceState}>
                ⭐ Gold Star
              </button>
              <button type="button" className={`note-modal__type-chip ${noteType === "yellow-card" ? "active" : ""}`} onClick={() => setNoteType("yellow-card")} disabled={isTransientVoiceState}>
                🟨 Yellow Card
              </button>
              {gameState.status !== "completed" && (
                <button type="button" className={`note-modal__type-chip ${noteType === "red-card" ? "active" : ""}`} onClick={() => setNoteType("red-card")} disabled={isTransientVoiceState}>
                  🟥 Red Card
                </button>
              )}
              <button type="button" className={`note-modal__type-chip ${noteType === "other" ? "active" : ""}`} onClick={() => setNoteType("other")} disabled={isTransientVoiceState}>
                📝 Note
              </button>
            </div>

            <div className="note-modal__voice-rail">
              {isSupported ? (
                <>
                  <button
                    type="button"
                    className={`note-modal__dictation-btn ${isListening ? "is-listening" : ""}`}
                    aria-label={isListening ? "Stop dictation" : "Start English dictation"}
                    onClick={() => {
                      if (isListening) {
                        stop("manual-stop");
                        return;
                      }
                      start();
                    }}
                    disabled={status === "starting" || status === "stopping"}
                  >
                    {isListening ? "Stop Dictation" : "Start Dictation"}
                  </button>
                  <span className="note-modal__voice-hint">English dictation is supported in this release.</span>
                </>
              ) : (
                <p className="note-modal__voice-fallback">{dictationUnavailableText}</p>
              )}
            </div>

            {interimTranscript && (
              <p className="note-modal__interim">Listening: {interimTranscript}</p>
            )}

            {showEndCue && <p className="note-modal__end-cue">Dictation ended.</p>}

            {lowConfidenceDetected && (
              <p className="note-modal__low-confidence" role="status">
                Transcription may be inaccurate. Please review before saving.
              </p>
            )}

            {status === "starting" && <p className="note-modal__helper-copy">Starting microphone...</p>}
            {status === "stopping" && <p className="note-modal__helper-copy">Stopping microphone...</p>}
            {isFinalizing && <p className="note-modal__helper-copy">Finalizing transcript...</p>}

            <div className="form-group">
              <label htmlFor="notePlayer">Player (optional)</label>
              <PlayerSelect
                id="notePlayer"
                players={players}
                value={notePlayerId}
                onChange={setNotePlayerId}
                placeholder="None / General note"
                className="w-full"
              />
            </div>

            <div className="form-group">
              <label htmlFor="noteText">Note</label>
              <textarea
                id="noteText"
                ref={modalTextRef}
                value={noteText}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(e) => {
                  setNoteText(clampToLimit(e.target.value));
                  setTruncatedByDictation(false);
                }}
                placeholder="Add your note here..."
                rows={4}
                style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
              />
              <div className="char-counter">{noteText.length} / {MAX_NOTE_LENGTH}</div>
              {truncatedByDictation && (
                <p className="note-modal__truncation-warning">Dictation was truncated at 500 characters.</p>
              )}
            </div>

            <div className="form-actions note-modal__footer-actions">
              <button onClick={handleSaveNote} className="btn-primary" disabled={saveDisabled}>
                Save Note
              </button>
              <button onClick={closeNoteModal} className="btn-secondary" disabled={isFinalizing}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
