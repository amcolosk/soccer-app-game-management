import { useState, useEffect } from 'react';
import { fetchUserAttributes } from 'aws-amplify/auth';

interface UseDeveloperAccessReturn {
  checking: boolean;
  isDeveloper: boolean;
  userEmail: string | null;
}

export function useDeveloperAccess(): UseDeveloperAccessReturn {
  const [checking, setChecking] = useState(true);
  const [isDeveloper, setIsDeveloper] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const allowlist = (import.meta.env.VITE_DEVELOPER_EMAILS ?? '')
      .split(',')
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean);

    if (allowlist.length === 0) {
      setChecking(false);
      return;
    }

    fetchUserAttributes()
      .then((attrs) => {
        const email = (attrs.email ?? '').toLowerCase();
        setUserEmail(email || null);
        setIsDeveloper(allowlist.includes(email));
      })
      .catch(() => {
        setIsDeveloper(false);
      })
      .finally(() => setChecking(false));
  }, []);

  return { checking, isDeveloper, userEmail };
}
