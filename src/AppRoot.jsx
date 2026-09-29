// The full app (sign-in, booking, driver side, dashboard). Loaded on demand so the
// public homepage stays small and fast.
import React, { useEffect } from "react";
import App from "./App.jsx";
import { AuthProvider } from "./lib/auth.jsx";
import { registerServiceWorker } from "./lib/alerts.js";

export default function AppRoot({ startEntered }) {
  useEffect(() => { registerServiceWorker(); }, []);
  return <AuthProvider><App startEntered={startEntered} /></AuthProvider>;
}
