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
import type { Schema } from "../amplify/data/resource";

Amplify.configure(outputs);

// Expose a cleanup function for E2E tests to delete orphaned data
// This runs in the browser context via page.evaluate()
if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
  (window as any).__cleanupAllData = async () => {
    // Generate client inside the function so it uses the current auth session
    const { generateClient } = await import('aws-amplify/data');
    const cleanupClient = generateClient<Schema>();
    
    const models = ['PlayTimeRecord', 'Goal', 'GameNote', 'Substitution', 'Game', 'LineupAssignment', 'PlannedRotation', 'GamePlan', 'PlayerAvailability'] as const;
    const results: Record<string, number> = {};
    
    for (const modelName of models) {
      let deleted = 0;
      let nextToken: string | null | undefined = undefined;
      let hasMore = true;
      
      while (hasMore) {
        try {
          const opts: any = { limit: 1000 };
          if (nextToken) opts.nextToken = nextToken;
          const response = await (cleanupClient.models as any)[modelName].list(opts);
          
          if (response.data && response.data.length > 0) {
            // Delete in parallel batches of 10 for speed
            const items = response.data;
            for (let i = 0; i < items.length; i += 10) {
              const batch = items.slice(i, i + 10);
              await Promise.allSettled(
                batch.map((item: any) =>
                  (cleanupClient.models as any)[modelName].delete({ id: item.id })
                )
              );
              deleted += batch.length;
            }
          }
          
          nextToken = response.nextToken;
          hasMore = !!nextToken;
        } catch {
          hasMore = false;
        }
      }
      
      results[modelName] = deleted;
    }
    
    return results;
  };

  // Helper for E2E tests to get the first team's ID (for /reports/:teamId navigation)
  (window as any).__getFirstTeamId = async () => {
    const { generateClient } = await import('aws-amplify/data');
    const client = generateClient<Schema>();
    const teams = await client.models.Team.list();
    return teams.data?.[0]?.id || null;
  };
}

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
