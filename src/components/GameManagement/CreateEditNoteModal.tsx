import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showError } from "../../utils/toast";
import type { PlayerWithRoster } from "./types";

type InitialNote = {
  notes?: string | null;
  playerId?: string | null;
};

interface CreateEditNoteModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  players: PlayerWithRoster[];
  initialNote?: InitialNote | null;
  onClose: () => void;
  onSubmit: (payload: { notes: string; playerId: string | null }) => Promise<void>;
}

const MAX_NOTE_LENGTH = 500;

export function CreateEditNoteModal({
  isOpen,
  mode,
  players,
  initialNote,
  onClose,
  onSubmit,
}: CreateEditNoteModalProps) {
  const [noteText, setNoteText] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = noteText.trim();
    if (!trimmed) {
      showError('Coaching note text is required.');
      return;
    }
    if (trimmed.length > MAX_NOTE_LENGTH) {
      showError(`Coaching notes are limited to ${MAX_NOTE_LENGTH} characters.`);
      return;
    }

    try {
      setIsSaving(true);
      await onSubmit({ notes: trimmed, playerId: playerId || null });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }, [noteText, onClose, onSubmit, playerId]);

  useEffect(() => {
    if (!isOpen) return;
    setNoteText(initialNote?.notes || '');
    setPlayerId(initialNote?.playerId || '');
  }, [isOpen, initialNote]);

  useEffect(() => {
    if (!isOpen) return;
    textRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void handleSubmit();
        return;
      }

      if (event.key !== 'Tab' || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSubmit, isOpen, onClose]);

  const counterLabel = useMemo(() => `${noteText.length} / ${MAX_NOTE_LENGTH}`, [noteText.length]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content modal-create-note"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-edit-note-title"
        onClick={(event) => event.stopPropagation()}
        ref={containerRef}
      >
        <h2 id="create-edit-note-title">{mode === 'create' ? 'Add Coaching Point' : 'Edit Coaching Point'}</h2>

        <div className="form-group">
          <label htmlFor="pre-game-note-text">Coaching note</label>
          <textarea
            id="pre-game-note-text"
            ref={textRef}
            rows={5}
            maxLength={MAX_NOTE_LENGTH + 1}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="e.g., Focus on transitions in midfield"
            aria-label="Coaching note text"
          />
          <div className="char-counter" aria-live="polite">{counterLabel}</div>
        </div>

        <div className="form-group">
          <label htmlFor="pre-game-note-player">Player</label>
          <select
            id="pre-game-note-player"
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
            aria-label="Select player for note"
          >
            <option value="">General Note</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                #{player.playerNumber} {player.firstName} {player.lastName}
              </option>
            ))}
          </select>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={() => void handleSubmit()} disabled={isSaving}>
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
