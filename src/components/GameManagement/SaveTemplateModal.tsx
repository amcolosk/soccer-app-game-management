import { useEffect, useId, useRef, useState } from "react";
import { MAX_TEMPLATE_NAME_LENGTH } from "../../utils/planTemplateUtils";

interface SaveTemplateModalProps {
  mode: "save" | "rename";
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

export function SaveTemplateModal({ mode, initialName = "", onSubmit, onClose }: SaveTemplateModalProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isBusy, onClose]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name for the template.");
      return;
    }
    if (trimmed.length > MAX_TEMPLATE_NAME_LENGTH) {
      setError(`Names are limited to ${MAX_TEMPLATE_NAME_LENGTH} characters.`);
      return;
    }
    setError(null);
    setSubmitFailed(false);
    setIsBusy(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSubmitFailed(true);
      setIsBusy(false);
    }
  };

  const title = mode === "save" ? "Save Lineup Template" : "Rename Template";

  return (
    <div className="modal-overlay" onClick={() => !isBusy && onClose()}>
      <div
        className="modal-content save-template-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        aria-busy={isBusy}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="save-template-title">{title}</h2>
        {mode === "save" && (
          <p className="save-template-modal__hint">
            Saves the starting lineup and halftime lineup from this plan. Rotations are not saved.
          </p>
        )}
        <div className="form-group">
          <label htmlFor="save-template-name">Template name</label>
          <input
            id="save-template-name"
            ref={inputRef}
            type="text"
            value={name}
            maxLength={MAX_TEMPLATE_NAME_LENGTH}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder="e.g. 2-3-1 standard"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={isBusy}
          />
          <div className="char-counter">
            {name.length} / {MAX_TEMPLATE_NAME_LENGTH}
          </div>
        </div>
        {error && (
          <p id={errorId} className="save-template-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={isBusy}>
            {isBusy ? "Saving..." : submitFailed ? "Retry" : mode === "save" ? "Save" : "Rename"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
