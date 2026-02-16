# Bug Report System

## How It Works

Users can report bugs directly from the app by clicking the **"🐛 Report Issue"** button in the **Manage → App** tab.

When submitted, the bug report is sent as a **formatted email** via AWS SES to the developer's inbox — no DynamoDB storage, no manual querying.

### What Gets Collected

Each bug report includes:
- **Description**: What went wrong
- **Steps to Reproduce**: How to recreate the issue (optional)
- **Severity**: Low 🟢, Medium 🟡, or High 🔴
- **Reporter**: Cognito user email and user ID (from auth context)
- **System Information** (automatically collected):
  - User agent (browser/device info)
  - Screen size and viewport
  - Current URL
  - App version
  - Timestamp

## Architecture

```
BugReport.tsx  →  client.mutations.submitBugReport()
                         ↓
                  AppSync GraphQL Mutation
                         ↓
               Lambda: send-bug-report/handler.ts
                         ↓
                  SES SendEmail
                         ↓
              amcolosk+teamtrack@gmail.com
```

### Key Files

| File | Purpose |
|------|---------|
| `src/components/BugReport.tsx` | UI form component |
| `amplify/functions/send-bug-report/handler.ts` | Lambda that formats and sends the email |
| `amplify/functions/send-bug-report/resource.ts` | Function definition with env vars |
| `amplify/data/resource.ts` | `submitBugReport` mutation schema |
| `amplify/backend.ts` | SES IAM permissions |

### Configuration

The recipient email is set in `amplify/functions/send-bug-report/resource.ts`:

```typescript
environment: {
  FROM_EMAIL: 'TeamTrack Bug Reports <admin@coachteamtrack.com>',
  TO_EMAIL: 'amcolosk+teamtrack@gmail.com',
}
```

To change who receives bug reports, update the `TO_EMAIL` value and redeploy.

## Privacy Considerations

The system collects:
- ✅ Device/browser information (anonymous)
- ✅ Screen dimensions
- ✅ App version and current URL
- ✅ Reporter's email (from Cognito auth token)
- ❌ NO location data
- ❌ NO game data or player information

