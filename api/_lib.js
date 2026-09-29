// Shared server helpers for DRIFT's /api functions. Files starting with "_" are
// not turned into endpoints by Vercel.
//
// Server-only environment variables (Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY          sk_test_... / sk_live_...   (never VITE_ prefixed)
//   STRIPE_WEBHOOK_SECRET      whsec_...                    (from the webhook endpoint)
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Settings → API    (never VITE_ prefixed)
//   CRON_SECRET                any long random string       (protects the nightly cleanup)
//   VITE_SUPABASE_URL          already set for sign-in
import Stripe from "stripe";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// STRIPE_API_BASE is only for local testing against a fake Stripe server.
const testBase = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      ...(testBase ? { host: testBase.hostname, port: testBase.port, protocol: testBase.protocol.replace(":", "") } : {}),
    })
  : null;

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const admin = SB_URL && SB_SERVICE
  ? createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const cents = (dollars) => Math.round(Number(dollars || 0) * 100);

// Who is calling? Verifies the Supabase session token the app sends.
export async function requireUser(req) {
  if (!admin) throw new HttpError(503, "Server isn't connected to the database yet");
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "Please sign in again");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Please sign in again");
  return data.user;
}

export async function getJob(jobId) {
  if (!jobId) throw new HttpError(400, "Missing job");
  const { data, error } = await admin.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Job not found");
  return data;
}

export async function updateJob(jobId, patch) {
  const { data, error } = await admin.from("jobs").update(patch).eq("id", jobId).select().single();
  if (error) throw new HttpError(500, error.message);
  return data;
}

export async function getProfile(userId) {
  const { data, error } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data;
}

export async function updateProfile(userId, patch) {
  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) throw new HttpError(500, error.message);
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Is this driver's Stripe account able to receive money yet? (Accounts v2)
export async function driverPayoutsReady(accountId) {
  if (!accountId) return { ready: false, due: [] };
  const acct = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient", "requirements"],
  });
  const status = acct?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  const due = (acct?.requirements?.entries || [])
    .filter((e) => e.minimum_deadline?.status === "currently_due" || e.minimum_deadline?.status === "past_due")
    .map((e) => e.description || e.awaiting_action_from || "info");
  return { ready: status === "active", due };
}

// Pay the driver their share of a captured job. Tied to the job's charge
// (source_transaction) so it never fails for "insufficient platform balance".
export async function payDriverForJob(job, accountId) {
  if (!job.charge_id) throw new HttpError(409, "Job has no captured charge yet");
  const transfer = await stripe.transfers.create({
    amount: cents(job.driver_pay),
    currency: "usd",
    destination: accountId,
    source_transaction: job.charge_id,
    transfer_group: `job_${job.id}`,
    description: `DRIFT job payout`,
    metadata: { job_id: job.id, kind: "job_payout" },
  }, { idempotencyKey: `payout-${job.id}` });
  return transfer;
}

export const OFFER_MINUTES = 20;      // how long an offer stays open for drivers
export const FIRST_DIBS_MINUTES = 2;  // favorite drivers see it alone for this long

// Card is held -> record it, give drivers a fresh 20 minutes to accept, and if
// the customer has favorite drivers online, give them first dibs.
export async function markAuthorized(job, pi) {
  if (job.payment_status === "authorized") return { alreadyAuthorized: true, job };
  const favs = await onlineFavorites(job.customer_id);
  const updated = await updateJob(job.id, {
    payment_status: "authorized",
    payment_method_id: typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id,
    expires_at: new Date(Date.now() + OFFER_MINUTES * 60 * 1000).toISOString(),
    ...(favs.length ? { preferred_driver_ids: favs,
      exclusive_until: new Date(Date.now() + FIRST_DIBS_MINUTES * 60 * 1000).toISOString() } : {}),
  });
  await announceJob(updated); // the offer is now visible — ring the drivers
  return { authorized: true, job: updated };
}

