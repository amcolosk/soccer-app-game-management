import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered:', r);
      // Check for updates every 60 seconds
      r && setInterval(() => {
        console.log('Checking for updates...');
        r.update();
      }, 60000);
    },
    onRegisterError(error) {
      console.log('SW registration error:', error);
    },
  });

  useEffect(() => {
    if (needRefresh) {
      setShowPrompt(true);
    }
  }, [needRefresh]);

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setShowPrompt(false);
  };

  const reload = () => {
    updateServiceWorker(true);
  };

  if (!showPrompt && !offlineReady) {
    return null;
  }

  return (
    <div className="update-prompt-overlay">
      <div className="update-prompt">
        {offlineReady ? (
          <>
            <div className="update-icon">✓</div>
            <h3>App ready to work offline</h3>
            <button onClick={close} className="btn-primary">
              OK
            </button>
          </>
        ) : (
          <>
            <div className="update-icon">🔄</div>
            <h3>New version available!</h3>
            <p>Click reload to get the latest updates.</p>
            <div className="update-actions">
              <button onClick={reload} className="btn-primary">
                Reload
              </button>
              <button onClick={close} className="btn-secondary">
                Later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
