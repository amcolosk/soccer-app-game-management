# Bug Report Screenshot Upload

**Status:** Draft
**Scope:** Extends the existing Bug Report system to allow users to attach one screenshot per report.

---

## Overview

Users can optionally attach a PNG or JPEG screenshot when submitting a bug report. The screenshot is stored in a private S3 bucket, linked (via a 7-day pre-signed URL) in the developer notification email, and viewable inline in the DevDashboard issue detail view. Screenshots are automatically deleted from S3 when the issue is closed.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Upload model | Client → S3 directly (pre-signed URL), then key passed to mutation | Base64-in-mutation hits AppSync's 1 MB payload limit; direct upload is the standard Amplify pattern |
| Email presentation | Clickable link (7-day pre-signed URL) | Keeps S3 bucket private; avoids indefinite public URL exposure of player/roster data |
| DevDashboard | Show screenshot inline in issue detail | Fastest triage; Amplify Storage handles authenticated URL generation |
| Max screenshots | 1 per report | Keeps storage predictable |
| Max file size | 5 MB | Covers typical mobile screenshots (1–3 MB) |
| Accepted formats | PNG and JPEG only | Reduces polyglot file risk; no HEIC, GIF, or video |
| Clipboard paste | Not supported (v1) | File picker only; reduces scope |
| Retention | Delete on issue CLOSED | Minimises PII exposure; ties lifecycle to issue resolution |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Screenshots contain player names, jersey numbers, or other PII (including minors) | Private S3 bucket; pre-signed URLs expire in 7 days; delete on close policy |
| Storage abuse (5 MB × 5 reports/hour = 25 MB/hour per user) | 1 screenshot per report; 5 MB size limit; existing rate limit (5 reports/hour) still applies |
| Malicious/polyglot file upload | Accept only `image/png` and `image/jpeg` MIME types validated client-side; S3 bucket policy enforces `Content-Type`; bucket has no execute permissions |
| Screenshots retained after issue resolved | `update-issue-status` Lambda deletes S3 object when status transitions to `CLOSED` |
| Screenshot accessible to wrong users | Amplify Storage path is readable by any authenticated user; DevDashboard is already gated behind `DEVELOPER_EMAILS` |

---

## Architecture

```
[BugReport.tsx]
    │
    ├─1─ uploadData({ key, data, options }) ──► S3: bug-screenshots/{uuid}.{ext}
    │         (Amplify Storage, authenticated)
    │
    └─2─ submitBugReport({ ..., screenshotKey }) ──► Lambda: send-bug-report
                                                          │
                                                          ├─ Store screenshotKey in DynamoDB Issue record
                                                          ├─ Generate 7-day pre-signed URL (S3 GetObject)
                                                          └─ Include "View Screenshot" link in HTML email

[DevDashboard / IssueDetailModal.tsx]
    │
    └─ getUrl({ key: issue.screenshotKey }) ──► Amplify Storage ──► pre-signed URL ──► <img>

[update-issue-status Lambda]  (on transition to CLOSED)
    └─ S3 DeleteObject(screenshotKey)
```

---

## S3 Storage Design

### Bucket

Use Amplify Storage (Gen2) — a single managed bucket with prefix-level access control. No separate bucket needed.

### Path structure

```
bug-screenshots/{uuid}.{ext}
```

`uuid` is generated client-side before upload (so it can be passed to the mutation). Extension is `.png` or `.jpg`.

### Access policy (Amplify Storage resource)

```typescript
// amplify/storage/resource.ts  (new file)
defineStorage({
  name: 'teamtrackStorage',
  access: (allow) => ({
    'bug-screenshots/*': [
      allow.authenticated.to(['read', 'write']),   // upload + get pre-signed URL
      allow.resource(sendBugReportFn).to(['read']), // Lambda: generate email URL
      allow.resource(updateIssueStatusFn).to(['delete']), // Lambda: delete on close
    ],
  }),
});
```

