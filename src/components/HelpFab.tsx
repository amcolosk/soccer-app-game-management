import { useState, useEffect, useRef } from 'react';
import { BugReport } from './BugReport';
import { HelpModal } from './HelpModal';
import { useHelpFab } from '../contexts/HelpFabContext';
import './HelpFab.css';

export function HelpFab() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const { debugContext, helpContext } = useHelpFab();

  const sheetRef = useRef<HTMLDivElement>(null);
  // Flag: open bug report after the sheet close animation finishes
  const openBugReportAfterClose = useRef(false);
  // Flag: open help modal after the sheet close animation finishes
  const openHelpAfterClose = useRef(false);

  // Escape key dismisses the sheet
  useEffect(() => {
    if (!sheetOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [sheetOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move focus to first menu item when sheet opens
  useEffect(() => {
    if (sheetOpen && !isClosing && sheetRef.current) {
      const firstItem = sheetRef.current.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus();
    }
  }, [sheetOpen, isClosing]);

  function openSheet() {
    setIsClosing(false);
    setSheetOpen(true);
  }

  function closeSheet() {
    if (!sheetOpen || isClosing) return;
    setIsClosing(true);
    // Belt-and-suspenders: force close if animationend never fires.
    // Also handles the openBugReportAfterClose flag in case animation is skipped.
    setTimeout(() => {
      setSheetOpen(false);
      setIsClosing(false);
      if (openBugReportAfterClose.current) {
        openBugReportAfterClose.current = false;
        setBugReportOpen(true);
      }
      if (openHelpAfterClose.current) {
        openHelpAfterClose.current = false;
        setHelpModalOpen(true);
      }
    }, 300);
    // handleAnimationEnd will also finalize the close (whichever fires first)
  }

  function handleAnimationEnd(e: React.AnimationEvent<HTMLDivElement>) {
    // Ignore events that bubbled up from child elements
    if (e.target !== sheetRef.current) return;
    if (isClosing) {
      setSheetOpen(false);
      setIsClosing(false);
      if (openBugReportAfterClose.current) {
        openBugReportAfterClose.current = false;
        setBugReportOpen(true);
      }
      if (openHelpAfterClose.current) {
        openHelpAfterClose.current = false;
        setHelpModalOpen(true);
      }
    }
  }

  function handleOpenBugReport() {
    openBugReportAfterClose.current = true;
    closeSheet();
  }

  function handleOpenHelp() {
    openHelpAfterClose.current = true;
    closeSheet();
  }

  return (
    <>
      <button
        className="help-fab"
        aria-label="Help and bug report"
        onClick={openSheet}
        type="button"
      >
        ?
      </button>

      {sheetOpen && (
        <div
          className="help-fab-backdrop"
          onClick={closeSheet}
        >
          <div
            ref={sheetRef}
            className={`help-fab-sheet${isClosing ? ' is-closing' : ''}`}
            role="menu"
            aria-label="Help menu"
            onClick={(e) => e.stopPropagation()}
            onAnimationEnd={handleAnimationEnd}
          >
            <div className="help-fab-sheet-handle" aria-hidden="true" />

            <button
              className="help-fab-sheet-option"
              role="menuitem"
              onClick={handleOpenBugReport}
              type="button"
            >
              <span className="help-fab-sheet-option__icon">🐛</span>
              <span className="help-fab-sheet-option__label">Report a Bug</span>
            </button>

            <button
              className={`help-fab-sheet-option${!helpContext ? ' help-fab-sheet-option--disabled' : ''}`}
              role="menuitem"
              aria-disabled={!helpContext}
              disabled={!helpContext}
              onClick={helpContext ? handleOpenHelp : undefined}
              type="button"
            >
              <span className="help-fab-sheet-option__icon">📖</span>
              <div>
                <span className="help-fab-sheet-option__label">Get Help</span>
                {!helpContext && (
                  <span className="help-fab-sheet-option__subtitle">Coming soon</span>
                )}
              </div>
            </button>
          </div>
        </div>
      )}

      {bugReportOpen && (
        <BugReport
          onClose={() => setBugReportOpen(false)}
          debugContext={debugContext}
        />
      )}

      {helpModalOpen && helpContext && (
        <HelpModal
          helpContext={helpContext}
          onClose={() => setHelpModalOpen(false)}
        />
      )}
    </>
  );
}
