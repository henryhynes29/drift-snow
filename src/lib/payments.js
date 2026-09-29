// Frontend payment helpers for DRIFT — thin wrappers over /api/pay.
// The server reads every amount from the job in the database; the app only says
// WHICH job. Everything here is a safe no-op until VITE_STRIPE_PUBLISHABLE_KEY is
// set in Vercel, so the demo keeps working without Stripe.
import { loadStripe } from "@stripe/stripe-js/pure"; // /pure: Stripe's script loads only when a card form opens
import { supabase, supabaseEnabled } from "./supabase.js";

export const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
export const STRIPE_ENABLED = !!STRIPE_PK;

let _stripe = null;
export function getStripe() {
  if (!STRIPE_ENABLED) return null;
  if (!_stripe) _stripe = loadStripe(STRIPE_PK);
  return _stripe;
}

async function authHeader() {
  if (!supabaseEnabled) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// fetch with the signed-in user's session attached
export async function authedFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(await authHeader()) } });
}

async function pay(action, body) {
  const res = await authedFetch(`/api/pay?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Customer: hold the card for a posted offer. -> { clientSecret, amount } | { required:false } | { alreadyAuthorized }
export const startHold = (jobId) => pay("hold", { jobId });
// Customer: after the card form succeeds, put the offer in front of drivers.
export const confirmHold = (jobId) => pay("confirm-hold", { jobId });
// Customer: cancel (or expire) an offer and release the card hold.
export const cancelJobPaid = (jobId, reason = "cancelled") => pay("cancel", { jobId, reason });
// Driver: finish the job -> customer is charged, driver is paid.
export const completeJobPaid = (jobId, photos) => pay("complete", { jobId, photos });
// Customer: tip after the job. 100% goes to the driver.
export const tipJob = (jobId, amount) => pay("tip", { jobId, amount });
// Driver: payouts setup (embedded Stripe onboarding) + status + Stripe dashboard link.
export const connectSession = () => pay("connect-session").then((r) => r.clientSecret);
export const connectStatus = () => pay("connect-status");
export const connectDashboard = () => pay("connect-dashboard");
// Customer: saved cards (Account → Payment methods)
export const listCards = () => pay("cards");
export const startCardSetup = () => pay("card-setup");
export const setDefaultCard = (pm) => pay("card-default", { pm });
export const removeCard = (pm) => pay("card-remove", { pm });
// Customer (payments off): tell online drivers about a new offer.
export const announceJob = (jobId) => pay("announce", { jobId }).catch(() => null);
