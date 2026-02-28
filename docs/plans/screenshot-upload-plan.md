# Implementation Plan: Bug Report Screenshot Upload

Spec: `docs/specs/Bug-Report-Screenshot-Upload.md`
Status: **Reviewed by plan-architect — all blocking issues resolved**

---

## Summary

Add optional PNG/JPEG screenshot attachment to bug reports. Screenshots upload
directly to S3 via Amplify Storage (path-based v6 API), the key is stored in
DynamoDB, and the DevDashboard renders the image inline. On `CLOSED`, the
update-issue-status Lambda deletes the S3 object.

---

## Files to Create

### 1. `amplify/storage/resource.ts`

```typescript
import { defineStorage } from '@aws-amplify/backend';
import { sendBugReport } from '../functions/send-bug-report/resource';
import { updateIssueStatus } from '../functions/update-issue-status/resource';

export const storage = defineStorage({
  name: 'teamtrackStorage',
  access: (allow) => ({
    'bug-screenshots/*': [
      allow.authenticated.to(['read', 'write']),
      allow.resource(sendBugReport).to(['read']),
      allow.resource(updateIssueStatus).to(['delete']),
    ],
  }),
});
```

> Lambda access is granted declaratively here. No `storage.grantAccess()` calls
> are needed (that API does not exist). `STORAGE_BUCKET_NAME` is NOT auto-injected
> — it must be set explicitly in `backend.ts`.

---

### 2. `amplify/functions/update-issue-status/package.json`

