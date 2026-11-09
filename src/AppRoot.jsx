// The full app (sign-in, booking, driver side, dashboard). Loaded on demand so the
// public homepage stays small and fast.
import React, { useEffect } from "react";
import App from "./App.jsx";
import { AuthProvider } from "./lib/auth.jsx";
import { registerServiceWorker } from "./lib/alerts.js";
import { installErrorHandlers, logError, track } from "./lib/track.js";
import { C, FB } from "./theme.js";

// If a screen crashes, show a way back instead of a blank page (and log it for the owner dashboard).
class CrashGuard extends React.Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error, info) { logError(error, `screen crashed${info?.componentStack ? "\n" + info.componentStack.slice(0, 1500) : ""}`); }
  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: C.night, color: C.ice, display: "grid", placeItems: "center", padding: 24, fontFamily: FB }}>
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <div style={{ font: `700 24px/1.2 ${FB}`, marginBottom: 8 }}>Something went wrong</div>
          <p style={{ font: `400 15px/1.5 ${FB}`, color: C.mist, margin: "0 0 18px" }}>We've been told about it. Reload and you'll pick up where you left off.</p>
          <button onClick={() => window.location.reload()} style={{ font: `600 16px ${FB}`, padding: "14px 22px", borderRadius: 999, border: "none",
            background: C.amber, color: C.onAmber, cursor: "pointer", minWidth: 200 }}>Reload DRIFT</button>
        </div>
      </div>
    );
  }
}

export default function AppRoot({ startEntered }) {
  useEffect(() => { registerServiceWorker(); installErrorHandlers(); track("visit"); }, []);
  return <CrashGuard><AuthProvider><App startEntered={startEntered} /></AuthProvider></CrashGuard>;
}
