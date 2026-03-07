import { useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { showWarning } from '../utils/toast';
import { handleApiError } from '../utils/errorHandler';

const client = generateClient<Schema>();

interface BugReportProps {
  onClose: () => void;
  debugContext?: string | null;
}

// Character limits for input validation
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_STEPS_LENGTH = 10000;

export function BugReport({ onClose, debugContext }: BugReportProps) {
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'feature-request'>('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [issueNumber, setIssueNumber] = useState<number | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  function handleCopySnapshot() {
    if (!debugContext) return;
    // Pre-populate steps textarea immediately (synchronous)
    setSteps(prev => prev ? `${prev}\n\n${debugContext}` : debugContext as string);
    // Copy to clipboard (may fail in non-secure context — that's fine)
    navigator.clipboard?.writeText(debugContext as string).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(() => {
      // Clipboard failed — steps are already pre-populated, no further action needed
    });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!description.trim()) {
      showWarning('Please describe the issue');
      return;
    }

    if (steps.length > MAX_STEPS_LENGTH) {
      showWarning(`Steps to reproduce exceeds the maximum length of ${MAX_STEPS_LENGTH} characters`);
      return;
    }

    setIsSubmitting(true);

    try {
      // Collect system information
      const systemInfo = {
        userAgent: navigator.userAgent,
        screenSize: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        version: import.meta.env.VITE_APP_VERSION || '1.1.0',
      };

      // Send bug report to GitHub Issues via Lambda
      const result = await client.mutations.createGitHubIssue({
        type: severity === 'feature-request' ? 'FEATURE_REQUEST' : 'BUG',
        description,
        steps: steps || undefined,
        severity,
        systemInfo: JSON.stringify(systemInfo),
      });

      // Surface GraphQL-level errors (Amplify puts them in result.errors, not throws)
      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors[0].message ?? 'Failed to submit bug report. Please try again.');
      }

      // Parse response to get issue number and URL
      try {
        let parsed: unknown = result.data;
        while (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        const data = parsed as Record<string, unknown>;
        if (typeof data?.issueNumber === 'number') setIssueNumber(data.issueNumber);
        if (typeof data?.issueUrl === 'string') setIssueUrl(data.issueUrl);
      } catch {
        // Response parsing is best-effort; submission still succeeded
      }

      setIsSubmitted(true);
      // No auto-close — user may want to follow the GitHub issue link
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
                ? `Your report has been filed as GitHub Issue #${issueNumber}.`
                : 'Your bug report has been submitted successfully.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
              {issueUrl && (
                <a
                  href={issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                  style={{ display: 'block', textAlign: 'center' }}
                >
                  View on GitHub
                </a>
              )}
              <button onClick={onClose} className="btn-primary">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isBusy = isSubmitting;

  return (
    <div className="bug-report-overlay" onClick={onClose}>
      <div className="bug-report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bug-report-header">
          <h2>🐛 Report a Bug</h2>
          <button onClick={onClose} className="btn-close" aria-label="Close">
            ✕
          </button>
        </div>

        {debugContext && (
          <div className="debug-snapshot-row">
            <p className="debug-snapshot-hint">
              Debug context available — click to add it to the steps field.
            </p>
            <button
              type="button"
              className="btn-secondary debug-snapshot-btn"
              onClick={handleCopySnapshot}
              disabled={isBusy}
            >
              {copySuccess ? '✓ Copied to clipboard' : 'Copy debug context'}
            </button>
          </div>
        )}

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
              rows={6}
              disabled={isBusy}
            />
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
              disabled={isBusy}
            >
              {isSubmitting ? 'Submitting…' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
