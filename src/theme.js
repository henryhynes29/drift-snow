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
  night: "#07090D",   // app background — lake-night (matches the landing page)
  night2: "#0D1118",  // inset panels, inputs
  slate: "#121822",   // cards
  slate2: "#18202C",  // raised / selected cards
  line: "#243042",    // hairlines
  lineSoft: "#1A2230",
  ice: "#EEF3F8",     // primary text
  mist: "#9BA7B7",    // secondary text
  mistDim: "#66738A", // tertiary text
  amber: "#FFB020",   // brand — plow-beacon amber
  amberDeep: "#C7830F",
  amberSoft: "#FFD166",
  onAmber: "#1A1204", // text on amber fills
  plow: "#4C9BFF",
  push: "#3DDC84",
  onPush: "#062112",
  good: "#3DDC84",
  danger: "#FF5A4F",
  violet: "#A78BFA",
  glass: "rgba(7,9,13,.8)",          // sticky header / map overlays
  glassStrong: "rgba(13,17,24,.93)",
  scrim: "rgba(0,0,0,.62)",
  mapBg: "#0F141C",                  // demo map canvas
  mapGrid: "#1C2430",
};

const LIGHT = {
  night: "#EEF2F6",   // cool snow-white background
  night2: "#F7F9FB",
  slate: "#FFFFFF",
  slate2: "#FFFFFF",
  line: "#DDE3EA",
  lineSoft: "#E8EDF2",
  ice: "#0E131A",
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

// DRIFT type (shared with the landing page; fonts are bundled, see main.jsx):
//   FD — Big Shoulders Display: condensed Great-Lakes industrial display, for
//        headings and big numbers. FB — Instrument Sans for everything else.
//   FM — IBM Plex Mono for small labels/readouts.
export const FD = '"Big Shoulders Display", Impact, "Arial Narrow", sans-serif';
export const FB = '"Instrument Sans", -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
export const FM = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

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
