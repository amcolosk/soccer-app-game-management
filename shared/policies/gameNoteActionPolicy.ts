export type PolicyNoteType = 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other';

export type GameNoteActionReasonCode =
  | 'OK'
  | 'NOT_TEAM_COACH'
  | 'NOT_AUTHOR'
  | 'NOTE_TYPE_NON_DELETABLE';

export interface GameNoteActionContext {
  noteType: PolicyNoteType;
  isTeamCoach: boolean;
  isAuthor: boolean;
}

export interface GameNoteActionDecision {
  canEdit: boolean;
  canDelete: boolean;
  editReason: GameNoteActionReasonCode;
  deleteReason: GameNoteActionReasonCode;
}

function isDeleteBlockedByNoteType(noteType: PolicyNoteType): boolean {
  return noteType === 'yellow-card' || noteType === 'red-card';
}

export function canEditGameNote(ctx: GameNoteActionContext): boolean {
  return ctx.isTeamCoach;
}

export function canDeleteGameNote(ctx: GameNoteActionContext): boolean {
  if (!ctx.isTeamCoach) return false;
  if (!ctx.isAuthor) return false;
  if (isDeleteBlockedByNoteType(ctx.noteType)) return false;
  return true;
}

export function getGameNoteActionDecision(ctx: GameNoteActionContext): GameNoteActionDecision {
  const canEdit = canEditGameNote(ctx);
  let editReason: GameNoteActionReasonCode = 'OK';
  if (!canEdit) {
    editReason = 'NOT_TEAM_COACH';
  }

  let canDelete = true;
  let deleteReason: GameNoteActionReasonCode = 'OK';

  if (!ctx.isTeamCoach) {
    canDelete = false;
    deleteReason = 'NOT_TEAM_COACH';
  } else if (!ctx.isAuthor) {
    canDelete = false;
    deleteReason = 'NOT_AUTHOR';
  } else if (isDeleteBlockedByNoteType(ctx.noteType)) {
    canDelete = false;
    deleteReason = 'NOTE_TYPE_NON_DELETABLE';
  }

  return {
    canEdit,
    canDelete,
    editReason,
    deleteReason,
  };
}
