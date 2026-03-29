import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx.confirm;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const returnFocusToRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  const restoreFocus = useCallback(() => {
    const target = returnFocusToRef.current;
    if (!target || !target.isConnected) return;
    if ((target as HTMLButtonElement).disabled) return;

    window.setTimeout(() => {
      if (target.isConnected) {
        target.focus({ preventScroll: true });
      }
    }, 0);
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const activeElement = document.activeElement;
      returnFocusToRef.current = activeElement instanceof HTMLElement ? activeElement : null;
      setState({ ...options, resolve });
    });
  }, []);

  const closeWithResult = useCallback((result: boolean) => {
    const resolver = state?.resolve;
    setState(null);
    if (resolver) {
      resolver(result);
    }
    restoreFocus();
  }, [restoreFocus, state]);

  const handleConfirm = () => {
    closeWithResult(true);
  };

  const handleCancel = () => {
    closeWithResult(false);
  };

  useEffect(() => {
    if (!state) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWithResult(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeWithResult, state]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div className="confirm-overlay" onClick={handleCancel}>
          <div
            className={`confirm-modal confirm-modal--${state.variant || 'default'}`}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={state.title ? titleId : undefined}
            aria-describedby={messageId}
          >
            {state.title && (
              <h3 id={titleId} className="confirm-title">
                {state.title}
              </h3>
            )}
            <p id={messageId} className="confirm-message">
              {state.message}
            </p>
            <div className="confirm-actions">
              <button
                className="confirm-btn confirm-btn--cancel"
                onClick={handleCancel}
                autoFocus
              >
                {state.cancelText || 'Cancel'}
              </button>
              <button
                className={`confirm-btn confirm-btn--confirm confirm-btn--${state.variant || 'default'}`}
                onClick={handleConfirm}
              >
                {state.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
