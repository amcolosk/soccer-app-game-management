import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/*== Soccer Game Management App Schema ===================================
This schema defines the data models for a soccer coaching app:
- Season: Contains teams for a specific season
- Team: Has players, formation, and field configuration
- Player: Individual player on a team roster
- FieldPosition: Positions used in the team's formation
=========================================================================*/
const schema = a.schema({
  Season: a
    .model({
      name: a.string().required(),
      year: a.string().required(),
      startDate: a.date(),
      endDate: a.date(),
      isArchived: a.boolean().default(false),
      teams: a.hasMany('Team', 'seasonId'),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

  Formation: a
    .model({
      name: a.string().required(), // e.g., "4-3-3", "3-5-2"
      playerCount: a.integer().required(), // Number of field players in this formation
      positions: a.hasMany('FormationPosition', 'formationId'),
      teams: a.hasMany('Team', 'formationId'),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

  FormationPosition: a
    .model({
      formationId: a.id().required(),
      formation: a.belongsTo('Formation', 'formationId'),
      positionName: a.string().required(), // e.g., "Left Forward", "Center Midfielder"
      abbreviation: a.string().required(), // e.g., "LF", "CM"
      sortOrder: a.integer(), // Display order for the position
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

  Team: a
    .model({
      name: a.string().required(),
      seasonId: a.id().required(),
      season: a.belongsTo('Season', 'seasonId'),
      formationId: a.id(),
      formation: a.belongsTo('Formation', 'formationId'),
      maxPlayersOnField: a.integer().required(),
      halfLengthMinutes: a.integer().default(30),
      roster: a.hasMany('TeamRoster', 'teamId'),
      positions: a.hasMany('FieldPosition', 'teamId'),
      games: a.hasMany('Game', 'teamId'),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

  Player: a
    .model({
      firstName: a.string().required(),
      lastName: a.string().required(),
      isActive: a.boolean().default(true),
      teamRosters: a.hasMany('TeamRoster', 'playerId'),
      lineupAssignments: a.hasMany('LineupAssignment', 'playerId'),
      substitutionsOut: a.hasMany('Substitution', 'playerOutId'),
      substitutionsIn: a.hasMany('Substitution', 'playerInId'),
      playTimeRecords: a.hasMany('PlayTimeRecord', 'playerId'),
      goalsScored: a.hasMany('Goal', 'scorerId'),
      assists: a.hasMany('Goal', 'assistId'),
      gameNotes: a.hasMany('GameNote', 'playerId'),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

  TeamRoster: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      playerNumber: a.integer().required(),
      preferredPositions: a.string(), // Comma-separated formation position IDs
      isActive: a.boolean().default(true),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

  FieldPosition: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      positionName: a.string().required(), // e.g., "Forward", "Midfielder", "Defender", "Goalkeeper"
      abbreviation: a.string(), // e.g., "FW", "MF", "DF", "GK"
      sortOrder: a.integer(),
      lineupAssignments: a.hasMany('LineupAssignment', 'positionId'),
      substitutions: a.hasMany('Substitution', 'positionId'),
      playTimeRecords: a.hasMany('PlayTimeRecord', 'positionId'),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

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
      lineupAssignments: a.hasMany('LineupAssignment', 'gameId'),
      substitutions: a.hasMany('Substitution', 'gameId'),
      playTimeRecords: a.hasMany('PlayTimeRecord', 'gameId'),
      goals: a.hasMany('Goal', 'gameId'),
      gameNotes: a.hasMany('GameNote', 'gameId'),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

  LineupAssignment: a
    .model({
      gameId: a.id().required(),
      game: a.belongsTo('Game', 'gameId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      positionId: a.id(),
      position: a.belongsTo('FieldPosition', 'positionId'),
      isStarter: a.boolean().required(),
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

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
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

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
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

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
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),

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
      owner: a.string().authorization((allow) => [allow.owner().to(['read', 'delete'])]),
    })
    .authorization((allow) => [allow.owner()]),
});

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
