# Safe Delete Guards — Implementation Plan

## Problem Statement

`deleteFormationCascade` performs no referential-integrity check before deleting.  
When a team's `formationId` references a now-deleted formation the team appears broken
in the UI and any game data linked to its lineup assignments becomes invisible —  
exactly the "wiped out my game data" symptom reported by the user.

`deletePlayerCascade` already cascades correctly, but the user receives no
forewarning about the scope of what will be permanently removed (roster slots,
goals, play-time records, notes).

---

## Requirements Summary

| Entity | Guard type | Behaviour |
|---|---|---|
| Formation | **Block** | If 1+ teams reference the formation, refuse deletion entirely; show team names |
| Player | **Warn + override** | If player has roster entries *or* game history, show counts; allow user to proceed |
| Team | No change | Existing cascade is correct |
| Game | No change | Existing cascade is correct |

---

## Design Decisions

### Formation guard — synchronous, no extra network call

`Management.tsx` already loads the full `teams` array via `useAmplifyQuery('Team')`.  
The in-use check is a simple `teams.filter(t => t.formationId === id)` — **zero extra
round-trips**, instant feedback.

When blocked, call `showError(message)` and return **before** the confirm modal is
shown.  This matches the "block" requirement and uses the existing error pattern.

### Player guard — async impact fetch, conditional modal variant

`teamRosters` is already loaded in the component (roster count available sync).  
`PlayTimeRecord`, `Goal`, and `GameNote` counts require DB queries since these are
not pre-loaded.

A new `getPlayerImpact(playerId)` service function fetches the four counts in
parallel.  If **any count > 0** the `confirmAndDelete` call uses `variant: 'warning'`
with a message that lists all impact numbers.  If all counts are zero the existing
`variant: 'danger'` simple confirmation is used unchanged.

The user can always proceed by clicking Confirm — this is the "override" path.

### E2E cleanup — no changes required

`cleanupTestData` in `e2e/helpers.ts` already deletes in the correct order:
**Teams → Players → Formations**.

- After team cascade-deletion, all `TeamRoster`, `PlayTimeRecord`, `Goal`, and
  `GameNote` records for those players are gone, so `getPlayerImpact` returns zeros
  and the plain danger modal appears — `handleConfirmDialog` auto-confirms it.
- Formations are cleaned up after teams, so `teams.filter(…)` returns empty,
  the block never fires, and the confirm modal proceeds as before.

No test helper or spec file changes are required.

---

## File-by-File Change List

### 1. `src/services/cascadeDeleteService.ts`

**Add** at the bottom (after `deleteFormationCascade`):

```typescript
// ---------------------------------------------------------------------------
// Player Impact Query
// ---------------------------------------------------------------------------

export interface PlayerImpact {
  rosterCount: number;
  playTimeRecordCount: number;
  goalCount: number;
  noteCount: number;
}

/**
 * Returns the count of records that would be deleted if this player were
 * removed.  Used to build a pre-deletion warning for coaches.
 *
 * TeamRoster entries are NOT counted here because the caller (Management.tsx)
 * already has them loaded from useAmplifyQuery — the component derives
 * rosterCount directly and passes it into the message.
 */
export async function getPlayerImpact(playerId: string): Promise<PlayerImpact> {
  const [playTimeRecords, goalsAsScorer, gameNotes] = await Promise.all([
    listAll(client.models.PlayTimeRecord as any, { playerId: { eq: playerId } }),
    listAll(client.models.Goal as any, { scorerId: { eq: playerId } }),
    listAll(client.models.GameNote as any, { playerId: { eq: playerId } }),
  ]);

  return {
    rosterCount: 0, // populated by caller
    playTimeRecordCount: playTimeRecords.length,
    goalCount: goalsAsScorer.length,
    noteCount: gameNotes.length,
  };
}
```

> **Note**: `rosterCount` is set to `0` in the service; the caller inserts the
> value from the already-loaded `teamRosters` array.  This avoids a redundant
> DB round-trip and keeps the interface honest about which data the service owns.

---

### 2. `src/components/Management.tsx`

#### 2a. Import additions (top of file)

```typescript
import {
  deleteTeamCascade,
  deletePlayerCascade,
  deleteFormationCascade,
  getPlayerImpact,            // ← add
} from '../services/cascadeDeleteService';
```

