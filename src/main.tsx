import React from "react";
import ReactDOM from "react-dom/client";
import { Authenticator } from '@aws-amplify/ui-react';
import App from "./App.tsx";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Authenticator>
      <App />
      <UpdatePrompt />
    </Authenticator>
  </React.StrictMode>
);
