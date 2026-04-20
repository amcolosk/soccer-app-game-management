import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameActionDescriptor } from './actionContract';
import { sortGameActions } from './actionContract';

interface GameActionRowProps {
  actions: GameActionDescriptor[];
  headingIdForDeleteSuccessFocus?: string;
  onActionError?: (message: string) => void;
}

export function GameActionRow({ actions, headingIdForDeleteSuccessFocus, onActionError }: GameActionRowProps) {
  const sortedActions = useMemo(() => sortGameActions(actions), [actions]);
  const [pendingAction, setPendingAction] = useState<GameActionDescriptor | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const invokingButtonRef = useRef<HTMLButtonElement | null>(null);

  const focusInvokingButton = useCallback(() => {
    if (invokingButtonRef.current && invokingButtonRef.current.isConnected) {
      invokingButtonRef.current.focus({ preventScroll: true });
      return true;
    }
    return false;
  }, []);

  const restoreFocusAfterModalClose = useCallback((actionId?: GameActionDescriptor['id']) => {
    window.setTimeout(() => {
      const restored = focusInvokingButton();
      if (!restored && actionId === 'delete' && headingIdForDeleteSuccessFocus) {
        document.getElementById(headingIdForDeleteSuccessFocus)?.focus();
      }
      invokingButtonRef.current = null;
    }, 0);
  }, [focusInvokingButton, headingIdForDeleteSuccessFocus]);

  const invokeAction = async (action: GameActionDescriptor, trigger: HTMLButtonElement) => {
    if (action.disabled) return;

    invokingButtonRef.current = trigger;

    if (action.confirmDialog) {
      setModalError('');
      setPendingAction(action);
      return;
    }

    try {
      await action.onAction();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed';
      onActionError?.(message);
    }
  };

  const handleCancel = useCallback(() => {
    const cancelledActionId = pendingAction?.id;
    setPendingAction(null);
    setModalError('');
    restoreFocusAfterModalClose(cancelledActionId);
  }, [pendingAction, restoreFocusAfterModalClose]);

  const handleConfirm = async () => {
    if (!pendingAction) return;

    setIsBusy(true);
    const confirmedActionId = pendingAction.id;
    try {
      await pendingAction.onAction();
      setPendingAction(null);
      setModalError('');
      restoreFocusAfterModalClose(confirmedActionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed';
      setModalError(message);
      onActionError?.(message);
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!pendingAction?.confirmDialog) return;

    const handleDocumentEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleCancel();
    };

    document.addEventListener('keydown', handleDocumentEscape);
    return () => {
      document.removeEventListener('keydown', handleDocumentEscape);
    };
  }, [handleCancel, pendingAction?.confirmDialog]);

  return (
    <>
      <div className="game-action-row" role="group" aria-label="Row actions">
        {sortedActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.kind === 'destructive' ? 'btn-delete game-action-btn' : 'btn-secondary game-action-btn'}
            aria-label={action.ariaLabel}
            onClick={(event) => void invokeAction(action, event.currentTarget)}
            disabled={action.disabled}
            title={action.disabledReason}
          >
            {action.label}
          </button>
        ))}
      </div>

      {sortedActions.map((action) => (
        action.disabledReason ? (
          <p key={`${action.id}-reason`} className="game-action-disabled-reason">{action.disabledReason}</p>
        ) : null
      ))}

      {sortedActions.map((action) => (
        action.srStatusText ? (
          <span key={`${action.id}-sr`} className="sr-only">{action.srStatusText}</span>
        ) : null
      ))}

      {pendingAction?.confirmDialog && (
        <div className="confirm-overlay" onClick={handleCancel}>
          <div className="confirm-modal confirm-modal--danger" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <h3 className="confirm-title">{pendingAction.confirmDialog.title}</h3>
            <p className="confirm-message">{pendingAction.confirmDialog.body}</p>
            {pendingAction.confirmDialog.authorReminder && (
              <p className="confirm-message">{pendingAction.confirmDialog.authorReminder}</p>
            )}
            {modalError && <p className="error-message" aria-live="assertive">{modalError}</p>}
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn--cancel" onClick={handleCancel} autoFocus>
                {pendingAction.confirmDialog.cancelText}
              </button>
              <button className="confirm-btn confirm-btn--confirm confirm-btn--danger" onClick={() => void handleConfirm()} disabled={isBusy}>
                {isBusy ? 'Deleting...' : pendingAction.confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