#### 2b. Replace `handleDeleteFormation`

Current implementation (lines ~659-664):
```typescript
const handleDeleteFormation = (id: string) => confirmAndDelete(confirm, {
  title: 'Delete Formation',
  message: 'Are you sure you want to delete this formation? This will also delete all positions in the formation.',
  deleteFn: async () => { await deleteFormationCascade(id); trackEvent(…); },
  entityName: 'formation',
});
```

New implementation:
```typescript
const handleDeleteFormation = async (id: string) => {
  // Guard: block if any team references this formation
  const usingTeams = teams.filter(t => t.formationId === id);
  if (usingTeams.length > 0) {
    const teamNames = usingTeams.map(t => t.name).join(', ');
    showError(
      `Cannot delete this formation — it is currently used by: ${teamNames}. ` +
      `Please assign a different formation to those teams first.`
    );
    return;
  }

  await confirmAndDelete(confirm, {
    title: 'Delete Formation',
    message: 'Are you sure you want to delete this formation? This will also delete all positions in the formation.',
    deleteFn: async () => {
      await deleteFormationCascade(id);
      trackEvent(AnalyticsEvents.FORMATION_DELETED.category, AnalyticsEvents.FORMATION_DELETED.action);
    },
    entityName: 'formation',
  });
};
```

**Key change**: `handleDeleteFormation` becomes `async` so it can `await
confirmAndDelete`.  The function signature used in the JSX render is
`onClick={() => handleDeleteFormation(id)}` and already handles async return
values — no JSX change needed because the `void` is silently dropped, matching
the existing pattern used by `handleCreateTeam`, `handleUpdateTeam`, etc.

#### 2c. Replace `handleDeletePlayer`

Current implementation (lines ~441-446):
```typescript
const handleDeletePlayer = (id: string) => confirmAndDelete(confirm, {
  title: 'Delete Player',
  message: 'Are you sure you want to delete this player? This will remove them from all team rosters.',
  deleteFn: async () => { await deletePlayerCascade(id); trackEvent(…); },
  entityName: 'player',
});
```

New implementation:
```typescript
const handleDeletePlayer = async (id: string) => {
  // Derive roster count from already-loaded data
  const rosterCount = teamRosters.filter(r => r.playerId === id).length;

  // Fetch game-history counts from DB (async)
  const impact = await getPlayerImpact(id);
  impact.rosterCount = rosterCount;

  const totalImpact =
    impact.rosterCount + impact.playTimeRecordCount + impact.goalCount + impact.noteCount;

  if (totalImpact > 0) {
    // Build a human-readable impact summary
    const parts: string[] = [];
    if (impact.rosterCount > 0)
      parts.push(`${impact.rosterCount} team roster ${impact.rosterCount === 1 ? 'entry' : 'entries'}`);
    if (impact.playTimeRecordCount > 0)
      parts.push(`${impact.playTimeRecordCount} play-time ${impact.playTimeRecordCount === 1 ? 'record' : 'records'}`);
    if (impact.goalCount > 0)
      parts.push(`${impact.goalCount} ${impact.goalCount === 1 ? 'goal' : 'goals'}`);
    if (impact.noteCount > 0)
      parts.push(`${impact.noteCount} ${impact.noteCount === 1 ? 'note' : 'notes'}`);

    const summary = parts.join(', ');

    await confirmAndDelete(confirm, {
      title: 'Delete Player — Data Loss Warning',
      message:
        `This player has ${summary}. Deleting them will permanently remove all of this data. ` +
        `This cannot be undone.`,
      confirmText: 'Delete Anyway',
      deleteFn: async () => {
        await deletePlayerCascade(id);
        trackEvent(AnalyticsEvents.PLAYER_DELETED.category, AnalyticsEvents.PLAYER_DELETED.action);
      },
      entityName: 'player',
    });
  } else {
    await confirmAndDelete(confirm, {
      title: 'Delete Player',
      message: 'Are you sure you want to delete this player? This will remove them from all team rosters.',
      deleteFn: async () => {
        await deletePlayerCascade(id);
        trackEvent(AnalyticsEvents.PLAYER_DELETED.category, AnalyticsEvents.PLAYER_DELETED.action);
      },
      entityName: 'player',
    });
  }
};
```

