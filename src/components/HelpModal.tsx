import { useEffect, useRef } from 'react';
import { HELP_CONTENT } from '../help';
import type { HelpScreenKey } from '../help';
import './HelpModal.css';

interface HelpModalProps {
  /** Which screen's help article to display. */
  helpContext: HelpScreenKey;
  /** Called when the modal is dismissed (close button, backdrop, Escape key). */
  onClose: () => void;
  /**
   * Optional — called when the coach taps a related-screen pill.
   * In Phase 1 this is not provided; pills fall back to calling onClose().
   */
  onNavigate?: (key: HelpScreenKey) => void;
}

/**
 * HelpModal
 *
 * Displays a screen-specific help article from the HELP_CONTENT registry.
 * Opened by HelpFab after the bottom-sheet close animation completes.
 *
 * Accessibility:
 * - role="dialog" + aria-modal="true" + aria-labelledby
 * - Focus moves to <h2> on mount; restored on close
 * - Escape key dismissal
 * - Focus trap: Tab/Shift+Tab cycle within modal interactive elements
 */
export function HelpModal({ helpContext, onClose, onNavigate }: HelpModalProps) {
  const content = HELP_CONTENT[helpContext];

  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // Capture the previously focused element and move focus into the modal on open.
  // Restore focus to that element when the modal closes (effect cleanup).
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

  // Focus trap: intercept Tab/Shift+Tab to keep focus within the modal
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

  // Defensive fallback: should be impossible with correct types, but guards
  // against partial deploys or cache mismatches at runtime.
  if (!content) {
    return (
      <div className="help-modal-overlay" onClick={onClose}>
        <div
          ref={modalRef}
          className="help-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="help-modal-header">
            <h2 ref={headingRef} tabIndex={-1} id="help-modal-title" className="help-modal-title">Help</h2>
            <button
              className="help-modal-close"
              onClick={onClose}
              aria-label="Close help"
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="help-modal-body">
            <p>Help content is not available for this screen yet.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="help-modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="help-modal-header">
          <h2
            id="help-modal-title"
            ref={headingRef}
            tabIndex={-1}
            className="help-modal-title"
          >
            {content.screenTitle}
          </h2>
          <button
            className="help-modal-close"
            onClick={onClose}
            aria-label="Close help"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div
          className="help-modal-body"
          role="region"
          aria-label="Help content"
          tabIndex={0}
        >
          <p className="help-modal-overview">{content.overview}</p>

          {content.tasks.length > 0 && (
            <section className="help-modal-section">
              <h3 className="help-modal-section-heading">How to…</h3>
              {content.tasks.map((task, i) => (
                <div key={i} className="help-task">
                  <p className="help-task-title">{task.title}</p>
                  <ol className="help-task-steps">
                    {task.steps.map((step, j) => (
                      <li key={j}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </section>
          )}

          {content.tips.length > 0 && (
            <section className="help-modal-section">
              <h3 className="help-modal-section-heading">Tips</h3>
              {content.tips.map((tip, i) => (
                <div key={i} className="help-tip-card">
                  {tip.text}
                </div>
              ))}
            </section>
          )}

          {content.relatedScreens && content.relatedScreens.length > 0 && (
            <section className="help-modal-section">
              <h3 className="help-modal-section-heading">You might also need</h3>
              <div className="help-related-screens">
                {content.relatedScreens.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="help-related-pill"
                    onClick={() => {
                      if (onNavigate) {
                        onNavigate(key);
                      } else {
                        onClose();
                      }
                    }}
                  >
                    {HELP_CONTENT[key]?.screenTitle ?? key}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
