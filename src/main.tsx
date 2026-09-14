/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./AppRouter.tsx";
import "./index.css";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import { initGA } from "./utils/analytics.ts";
import type { Schema } from "../amplify/data/resource";
import { cleanupAllDataForE2E } from "./utils/e2eCleanup.ts";

Amplify.configure(outputs);

// Expose a cleanup function for E2E tests to delete orphaned data
// This runs in the browser context via page.evaluate()
if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
  (window as any).__cleanupAllData = async () => {
    // Generate client inside the function so it uses the current auth session
    const { generateClient } = await import('aws-amplify/data');
    const cleanupClient = generateClient<Schema>();

    return cleanupAllDataForE2E(cleanupClient as any);
  };

  // Helper for E2E tests to get the first team's ID (for /reports/:teamId navigation)
  (window as any).__getFirstTeamId = async () => {
    const { generateClient } = await import('aws-amplify/data');
    const client = generateClient<Schema>();
    const teams = await client.models.Team.list();
    return teams.data?.[0]?.id || null;
  };
}

// Initialize Google Analytics — guarded so it never fires for the public,
// unauthenticated /watch/:token (and, in Milestone B2, /track/:token) route,
// which shows no consent surface and has no coach session to attribute
// events to.
const gaMeasurementId = (outputs as any).custom?.ga_measurement_id;
const isPublicShareRoute = /^\/(watch|track)\//.test(window.location.pathname);
if (gaMeasurementId && !isPublicShareRoute) {
  initGA(gaMeasurementId);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);