> **Note on `confirmAndDelete` variant**:  The existing `confirmAndDelete` helper
> always passes `variant: 'danger'`.  For the warning case we want `variant:
> 'warning'`.  Two options:
>
> **Option A** — Add optional `variant` param to `confirmAndDelete`:
> ```typescript
> async function confirmAndDelete(
>   confirmFn,
>   opts: { …; variant?: 'danger' | 'warning' | 'default'; deleteFn; entityName }
> ) {
>   const confirmed = await confirmFn({
>     …,
>     variant: opts.variant || 'danger',
>   });
> ```
>
> **Option B** — Call `confirm(…)` directly in the warning branch (bypassing
> `confirmAndDelete`) and only use `confirmAndDelete` for the clean path.
>
> **Recommendation: Option A** — minimal, backward-compatible, single change to
> `confirmAndDelete`, and keeps the try/catch error handling centralised.

---

### 3. `src/services/cascadeDeleteService.test.ts`

Add a new `describe` block **after** the `deleteFormationCascade` suite:

```typescript
// ---------------------------------------------------------------------------
// getPlayerImpact
// ---------------------------------------------------------------------------

describe('getPlayerImpact', () => {
  it('should return zero counts when player has no game history', async () => {
    const impact = await getPlayerImpact('player-1');
    expect(impact.playTimeRecordCount).toBe(0);
    expect(impact.goalCount).toBe(0);
    expect(impact.noteCount).toBe(0);
  });

  it('should count play-time records for the player', async () => {
    mockList.mockImplementation((opts?: any) => {
      if (opts?.filter?.playerId?.eq === 'player-1') {
        return Promise.resolve({ data: [{ id: 'ptr-1' }, { id: 'ptr-2' }], nextToken: null });
      }
      return Promise.resolve({ data: [], nextToken: null });
    });

    const impact = await getPlayerImpact('player-1');
    expect(impact.playTimeRecordCount).toBe(2);
  });

  it('should count goals where player is the scorer', async () => {
    mockList.mockImplementation((opts?: any) => {
      if (opts?.filter?.scorerId?.eq === 'player-1') {
        return Promise.resolve({ data: [{ id: 'goal-1' }], nextToken: null });
      }
      return Promise.resolve({ data: [], nextToken: null });
    });

    const impact = await getPlayerImpact('player-1');
    expect(impact.goalCount).toBe(1);
  });

  it('should count game notes for the player', async () => {
    mockList.mockImplementation((opts?: any) => {
      if (opts?.filter?.playerId?.eq === 'player-1') {
        return Promise.resolve({ data: [{ id: 'note-1' }, { id: 'note-2' }, { id: 'note-3' }], nextToken: null });
      }
      return Promise.resolve({ data: [], nextToken: null });
    });

    const impact = await getPlayerImpact('player-1');
    expect(impact.noteCount).toBe(3);
  });

  it('should count all history types simultaneously', async () => {
    mockList.mockImplementation((opts?: any) => {
      if (opts?.filter?.playerId?.eq === 'player-all') {
        return Promise.resolve({ data: [{ id: 'r1' }, { id: 'r2' }], nextToken: null });
      }
      if (opts?.filter?.scorerId?.eq === 'player-all') {
        return Promise.resolve({ data: [{ id: 'g1' }], nextToken: null });
      }
      return Promise.resolve({ data: [], nextToken: null });
    });

    const impact = await getPlayerImpact('player-all');
    // play-time and notes share the playerId filter → 2 each
    expect(impact.playTimeRecordCount).toBe(2);
    expect(impact.noteCount).toBe(2);
    expect(impact.goalCount).toBe(1);
  });

  it('should always return rosterCount as 0 (caller responsibility)', async () => {
    const impact = await getPlayerImpact('player-1');
    expect(impact.rosterCount).toBe(0);
  });
});
```

Also update the `import` line at the top to include `getPlayerImpact`:
```typescript
import {
  deleteGameCascade,
  deleteTeamCascade,
  deletePlayerCascade,
  deleteFormationCascade,
  getPlayerImpact,         // ← add
} from './cascadeDeleteService';
```

---

