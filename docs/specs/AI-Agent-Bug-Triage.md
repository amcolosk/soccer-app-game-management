# AI Agent Bug Triage Workflow

**Status:** Draft
**Scope:** Defines how a Claude Code agent can query open bug reports, claim issues for investigation, and mark them fixed. Agents are restricted to `IN_PROGRESS` and `FIXED`; `CLOSED` and `DEPLOYED` remain developer-only via the DevDashboard.

---

## Overview

A Claude Code agent can triage open bug reports by:

1. Listing `OPEN` and `IN_PROGRESS` issues via the existing AppSync API
2. Claiming an issue (`IN_PROGRESS`) to signal active investigation and prevent duplicate work
3. Locating and fixing the underlying code, running tests, and committing
4. Marking the issue `FIXED` with the commit SHA embedded in the resolution

The developer retains final authority. Only they can move an issue to `CLOSED` (won't fix / invalid / duplicate) or `DEPLOYED` (confirmed live in production). These transitions require human judgment and are blocked at the Lambda level for all API-key callers.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent-writable statuses | `IN_PROGRESS` and `FIXED` | Agent claims an issue before working on it (prevents two sessions fixing the same bug); marks done when committed |
| Developer-only statuses | `CLOSED` and `DEPLOYED` | Final sign-off and production verification require human judgment |
| Trigger | Manual slash command `/triage-issues` | Developer invokes deliberately; no automation surprises |
| Resolution format | Must contain a git commit SHA when setting `FIXED` | Creates a permanent audit trail linking issue to code; enforced in both the Lambda and agent prompt |
| Tool location | `.claude/commands/` slash commands | Native to Claude Code; no separate shell scripts to maintain |

---

## Agent Authority Model

```
Status        Agent can write    Developer can write (dashboard)
─────────     ───────────────    ──────────────────────────────
OPEN          ✗                  ✓  (reopen a closed issue)
IN_PROGRESS   ✓                  ✓
FIXED         ✓  (SHA required)  ✓
DEPLOYED      ✗                  ✓
CLOSED        ✗                  ✓
```

An agent attempting `CLOSED` or `DEPLOYED` receives an explicit `403`-style error from the Lambda. An agent attempting `FIXED` without a recognisable commit SHA in the resolution is also rejected.

If an agent claims an issue `IN_PROGRESS` but cannot fix it (unclear reproduction, out of scope, tests fail), it should leave the issue `IN_PROGRESS` and document why in a comment in the resolution field. The developer can reset it to `OPEN` via the dashboard.

---

## Lambda Changes (`update-issue-status/handler.ts`)

### Refactor: move `cleanResolution` extraction earlier

Currently `cleanResolution` is computed after the DynamoDB query. Both new validations need it before the query. Move the secret-stripping block immediately after the existing auth section.

### New validation 1 — agent status restriction

Added after auth, before the DynamoDB query:

```typescript
const AGENT_ALLOWED_STATUSES: readonly string[] = ['IN_PROGRESS', 'FIXED'];

if (!isAuthenticated && !AGENT_ALLOWED_STATUSES.includes(status)) {
  throw new Error(
    `Unauthorized: agents may only set IN_PROGRESS or FIXED. ` +
    `Use the developer dashboard to set ${status}.`
  );
}
```

This check runs _after_ the secret is validated, so a caller with a wrong secret still receives the generic auth error — the more informative status-restriction message is only reachable by authenticated agents.

### New validation 2 — commit SHA required for FIXED (agent callers)

```typescript
const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;

if (!isAuthenticated && status === 'FIXED') {
  if (!cleanResolution || !SHA_PATTERN.test(cleanResolution)) {
    throw new Error(
      'Resolution must include a git commit SHA when marking an issue as FIXED. ' +
      'Example: "Fixed in abc1234: corrected halftime timer calculation"'
    );
  }
}
```

A short SHA (7 chars, from `git rev-parse --short HEAD`) or a full 40-character SHA both pass. The SHA may appear anywhere in the resolution string.

Developers using the dashboard are not subject to either restriction — they may set any status and leave resolution blank.

---

## Slash Commands

### `/triage-issues`

**File:** `.claude/commands/triage-issues.md`

**What it does:** Full automated triage loop. Fetches open issues, analyses each against the codebase, fixes what it can, and marks them `FIXED`.

**Prompt content the file must contain:**

```
You are acting as the TeamTrack bug-triage agent. Follow these steps exactly.

## 0. Environment check
Verify APPSYNC_URL, API_KEY, and AGENT_API_SECRET are set in the environment.
If any are missing, print a clear error explaining which variable is absent
and how to find it (see docs/AGENT-ISSUE-MANAGEMENT.md), then stop.

## 1. Fetch open issues
Run:
  curl -s -X POST "$APPSYNC_URL" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{"query": "query { listIssues(filter: { status: { eq: \"OPEN\" } }) { items { issueNumber description severity type steps systemInfo createdAt } } }"}' \
    | jq '.data.listIssues.items | sort_by(.severity | if . == "high" then 0 elif . == "medium" then 1 elif . == "low" then 2 else 3 end)'

If there are no open issues, print "No open issues found." and stop.

## 2. For each issue (high severity first)

### 2a. Claim the issue
Set it IN_PROGRESS before touching any code:
  curl -s -X POST "$APPSYNC_URL" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "{\"query\": \"mutation { updateIssueStatus(issueNumber: $NUM, status: \\\"IN_PROGRESS\\\", resolution: \\\"SECRET:${AGENT_API_SECRET}|Investigating\\\") }\"}"

### 2b. Investigate
- Read the description, steps, and systemInfo carefully
- Search the codebase for the relevant files
- Run existing tests to confirm the baseline passes: npm run test:run

### 2c. Determine fixability
SKIP the issue (leave it IN_PROGRESS, log why) if:
- You cannot identify the root cause from the description and codebase alone
- The fix requires a product decision or user clarification
- Reproducing it requires live AWS infrastructure
- The issue appears to be environment-specific (browser bug, network issue)

### 2d. Fix and commit
- Implement the minimal fix (do not refactor surrounding code)
- Run tests again: npm run test:run
  - If tests fail, revert your changes and skip the issue
- Commit using the project convention:
    git commit -m "fix: <description>\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
- Capture the short SHA: SHA=$(git rev-parse --short HEAD)

### 2e. Mark FIXED
  curl -s -X POST "$APPSYNC_URL" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "{\"query\": \"mutation { updateIssueStatus(issueNumber: $NUM, status: \\\"FIXED\\\", resolution: \\\"SECRET:${AGENT_API_SECRET}|Fixed in ${SHA}: <one-line description>\\\") }\"}"

## 3. Summary
Print a table: issue number | result (FIXED / SKIPPED) | reason or SHA.

## Constraints
- Never set CLOSED or DEPLOYED
- Never mark FIXED without a committed code change and passing tests
- Never include AGENT_API_SECRET in any output, log, or commit message
- Never commit changes unrelated to the issue being fixed
- Redact the secret in any curl command you print to the terminal
```

---

### `/list-issues`

**File:** `.claude/commands/list-issues.md`

**What it does:** Reads and displays OPEN and IN_PROGRESS issues. No writes.

**Prompt content:**

```
Fetch and display all OPEN and IN_PROGRESS issues from the bug tracker.

First verify APPSYNC_URL and API_KEY are set. If not, print an error and stop.

Run two queries — one for each status — then merge, de-duplicate, and sort:
  high → medium → low → feature-request, then by issueNumber ascending.

Display as a table:
  #  | Sev    | Status      | Age   | Description (first 80 chars)
  ---|--------|-------------|-------|-----------------------------
  12 | high   | OPEN        | 2d    | Timer resets unexpectedly at halftime
   8 | medium | IN_PROGRESS | 5h    | Player select shows wrong options

"Age" is time since createdAt, formatted as Xd or Xh.

After the table, print the total count of OPEN and IN_PROGRESS issues separately.
```

---

### `/fix-issue`

**File:** `.claude/commands/fix-issue.md`

**What it does:** Marks a single already-fixed issue as `FIXED` using the current HEAD SHA. Use this after manually fixing and committing, when the full `/triage-issues` loop isn't appropriate.

**Prompt content:**

```
Mark a specific issue as FIXED using the current HEAD commit.

Usage: /fix-issue <issue-number>
Arguments: $ARGUMENTS

Steps:
1. Validate that $ARGUMENTS is a positive integer. If not, print:
   "Usage: /fix-issue <issue-number>  (e.g. /fix-issue 12)"
   and stop.

2. Verify APPSYNC_URL, API_KEY, and AGENT_API_SECRET are set. Stop with an
   error message if any are missing.

3. Get the current HEAD SHA:
     SHA=$(git rev-parse --short HEAD)
   Get the commit message:
     MSG=$(git log -1 --pretty=%s)

4. Confirm with the user before writing:
   "About to mark issue #$ARGUMENTS as FIXED with resolution:
    'Fixed in <SHA>: <MSG>'
   Proceed? (yes/no)"
   Stop if the answer is not "yes".

5. Call updateIssueStatus:
   curl -s -X POST "$APPSYNC_URL" \
     -H "Content-Type: application/json" \
     -H "x-api-key: $API_KEY" \
     -d "{\"query\": \"mutation { updateIssueStatus(issueNumber: $ARGUMENTS, status: \\\"FIXED\\\", resolution: \\\"SECRET:${AGENT_API_SECRET}|Fixed in ${SHA}: ${MSG}\\\") }\"}"

6. Parse and print the result. On success: "✓ Issue #$ARGUMENTS marked FIXED".
   On error: print the error message from the API response.

Never print AGENT_API_SECRET in any output.
```

---

## Environment Setup

Three variables must be available in the shell where Claude Code is running:

| Variable | Where to find it |
|----------|-----------------|
| `APPSYNC_URL` | `amplify_outputs.json` → `data.url` |
| `API_KEY` | `amplify_outputs.json` → `data.api_key` |
| `AGENT_API_SECRET` | AWS environment / local `.env.local` (never committed) |

Add them to `.env.local` (already gitignored) and source before starting Claude Code:

```bash
# .env.local  — never commit this file
export APPSYNC_URL=https://xxxxxxxxxx.appsync-api.us-east-1.amazonaws.com/graphql
export API_KEY=da2-xxxxxxxxxxxxxxxxxxxx
export AGENT_API_SECRET=your-secret-here
```

```bash
source .env.local && claude
```

The slash commands perform an environment check as their first step and exit with a clear error if any variable is missing, so a misconfigured session fails fast rather than silently sending unauthenticated requests.

---

## Security

- **`AGENT_API_SECRET` must never appear in any output.** All slash command prompts instruct Claude to redact the secret in any curl commands printed to the terminal (replace with `***`).
- **Fail-closed restriction.** The Lambda rejects agent callers from `CLOSED` and `DEPLOYED` regardless of the secret. A compromised secret cannot be used to close or deploy issues.
- **SHA requirement prevents content-free FIXED marks.** An agent cannot mark an issue fixed without evidence of a commit.
- **Stale IN_PROGRESS recovery.** If an agent session crashes after claiming an issue `IN_PROGRESS`, the issue remains claimed. The developer must reset it to `OPEN` via the dashboard. This is a known limitation (see Out of Scope).

---

## Tests

### Unit tests — Lambda

Add to the existing `handler.test.ts`, inside `describe('handler – API key / agent caller', ...)`:

#### Agent status restriction

```
it('throws when agent attempts to set CLOSED')
  setup:  AGENT_API_SECRET='tok', status='CLOSED',
          resolution='SECRET:tok|reason'
  expect: rejects with 'Unauthorized: agents may only set IN_PROGRESS or FIXED'

it('throws when agent attempts to set DEPLOYED')
  same pattern, status='DEPLOYED'

it('throws when agent attempts to set OPEN')
  same pattern, status='OPEN'

it('allows agent to set IN_PROGRESS without SHA restriction')
  setup:  valid secret, status='IN_PROGRESS', resolution='SECRET:tok|Investigating'
  mockSend: returns issue on query, {} on update
  expect:  resolves, mockSend called twice

it('allows agent to set FIXED with a valid SHA in resolution')
  resolution='SECRET:tok|Fixed in abc1234: timer fix'
  expect:  resolves successfully
```

#### SHA enforcement for FIXED

```
it('throws when agent sets FIXED with no resolution')
  resolution=undefined
  expect: rejects with 'Resolution must include a git commit SHA'

it('throws when agent sets FIXED with resolution containing no SHA')
  resolution='SECRET:tok|Fixed the bug'
  expect: same error

it('throws when agent sets FIXED with a 6-char hex string (too short)')
  resolution='SECRET:tok|Fixed in abcdef: not long enough'
  expect: same error

it('accepts a 7-character short SHA')
  resolution='SECRET:tok|Fixed in abc1234: description'
  expect: resolves

it('accepts a 40-character full SHA')
  resolution='SECRET:tok|Fixed in ' + 'a'.repeat(40) + ': full sha'
  expect: resolves

it('accepts SHA embedded anywhere in the resolution string')
  resolution='SECRET:tok|Regression in commit abc1234 corrected boundary check'
  expect: resolves
```

#### Developer callers are not restricted

```
it('allows authenticated developer to set CLOSED without restriction')
  cognito identity, email in DEVELOPER_EMAILS, status='CLOSED'
  expect: resolves (existing test coverage already partial — verify no regression)

it('allows authenticated developer to set DEPLOYED')
  same pattern, status='DEPLOYED'

it('allows authenticated developer to set FIXED without a SHA in resolution')
  status='FIXED', resolution='manually verified and closed'
  expect: resolves (SHA requirement is agent-only)
```

### E2E tests — Playwright (`e2e/issue-tracking.spec.ts`)

Add a new `describe` block that exercises the agent auth path against the test AppSync environment:

```
describe('agent API key auth')

  it('agent sets issue IN_PROGRESS via API key + secret')
    → POST to APPSYNC_URL with API_KEY header
    → mutation updateIssueStatus(status: "IN_PROGRESS", resolution: "SECRET:...")
    → assert response.data.updateIssueStatus parsed status === 'IN_PROGRESS'

  it('agent sets issue FIXED with SHA in resolution')
    → resolution: "SECRET:<secret>|Fixed in abc1234: test fix"
    → assert parsed status === 'FIXED'
    → assert parsed resolution === 'Fixed in abc1234: test fix' (prefix stripped)

  it('agent is blocked from setting CLOSED')
    → assert GraphQL errors[0].message contains 'agents may only set IN_PROGRESS or FIXED'

  it('agent is blocked from setting DEPLOYED')
    → same assertion

  it('agent is blocked from setting FIXED without a SHA')
    → resolution: "SECRET:<secret>|Fixed the bug"
    → assert errors[0].message contains 'Resolution must include a git commit SHA'

  it('authenticated developer can set CLOSED (no agent restriction)')
    → Cognito auth, DEVELOPER_EMAILS includes test user email
    → assert status === 'CLOSED'

  it('authenticated developer can set FIXED without a SHA')
    → resolution: 'manually verified'
    → assert status === 'FIXED'
```

### Slash command runbook (manual verification)

Run these checks after implementation before merging:

**`/list-issues`**
- [ ] Output table includes issue number, severity, status, age, and truncated description
- [ ] Only OPEN and IN_PROGRESS issues appear
- [ ] Issues sorted high → medium → low → feature-request
- [ ] Exits with a clear error naming the missing variable when `APPSYNC_URL` is unset
- [ ] Exits with a clear error when `API_KEY` is unset

**`/fix-issue`**
- [ ] Rejects non-integer argument with a usage hint
- [ ] Prompts for confirmation before writing
- [ ] Aborts on "no" answer without calling the API
- [ ] Calls `updateIssueStatus` with `FIXED` status and a resolution containing HEAD SHA
- [ ] Prints `✓ Issue #N marked FIXED` on success
- [ ] Prints the API error message on failure
- [ ] Does not print `AGENT_API_SECRET` in any output

**`/triage-issues`**
- [ ] Aborts early with named error if any env variable is missing
- [ ] Claims each issue `IN_PROGRESS` before modifying any code
- [ ] Does not mark `FIXED` unless `npm run test:run` passes after the fix
- [ ] Every `FIXED` resolution contains a valid git SHA
- [ ] Does not attempt `CLOSED` or `DEPLOYED` on any issue
- [ ] Summary table printed at the end with issue number, result, and SHA or skip reason
- [ ] `AGENT_API_SECRET` does not appear in terminal output

---

## Documentation Updates Required After Implementation

| Doc | Change |
|-----|--------|
| `AGENT-ISSUE-MANAGEMENT.md` | Add slash commands section; update status table to mark `CLOSED`/`DEPLOYED` as developer-only; **fix existing error** — table currently says FIXED and DEPLOYED set `closedAt`, but the Lambda only sets it for `CLOSED` |
| `BUG-REPORT-SYSTEM.md` | Update Access Control table: add agent status restriction note |
| `CLAUDE.md` | Add "Agent bug triage" section listing the three slash commands and sourcing `.env.local` |

---

## Out of Scope (v1)

- Automatic triage triggered on commit or push (CI hook)
- Agent reverting a stale `IN_PROGRESS` back to `OPEN` (manual dashboard recovery instead)
- Agent adding comments/notes without changing status
- Duplicate issue detection across open issues
- Notifying the original reporter when their issue is marked FIXED
- Bulk operations (mark multiple issues with one command)
- Agent access to screenshots from the screenshot upload feature (see `Bug-Report-Screenshot-Upload.md`)
