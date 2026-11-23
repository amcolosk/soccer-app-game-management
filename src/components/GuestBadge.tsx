interface GuestBadgeProps {
  /** Single-letter mark for space-constrained chips; full "Guest" badge otherwise. */
  compact?: boolean;
}

export function GuestBadge({ compact = false }: GuestBadgeProps) {
  if (compact) {
    return (
      <span className="guest-mark" title="Guest player">
        <span aria-hidden="true">G</span>
        <span className="sr-only">Guest</span>
      </span>
    );
  }
  return <span className="status-badge status-badge--guest">Guest</span>;
}
