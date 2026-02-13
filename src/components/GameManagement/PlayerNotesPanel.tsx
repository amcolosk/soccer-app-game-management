import { useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import { PlayerSelect } from "../PlayerSelect";
import type { Game, Team, PlayerWithRoster, GameNote } from "./types";

const client = generateClient<Schema>();

interface PlayerNotesPanelProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  gameNotes: GameNote[];
  currentTime: number;
}

export function PlayerNotesPanel({
  gameState,
  game,
  team,
  players,
  gameNotes,
  currentTime,
}: PlayerNotesPanelProps) {
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteType, setNoteType] = useState<'gold-star' | 'yellow-card' | 'red-card' | 'other'>('other');
  const [notePlayerId, setNotePlayerId] = useState("");
  const [noteText, setNoteText] = useState("");

  const getCurrentGameTime = () => currentTime;

  const handleOpenNoteModal = (type: 'gold-star' | 'yellow-card' | 'red-card' | 'other') => {
    setNoteType(type);
    setNotePlayerId("");
    setNoteText("");
    setShowNoteModal(true);
  };

  const handleSaveNote = async () => {
    try {
      // For completed games, use the total game time; otherwise use current half time
      const timeInSeconds = gameState.status === 'completed' ? currentTime : getCurrentGameTime();

      await client.models.GameNote.create({
        gameId: game.id,
        noteType,
        playerId: notePlayerId || undefined,
        gameSeconds: timeInSeconds,
        half: gameState.currentHalf || 2, // Default to 2nd half for completed games
        notes: noteText || undefined,
        timestamp: new Date().toISOString(),
        coaches: team.coaches,
      });

      setShowNoteModal(false);
    } catch (error) {
      console.error("Error saving note:", error);
      alert("Failed to save note");
    }
  };

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

  return (
    <>
      {/* Note Buttons */}
      {gameState.status !== 'scheduled' && (
        <div className="note-buttons">
          {gameState.status === 'completed' ? (
            <>
              <button onClick={() => handleOpenNoteModal('gold-star')} className="btn-note btn-note-gold">
                ⭐ Gold Star
              </button>
              <button onClick={() => handleOpenNoteModal('other')} className="btn-note btn-note-other">
                📝 Note
              </button>
            </>
          ) : (
            <>
              <button onClick={() => handleOpenNoteModal('gold-star')} className="btn-note btn-note-gold">
                ⭐ Gold Star
              </button>
              <button onClick={() => handleOpenNoteModal('yellow-card')} className="btn-note btn-note-yellow">
                🟨 Yellow Card
              </button>
              <button onClick={() => handleOpenNoteModal('red-card')} className="btn-note btn-note-red">
                🟥 Red Card
              </button>
              <button onClick={() => handleOpenNoteModal('other')} className="btn-note btn-note-other">
                📝 Note
              </button>
            </>
          )}
        </div>
      )}

      {/* Game Notes List */}
      {gameNotes.length > 0 && (
        <div className="notes-section">
          <h3>Game Notes</h3>
          <div className="notes-list">
            {gameNotes.map((note) => {
              const notePlayer = note.playerId ? players.find(p => p.id === note.playerId) : null;
              return (
                <div key={note.id} className={`note-card note-${note.noteType}`}>
                  <div className="note-icon">{getNoteIcon(note.noteType)}</div>
                  <div className="note-info">
                    <div className="note-header">
                      <span className="note-type">{getNoteLabel(note.noteType)}</span>
                      <span className="note-time">{Math.floor(note.gameSeconds / 60)}' ({note.half === 1 ? '1st' : '2nd'} Half)</span>
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
        <div className="modal-overlay" onClick={() => setShowNoteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{getNoteIcon(noteType)} {getNoteLabel(noteType)}</h2>
            {gameState.status === 'completed' ? (
              <p className="modal-subtitle">
                Post-Game Note
              </p>
            ) : (
              <p className="modal-subtitle">
                {formatGameTimeDisplay(getCurrentGameTime(), gameState.currentHalf || 1)}
              </p>
            )}

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
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add your note here..."
                rows={4}
                style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
              />
            </div>

            <div className="form-actions">
              <button onClick={handleSaveNote} className="btn-primary">
                Save Note
              </button>
              <button onClick={() => setShowNoteModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
