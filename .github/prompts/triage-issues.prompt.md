---
mode: agent
tools: ['runInTerminal']
description: Full automated triage loop - investigate open issues, fix what is possible, mark fixed with commit SHA.
---

# Triage Issues

Automated triage loop: fetch open bugs, analyse against the codebase, fix what is possible, mark each issue fixed with a commit SHA.

## 0. Environment check

Verify `GITHUB_TOKEN` and `GITHUB_REPO` are set. Set `$env:GH_TOKEN = $env:GITHUB_TOKEN`. Stop with a named error if either is missing.

## 1. Fetch open bugs

```powershell
gh issue list --repo $env:GITHUB_REPO `
  --label bug `
  --state open `
  --json number,title,labels,body,createdAt `
  --limit 50
```

Sort by severity: `severity:high` first, then `severity:medium`, `severity:low`, then issue number ascending.
If no open issues, print "No open issues found." and stop.

## 2. For each issue (high severity first)

### 2a. Claim

```powershell
gh issue edit {number} --repo $env:GITHUB_REPO --add-label "status:in-progress"
gh issue comment {number} --repo $env:GITHUB_REPO --body "Claiming for investigation"
```

### 2b. Investigate

- Read description, steps, and system info from the issue body
- Search the codebase for relevant files
- Run `npm run test:run` to confirm baseline passes

### 2c. Determine fixability

SKIP with a comment if:
- Cannot identify root cause from description + codebase
- Fix requires a product decision or user clarification
- Requires live AWS infrastructure to reproduce
- Environment-specific issue (browser bug, network issue)

```powershell
gh issue comment {number} --repo $env:GITHUB_REPO --body "Skipping - {reason}. Developer investigation required."
```

### 2d. Fix and commit

- Implement the minimal fix
- Run `npm run test:run` - revert and skip if tests fail
- `git commit -m "fix: {description}"`
- `$sha = git rev-parse --short HEAD`

### 2e. Mark fixed

```powershell
gh issue edit {number} --repo $env:GITHUB_REPO `
  --add-label "status:fixed" `
  --remove-label "status:in-progress"
gh issue comment {number} --repo $env:GITHUB_REPO `
  --body "Fixed in $sha: {one-line description}"
```

## 3. Summary

Print a table:
```
Issue # | Result  | SHA or Skip Reason
--------|---------|----------------------------
42      | FIXED   | abc1234
17      | SKIPPED | Cannot reproduce without prod data
```

## Constraints

- Never close an issue
- Never mark fixed without a committed code change and passing tests
- The fix comment must always include the commit SHA
- Never commit changes unrelated to the issue being fixed
- Do **not** print `GITHUB_TOKEN` in any output
