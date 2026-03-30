import { useEffect, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import type { Game, GameNote, PlayerWithRoster } from "./types";

interface PreGameNotesPanelProps {
  gameStatus: Game['status'];
  notes: GameNote[];
  players: PlayerWithRoster[];
  onAdd: () => void;
  onEdit: (note: GameNote) => void;
  onDelete: (note: GameNote) => void;
  isReadOnly?: boolean;
}

function getPlayerLabel(playerId: string | null | undefined, players: PlayerWithRoster[]): string {
  if (!playerId) return 'General Note';
  const player = players.find((p) => p.id === playerId);
  if (!player) return 'General Note';
  return `#${player.playerNumber} ${player.firstName} ${player.lastName}`;
}

export function PreGameNotesPanel({ gameStatus, notes, players, onAdd, onEdit, onDelete, isReadOnly = false }: PreGameNotesPanelProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const isSoftLocked = isReadOnly || gameStatus === 'in-progress' || gameStatus === 'halftime';

  useEffect(() => {
    let isMounted = true;

    void getCurrentUser()
      .then((user) => {
        if (isMounted) {
          setCurrentUserId(user.userId);
        }
      })
      .catch(() => {
        // Ignore auth lookup failures and fall back to non-personalized labels.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function formatAuthorLabel(authorId: string | null | undefined): string {
    if (!authorId) return 'Unknown Author';
    if (authorId === currentUserId) return 'You';
    if (authorId.length <= 11) return `Coach (${authorId})`;
    return `Coach (${authorId.slice(0, 6)}...${authorId.slice(-5)})`;
  }

  return (
    <section className="pre-game-notes-panel" aria-label="Pre-game coaching notes">
      <div className="pre-game-notes-header">
        <div>
          <h3>Pre-Game Coaching Notes</h3>
          <p>Capture strategy reminders and player-specific talking points before kickoff.</p>
        </div>
        {!isReadOnly && (
          <button
            type="button"
            className="btn-primary btn-add-coaching-point"
            onClick={onAdd}
            disabled={isSoftLocked}
            aria-label="Add coaching point"
          >
            Add Coaching Point
          </button>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="empty-state-coaching-point" role="status">
          <p>No coaching points yet.</p>
          <p>Add a note for team strategy, shape reminders, or player focus.</p>
        </div>
      ) : (
        <div className="pre-game-notes-grid" data-testid="pre-game-notes-grid">
          {notes.map((note) => (
            <article key={note.id} className="note-card note-type-coaching-point">
              <div className="note-icon" aria-hidden="true">💡</div>
              <div className="note-info">
                <div className="note-header">
                  <span className="note-type">Coaching Point</span>
                </div>
                <div className="note-player">{getPlayerLabel(note.playerId, players)}</div>
                {note.notes && <div className="note-text">{note.notes}</div>}
                <div className="note-author">Created by: {formatAuthorLabel(note.authorId)}</div>
                {!isReadOnly && (
                  <div className="pre-game-note-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onEdit(note)}
                      disabled={isSoftLocked}
                      aria-label="Edit coaching point"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onDelete(note)}
                      disabled={isSoftLocked}
                      aria-label="Delete coaching point"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
