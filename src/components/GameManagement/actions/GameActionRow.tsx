import { useCallback, useMemo, useRef, useState } from 'react';
import type { GameActionDescriptor } from './actionContract';
import { sortGameActions } from './actionContract';
import { useConfirm } from '../../ConfirmModal';

interface GameActionRowProps {
  actions: GameActionDescriptor[];
  headingIdForDeleteSuccessFocus?: string;
  onActionError?: (message: string) => void;
}

export function GameActionRow({ actions, headingIdForDeleteSuccessFocus, onActionError }: GameActionRowProps) {
  const confirm = useConfirm();
  const sortedActions = useMemo(() => sortGameActions(actions), [actions]);
  const [isBusy, setIsBusy] = useState(false);
  const invokingButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Ref-based guard so that duplicate invocations are blocked synchronously,
   *  even before a React state update can commit. */
  const isInflightRef = useRef(false);

  const focusInvokingButton = useCallback(() => {
    const btn = invokingButtonRef.current;
    if (!btn || !btn.isConnected) return false;
    btn.focus({ preventScroll: true });
    return true;
  }, []);

  /** Schedules focus restoration after an action completes successfully.
   *  Runs in a setTimeout so it fires after ConfirmProvider's own focus
   *  restoration attempt; if the invoking button is gone (row unmounted after
   *  delete), falls back to the section heading. */
  const scheduleFocusAfterAction = useCallback((actionId?: GameActionDescriptor['id']) => {
    const clearInvokingButtonRef = () => {
      invokingButtonRef.current = null;
    };

    window.setTimeout(() => {
      focusInvokingButton();
      if (actionId === 'delete' && headingIdForDeleteSuccessFocus) {
        // Wait one more tick so React can commit any row unmount from the delete action
        // before we decide whether to fall back focus to the section heading.
        window.setTimeout(() => {
          const invokingButton = invokingButtonRef.current;
          if (!invokingButton || !invokingButton.isConnected) {
            document.getElementById(headingIdForDeleteSuccessFocus)?.focus();
          }
          clearInvokingButtonRef();
        }, 0);
        return;
      }
      clearInvokingButtonRef();
    }, 0);
  }, [focusInvokingButton, headingIdForDeleteSuccessFocus]);

  const invokeAction = async (action: GameActionDescriptor, trigger: HTMLButtonElement) => {
    if (action.disabled) return;
    if (isInflightRef.current) return;

    invokingButtonRef.current = trigger;

    if (action.confirmDialog) {
      // Block re-entry while the shared confirm modal is open.
      isInflightRef.current = true;
      const confirmed = await confirm({
        title: action.confirmDialog.title,
        message: action.confirmDialog.body,
        bodyContent: action.confirmDialog.authorReminder ? (
          <>
            <p className="confirm-message">{action.confirmDialog.body}</p>
            <p className="confirm-message confirm-message--secondary">{action.confirmDialog.authorReminder}</p>
          </>
        ) : undefined,
        confirmText: action.confirmDialog.confirmText,
        cancelText: action.confirmDialog.cancelText,
        variant: 'danger',
      });

      if (!confirmed) {
        // ConfirmProvider handles focus restoration for cancel.
        isInflightRef.current = false;
        return;
      }
    }

    isInflightRef.current = true;
    setIsBusy(true);
    const actionId = action.id;
    try {
      await action.onAction();
      scheduleFocusAfterAction(actionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed';
      onActionError?.(message);
      // Restore focus to the invoking button after it is re-enabled (setIsBusy(false)
      // fires in finally) so the user lands on a stable retry target without having
      // to hunt for focus after a failed delete.
      window.setTimeout(() => {
        focusInvokingButton();
      }, 0);
    } finally {
      isInflightRef.current = false;
      setIsBusy(false);
    }
  };

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
            disabled={action.disabled || isBusy}
            title={action.disabledReason}
          >
            {isBusy && action.id === 'delete' ? 'Deleting\u2026' : action.label}
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

      {isBusy && (
        <span role="status" className="sr-only">Deleting, please wait\u2026</span>
      )}
    </>
  );
}
