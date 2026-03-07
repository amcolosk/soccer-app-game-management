# Bug Reporting & AI Agent Triage — GitHub Issues

**Status:** Spec  
**Scope:** Replaces the DynamoDB-based bug report system. Users file reports from the app; a Lambda creates a GitHub Issue in this repo. The in-app DevDashboard is removed. AI agents triage issues directly through the GitHub API.  
**Supersedes:** `AI-Agent-Bug-Triage.md`, `Bug-Report-Screenshot-Upload.md`, `BUG-REPORT-SYSTEM.md`, `AGENT-ISSUE-MANAGEMENT.md`

---

## Overview

| Before | After |
|--------|-------|
| `BugReport.tsx` → Lambda → DynamoDB + SES email | `BugReport.tsx` → Lambda → GitHub Issues API |
| DevDashboard at `/dev` for tracking issues | GitHub Issues UI (native) |
| Agent uses AppSync mutations with a secret header | Agent uses `gh` CLI / GitHub REST API directly |
| Screenshots → S3 + pre-signed URLs | Not supported — removed to prevent misuse of GitHub's image endpoint |

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Issue storage | GitHub Issues | Eliminates bespoke DynamoDB tables and custom status lifecycle; native labels, milestones, assignees, and search |
| GitHub auth | Fine-grained PAT (`GITHUB_TOKEN` env var in Lambda) | No personal-account coupling of a GitHub App; single env var; `issues: write` scope only |
| Screenshots | Not supported | Removed to prevent potential misuse of GitHub's image endpoint (could risk account suspension) |
| DevDashboard | Removed | GitHub Issues replaces it entirely; no bespoke UI to maintain |
| Agent access | Direct GitHub API via `gh` CLI | No custom Lambda middleman; agents use standard tooling; PAT available as `GITHUB_TOKEN` env var already familiar to CI |
| Email notifications | Dropped | GitHub notifies repo watchers and assignees natively |
| DynamoDB `Issue` + `IssueCounter` | Removed | No longer needed |
| `update-issue-status` Lambda | Removed | Replaced by `gh issue edit` / `gh issue close` |
| `send-bug-report` Lambda | Replaced by `create-github-issue` Lambda | New Lambda has narrower scope—no email, no DynamoDB |

---

## Architecture

```
[BugReport.tsx]
    │
    └─ createGitHubIssue mutation ──► Lambda: create-github-issue/handler.ts
                                              │
                                              └─ GitHub REST API POST /repos/{owner}/{repo}/issues
                                                   • title:   1-line summary from description
                                                   • body:    formatted markdown (see below)
                                                   • labels:  ["bug" | "enhancement", "severity:high" | ...]
                                                   └─ returns { issueNumber, issueUrl }

[Developer]
    └─ github.com/{owner}/{repo}/issues   ← manages issues natively
```

---

## GitHub Labels

Provision these labels in the repo once before deploying:

| Label | Colour | When applied |
|-------|--------|-------------|
| `bug` | `#d73a4a` | type = BUG |
| `enhancement` | `#a2eeef` | type = FEATURE_REQUEST |
| `severity:high` | `#e11d48` | severity = high |
| `severity:medium` | `#f97316` | severity = medium |
| `severity:low` | `#facc15` | severity = low |
| `status:in-progress` | `#8b5cf6` | Agent or developer claims an issue |
| `status:fixed` | `#22c55e` | Agent marks an issue fixed (with commit SHA in comment) |

Labels are idempotent — creating them when they already exist is a no-op.

---

## Lambda: `create-github-issue`

### Environment variables

| Variable | Value |
|----------|-------|
| `GITHUB_TOKEN` | Fine-grained PAT with `repo:issues:write` on this repo |
| `GITHUB_REPO` | `owner/repo` (e.g. `amcol/soccer-app-game-management`) |

Both must be set as Amplify Function secrets / environment variables (never committed).

### Input (via AppSync custom mutation)

