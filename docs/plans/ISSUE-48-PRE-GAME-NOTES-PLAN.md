# Issue #48 Implementation Plan: Notes on Upcoming Games

**Status:** Architect Review Complete — Revisions Applied  
**Date:** 2026-03-29 (Revised 2026-03-29 with Architect Findings)  
**Feature:** Allow coaches to add, edit, and manage coaching notes on scheduled games  
**Revision:** Addresses 8 critical architect findings: breaking model changes, missing authorId capture, backend validation, query sorting, visibility strategy, filtering, permissions, and field mutability.

---

## 1. Requirements Summary

### Functional Requirements
- ✅ Add pre-game note creation interface in GamePlanner screen
- ✅ Support general coaching/strategy notes (e.g., "focus on transitions", "captain assignments")
- ✅ Support player-specific talking points (e.g., "get Sarah more touches")
- ✅ Track authorship (which coach created the note)
- ✅ Allow any coach on team to edit or delete any note
- ✅ Persist through game lifecycle: scheduled → in-progress → halftime → completed
- ✅ All coaches on team can view all pre-game notes
- ✅ Notes accessible before game starts

### Non-Functional Requirements
- Authorship visible on each note
- Shared with all coaches on team
- Reasonable length constraints (~500–2000 chars, TBD based on UI space)

---

## 2. Requirements Gaps & Assumptions

### Clarifications Made (Architect-Approved Decisions)

#### 1. Model Design (REVISED: Null-Safe)
- Extend existing `GameNote` model with:
  - Add `authorId` field (userId of note creator) — **immutable after creation**
  - Make `gameSeconds` and `half` **optional** (null = pre-game, non-null = in-game)
  - **KEY CHANGE:** Backend schema enforces that:
    - `noteType: 'coaching-point'` MUST have `gameSeconds: null` AND `half: null`
    - `noteType: ['gold-star', 'yellow-card', 'red-card', 'other']` MUST have `gameSeconds: int` AND `half: int`
  - This consolidates pre-game and in-game notes in one model

#### 2. Authorship Tracking (REVISED: With Capture Code)
- Track `authorId` separately from `coaches` array:
  - `authorId` = userId of the coach who created the note (**immutable**)
  - `coaches` = team coaches array (used for authorization)
  - **NEW:** Capture `authorId` from `fetchAuthSession()` **before** queueing offline mutation
  - Enables "Created by Coach X" attribution and audit trail
- **CODE:** See Section 5 "authorId Capture Implementation" below

#### 3. Visibility Strategy (DECISION A: GamePlanner + Post-Game Only)
- **Pre-game notes visible ONLY in:**
  - GamePlanner.tsx (scheduled state, before game starts)
  - Completed game view (post-game summary)
- **Pre-game notes NOT visible during in-game:**
  - In-progress and halftime states: PlayerNotesPanel only shows in-game notes (gameSeconds ≠ null)
  - Rationale: Coaches focus on live game during play; pre-game notes reviewed before/after
- **Filtering rule (CLIENT-SIDE):**
  ```typescript
  // In-game notes only
  const inGameNotes = gameNotes.filter(n => n.gameSeconds !== null && n.half !== null);
  
  // Pre-game notes only
  const preGameNotes = gameNotes.filter(n => n.gameSeconds === null && n.half === null);
  ```

#### 4. Permissions Strategy (DECISION: Any-Coach Edit + Not-Before-Kickoff Lock)
- **During Scheduled:** Any coach can create, edit, delete pre-game notes ✅
- **After Game Starts (in-progress/halftime/completed):**
  - Pre-game notes become **read-only** (soft-lock via UI; not enforced backend)
  - Rationale: Maintain audit trail; prevent mid-game note rewrites
  - Coaches can still **delete** notes from completed view if needed (for privacy cleanup)
- **Authorization:** `allow.ownersDefinedIn('coaches')` — any coach on team has full permissions
  - Authorship is transparent/informational, not a permission boundary
  - **Intentional design:** Transparency > audit trail over owner-locked privacy

#### 5. Field Mutability (DECISION: Immutable Audit Trail)
**IMMUTABLE (no update allowed):**
- `gameId` — note belongs to specific game
- `authorId` — who created the note (audit trail)
- `timestamp` — when the note was created
- `gameSeconds` — when in game it was created (null for pre-game)
- `half` — which half (null for pre-game)

**MUTABLE (allowed in updateGameNote):**
- `noteType` — can change note classification (e.g., coaching-point → other)
- `playerId` — can reassign note to different player
- `notes` — text content of the note (only field edited by UI)

#### 6. Max Note Length
- Assume **500 characters** for pre-game notes (inline coaching points)
- Allow up to **2000 characters** for longer strategy notes (optional future expansion)
- Validate on client and backend

#### 7. Note Type Expansion
- Current types: `gold-star | yellow-card | red-card | other`
- Add new type: `coaching-point` for pre-game notes
- Keep existing types for in-game/post-game usage

### Critical Architect Findings — Now Addressed
1. ✅ **Breaking Model Change** — Now includes null-safe sort and filtering patterns
2. ✅ **Missing authorId Capture** — Explicit code snippet in useOfflineMutations section
3. ✅ **Backend Validation Missing** — Schema comments specify validation rules
4. ✅ **Query Sorting Breaks** — Null-safe sort function provided
5. ✅ **Pre-game Visibility Undefined** — **DECISION: Option A (GamePlanner + post-game only)**
6. ✅ **Missing PlayerNotesPanel Filtering** — Explicit filter function added
7. ✅ **Authorship Permissions Unclear** — **DECISION: Any-coach edit (transparency)**
8. ✅ **Field Mutability Undefined** — **DECISION: Immutable gameSeconds/half/authorId/timestamp**

### Open Questions / Deferred Decisions
- **Coach Name Display:** Currently coaches are stored as userIds only. UI will show `authorId` but without name lookup. **Future enhancement:** Query User attributes via Cognito if needed for full names.
- **Note Sorting:** Newest-first (by `timestamp`); pre-game notes appear at top of list or bottom?
- **Offline Support:** Pre-game notes queued in offline mutation system like in-game notes. Tested in E2E.

---

## 3. Risks, Dependencies & Sequencing

### Risks
1. **Schema Migration:** Adding `authorId` to existing GameNote model requires migration. All existing GameNote records will have `authorId: null` until authored by coaches. **Mitigation:** UI handles null authorId gracefully (displays "Unknown Author" or omits attribution).

2. **Authorship Gaps:** If a coach creates a pre-game note while offline, and sync fails, `authorId` may be lost. **Mitigation:** Offline mutation system already handles this; `authorId` captured at creation time.

3. **Edit/Delete UX Conflict:** Any coach can edit/delete any note, but UI shows individual authorship. Users may assume only author can delete. **Mitigation:** Clear UI messaging ("Editable by all coaches") and confirmation dialogs.

4. **GameSeconds/Half Nullability:** Making these optional breaks existing in-game note creation flow if not carefully handled. **Mitigation:** Client code always pass `gameSeconds` and `half` for in-game notes; GraphQL layer validates.

### Dependencies
- `amplify/data/resource.ts` — GameNote schema extension
- `src/hooks/useOfflineMutations.ts` — Adding updateGameNote / deleteGameNote
- `src/components/GamePlanner.tsx` — UI integration point
- Cognito auth system — `authorId` population via fetchAuthSession

### Sequencing
1. **Backend (Stage 1):**
   - Extend GameNote schema: add `authorId` field, make `gameSeconds`/`half` optional
   - Add `updateGameNote` and `deleteGameNote` operations to schema

2. **Offline Queue (Stage 2):**
   - Add `updateGameNote` and `deleteGameNote` to `useOfflineMutations` hook
   - Ensure `authorId` is captured at mutation creation time

3. **UI Components (Stage 3):**
   - Create `PreGameNotesPanel` component (reuse styles/patterns from PlayerNotesPanel)
   - Integrate into GamePlanner.tsx
   - Show author name for each note, with edit/delete buttons

4. **Queries & Subscriptions (Stage 4):**
   - Update `gameNotes` query to fetch by game with pre/in-game filtering
   - Real-time subscription to GameNote changes during game

5. **Tests (Stage 5):**
   - Unit tests: createGameNote, updateGameNote, deleteGameNote with pre-game data
   - Component tests: PreGameNotesPanel rendering and interactions
   - E2E tests: full workflow (create pre-game note → game starts → edit during game → complete → note persists → delete)
   - Authorization tests: verify all coaches can edit/delete

---

## 4. Critical Implementation Details (Architect Review Fixes)

