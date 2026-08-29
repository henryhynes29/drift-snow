// Notification transport for DRIFT.
//
// In-app notifications live in React state (see the reducer's NOTIFY action) and
// render in the bell / notification sheet. THIS file is the bridge to *external*
// delivery — push notifications and SMS — which you'll want so a customer knows
// their driver is on the way even when the app is closed.
//
// It's a safe no-op today. When you're ready:
//   - Web push: add a service worker + VAPID keys, implement sendPush().
//   - SMS: add Twilio creds server-side + an /api/send-sms function, call it from sendSms().
// The rest of the app already calls deliverExternal(), so wiring either channel
// later doesn't touch any UI code.

export const PUSH_ENABLED = !!import.meta.env.VITE_PUSH_PUBLIC_KEY; // VAPID public key
export const SMS_ENABLED = false; // flip on once /api/send-sms exists

// A notification shape used across the app:
//   { id, kind: 'job'|'payment'|'system'|'promo', title, body, ts, role: 'rider'|'driver'|'both' }

async function sendPush(_n) {
  if (!PUSH_ENABLED) return false;
  // TODO: registration.showNotification(...) via an active service worker.
  return false;
}

async function sendSms(_n, _phone) {
  if (!SMS_ENABLED) return false;
  // TODO: await fetch('/api/send-sms', { method:'POST', body: JSON.stringify({ to: _phone, body: _n.body }) })
  return false;
}

// Fire-and-forget external delivery. Never throws — external delivery must never
// block or break the in-app experience.
export async function deliverExternal(n, { phone } = {}) {
  try {
    await Promise.allSettled([sendPush(n), sendSms(n, phone)]);
  } catch { /* ignore */ }
}

// Ask the browser for notification permission (call from a user gesture later).
export async function requestPushPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}
