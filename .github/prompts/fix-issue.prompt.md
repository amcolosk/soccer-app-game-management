---
mode: agent
tools:
  - run_in_terminal
description: Mark a specific issue as FIXED using the current git commit SHA.
---

# Fix Issue

Mark a specific issue as FIXED using the current git commit SHA.

**Usage:** Provide the issue number when invoking this prompt (e.g. "fix issue 42").

## Steps

1. **Validate argument** — An issue number (positive integer) must be provided. If missing or non-numeric, print:
   ```
   Usage: fix-issue <issueNumber>
   Example: fix-issue 42
   ```
   Then stop.

2. **Env check** — Load `.env.local` to set env vars into the current session:
   ```powershell
   Get-Content .env.local | ForEach-Object {
     if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
       [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
     }
   }
   ```
   Then verify `APPSYNC_URL`, `API_KEY`, and `AGENT_API_SECRET` are all set. If any is missing, stop and print the appropriate error:
   - `APPSYNC_URL` missing: `ERROR: APPSYNC_URL is not set. Find it in amplify_outputs.json at data.url`
   - `API_KEY` missing: `ERROR: API_KEY is not set. Find it in amplify_outputs.json at data.api_key`
   - `AGENT_API_SECRET` missing: `ERROR: AGENT_API_SECRET is not set. Ask the project owner for the value and add it to .env.local`

3. **Capture commit info** — Run:
   ```powershell
   $sha = git rev-parse --short HEAD
   $msg = git log -1 --pretty=%s
   ```
   Print the SHA and commit message so the user can confirm they are correct.

4. **Confirmation prompt** — Ask the user to confirm before proceeding:
   ```
   About to mark Issue #<N> as FIXED with commit <SHA>: "<MSG>"
   Confirm? (yes to proceed)
   ```
   If the user does not confirm with "yes", print `Cancelled.` and stop.

5. **Call updateIssueStatus** — Make a GraphQL mutation using PowerShell:
   ```powershell
   $body = @{
     query = "mutation UpdateStatus(`$n: Int!, `$s: String!, `$r: String) { updateIssueStatus(issueNumber: `$n, status: `$s, resolution: `$r) }"
     variables = @{
       n = <N>
       s = "FIXED"
       r = "SECRET:$env:AGENT_API_SECRET|Fixed in $sha`: $msg"
     }
   } | ConvertTo-Json -Depth 3

   $result = Invoke-RestMethod -Uri $env:APPSYNC_URL -Method Post `
     -Headers @{ 'x-api-key' = $env:API_KEY; 'Content-Type' = 'application/json' } `
     -Body $body
   ```
   **IMPORTANT**: Never print `AGENT_API_SECRET` in plain text — redact it as `***` in any displayed output.

6. **Report result** — On success, print:
   ```
   ✓ Issue #<N> marked FIXED (commit <SHA>)
   ```
   On API error, print the error message from the response.