```typescript
interface CreateGitHubIssueInput {
  type: 'BUG' | 'FEATURE_REQUEST';
  severity: 'low' | 'medium' | 'high' | 'feature-request';
  description: string;          // max 5000 chars
  steps?: string;               // max 10000 chars
  systemInfo: {
    userAgent: string;
    screen: string;
    viewport: string;
    url: string;
    version: string;
    timestamp: string;
  };
}
```

### Validation

Same constraints as the previous `send-bug-report` Lambda:
- `description` required, max 5000 chars
- `steps` optional, max 10000 chars (accommodates game planner debug output)
- Rate limit: 5 submissions per user per hour — tracked in a lightweight DynamoDB table (`BugReportRateLimit`) keyed on `userId + hourBucket` (TTL 2 hours). This replaces the old `IssueCounter`/`issuesByReporterUserId` GSI approach and requires no persistent Issue records.

### Issue body format

```markdown
## Description
{description}

## Steps to Reproduce
{steps || "_Not provided_"}

## System Info
| Field | Value |
|-------|-------|
| App Version | {systemInfo.version} |
| Browser | {systemInfo.userAgent} |
| Screen | {systemInfo.screen} |
| Viewport | {systemInfo.viewport} |
| URL | {systemInfo.url} |
| Reported | {systemInfo.timestamp} |

---
_Filed automatically by TeamTrack in-app bug reporter_
```

### Response

```typescript
interface CreateGitHubIssueResult {
  issueNumber: number;
  issueUrl: string;   // https://github.com/{owner}/{repo}/issues/{number}
}
```

The UI shows `Issue #N` and a link to the GitHub issue on the success screen.

### Error handling

| Condition | Response |
|-----------|----------|
| Rate limit exceeded | HTTP 429 equivalent — GraphQL error `"Rate limit exceeded. Try again later."` |
| `GITHUB_TOKEN` missing or invalid | 500 — `"Failed to file report. Please try again."` (do not expose token errors) |
| GitHub API unavailable | 500 — same generic message; Lambda does not retry |
| Input validation failure | 400-equivalent GraphQL error with field-specific message |

---

## `BugReport.tsx` Changes

- Remove all DynamoDB/AppSync references to `Issue` queries and `useBugReports` hook
- On success, show `Issue #N` and a "View on GitHub" link (`issueUrl`)
- Error messages map to the new Lambda response codes

---

## Removals

### Backend
| Resource | Action |
|----------|--------|
| `amplify/functions/send-bug-report/` | Delete |
| `amplify/functions/update-issue-status/` | Delete |
| `amplify/data/resource.ts` — `Issue` model | Remove |
| `amplify/data/resource.ts` — `IssueCounter` model | Remove |
| `amplify/data/resource.ts` — `submitBugReport` mutation | Replace with `createGitHubIssue` mutation |
| `amplify/data/resource.ts` — `updateIssueStatus` mutation | Remove |
| `amplify/backend.ts` — IAM grants for `Issue`/`IssueCounter` + `AGENT_API_SECRET` env var | Remove |
| `amplify/storage/resource.ts` — `bug-screenshots/` path | Remove (screenshots go to GitHub now) |

### Frontend
| Resource | Action |
|----------|--------|
| `src/components/DevDashboard/` (all files) | Delete |
| `src/components/routes/DevDashboardRoute.tsx` | Delete |
| `src/hooks/useBugReports.ts` | Delete |
| `src/hooks/useDeveloperAccess.ts` | Delete |
| `/dev` route in `App.tsx` | Remove |
| `src/help.ts` — `dev-dashboard` help key (if present) | Remove |

### Docs (superseded by this spec)
| File | Action |
|------|--------|
| `docs/BUG-REPORT-SYSTEM.md` | Delete |
| `docs/AGENT-ISSUE-MANAGEMENT.md` | Delete |
| `docs/specs/AI-Agent-Bug-Triage.md` | Delete |
| `docs/specs/Bug-Report-Screenshot-Upload.md` | Delete |
| `docs/plans/screenshot-upload-plan.md` | Delete |

---

## AI Agent Issue Triage

Agents interact with GitHub Issues directly using the `gh` CLI or the GitHub REST API. No custom Lambda or secret header is required.

### Prerequisites