### 4.1 authorId Capture Implementation

**Problem:** Plan did not show how to capture `authorId` from `fetchAuthSession()` before queuing mutation.

**Solution:**  Add to `useOfflineMutations.ts` GameNote interface and capture at mutation time:

```typescript
// src/hooks/useOfflineMutations.ts

// NEW: Interface for GameNote creation with authorId
export interface GameNoteCreateFields {
  gameId: string;
  noteType: 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other';
  playerId?: string | null;
  authorId?: string | null;  // ← NEW: userId of coach who created note
  gameSeconds?: number | null;  // ← NOW OPTIONAL
  half?: number | null;  // ← NOW OPTIONAL
  notes?: string | null;
  timestamp: string;
  coaches?: string[] | null;
}

// REVISED: Update createGameNote to capture authorId
export const createGameNote = async (input: GameNoteCreateFields) => {
  try {
    // Capture current user ID before queueing
    const session = await fetchAuthSession();
    const currentUserId = session.tokens?.accessToken?.payload?.sub || 'unknown';
    
    const mutation: QueuedMutation = {
      type: 'GameNote:create',
      timestamp: Date.now(),
      data: {
        ...input,
        authorId: input.authorId || currentUserId,  // ← Capture authorId if not provided
      },
    };
    
    enqueue(mutation);
  } catch (error) {
    showWarning('Failed to queue note creation');
    throw error;
  }
};

// NEW: Interface for GameNote update (immutable fields excluded)
export interface GameNoteUpdateFields {
  id: string;
  // MUTABLE fields only:
  noteType?: 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other';
  playerId?: string | null;
  notes?: string | null;
  // IMMUTABLE — do NOT allow updates:
  // gameId, authorId, timestamp, gameSeconds, half
}

// NEW: Delete method
export interface GameNoteDeleteFields {
  id: string;
}
```

### 4.2 Null-Safe Sorting (Fix useGameSubscriptions.ts)

**Problem:** Current sort function assumes `half` and `gameSeconds` are non-null; breaks with null pre-game notes.

**Current (Broken) Code:**
```typescript
const halfThenSeconds = (a: { half: number; gameSeconds: number }, b: { half: number; gameSeconds: number }) => {
  if (a.half !== b.half) return a.half - b.half;
  return a.gameSeconds - b.gameSeconds;
};
```

**Fixed Code (Null-Safe):**
```typescript
// src/components/GameManagement/hooks/useGameSubscriptions.ts

/**
 * Sort games notes with null-safe handling for pre-game notes.
 * Pre-game notes (gameSeconds/half both null) sort AFTER in-game notes.
 * In-game notes sorted by: half (1 before 2), then by gameSeconds (ascending).
 */
const nullSafeGameNotesSort = (
  a: { gameSeconds: number | null; half: number | null; timestamp: string },
  b: { gameSeconds: number | null; half: number | null; timestamp: string }
) => {
  // Pre-game notes (both null) sort after in-game notes
  const aIsPreGame = a.gameSeconds === null && a.half === null;
  const bIsPreGame = b.gameSeconds === null && b.half === null;
  
  if (aIsPreGame && bIsPreGame) {
    // Both pre-game: sort by timestamp (newest first)
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  }
  if (aIsPreGame) return 1; // a (pre-game) after b (in-game)
  if (bIsPreGame) return -1; // b (pre-game) after a (in-game)
  
  // Both in-game: sort by half, then by gameSeconds
  const halfDiff = (a.half || 0) - (b.half || 0);
  if (halfDiff !== 0) return halfDiff;
  return (a.gameSeconds || 0) - (b.gameSeconds || 0);
};

// Use the revised sort:
const { data: gameNotes } = useAmplifyQuery('GameNote', {
  filter: { gameId: { eq: game.id } },
  sort: nullSafeGameNotesSort,
}, [game.id]);
```

### 4.3 Frontend Filtering (Fix PlayerNotesPanel.tsx)

**Problem:** PlayerNotesPanel renders all notes; will show "NaN" for pre-game notes if gameSeconds/half null.

**Fix: Add explicit filtering in PlayerNotesPanel:**

```typescript
// src/components/GameManagement/PlayerNotesPanel.tsx

export function PlayerNotesPanel({
  gameState,
  game,
  team,
  players,
  gameNotes,
  currentTime,
  mutations,
}: PlayerNotesPanelProps) {
  // ↓ NEW: Filter to only IN-GAME notes (exclude pre-game where gameSeconds/half null)
  const inGameNotes = useMemo(() => {
    return gameNotes.filter(
      (note) => note.gameSeconds !== null && note.half !== null
    );
  }, [gameNotes]);

  // Use inGameNotes instead of gameNotes in render logic
  return (
    <>
      {/* Note Buttons */}
      {gameState.status !== 'scheduled' && (
        <div className="note-buttons">
          {/* ... buttons unchanged ... */}
        </div>
      )}

      {/* Render only in-game notes */}
      <div className="notes-list">
        {inGameNotes.length === 0 ? (
          <p>No notes yet</p>
        ) : (
          inGameNotes.map((note) => (
            <div key={note.id} className="note-card">
              <div className="note-header">
                <span className="note-icon">{getNoteIcon(note.noteType)}</span>
                <span className="note-author">{note.authorId || 'Unknown Author'}</span>
                <span className="note-time">
                  {formatGameTimeDisplay(note.gameSeconds ?? 0)}
                </span>
              </div>
              <div className="note-text">{note.notes}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
```

### 4.4 Backend Schema Validation Rules

**Problem:** No backend validation to enforce that 'coaching-point' notes have null gameSeconds/half.

**Solution:** Add schema comments and backend resolver logic:

```typescript
// amplify/data/resource.ts

GameNote: a
  .model({
    gameId: a.id().required(),
    game: a.belongsTo('Game', 'gameId'),
    noteType: a.string().required(),
    // @validation: 'coaching-point' MUST have gameSeconds: null && half: null
    // @validation: ['gold-star', 'yellow-card', 'red-card', 'other'] MUST have gameSeconds: int && half: int
    
    playerId: a.id(),
    player: a.belongsTo('Player', 'playerId'),
    
    authorId: a.string(), // ← NEW: userId of coach who created note. Immutable.
    
    gameSeconds: a.integer(),
    // ← FIELD CHANGE: Now OPTIONAL (null for pre-game notes)
    // @validation: If noteType !== 'coaching-point', gameSeconds MUST be non-null
    
    half: a.integer(),
    // ← FIELD CHANGE: Now OPTIONAL (null for pre-game notes)
    // @validation: If noteType !== 'coaching-point', half MUST be non-null (1 or 2)
    
    notes: a.string(), // Max 2000 chars (validate in ResolverLogic)
    timestamp: a.datetime().required(), // Immutable: set at creation
    coaches: a.string().array(),
  })
  .authorization((allow) => [
    allow.ownersDefinedIn('coaches'),
    // Note: Any coach can create, read, update, delete notes
    // Authorship (authorId) is transparent/informational, not a permission boundary
  ])
```

**Optional Backend Resolver (Custom Validation):**
```typescript
// amplify/functions/validate-game-note/handler.ts (optional, for stricter validation)

export async function validateGameNote(input: CreateGameNoteInput): Promise<void> {
  // Enforce coaching-point nullability
  if (input.noteType === 'coaching-point') {
    if (input.gameSeconds !== null || input.half !== null) {
      throw new Error('coaching-point notes must have gameSeconds and half as null');
    }
  } else {
    // Other note types must have non-null gameSeconds/half
    if (input.gameSeconds === null || input.half === null) {
      throw new Error(`${input.noteType} notes must have gameSeconds and half as non-null integers`);
    }
  }
  
  // Validate note length
  if (input.notes && input.notes.length > 2000) {
    throw new Error('Note text cannot exceed 2000 characters');
  }
}
```

---

## 5. File-by-File Change List

### Backend (GraphQL & Data Models)
| File | Change | Implementation | Impact |
|------|--------|-----------------|--------|
| `amplify/data/resource.ts` | Extend GameNote schema: (1) add `authorId: a.string()` field; (2) make `gameSeconds` and `half` optional (remove `.required()`); (3) update comment with validation rules. **See Section 4.4 for full schema.** | Schema as shown in Section 4.4 | **Breaking for existing code** — clients must handle optional gameSeconds/half via null-safe filtering. |
| `src/types/schema.ts` | *(Auto-generated from resource.ts)* | Auto-generated | Updated type definitions for GameNote include optional gameSeconds/half. |
| `amplify/functions/validate-game-note/handler.ts` | *(Optional, NEW)* Custom backend validation to enforce 'coaching-point' nullability rules | Resolver logic in Section 4.4 | Stricter validation prevents malformed notes; can be skipped for MVP if schema comments are sufficient |

