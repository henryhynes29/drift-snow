# DRIFT — backend setup (Phase 0 + 1)

This adds the real backend. **Your app keeps working as-is until you add the keys below** — nothing here breaks the current deploy. Do the steps in order; each is small.

---

## 1. Supabase (database + sign-in + realtime + storage)

1. Go to **supabase.com** → sign up (free, no card) → **New project**. Pick a name and a strong database password. Wait ~2 min for it to provision.
2. In the project, open **SQL Editor** → **New query**.
3. Open the file **`supabase/schema.sql`** from this repo, copy the whole thing, paste it in, and click **Run**. You should see "Success."
4. Turn on realtime: **Database → Replication** → enable it for **`jobs`**, **`messages`**, and **`driver_locations`**.
5. Get your keys: **Project Settings → API**. Copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
   - **service_role** key (keep secret) → `SUPABASE_SERVICE_ROLE_KEY`
6. Enable the sign-in methods you want: **Authentication → Providers** — Email is on by default; toggle on **Google** (and **Phone** later, which uses Twilio).

## 2. Stripe (payments + driver payouts)

1. Go to **stripe.com** → create an account (test mode is fine to start).
2. **Developers → API keys**: copy the **Publishable key** → `VITE_STRIPE_PUBLISHABLE_KEY`, and **Secret key** → `STRIPE_SECRET_KEY`.
3. Turn on **Connect**: in the dashboard search "Connect" → **Get started** → choose **Express**. Copy the **Connect client ID** (`ca_...`) → `STRIPE_CONNECT_CLIENT_ID`.
4. Webhook (do this after your first deploy with the keys): **Developers → Webhooks → Add endpoint**, URL = `https://YOUR-APP.vercel.app/api/stripe-webhook`, select events `payment_intent.succeeded` and `account.updated`. Copy the **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.

## 3. Put the keys in Vercel

For **each** variable in `.env.example`:
- Vercel → your project → **Settings → Environment Variables** → add the name + value → apply to all environments → Save.
- The `VITE_` ones are browser-safe. The rest are server-only (used by the `/api` functions) — do **not** rename them with a `VITE_` prefix.

Then **redeploy** (Deployments → ⋯ → Redeploy) so the keys take effect.

## 3b. Turn on real payments + test them

Once the four `STRIPE_*` / `VITE_STRIPE_*` vars are in Vercel and you've redeployed, the app automatically switches from the mock card to **real Stripe** (it keys off `VITE_STRIPE_PUBLISHABLE_KEY` — no keys = demo mode, so nothing breaks before you're ready).

**Customer flow:** tapping **Clear now** opens a card sheet. The card is *authorized, not charged* — the money is only captured when the job is marked complete. That's the "no storm, no charge" promise, enforced by Stripe (`capture_method: manual`).

**Test cards (test mode — no real money):**
- Success: `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
- Requires-auth: `4000 0025 0000 3155`.
- Declined: `4000 0000 0000 9995`.

**Driver payouts:** on the driver **Earnings** tab, a "Set up your payouts" card sends the driver through Stripe Connect's hosted onboarding (bank + tax info). After a job completes, the driver's share is transferred to their connected account automatically; your platform cut stays behind.

**What each new file does:**
- `api/create-payment-intent.js` — authorizes the card when a job is requested.
- `api/capture-payment.js` — captures the hold + transfers the driver's share when the job completes.
- `api/connect-create-account.js` — starts a driver's payout onboarding.
- `api/stripe-webhook.js` — where Stripe confirms events (add the endpoint per step 2.4).

> Heads-up: I couldn't test the live Stripe round-trip from here (it needs your keys). Run one test booking end-to-end in **test mode** first; if anything in the card sheet misbehaves, tell me exactly what happens and I'll tune it.

## 4. Local development (optional)

```
Copy-Item .env.example .env
```
Open `.env`, paste your keys, then `npm install` and `npm run dev`.

---

## What's already wired vs. what's next

**Built and in the repo now (this phase):**
- `supabase/schema.sql` — the full database (tables, security rules, signup trigger).
- `src/lib/supabase.js` — the client (auto-off until keys exist).
- `src/lib/auth.jsx` — sign up / sign in / sign out / phone OTP, safe when unconfigured.
- `src/lib/db.js` — helpers to read/write properties, jobs, messages, live driver location, ratings.
- `api/create-payment-intent.js`, `api/connect-create-account.js`, `api/stripe-webhook.js` — the Stripe backend.

**Next (needs the keys above in place first):**
- Wrap the app in `AuthProvider` and add real login screens.
- Swap the in-memory demo state for the `db.js` helpers so data persists.
- Point the driver tracking + chat at Supabase Realtime.
- Connect the payment step to `create-payment-intent` and the driver payout step to `connect-create-account`.

That wiring is the next work session — it's deliberately not done yet so your working demo stays intact until the backend is live.
