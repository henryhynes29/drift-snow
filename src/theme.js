// ============================================================
// DRIFT theme — single source of truth for color, type, and depth.
// App.jsx, Landing.jsx and PropertyMap.jsx all import from here, so every
// screen switches together.
//
// Modes: "auto" (follows the phone's light/dark setting), "light", "dark".
// Light mode exists for a real reason: people check DRIFT outside, in bright
// sun off fresh snow, where a black screen with gray text washes out.
//
// How switching works: C / E / FD / FB are plain objects that components read
// at render time. applyTheme() rewrites their values in place, then notifies
// listeners (the app shell re-renders). No reload, no lost state.
// ============================================================

const DARK = {
  night: "#0B0B0C",   // app background
  night2: "#131315",  // inset panels, inputs
  slate: "#1A1A1D",   // cards
  slate2: "#222226",  // raised / selected cards
  line: "#2A2A30",    // hairlines
  lineSoft: "#1F1F23",
  ice: "#F5F5F7",     // primary text
  mist: "#A1A1AA",    // secondary text
  mistDim: "#6E6E77", // tertiary text
  amber: "#FFB020",   // brand — fills + accent text
  amberDeep: "#C7830F",
  amberSoft: "#FFC24D",
  onAmber: "#1A1204", // text on amber fills
  plow: "#0A84FF",
  push: "#32D74B",
  onPush: "#06210E",
  good: "#32D74B",
  danger: "#FF453A",
  violet: "#A78BFA",
  glass: "rgba(11,11,12,.82)",       // sticky header / map overlays
  glassStrong: "rgba(19,19,21,.92)",
  scrim: "rgba(0,0,0,.6)",
  mapBg: "#141418",                   // demo map canvas
  mapGrid: "#232329",
};

const LIGHT = {
  night: "#F2F2F7",   // iOS grouped background
  night2: "#F8F8FA",
  slate: "#FFFFFF",
  slate2: "#FFFFFF",
  line: "#E2E2E7",
  lineSoft: "#ECECF0",
  ice: "#111114",
  mist: "#5C5C66",
  mistDim: "#8A8A93",
  amber: "#C47A00",   // deeper marigold: readable as text on white, still reads as the brand
  amberDeep: "#9E6200",
  amberSoft: "#D98A00",
  onAmber: "#FFFFFF",
  plow: "#007AFF",
  push: "#248A3D",
  onPush: "#FFFFFF",
  good: "#248A3D",
  danger: "#D70015",
  violet: "#6D4AE0",
  glass: "rgba(242,242,247,.86)",
  glassStrong: "rgba(255,255,255,.94)",
  scrim: "rgba(0,0,0,.35)",
  mapBg: "#E9EAEE",
  mapGrid: "#D7D9DF",
};

const SHADOW_DARK = {
  low: "0 1px 2px rgba(0,0,0,.30)",
  mid: "0 6px 20px rgba(0,0,0,.28)",
  high: "0 18px 44px rgba(0,0,0,.42)",
  sheet: "0 -12px 40px rgba(0,0,0,.5)",
};
const SHADOW_LIGHT = {
  low: "0 1px 2px rgba(17,17,20,.06)",
  mid: "0 6px 20px rgba(17,17,20,.08)",
  high: "0 18px 44px rgba(17,17,20,.14)",
  sheet: "0 -12px 40px rgba(17,17,20,.14)",
};

// SF-first system stack — matches the Apple ecosystem, no web-font download.
export const FD = '-apple-system,"SF Pro Display","SF Pro Text",system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
export const FB = '-apple-system,"SF Pro Text",system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

const KEY = "drift-theme";

export function getThemeMode() {
  try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; }
}
function systemLight() {
  try { return window.matchMedia("(prefers-color-scheme: light)").matches; } catch (e) { return false; }
}
export function resolveTheme(mode = getThemeMode()) {
  return mode === "auto" ? (systemLight() ? "light" : "dark") : mode;
}

const initial = resolveTheme();
export const C = { ...(initial === "light" ? LIGHT : DARK) };
export const E = { ...(initial === "light" ? SHADOW_LIGHT : SHADOW_DARK) };
export let isLight = initial === "light";

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function paintChrome() {
  if (typeof document === "undefined") return;
  document.body.style.background = C.night;
  document.documentElement.style.colorScheme = isLight ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", C.night);
}

// Switch theme in place. `mode` = "auto" | "light" | "dark".
export function applyTheme(mode) {
  try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode — still switches for this session */ }
  const resolved = resolveTheme(mode);
  isLight = resolved === "light";
  Object.assign(C, isLight ? LIGHT : DARK);
  Object.assign(E, isLight ? SHADOW_LIGHT : SHADOW_DARK);
  paintChrome();
  listeners.forEach((fn) => fn(resolved, mode));
}

// Follow the phone's setting live while in "auto".
if (typeof window !== "undefined" && window.matchMedia) {
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (getThemeMode() === "auto") applyTheme("auto");
    });
  } catch (e) { /* older Safari — auto still resolves on next launch */ }
}
paintChrome();
