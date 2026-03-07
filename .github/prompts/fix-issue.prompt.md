---
mode: agent
tools: ['runInTerminal']
description: Mark a specific GitHub issue as fixed using the current HEAD commit SHA.
---

# Fix Issue

Mark a specific GitHub issue as fixed using the current HEAD commit SHA.

**Usage:** Provide the issue number when invoking this prompt (e.g. "fix issue 42").

## Steps

1. **Validate argument** - An issue number (positive integer) must be provided. If missing or non-numeric, print usage and stop.

2. **Env check** - Verify `GITHUB_TOKEN` and `GITHUB_REPO` are set. If either is missing, stop and print a named error.

3. **Capture commit info** - Run:
   ```powershell
   $sha = git rev-parse --short HEAD
   $msg = git log -1 --pretty=%s
   ```
   Print the SHA and message so the user can confirm.

4. **Confirmation prompt** - Ask the user to confirm before writing. Stop if not confirmed.

5. **Update issue** - Set `$env:GH_TOKEN = $env:GITHUB_TOKEN`, then:
   ```powershell
   gh issue edit <N> --repo $env:GITHUB_REPO `
     --add-label "status:fixed" `
     --remove-label "status:in-progress"
   gh issue comment <N> --repo $env:GITHUB_REPO `
     --body "Fixed in $sha: $msg"
   ```

6. **Report result** - On success print confirmation with SHA. On error print gh output.

> Do **not** print `GITHUB_TOKEN` in any output.
