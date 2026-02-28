# Triage Issues

Automatically triage OPEN issues: claim each one, investigate, attempt a fix, run tests, commit, and mark FIXED — or skip if the root cause cannot be safely resolved.

---

## Section 0 — Env check

Verify all three environment variables are set before doing anything else:

- If `APPSYNC_URL` is missing: `ERROR: APPSYNC_URL is not set. Find it in amplify_outputs.json at data.url, then run: export APPSYNC_URL=<value>`
- If `API_KEY` is missing: `ERROR: API_KEY is not set. Find it in amplify_outputs.json at data.api_key, then run: export API_KEY=<value>`
- If `AGENT_API_SECRET` is missing: `ERROR: AGENT_API_SECRET is not set. Ask the project owner for the value, then run: export AGENT_API_SECRET=<value>`

Stop immediately if any variable is missing — do not proceed to any other section.

Also verify the git working tree is clean:
```bash
git status --porcelain
```
If there are any uncommitted changes, print `ERROR: Working tree is not clean. Commit or stash your changes before running triage.` and stop. This prevents the loop from accidentally reverting unrelated in-progress work.

---

## Section 1 — Fetch issues

Query all OPEN issues from `$APPSYNC_URL` with header `x-api-key: $API_KEY`:

```graphql
query {
  listIssues(filter: { status: { eq: "OPEN" } }) {
    items {
      issueNumber
      severity
      description
      stepsToReproduce
      systemInfo
      createdAt
    }
  }
}
```

Sort results by severity: `high` → `medium` → `low` → `feature-request`, then by `issueNumber` ascending within each severity group.

Print a summary: `Found X OPEN issues to triage.`

If there are no OPEN issues, print `No open issues to triage.` and stop.

---

## Section 2 — Per-issue loop

For each issue in the sorted list, follow steps 2a through 2e in order.

### 2a — Claim IN_PROGRESS (do this first, before touching any code)

Mark the issue IN_PROGRESS immediately using variables to avoid injection from any special characters:

```json
{
  "query": "mutation UpdateStatus($n: Int!, $s: String!, $r: String) { updateIssueStatus(issueNumber: $n, status: $s, resolution: $r) }",
  "variables": {
    "n": <N>,
    "s": "IN_PROGRESS",
    "r": "SECRET:${AGENT_API_SECRET}|Agent triage started"
  }
}
```

Print: `→ Claimed Issue #<N> as IN_PROGRESS`

If this mutation fails (e.g. issue was already claimed), skip to the next issue.

### 2b — Investigate

Read the issue's `description`, `stepsToReproduce`, and `systemInfo`.

- Search the codebase for relevant files (use Grep and Read tools)
- Run `npm run test:run` to establish a passing baseline
- Print a brief (2-3 sentence) root cause hypothesis

### 2c — Skip criteria

Skip this issue (do not attempt a fix) if any of the following apply:

- The root cause cannot be identified from the codebase alone (e.g. requires live data or user reproduction)
- The issue requires user input or clarification before a fix is possible
- The issue is environment-specific (e.g. AWS infra, DNS, Cognito config) with no code change available
- The fix would require changes to infrastructure-only files (`amplify/backend.ts`, `amplify/data/resource.ts`, AWS console settings)
- Fixing it would require changes unrelated to the described issue

If skipping, print: `→ Skipping Issue #<N>: <one-line reason>`
Then continue to the next issue — do NOT revert to OPEN; leave it IN_PROGRESS for human review.

### 2d — Fix, test, commit

1. Make the minimal code change needed to fix the issue. Do not refactor unrelated code.
2. Run `npm run test:run`. If any test fails:
   - Revert your changes (`git checkout -- .`)
   - Print: `→ Skipping Issue #<N>: fix introduced test failures — reverted`
   - Continue to the next issue
3. If all tests pass, commit with:
   ```
   git commit -m "fix: <one-line description of fix>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```
4. Capture the short SHA: `SHA=$(git rev-parse --short HEAD)`

### 2e — Mark FIXED

```json
{
  "query": "mutation UpdateStatus($n: Int!, $s: String!, $r: String) { updateIssueStatus(issueNumber: $n, status: $s, resolution: $r) }",
  "variables": {
    "n": <N>,
    "s": "FIXED",
    "r": "SECRET:${AGENT_API_SECRET}|Fixed in ${SHA}: <one-line description matching the commit message>"
  }
}
```

Print: `✓ Issue #<N> marked FIXED (commit ${SHA})`

---

## Section 3 — Summary

After processing all issues, print a summary table:

```
Issue | Result  | Detail
------|---------|--------------------------------------------------
#42   | FIXED   | abc1234: corrected null check in substitution service
#17   | SKIPPED | requires live game data to reproduce
#8    | SKIPPED | fix introduced test failures — reverted
```

Then print:
```
Triage complete: X fixed, Y skipped.
```

---

## Constraints

- **Never** set status to `CLOSED` or `DEPLOYED` — these require developer sign-off in the dashboard
- **Never** mark an issue as FIXED without:
  1. All tests passing after your change
  2. A committed git SHA to reference
- **Never** print `AGENT_API_SECRET` in any output — redact it as `***` if shown in debug/curl commands
- **Never** commit changes unrelated to the issue being triaged
- **Never** use `--no-verify` to skip git hooks
