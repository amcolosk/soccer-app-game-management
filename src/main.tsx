import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import App from "./App.tsx";
import { LandingPage } from "./components/LandingPage.tsx";
import { UpdatePrompt } from "./components/UpdatePrompt.tsx";
import "./index.css";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import '@aws-amplify/ui-react/styles.css';
import { initGA } from "./utils/analytics.ts";

Amplify.configure(outputs);

// Initialize Google Analytics
const gaMeasurementId = (outputs as any).custom?.ga_measurement_id;
if (gaMeasurementId) {
  initGA(gaMeasurementId);
}

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Authenticator.Provider>
      <Root />
    </Authenticator.Provider>
  </React.StrictMode>
);
