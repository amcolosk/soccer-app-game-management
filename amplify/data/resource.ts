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
      teams: a.hasMany('Team', 'seasonId'),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  Team: a
    .model({
      name: a.string().required(),
      seasonId: a.id().required(),
      season: a.belongsTo('Season', 'seasonId'),
      maxPlayersOnField: a.integer().required(),
      formation: a.string(), // e.g., "4-3-3", "4-4-2"
      players: a.hasMany('Player', 'teamId'),
      positions: a.hasMany('FieldPosition', 'teamId'),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  Player: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      firstName: a.string().required(),
      lastName: a.string().required(),
      playerNumber: a.integer().required(),
      preferredPosition: a.string(),
      isActive: a.boolean().default(true),
    })
    .authorization((allow) => [allow.publicApiKey()]),

  FieldPosition: a
    .model({
      teamId: a.id().required(),
      team: a.belongsTo('Team', 'teamId'),
      positionName: a.string().required(), // e.g., "Forward", "Midfielder", "Defender", "Goalkeeper"
      abbreviation: a.string(), // e.g., "FW", "MF", "DF", "GK"
      sortOrder: a.integer(),
    })
    .authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    // API Key is used for a.allow.public() rules
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
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
