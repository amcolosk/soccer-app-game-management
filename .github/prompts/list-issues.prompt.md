---
mode: agent
tools: ['runInTerminal']
description: Fetch and display all open TeamTrack bug reports from GitHub Issues.
---

# List Open Issues

Fetch and display open TeamTrack bug reports from GitHub Issues.

## Steps

1. **Env check** - Verify `GITHUB_TOKEN` and `GITHUB_REPO` are set. If either is missing, print a clear error naming the absent variable and stop. Do not print the token value.

2. **Fetch issues** - Run:
   ```powershell
   $env:GH_TOKEN = $env:GITHUB_TOKEN
   gh issue list --repo $env:GITHUB_REPO `
     --label bug `
     --state open `
     --json number,title,labels,createdAt `
     --limit 100
   ```

3. **Sort** - By severity label: `severity:high` first, then `severity:medium`, `severity:low`, then issue number ascending.

4. **Display as table**:
   ```
   #  | Sev    | Status       | Age  | Title (first 70 chars)
   ---|--------|--------------|------|-----------------------------
   42 | high   | in-progress  | 2d   | Timer resets at halftime
   17 | medium | open         | 5h   | Player select shows wrong list
   ```
   - **#**: issue number
   - **Sev**: highest `severity:*` label, or `unknown` if absent
   - **Status**: `in-progress` if the issue has a `status:in-progress` label, else `open`
   - **Age**: time since `createdAt` - Xd for days, Xh for hours
   - **Title**: first 70 chars, truncated with `...` if longer

5. **Print summary** after the table:
   ```
   Total - open: N, in-progress: N
   ```

> Do **not** print `GITHUB_TOKEN` in any output.
