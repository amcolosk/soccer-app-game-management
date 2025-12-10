import { useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

interface BugReportProps {
  onClose: () => void;
}

export function BugReport({ onClose }: BugReportProps) {
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!description.trim()) {
      alert('Please describe the issue');
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

      // Create bug report as a GameNote (reusing existing model for simplicity)
      // In production, you might want a dedicated BugReport model
      await client.models.GameNote.create({
        gameId: 'BUG_REPORT', // Special marker for bug reports
        playerId: null,
        gameSeconds: 0,
        half: 0,
        noteType: 'BUG_REPORT',
        notes: JSON.stringify({
          type: 'BUG_REPORT',
          description,
          steps,
          severity,
          systemInfo,
        }),
        timestamp: new Date().toISOString(),
      });

      setIsSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Error submitting bug report:', error);
      alert('Failed to submit bug report. Please try again.');
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
              onChange={(e) => setSeverity(e.target.value as 'low' | 'medium' | 'high')}
              disabled={isSubmitting}
            >
              <option value="low">Low - Minor inconvenience</option>
              <option value="medium">Medium - Affects functionality</option>
              <option value="high">High - Blocks usage</option>
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