New file — `update-issue-status` has no package.json currently.

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.600.0"
  }
}
```

---

## Files to Modify

### 3. `amplify/data/resource.ts`

**Issue model** — add `screenshotKey` field after `reporterUserId`:
```typescript
screenshotKey: a.string(),
```

**`submitBugReport` mutation** — add `screenshotKey` argument after `systemInfo`:
```typescript
screenshotKey: a.string(),
```

---

### 4. `amplify/backend.ts`

Add imports at top:
```typescript
import { storage } from './storage/resource';
```

Update `defineBackend` call to include `storage`:
```typescript
const backend = defineBackend({
  auth,
  data,
  storage,           // ← new
  sendInvitationEmail,
  acceptInvitation,
  getUserInvitations,
  sendBugReport,
  updateIssueStatus,
});
```

Add after existing grants (before end of file):
```typescript
// Inject S3 bucket name into Lambdas that need it
// (allow.resource() in defineStorage grants IAM permissions but does NOT auto-inject env vars)
const storageBucket = backend.storage.resources.bucket;
backend.sendBugReport.addEnvironment('STORAGE_BUCKET_NAME', storageBucket.bucketName);
backend.updateIssueStatus.addEnvironment('STORAGE_BUCKET_NAME', storageBucket.bucketName);
```

---

### 5. `amplify/functions/send-bug-report/package.json`

Add S3 packages (SES is already there):
```json
{
  "dependencies": {
    "@aws-sdk/client-ses": "^3.600.0",
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/s3-request-presigner": "^3.600.0"
  }
}
```

> `@aws-sdk/s3-request-presigner` is NOT in the Lambda runtime layer — it must
> be explicitly declared.

---

### 6. `amplify/functions/send-bug-report/handler.ts`

Add imports at top:
```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
```

Add constants near top with other clients:
```typescript
const s3 = new S3Client({ region: process.env.AWS_REGION });
const STORAGE_BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;
const SCREENSHOT_KEY_PATTERN = /^bug-screenshots\/[a-z0-9-]+\.(png|jpg)$/;
```

Update `buildTextBody` signature to accept optional screenshot URL:
```typescript
export function buildTextBody(input: BugReportInput, screenshotUrl?: string | null): string {
  return [
    input.severity === 'feature-request' ? 'Feature Request' : `Bug Report — ${input.severity.toUpperCase()}`,
    '',
    `Description: ${input.description}`,
    input.steps ? `Steps: ${input.steps}` : '',
    `Reporter: ${input.userEmail} (${input.userId})`,
    '',
    'System Info:',
    ...Object.entries(input.systemInfo).map(([k, v]) => `  ${k}: ${v}`),
    screenshotUrl ? `\nScreenshot: ${screenshotUrl}` : '',
  ].filter(Boolean).join('\n');
}
```

Update `buildHtmlBody` signature to accept optional screenshot URL and add
a "View Screenshot" button section in the HTML (after system info, before `</div></body>`):
```typescript
export function buildHtmlBody(input: BugReportInput, screenshotUrl?: string | null): string {
  // ... existing HTML template ...
  // Add before closing content div:
  // ${screenshotUrl ? `
  //   <div class="field">
  //     <div class="field-label">Screenshot</div>
  //     <div class="field-value">
  //       <a href="${screenshotUrl}"
  //          style="display:inline-block;padding:8px 16px;background:#1976d2;color:white;
  //                 text-decoration:none;border-radius:4px;">
  //         View Screenshot ↗
  //       </a>
  //       <span style="font-size:0.8em;color:#888;margin-left:8px;">Link expires in 7 days</span>
  //     </div>
  //   </div>` : ''}
}
```

Update the `handler` function:

1. Destructure `screenshotKey` from `event.arguments`:
   ```typescript
   const { description, steps, severity, systemInfo, screenshotKey } = event.arguments;
   ```

2. Validate `screenshotKey` if present (before constructing `input`):
   ```typescript
   if (screenshotKey && !SCREENSHOT_KEY_PATTERN.test(screenshotKey)) {
     throw new Error('Invalid screenshotKey format');
   }
   ```

3. Keep `screenshotKey` as a separate variable (do NOT add it to `BugReportInput` —
   that interface is for the processed report data, not the storage path).

4. In the `PutCommand` Item, add:
   ```typescript
   screenshotKey: screenshotKey || null,
   ```

5. After constructing `input` and before the try block, generate presigned URL:
   ```typescript
   let screenshotUrl: string | null = null;
   if (screenshotKey && STORAGE_BUCKET_NAME) {
     try {
       screenshotUrl = await getSignedUrl(
         s3,
         new GetObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: screenshotKey }),
         { expiresIn: 7 * 24 * 60 * 60 }
       );
     } catch (urlErr) {
       console.error('Failed to generate screenshot presigned URL (email will not include link):', urlErr);
     }
   }
   ```

6. Pass `screenshotUrl` to both email builders:
   ```typescript
   Html: { Data: buildHtmlBody(input, screenshotUrl) },
   Text: { Data: buildTextBody(input, screenshotUrl) },
   ```

---

### 7. `amplify/functions/update-issue-status/handler.ts`

Add imports at top:
```typescript
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
```

Add constants:
```typescript
const s3 = new S3Client({ region: process.env.AWS_REGION });
const STORAGE_BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;
const SCREENSHOT_KEY_PATTERN = /^bug-screenshots\/[a-z0-9-]+\.(png|jpg)$/;
```

After the `UpdateCommand` succeeds and before the fail-safe secret check, add:
```typescript
// Delete screenshot from S3 on issue close (best-effort)
if (status === 'CLOSED' && issue.screenshotKey && STORAGE_BUCKET_NAME) {
  const key = issue.screenshotKey as string;
  // Defense-in-depth: validate key format before deleting
  if (SCREENSHOT_KEY_PATTERN.test(key)) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: key }));
      console.log(`Deleted screenshot: ${key}`);
    } catch (deleteErr) {
      console.error('Failed to delete screenshot (best-effort, not failing update):', deleteErr);
    }
  } else {
    console.warn(`Skipping screenshot delete — unexpected key format: ${key}`);
  }
}
```

---

### 8. `src/components/BugReport.tsx`

Add import:
```typescript
import { uploadData } from 'aws-amplify/storage';
```

> Use `crypto.randomUUID()` (already available in modern browsers and Node 22).
> Do NOT add the `uuid` package — project already uses `randomUUID` from `crypto`
> in Lambda handlers and modern browsers support it natively.

Add state:
```typescript
const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
const [screenshotError, setScreenshotError] = useState<string | null>(null);
const [isUploading, setIsUploading] = useState(false);
```

Add validation helper (outside component):
```typescript
function validateScreenshot(file: File): string | null {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    return 'Only PNG and JPEG screenshots are supported';
  }
  if (file.size > 5 * 1024 * 1024) {
    return 'Screenshot must be under 5 MB';
  }
  return null;
}
```

Add file change handler:
```typescript
function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0] ?? null;
  if (!file) { setScreenshotFile(null); setScreenshotError(null); return; }
  const err = validateScreenshot(file);
  setScreenshotError(err);
  setScreenshotFile(err ? null : file);
}
```

Update `handleSubmit` — after `setIsSubmitting(true)`, before calling `submitBugReport`:
```typescript
// Upload screenshot to S3 first (uses path-based Amplify v6 API)
let screenshotKey: string | undefined;
if (screenshotFile) {
  const ext = screenshotFile.type === 'image/png' ? 'png' : 'jpg';
  const path = `bug-screenshots/${crypto.randomUUID()}.${ext}`;
  setIsUploading(true);
  try {
    await uploadData({
      path,
      data: screenshotFile,
      options: { contentType: screenshotFile.type },
    }).result;
    screenshotKey = path;
  } catch {
    showWarning('Screenshot could not be uploaded — submitting report without it');
  } finally {
    setIsUploading(false);
  }
}
```

Update `submitBugReport` call to include `screenshotKey`:
```typescript
const result = await client.mutations.submitBugReport({
  description,
  steps: steps || undefined,
  severity,
  systemInfo: JSON.stringify(systemInfo),
  screenshotKey,
});
```

Update submit button label:
```typescript
{isUploading ? 'Uploading screenshot…' : isSubmitting ? 'Submitting…' : 'Submit Report'}
```

Disable submit when `screenshotError` is set:
```typescript
disabled={isSubmitting || isUploading || screenshotError !== null}
```

Add UI below steps `form-group`, above the `bug-report-info` div:
```tsx
<div className="form-group">
  <label>Screenshot (optional)</label>
  <div className="screenshot-upload-area">
    <label htmlFor="screenshot" className="screenshot-attach-btn">
      📎 Attach screenshot
    </label>
    <input
      id="screenshot"
      type="file"
      accept="image/png, image/jpeg"
      onChange={handleFileChange}
      disabled={isSubmitting || isUploading}
      className="screenshot-file-input"
    />
    <p className="screenshot-hint">PNG or JPEG, max 5 MB</p>
  </div>
  {screenshotError && <p className="screenshot-error">{screenshotError}</p>}
  {screenshotFile && !screenshotError && (
    <div className="screenshot-preview-row">
      <span>🖼 {screenshotFile.name} ({(screenshotFile.size / 1024 / 1024).toFixed(1)} MB)</span>
      <button
        type="button"
        onClick={() => { setScreenshotFile(null); setScreenshotError(null); }}
        aria-label="Remove screenshot"
        disabled={isSubmitting || isUploading}
      >
        ✕
      </button>
    </div>
  )}
