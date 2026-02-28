# List Open Issues

Fetch and display all OPEN and IN_PROGRESS issues from the TeamTrack issue tracker, sorted by severity and issue number.

## Steps

1. **Env check** — Verify that `APPSYNC_URL` and `API_KEY` are set in the environment. If either is missing, stop immediately and print:
   - If `APPSYNC_URL` is missing: `ERROR: APPSYNC_URL is not set. Find it in amplify_outputs.json at data.url, then run: export APPSYNC_URL=<value>`
   - If `API_KEY` is missing: `ERROR: API_KEY is not set. Find it in amplify_outputs.json at data.api_key, then run: export API_KEY=<value>`

2. **Fetch issues** — Make two GraphQL queries to `$APPSYNC_URL` with header `x-api-key: $API_KEY`:

   Query 1 — OPEN issues:
   ```graphql
   query {
     listIssues(filter: { status: { eq: OPEN } }) {
       items {
         issueNumber
         severity
         status
         description
         createdAt
       }
     }
   }
   ```

   Query 2 — IN_PROGRESS issues:
   ```graphql
   query {
     listIssues(filter: { status: { eq: IN_PROGRESS } }) {
       items {
         issueNumber
         severity
         status
         description
         createdAt
       }
     }
   }
   ```

3. **Merge and sort** — Combine both result sets. Sort by:
   - Severity order: `high` → `medium` → `low` → `feature-request`
   - Within the same severity, sort by `issueNumber` ascending (oldest first)

4. **Display as table** — Print a formatted table with columns:
   ```
   #    | Sev            | Status      | Age       | Description
   -----|----------------|-------------|-----------|-------------------------------------------
   42   | high           | OPEN        | 3d        | Button click crashes the app on iOS (tru...
   17   | medium         | IN_PROGRESS | 12h       | Timer doesn't pause at halftime correctly
   ```
   - **#**: issueNumber
   - **Sev**: severity value as-is
   - **Status**: status value
   - **Age**: time since `createdAt` — show `Xd` for days, `Xh` for hours (use whichever is most readable)
   - **Description**: first 80 characters of description, truncated with `...` if longer

5. **Print summary** after the table:
   ```
   Total: X OPEN, Y IN_PROGRESS
   ```