> **Note:** `read` for authenticated users means any signed-in coach can retrieve a pre-signed URL for any screenshot. This is acceptable because the DevDashboard is already protected by the `DEVELOPER_EMAILS` gate, and regular coaches have no UI path to other users' screenshot keys.

---

## Data Model Changes

### Issue model — new field

```
screenshotKey    string | null    S3 object key (e.g. "bug-screenshots/abc-123.png")
                                  Null if no screenshot was attached.
```

The key is stored rather than a URL because pre-signed URLs expire. The key is permanent until deletion.

### GraphQL schema change (`amplify/data/resource.ts`)

Add `screenshotKey` to the `Issue` model:

```typescript
screenshotKey: a.string(),
```

Add `screenshotKey` as an optional argument to the `submitBugReport` mutation:

```typescript
submitBugReport: a
  .mutation()
  .arguments({
    description: a.string().required(),
    steps: a.string(),
    severity: a.string().required(),
    systemInfo: a.string(),
    screenshotKey: a.string(),   // ← new
  })
  // ... rest unchanged
```

---

## Frontend Changes

### `BugReport.tsx`

**New UI element:** Optional file attachment area below the "Steps to reproduce" field.

```
┌─────────────────────────────────────┐
│ Screenshot (optional)               │
│                                     │
│  [ 📎 Attach screenshot ]           │
│  PNG or JPEG, max 5 MB              │
│                                     │
│  (after selection):                 │
│  🖼 screenshot.png  (2.1 MB)  ✕    │
└─────────────────────────────────────┘
```

**Behaviour:**

1. File picker accepts `image/png, image/jpeg` only.
2. Client validates size ≤ 5 MB before upload; show inline error if exceeded.
3. On form submit:
   a. If a file is selected, generate a UUID, upload via `uploadData` to `bug-screenshots/{uuid}.{ext}`.
   b. Show a progress state ("Uploading screenshot…") while the S3 upload is in flight.
   c. If the S3 upload fails, allow the user to submit the report without a screenshot (show a non-blocking warning).
   d. Pass `screenshotKey` (or `undefined`) to `submitBugReport`.
4. Cancelling the selected file before submit removes the pending upload (no partial S3 object written — upload only starts on submit).

**Error states:**

| Scenario | User-facing message |
|----------|---------------------|
| File > 5 MB | "Screenshot must be under 5 MB" (inline, blocks submit) |
| Wrong file type | "Only PNG and JPEG screenshots are supported" (inline, blocks submit) |
| S3 upload fails | "Screenshot could not be uploaded — submitting report without it" (toast warning, report still submits) |

### `DevDashboard/IssueDetailModal.tsx`

If `issue.screenshotKey` is present:

1. Call `getUrl({ key: issue.screenshotKey, options: { expiresIn: 3600 } })` from Amplify Storage when the modal opens.
2. Render the screenshot below the system info section:

```
┌─────────────────────────────────────┐
│ Screenshot                          │
│ ┌───────────────────────────────┐   │
│ │  <img src={presignedUrl} />   │   │
│ └───────────────────────────────┘   │
│ [Open full size ↗]                  │
└─────────────────────────────────────┘
```

3. If `getUrl` fails (e.g. object already deleted), show "Screenshot no longer available" in place of the image.
4. `screenshotKey` is never rendered as a raw string in the UI.

---

## Lambda Changes

### `send-bug-report/handler.ts`

**New input argument:** `screenshotKey?: string`

**Changes:**

1. Accept and validate `screenshotKey`:
   - If present, verify it matches the pattern `bug-screenshots/[a-z0-9-]+\.(png|jpg)` (reject anything else to prevent path traversal).
   - Store in the DynamoDB `Issue` record.

2. Generate a pre-signed URL for the email:
   ```typescript
   import { GetObjectCommand } from '@aws-sdk/client-s3';
   import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

   const screenshotUrl = screenshotKey
     ? await getSignedUrl(s3Client, new GetObjectCommand({
         Bucket: process.env.STORAGE_BUCKET_NAME,
         Key: screenshotKey,
       }), { expiresIn: 7 * 24 * 60 * 60 }) // 7 days
     : null;
   ```