</div>
```

---

### 9. `src/components/DevDashboard/IssueDetailModal.tsx`

Update import:
```typescript
import { useState, useEffect } from 'react';
```

Add import:
```typescript
import { getUrl } from 'aws-amplify/storage';
```

Add state:
```typescript
const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
const [screenshotFailed, setScreenshotFailed] = useState(false);
```

Add effect after existing state declarations:
```typescript
useEffect(() => {
  // Reset state when issue changes (avoids stale data from previous issue)
  setScreenshotUrl(null);
  setScreenshotFailed(false);
  if (!issue.screenshotKey) return;
  // Amplify v6 Storage uses path-based API
  getUrl({ path: issue.screenshotKey, options: { expiresIn: 3600 } })
    .then((result) => setScreenshotUrl(result.url.toString()))
    .catch(() => setScreenshotFailed(true));
}, [issue.screenshotKey]);
```

Add screenshot section in body, after system info and before existing resolution section:
```tsx
{issue.screenshotKey && (
  <div className="dev-modal-section">
    <div className="dev-modal-section-label">Screenshot</div>
    {screenshotFailed ? (
      <p className="dev-screenshot-unavailable">Screenshot no longer available</p>
    ) : screenshotUrl ? (
      <>
        <img
          src={screenshotUrl}
          alt="Bug report screenshot"
          className="dev-screenshot-img"
        />
        <a
          href={screenshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="dev-screenshot-link"
        >
          Open full size ↗
        </a>
      </>
    ) : (
      <p className="dev-screenshot-loading">Loading screenshot…</p>
    )}
  </div>
)}
```

---

### 10. `src/App.css`

Add new section at the bottom:

```css
/* ========== SCREENSHOT UPLOAD (BugReport) ========== */
.screenshot-upload-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.screenshot-file-input {
  display: none;
}
.screenshot-attach-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9em;
  color: var(--text-primary);
  background: var(--card-background);
  transition: border-color 0.15s;
  width: fit-content;
}
.screenshot-attach-btn:hover {
  border-color: var(--primary-green);
}
.screenshot-hint {
  font-size: 0.8em;
  color: var(--text-secondary);
  margin: 0;
}
.screenshot-error {
  color: var(--danger-red);
  font-size: 0.85em;
  margin: 4px 0 0;
}
.screenshot-preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--hover-background);
  border-radius: 6px;
  font-size: 0.9em;
}
.screenshot-preview-row button {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 1em;
  padding: 2px 6px;
}

