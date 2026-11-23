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

export interface RescindSendOffContext {
  noteType: PolicyNoteType;
  isTeamCoach: boolean;
  alreadyRescinded: boolean;
}

export type RescindSendOffReasonCode =
  | 'OK'
  | 'NOT_TEAM_COACH'
  | 'NOT_RED_CARD'
  | 'ALREADY_RESCINDED';

// Any team coach may rescind (not author-only): the coach who mis-tapped is often
// the one least able to fix it mid-game. The card note itself is never mutated.
export function getRescindSendOffDecision(ctx: RescindSendOffContext): {
  canRescind: boolean;
  reason: RescindSendOffReasonCode;
} {
  if (!ctx.isTeamCoach) return { canRescind: false, reason: 'NOT_TEAM_COACH' };
  if (ctx.noteType !== 'red-card') return { canRescind: false, reason: 'NOT_RED_CARD' };
  if (ctx.alreadyRescinded) return { canRescind: false, reason: 'ALREADY_RESCINDED' };
  return { canRescind: true, reason: 'OK' };
}
