import { describe, expect, it } from 'vitest';
import {
  canDeleteGameNote,
  canEditGameNote,
  getGameNoteActionDecision,
  getRescindSendOffDecision,
  type GameNoteActionContext,
} from './gameNoteActionPolicy';

function makeCtx(overrides: Partial<GameNoteActionContext> = {}): GameNoteActionContext {
  return {
    noteType: 'other',
    isTeamCoach: true,
    isAuthor: true,
    ...overrides,
  };
}

describe('gameNoteActionPolicy', () => {
  it('allows coaches to edit notes', () => {
    expect(canEditGameNote(makeCtx())).toBe(true);
  });

  it('blocks non-coaches from editing notes', () => {
    expect(canEditGameNote(makeCtx({ isTeamCoach: false }))).toBe(false);
  });

  it('allows author coach to delete gold-star and other notes', () => {
    expect(canDeleteGameNote(makeCtx({ noteType: 'gold-star' }))).toBe(true);
    expect(canDeleteGameNote(makeCtx({ noteType: 'other' }))).toBe(true);
  });

  it('blocks delete when caller is not author', () => {
    expect(canDeleteGameNote(makeCtx({ isAuthor: false }))).toBe(false);
  });

  it('blocks delete for yellow/red notes even for author coach', () => {
    expect(canDeleteGameNote(makeCtx({ noteType: 'yellow-card' }))).toBe(false);
    expect(canDeleteGameNote(makeCtx({ noteType: 'red-card' }))).toBe(false);
  });

  it('returns normalized reason codes', () => {
    expect(getGameNoteActionDecision(makeCtx({ isTeamCoach: false }))).toMatchObject({
      canEdit: false,
      canDelete: false,
      editReason: 'NOT_TEAM_COACH',
      deleteReason: 'NOT_TEAM_COACH',
    });

    expect(getGameNoteActionDecision(makeCtx({ isAuthor: false }))).toMatchObject({
      canEdit: true,
      canDelete: false,
      deleteReason: 'NOT_AUTHOR',
    });

    expect(getGameNoteActionDecision(makeCtx({ noteType: 'yellow-card' }))).toMatchObject({
      canEdit: true,
      canDelete: false,
      deleteReason: 'NOTE_TYPE_NON_DELETABLE',
    });
  });
});

describe('getRescindSendOffDecision', () => {
  const ctx = { noteType: 'red-card' as const, isTeamCoach: true, alreadyRescinded: false };

  it('allows any team coach to rescind an active red card', () => {
    expect(getRescindSendOffDecision(ctx)).toEqual({ canRescind: true, reason: 'OK' });
  });

  it('blocks non-coaches', () => {
    expect(getRescindSendOffDecision({ ...ctx, isTeamCoach: false })).toEqual({ canRescind: false, reason: 'NOT_TEAM_COACH' });
  });

  it('blocks any note type other than red-card', () => {
    for (const noteType of ['yellow-card', 'gold-star', 'other', 'coaching-point'] as const) {
      expect(getRescindSendOffDecision({ ...ctx, noteType })).toEqual({ canRescind: false, reason: 'NOT_RED_CARD' });
    }
  });

  it('blocks a second rescind', () => {
    expect(getRescindSendOffDecision({ ...ctx, alreadyRescinded: true })).toEqual({ canRescind: false, reason: 'ALREADY_RESCINDED' });
  });
});
