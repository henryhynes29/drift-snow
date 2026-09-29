// Driver job alerts: the loud in-app ring, keeping the screen awake while
// online, "Add to Home Screen" install, and push notifications when the app is
// closed. Everything here fails quietly on browsers that don't support it.
import { supabase, supabaseEnabled } from "./supabase.js";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// ---------- service worker (needed for install + push) ----------
let swReg = null;
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").then((r) => { swReg = r; }).catch(() => {});
}
async function getReg() {
  if (swReg) return swReg;
  if (!("serviceWorker" in navigator)) return null;
  try { swReg = await navigator.serviceWorker.ready; } catch { swReg = null; }
  return swReg;
}

// ---------- the ring ----------
// A classic phone ring (two tones, ring-ring … pause), generated in the browser
// so there's no sound file to host. Played through an <audio> element, which
// iPhones still play when the ringer switch is on silent-for-apps.
let audio = null;
function makeRingtone() {
  const rate = 22050, secs = 3.0, n = Math.floor(rate * secs);
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // ring 0.0–0.9s and 1.1–2.0s, silent 2.0–3.0s
    const on = (t < 0.9) || (t > 1.1 && t < 2.0);
    const local = t < 1 ? t : t - 1.1;
    const env = on ? Math.min(1, local * 40, (0.9 - local) * 40) : 0;
    const s = env * 0.45 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t))
      * (0.75 + 0.25 * Math.sign(Math.sin(2 * Math.PI * 20 * t))); // 20 Hz warble like a bell ringer
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
function ensureAudio() {
  if (audio || typeof Audio === "undefined") return audio;
  audio = new Audio(makeRingtone());
  audio.loop = true;
  audio.preload = "auto";
  return audio;
}
// Browsers only allow sound after the person taps something. Call this from a
// tap (e.g. "Go online") so the ring can play later on its own.
export function unlockRinger() {
  const a = ensureAudio();
  if (!a) return;
  a.muted = true;
  a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
}
let buzz = null;
export function startRing() {
  const a = ensureAudio();
  if (a) { a.muted = false; a.volume = 1; a.currentTime = 0; a.play().catch(() => {}); }
  if (navigator.vibrate) {
    navigator.vibrate([600, 250, 600, 900]);
    clearInterval(buzz);
    buzz = setInterval(() => navigator.vibrate([600, 250, 600, 900]), 2400);
  }
}
export function stopRing() {
  if (audio) { audio.pause(); audio.currentTime = 0; }
  clearInterval(buzz); buzz = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

// ---------- keep the screen on while online ----------
let wakeLock = null, wantAwake = false;
export async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wantAwake) keepAwake(true);
  });
}

// ---------- "Add to Home Screen" ----------
let deferredInstall = null;
const installListeners = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredInstall = e; installListeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => { deferredInstall = null; installListeners.forEach((f) => f()); });
}
export const onInstallChange = (f) => { installListeners.add(f); return () => installListeners.delete(f); };
export const isStandalone = () => typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
export const isIOS = () => typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
export const canPromptInstall = () => !!deferredInstall;
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice.catch(() => ({ outcome: "dismissed" }));
  deferredInstall = null; installListeners.forEach((f) => f());
  return outcome === "accepted";
}

// ---------- push notifications (alerts when the app is closed) ----------
export const pushSupported = () => typeof window !== "undefined" && "Notification" in window &&
  "serviceWorker" in navigator && "PushManager" in window && !!VAPID_PUBLIC;
export const pushPermission = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
// Ask permission (must be called from a tap) and save this phone's subscription.
export async function enablePush(userId) {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone()
    ? "On iPhone, add DRIFT to your Home Screen first, then turn on alerts from the app."
    : "This browser can't show job alerts.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Alerts are blocked. Allow notifications for DRIFT in your phone's settings.");
  const reg = await getReg();
  if (!reg) throw new Error("Couldn't start alerts on this phone.");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
  const j = sub.toJSON();
  if (supabaseEnabled && userId) {
    const { error } = await supabase.from("push_subscriptions").upsert({
      user_id: userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth,
      user_agent: navigator.userAgent.slice(0, 250),
    }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
  }
  return true;
}
export async function pushEnabled() {
  if (!pushSupported() || pushPermission() !== "granted") return false;
  const reg = await getReg();
  return !!(reg && await reg.pushManager.getSubscription());
}

// When the app is open but in the background, show a local alert right away.
export async function localAlert(title, body) {
  try {
    if (pushPermission() !== "granted" || !document.hidden) return;
    const reg = await getReg();
    reg?.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png", tag: "offer",
      renotify: true, requireInteraction: true, vibrate: [600, 250, 600, 250, 600] });
  } catch { /* ignore */ }
}
