import { useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { uploadData } from 'aws-amplify/storage';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import { showWarning } from '../utils/toast';
import { handleApiError } from '../utils/errorHandler';

const client = generateClient<Schema>();

interface BugReportProps {
  onClose: () => void;
}

// Character limits for input validation
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_STEPS_LENGTH = 3000;

function validateScreenshot(file: File): string | null {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    return 'Only PNG and JPEG screenshots are supported';
  }
  if (file.size > 5 * 1024 * 1024) {
    return 'Screenshot must be under 5 MB';
  }
  return null;
}

export function BugReport({ onClose }: BugReportProps) {
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'feature-request'>('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [issueNumber, setIssueNumber] = useState<number | null>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setScreenshotFile(null);
      setScreenshotError(null);
      return;
    }
    const err = validateScreenshot(file);
    setScreenshotError(err);
    setScreenshotFile(err ? null : file);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!description.trim()) {
      showWarning('Please describe the issue');
      return;
    }

    if (screenshotError) return;

    setIsSubmitting(true);

    try {
      // Upload screenshot to S3 first (identity-scoped path prevents cross-user overwrite)
      let screenshotKey: string | undefined;
      if (screenshotFile) {
        const ext = screenshotFile.type === 'image/png' ? 'png' : 'jpg';
        setIsUploading(true);
        try {
          const session = await fetchAuthSession();
          const identityId = session.identityId;
          if (!identityId) throw new Error('Could not resolve identity for upload');
          const path = `bug-screenshots/${identityId}/${crypto.randomUUID()}.${ext}`;
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

      // Collect system information
      const systemInfo = {
        userAgent: navigator.userAgent,
        screenSize: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timestamp: new Date().toISOString(),
        url: window.location.origin + window.location.pathname,
        version: import.meta.env.VITE_APP_VERSION || '1.1.0',
      };

      // Send bug report via email (Lambda + SES) and create Issue record
      const result = await client.mutations.submitBugReport({
        description,
        steps: steps || undefined,
        severity,
        systemInfo: JSON.stringify(systemInfo),
        screenshotKey,
      });

      // Parse response to get issue number (AWSJSON may be double-encoded)
      try {
        let parsed: unknown = result.data;
        while (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        const issueNum = (parsed as Record<string, unknown>)?.issueNumber;
        if (typeof issueNum === 'number') {
          setIssueNumber(issueNum);
        }
      } catch {
        // Response parsing is best-effort; submission still succeeded
      }

      setIsSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      handleApiError(error, 'Failed to submit bug report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="bug-report-overlay" onClick={onClose}>
        <div className="bug-report-modal" onClick={(e) => e.stopPropagation()}>
          <div className="bug-report-success">
            <div className="success-icon">✓</div>
            <h3>Thank you!</h3>
            <p>
              {issueNumber
                ? `Your report has been submitted as Issue #${issueNumber}.`
                : 'Your bug report has been submitted successfully.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isBusy = isSubmitting || isUploading;

  return (
    <div className="bug-report-overlay" onClick={onClose}>
      <div className="bug-report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bug-report-header">
          <h2>🐛 Report a Bug</h2>
          <button onClick={onClose} className="btn-close" aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bug-report-form">
          <div className="form-group">
            <label htmlFor="description">
              What went wrong? <span className="required">*</span>
              <span className="char-count">
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue you encountered..."
              rows={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              required
              disabled={isBusy}
            />
          </div>

          <div className="form-group">
            <label htmlFor="steps">
              Steps to reproduce (optional)
              <span className="char-count">
                {steps.length}/{MAX_STEPS_LENGTH}
              </span>
            </label>
            <textarea
              id="steps"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
              rows={3}
              maxLength={MAX_STEPS_LENGTH}
              disabled={isBusy}
            />
          </div>

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
                disabled={isBusy}
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
                  disabled={isBusy}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="severity">Severity</label>
            <select
              id="severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as 'low' | 'medium' | 'high' | 'feature-request')}
              disabled={isBusy}
            >
              <option value="low">Low - Minor inconvenience</option>
              <option value="medium">Medium - Affects functionality</option>
              <option value="high">High - Blocks usage</option>
              <option value="feature-request">Feature Request</option>
            </select>
          </div>

          <div className="bug-report-info">
            <small>
              System information will be automatically included to help diagnose the issue.
            </small>
          </div>

          <div className="bug-report-actions">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isBusy || screenshotError !== null}
            >
              {isUploading ? 'Uploading screenshot…' : isSubmitting ? 'Submitting…' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
