// Tiny first-party stats + error log for the owner dashboard. No third parties,
// no cookies: a random ID on this phone, and each event counted at most once a day.
import { supabase, supabaseEnabled } from "./supabase.js";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const isOwnerPage = () => /[?&](admin|ops)=/.test(location.search);

function anonId() {
  try {
    let id = localStorage.getItem("drift.aid");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 32);
      localStorage.setItem("drift.aid", id);
    }
    return id;
  } catch { return null; }
}

let who = { userId: null, role: null };
export function setTrackUser(userId, role) {
  who = { userId: userId || null, role: !userId ? null : role === "driver" ? "driver" : "customer" };
}

// visit · active · map_start · map_done · online
export function track(name) {
  if (!supabaseEnabled || typeof window === "undefined" || isOwnerPage()) return;
  try {
    const aid = anonId();
    if (!aid) return;
    const key = `drift.ev.${name}${name === "active" || name === "online" ? "." + (who.userId || "") : ""}`, d = today();
    if (localStorage.getItem(key) === d) return;
    localStorage.setItem(key, d);
    let source = null;
    try { source = localStorage.getItem("drift.ref"); } catch { /* ignore */ }
    supabase.from("app_events").insert({ name, anon_id: aid, user_id: who.userId, role: who.role, source, path: location.pathname.slice(0, 120) })
      .then(() => {}, () => {});
  } catch { /* stats never break the app */ }
}

// ---------- errors ----------
let sent = 0;
const seen = new Set();
const safeUrl = () => location.pathname + (location.search ? "?" + [...new URLSearchParams(location.search).keys()].join("&") : "");
export function logError(err, where) {
  if (!supabaseEnabled || typeof window === "undefined") return;
  try {
    const message = String(err?.message || err || "Unknown error").slice(0, 500);
    if (/ResizeObserver loop|^Script error\.?$/i.test(message)) return;   // browser noise
    const k = message + "|" + (where || "");
    if (seen.has(k) || sent >= 8) return;
    seen.add(k); sent += 1;
    supabase.from("app_errors").insert({
      kind: "app", message, user_id: who.userId, role: who.role,
      detail: [where && `where: ${where}`, err?.stack].filter(Boolean).join("\n").slice(0, 4000),
      url: safeUrl().slice(0, 500), ua: navigator.userAgent.slice(0, 300),
    }).then(() => {}, () => {});
  } catch { /* ignore */ }
}

export function installErrorHandlers() {
  if (typeof window === "undefined" || window.__driftErrors) return;
  window.__driftErrors = true;
  window.addEventListener("error", (e) => { if (e.error || e.message) logError(e.error || e.message); });
  window.addEventListener("unhandledrejection", (e) => logError(e.reason || "Unhandled promise rejection"));
}
