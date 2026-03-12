import './OfflineBanner.css';

interface OfflineBannerProps {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
}

export function OfflineBanner({ isOnline, pendingCount, isSyncing }: OfflineBannerProps) {
  if (isSyncing) {
    return (
      <div className="offline-banner offline-banner--syncing" role="status" aria-live="polite">
        {pendingCount > 0
          ? `Syncing ${pendingCount} change${pendingCount !== 1 ? 's' : ''}…`
          : 'Syncing…'}
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="offline-banner" role="status" aria-live="polite">
        {pendingCount > 0
          ? `You're offline — ${pendingCount} change${pendingCount !== 1 ? 's' : ''} saved locally`
          : "You're offline"}
      </div>
    );
  }

  return null;
}