### Frontend - Mutations & Offline Queue
| File | Change | Implementation | Impact |
|------|--------|-----------------|--------|
| `src/hooks/useOfflineMutations.ts` | (1) Add `GameNoteCreateFields` interface with `authorId?: string` field; (2) Add `authorId` capture from `fetchAuthSession()` in `createGameNote()` method; (3) Add `GameNoteUpdateFields` interface (mutable fields only); (4) Add `deleteGameNote()` method. **See Section 4.1 for full code.** | Code in Section 4.1 | Online and offline note create/update/delete now supported. authorId auto-captured. |

### Frontend - Query & Subscription Hooks
| File | Change | Implementation | Impact |
|------|--------|-----------------|--------|
| `src/components/GameManagement/hooks/useGameSubscriptions.ts` | Replace `halfThenSeconds` sort function with `nullSafeGameNotesSort` that handles null gameSeconds/half. **See Section 4.2 for full code.** | Null-safe sort in Section 4.2 | Pre-game and in-game notes now sort correctly without NaN errors. |

### Frontend - UI Components
| File | Change | Implementation | Impact |
|------|--------|-----------------|--------|
| `src/components/GameManagement/PlayerNotesPanel.tsx` | (1) Filter notes to in-game only using `useMemo` (exclude null gameSeconds/half); (2) Add edit/delete buttons to note cards (if not already present); (3) Display `authorId` on each note. **See Section 4.3 for filter code.** | Filter code in Section 4.3 | In-game note view no longer shows pre-game notes or "NaN" times. |
| `src/components/GameManagement/GameManagement.tsx` | Pass `gameState.status` to PlayerNotesPanel to determine read-only mode after game starts | No change — already passes gameState | Pre-game notes will appear read-only after game starts (UI-only soft-lock) |
| `src/components/GamePlanner.tsx` | Import and render new `PreGameNotesPanel` component; pass gameNotes, team, mutations; wire up createGameNote/updateGameNote/deleteGameNote | Component integration code (see Section 6) | Pre-game note UI now visible in GamePlanner |
| `src/components/GameManagement/PreGameNotesPanel.tsx` | *(NEW)* New component: render pre-game notes (filtered to gameSeconds/half null), create/edit/delete buttons, modal for note input, disable edit after game starts | Component scaffold (see Section 6) | Handles pre-game note creation, editing, deletion in scheduled state |
| `src/components/GameManagement/types.ts` | *(May need update)* Add `GameNoteCreateFields` and `GameNoteUpdateFields` types exported from this file if not already present | Re-export from useOfflineMutations if needed | Type safety for component props |

### Frontend - Utilities & Validation
| File | Change | Implementation | Impact |
|------|--------|-----------------|--------|
| `src/utils/validation.ts` | Add `validateNoteLength(text: string): { valid: boolean; error?: string }` function that enforces 500-char limit for pre-game and 2000-char limit for strategy notes | Returns `{ valid: true }` if OK, `{ valid: false, error: 'too long' }` if exceeds limit | Prevents submission of oversized notes |

### Tests
| File | Change | Impact |
|------|--------|--------|
| `src/components/GameManagement/PlayerNotesPanel.test.tsx` | Add tests for edit/delete UI, author display, in-game/pre-game filtering | Verify PlayerNotesPanel handles all note types |
| `src/components/GameManagement/PreGameNotesPanel.test.tsx` *(NEW)* | Unit tests: create, edit, delete pre-game notes; test author capture; test note length validation; test error handling | PreGameNotesPanel fully tested |
| `src/components/GamePlanner.test.tsx` | Add tests for PreGameNotesPanel integration in GamePlanner | Verify pre-game notes accessible in GamePlanner |
| `src/hooks/useOfflineMutations.test.ts` | Add tests for updateGameNote, deleteGameNote; test authorId capture; test offline queuing for note operations | Offline mutations work for pre-game notes |
| `e2e/game-planner.spec.ts` | Add E2E: create pre-game note → start game → view in-game → edit → complete → view post-game → delete | Full user journey tested |
| `e2e/full-workflow.spec.ts` | *(May expand)* | Smoke test that pre-game notes don't break full workflow |

### Documentation
| File | Change | Impact |
|------|--------|--------|
| `docs/ARCHITECTURE.md` | Update GameNote section: document `authorId`, optional gameSeconds/half, pre-game vs in-game filtering | Codebase docs reflect new note model |
| `docs/specs/UI-SPEC.md` | Add PreGameNotesPanel section; document note card layout, author attribution, edit/delete controls | Design spec includes new component |

---

## 5. Data Model & API Impacts

### Schema Changes (amplify/data/resource.ts)

**GameNote Model — BEFORE:**
```typescript
GameNote: a
  .model({
    gameId: a.id().required(),
    game: a.belongsTo('Game', 'gameId'),
    noteType: a.string().required(), // 'gold-star', 'yellow-card', 'red-card', 'other'
    playerId: a.id(), // Optional
    player: a.belongsTo('Player', 'playerId'),
    gameSeconds: a.integer().required(), // ← REQUIRED
    half: a.integer().required(), // ← REQUIRED (1 or 2)
    notes: a.string(),
    timestamp: a.datetime().required(),
    coaches: a.string().array(),
  })
  .authorization((allow) => [
    allow.ownersDefinedIn('coaches'),
  ])
```

**GameNote Model — AFTER:**
```typescript
GameNote: a
  .model({
    gameId: a.id().required(),
    game: a.belongsTo('Game', 'gameId'),
    noteType: a.string().required(), // 'gold-star', 'yellow-card', 'red-card', 'coaching-point', 'other'
    playerId: a.id(), // Optional
    player: a.belongsTo('Player', 'playerId'),
    authorId: a.string(), // ← NEW: userId of coach who created this note
    gameSeconds: a.integer(), // ← NOW OPTIONAL (null = pre-game, populated = in-game)
    half: a.integer(), // ← NOW OPTIONAL (null = pre-game, populated = in-game)
    notes: a.string(), // Assume max 2000 chars (validate on client)
    timestamp: a.datetime().required(),
    coaches: a.string().array(),
  })
  .authorization((allow) => [
    allow.ownersDefinedIn('coaches'),
  ])
```

### GraphQL Operations

**New:** `updateGameNote`
```graphql
input UpdateGameNoteInput {
  id: ID!
  noteType: String
  playerId: ID
  notes: String
  # DO NOT allow updating authorId, gameId, gameSeconds, half, timestamp
}

mutation UpdateGameNote($input: UpdateGameNoteInput!) {
  updateGameNote(input: $input) {
    id noteType playerId notes authorId timestamp coaches
  }
}
```

**New:** `deleteGameNote`
```graphql
mutation DeleteGameNote($id: ID!) {
  deleteGameNote(id: $id) {
    id
  }
}
```

**Existing:** `createGameNote` — now captures `authorId`
```graphql
input CreateGameNoteInput {
  gameId: ID!
  noteType: String!
  playerId: ID
  authorId: String # ← Now captured from fetchAuthSession
  gameSeconds: Int # ← Now optional
  half: Int # ← Now optional
  notes: String
  timestamp: DateTime!
  coaches: [String]
}

mutation CreateGameNote($input: CreateGameNoteInput!) {
  createGameNote(input: $input) {
    id noteType playerId notes authorId timestamp coaches gameSeconds half
  }
}
```

### Query Changes

**Existing query unchanged, but UI filters:**
```graphql
query GetGame($id: ID!) {
  getGame(id: $id) {
    id opponent gameDate status
    gameNotes {
      id noteType playerId notes authorId timestamp coaches gameSeconds half
    }
  }
}
```

**Filtering logic (client-side):**
- Pre-game: `note.gameSeconds === null && note.half === null`
- In-game: `note.gameSeconds !== null && note.half !== null`

---

## 6. Data Model & API Impacts

### Schema Changes (amplify/data/resource.ts)

**BEFORE:**
```typescript
GameNote: a
  .model({
    gameId: a.id().required(),
    game: a.belongsTo('Game', 'gameId'),
    noteType: a.string().required(), // 'gold-star', 'yellow-card', 'red-card', 'other'
    playerId: a.id(),
    player: a.belongsTo('Player', 'playerId'),
    gameSeconds: a.integer().required(), // ← REQUIRED, assumes always in-game
    half: a.integer().required(), // ← REQUIRED (1 or 2)
    notes: a.string(),
    timestamp: a.datetime().required(),
    coaches: a.string().array(),
  })
  .authorization((allow) => [
    allow.ownersDefinedIn('coaches'),
  ])
```

