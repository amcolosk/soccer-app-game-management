export interface GuestPlayerAction {
  onOpen: () => void;
  /** When set the button is disabled and this explains why. */
  disabledReason?: string;
}

interface AddGuestPlayerButtonProps {
  action?: GuestPlayerAction;
}

export function AddGuestPlayerButton({ action }: AddGuestPlayerButtonProps) {
  if (!action) return null;
  const disabled = Boolean(action.disabledReason);
  return (
    <span className="add-guest-player">
      <button
        type="button"
        className="btn-secondary add-guest-player__btn"
        onClick={action.onOpen}
        disabled={disabled}
        aria-describedby={disabled ? "add-guest-player-reason" : undefined}
      >
        + Add Guest Player
      </button>
      {disabled && (
        <span id="add-guest-player-reason" className="add-guest-player__reason">
          {action.disabledReason}
        </span>
      )}
    </span>
  );
}
