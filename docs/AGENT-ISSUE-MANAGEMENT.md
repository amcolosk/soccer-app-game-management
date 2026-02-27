# Agent Issue Management

How an AI agent (Claude Code or any automated process) can query production bug reports and update their status.

---

## Prerequisites

You need three values from the production deployment:

| Value | Where to find it |
|-------|-----------------|
| `APPSYNC_URL` | `amplify_outputs.json` → `data.url` |
| `API_KEY` | `amplify_outputs.json` → `data.api_key` |
| `AGENT_API_SECRET` | AWS environment variable (never in amplify_outputs) |

> **Note:** `amplify_outputs.json` is not committed to the repo. For production, retrieve it from the AWS Amplify console or set it via CI/CD env vars.

---

## Authentication

The `updateIssueStatus` mutation accepts **either**:

1. **Cognito user token** (human admin in-app)
2. **API key + agent secret** (automated agent)

For agent calls, use the **public API key** as the HTTP auth header, and embed the agent secret inside the `resolution` field:

```
resolution: "SECRET:<AGENT_API_SECRET>|<your actual resolution text>"
```

If you have no resolution text (just changing status):
```
resolution: "SECRET:<AGENT_API_SECRET>"
```

The Lambda strips the `SECRET:<token>|` prefix before storing the resolution in DynamoDB.

---

## Querying Issues

### List all OPEN issues

```bash
curl -X POST "$APPSYNC_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "query": "query { listIssues(filter: { status: { eq: \"OPEN\" } }) { items { issueNumber description severity type createdAt status reporterEmail steps systemInfo } } }"
  }'
```

### Get a specific issue by number

```bash
curl -X POST "$APPSYNC_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "query": "query { getIssueByNumber(issueNumber: 42) { items { issueNumber description severity status resolution closedAt } } }"
  }'
```

### List all issues (any status), most recent first

```bash
curl -X POST "$APPSYNC_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "query": "query { listIssues { items { issueNumber status severity description createdAt updatedAt resolution } } }"
  }'
```

---

## Updating Issue Status

```bash
curl -X POST "$APPSYNC_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{
    \"query\": \"mutation { updateIssueStatus(issueNumber: 42, status: \\\"IN_PROGRESS\\\", resolution: \\\"SECRET:${AGENT_API_SECRET}|Investigating the lineup timing bug\\\") }\"
  }"
```

### Valid status values

| Status | Meaning | Sets `closedAt`? |
|--------|---------|-----------------|
| `OPEN` | Newly reported, not yet triaged | No |
| `IN_PROGRESS` | Actively being worked on | No |
| `FIXED` | Fix applied, not yet deployed | Yes |
| `DEPLOYED` | Fix shipped to production | Yes |
| `CLOSED` | Won't fix, duplicate, or invalid | Yes |

---

## Claude Code Agent Workflow

When triaging production issues as Claude Code, follow this pattern:

### 1. Fetch open issues

```bash
curl -s -X POST "$APPSYNC_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"query": "query { listIssues(filter: { status: { eq: \"OPEN\" } }) { items { issueNumber description severity type steps systemInfo createdAt } } }"}' \
  | jq '.data.listIssues.items | sort_by(.issueNumber)'
```

### 2. Analyze each issue

For each issue, consider:
- **Severity**: `high` issues first
- **Description + steps**: Can you reproduce it?
- **systemInfo**: What browser/device? What app version?
- **Type**: `BUG` vs `FEATURE_REQUEST`

### 3. Update status with a resolution note

```bash
# Acknowledge and start investigating
curl -s -X POST "$APPSYNC_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"query\": \"mutation { updateIssueStatus(issueNumber: $ISSUE_NUM, status: \\\"IN_PROGRESS\\\", resolution: \\\"SECRET:${AGENT_API_SECRET}|$RESOLUTION_TEXT\\\") }\"}"
```

### 4. After fix is merged and deployed

```bash
# Mark as deployed
curl -s -X POST "$APPSYNC_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"query\": \"mutation { updateIssueStatus(issueNumber: $ISSUE_NUM, status: \\\"DEPLOYED\\\", resolution: \\\"SECRET:${AGENT_API_SECRET}|Fixed in commit abc1234: corrected halftime lineup calculation\\\") }\"}"
```

---

## Response Format

### listIssues / getIssueByNumber

```json
{
  "data": {
    "listIssues": {
      "items": [
        {
          "issueNumber": 5,
          "description": "Halftime timer resets unexpectedly",
          "severity": "high",
          "type": "BUG",
          "status": "OPEN",
          "steps": "1. Start game\n2. Let it run past 20 min\n3. Timer jumps back",
          "systemInfo": "{\"userAgent\":\"...\",\"version\":\"1.2.0\",...}",
          "createdAt": "2026-02-26T14:30:00.000Z"
        }
      ]
    }
  }
}
```

### updateIssueStatus

```json
{
  "data": {
    "updateIssueStatus": "{\"issueNumber\":5,\"status\":\"IN_PROGRESS\",\"resolution\":\"Looking into timer reset\"}"
  }
}
```

> The return value is a JSON string (AWSJSON scalar). Parse it with `JSON.parse()` or `jq -r '.data.updateIssueStatus | fromjson'`.

---

## Security Notes

- **`AGENT_API_SECRET` must never be committed** to the repo or logged. Treat it like a password.
- The API key gives read access to all issues — scope this carefully if the app grows.
- The Lambda validates the secret before any update. Wrong secret → 401 error.
- Resolution text is stored verbatim (after stripping the secret prefix) — do not include PII.
