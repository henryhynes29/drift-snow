// Frontend payment helpers for DRIFT — thin wrappers over the /api Stripe functions.
// Everything here is a safe no-op until you set VITE_STRIPE_PUBLISHABLE_KEY, so the
// demo keeps working with the mock card flow until the real keys are in Vercel.
import { loadStripe } from "@stripe/stripe-js";

const PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
export const STRIPE_ENABLED = !!PK;

// Lazily create ONE Stripe instance (loadStripe caches internally too).
let _stripe = null;
export function getStripe() {
  if (!STRIPE_ENABLED) return null;
  if (!_stripe) _stripe = loadStripe(PK);
  return _stripe;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Authorize a card for a job now; we capture it only when the job is completed
// ("no storm, no charge"). Returns { clientSecret, paymentIntentId }.
export async function createPaymentIntent({ amount, jobId, customerId }) {
  if (!STRIPE_ENABLED) return { error: "Stripe not configured" };
  return postJSON("/api/create-payment-intent", { amount, jobId, customerId });
}

// Capture the held authorization when the job is done, and (if the driver has
// finished payout onboarding) transfer their share to their Connect account.
export async function capturePayment({ paymentIntentId, driverAmount, driverStripeAccountId }) {
  if (!STRIPE_ENABLED || !paymentIntentId) return { error: "Nothing to capture" };
  return postJSON("/api/capture-payment", { paymentIntentId, driverAmount, driverStripeAccountId });
}

// Start (or resume) a driver's Stripe Connect payout onboarding. Returns a hosted
// onboardingUrl to redirect the driver to.
export async function createConnectAccount({ driverId, email, returnUrl }) {
  if (!STRIPE_ENABLED) return { error: "Stripe not configured" };
  return postJSON("/api/connect-create-account", { driverId, email, returnUrl });
}

// Charge a post-job tip and route it to the driver. Best-effort — a failed tip
// should never block the receipt flow.
export async function sendTip({ amount, jobId, driverStripeAccountId, paymentMethodId, customerId }) {
  if (!STRIPE_ENABLED || !amount) return { error: "Nothing to tip" };
  return postJSON("/api/tip", { amount, jobId, driverStripeAccountId, paymentMethodId, customerId });
}
