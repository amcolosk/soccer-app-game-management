import { useEffect, useRef, useState } from "react";
import type { FormationPosition } from "../../types/schema";
import { GuestPlayerFields } from "../GuestPlayerFields";
import {
  EMPTY_GUEST_PLAYER_FIELDS,
  type GuestPlayerFieldValues,
} from "../guestPlayerFieldValues";

interface AddGuestPlayerModalProps {
  isOpen: boolean;
  positions: Pick<FormationPosition, "id" | "abbreviation" | "positionName">[];
  onClose: () => void;
  /** Resolves true when the guest was added (modal closes), false to keep it open. */
  onSubmit: (values: GuestPlayerFieldValues) => Promise<boolean>;
}

export function AddGuestPlayerModal({ isOpen, positions, onClose, onSubmit }: AddGuestPlayerModalProps) {
  const [values, setValues] = useState<GuestPlayerFieldValues>(EMPTY_GUEST_PLAYER_FIELDS);
  const [isSaving, setIsSaving] = useState(false);
  const inFlightRef = useRef(false);
  const firstNameRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setValues(EMPTY_GUEST_PLAYER_FIELDS);
    firstNameRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select, textarea",
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    // Ref guard: state alone can't stop a second tap landing before re-render.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsSaving(true);
    try {
      const added = await onSubmit(values);
      if (added) onClose();
    } finally {
      inFlightRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={isSaving ? undefined : onClose}>
      <div
        className="modal-content modal-add-guest-player"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-guest-player-title"
        onClick={(event) => event.stopPropagation()}
        ref={containerRef}
      >
        <h2 id="add-guest-player-title">Add Guest Player</h2>
        <p className="form-hint">
          Added to your team roster and flagged as a guest. Their play time and stats count like any other player's.
        </p>
        <GuestPlayerFields
          idPrefix="add-guest"
          values={values}
          positions={positions}
          disabled={isSaving}
          firstNameRef={firstNameRef}
          onFieldChange={(field, value) => setValues((prev) => ({ ...prev, [field]: value }))}
          onPositionsChange={(ids) => setValues((prev) => ({ ...prev, preferredPositionIds: ids }))}
        />
        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={() => void handleSubmit()} disabled={isSaving}>
            {isSaving ? "Adding…" : "Add Guest"}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