3. Add to `buildHtmlBody`: a "View Screenshot" button section, rendered only when `screenshotUrl` is provided.

4. Add to `buildTextBody`: a plain-text line `Screenshot: <url>` when present.

**New environment variable:**

| Variable | Source |
|----------|--------|
| `STORAGE_BUCKET_NAME` | Amplify Storage bucket name, injected in `amplify/backend.ts` |

### `update-issue-status/handler.ts`

**Trigger:** When the status transitions to `CLOSED`.

**Changes:**

1. After the DynamoDB `QueryCommand` finds the issue, check `issue.screenshotKey`.
2. If `screenshotKey` is present and status is `CLOSED`:
   ```typescript
   import { DeleteObjectCommand } from '@aws-sdk/client-s3';
   await s3Client.send(new DeleteObjectCommand({
     Bucket: process.env.STORAGE_BUCKET_NAME,
     Key: issue.screenshotKey,
   }));
   ```
3. S3 delete is best-effort — if it fails, log the error but do not fail the status update.
4. No change to the return value.

**New environment variable:** `STORAGE_BUCKET_NAME` (same as above).

---

## Backend Configuration (`amplify/backend.ts`)

New grants needed:

```typescript
// send-bug-report Lambda
storage.grantAccess(sendBugReportFn, ['read']);   // for GetObject pre-signed URL

// update-issue-status Lambda
storage.grantAccess(updateIssueStatusFn, ['delete']); // for DeleteObject on close
```

Both Lambdas receive `STORAGE_BUCKET_NAME` as an environment variable via the Amplify Storage resource reference.

---

## Privacy Considerations

- Screenshots are stored in a **private S3 bucket** — no public URLs are ever issued.
- Pre-signed URLs in emails expire after **7 days**.
- Pre-signed URLs generated by the DevDashboard expire after **1 hour**.
- Screenshots are **deleted from S3** when an issue is closed (status = `CLOSED`). Developers should close issues after deploying fixes rather than leaving them in `FIXED` or `DEPLOYED` indefinitely.
- The `screenshotKey` stored in DynamoDB after deletion is an inert string — it cannot be used to retrieve a deleted object.
- The Privacy section of `BUG-REPORT-SYSTEM.md` must be updated to reflect that screenshots are optionally collected and what they may contain.

---

## Acceptance Criteria

### Happy path

- [ ] User can open the bug report form, attach a PNG or JPEG file, and submit successfully
- [ ] Submitted issue record in DynamoDB contains the correct `screenshotKey`
- [ ] Developer notification email contains a "View Screenshot" link that opens the image in a browser
- [ ] The link works for at least 6 days after submission (7-day expiry)
- [ ] DevDashboard issue detail shows the screenshot image inline
- [ ] When the issue is closed, the S3 object is deleted; the DevDashboard then shows "Screenshot no longer available"

### Validation

- [ ] Attaching a file > 5 MB shows an inline error and blocks submission
- [ ] Attaching a non-PNG/JPEG file shows an inline error and blocks submission
- [ ] If the S3 upload fails at submit time, the report is still submitted without the screenshot and a warning toast is shown

### No screenshot (backwards compatibility)

- [ ] Submitting a report without a screenshot works exactly as before
- [ ] Issues without `screenshotKey` show no screenshot section in the DevDashboard

### Security

- [ ] S3 bucket has no public access policy
- [ ] A `screenshotKey` containing path traversal characters (e.g. `../secrets`) is rejected by the Lambda
- [ ] Only authenticated users can upload to the `bug-screenshots/` prefix

---

## Out of Scope (v1)

- Clipboard paste support (Ctrl+V / long-press)
- Multiple screenshots per report
- Video or screen recordings
- HEIC or WebP format support
- Screenshot annotation or cropping
- Proactive screenshot deletion when status transitions to `FIXED` or `DEPLOYED`
- Virus/malware scanning of uploaded files
