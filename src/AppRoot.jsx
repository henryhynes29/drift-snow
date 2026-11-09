// The full app (sign-in, booking, driver side, dashboard). Loaded on demand so the
// public homepage stays small and fast.
import React, { useEffect, useState } from "react";
import App from "./App.jsx";
import { AuthProvider } from "./lib/auth.jsx";
import { registerServiceWorker } from "./lib/alerts.js";
import { installErrorHandlers, logError, track } from "./lib/track.js";
import { C, FB } from "./theme.js";

// If a screen crashes, show a way back instead of a blank page (and log it for the owner dashboard).
class CrashGuard extends React.Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error, info) {
    if (window.__driftReloadForUpdate?.(error)) return;   // an old screen after an update: just reload
    logError(error, `screen crashed${info?.componentStack ? "\n" + info.componentStack.slice(0, 1500) : ""}`);
  }
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

// A newer version went live while this page was open: offer a one-tap refresh.
const BUILD = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : null;
function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!BUILD) return;
    let stop = false;
    const check = async () => {
      if (stop || document.hidden) return;
      try {
        const r = await fetch("/version.json", { cache: "no-store" });
        if (!r.ok) return;
        const { id } = await r.json();
        if (id && id !== BUILD) setReady(true);
      } catch { /* offline — try later */ }
    };
    const first = setTimeout(check, 20000);
    const iv = setInterval(check, 10 * 60000);
    const vis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearTimeout(first); clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, []);
  if (!ready) return null;
  return (
    <button onClick={() => window.location.reload()} style={{ position: "fixed", zIndex: 95, left: "50%", transform: "translateX(-50%)",
      top: "calc(10px + env(safe-area-inset-top))", display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 999,
      border: `1px solid ${C.amber}88`, background: C.slate, color: C.ice, font: `600 14px ${FB}`, cursor: "pointer",
      boxShadow: "0 8px 30px rgba(0,0,0,.25)", whiteSpace: "nowrap" }}>
      DRIFT was updated <span style={{ color: C.amber }}>Refresh</span>
    </button>
  );
}

export default function AppRoot({ startEntered }) {
  useEffect(() => { registerServiceWorker(); installErrorHandlers(); track("visit"); }, []);
  return <CrashGuard><AuthProvider><App startEntered={startEntered} /></AuthProvider><UpdateBanner /></CrashGuard>;
}
