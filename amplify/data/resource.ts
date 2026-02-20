import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { acceptInvitation } from "../functions/accept-invitation/resource";
import { getUserInvitations } from "../functions/get-user-invitations/resource";
import { sendBugReport } from "../functions/send-bug-report/resource";
import { updateIssueStatus } from "../functions/update-issue-status/resource";

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
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Full access for coaches
    ]),

  FormationPosition: a
    .model({
      formationId: a.id().required(),
      formation: a.belongsTo('Formation', 'formationId'),
      positionName: a.string().required(), // e.g., "Left Forward", "Center Midfielder"
      abbreviation: a.string().required(), // e.g., "LF", "CM"
      sortOrder: a.integer(), // Display order for the position
      coaches: a.string().array(), // Array of user IDs who can access this formation position
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
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Full access for coaches
    ]),

  Player: a
    .model({
      firstName: a.string().required(),
      lastName: a.string().required(),
      isActive: a.boolean().default(true),
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
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access players
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
      ourScore: a.integer().default(0),
      opponentScore: a.integer().default(0),
      coaches: a.string().array(), // Team coaches who can access this game
      lineupAssignments: a.hasMany('LineupAssignment', 'gameId'),
      substitutions: a.hasMany('Substitution', 'gameId'),
      playTimeRecords: a.hasMany('PlayTimeRecord', 'gameId'),
      goals: a.hasMany('Goal', 'gameId'),
      gameNotes: a.hasMany('GameNote', 'gameId'),
      playerAvailability: a.hasMany('PlayerAvailability', 'gameId'),
      gamePlan: a.hasOne('GamePlan', 'gameId'),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access games
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
      coaches: a.string().array(), // Team coaches who can access this goal
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access goals
    ]),

  GameNote: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      noteType: a.string().required(), // 'gold-star', 'yellow-card', 'red-card', 'other'
      playerId: a.id(), // Optional - can be associated with a player
      player: a.belongsTo('Player', 'playerId'),
      gameSeconds: a.integer().required(), // Game time in seconds when note was created
      half: a.integer().required(), // 1 or 2
      notes: a.string(), // The actual note text
      timestamp: a.datetime().required(), // Real-world timestamp when note was created
      coaches: a.string().array(), // Team coaches who can access this note
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('coaches'), // Only team coaches can access game notes
    ]),

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

  IssueCounter: a
    .model({
      counterName: a.string().required(), // e.g., "issue"
      currentValue: a.integer().required(),
    })
    .authorization((allow) => [
      // No client access — only Lambda IAM roles access this table
      allow.authenticated().to([]),
    ]),

  Issue: a
    .model({
      issueNumber: a.integer().required(),
      type: a.enum(['BUG', 'FEATURE_REQUEST']),
      severity: a.string(),
      status: a.enum(['OPEN', 'IN_PROGRESS', 'FIXED', 'DEPLOYED', 'CLOSED']),
      description: a.string().required(),
      steps: a.string(),
      systemInfo: a.string(),
      resolution: a.string(),
      closedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index('issueNumber').queryField('getIssueByNumber'),
    ])
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.publicApiKey().to(['read']),
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

  // Custom mutation for submitting bug reports via email
  submitBugReport: a
    .mutation()
    .arguments({
      description: a.string().required(),
      steps: a.string(),
      severity: a.string().required(),
      systemInfo: a.string(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(sendBugReport)),

  // Custom mutation for updating issue status (AI agent + authenticated users)
  updateIssueStatus: a
    .mutation()
    .arguments({
      issueNumber: a.integer().required(),
      status: a.string().required(),
      resolution: a.string(),
    })
    .returns(a.json())
    .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
    .handler(a.handler.function(updateIssueStatus)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
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
