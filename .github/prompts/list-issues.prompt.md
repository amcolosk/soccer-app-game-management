---
mode: agent
tools:
  - run_in_terminal
description: Fetch and display all OPEN and IN_PROGRESS issues from the TeamTrack issue tracker, sorted by severity and issue number.
---

# List Open Issues

Fetch and display all OPEN and IN_PROGRESS issues from the TeamTrack issue tracker.

## Steps

1. **Env check** — Load `.env.local` to set `APPSYNC_URL` and `API_KEY` into the current session:
   ```powershell
   Get-Content .env.local | ForEach-Object {
     if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
       [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
     }
   }
   ```
   If either variable is still missing after loading, stop and print an error directing the user to check `.env.local` and `amplify_outputs.json`.

2. **Fetch issues** — Make two GraphQL POST requests to `$env:APPSYNC_URL` with header `x-api-key: $env:API_KEY`:

   - Filter `status: { eq: OPEN }`
   - Filter `status: { eq: IN_PROGRESS }`

   Fields to retrieve: `issueNumber`, `severity`, `status`, `description`, `createdAt`

3. **Merge and sort** — Combine both result sets. Sort by:
   - Severity order: `high` → `medium` → `low` → `feature-request`
   - Within the same severity, sort by `issueNumber` ascending (oldest first)

4. **Display as table** — Print a formatted table:
   ```
   #     | Sev             | Status      | Age   | Description
   ------|-----------------|-------------|-------|------------------------------------------------------------
   42    | high            | OPEN        | 3d    | Button click crashes the app on iOS (tru...
   17    | medium          | IN_PROGRESS | 12h   | Timer doesn't pause at halftime correctly
   ```
   - **#**: issueNumber
   - **Sev**: severity as-is
   - **Status**: status value
   - **Age**: `Xd` for days, `Xh` for hours since `createdAt`
   - **Description**: first 80 characters, truncated with `...` if longer

5. **Print summary** after the table:
   ```
   Total: X OPEN, Y IN_PROGRESS
   ```
