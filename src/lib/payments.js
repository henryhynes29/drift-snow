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
export const cancelJobPaid = (jobId, reason = "cancelled", acceptCharge = false) => pay("cancel", { jobId, reason, acceptCharge });
// Driver: finish the job (at the property) -> customer is charged, driver is paid.
export const completeJobPaid = (jobId, photos, at) => pay("complete", { jobId, photos, lat: at?.lat, lng: at?.lng });
// Driver: checked in at the property (the server checks the location).
export const arriveAtJob = (jobId, at) => pay("arrive", { jobId, lat: at?.lat, lng: at?.lng });
// Customer: the driver forgot to finish — "yes, it's plowed" / "no, it wasn't done".
export const confirmJobDone = (jobId) => pay("confirm-done", { jobId });
export const disputeJob = (jobId, note) => pay("dispute", { jobId, note });
// Driver: "I'm still here" (resets the 60-minute idle timer).
export const stayOnline = () => pay("stay-online").catch(() => null);
// Owner: release a payout that was held for review.
export const releasePayout = (jobId) => pay("release-payout", { jobId });
// Owner: settle a disputed job — "charge" (it was done) or "release" (no charge).
export const resolveDispute = (jobId, outcome) => pay("resolve-dispute", { jobId, outcome });
// Customer: tip after the job. 100% goes to the driver.
export const tipJob = (jobId, amount) => pay("tip", { jobId, amount });
// Driver: payouts setup (embedded Stripe onboarding) + status + Stripe dashboard link.
export const connectSession = (opts) => pay("connect-session", opts || {}).then((r) => r.clientSecret);
export const connectStatus = () => pay("connect-status");
export const connectDashboard = () => pay("connect-dashboard");
// Customer: saved cards (Account → Payment methods)
export const listCards = () => pay("cards");
export const startCardSetup = () => pay("card-setup");
export const setDefaultCard = (pm) => pay("card-default", { pm });
export const removeCard = (pm) => pay("card-remove", { pm });
// Customer (payments off): tell online drivers about a new offer.
export const announceJob = (jobId) => pay("announce", { jobId }).catch(() => null);
// Driver routes (scheduled plows) — the server checks every rule (deadlines, limits).
export const schedClaim = (jobId) => pay("sched-claim", { jobId });
export const schedBackout = (jobId) => pay("sched-backout", { jobId });
export const schedCheckin = () => pay("sched-checkin");
export const schedStart = (jobId) => pay("sched-start", { jobId });
// Any open app nudges the scheduler (reminders / hand-offs) — throttled on the server.
export const schedTick = () => pay("tick").catch(() => null);
// Driver tools
export const previewJobs = () => pay("preview-jobs");
export const reportIssue = (jobId, kind, note, release = false) => pay("report-issue", { jobId, kind, note, release });
// Public counts (customers, drivers, open jobs) — no sign-in needed.
export async function marketStats() {
  try { const r = await fetch("/api/pay?action=market"); return r.ok ? await r.json() : null; } catch { return null; }
}

// Customer: raise the offer while waiting for a driver (+5 / +10 / +15 / +20).
export async function raiseOffer(jobId, add) {
  return pay("raise", { jobId, add });
}

// Owner: refund part or all of a charged job; optionally take it back from the driver.
export async function refundJob(jobId, amount, fromDriver, note) {
  return pay("refund", { jobId, amount, fromDriver: !!fromDriver, note });
}