### 4. `src/components/Management.test.tsx`

Update the `cascadeDeleteService` mock to include `getPlayerImpact`:

```typescript
vi.mock('../services/cascadeDeleteService', () => ({
  deleteTeamCascade: vi.fn(),
  deletePlayerCascade: vi.fn(),
  deleteFormationCascade: vi.fn(),
  getPlayerImpact: vi.fn().mockResolvedValue({   // ← add
    rosterCount: 0,
    playTimeRecordCount: 0,
    goalCount: 0,
    noteCount: 0,
  }),
}));
```

No existing test scenarios are broken by this addition.

---

### 5. `e2e/helpers.ts` — No changes required

The cleanup order (Teams → Players → Formations) already satisfies the safe-delete
constraints:

| Stage | State by the time it runs |
|---|---|
| Delete Teams | Cascade removes all Games, TeamRosters, GameNotes, PlayTimeRecords, Goals |
| Delete Players | `getPlayerImpact` returns all zeros → plain danger confirm appears |
| Delete Formations | `teams.filter(t => t.formationId === id)` is empty → block never fires |

`handleConfirmDialog` auto-clicks whatever `.confirm-btn--confirm` appears
(danger or warning variant) — no change needed.

---

### 6. `e2e/formation-management.spec.ts` — No changes required

The test creates formations without linking teams to them, so the block guard
never fires.

---

### 7. `e2e/player-management.spec.ts` — No changes required

The test's player deletions either use `handleConfirmDialog` (which auto-confirms
any modal variant) or explicitly calls `clickConfirmModalConfirm` after a swipe —
both paths handle the warning modal correctly.

---

## Data Model / API Impact

| Model | Change |
|---|---|
| Formation | No schema change. Guard is application-layer only. |
| Player | No schema change. `getPlayerImpact` is a read-only aggregation. |
| Team | No schema change. `formationId` FK reference remains optional. |

---

## Dependencies and Sequencing

```
1. cascadeDeleteService.ts     — Add getPlayerImpact + PlayerImpact
2. cascadeDeleteService.test.ts — Add getPlayerImpact test suite
3. Management.tsx              — Import getPlayerImpact; rewrite handleDeleteFormation;
                                  rewrite handleDeletePlayer; add variant param to confirmAndDelete
4. Management.test.tsx         — Update cascadeDeleteService mock
```

Steps 1 and 2 can be implemented together.  
Steps 3 and 4 must follow step 1 (import dependency).

---

## Risk & Edge Cases

| Risk | Mitigation |
|---|---|
| Stale `teams` state during formation guard | `useAmplifyQuery` subscribes to real-time Amplify updates; by the time the user clicks delete the list reflects current state. Acceptable risk — edge case only affects co-coach concurrent edits. |
| `getPlayerImpact` latency adds UX delay | Queries are parallel (`Promise.all`) and filter by a single indexed ID. Sub-50 ms on warm DynamoDB. No spinner needed. |
| `handleDeleteFormation` now async — existing `void` JSX call | Async handlers called without `await` in JSX `onClick` are already the pattern throughout the component (`handleCreateTeam`, etc.). No regression. |
| Warning confirm modal breaks e2e `clickConfirmModalCancel` test in `player-management.spec.ts` | That test deletes a freshly-created player with no rosters/history → `totalImpact === 0` → plain danger modal appears. No regression. |
| `confirmAndDelete` variant param (Option A) is additive / backward-compatible | Defaults to `'danger'` when `variant` is omitted. All existing call-sites are unaffected. |
| `goalsAsAssist` not counted in impact (design choice) | Assist goals are not deleted; they are patched (`assistId = null`). Counting them as "impact" would mislead the user — data is preserved, not lost. This is intentional. |

---

## Test Strategy

| Layer | What to test |
|---|---|
| Unit — `cascadeDeleteService.test.ts` | `getPlayerImpact` returns correct counts for each model type and all zeros when no records exist |
| Unit — `Management.test.tsx` (new tests) | Formation delete blocked when team uses it; `showError` called with team name; Formation delete proceeds when no team uses it; Player delete shows warning when impact > 0; Player delete uses danger variant when impact === 0 |
| E2E — existing suites | Run as-is; cleanup order guarantees no guard fires during test teardown |
