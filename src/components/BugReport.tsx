import { useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { showWarning } from '../utils/toast';
import { handleApiError } from '../utils/errorHandler';

const client = generateClient<Schema>();

interface BugReportProps {
  onClose: () => void;
}

export function BugReport({ onClose }: BugReportProps) {
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'feature-request'>('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!description.trim()) {
      showWarning('Please describe the issue');
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
        version: import.meta.env.VITE_APP_VERSION || '1.0.0',
      };

      // Send bug report via email (Lambda + SES)
      await client.mutations.submitBugReport({
        description,
        steps: steps || undefined,
        severity,
        systemInfo: JSON.stringify(systemInfo),
      });

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
            <p>Your bug report has been submitted successfully.</p>
          </div>
        </div>
      </div>
    );
  }

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
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue you encountered..."
              rows={4}
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="steps">
              Steps to reproduce (optional)
            </label>
            <textarea
              id="steps"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="severity">Severity</label>
            <select
              id="severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as 'low' | 'medium' | 'high' | 'feature-request')}
              disabled={isSubmitting}
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
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
