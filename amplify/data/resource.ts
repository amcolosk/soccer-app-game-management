import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { acceptInvitation } from "../functions/accept-invitation/resource";
import { getUserInvitations } from "../functions/get-user-invitations/resource";
import { createGitHubIssue } from "../functions/create-github-issue/resource";
import { createGameNote } from "../functions/create-game-note/resource";
import { updateGameNote } from "../functions/update-game-note/resource";
import { deleteGameNote } from "../functions/delete-game-note/resource";
import { upsertCoachProfile } from "../functions/upsert-coach-profile/resource";
import { getTeamCoachProfiles } from "../functions/get-team-coach-profiles/resource";
import { deleteFormationSafe } from "../functions/delete-formation-safe/resource";
import { deleteGameSafe } from "../functions/delete-game-safe/resource";
import { deleteTeamSafe } from "../functions/delete-team-safe/resource";
import { deletePlayerSafe } from "../functions/delete-player-safe/resource";
import { archiveTeam } from "../functions/archive-team/resource";
import { restoreTeam } from "../functions/restore-team/resource";
import { assignTeamOwner } from "../functions/assign-team-owner/resource";
import { createGameSafe } from "../functions/create-game-safe/resource";
import { syncTeamCalendar } from "../functions/sync-team-calendar/resource";
import { unlinkTeamCalendar } from "../functions/unlink-team-calendar/resource";
import { revokeCoachAccess } from "../functions/revoke-coach-access/resource";
import { generateShareLink } from "../functions/generate-share-link/resource";
import { revokeShareLink } from "../functions/revoke-share-link/resource";
import { listTeamShareLinks } from "../functions/list-team-share-links/resource";
import { getFanGameView } from "../functions/get-fan-game-view/resource";
import { getStatTrackerView } from "../functions/get-stat-tracker-view/resource";
import { submitStatEvent } from "../functions/submit-stat-event/resource";

