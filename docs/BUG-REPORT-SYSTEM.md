# Bug Report System

## Overview

Users can report bugs directly from the app via **Manage → App → Report Issue**. Each submission creates a tracked **Issue** record in DynamoDB with a sequential issue number, and sends a formatted email via AWS SES to the developer inbox.

---

## Architecture

```
BugReport.tsx  →  submitBugReport mutation
                         ↓
               Lambda: send-bug-report/handler.ts
                    ↓              ↓
           DynamoDB Issue     SES SendEmail
           (issue #XX)      (admin@coachteamtrack.com)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/components/BugReport.tsx` | UI form (description, steps, severity) |
| `src/hooks/useBugReports.ts` | React hook for reading issues + updating status |
| `src/hooks/useDeveloperAccess.ts` | Hook that gates the `/dev` route by email allowlist |
| `src/components/routes/DevDashboardRoute.tsx` | Route guard — redirects non-developers to `/` |
| `src/components/DevDashboard/DevDashboard.tsx` | Developer dashboard page (`/dev`) |
| `amplify/functions/send-bug-report/handler.ts` | Lambda: validates, rate-limits, creates issue, sends email |
| `amplify/functions/update-issue-status/handler.ts` | Lambda: updates issue status (developers + AI agents) |
| `amplify/data/resource.ts` | `Issue`, `IssueCounter` models + mutations |
| `amplify/backend.ts` | IAM grants, env vars, DynamoDB table refs |

---

## Data Model

### Issue
```
issueNumber    integer (sequential, auto-incremented via IssueCounter)
type           BUG | FEATURE_REQUEST
severity       low | medium | high | feature-request
status         OPEN | IN_PROGRESS | FIXED | DEPLOYED | CLOSED
description    string (required, max 5000 chars)
steps          string (optional, max 3000 chars)
systemInfo     JSON string (userAgent, screen, viewport, url, version, timestamp)
resolution     string (set when status changes to terminal state)
reporterEmail  string
reporterUserId string
closedAt       datetime (set only when status transitions to CLOSED)
updatedAt      datetime (auto-updated)
```

### IssueCounter
Internal table for atomic sequential numbering. Not accessible from the client. Lambda uses `ADD` expression for race-free increments.

### Secondary Indexes
- `issueNumber` → `getIssueByNumber` query field
- `reporterUserId` → used for rate limiting (5 reports/hour/user)

---

## Submission Flow

1. User fills the `BugReport.tsx` form
2. `submitBugReport` mutation (Cognito auth required) calls `send-bug-report` Lambda
3. Lambda:
   - Validates input lengths (5000 / 3000 chars)
   - Rate-limits: max 5 reports per user per hour
   - Atomically increments IssueCounter to get next issue number
   - Creates `Issue` record with status `OPEN`
   - Sends formatted HTML + text email via SES
   - Returns `{ issueNumber }` JSON
4. UI shows success screen with `Issue #XX`

---

## Status Lifecycle

```
OPEN → IN_PROGRESS → FIXED
                   → DEPLOYED
                   → CLOSED
```

Only `CLOSED` sets the `closedAt` timestamp. `FIXED` and `DEPLOYED` are intermediate states — the issue is considered closed only when explicitly set to `CLOSED`.

---

## Access Control

| Operation | Auth Required |
|-----------|--------------|
| Submit bug report | Cognito user |
| Read issues | Cognito user OR public API key |
| Update issue status (dashboard) | Cognito user whose email is in `DEVELOPER_EMAILS` |
| Update issue status (agent) | API key + `AGENT_API_SECRET` embedded in resolution field — limited to `IN_PROGRESS` and `FIXED`; SHA required for `FIXED` |
| Read/write IssueCounter | Lambda IAM only |

> **Note:** The `updateIssueStatus` Lambda is **fail-closed** — if `DEVELOPER_EMAILS` is not configured, all authenticated callers are denied. Missing config never silently grants access.

---

## useBugReports Hook

```typescript
import { useBugReports } from '../hooks/useBugReports';

// All issues, sorted by issueNumber descending
const { issues, isSynced, updating, updateError, updateStatus } = useBugReports();

// Only OPEN issues
const { issues } = useBugReports({ filterStatus: 'OPEN' });

// Update status (authenticated user)
await updateStatus(42, 'IN_PROGRESS', 'Looking into the lineup bug');
```

The hook uses `useAmplifyQuery` (real-time subscription via `observeQuery`) so the issue list updates automatically when changes arrive.

---

## AI Agent Integration

See **[AGENT-ISSUE-MANAGEMENT.md](./AGENT-ISSUE-MANAGEMENT.md)** for the complete agent workflow: how to query open issues and update their status from Claude Code or any automated process.

---

## Configuration

### Environment Variables (set in `amplify/backend.ts`)

| Variable | Where | Description |
|----------|-------|-------------|
| `TO_EMAIL` | `sendBugReport` Lambda | Recipient email (default: `admin@coachteamtrack.com`). Override via `BUG_REPORT_EMAIL` build env var |
| `FROM_EMAIL` | `sendBugReport` resource | Sender address |
| `ISSUE_TABLE_NAME` | Both Lambdas | DynamoDB Issue table name |
| `ISSUE_COUNTER_TABLE_NAME` | `sendBugReport` Lambda | DynamoDB IssueCounter table name |
| `AGENT_API_SECRET` | `updateIssueStatus` Lambda | Secret token for agent authentication. Set via `AGENT_API_SECRET` build env var |
| `DEVELOPER_EMAILS` | `updateIssueStatus` Lambda | Comma-separated list of emails allowed to update issue status. Set via `DEVELOPER_EMAILS` build env var. Required — missing value denies all authenticated callers. |
| `VITE_DEVELOPER_EMAILS` | Frontend (build-time) | Same email list, controls visibility of the `/dev` dashboard route. Set in `.env.local` for local dev, or Amplify Console for production. |

---

## Privacy

Collected automatically with each report:
- ✅ Browser/device (user agent)
- ✅ Screen size and viewport
- ✅ App version and current page URL
- ✅ Reporter's Cognito email and user ID
- ❌ No location data
- ❌ No game data or player information