/* ========== DEV DASHBOARD SCREENSHOT ========== */
.dev-screenshot-img {
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  margin-top: 8px;
  display: block;
}
.dev-screenshot-link {
  display: inline-block;
  margin-top: 6px;
  font-size: 0.85em;
  color: var(--primary-green);
}
.dev-screenshot-unavailable {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 0.9em;
}
.dev-screenshot-loading {
  color: var(--text-secondary);
  font-size: 0.9em;
}
```

---

### 11. Test file updates

#### `amplify/functions/send-bug-report/handler.test.ts`

- Update all `buildTextBody(input)` calls to `buildTextBody(input, null)` or `buildTextBody(input)`
  (second param is optional so existing calls are backward compatible if signature uses default `undefined`)
- Update all `buildHtmlBody(input)` calls similarly
- Add new tests:
  - `buildTextBody` with `screenshotUrl` includes the URL in the output
  - `buildHtmlBody` with `screenshotUrl` includes "View Screenshot" button
  - Handler: `screenshotKey` is stored in DDB PutCommand Item
  - Handler: invalid `screenshotKey` format throws an error
  - Handler: presigned URL generated and passed to email builders when key present
  - Handler: gracefully handles presigned URL generation failure

#### `src/components/BugReport.test.tsx`

Add new tests (existing tests are backward-compatible since `screenshotKey` is optional):
  - File picker renders; accepts PNG/JPEG
  - File > 5 MB shows error and disables submit
  - Wrong MIME type shows error and disables submit
  - Valid file shows preview with remove button; clicking remove clears the file
  - Submit with valid file calls `uploadData` then `submitBugReport` with `screenshotKey`
  - S3 upload failure shows toast warning; `submitBugReport` called without `screenshotKey`
  - No file selected: `submitBugReport` called without `screenshotKey` (same as before)

---

## Dependency Notes

- `crypto.randomUUID()` — use this instead of `uuid` package (Node 22 + all modern browsers)
- `@aws-sdk/s3-request-presigner` — add to `send-bug-report/package.json` (not in Lambda runtime layer)
- `@aws-sdk/client-s3` — add to both Lambda `package.json` files
- `aws-amplify/storage` — already available via the `aws-amplify` package on the frontend

---

## Documentation updates (non-blocking, do after implementation)

- Update `docs/BUG-REPORT-SYSTEM.md` privacy section to mention optional screenshot collection
- Update `CLAUDE.md` to list `amplify/storage/resource.ts` and `screenshotKey` on Issue model

---

## Testing Checklist (spec acceptance criteria)

### Happy path
- [ ] User can attach PNG or JPEG, submit — DDB `Issue.screenshotKey` is set
- [ ] Developer notification email contains "View Screenshot" link
- [ ] Link works for at least 6 days after submission (7-day presigned URL)
- [ ] DevDashboard issue detail shows screenshot inline
- [ ] When issue is CLOSED, S3 object is deleted; DevDashboard shows "Screenshot no longer available"

### Validation
- [ ] File > 5 MB → inline error, submit blocked
- [ ] Non-PNG/JPEG file → inline error, submit blocked
- [ ] S3 upload failure → toast warning, report submitted without screenshot

### Backwards compatibility
- [ ] Submit without screenshot works exactly as before
- [ ] Issues without `screenshotKey` show no screenshot section in DevDashboard

### Security
- [ ] S3 bucket has no public access policy
- [ ] `screenshotKey` with path traversal (e.g. `../secrets`) rejected by Lambda
- [ ] Only authenticated users can upload to `bug-screenshots/` prefix
