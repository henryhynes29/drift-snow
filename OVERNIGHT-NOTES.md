# DRIFT — overnight build notes

Everything below is in this zip, builds clean, and is **feature-flagged** so your live
demo keeps working exactly as-is until you turn things on. Two independent code
reviews found **no runtime bugs** in this batch.

## 1. Bug audit + fixes
Ran a full read-only audit of the whole codebase. No crashes or bad React hooks
found. Fixed the real wrong-behavior bugs it turned up:
- **Earnings were credited at a flat 85% instead of the driver's real tier rate**
  on auto-completed jobs. Now uses the tier (70–85%). *(This one actually mattered —
  it would have paid drivers the wrong amount.)*
- **The new "En route" status step never lit up** — jobs jumped straight from
  Accepted to Plowing. Added the missing transition so the stepper flows properly.
- **Two drive-simulation timers never stopped at arrival** (wasteful re-renders).
  Both now stop when the truck arrives.
- **A completion transition could double-fire** in React dev mode. Moved the side
  effect out of the state updater.

## 2. New feature — Notification Center
A DoorDash-style bell (top of the header) with an unread badge and a slide-up
activity feed. Notifications fire automatically on the real job events:
- Rider: request sent → driver on the way → plowed ✓ → charged $X.
- Driver: you earned $X → tip received.
Role-aware (riders and drivers each see their own), tap to mark read, mark-all-read,
and clear all. It's wired to a transport layer (below) so these can become real
push/SMS alerts later without touching any of this UI.

## 3. Future infrastructure (coded now, dormant until you flip it on)
- **`src/lib/weather.js`** — a swappable storm-conditions provider. The whole app
  (pricing, the storm surcharge, the emergency banner) now reads storm depth from
  here. Going live on a real feed (OpenWeather/NWS) is a one-function change +
  `VITE_WEATHER_API_KEY`. Demo storm stays at 7″ until then.
- **`src/lib/notify.js`** — the push/SMS transport. No-op today; documented hooks
  for web-push (VAPID) and Twilio SMS. The Notification Center already calls it.
- **Tips** — the receipt's tip buttons are now real: the tip routes to the driver's
  earnings + a notification, and when Stripe is on it charges the tip and sends
  100% to the driver (`api/tip.js`). Tap a tip chip again to remove it.

## New files in this build
- `src/lib/weather.js`, `src/lib/notify.js`, `api/tip.js`
- (edited) `src/App.jsx`, `src/lib/payments.js`

## Nothing new to configure
No new required env vars. The optional ones for later:
`VITE_WEATHER_API_KEY` (live weather) and `VITE_PUSH_PUBLIC_KEY` (web push).

## Known gaps I deliberately left (not bugs)
- Roadside/emergency jobs skip the card step (they're one-tap urgent) — they won't
  charge in real Stripe mode yet. Easy to add when you want it.
- Notifications live in-app only until push/SMS is wired (scaffold is ready).