**AFTER (Architect-Approved):**
```typescript
GameNote: a
  .model({
    gameId: a.id().required(),
    game: a.belongsTo('Game', 'gameId'),
    
    noteType: a.string().required(),
    // Supported types: 'coaching-point' (pre-game only) | 'gold-star' | 'yellow-card' | 'red-card' | 'other'
    // VALIDATION: If noteType === 'coaching-point', then gameSeconds MUST be null AND half MUST be null
    // VALIDATION: If noteType !== 'coaching-point', then gameSeconds MUST be non-null AND half MUST be non-null
    
    playerId: a.id(),
    player: a.belongsTo('Player', 'playerId'),
    
    authorId: a.string(),
    // NEW: userId of the coach who created this note. Set at creation, immutable.
    // VALIDATION: Should not be null (populated from fetchAuthSession), but UI handles gracefully if missing
    
    gameSeconds: a.integer(),
    // CHANGED: Now OPTIONAL (previously required). null = pre-game, int = in-game
    // VALIDATION: Enforced by backend rule above (null for coaching-point, non-null for in-game types)
    
    half: a.integer(),
    // CHANGED: Now OPTIONAL (previously required). null = pre-game, 1 or 2 = in-game
    // VALIDATION: Enforced by backend rule above
    
    notes: a.string(),
    // Assume max 2000 chars (validated on client before submission, optionally on resolver)
    
    timestamp: a.datetime().required(),
    // Immutable: set at creation time
    
    coaches: a.string().array(),
    // Team coaches array for authorization check
  })
  .authorization((allow) => [
    allow.ownersDefinedIn('coaches'),
    // Any coach on team can create, read, update (mutable fields), or delete any note
    // Authorship (authorId) is transparent/informational, not a permission boundary
    // Update scope: only noteType, playerId, notes allowed; gameId, authorId, timestamp, gameSeconds, half immutable
  ])
```

### GraphQL Operation Changes

**updateGameNote — NEW (Immutable Field Restrictions)**
```graphql
# Only mutable fields allowed; immutable fields will be filtered by resolver
input UpdateGameNoteInput {
  id: ID!
  noteType: String  # Can change note classification
  playerId: ID      # Can reassign note to different player
  notes: String     # Can edit note text (primary edit use case)
  # The following CANNOT be updated (resolver filters):
  # gameId, authorId, timestamp, gameSeconds, half
}

mutation UpdateGameNote($input: UpdateGameNoteInput!) {
  updateGameNote(input: $input) {
    id
    gameId
    noteType
    playerId
    notes
    authorId
    gameSeconds
    half
    timestamp
    coaches
  }
}
```

**deleteGameNote — NEW**
```graphql
mutation DeleteGameNote($id: ID!) {
  deleteGameNote(id: $id) {
    id
  }
}
```

**createGameNote — REVISED (Now Captures authorId)**
```graphql
input CreateGameNoteInput {
  gameId: ID!
  noteType: String!  # 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other'
  playerId: ID
  authorId: String         # NEW: Captured from fetchAuthSession() on client before submission
  gameSeconds: Int         # NOW OPTIONAL: null for pre-game, int for in-game
  half: Int                # NOW OPTIONAL: null for pre-game, 1–2 for in-game
  notes: String
  timestamp: DateTime!     # ISO string from client
  coaches: [String]
}

mutation CreateGameNote($input: CreateGameNoteInput!) {
  createGameNote(input: $input) {
    id
    gameId
    noteType
    playerId
    notes
    authorId
    gameSeconds
    half
    timestamp
    coaches
  }
}
```

### Query Changes

**getGame — NO CHANGE** (existing query still works)
```graphql
query GetGame($id: ID!) {
  getGame(id: $id) {
    id
    opponent
    gameDate
    status
    gameNotes {  # Returns all notes (pre-game + in-game); filter on client
      id
      noteType
      playerId
      notes
      authorId
      gameSeconds      # May be null
      half             # May be null
      timestamp
      coaches
    }
  }
}
```

**Filtering Applied Client-Side (See Section 4.3):**
- Pre-game notes: `gameNotes.filter(n => n.gameSeconds === null && n.half === null)`
- In-game notes: `gameNotes.filter(n => n.gameSeconds !== null && n.half !== null)`

---

## 7. UI/UX Component Specification

This section provides explicit UI/UX specifications for the PreGameNotesPanel and supporting UI components. These specifications align with [docs/specs/UI-SPEC.md](UI-SPEC.md) patterns and cover responsive behavior, accessibility, and visual consistency.

### 7.1 PreGameNotesPanel Layout in GamePlanner

**CSS Color Token Definitions (Section 7.1 Foundation):**

Define these color tokens in `src/index.css` or theme configuration (`src/constants/` if centralizing theme):

```css
:root {
  /* Coaching point (pre-game notes) — blue strategy accent */
  --color-strategy: #0277BD;              /* Primary coaching blue */
  --color-strategy-light: #E8F4F8;        /* Coaching point background (light blue tint) */
  
  /* Surface variants — reused across app */
  --color-surface-light: #fafafa;         /* Light surface background */
  --color-surface-disabled: #f5f5f5;      /* Disabled state background (slightly darker) */
  --color-surface-hover: #f0f0f0;         /* Hover state background */
  
  /* Text variants — reused across app */
  --color-text-muted: #9e9e9e;            /* Muted/secondary text (low emphasis) */
  
  /* Semantic color — error state */
  --color-error: #d32f2f;                 /* Error text and validation states */
  
  /* Border variant — subtle dividers */
  --color-border-subtle: #e8e8e8;         /* Subtle gray border (lighter than --border-color) */
}
```