// The customer's favorite drivers who are online and allowed to drive right now.
export async function onlineFavorites(customerId) {
  try {
    if (!admin || !customerId) return [];
    const { data: favs } = await admin.from("favorite_drivers").select("driver_id").eq("customer_id", customerId);
    const ids = (favs || []).map((f) => f.driver_id);
    if (!ids.length) return [];
    const { data: ok } = await admin.from("profiles").select("id")
      .in("id", ids).eq("is_driver", true).eq("is_online", true).eq("suspended", false);
    return (ok || []).map((p) => p.id);
  } catch { return []; }
}

// ---------- job alerts (push notifications to online drivers) ----------
// VITE_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in Vercel (see DRIFT-ALERT-KEYS.txt).
const VAPID_PUBLIC = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = `mailto:${(process.env.OWNER_EMAILS || "support@driftplowing.com").split(",")[0].trim()}`;
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Send a push notification to a list of users' phones. Returns how many went out.
// Never throws. Phones that unsubscribed are cleaned up.
export async function pushTo(userIds, message, { ttl = 300, urgency = "high" } = {}) {
  try {
    if (!admin || !VAPID_PUBLIC || !VAPID_PRIVATE || !userIds?.length) return 0;
    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", userIds);
    const payload = JSON.stringify(message);
    let sent = 0;
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload, { TTL: ttl, urgency });
        sent += 1;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint); // phone unsubscribed
        } else console.error("[alerts] push failed", e.statusCode, e.body || e.message);
      }
    }));
    return sent;
  } catch (e) {
    console.error("[alerts]", e.message);
    return 0;
  }
}

// "New plow request" alerts. During the first-dibs window only the customer's
// favorite drivers are alerted; once it ends (or if there are no favorites),
// every other online driver is. Each group is alerted once. Never throws.
export async function announceJob(job) {
  try {
    if (!admin || !VAPID_PUBLIC || !VAPID_PRIVATE || !job || job.status !== "requested") return 0;
    const pay = Math.round(Number(job.driver_pay || 0));
    const kind = { driveway: "Driveway plow", sidewalk: "Sidewalk", digout: "Car dig-out", jumpstart: "Jump-start" }[job.job_type] || "Snow job";
    const where = job.address ? ` · ${job.address}` : "";
    const favs = job.preferred_driver_ids || [];
    const firstDibs = favs.length && job.exclusive_until && new Date(job.exclusive_until) > new Date();

    if (firstDibs) {
      if (job.announced_at) return 0;
      const { data: claimed } = await admin.from("jobs").update({ announced_at: new Date().toISOString() })
        .eq("id", job.id).is("announced_at", null).select("id");
      if (!claimed?.length) return 0;
      return await pushTo(favs, { title: `Your regular customer needs you · $${pay}`,
        body: `${kind}${where} — you get first dibs for ${FIRST_DIBS_MINUTES} minutes`, tag: `job-${job.id}`, url: "/" });
    }

    if (job.announced_all_at) return 0;
    const { data: claimed } = await admin.from("jobs").update({ announced_all_at: new Date().toISOString(),
      ...(job.announced_at ? {} : { announced_at: new Date().toISOString() }) })
      .eq("id", job.id).is("announced_all_at", null).select("id");
    if (!claimed?.length) return 0; // someone else already announced it
    const { data: drivers } = await admin.from("profiles").select("id")
      .eq("is_driver", true).eq("is_online", true).eq("suspended", false).neq("id", job.customer_id);
    const ids = (drivers || []).map((d) => d.id).filter((id) => !favs.includes(id)); // favorites already heard
    return await pushTo(ids, { title: `New plow request · $${pay}`,
      body: `${kind}${where} — open DRIFT to accept`, tag: `job-${job.id}`, url: "/" });
  } catch (e) {
    console.error("[alerts]", e.message);
    return 0;
  }
}