| Variable | How to obtain |
|----------|--------------|
| `GITHUB_TOKEN` | Fine-grained PAT with `repo:issues:write` on this repo; store in `.env.local` |
| `GITHUB_REPO` | `owner/repo` string, e.g. `amcol/soccer-app-game-management` |

```bash
# .env.local — never commit
export GITHUB_TOKEN=github_pat_xxxxxxxxxxxx
export GITHUB_REPO=amcol/soccer-app-game-management
```

```bash
source .env.local && claude
```

### Agent Authority Model

| Action | Agent | Developer |
|--------|-------|-----------|
| List open issues | ✓ | ✓ |
| Add `status:in-progress` label | ✓ | ✓ |
| Add `status:fixed` label + comment with SHA | ✓ (SHA required) | ✓ |
| Close issue (won't fix / invalid / deployed) | ✗ | ✓ |
| Delete issue | ✗ | ✓ |

Agents **must not close issues**. Closing signals developer sign-off (verified fix in production, or won't-fix decision). If an agent cannot fix an issue, it leaves it `status:in-progress` and adds a comment explaining why.

### Slash Commands

#### `/triage-issues`

**File:** `.claude/commands/triage-issues.md`

**What it does:** Full automated triage loop. Fetches open issues, analyses each against the codebase, fixes what it can, and marks them fixed.

```
You are acting as the TeamTrack bug-triage agent. Follow these steps exactly.

## 0. Environment check
Verify GITHUB_TOKEN and GITHUB_REPO are set.
If either is missing, print a clear error explaining which is absent and stop.

Set up gh auth:
  export GH_TOKEN=$GITHUB_TOKEN

## 1. Fetch open bugs
Run:
  gh issue list --repo $GITHUB_REPO \
    --label bug \
    --state open \
    --json number,title,labels,body,createdAt \
    --limit 50

Sort by severity label: severity:high → severity:medium → severity:low,
then by issue number ascending.
If there are no open issues, print "No open issues found." and stop.

## 2. For each issue (high severity first)

### 2a. Claim the issue
Add the status:in-progress label before touching any code:
  gh issue edit {number} --repo $GITHUB_REPO --add-label "status:in-progress"
Add a comment so other agents see it is claimed:
  gh issue comment {number} --repo $GITHUB_REPO \
    --body "🤖 Claiming for investigation — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

### 2b. Investigate
- Read the issue body: description, steps, and system info sections
- Search the codebase for the relevant files
- Run existing tests to confirm the baseline passes: npm run test:run

### 2c. Determine fixability
SKIP the issue (leave status:in-progress, log why in a comment) if:
- You cannot identify the root cause from the description and codebase alone
- The fix requires a product decision or user clarification
- Reproducing it requires live AWS infrastructure
- The issue appears environment-specific (browser bug, network issue)

When skipping, add a comment:
  gh issue comment {number} --repo $GITHUB_REPO \
    --body "🤖 Skipping — {reason}. Developer investigation required."

### 2d. Fix and commit
- Implement the minimal fix (do not refactor surrounding code)
- Run tests again: npm run test:run
  - If tests fail, revert your changes and skip the issue (add comment as above)
- Commit using the project convention:
    git commit -m "fix: {description}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
- Capture the short SHA:
    SHA=$(git rev-parse --short HEAD)

### 2e. Mark fixed
Add the status:fixed label:
  gh issue edit {number} --repo $GITHUB_REPO \
    --add-label "status:fixed" \
    --remove-label "status:in-progress"

Add a resolution comment with the commit SHA (required):
  gh issue comment {number} --repo $GITHUB_REPO \
    --body "🤖 Fixed in ${SHA}: {one-line description of the fix}\n\n$(git log -1 --pretty=%B)"

## 3. Summary
Print a table:
  Issue # | Result         | SHA or Skip Reason
  --------|----------------|---------------------------------
  42      | FIXED          | abc1234
  17      | SKIPPED        | Cannot reproduce without prod data

## Constraints
- Never close an issue
- Never mark fixed without a committed code change and passing tests
- The fix comment must always include the commit SHA
- Never commit changes unrelated to the issue being fixed
- Never expose GITHUB_TOKEN in any output — redact as ***
```

---

#### `/list-issues`

**File:** `.claude/commands/list-issues.md`

**What it does:** Reads and displays open bugs and in-progress issues. No writes.

```
Fetch and display open TeamTrack bug reports from GitHub Issues.

First verify GITHUB_TOKEN and GITHUB_REPO are set. If not, print an error and stop.

Set GH_TOKEN=$GITHUB_TOKEN, then run:
  gh issue list --repo $GITHUB_REPO \
    --label bug \
    --state open \
    --json number,title,labels,createdAt \
    --limit 100

Sort by severity: severity:high → severity:medium → severity:low,
then by issue number ascending.

Display as a table:
  #  | Sev    | Status       | Age  | Title (first 70 chars)
  ---|--------|--------------|------|-----------------------------
  42 | high   | in-progress  | 2d   | Timer resets at halftime
  17 | medium | open         | 5h   | Player select shows wrong options

"Age" = time since createdAt (Xd or Xh).
"Status" = "in-progress" if issue has status:in-progress label, else "open".

After the table print: "Total — open: N, in-progress: N"

Do not print GITHUB_TOKEN in any output.
```

---

#### `/fix-issue`

**File:** `.claude/commands/fix-issue.md`

**What it does:** Marks a single already-fixed issue using the current HEAD SHA. Use after manually fixing and committing when the full triage loop is not appropriate.

```
Mark a specific GitHub issue as fixed using the current HEAD commit.

Usage: /fix-issue <issue-number>
Arguments: $ARGUMENTS

Steps:
1. Validate $ARGUMENTS is a positive integer.
   If not, print "Usage: /fix-issue <issue-number>  (e.g. /fix-issue 42)" and stop.

2. Verify GITHUB_TOKEN and GITHUB_REPO are set. Stop with an error if missing.

3. Get the current HEAD SHA and commit message:
     SHA=$(git rev-parse --short HEAD)
     MSG=$(git log -1 --pretty=%s)

4. Confirm with the user before writing:
   "About to mark GitHub issue #$ARGUMENTS as fixed with comment:
    '🤖 Fixed in {SHA}: {MSG}'
   Proceed? (yes/no)"
   Stop if the answer is not "yes".

5. Set GH_TOKEN=$GITHUB_TOKEN, then:
   Add status:fixed label and remove status:in-progress:
     gh issue edit $ARGUMENTS --repo $GITHUB_REPO \
       --add-label "status:fixed" \
       --remove-label "status:in-progress"
   Add resolution comment:
     gh issue comment $ARGUMENTS --repo $GITHUB_REPO \
       --body "🤖 Fixed in ${SHA}: ${MSG}"

6. On success: "✓ Issue #$ARGUMENTS marked fixed — ${SHA}"
   On error: print the error output from gh.

Do not print GITHUB_TOKEN in any output.
```

---

## Security

- `GITHUB_TOKEN` is a fine-grained PAT scoped to `issues: write` on this repo only. It cannot push code, access secrets, or modify repo settings.
- All slash command prompts instruct the agent to redact `GITHUB_TOKEN` as `***` in any output.
- Agents cannot close issues. GitHub does not enforce this at the API level, but the agent prompts explicitly forbid it. A developer must close issues via the GitHub UI.
- No server-side secret header or custom auth scheme is required — the PAT is sufficient.
- The `GITHUB_TOKEN` in `.env.local` is already gitignored by the existing `.gitignore` rule for `.env*`.

---

## `BugReportRateLimit` DynamoDB Table

A minimal table is retained solely for rate limiting, replacing the old `issuesByReporterUserId` GSI on the `Issue` model. The full `Issue` table is removed.

```
PK: userId#{userId}
SK: hour#{ISO-hour}   e.g. 2026-03-07T14
count: number
TTL: unix timestamp 2 hours after SK
```

Lambda `create-github-issue` increments `count` and rejects if `count > 5`. No reads by the client; no GraphQL model needed — accessed only by the Lambda via DynamoDB SDK directly.

---

## Tests

### Unit tests — Lambda (`create-github-issue/handler.test.ts`)

```
describe('create-github-issue Lambda')

  it('creates a GitHub issue with correct labels for a BUG report')
    mock fetch → 201 { number: 42, html_url: '...' }
    expect: GraphQL response includes issueNumber=42 and issueUrl

  it('applies severity:high label for high-severity reports')
    expect: fetch called with body containing labels ["bug","severity:high"]

  it('applies enhancement label for FEATURE_REQUEST type')
    expect: labels include "enhancement", not "bug"

  it('rejects description over 5000 chars')
    expect: GraphQL error "Description is too long"

  it('rejects steps over 3000 chars')
    expect: GraphQL error "Steps field is too long"

  it('enforces rate limit at 5 submissions per hour')
    mock DynamoDB → count=5 already
    expect: GraphQL error "Rate limit exceeded"

  it('returns a generic error when GitHub API is unavailable')
    mock fetch → throws network error
    expect: GraphQL error "Failed to file report. Please try again."
    expect: GITHUB_TOKEN not present in error message
```

### Slash command runbook (manual verification post-implementation)

**`/list-issues`**
- [ ] Table shows issue number, severity, status (in-progress vs open), age, title
- [ ] Only open issues appear (not closed)
- [ ] Sorted high → medium → low
- [ ] Clear error when GITHUB_TOKEN or GITHUB_REPO not set
- [ ] GITHUB_TOKEN does not appear in output

**`/fix-issue`**
- [ ] Rejects non-integer argument with usage hint
- [ ] Prompts for confirmation before writing
- [ ] Aborts on "no" without calling the GitHub API
- [ ] Adds `status:fixed` label and posts a comment containing the HEAD SHA
- [ ] Prints success confirmation with SHA
- [ ] GITHUB_TOKEN does not appear in output

**`/triage-issues`**
- [ ] Aborts early with named error if env var missing
- [ ] Claims issue (status:in-progress + comment) before modifying code
- [ ] Does not mark fixed unless `npm run test:run` passes after the fix
- [ ] Fix comment contains GitHub-visible commit SHA
- [ ] Does not close any issue
- [ ] Summary table printed at end
- [ ] GITHUB_TOKEN does not appear in terminal output

---

## Data Migration

No migration is required. Existing DynamoDB Issue records are abandoned in place. The DynamoDB tables (`Issue`, `IssueCounter`) are deleted as part of the Amplify schema update. No backfill of GitHub Issues is needed for old reports.

---

## Implementation Order

1. Provision GitHub labels (one-time, via `gh label create` or GitHub UI)
2. Add `GITHUB_TOKEN` and `GITHUB_REPO` as Amplify Function secrets
3. Create `amplify/functions/create-github-issue/handler.ts` + unit tests
4. Create minimal `BugReportRateLimit` DynamoDB table in `amplify/data/resource.ts`
5. Add `createGitHubIssue` AppSync mutation; remove `submitBugReport` + `updateIssueStatus`
6. Update `BugReport.tsx`: new mutation, new success screen
7. Delete `send-bug-report/` and `update-issue-status/` Lambda directories
8. Remove `DevDashboard/`, `DevDashboardRoute.tsx`, `useBugReports.ts`, `useDeveloperAccess.ts`, `/dev` route
9. Remove `Issue` + `IssueCounter` models from `amplify/data/resource.ts`
10. Remove storage bug-screenshots path from `amplify/storage/resource.ts`
11. Update `.claude/commands/` slash commands to use GitHub API
12. Delete superseded docs (listed in Removals section)
13. Update `CLAUDE.md` agent section to reference `GITHUB_TOKEN`/`GITHUB_REPO`
14. Run `npm run build`, `npm run test:run`, `npm run lint` — all green before commit

---

## Out of Scope (v1)

- Automatic triage triggered on push/PR (CI hook)
- Agent leaving a review comment on the PR that fixes an issue
- Agent detecting duplicate issues before filing
- Notifying the original reporter when their issue is fixed
- Filing issues to a separate triage / backlog repo (single repo assumed)
- Migrating existing DynamoDB issues to GitHub Issues