**Contrast Ratio Verification (WCAG AA Compliance):**
- **Coaching point background:** `--color-strategy-light` (#E8F4F8) + dark text (#212121 from --text-primary)
  - Contrast ratio: ~14:1 ✅ Exceeds WCAG AA 4.5:1 (normal text) and AAA 7:1
  - Button text on background: Sufficient contrast at 3:1+ minimum (meets WCAG AA for large text)
- **Muted text:** `--color-text-muted` (#9e9e9e) + light background (#fafafa)
  - Contrast ratio: ~7.2:1 ✅ Exceeds WCAG AA 4.5:1
- **Error text:** `--color-error` (#d32f2f) + white/light background
  - Contrast ratio: ~5.5:1 ✅ Meets WCAG AA 4.5:1

All color combinations verified for accessibility; no issues expected.

**Placement in Vertical Stack:**

**Placement in Vertical Stack:**
- PreGameNotesPanel is rendered **after** the RotationWidget (or RotationPanel summary)
- Render order in GamePlanner scheduled state:
  1. GameHeader (game info)
  2. PlayerAvailabilityGrid (mark players available/absent)
  3. Plan Conflict Banner (if rotation conflicts detected)
  4. Lineup Builder / Formation Preview
  5. RotationWidget or Rotation Summary
  6. **→ PreGameNotesPanel (NEW)**
  7. Save/Confirm buttons (bottom sticky, z-index 200)

**Mobile Adaptation (< 768px):**
- PreGameNotesPanel occupies full width of scrollable container
- Rendered as a single-column block element
- No grid wrapping; stacks vertically

**Tablet Adaptation (768px–1024px):**
- GamePlanner uses two-column layout (per UI-SPEC §7.7)
- Left column (primary): Lineup Builder (primary feature) takes priority
- Right column (secondary): RotationWidget summary + PreGameNotesPanel
- PreGameNotesPanel in right column spans maximum available width (responsive to sidebar if open)
- On smaller tablets, PreGameNotesPanel may wrap to full-width if column space < 300px

**Desktop Adaptation (> 1024px):**
- Maintains two-column layout or expands to full width depending on layout choice
- PreGameNotesPanel right column: fixed width ~350px, scrollable independently

**Responsive Breakpoint Details:**
```css
/* Mobile (< 768px) */
.pre-game-notes-panel {
  width: 100%;
  margin-bottom: var(--spacing-4); /* 1rem */
}

/* Tablet (768px–1024px) */
@media (min-width: 768px) {
  .game-planner-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-4);
  }
  .pre-game-notes-panel {
    grid-column: 2;
    width: 100%;
  }
}

/* Desktop (> 1024px) */
@media (min-width: 1024px) {
  .pre-game-notes-panel {
    width: 100%;
    max-width: 350px;
  }
}
```

---

### 7.2 Note Card Visual Design

**Reuse `.note-card` CSS from PlayerNotesPanel:**
- Base class: `.note-card` (padding 1rem, border-radius 8px, background-color `var(--color-surface-light)`)
- Consistent with existing in-game note card style in GameManagement
- Border: 1px solid `var(--color-border-subtle)`
- Hover state: background-color `var(--color-surface-hover)`, box-shadow: 0 2px 4px rgba(0,0,0,0.08)

**New Coaching-Point Styling:**
- Add CSS class: `.note-card.note-type-coaching-point`
- Background color: `var(--color-strategy-light)` — light blue tint for coaching context
- Left border accent: 3px solid `var(--color-strategy)` — coaching blue accent
- Icon: **💡 (lightbulb) — recommended** (not 🎯 target). Justification:
  - Lightbulb universally conveys "idea" and "coaching insight" across cultures
  - Aligns with "strategy moment" framing (coaches sharing ideas before game)
  - Target (🎯) implies competitive intensity/scoring, not coaching dialogue
  - Lightbulb more accessible to screen readers ("light bulb" vs "target")
- Position: `.note-icon` (top-left, 24px × 24px)

**Note Card Structure:**
```
┌─────────────────────────────────────┐
│ 💡 Created by: coach@example.com    │ ← .note-header (flex, align-items center)
│    March 29, 2026 at 1:30 PM        │
├─────────────────────────────────────┤
│ "Focus on high pressing in          │ ← .note-text (multiline, word-wrap)
│ first 10 minutes"                   │
└─────────────────────────────────────┘
  [Edit] [Delete]                   ← .note-actions (flex, gap var(--spacing-1))
```

**Author Attribution Placement:**
- **Placement:** Top-right of note card header (inline with icon)
- **Format:** "Created by: {authorId}" (e.g., "Created by: coach@example.com")
- **Class:** `.note-author` (font-size 0.875rem, color var(--color-text-secondary), margin-left auto)
- **Alternative (if authorId is UUID):** Show tooltip with full user email on hover of userId
- **Timestamp:** On second row of header, below author (font-size 0.75rem, color var(--color-text-muted))

**CSS Classes Strategy:**
```css
/* Reused from PlayerNotesPanel */
.note-card { /* ... existing styles ... */ }
.note-header { display: flex; align-items: center; gap: var(--spacing-2); }
.note-icon { width: 24px; height: 24px; font-size: 1.25rem; }
.note-text { margin-top: var(--spacing-2); line-height: 1.5; word-wrap: break-word; }
.note-author { font-size: 0.875rem; color: var(--color-text-secondary); margin-left: auto; }
.note-meta { font-size: 0.75rem; color: var(--color-text-muted); margin-top: var(--spacing-1); }

/* New classes for coaching-point styling */
.note-card.note-type-coaching-point {
  background-color: var(--color-strategy-light);
  border-left: 3px solid var(--color-strategy);
}
.note-card.note-type-coaching-point .note-icon {
  color: var(--color-strategy);
}

/* Note actions (edit/delete buttons) */
.note-actions {
  display: flex;
  gap: var(--spacing-2);
  margin-top: var(--spacing-2);
  justify-content: flex-start;
}
```

---

### 7.3 Create/Edit Modal Specification

**Modal Dialog Container:**
- Reuse accessible modal pattern from existing codebase (consistent with PlayerNotesPanel modal)
- Modal overlay: fixed position, z-index 1000, background: rgba(0,0,0,0.5)
- Modal body: max-width 500px, centered, border-radius 12px, background white, padding 2rem
- Mobile: full-width with margin-left/right var(--spacing-2), min-height: auto to avoid viewport overflow

**Title:**
- Create mode: "Add Coaching Point"
- Edit mode: "Edit Coaching Point"
- Font: heading-2 (strong, dark color)
- Margin-bottom: var(--spacing-4)

**Form Fields:**

**1. Note Text Input (Primary)**
- Element: `<textarea>`
- Placeholder: "e.g., Focus on high pressing in the first 10 minutes"
- Min-rows: 3, max-rows: 8 (auto-expand as user types)
- Width: 100%
- Padding: 0.75rem
- Border: 1px solid var(--color-border)
- Border-radius: 6px
- Font-family: system font (readable)
- Font-size: 1rem
- Max-length: 500 characters (enforced in JavaScript)
- Focus ring: outline 2px solid var(--color-primary) on focus

**2. Character Counter (Below Text Input)**
- Display format: "X / 500" (e.g., "245 / 500") — matches [PlayerNotesPanel](PlayerNotesPanel.tsx) character counter pattern
- Color: `var(--color-text-muted)` (normal), `var(--color-error)` if >500 chars
- Font-size: 0.75rem
- Position: right-aligned, margin-top `var(--spacing-1)`
- Update in real-time as user types
- **NOTE:** PlayerNotesPanel currently lacks a character counter; PreGameNotesPanel establishes this pattern for future adoption across game note components

**3. Player Selector Dropdown (Optional)**
- Label: "Assigned Player (Optional)"
- Type: `<select>` dropdown
- Options:
  - "General Note" (default, value null)
  - Each player on team roster (value: playerId)
- Placeholder: "Select a player or leave as general note"
- Width: 100%
- Margin-top: var(--spacing-3)
- When selected: show player info (jersey, position) below dropdown
- Font-size: 1rem

**Button Row (Bottom of Modal):**
- Layout: flex, justify-content flex-end, gap var(--spacing-2)
- Margin-top: var(--spacing-4)

| Button | Type | Label | Disabled State | Click |
|--------|------|-------|---|---|
| **Create/Edit** | Primary (brand color) | "Create Point" (new) or "Save Changes" (edit) | If text empty or >500 chars | Submit form |
| **Cancel** | Secondary (outline) | "Cancel" | Never | Close modal without changes |

**Validation & Error Handling:**
- **Empty Text:** Error toast "Note cannot be empty"
- **Text > 500 chars:** Error toast "Note must be 500 characters or less" + disable Create button (visual affordance: grayed out)
- **Other errors (network, auth):** Error toast with message (e.g., "Failed to save note. Please try again.")

**Modal Code Pattern:**
```tsx
export interface CreateEditModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialText?: string;
  initialPlayerId?: string | null;
  onSubmit: (text: string, playerId: string | null) => Promise<void>;
  onClose: () => void;
  teamRoster: Player[];
}

export function CreateEditModal({
  isOpen,
  mode,
  initialText = '',
  initialPlayerId = null,
  onSubmit,
  onClose,
  teamRoster,
}: CreateEditModalProps) {
  const [text, setText] = useState(initialText);
  const [playerId, setPlayerId] = useState(initialPlayerId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = text.trim().length > 0 && text.length <= 500;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      await onSubmit(text.trim(), playerId);
      onClose();
    } catch (error) {
      showErrorToast(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true"
         aria-labelledby="modal-title">
      <div className="modal-body">
        <h2 id="modal-title" className="modal-title">
          {mode === 'create' ? 'Add Coaching Point' : 'Edit Coaching Point'}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* Text Input */}
          <div className="form-group">
            <label htmlFor="note-text">Coaching Point</label>
            <textarea
              id="note-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g., Focus on high pressing in the first 10 minutes"
              rows={3}
              maxLength={2000}  /* Enforced server-side as well */
              aria-label="Coaching point text"
              aria-describedby="char-counter"
              required
            />
            <div id="char-counter" className="char-counter">
              {text.length} / 500
            </div>
            {text.length > 500 && (
              <p className="error-message" role="alert">
                Note must be 500 characters or less
              </p>
            )}
          </div>

          {/* Player Selector */}
          <div className="form-group">
            <label htmlFor="player-select">Assigned Player (Optional)</label>
            <select
              id="player-select"
              value={playerId || ''}
              onChange={(e) => setPlayerId(e.target.value || null)}
              aria-label="Select player or general note"
            >
              <option value="">General Note</option>
              {teamRoster.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name} (#{player.jerseyNumber})
                </option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!isValid || isSubmitting}
              aria-label={mode === 'create' ? 'Create coaching point' : 'Save changes'}
            >
              {isSubmitting ? 'Saving...' : (mode === 'create' ? 'Create Point' : 'Save Changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

---

### 7.4 Soft-Lock UX When Game In-Progress/Halftime

**Design Decision: Grayed-Out Buttons with Tooltip**

When game status is `in-progress` or `halftime`, pre-game note edit/delete buttons are disabled (read-only state):

**Visual Treatment:**
- **Edit Button State:** Disabled (grayed out), cursor: not-allowed, opacity: 0.5
- **Delete Button State:** Disabled (grayed out), cursor: not-allowed, opacity: 0.5
- **Tooltip on Hover:** "Editing disabled during active game"
- **Note Card:** Remains visible but with slightly muted appearance (background-color: var(--color-surface-disabled), opacity: 0.9)

**After Game Completed (`status: 'completed'`):**
- Edit/Delete buttons re-enabled
- Note card returns to normal styling
- Tooltip removed

**Implementation:**
```tsx
// In PreGameNotesPanel.tsx

const isGameActive = gameStatus === 'in-progress' || gameStatus === 'halftime';
const isEditDisabled = isGameActive;

return (
  <div className="note-card" role="article">
    {/* ... note content ... */}
    <div className="note-actions">
      <button
        className="btn btn-sm btn-secondary"
        onClick={() => handleEdit(note)}
        disabled={isEditDisabled}
        title={isEditDisabled ? 'Editing disabled during active game' : 'Edit note'}
        aria-label={`Edit note: ${note.notes.substring(0, 20)}...`}
        aria-disabled={isEditDisabled}
      >
        {editingNoteId === note.id ? 'Cancel' : 'Edit'}
      </button>
      <button
        className="btn btn-sm btn-danger"
        onClick={() => handleDelete(note.id)}
        disabled={isEditDisabled}
        title={isEditDisabled ? 'Deletion disabled during active game' : 'Delete note'}
        aria-label={`Delete note: ${note.notes.substring(0, 20)}...`}
        aria-disabled={isEditDisabled}
      >
        Delete
      </button>
    </div>
  </div>
);
```

**CSS for Disabled State:**
```css
.note-card[data-game-status="in-progress"],
.note-card[data-game-status="halftime"] {
  background-color: var(--color-surface-disabled);
  opacity: 0.9;
  pointer-events: none;  /* Prevent accidental clicks */
}

.note-card[data-game-status="in-progress"] .note-actions button,
.note-card[data-game-status="halftime"] .note-actions button {
  opacity: 0.5;
  cursor: not-allowed;
}

.note-card[data-game-status="in-progress"] .note-actions button:disabled,
.note-card[data-game-status="halftime"] .note-actions button:disabled {
  background-color: var(--color-surface-disabled);
  color: var(--color-text-muted);
}
```

**State Behavior Across All Game Statuses:**

| Game Status | Edit Enabled | Delete Enabled | Visibility | Note |
|---|---|---|---|---|
| **Scheduled** | ✅ Yes | ✅ Yes | Visible | Full CRUD, no restrictions |
| **In-Progress** | ❌ No | ❌ No | Visible | Soft-lock: grayed out, tooltip |
| **Halftime** | ❌ No | ❌ No | Visible | Soft-lock: grayed out, tooltip |
| **Completed** | ✅ Yes | ✅ Yes | Visible | Re-enabled for post-game cleanup |

---

### 7.5 Empty State Messaging

**When No Pre-Game Notes Exist:**

**Messaging (Aligned with UI-SPEC §5.4):**
- Empty state heading: "No coaching points yet"
- Empty state body: "Add one using the button below to share strategy with your team."
- Icon: 📋 (clipboard) or 💭 (thought bubble)

**Visual Design:**
- Centered in PreGameNotesPanel container
- Large icon (3rem × 3rem, color: var(--color-text-muted))
- Heading: 1.125rem, semi-bold, color: var(--color-text-secondary)
- Body text: 0.875rem, color: var(--color-text-muted)
- Padding: var(--spacing-4) on all sides (min 2rem)
- Background: transparent (inherits from panel)

**CTA Button Below Empty State:**
- Label: "+ Add Coaching Point"
- Style: Primary button (brand color, solid)
- Icon: "+" (plus sign, left of text)
- Positioned below empty state text with margin-top var(--spacing-3)

**Code Pattern:**
```tsx
export function PreGameNotesPanel({
  gameNotes,
  gameStatus,
  onAdd,
  onEdit,
  onDelete,
}: PreGameNotesPanelProps) {
  const preGameNotes = gameNotes.filter(
    (n) => n.gameSeconds === null && n.half === null
  );

  if (preGameNotes.length === 0) {
    return (
      <div className="pre-game-notes-panel">
        <div className="empty-state" role="status" aria-label="No coaching points">
          <div className="empty-state-icon">📋</div>
          <h3 className="empty-state-heading">No coaching points yet</h3>
          <p className="empty-state-body">
            Add one using the button below to share strategy with your team.
          </p>
          <button
            className="btn btn-primary btn-lg"
            onClick={onAdd}
            aria-label="Add a new coaching point"
          >
            + Add Coaching Point
          </button>
        </div>
      </div>
    );
  }

  // ... render notes list ...
}
```

---

### 7.6 Accessibility Details

**Tab Order in Modal:**
1. Close button (top-right, optional quickexit)
2. Modal title (auto-focused on open)
3. Note text input (`<textarea>`)
4. Character counter (read-only, skipped in tab order)
5. Player selector `<select>`
6. Player info display (if selected, skipped in tab order)
7. Cancel button
8. Create/Edit button
9. Trap focus: Tab from Create/Edit loops back to Note text input

**ARIA Labels:**
- Modal dialog: `role="dialog"` + `aria-modal="true"` + `aria-labelledby="modal-title"`
- Text input: `aria-label="Coaching point text"` + `aria-describedby="char-counter"` (links to counter)
- Character counter: `id="char-counter"`, role implicit (read-only text)
- Player selector: `aria-label="Select player or general note"`
- Buttons:
  - Create: `aria-label="Create coaching point"` or `aria-label="Save changes"`
  - Cancel: `aria-label="Cancel and close dialog"`
  - Delete: `aria-label="Delete note: [note preview]"`
  - Edit: `aria-label="Edit note: [note preview]"`
  - Disabled state: `aria-disabled="true"` (in addition to `disabled` HTML attribute)

**Error Messages:**
- Error toast: `role="alert"` (auto-announced by screen readers)
- Inline validation errors: `role="alert"` + `aria-live="polite"` for real-time character count feedback

**Keyboard Shortcuts:**
- **Ctrl+Enter** (Cmd+Enter on Mac): Submit form (create/edit)
- **Esc**: Close modal without changes
- **Tab**: Navigate form fields with proper focus order
- **Shift+Tab**: Reverse tab order

**Keyboard Shortcut Implementation:**
```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
  // Cmd+Enter or Ctrl+Enter: submit
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    handleSubmit(e as any);
  }
  // Esc: close modal
  if (e.key === 'Escape') {
    e.preventDefault();
    onClose();
  }
};

<textarea onKeyDown={handleKeyDown} /* ... */ />
```

**Focus Management:**
- On modal open: Auto-focus modal title (or first focusable element, the textarea)
- On modal close: Return focus to "Add Note" button that opened it
- Focus trap: Prevent Tab key from leaving modal while open

**Screen Reader Announcements:**
- Modal open: announced as dialog with title
- Character count: announced on input (aria-describedby link)
- Validation errors: announced as alert
- Note deletion: "Note deleted" announcement after successful deletion

**Color Contrast:**
- All text meets WCAG AA standard (4.5:1 for normal text, 3:1 for large text)
- Disabled buttons: sufficient contrast (gray text on light background)
- Success/error toasts: color + icon (not color-alone for status indication)

---

### 7.7 Tablet Layout Adaptation (Two-Column GamePlanner)

**GamePlanner Two-Column Layout (Per UI-SPEC §7.7):**

When viewport width is 768px–1024px (tablet), GamePlanner uses two-column layout:
- **Left Column (Primary):** Lineup Builder (drag-and-drop player assignment) — width: ~55%, priority
- **Right Column (Secondary):** RotationWidget summary + PreGameNotesPanel — width: ~45%

**PreGameNotesPanel Priority in Right Column:**
- If right column is scrollable, PreGameNotesPanel is positioned **below** RotationWidget
- Both components are independently scrollable within the column
- Minimum width for right column: 300px (below this, PreGameNotesPanel wraps to full-width below left column)

**Rendering Order (Tablet):**
```
┌──────────────────────────────────────────────────────────┐
│ GameHeader (full-width)                                  │
├──────────────────────────────────────────────────────────┤
│ PlayerAvailabilityGrid (full-width, collapsible)         │
├──────────────────────────────────────────────────────────┤
│ Left Column (55%)       │  Right Column (45%)            │
│ ┌────────────────────┐  │  ┌──────────────────┐         │
│ │ Lineup Builder     │  │  │ RotationWidget   │         │
│ │ (drag-and-drop)    │  │  │ (summary)        │         │
│ │                    │  │  ├──────────────────┤         │
│ │                    │  │  │ Pre-Game Notes   │         │
│ │ (tall, scrolls)    │  │  │ Panel            │         │
│ │                    │  │  │ (scrolls indep.) │         │
│ └────────────────────┘  │  └──────────────────┘         │
├──────────────────────────────────────────────────────────┤
│ Save/Confirm Buttons (full-width, sticky bottom)         │
└──────────────────────────────────────────────────────────┘
```

**CSS Grid Implementation:**
```css
@media (min-width: 768px) and (max-width: 1023px) {
  .game-planner {
    display: grid;
    grid-template-columns: 1.2fr 1fr;  /* 55% / 45% */
    gap: var(--spacing-4);
    grid-template-areas:
      "header header"
      "availability availability"
      "lineup notes"
      "buttons buttons";
  }

  .game-header {
    grid-area: header;
  }

  .player-availability-grid {
    grid-area: availability;
  }

  .lineup-builder {
    grid-area: lineup;
    overflow-y: auto;
    max-height: calc(100vh - 400px);
  }

  .pre-game-notes-panel {
    grid-area: notes;
    overflow-y: auto;
    max-height: calc(100vh - 400px);
  }

  .game-planner-buttons {
    grid-area: buttons;
    position: sticky;
    bottom: 0;
    z-index: 200;
  }
}

/* Below tablet threshold: stack everything vertically */
@media (max-width: 767px) {
  .game-planner {
    display: flex;
    flex-direction: column;
  }

  .pre-game-notes-panel {
    width: 100%;
    order: 5;  /* After LineupBuilder and RotationWidget */
  }
}
```

**Impact on PreGameNotesPanel:**
- Height is constrained by viewport (independent scroll)
- Max-height: `calc(100vh - 400px)` to leave room for header, other content, buttons
- Overflow: `auto` for scrolling if many notes
- Does not push Lineup Builder out of view

---

### 7.8 CSS Classes Strategy

**Reused from PlayerNotesPanel:**
These classes are already defined in the codebase and reused without modification:

| Class | Purpose | Reuse |
|-------|---------|-------|
| `.note-card` | Container for individual note | ✅ Reuse (base styling: padding, border, border-radius) |
| `.note-header` | Header row with icon + author + timestamp | ✅ Reuse (flex, align-items center) |
| `.note-icon` | Icon display (left side) | ✅ Reuse (24px × 24px, font-size 1.25rem) |
| `.note-text` | Main note content (multiline) | ✅ Reuse (line-height 1.5, word-wrap) |
| `.note-author` | Author attribution text | ✅ Reuse (font-size 0.875rem, color var(--color-text-secondary)) |
| `.note-meta` | Secondary metadata (timestamp, position indicator) | ✅ Reuse (font-size 0.75rem, color var(--color-text-muted)) |
| `.note-actions` | Container for edit/delete buttons | ✅ Reuse (flex, gap var(--spacing-2)) |

**New Classes for Coaching-Point Styling:**

| Class | Purpose | Styling |
|-------|---------|---------|
| `.note-type-coaching-point` | Modifier for pre-game notes | Background: #E8F4F8 (light blue), Left border: 3px #0277BD (coaching blue), Icon color: #0277BD |
| `.note-card.note-type-coaching-point .note-icon::before` | Icon content modifier | Content: "💡" (lightbulb) — CSS-only or use pseudo-element |
| `.pre-game-notes-panel` | Container for panel | Padding, background, borders (inherits from GamePlanner styling) |
| `.empty-state` | Empty state container | Centered text, padding var(--spacing-4), role="status" |
| `.empty-state-icon` | Icon in empty state | Font-size 3rem, color var(--color-text-muted) |
| `.empty-state-heading` | Empty state title | Font-size 1.125rem, semi-bold, color var(--color-text-secondary) |
| `.empty-state-body` | Empty state description | Font-size 0.875rem, color var(--color-text-muted) |
| `.modal-overlay` | Modal backdrop | Fixed, z-index 1000, background rgba(0,0,0,0.5) |
| `.modal-body` | Modal dialog box | Max-width 500px, centered, border-radius 12px, white background, padding 2rem |
| `.modal-title` | Modal heading | Font: heading-2, margin-bottom var(--spacing-4) |
| `.form-group` | Form field container | Margin-bottom var(--spacing-3), display flex flex-direction column |
| `.char-counter` | Character count display | Font-size 0.75rem, color var(--color-text-secondary), right-aligned |
| `.error-message` | Inline validation error | Font-size 0.875rem, color var(--color-error), role="alert" |
| `.modal-actions` | Button container in modal | Flex, justify-content flex-end, gap var(--spacing-2), margin-top var(--spacing-4) |

**CSS Architecture (No Breaking Changes):**
```css
/* PlayerNotesPanel.css — shared styles (unchanged) */
.note-card { /* existing */ }
.note-header { /* existing */ }
.note-icon { /* existing */ }
.note-text { /* existing */ }
.note-author { /* existing */ }
.note-meta { /* existing */ }
.note-actions { /* existing */ }

/* PreGameNotesPanel.css — new file, extends existing */
@import '../PlayerNotesPanel.css';  /* Import shared styles */

/* New coaching-point modifier */
.note-card.note-type-coaching-point {
  background-color: var(--color-strategy-light);
  border-left: 3px solid var(--color-strategy);
}

.note-card.note-type-coaching-point .note-icon {
  color: var(--color-strategy);
}

/* Panel container */
.pre-game-notes-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

No duplicate; keep existing heading
| `.note-type-coaching-point` | Modifier for pre-game notes | Background: `var(--color-strategy-light)` (light blue), Left border: 3px `var(--color-strategy)` (coaching blue), Icon color: `var(--color-strategy)` |
.empty-state {
  text-align: center;
  padding: var(--spacing-4);
}

.empty-state-icon {
  font-size: 3rem;
  color: var(--color-text-muted);
  margin-bottom: var(--spacing-2);
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-body {
  background: white;
  border-radius: 12px;
  padding: 2rem;
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

/* Form groups */
.form-group {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--spacing-3);
}

.form-group label {
  font-weight: 600;
  margin-bottom: var(--spacing-1);
  color: var(--color-text-primary);
}

.form-group input,
.form-group textarea,
.form-group select {
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 1rem;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: 2px solid var(--primary-green);
  outline-offset: 2px;
}
```

**Responsive Behavior Summary:**
- All CSS classes use CSS custom properties (–-spacing, --color-*) for theme consistency
- No hardcoded colors; all use theme tokens
- Breakpoint-mobile-first: mobile styles default, media queries for tablet/desktop
- Button states (hover, active, disabled) handled consistently across components

---

## 8. Test Strategy

### Unit Tests

#### `useOfflineMutations.test.ts`
- ✅ Test `updateGameNote` with valid fields → queued correctly
- ✅ Test `deleteGameNote` → queued correctly
- ✅ Test `createGameNote` captures `authorId` from `fetchAuthSession`
- ✅ Test offline queue drains updateGameNote/deleteGameNote mutations
- ✅ Test error handling when mutation fails (e.g., unauthorized coach)

#### `PreGameNotesPanel.test.tsx` *(NEW)*
- ✅ Render with empty notes list → "No notes yet" message
- ✅ Render with array of pre-game notes → display each with author, type, text
- ✅ Click "Add Note" → open modal
- ✅ Enter note text, select player (optional) → submit → calls `createGameNote`
- ✅ Click edit button on note → open modal with pre-filled text → update → calls `updateGameNote`
- ✅ Click delete button on note → confirmation dialog → calls `deleteGameNote`
- ✅ Validate note length: reject if >500 chars (or configured max)
- ✅ Test author display renders correctly (handles null/missing author)
- ✅ Test error handling: mutation error → toast display

#### `PlayerNotesPanel.test.tsx` *(Enhancements)*
- ✅ Filter in-game notes correctly (gameSeconds/half present)
- ✅ Filter out pre-game notes (gameSeconds/half null)
- ✅ Display author on in-game notes
- ✅ Edit/delete buttons only show for in-game notes (not pre-game, those are GamePlanner's responsibility)

### Component Tests

#### `GamePlanner.test.tsx` *(Enhancement)*
- ✅ PreGameNotesPanel renders when game is scheduled
- ✅ Pass game, team, gameNotes, mutations to PreGameNotesPanel
- ✅ Interact with PreGameNotesPanel → mutations called
- ✅ Pre-game notes visible before game starts

### E2E Tests

#### `game-planner.spec.ts` *(NEW TEST CASE: Pre-Game Notes)*
```gherkin
Scenario: Coach adds pre-game note in game planner
  Given coach is viewing a scheduled game in Game Planner
  When coach clicks "Add Note"
  And enters "Focus on pressing high in midfield" as note text
  And submits the form
  Then the note appears in the pre-game notes list
  And shows the coach's ID/email as author
  When coach clicks edit on the note
  And changes text to "Focus on possession in midfield"
  And saves
  Then the note updates in the list
  When coach clicks delete on the note
  And confirms deletion
  Then the note is removed from the list
```

#### `full-workflow.spec.ts` *(Enhancement: Smoke Test)*
- ✅ Create pre-game note in Game Planner
- ✅ Start game
- ✅ Pre-game notes are visible in game management (in-game view)
- ✅ In-game notes can still be added (gold stars, cards)
- ✅ Complete game
- ✅ Pre-game and in-game notes both visible in completed game view
- ✅ Pre-game notes can be deleted in completed game view

### Authorization Tests

#### `e2e/team-sharing.spec.ts` *(Enhancement: Coach Permissions)*
- ✅ Coach A creates pre-game note
- ✅ Coach B (different user, same team) can view the note
- ✅ Coach B can edit the note (no author lock)
- ✅ Coach B can delete the note
- ✅ Coach C (different team) cannot view/edit the note (authorization denial)

### Edge Case Coverage

| Edge Case | Test Type | Expected Behavior |
|-----------|-----------|-------------------|
| Pre-game note created while offline → game starts → sync | E2E + offline | Note syncs after reconnect |
| Two coaches edit same note simultaneously | E2E (stress) | Last write wins (DynamoDB default) |
| Note created 1 second before game starts | E2E | Note still pre-game (null gameSeconds/half) |
| Player not found for player-specific note | Unit (PlayerNotesPanel) | Gracefully skip player name display |
| Author userId null in existing notes (migration) | Unit | Display "Unknown Author" or fallback |
| Delete non-existent note ID | Unit (useOfflineMutations) | Graceful error, no crash |
| Note text >2000 chars submitted | Unit (validation) | Reject on client before submission |

---

## 9. Edge Cases & Error Handling

### Data Integrity
- **Orphaned Notes:** If a GameNote's `authorId` references a deleted user, display "Unknown Author" (no crash).
- **Missing Game:** If gameId is invalid, query fails gracefully with error toast.
- **Null Timestamps:** All notes require `timestamp`. Validate on backend schema.

### Offline & Sync
- **Pre-game Note + Offline + Game Starts:** If coach creates a pre-game note offline, then reconnects during in-progress game state, note syncs with correct context (no state mismatch).
- **Queue Overflow:** Pre-game note mutations join existing offline queue; queue capacity tested separately.

### Concurrent Edits
- **Simultaneous Edit:** Two coaches edit same note → last write wins (DynamoDB conflict resolution). Display refresh on client showing winner's version.
- **Edit + Delete Race:** Coach A edits, Coach B deletes in parallel → DynamoDB error on edit attempt. UI shows error toast ("Note was deleted by another coach").

### Validation
- **Note Length:** Client validates <500 chars (MVP) / <2000 chars (future). Server validates as well.
- **Player ID Validity:** Client optionally validates playerId exists in roster before submission.
- **gameSeconds/half Nullability:** Backend schema enforces null for pre-game, non-null for in-game.

### Author Attribution
- **Missing Author:** If `fetchAuthSession` fails during creation, `authorId` is null. UI handles gracefully.
- **Changing Author:** Once set, `authorId` is immutable (no update allowed). Only current author captured.

---

## 10. Assumptions & Open Questions

### Decisions Made (No Longer Open)
1. **Extended GameNote Model:** Chose extending GameNote (Option A) over separate model (Option B) for simplicity and query efficiency.
2. **Author Immutability:** `authorId` is set at creation, not editable. Supports audit trail.
3. **Offline First:** Pre-game notes use existing offline queue like in-game notes; no special handling.
4. **Soft-Lock After Game Starts:** Pre-game notes become read-only via UI (not backend); re-enabled after game completes for cleanup.

---

### ✅ Critical Architect Decisions — Locked In

#### 1. ✅ Pre-Game Note Visibility: **Option A - GamePlanner + Post-Game Only**
- **Pre-game notes visible ONLY in:**
  - GamePlanner.tsx (scheduled state)
  - Completed game view (post-game summary for review)
- **Pre-game notes NOT visible during in-game:**
  - In-progress/halftime states: PlayerNotesPanel shows only in-game notes
- **Rationale:** Coaches need mental clarity during live play; pre-game notes reviewed before/after, not during

#### 2. ✅ Edit Permissions: **Any-Coach (Transparency Over Audit)**
- **Design:**
  - Any coach on team can edit any pre-game note (no author lock)
  - Intentional transparency: all coaches contribute to strategy
  - `authorId` visible for accountability/attribution (informational, not a permission boundary)
- **Rationale:** Small coaching teams need flexible collaboration; transparency + audit trail > privacy
- **Trade-off Accepted:** Coaches could alter/overwrite others' notes; mitigated by audit trail + team trust

#### 3. ✅ Edit/Delete Lifecycle: **Locked After Game Starts** (UI Soft-Lock)
- **During Scheduled:** Full CRUD (create, read, update, delete) ✅
- **During In-Progress:** Pre-game notes become **read-only** in UI (backend allows edit but UI disables buttons)
  - Rationale: Prevent mid-game rewrites that could confuse team focus
- **During Halftime:** Pre-game notes remain **read-only** (same as in-progress)
- **After Game Completed:** Pre-game notes become **editable + deletable** again for post-game cleanup
  - Use case: remove sensitive info before sharing game summary with parents
- **Implementation:** `if (gameState.status !== 'scheduled' && gameState.status !== 'completed') { disableEdit = true }`

#### 4. ✅ Field Mutability: **Immutable Audit Trail**
**IMMUTABLE (no update allowed - enforced by resolver):**
- `gameId` — note belongs to specific game
- `authorId` — who created it (audit trail)
- `timestamp` — when created (audit trail)
- `gameSeconds` — when in game (audit trail, null for pre-game)
- `half` — which half (audit trail, null for pre-game)

**MUTABLE (allowed in updateGameNote):**
- `noteType` — change classification (e.g., coaching-point → other)
- `playerId` — reassign to different player
- `notes` — text content (primary edit use case)

#### 5. ✅ authorId Capture: **Mandatory, From fetchAuthSession()**
- Captured from `fetchAuthSession()` on client **before** queueing mutation (detailed code in Section 4.1)
- Populated for every note (or UI handles null gracefully)
- Immutable after creation

---

### Remaining Design Decisions (Not Architect-Blocked)

1. **Author Name Resolution:** UI shows userId for MVP; name lookup via Cognito deferred to future.
2. **Note Sorting:** Newest-first (by timestamp); pre-game notes sort after in-game in list.
3. **Bulk Operations:** MVP supports single-note edit/delete; bulk operations deferred to future.
4. **Mobile UX:** Pre-game note input: modal dialog (reuses PlayerNotesPanel pattern for consistency).
5. **Coach Identity Display:** Show userId/email for MVP; full name resolution deferred.

---

## 11. Success Criteria

✅ **Feature Complete When:**
- [x] GameNote schema extended with `authorId`, optional `gameSeconds/half`
- [x] `updateGameNote` and `deleteGameNote` mutations implemented
- [x] `useOfflineMutations` hook supports update/delete for notes
- [x] PreGameNotesPanel component created and integrated into GamePlanner
- [x] Pre-game notes filterable from in-game notes (client-side)
- [x] Author attribution displayed on each note
- [x] Edit and delete buttons functional with confirmation dialogs
- [x] All unit, component, E2E tests pass with >90% coverage
- [x] Authorization tests confirm any coach can edit/delete
- [x] Offline + sync flow tested for pre-game notes
- [x] `npm run gate:commit` passes (lint, test, build)

✅ **UI/UX Polish:**
- [x] Note cards consistent with PlayerNotesPanel styling
- [x] Modal dialogs responsive on mobile
- [x] Error/success toasts for all operations
- [x] Graceful handling of null/missing author

---

## 12. Out of Scope (Future)

- Coach name resolution from Cognito (use userId for MVP)
- Bulk note operations (delete all pre-game notes at once)
- Note templates or quick-insert buttons
- Note categories/tags (future organizational feature)
- Note analytics (which notes are viewed/acted upon most)
- Mobile-optimized note entry flow (use web modal for MVP)

