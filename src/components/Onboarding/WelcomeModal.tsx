import { useEffect, useRef } from 'react';
import { trackEvent, AnalyticsEvents } from '../../utils/analytics';
import './WelcomeModal.css';

interface WelcomeModalProps {
  onClose: () => void;
  onGetStarted: () => void;
}

/**
 * WelcomeModal
 * 
 * Single scrollable modal card shown once on first authenticated load.
 * Introduces the app and offers two paths:
 * 1. Load demo data (optional)
 * 2. Open the Quick Start checklist
 * 
 * Focus trap pattern copied from HelpModal.tsx.
 */
export function WelcomeModal({ onClose, onGetStarted }: WelcomeModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Track analytics on mount
  useEffect(() => {
    trackEvent(AnalyticsEvents.WELCOME_MODAL_OPENED.category, AnalyticsEvents.WELCOME_MODAL_OPENED.action);
  }, []);

  // Capture previously focused element and move focus to heading on open
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    headingRef.current?.focus();

    return () => {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  // Escape key dismissal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap: intercept Tab/Shift+Tab to keep focus within modal
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const focusableSelectors = [
      'button:not(:disabled)',
      '[href]',
      'input:not(:disabled)',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(focusableSelectors)
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: wrap from first to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: wrap from last to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    modal.addEventListener('keydown', handleKeyDown);
    return () => modal.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSkip = () => {
    trackEvent(AnalyticsEvents.WELCOME_MODAL_SKIPPED.category, AnalyticsEvents.WELCOME_MODAL_SKIPPED.action);
    onClose();
  };

  const handleGetStarted = () => {
    onGetStarted();
  };

  return (
    <div className="welcome-modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="welcome-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="welcome-modal-header">
          <h2
            id="welcome-modal-title"
            ref={headingRef}
            tabIndex={-1}
            className="welcome-modal-title"
          >
            Welcome to TeamTrack
          </h2>
          <button
            className="welcome-modal-close"
            onClick={onClose}
            aria-label="Close welcome"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="welcome-modal-body">
          {/* Hero section */}
          <div className="welcome-hero">
            <div className="welcome-hero-icon" aria-hidden="true">🤝</div>
            <h3 className="welcome-hero-title">Hey there, Coach! 👋</h3>
            <p className="welcome-hero-tagline">
              Before you dive in, take a moment to complete your profile on the Profile tab.
              Your first name helps teammates identify your notes during games.
            </p>
          </div>

          <section className="welcome-section">
            <h4 className="welcome-section-heading">Privacy</h4>
            <div className="welcome-callout">
              <p className="welcome-callout-text">
                🔒 Your profile is shared only with coaches on your teams. You control what others see:
                first name only, or first name with last initial.
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="welcome-modal-footer">
          <button
            className="welcome-skip-link"
            onClick={handleSkip}
            type="button"
          >
            Maybe later
          </button>
          <button
            className="welcome-primary-button"
            onClick={handleGetStarted}
            type="button"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
