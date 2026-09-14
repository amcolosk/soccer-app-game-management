import { useState } from "react";
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import App from "./App.tsx";
import { LandingPage } from "./components/LandingPage.tsx";
import { UpdatePrompt } from "./components/UpdatePrompt.tsx";
import '@aws-amplify/ui-react/styles.css';

// Extracted from main.tsx (routing restructure, Milestone B1 — Fan Mode):
// `main.tsx` now owns only Amplify.configure, the hoisted BrowserRouter/
// Suspense/Routes, and the public /watch/:token route. Everything the
// authenticated app shell needs — Authenticator.Provider, Root's
// configuring/landing/authenticator/app branches, UpdatePrompt, and the
// amplify-ui stylesheet — lives here so it can be lazy-loaded and kept out
// of the public route's bundle (this file is loaded via
// `React.lazy(() => import('./AppRoot'))`).

function Root() {
  const { authStatus } = useAuthenticator(context => [context.authStatus]);
  const [showLogin, setShowLogin] = useState(false);

  if (authStatus === 'configuring') {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (authStatus === 'authenticated') {
    return (
      <>
        <App />
        <UpdatePrompt />
      </>
    );
  }

  if (showLogin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--background)' }}>
        <button
          onClick={() => setShowLogin(false)}
          style={{
            alignSelf: 'flex-start',
            margin: '1rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1rem',
            color: 'var(--text-secondary)'
          }}
        >
          ← Back to Home
        </button>
        <Authenticator />
      </div>
    );
  }

  return (
    <>
      <LandingPage onLogin={() => setShowLogin(true)} />
      <UpdatePrompt />
    </>
  );
}

export default function AppRoot() {
  return (
    <Authenticator.Provider>
      <Root />
    </Authenticator.Provider>
  );
}