/*== Soccer Game Management App Schema ===================================
This schema defines the data models for a soccer coaching app:
- Team: Has players, formation, and field configuration
- Player: Individual player on a team roster
- FieldPosition: Positions used in the team's formation
=========================================================================*/
const schema = a.schema({
  Formation: a
    .model({
      name: a.string().required(), // e.g., "4-3-3", "3-5-2"
      playerCount: a.integer().required(), // Number of field players in this formation
      sport: a.string().default("Soccer"),
      positions: a.hasMany('FormationPosition', 'formationId'),
      teams: a.hasMany('Team', 'formationId'),
      coaches: a.string().array(), // Array of user IDs who can access this formation
        layoutVersion: a.integer().default(0), // Optimistic lock for visual layout saves
    })
    .authorization((allow) => [
      // Delete is intentionally disallowed on the model. Use deleteFormationSafe.
      allow.ownersDefinedIn('coaches').to(['create', 'read', 'update']),
    ]),

  FormationPosition: a
    .model({
      formationId: a.id().required(),
      formation: a.belongsTo('Formation', 'formationId'),
      positionName: a.string().required(), // e.g., "Left Forward", "Center Midfielder"
      abbreviation: a.string().required(), // e.g., "LF", "CM"
      role: a.enum(['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD']), // Explicit tactical role; drives goalkeeper/behavioral logic
      sortOrder: a.integer(), // Display order for the position
      coaches: a.string().array(), // Array of user IDs who can access this formation position
        xPct: a.integer(), // X coordinate percentage (1–99) for visual layout; null = use inferred
        yPct: a.integer(), // Y coordinate percentage (1–99) for visual layout; null = use inferred
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Full access for coaches
    ]),

  Team: a
    .model({
      name: a.string().required(),
      coaches: a.string().array(), // Array of user IDs who can access this team
      formationId: a.id(),
      formation: a.belongsTo('Formation', 'formationId'),
      maxPlayersOnField: a.integer().required(),
      halfLengthMinutes: a.integer().default(30),
      sport: a.string().default("Soccer"),
      gameFormat: a.string().default("Halves"),
      roster: a.hasMany('TeamRoster', 'teamId'),
      positions: a.hasMany('FieldPosition', 'teamId'),
      games: a.hasMany('Game', 'teamId'),
      invitations: a.hasMany('TeamInvitation', 'teamId'),
      // Persisted owner (Cognito sub). Undefined = legacy team pending owner assignment.
      // Coaches may stamp this once at create time (Management.tsx / demoDataService);
      // there is no update grant, so ownership can only change via assignTeamOwner.
      ownerId: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['create', 'read'])]),
      // Lifecycle state: 'active' | 'archived'. a.enum() is not used because this
      // Amplify version does not support .required()/.default() on enums (see
      // GameNote.noteType). Coaches get 'create' so the schema's own
      // .default('active') can actually be written at creation time -- applying
      // a default value is itself a write, and AppSync rejects it as
      // Unauthorized on [status] if the field-level grant excludes 'create',
      // even when nothing in the request explicitly sets this field. No
      // 'update' grant, so a coach can never flip status directly; writes past
      // creation only via archiveTeam/restoreTeam. Same reasoning as ownerId
      // above.
      status: a.string().default('active').authorization((allow) => [allow.ownersDefinedIn('coaches').to(['create', 'read'])]),
      // Archive audit metadata. Coaches get read-only access; writes only via archiveTeam/restoreTeam.
      archivedAt: a.datetime().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
      archivedBy: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
      // Calendar Feed Import: non-secret status fields coaches see on every
      // load. All five are Lambda-written, coach-read-only (round-2 fix,
      // architecture review Major B). The feed URL itself does NOT live
      // here (architecture review Major 1) -- see the Lambda-only
      // CalendarFeed model below.
      calendarFeedProvider: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
      calendarFeedTeamAlias: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
      calendarFeedHost: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]), // display-only hostname, e.g. "calendar.playmetrics.com" -- never the full URL
      calendarFeedLastSyncedAt: a.datetime().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
      calendarFeedLastError: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
    })
    .authorization((allow) => [
      // Delete is intentionally disallowed on the model. Use deleteTeamSafe.
      // ownerId/status/archivedAt/archivedBy are locked down above via field-level
      // authorization; this model-level grant still applies to every other field.
      allow.ownersDefinedIn('coaches').to(['create', 'read', 'update']),
    ]),

  Player: a
    .model({
      firstName: a.string().required(),
      lastName: a.string().required(),
      isActive: a.boolean().default(true),
      birthYear: a.integer(), // Optional. birthMonth (1-12) can be added later for Aug 1 school-year cohort (US youth soccer 2026-27 transition)
      coaches: a.string().array(), // Team coaches who can access this player
      teamRosters: a.hasMany('TeamRoster', 'playerId'),
      lineupAssignments: a.hasMany('LineupAssignment', 'playerId'),
      substitutionsOut: a.hasMany('Substitution', 'playerOutId'),
      substitutionsIn: a.hasMany('Substitution', 'playerInId'),
      playTimeRecords: a.hasMany('PlayTimeRecord', 'playerId'),
      goalsScored: a.hasMany('Goal', 'scorerId'),
      assists: a.hasMany('Goal', 'assistId'),
      gameNotes: a.hasMany('GameNote', 'playerId'),
      playerAvailabilities: a.hasMany('PlayerAvailability', 'playerId'),
      shots: a.hasMany('Shot', 'playerId'),
      saves: a.hasMany('Save', 'playerId'),
    })
    .authorization((allow) => [
      // Delete is intentionally disallowed on the model. Use deletePlayerSafe.
      allow.ownersDefinedIn('coaches').to(['create', 'read', 'update']),
    ]),

  TeamRoster: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      playerNumber: a.integer().required(),
      preferredPositions: a.string(), // Comma-separated formation position IDs
      isActive: a.boolean().default(true),
      coaches: a.string().array(), // Team coaches who can access this roster entry
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access roster
    ]),

  FieldPosition: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      positionName: a.string().required(), // e.g., "Forward", "Midfielder", "Defender", "Goalkeeper"
      abbreviation: a.string(), // e.g., "FW", "MF", "DF", "GK"
      sortOrder: a.integer(),
      coaches: a.string().array(), // Team coaches who can access this position
      lineupAssignments: a.hasMany('LineupAssignment', 'positionId'),
      substitutions: a.hasMany('Substitution', 'positionId'),
      playTimeRecords: a.hasMany('PlayTimeRecord', 'positionId'),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access positions
    ]),

  Game: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      opponent: a.string().required(),
      isHome: a.boolean().required(),
      gameDate: a.datetime(),
      status: a.string().default('scheduled'), // scheduled, in-progress, halftime, completed
      currentHalf: a.integer().default(1), // 1 or 2
      elapsedSeconds: a.integer().default(0),
      lastStartTime: a.string(), // ISO timestamp when timer last started
      halfLengthMinutes: a.integer(), // Per-game override; null = use team default
      ourScore: a.integer().default(0),
      opponentScore: a.integer().default(0),
      coaches: a.string().array(), // Team coaches who can access this game
      lineupAssignments: a.hasMany('LineupAssignment', 'gameId'),
      substitutions: a.hasMany('Substitution', 'gameId'),
      queuedSubstitutions: a.hasMany('QueuedSubstitution', 'gameId'),
      playTimeRecords: a.hasMany('PlayTimeRecord', 'gameId'),
      goals: a.hasMany('Goal', 'gameId'),
      shots: a.hasMany('Shot', 'gameId'),
      saves: a.hasMany('Save', 'gameId'),
      gameNotes: a.hasMany('GameNote', 'gameId'),
      playerAvailability: a.hasMany('PlayerAvailability', 'gameId'),
      gamePlan: a.hasOne('GamePlan', 'gameId'),
      // External calendar provenance (Calendar Feed Import). Written only by
      // the syncTeamCalendar Lambda via the DynamoDB SDK (bypasses field
      // auth); coaches read but never write these directly. None carry
      // .default() -- sidesteps the Finding-4 "'create' grant required for
      // any field with a default" gotcha entirely.
      externalUid: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]), // VEVENT UID, e.g. "Game_4841731"
      externalSource: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]), // 'playmetrics' | 'ics'
      externalSequence: a.integer().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]), // VEVENT SEQUENCE, informational only -- NOT the change-detection signal
      externalContentHash: a.string().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]), // sha256 of the import-owned fields; drives skip-vs-update
      externalSyncedAt: a.datetime().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]),
      externalCancelled: a.boolean().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]), // feed says CANCELLED; game kept + flagged, never deleted
      // Deliberately coach-writable, unlike the other external* fields above
      // -- its only purpose is to prompt a human check, and it's meaningless
      // to leave permanently un-clearable once that check happens. Home.tsx's
      // handleSaveEditGame sets this to false whenever the coach saves the
      // Edit Game form's Home/Away checkbox, since submitting that form is
      // the confirmation this flag exists to request. A later re-sync can
      // still re-flag it (feed always wins on a content-hash change, same as
      // locationName/etc. below) if the feed's own data is still ambiguous.
      // No field-level override -- inherits coach read+update from the
      // model-level grant below.
      externalHomeAwayUnverified: a.boolean(), // generic adapter guessed isHome; cleared by the coach confirming/correcting it via Edit Game
      externalAdoptedAt: a.datetime().authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])]), // set once, when a hand-created game is matched to a feed event; never cleared
      // locationName/locationAddress/arriveByTime are feed-owned but
      // coach-editable (see plan's "Coach edits vs. re-sync"): the feed
      // overwrites them on every content-hash change, so a hand correction
      // survives only until the next sync. No field-level override --
      // inherits coach read+update from the model-level grant below.
      locationName: a.string(), // "Martin Field 1"
      locationAddress: a.string(), // "3740 86th St., Urbandale, IA 50322"
      arriveByTime: a.datetime(), // parsed from "Arrive by 2:45 PM"
    })
    // Milestone B1 (Fan Mode): partition-key-only index for "this team's
    // games", used by get-fan-game-view's 4-branch game-selection algorithm
    // (shared/shareLinkAccess.ts). A sortKeys(['gameDate']) index was
    // considered and rejected -- gameDate is optional
    // (create-game-safe/handler.ts writes `gameDate ?? null`), and a
    // sort-key GSI omits every item where the sort attribute is absent,
    // which would make a dateless in-progress game invisible to Fan Mode.
    .secondaryIndexes((index) => [
      index('teamId').queryField('listGamesByTeamId'),
    ])
    .authorization((allow) => [
      // Create is intentionally routed through the Lambda-backed
      // createGameSafe mutation (TEAM-ARCHIVE-STEP11), so coaches-population
      // and (from Part 2) the archived-team check happen server-side. Delete
      // is separately disallowed on the model — use deleteGameSafe.
      allow.ownersDefinedIn('coaches').to(['read', 'update']),
    ]),

  PlayerAvailability: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      status: a.string().required(), // 'available', 'absent', 'injured', 'late-arrival'
      markedAt: a.datetime().required(), // When status was changed
      notes: a.string(), // Optional notes about availability
      availableFromMinute: a.integer(), // null = available from game start (0)
      availableUntilMinute: a.integer(), // null = available until game end
      coaches: a.string().array(), // Team coaches who can access this record
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access availability
    ]),

  GamePlan: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      rotationIntervalMinutes: a.integer().required(), // e.g., 5, 10, 15
      totalRotations: a.integer().required(), // Calculated based on half length
      startingLineup: a.json(), // Array of {playerId, positionId} for the starting lineup
      halftimeLineup: a.json(), // Array of {playerId, positionId} for the second-half starting lineup
      createdAt: a.datetime().required(),
      updatedAt: a.datetime().required(),
      coaches: a.string().array(), // Team coaches who can access this plan
      plannedRotations: a.hasMany('PlannedRotation', 'gamePlanId'),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access plans
    ]),

  PlannedRotation: a
    .model({
      gamePlanId: a.id().required(),
      gamePlan: a.belongsTo('GamePlan', 'gamePlanId'),
      rotationNumber: a.integer().required(), // 1, 2, 3, etc.
      gameMinute: a.integer().required(), // When this rotation should occur (e.g., 5, 10, 15)
      half: a.integer().required(), // 1 or 2
      plannedSubstitutions: a.json().required(), // Array of {playerOutId, playerInId, positionId}
      viewedAt: a.datetime(), // When coach last viewed this during game
      coaches: a.string().array(), // Team coaches who can access this rotation
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access rotations
    ]),

  LineupAssignment: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      positionId: a.id(),
      position: a.belongsTo('FieldPosition', 'positionId'),
      isStarter: a.boolean().required(),
      coaches: a.string().array(), // Team coaches who can access this assignment
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access lineups
    ]),

  Substitution: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerOutId: a.id().required(),
      playerOut: a.belongsTo('Player', 'playerOutId'),
      playerInId: a.id().required(),
      playerIn: a.belongsTo('Player', 'playerInId'),
      positionId: a.id(),
      position: a.belongsTo('FieldPosition', 'positionId'),
      gameSeconds: a.integer(),
      half: a.integer(),
      timestamp: a.datetime(),
      coaches: a.string().array(), // Team coaches who can access this substitution
    })
    // Milestone B1 (Fan Mode): same queryField treatment Milestone A gave
    // Goal -- get-fan-game-view's recentEvents derivation needs to reach
    // Substitution rows by gameId from a raw-SDK Lambda, and the implicit
    // relationship GSI has no queryField to reach it without a GraphQL
    // client. Same accepted GSI-backfill-window tradeoff already stated for
    // Goal/Shot/Save.
    .secondaryIndexes((index) => [
      index('gameId').queryField('listSubstitutionsByGameId'),
    ])
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access substitutions
    ]),

  PlayTimeRecord: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      positionId: a.id(),
      position: a.belongsTo('FieldPosition', 'positionId'),
      startGameSeconds: a.integer().required(), // Game time (elapsed seconds) when player entered field
      endGameSeconds: a.integer(), // Game time when player left field (null if still playing)
      coaches: a.string().array(), // Team coaches who can access this record
    })
    .secondaryIndexes((index) => [
      index('gameId').queryField('listPlayTimeRecordsByGameId'),
    ])
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access play time records
    ]),

  Goal: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      scoredByUs: a.boolean().required(), // true if our team scored, false if opponent
      gameSeconds: a.integer().required(), // Game time in seconds when goal was scored
      half: a.integer().required(), // 1 or 2
      scorerId: a.id(), // Player who scored (only if scoredByUs is true)
      scorer: a.belongsTo('Player', 'scorerId'),
      assistId: a.id(), // Player who assisted (optional)
      assist: a.belongsTo('Player', 'assistId'),
      notes: a.string(), // Any additional notes about the goal
      timestamp: a.datetime().required(), // Real-world timestamp when goal was recorded
      // a.enum() can't be .required() at the schema level (DynamoDB-side
      // constraint, not a TypeScript one) -- absent/undefined is treated as
      // COACH everywhere it's read (historical rows predate this field).
      // GoalCreateFields/ShotCreateFields/SaveCreateFields make this a
      // *required* TypeScript field so every new write path must pass it
      // explicitly instead of relying on discipline.
      loggedVia: a.enum(['COACH', 'HELPER']),
      coaches: a.string().array(), // Team coaches who can access this goal
    })
    .secondaryIndexes((index) => [
      index('gameId').queryField('listGoalsByGameId'),
    ])
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access goals
    ]),

  // Per-shot stat event, same template shape as Goal. takenByUs (not
  // scoredByUs) -- a shot isn't "scored"; this reads correctly next to
  // Goal.scoredByUs and Save.byUs without colliding in meaning with either.
  Shot: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerId: a.id(),
      player: a.belongsTo('Player', 'playerId'),
      takenByUs: a.boolean().required(),
      onTarget: a.boolean().required(),
      gameSeconds: a.integer().required(),
      half: a.integer().required(),
      timestamp: a.datetime().required(),
      loggedVia: a.enum(['COACH', 'HELPER']), // absent/undefined == COACH (legacy-safe default)
      coaches: a.string().array(),
    })
    .secondaryIndexes((index) => [index('gameId').queryField('listShotsByGameId')])
    .authorization((allow) => [allow.ownersDefinedIn('coaches')]),

  // Per-save stat event. byUs is symmetric with Shot.takenByUs -- without
  // it, "our keeper saved a shot" and "the opponent's keeper saved our shot"
  // are indistinguishable, which breaks any season-report split of
  // saves-for vs. saves-against. playerId stays optional (a save can be
  // logged before anyone identifies the keeper), but byUs is always
  // required.
  Save: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerId: a.id(), // goalkeeper, when known
      player: a.belongsTo('Player', 'playerId'),
      byUs: a.boolean().required(),
      gameSeconds: a.integer().required(),
      half: a.integer().required(),
      timestamp: a.datetime().required(),
      loggedVia: a.enum(['COACH', 'HELPER']),
      coaches: a.string().array(),
    })
    .secondaryIndexes((index) => [index('gameId').queryField('listSavesByGameId')])
    .authorization((allow) => [allow.ownersDefinedIn('coaches')]),

  GameNote: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      // Validation rule (enforced at resolver/service layer):
      // - noteType === 'coaching-point' => gameSeconds === null AND half === null
      // - noteType in ['gold-star', 'yellow-card', 'red-card', 'other'] => gameSeconds !== null AND half !== null
      // NOTE: a.enum() in Amplify Gen2 does not support .required() \u2014 enforced by TypeScript type system and Lambda handler instead.
      noteType: a.string().required(),
      playerId: a.id(), // Optional - can be associated with a player
      player: a.belongsTo('Player', 'playerId'),
      authorId: a.string(), // Cognito user id of coach that created the note
      gameSeconds: a.integer(), // null for pre-game notes; required for in-game notes
      half: a.integer(), // null for pre-game notes; required for in-game notes
      // NOTE: Amplify Gen2 schema DSL does not support maxLength on a.string().
      // The 500-character limit is enforced at two layers:
      //   1. UI: CreateEditNoteModal.tsx validates before submission.
      //   2. Server: createSecureGameNote / updateSecureGameNote Lambda handlers
      //      reject payloads where notes.length > 500.
      notes: a.string(), // The actual note text (max 500 chars — see comment above)
      editedAt: a.datetime(),
      editedById: a.string(),
      timestamp: a.datetime().required(), // Real-world timestamp when note was created
      coaches: a.string().array(), // Team coaches who can access this note
    })
    .authorization((allow) => [
      // Create/update are routed through custom Lambda-backed mutations so
      // author and payload integrity are enforced server-side.
      allow.ownersDefinedIn('coaches').to(['read']),
    ]),

  // Secure custom mutation for creating game notes with server-side validation.
  createSecureGameNote: a
    .mutation()
    .arguments({
      gameId: a.string().required(),
      noteType: a.string().required(), // required — validated in Lambda
      playerId: a.string(),
      // Optional argument accepted for backward compatibility; ignored server-side.
      authorId: a.string(),
      gameSeconds: a.integer(),
      half: a.integer(),
      notes: a.string().required(),
      timestamp: a.datetime(),
    })
    .returns(a.ref('GameNote'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createGameNote)),

  // Secure custom mutation for updating game notes with immutable authorId.
  updateSecureGameNote: a
    .mutation()
    .arguments({
      id: a.string().required(),
      noteType: a.string(),
      playerId: a.string(),
      notes: a.string(),
      // Any supplied value is rejected by the handler.
      authorId: a.string(),
    })
    .returns(a.ref('GameNote'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(updateGameNote)),

  deleteSecureGameNote: a
    .mutation()
    .arguments({
      id: a.string().required(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(deleteGameNote)),

  TeamInvitation: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      teamName: a.string(), // Denormalized team name for display during acceptance
      email: a.string().required(),
      role: a.enum(['OWNER', 'COACH', 'PARENT']),
      status: a.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED']),
      invitedBy: a.string().required(), // userId who sent invite
      invitedAt: a.datetime().required(),
      expiresAt: a.datetime().required(),
      acceptedAt: a.datetime(),
      acceptedBy: a.string(), // User ID of the person who accepted
      coaches: a.string().array(), // Team coaches who can manage invitations
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Team coaches can manage all invitations
    ])
    .secondaryIndexes((index) => [
      index('email').sortKeys(['status']).queryField('listInvitationsByEmail'),
    ]),

  BugReportRateLimit: a
    .model({
      userId: a.string().required(),
      hourBucket: a.string().required(), // ISO hour e.g. "2026-03-07T14"
      count: a.integer().required(),
      ttl: a.integer(), // Unix timestamp for DynamoDB TTL auto-expiry (2 hours)
    })
    .identifier(['userId', 'hourBucket'])
    .authorization((allow) => [
      // No client access — only Lambda IAM role accesses this table
      allow.authenticated().to([]),
    ]),

  // Custom mutation for accepting invitations with elevated permissions
  // NOTE: After deployment, run: .\scripts\fix-appsync-datasource.ps1
  acceptInvitation: a
    .mutation()
    .arguments({
      invitationId: a.string().required(),
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(acceptInvitation)), // Pass the imported function object directly

  // Custom query for getting current user's invitations
  getUserInvitations: a
    .query()
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(getUserInvitations)),

  // Custom mutation for filing a bug report as a GitHub Issue
  createGitHubIssue: a
    .mutation()
    .arguments({
      type: a.string().required(),
      severity: a.string().required(),
      description: a.string().required(),
      steps: a.string(),
      systemInfo: a.string(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createGitHubIssue)),

  // Secure custom mutation for deleting formations with authoritative team-reference guard.
  deleteFormationSafe: a
    .mutation()
    .arguments({
      formationId: a.string().required(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(deleteFormationSafe)),

  // Authoritative custom mutation for deleting games with safe-order cascade and rollback.
  deleteGameSafe: a
    .mutation()
    .arguments({
      gameId: a.string().required(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(deleteGameSafe)),

  // Authoritative custom mutation for deleting teams with safe-order cascade and rollback.
  deleteTeamSafe: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(deleteTeamSafe)),

  // Authoritative custom mutation for deleting players with safe-order cascade and rollback.
  deletePlayerSafe: a
    .mutation()
    .arguments({
      playerId: a.string().required(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(deletePlayerSafe)),

  // Owner-authorized team lifecycle mutations. The declared authorization is
  // only "must be signed in" — the real check is strict owner equality
  // (team.ownerId === callerSub) inside each handler, which Amplify's
  // declarative auth cannot express. Same shape as acceptInvitation.
  archiveTeam: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(archiveTeam)),

  restoreTeam: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(restoreTeam)),

  // First-come-first-served owner claim for legacy ownerless teams; any coach
  // already on the team may call it, and a conditional write in the handler
  // resolves concurrent claims.
  assignTeamOwner: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(assignTeamOwner)),

  // Coach-authorized cascade revoke (issue #162 / ISSUE-162-REVOKE-COACH-
  // ACCESS-CASCADE.md). The declared authorization is only "must be signed
  // in" -- the real check is caller-membership on the target team (any
  // existing coach may revoke any other coach, including the owner --
  // assign-team-owner's already-accepted tradeoff), re-evaluated on every
  // retry attempt inside the handler, not just once up front. Same shape as
  // archiveTeam/assignTeamOwner.
  revokeCoachAccess: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
      userId: a.string().required(), // the coach being revoked
    })
    .returns(a.ref('Team'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(revokeCoachAccess)),

  // Lambda-backed game creation (TEAM-ARCHIVE-STEP11). Derives `coaches`
  // from the team's own coaches array server-side rather than trusting a
  // client-supplied array (CLAUDE.md's standing coaches-population rule).
  // Also rejects creating a game against an archived team (Part 2).
  createGameSafe: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
      opponent: a.string().required(),
      isHome: a.boolean().required(),
      gameDate: a.datetime(),
    })
    .returns(a.ref('Game'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createGameSafe)),

  // Calendar Feed Import: minimal Lambda-only model holding the feed URL
  // itself, keyed directly by teamId (one row per team, enforced by the key
  // -- precedent: BugReportRateLimit's custom identifier). Round-2 revision
  // (architecture review Major A): the first draft gave coaches direct
  // ownersDefinedIn('coaches') read/write access, which turned out to be
  // exploitable (a caller who knows a teamId could plant a row the real
  // coaches couldn't see or remove) and silently locked out newly-accepted
  // co-coaches (accept-invitation's per-table coaches backfill doesn't know
  // about this model). No client of any kind reads or writes this model --
  // the coach never sees the URL again once entered; only
  // syncTeamCalendar/unlinkTeamCalendar touch it, via the DynamoDB SDK.
  CalendarFeed: a
    .model({
      teamId: a.id().required(),
      url: a.string().required(),
    })
    .identifier(['teamId'])
    .authorization((allow) => [allow.authenticated().to([])]), // no client grants at all

  // Non-model return shape for CalendarSyncResult.createdGames/updatedGames
  // below. Amplify Gen2's schema builder rejects `a.ref()` to a *model*
  // from inside a customType ("Cannot use .ref() to refer a model from a
  // custom type") -- a constraint that only surfaces at deploy time, via
  // `ampx pipeline-deploy`'s CDK assembly step, not via `tsc`, `vite build`,
  // or any local test. `a.ref('Game').array()` here originally shipped and
  // passed every local check before failing an actual deploy for exactly
  // this reason. This type duplicates Game's own scalar fields (no
  // relationships -- those are lazy loaders on a real Game query anyway,
  // never present on a raw Lambda-returned object) so syncTeamCalendar can
  // still return enough of each created/updated game for Home.tsx's
  // pendingCreatedGames overlay to render it immediately. Keep this field
  // list in sync with Game's own scalar fields above if those change.
  GameSyncSummary: a.customType({
    id: a.id().required(),
    teamId: a.id(),
    opponent: a.string(),
    isHome: a.boolean(),
    gameDate: a.datetime(),
    status: a.string(),
    currentHalf: a.integer(),
    elapsedSeconds: a.integer(),
    lastStartTime: a.string(),
    halfLengthMinutes: a.integer(),
    ourScore: a.integer(),
    opponentScore: a.integer(),
    coaches: a.string().array(),
    externalUid: a.string(),
    externalSource: a.string(),
    externalSequence: a.integer(),
    externalContentHash: a.string(),
    externalSyncedAt: a.datetime(),
    externalCancelled: a.boolean(),
    externalHomeAwayUnverified: a.boolean(),
    externalAdoptedAt: a.datetime(),
    locationName: a.string(),
    locationAddress: a.string(),
    arriveByTime: a.datetime(),
    createdAt: a.datetime(),
    updatedAt: a.datetime(),
  }),

  CalendarSyncResult: a.customType({
    createdGames: a.ref('GameSyncSummary').array(), // GameSyncSummary, not Game -- see the comment above
    updatedGames: a.ref('GameSyncSummary').array(),
    skippedCount: a.integer(),
    cancelledCount: a.integer(),
    adoptedCount: a.integer(), // hand-created games matched and linked to a feed event instead of duplicated
    protectedCount: a.integer(),
    failedCount: a.integer(),
    warnings: a.string().array(),
  }),

  // Calendar Feed Import: both entry points (pasted URL, uploaded .ics file)
  // call this same mutation -- parsing always happens server-side (Derived
  // Decision B), since Game create is Lambda-only regardless. `feedUrl`/
  // `saveFeedUrl` are the only way a CalendarFeed row is created or
  // replaced; omitting feedUrl re-syncs whatever row the Lambda already has
  // for the team. `dryRun` runs the identical reconciliation logic and
  // skips the write step, for the preview/confirm UI flow.
  syncTeamCalendar: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
      feedUrl: a.string(),
      icsContent: a.string(),
      saveFeedUrl: a.boolean(),
      dryRun: a.boolean(),
    })
    .returns(a.ref('CalendarSyncResult'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(syncTeamCalendar)),

  // Small dedicated Lambda mirroring the archiveTeam/restoreTeam pattern
  // (one purpose-specific function per action) rather than overloading
  // syncTeamCalendar with an unlink mode. Deletes the team's CalendarFeed
  // row and clears the five Team status fields; Game.external* fields on
  // already-imported games are left untouched.
  unlinkTeamCalendar: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.boolean())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(unlinkTeamCalendar)),

  QueuedSubstitution: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerId: a.id().required(), // Player to substitute IN
      positionId: a.id().required(), // Position they will play
      coaches: a.string().array(), // Team coaches who can access this record
    })
    .secondaryIndexes((index) => [
      index('gameId').queryField('listQueuedSubstitutionsByGameId'),
    ])
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'),
    ]),

  CoachProfile: a
    .model({
      firstName: a.string(),
      lastName: a.string(),
      shareLastNameWithCoaches: a.boolean().default(true),
      displayNameFull: a.string(), // Optional optimization: precomputed "FirstName LastInitial"
      displayNamePrivacy: a.string(), // Optional optimization: precomputed "FirstName only" form
    })
    .authorization((allow) => [
      // Owners (self) can do full CRUDL
      allow.ownersDefinedIn('id').to(['create', 'read', 'update', 'delete']),
    ]),

  // Custom mutation for upserting coach profile with normalization and concurrency handling
  upsertMyCoachProfile: a
    .mutation()
    .arguments({
      firstName: a.string(),
      lastName: a.string(),
      shareLastNameWithCoaches: a.boolean(),
      expectedUpdatedAt: a.string(), // ISO timestamp for optimistic concurrency
    })
    .returns(a.ref('CoachProfile'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(upsertCoachProfile)),

  // Custom query for fetching team coach profiles with membership check and no-scan guarantee
  getTeamCoachProfiles: a
    .query()
    .arguments({
      teamId: a.string().required(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(getTeamCoachProfiles)),

  // ── Milestone B1: Fan Mode (public read-only) ─────────────────────────
  //
  // Fully closed model, same rationale as CalendarFeed. No client (coach or
  // guest) ever reads/writes this table directly; every access goes through
  // a Lambda that does its own authorization/validation. Token is the
  // primary key for O(1) lookups. Field named `issuedAt`, not `createdAt`
  // -- avoids colliding with Amplify's auto-managed createdAt/updatedAt
  // timestamps (same reason Goal uses `timestamp` instead of `createdAt`).
  ShareLink: a
    .model({
      token: a.string().required(), // crypto.randomBytes(18).toString('base64url') -- NOT
                                     // nanoid, which isn't a dependency of this project.
      teamId: a.id().required(),
      type: a.enum(['FAN', 'STAT_TRACKER']),
      createdBy: a.string().required(), // coach Cognito sub
      issuedAt: a.datetime().required(),
      revokedAt: a.datetime(), // null = active
    })
    .identifier(['token'])
    .secondaryIndexes((index) => [index('teamId').queryField('listShareLinksByTeamId')])
    .authorization((allow) => [allow.authenticated().to([])]), // no client grants at all

  // Read-path rate limiting for getFanGameView, keyed on TWO independent
  // dimensions per request (see generate-share-link/get-fan-game-view
  // below): `identity#<cognitoIdentityId>` (the real per-viewer limit --
  // generous, ~30/min) and `token#<token>` (a per-team billing
  // circuit-breaker, ~600/min -- an attacker can mint fresh guest
  // identities trivially, so this is not the real abuse control). Keying
  // solely on the shared token (as an earlier draft did) would throttle out
  // most of a live game's actual audience within the first two minutes of
  // polling.
  FanViewRateLimit: a
    .model({
      limiterKey: a.string().required(), // "identity#<id>" or "token#<token>"
      minuteBucket: a.string().required(), // e.g. "2026-09-06T18:32"
      count: a.integer().required(),
      ttl: a.integer(), // DynamoDB TTL, ~10 min
    })
    .identifier(['limiterKey', 'minuteBucket'])
    .authorization((allow) => [allow.authenticated().to([])]),

  // Curated custom type for generateShareLink/listTeamShareLinks --
  // ShareLink is allow.authenticated().to([]) (zero client grants), so
  // a.ref('ShareLink') can't be returned directly (same reasoning as
  // CalendarFeed/CalendarSyncResult above).
  ShareLinkSummary: a.customType({
    token: a.string().required(),
    type: a.string(),
    issuedAt: a.datetime().required(),
    revokedAt: a.datetime(),
  }),

  generateShareLink: a
    .mutation()
    .arguments({ teamId: a.string().required(), type: a.string().required() })
    .returns(a.ref('ShareLinkSummary'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(generateShareLink)),

  revokeShareLink: a
    .mutation()
    .arguments({ token: a.string().required() })
    .returns(a.boolean())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(revokeShareLink)),

  listTeamShareLinks: a
    .query()
    .arguments({ teamId: a.string().required() })
    .returns(a.ref('ShareLinkSummary').array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(listTeamShareLinks)),

  // Curated read-only payload for Fan Mode -- deliberately anonymized
  // (first name + last INITIAL only, no playerId, no coach identities).
  // getStatTrackerView (Milestone B2) is a separate query/type with a
  // different, roster-including payload -- see the plan's "getFanGameView
  // stays FAN-only" decision. gameDate is required so the frontend can
  // distinguish "today's final" from a stale bye-week recency-window
  // fallback.
  FanOnFieldPlayer: a.customType({
    firstName: a.string().required(),
    lastInitial: a.string().required(),
    positionName: a.string(),
  }),

  FanRecentEvent: a.customType({
    type: a.string().required(), // 'GOAL' | 'SUBSTITUTION'
    playerName: a.string(),
    minute: a.integer(),
    half: a.integer(),
  }),

  FanGameViewResult: a.customType({
    // Discriminator for the frontend's named states -- see
    // shareLinkAccess.ts's SelectedGame branches.
    state: a.string().required(), // 'INVALID_LINK' | 'LIVE' | 'FINISHED' | 'NEXT_GAME' | 'NO_GAMES_YET' | 'NO_GAME_RIGHT_NOW' | 'RATE_LIMITED'
    teamName: a.string(),
    opponentName: a.string(),
    locationName: a.string(),
    status: a.string(),
    currentHalf: a.integer(),
    elapsedSeconds: a.integer(),
    lastStartTime: a.string(),
    halfLengthMinutes: a.integer(),
    ourScore: a.integer(),
    opponentScore: a.integer(),
    gameDate: a.datetime(),
    onFieldPlayers: a.ref('FanOnFieldPlayer').array(),
    recentEvents: a.ref('FanRecentEvent').array(),
  }),

  // Guest + authenticated(identityPool) -- allow.guest() ALONE only grants
  // the Identity Pool's unauthenticated role. A signed-in coach opening
  // their own freshly-generated link resolves to the AUTHENTICATED
  // Identity Pool role via fetchAuthSession(), which would not carry this
  // permission without the second grant, producing an Unauthorized error on
  // the single most likely first interaction with this feature. The query
  // is token-gated regardless of caller identity, so granting both roles
  // doesn't widen data exposure -- only who can reach the (already-narrow)
  // door.
  getFanGameView: a
    .query()
    .arguments({ token: a.string().required() })
    .returns(a.ref('FanGameViewResult'))
    .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
    .handler(a.handler.function(getFanGameView)),

  // ── Milestone B2: Sideline Stat Tracker (public write) ─────────────────
  //
  // Curated payload for the public /track/:token page -- deliberately NOT
  // shared with FanGameViewResult (see the "getFanGameView stays FAN-only"
  // decision in B1): this page needs the full active roster, playerIds
  // included, for the helper's own player picker, which is exactly the
  // gratuitous-identifier leak Fan Mode's anonymized payload avoids.
  // Field-layout visualization (Sideline Stat Tracker pitch view): the
  // resolved FormationPosition backing an on-field StatTrackerPlayer's
  // current open PlayTimeRecord. Plain-string `role` (NOT the
  // FormationPosition enum ref) -- mirrors the Lambda-side
  // `PositionRoleLike.role: string | null` pattern already used in
  // amplify/functions/shared/goalkeeper.ts.
  StatTrackerPosition: a.customType({
    id: a.string().required(),
    positionName: a.string(),
    abbreviation: a.string(),
    role: a.string(),
    sortOrder: a.integer(),
    xPct: a.integer(),
    yPct: a.integer(),
  }),

  StatTrackerPlayer: a.customType({
    id: a.string().required(),
    firstName: a.string().required(),
    lastName: a.string().required(),
    // Derived from an open PlayTimeRecord's FormationPosition (same
    // FormationPosition-not-FieldPosition source as activeGoalkeeperId below
    // -- see CLAUDE.md's "Goalkeeper role is keyed off FormationPosition"
    // note; get-fan-game-view's own onFieldPlayers lookup still uses the
    // dead FieldPosition table, a pre-existing drift this handler does NOT
    // repeat). null for a bench player (no open PlayTimeRecord) or whenever
    // the game isn't in-progress.
    positionName: a.string(),
    // TeamRoster.playerNumber, echoed through for the field-layout pitch
    // view's jersey-number-forward display and the player-picker sheet.
    // Nullable at the GraphQL level as a defensive measure even though
    // TeamRoster.playerNumber is `.required()` in the DB.
    playerNumber: a.integer(),
    // The full resolved FormationPosition for this player's currently-open
    // PlayTimeRecord, for the pitch layout to place/label this player with
    // (lane inference, abbreviation, persisted xPct/yPct). INVARIANT:
    // non-null if-and-only-if `positionName` above is non-null -- both are
    // populated under the exact same "has an open PlayTimeRecord" condition
    // in get-stat-tracker-view/handler.ts. Do not let them diverge.
    position: a.ref('StatTrackerPosition'),
  }),

  // Deliberately its own small type rather than reusing FanGameViewResult's
  // shape/name (which is a single selected game, not a list) -- see the
  // "getFanGameView stays FAN-only" decision this file already follows.
  StatTrackerUpcomingGame: a.customType({
    opponentName: a.string(),
    gameDate: a.string(),
    locationName: a.string(),
  }),

  StatTrackerViewResult: a.customType({
    // Same discriminator pattern as FanGameViewResult.state.
    state: a.string().required(), // 'INVALID_LINK' | 'RATE_LIMITED' | 'NO_GAMES_YET' | 'NO_GAME_RIGHT_NOW' | 'NEXT_GAME' | 'FINISHED' | 'LIVE'
    teamName: a.string(),
    opponentName: a.string(), // for the Us/Opponent tap-flow labels
    status: a.string(),
    currentHalf: a.integer(),
    // Game-clock fields, same shape/semantics as FanGameViewResult's --
    // src/utils/gameClock.ts's computeCurrentGameSeconds is the one true
    // conversion, shared by both pages' frontend tick effect.
    elapsedSeconds: a.integer(),
    lastStartTime: a.string(),
    halfLengthMinutes: a.integer(),
    ourScore: a.integer(),
    opponentScore: a.integer(),
    gameId: a.string(), // echoed back by the client as submitStatEvent's
                         // expectedGameId -- the wrong-game-race guard.
    roster: a.ref('StatTrackerPlayer').array(),
    // Id of the player currently occupying a GOALKEEPER-role position, per an
    // open PlayTimeRecord -- null when not in-progress, ambiguous, or the
    // team has no GOALKEEPER-role FormationPosition. See getCurrentGoalkeeperId
    // (src/utils/playTimeCalculations.ts, coach-side) and
    // computeActiveGoalkeeperId (amplify/functions/shared/goalkeeper.ts,
    // Lambda-side pure twin) -- same concept, two implementations, kept in
    // sync per CLAUDE.md's gameClock.ts precedent (see also goalkeeper.test.ts).
    activeGoalkeeperId: a.string(),
    // The team's next few scheduled games, soonest first -- populated
    // whenever there's no LIVE game right now (NEXT_GAME, NO_GAME_RIGHT_NOW,
    // NO_GAMES_YET) so a helper opening the link early sees what's coming up
    // instead of just a single next opponent. See shareLinkAccess.ts's
    // selectUpcomingGames.
    upcomingGames: a.ref('StatTrackerUpcomingGame').array(),
  }),

  // Guest + authenticated(identityPool) -- same rationale as getFanGameView:
  // a coach opening their own freshly-generated Stat Tracker link to
  // confirm it works is exactly as real a first-touch scenario here.
  getStatTrackerView: a
    .query()
    .arguments({ token: a.string().required() })
    .returns(a.ref('StatTrackerViewResult'))
    .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
    .handler(a.handler.function(getStatTrackerView)),

  SubmitStatEventResult: a.customType({
    ok: a.boolean().required(),
    // Set when ok === false. A plain a.boolean() return can't distinguish
    // these, and the UI needs to (rate-limited vs. link-revoked-mid-session
    // vs. game-ended-while-you-were-mid-tap are three different messages).
    reason: a.string(), // 'INVALID_LINK' | 'RATE_LIMITED' | 'GAME_NOT_LIVE' | 'GAME_CHANGED' | 'VALIDATION_FAILED'
  }),

  // The write path -- see amplify/functions/submit-stat-event/handler.ts
  // for the AppSync-write mechanism (generateClient<Schema>({ authMode:
  // 'iam' })) this depends on, and this file's own schema-level
  // `.authorization()` call below for the allow.resource() grant it needs.
  submitStatEvent: a
    .mutation()
    .arguments({
      token: a.string().required(),
      eventType: a.string().required(), // 'GOAL' | 'SHOT' | 'SAVE' -- validated
                                         // against this allowlist explicitly in
                                         // the handler; the arg type alone
                                         // doesn't enforce it.
      playerId: a.string(),       // scorer (GOAL), shooter (SHOT), keeper (SAVE) -- "Us" only
      assistPlayerId: a.string(), // optional, GOAL + "Us" only
      forUs: a.boolean().required(), // generic "this event belongs to our side" flag --
                                      // written to Goal.scoredByUs / Shot.takenByUs /
                                      // Save.byUs depending on eventType. Required, not
                                      // optional: a silent default would be a
                                      // score-corruption path.
      onTarget: a.boolean(), // SHOT only, both "Us" and "Opponent" -- required
                              // when eventType === 'SHOT', rejected otherwise.
      clientEventId: a.string(), // client-generated idempotency key (optional
                                  // but recommended) -- see the handler's dedup
                                  // comment.
      expectedGameId: a.string(), // the gameId the helper's UI last polled as
                                   // current (StatTrackerViewResult.gameId) --
                                   // the real guard against the wrong-game race,
                                   // not the (inert-by-construction) GAME_NOT_LIVE
                                   // check alone. Optional so a first-ever poll's
                                   // submission isn't blocked.
    })
    .returns(a.ref('SubmitStatEventResult'))
    .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
    .handler(a.handler.function(submitStatEvent)),
})
  // Milestone B2 validation spike (completed, live-verified against a real
  // deployed sandbox, since torn down) -- `allow.resource(fn).to(['create'])`
  // on a model's own `.authorization()` array does NOT exist in this
  // Amplify version: `resource` is only exposed at the SCHEMA level, and
  // that level's verb vocabulary is `['query', 'mutate', 'listen']` -- no
  // per-CRUD-verb distinction at all, at any level. This grant is therefore
  // schema-wide (every model) and verb-wide (mutate = create/update/delete
  // together) BY CONSTRUCTION, not a wiring oversight -- it cannot be
  // narrowed to Goal/Shot/Save-only or to create-only. The real narrowing
  // lives in submit-stat-event's own handler code: its fixed, reviewed
  // `.create()` call sites on Goal/Shot/Save are the actual security
  // boundary, not IAM -- the public mutation's arguments never let a caller
  // choose which underlying model/verb the handler's generateClient call
  // targets. This grant is IAM-role-scoped to submit-stat-event's own
  // Lambda execution role, not to guest/public callers directly.
  .authorization((allow) => [allow.resource(submitStatEvent).to(['mutate'])]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});

/*== STEP 2 ===============================================================
Go to your frontend source code. From your client-side code, generate a
Data client to make CRUDL requests to your table. (THIS SNIPPET WILL ONLY
WORK IN THE FRONTEND CODE FILE.)

Using JavaScript or Next.js React Server Components, Middleware, Server 
Actions or Pages Router? Review how to generate Data clients for those use
cases: https://docs.amplify.aws/gen2/build-a-backend/data/connect-to-API/
=========================================================================*/

/*
"use client"
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>() // use this Data client for CRUDL requests
*/

/*== STEP 3 ===============================================================
Fetch records from the database and use them in your frontend component.
(THIS SNIPPET WILL ONLY WORK IN THE FRONTEND CODE FILE.)
=========================================================================*/

/* For example, in a React component, you can use this snippet in your
  function's RETURN statement */
// const { data: todos } = await client.models.Todo.list()

// return <ul>{todos.map(todo => <li key={todo.id}>{todo.content}</li>)}</ul>
