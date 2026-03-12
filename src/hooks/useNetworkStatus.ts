import { useEffect, useRef, useState } from 'react';

interface UseNetworkStatusOptions {
  onReconnect?: () => void;
}

export function useNetworkStatus(options?: UseNetworkStatusOptions): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const onReconnectRef = useRef(options?.onReconnect);
  onReconnectRef.current = options?.onReconnect;

  // Track previous state to detect offline → online transition
  const prevOnlineRef = useRef(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      const wasOffline = !prevOnlineRef.current;
      prevOnlineRef.current = true;
      setIsOnline(true);
      if (wasOffline) {
        onReconnectRef.current?.();
      }
    };

    const handleOffline = () => {
      prevOnlineRef.current = false;
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline };
}
