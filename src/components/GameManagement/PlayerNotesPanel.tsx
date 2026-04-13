import { useCallback, useEffect, useRef, useState } from "react";
import { handleApiError } from "../../utils/errorHandler";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import { showWarning } from "../../utils/toast";
import { PlayerSelect } from "../PlayerSelect";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";
import type { Game, Team, PlayerWithRoster, GameNote } from "./types";
import { useSpeechToText, type StopReason } from "./hooks/useSpeechToText";

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
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [lastStopReason, setLastStopReason] = useState<StopReason | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);

  const returnFocusRef = useRef<HTMLElement | null>(null);
  const modalTextRef = useRef<HTMLTextAreaElement | null>(null);
  const modalTitleRef = useRef<HTMLHeadingElement | null>(null);
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
        <div className="notes-section">
          <h3>Game Notes</h3>
          <div className="notes-list">
            {inGameNotes.map((note) => {
              const noteTypeValue = note.noteType ?? 'other';
              const notePlayer = note.playerId ? players.find(p => p.id === note.playerId) : null;
              return (
                <div key={note.id} className={`note-card note-${noteTypeValue}`}>
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
                  </div>
                </div>
              );
            })}
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
