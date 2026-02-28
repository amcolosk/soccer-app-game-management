# Fix Issue

Mark a specific issue as FIXED using the current git commit SHA.

Usage: `/fix-issue <issueNumber>`

## Steps

1. **Validate argument** — `$ARGUMENTS` must be a positive integer. If it is missing, empty, or non-numeric, print:
   ```
   Usage: /fix-issue <issueNumber>
   Example: /fix-issue 42
   ```
   Then stop.

2. **Env check** — Verify that `APPSYNC_URL`, `API_KEY`, and `AGENT_API_SECRET` are set. If any is missing, stop immediately and print:
   - If `APPSYNC_URL` is missing: `ERROR: APPSYNC_URL is not set. Find it in amplify_outputs.json at data.url`
   - If `API_KEY` is missing: `ERROR: API_KEY is not set. Find it in amplify_outputs.json at data.api_key`
   - If `AGENT_API_SECRET` is missing: `ERROR: AGENT_API_SECRET is not set. Ask the project owner for the value, then run: export AGENT_API_SECRET=<value>`

3. **Capture commit info** — Run:
   ```bash
   SHA=$(git rev-parse --short HEAD)
   MSG=$(git log -1 --pretty=%s)
   ```
   Print the SHA and commit message so the user can confirm they are correct.

4. **Confirmation prompt** — Print:
   ```
   About to mark Issue #<N> as FIXED with commit <SHA>: "<MSG>"
   Type "yes" to confirm, anything else to cancel:
   ```
   Wait for user input. If the user does not answer exactly `yes`, print `Cancelled.` and stop.

5. **Call updateIssueStatus** — Make a GraphQL mutation to `$APPSYNC_URL` using variables to avoid injection from special characters in the commit message:
   ```json
   {
     "query": "mutation UpdateStatus($n: Int!, $s: String!, $r: String) { updateIssueStatus(issueNumber: $n, status: $s, resolution: $r) }",
     "variables": {
       "n": <N>,
       "s": "FIXED",
       "r": "SECRET:${AGENT_API_SECRET}|Fixed in ${SHA}: ${MSG}"
     }
   }
   ```
   Use header `x-api-key: $API_KEY`.

   **IMPORTANT**: Never print `AGENT_API_SECRET` in plain text — redact it as `***` in any displayed curl commands or debug output.

6. **Report result** — On success, print:
   ```
   ✓ Issue #<N> marked FIXED (commit <SHA>)
   ```
   On API error, print the error message from the response.
