// /api/pay?action=...  — every money move in DRIFT goes through here.
//
// One function (instead of one per action) keeps us under Vercel's function
// limit. Every action checks WHO is calling (Supabase session) and reads
// amounts from the job row in the database — never from the phone.
//
// Money flow (Stripe Connect marketplace, "separate charges and transfers"):
//   1. hold      customer posts an offer -> card is AUTHORIZED (not charged) for
//                the job's total. Drivers only see the offer once this succeeds.
//   2. cancel    customer cancels / offer expires -> hold is released.
//   3. complete  driver finishes -> card is CAPTURED, then the driver's share is
//                transferred to their Stripe account (or marked owed until their
//                payout setup is finished). DRIFT keeps the difference.
//   4. tip       customer tips -> saved card is charged, 100% goes to the driver.
//   5. connect-* driver payout setup (embedded Stripe onboarding) and status.
//   6. sweep     nightly cleanup of abandoned holds (Vercel cron).
import {
  stripe, admin, HttpError, cents, requireUser, getJob, updateJob, getProfile,
  updateProfile, readJson, send, driverPayoutsReady, payDriverForJob, markAuthorized, announceJob,
  onlineFavorites, FIRST_DIBS_MINUTES,
} from "./_lib.js";
import { snowCheck } from "./_weather.js";

const OPEN = ["requested"];
const ACTIVE = ["accepted", "enroute", "plowing"];

export default async function handler(req, res) {
  const action = (req.query?.action || new URL(req.url, "http://x").searchParams.get("action") || "").toString();
  try {
    if (!stripe && action !== "announce") throw new HttpError(503, "Payments aren't set up on the server yet");
    if (!admin) throw new HttpError(503, "Server isn't connected to the database yet");
    // Vercel's nightly cron calls GET /api/pay (no action) with the CRON_SECRET.
    if (action === "sweep" || (req.method === "GET" && !action)) return send(res, 200, await sweep(req));
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const body = await readJson(req);
    const user = await requireUser(req);
    const fn = ACTIONS[action];
    if (!fn) throw new HttpError(404, "Unknown action");
    return send(res, 200, await fn(user, body, req));
  } catch (e) {
    const status = e.status || (e.type?.startsWith?.("Stripe") ? 402 : 500);
    if (status >= 500) console.error(`[pay:${action}]`, e);
    return send(res, status, { error: e.message || "Something went wrong" });
  }
}

const ACTIONS = {
  // ---------- 1. hold the customer's card for a new offer ----------
  async hold(user, { jobId }) {
    const job = await getJob(jobId);
    if (job.customer_id !== user.id) throw new HttpError(403, "Not your job");
    if (!OPEN.includes(job.status)) throw new HttpError(409, "This offer is no longer open");
    if (job.payment_status === "not_required") return { required: false };
    if (job.payment_status === "authorized") return { alreadyAuthorized: true };

    // Reuse the intent if we already made one for this job (e.g. the sheet was reopened).
    if (job.payment_intent_id) {
      const pi = await stripe.paymentIntents.retrieve(job.payment_intent_id);
      if (pi.status === "requires_capture") return await markAuthorized(job, pi);
      if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) {
        return { clientSecret: pi.client_secret, amount: Number(job.price),
          customerSessionClientSecret: await savedCardsSession(pi.customer) };
      }
    }

    const customerId = await ensureCustomer(user);
    const pi = await stripe.paymentIntents.create({
      amount: cents(job.price),
      currency: "usd",
      customer: customerId,
      capture_method: "manual",              // authorize now, charge when the job is done
      setup_future_usage: "off_session",     // saved for tips / re-charge if a hold lapses
      payment_method_types: ["card"],        // cards (incl. Apple Pay / Google Pay)
      description: `DRIFT snow removal — ${job.address || "job"}`,
      transfer_group: `job_${job.id}`,
      metadata: { job_id: job.id, customer_id: user.id, kind: "job" },
    }, { idempotencyKey: `hold-${job.id}` });
    await updateJob(job.id, { payment_intent_id: pi.id });
    return { clientSecret: pi.client_secret, amount: Number(job.price),
      customerSessionClientSecret: await savedCardsSession(customerId) };
  },

  // Called right after the card form succeeds (the webhook does the same thing,
  // this just makes it instant). Puts the offer in front of drivers.
  async "confirm-hold"(user, { jobId }) {
    const job = await getJob(jobId);
    if (job.customer_id !== user.id) throw new HttpError(403, "Not your job");
    if (!job.payment_intent_id) throw new HttpError(409, "No card on this offer yet");
    const pi = await stripe.paymentIntents.retrieve(job.payment_intent_id);
    if (pi.status !== "requires_capture") throw new HttpError(402, "Your card wasn't authorized. Try another card.");
    return await markAuthorized(job, pi);
  },

  // Payments off: the app calls this right after posting an offer so online
  // drivers get a "New plow request" alert. (With payments on, the card hold
  // triggers the alert instead.)
  // Also called by the customer's app when the favorite-driver first-dibs window
  // ends, so every other online driver gets alerted.
  async announce(user, { jobId }) {
    let job = await getJob(jobId);
    if (job.customer_id !== user.id) throw new HttpError(403, "Not your job");
    if (job.status !== "requested" || !["not_required", "authorized"].includes(job.payment_status)) return { sent: 0 };
    if (job.payment_status === "not_required" && !job.announced_at && !job.exclusive_until) {
      const favs = await onlineFavorites(job.customer_id);
      if (favs.length) job = await updateJob(job.id, { preferred_driver_ids: favs,
        exclusive_until: new Date(Date.now() + FIRST_DIBS_MINUTES * 60 * 1000).toISOString() });
    }
    return { sent: await announceJob(job), exclusiveUntil: job.exclusive_until || null };
  },

  // ---------- 2. cancel / expire: release the hold ----------
  async cancel(user, { jobId, reason }) {
    const job = await getJob(jobId);
    if (job.customer_id !== user.id) throw new HttpError(403, "Not your job");
    const expired = reason === "expired";
    if (expired && !(job.status === "requested" && new Date(job.expires_at) <= new Date())) {
      throw new HttpError(409, "This offer hasn't expired");
    }
    if (!(OPEN.includes(job.status) || (!expired && ["accepted", "enroute"].includes(job.status)))) {
      throw new HttpError(409, job.status === "plowing" ? "Your driver has already started" : "This job can't be cancelled");
    }
    await releaseHold(job);
    return { job: await updateJob(job.id, {
      status: expired ? "expired" : "cancelled",
      payment_status: job.payment_status === "not_required" ? "not_required" : "canceled",
    }) };
  },

  // ---------- 3. driver completes: charge the card, pay the driver ----------
  async complete(user, { jobId, photos }) {
    const job = await getJob(jobId);
    if (job.driver_id !== user.id) throw new HttpError(403, "Not your job");
    if (job.status === "completed") return { job, alreadyDone: true };
    if (!ACTIVE.includes(job.status)) throw new HttpError(409, "This job isn't active");

    let patch = { status: "completed", photos: photos || job.photos };
    if (job.payment_status !== "not_required") {
      const charged = await chargeForJob(job);
      patch = { ...patch, ...charged };
    }
    let done = await updateJob(job.id, patch);

    // Pay the driver (or mark it owed until their payout setup is finished).
    if (done.payment_status === "captured") {
      done = await settleDriver(done, user.id);
    }
    return { job: done };
  },

  // ---------- 4. tip: charge the saved card, 100% to the driver ----------
  async tip(user, { jobId, amount }) {
    const job = await getJob(jobId);
    if (job.customer_id !== user.id) throw new HttpError(403, "Not your job");
    if (job.status !== "completed") throw new HttpError(409, "You can tip once the job is done");
    if (job.tip_payment_intent_id) throw new HttpError(409, "You already tipped on this job");
    const dollars = Math.round(Number(amount));
    if (!(dollars >= 1 && dollars <= 200)) throw new HttpError(400, "Tips can be $1 to $200");
    if (!job.payment_method_id) throw new HttpError(409, "No saved card on this job");

    const profile = await getProfile(user.id);
    const pi = await stripe.paymentIntents.create({
      amount: dollars * 100,
      currency: "usd",
      customer: profile.stripe_customer_id,
      payment_method: job.payment_method_id,
      off_session: true,
      confirm: true,
      description: "DRIFT tip — 100% to your driver",
      transfer_group: `job_${job.id}`,
      metadata: { job_id: job.id, kind: "tip" },
    }, { idempotencyKey: `tip-${job.id}` });

    let patch = { tip: dollars, tip_payment_intent_id: pi.id };
    const driver = job.driver_id ? await getProfile(job.driver_id) : null;
    if (pi.status === "succeeded" && driver?.stripe_account_id && driver.payouts_ready) {
      const t = await stripe.transfers.create({
        amount: dollars * 100, currency: "usd", destination: driver.stripe_account_id,
        source_transaction: pi.latest_charge, transfer_group: `job_${job.id}`,
        metadata: { job_id: job.id, kind: "tip" },
      }, { idempotencyKey: `tip-transfer-${job.id}` });
      patch.tip_transfer_id = t.id;
    }
    return { job: await updateJob(job.id, patch), status: pi.status };
  },

  // ---------- 4b. customer's saved cards (Account → Payment methods) ----------
  async cards(user) {
    const profile = await getProfile(user.id);
    if (!profile?.stripe_customer_id) return { cards: [], defaultId: null };
    const [list, cust] = await Promise.all([
      stripe.customers.listPaymentMethods(profile.stripe_customer_id, { type: "card", limit: 20 }),
      stripe.customers.retrieve(profile.stripe_customer_id),
    ]);
    const defaultId = cust?.invoice_settings?.default_payment_method || null;
    return {
      defaultId,
      cards: list.data.map((pm) => ({ id: pm.id, brand: pm.card?.brand, last4: pm.card?.last4,
        expMonth: pm.card?.exp_month, expYear: pm.card?.exp_year, isDefault: pm.id === defaultId })),
    };
  },
  // Start adding a card (SetupIntent) — the card form saves it without charging.
  async "card-setup"(user) {
    const customerId = await ensureCustomer(user);
    const si = await stripe.setupIntents.create({
      customer: customerId, usage: "off_session", payment_method_types: ["card"],
      metadata: { user_id: user.id },
    });
    return { clientSecret: si.client_secret };
  },
  async "card-default"(user, { pm }) {
    const customerId = await ownCard(user, pm);
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
    return { ok: true };
  },
  async "card-remove"(user, { pm }) {
    await ownCard(user, pm);
    const { data: busy } = await admin.from("jobs").select("id")
      .eq("customer_id", user.id).eq("payment_method_id", pm)
      .in("status", ["requested", "accepted", "enroute", "plowing"]).limit(1);
    if (busy?.length) throw new HttpError(409, "This card is holding an active job. Remove it after the job is done.");
    await stripe.paymentMethods.detach(pm);
    return { ok: true };
  },

  // ---------- 5. driver payouts (Stripe Connect, Accounts v2) ----------
  // Creates the driver's Stripe account once, then returns a short-lived
  // session for the embedded onboarding form inside the app.
  async "connect-session"(user) {
    const profile = await getProfile(user.id);
    if (!profile?.is_driver) throw new HttpError(403, "Finish driver setup first");
    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const acct = await stripe.v2.core.accounts.create({
        contact_email: user.email,
        display_name: profile.name || user.email,
        dashboard: "express",
        identity: { country: "us", entity_type: "individual" },
        configuration: {
          recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
        },
        defaults: {
          currency: "usd",
          responsibilities: { fees_collector: "application", losses_collector: "application" },
        },
        metadata: { driver_id: user.id },
        include: ["configuration.recipient"],
      }, { idempotencyKey: `acct-${user.id}` });
      accountId = acct.id;
      await updateProfile(user.id, { stripe_account_id: accountId });
    }
    const session = await stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true, features: { external_account_collection: true } },
        notification_banner: { enabled: true, features: { external_account_collection: true } },
        payouts: { enabled: true, features: { instant_payouts: false, standard_payouts: true, edit_payout_schedule: false, external_account_collection: true } },
      },
    });
    return { clientSecret: session.client_secret };
  },

  // Is the driver ready to be paid? Also pays out anything owed once they are.
  async "connect-status"(user) {
    const profile = await getProfile(user.id);
    const owedTotal = async () => {
      const { data } = await admin.from("jobs").select("driver_pay")
        .eq("driver_id", user.id).eq("payout_status", "owed");
      const { data: tips } = await admin.from("jobs").select("tip")
        .eq("driver_id", user.id).not("tip_payment_intent_id", "is", null).is("tip_transfer_id", null);
      return (data || []).reduce((s, j) => s + Number(j.driver_pay || 0), 0)
        + (tips || []).reduce((s, j) => s + Number(j.tip || 0), 0);
    };
    if (!profile?.stripe_account_id) return { hasAccount: false, ready: false, due: [], owed: await owedTotal(), paidNow: 0 };
    const { ready, due } = await driverPayoutsReady(profile.stripe_account_id);
    if (ready !== profile.payouts_ready) await updateProfile(user.id, { payouts_ready: ready });
    let paidNow = 0;
    if (ready) paidNow = await payOwedJobs(user.id, profile.stripe_account_id);
    return { hasAccount: true, ready, due, owed: await owedTotal(), paidNow };
  },

  // Link into the driver's Stripe Express dashboard (payout history, tax forms).
  async "connect-dashboard"(user) {
    const profile = await getProfile(user.id);
    if (!profile?.stripe_account_id) throw new HttpError(409, "Set up payouts first");
    const link = await stripe.accounts.createLoginLink(profile.stripe_account_id);
    return { url: link.url };
  },
};

// ---------------- helpers ----------------
async function ensureCustomer(user) {
  const profile = await getProfile(user.id);
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;
  const c = await stripe.customers.create({
    email: user.email || undefined,
    name: profile?.name || undefined,
    metadata: { user_id: user.id },
  }, { idempotencyKey: `cust-${user.id}` });
  await updateProfile(user.id, { stripe_customer_id: c.id });
  return c.id;
}

// Lets the card form show (and remove) the customer's saved cards.
async function savedCardsSession(customerId) {
  if (!customerId) return null;
  try {
    const cs = await stripe.customerSessions.create({
      customer: customerId,
      components: { payment_element: { enabled: true, features: {
        payment_method_redisplay: "enabled",
        payment_method_remove: "enabled",
        payment_method_allow_redisplay_filters: ["always", "limited", "unspecified"],
      } } },
    });
    return cs.client_secret;
  } catch (e) {
    console.error("[pay:hold] customer session", e.message);
    return null; // the form still works, just without saved cards
  }
}

// The card must belong to the signed-in customer.
async function ownCard(user, pmId) {
  const profile = await getProfile(user.id);
  if (!pmId || !profile?.stripe_customer_id) throw new HttpError(404, "Card not found");
  const pm = await stripe.paymentMethods.retrieve(pmId);
  if (pm.customer !== profile.stripe_customer_id) throw new HttpError(403, "Not your card");
  return profile.stripe_customer_id;
}

async function releaseHold(job) {
  if (!job.payment_intent_id) return;
  const pi = await stripe.paymentIntents.retrieve(job.payment_intent_id);
  if (["requires_payment_method", "requires_capture", "requires_confirmation", "requires_action"].includes(pi.status)) {
    await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: "abandoned" },
      { idempotencyKey: `release-${job.id}` });
  }
}

// Capture the hold. If the hold lapsed (card holds last about 7 days), charge the
// saved card instead. Returns the payment fields to save on the job.
async function chargeForJob(job) {
  const amount = cents(job.price);
  try {
    let pi = await stripe.paymentIntents.retrieve(job.payment_intent_id);
    if (pi.status === "requires_capture") {
      pi = await stripe.paymentIntents.capture(pi.id, {}, { idempotencyKey: `capture-${job.id}` });
    }
    if (pi.status === "succeeded") return { payment_status: "captured", charge_id: pi.latest_charge };
    throw new Error(`Payment is ${pi.status}`);
  } catch (first) {
    if (!job.payment_method_id) return { payment_status: "failed" };
    try {
      const profile = await getProfile(job.customer_id);
      const pi = await stripe.paymentIntents.create({
        amount, currency: "usd", customer: profile.stripe_customer_id,
        payment_method: job.payment_method_id, off_session: true, confirm: true,
        description: `DRIFT snow removal — ${job.address || "job"}`,
        transfer_group: `job_${job.id}`,
        metadata: { job_id: job.id, kind: "job_recharge" },
      }, { idempotencyKey: `recharge-${job.id}` });
      if (pi.status === "succeeded") {
        return { payment_status: "captured", payment_intent_id: pi.id, charge_id: pi.latest_charge };
      }
    } catch (second) {
      console.error("[pay:complete] re-charge failed", second.message);
    }
    return { payment_status: "failed" };
  }
}

async function settleDriver(job, driverId) {
  const driver = await getProfile(driverId);
  if (!driver?.stripe_account_id) return await updateJob(job.id, { payout_status: "owed" });
  let ready = driver.payouts_ready;
  if (!ready) {
    ({ ready } = await driverPayoutsReady(driver.stripe_account_id));
    if (ready) await updateProfile(driverId, { payouts_ready: true });
  }
  if (!ready) return await updateJob(job.id, { payout_status: "owed" });
  try {
    const t = await payDriverForJob(job, driver.stripe_account_id);
    return await updateJob(job.id, { payout_status: "paid", transfer_id: t.id });
  } catch (e) {
    console.error("[pay:complete] transfer failed", e.message);
    return await updateJob(job.id, { payout_status: "owed" });
  }
}

async function payOwedJobs(driverId, accountId) {
  const { data: jobs } = await admin.from("jobs").select("*")
    .eq("driver_id", driverId).eq("payout_status", "owed").eq("payment_status", "captured");
  let total = 0;
  for (const job of jobs || []) {
    try {
      const t = await payDriverForJob(job, accountId);
      await updateJob(job.id, { payout_status: "paid", transfer_id: t.id });
      total += Number(job.driver_pay || 0);
    } catch (e) {
      console.error("[pay:connect-status] owed payout failed", job.id, e.message);
    }
  }
  // Tips left before the driver finished payout setup.
  const { data: tipJobs } = await admin.from("jobs").select("*")
    .eq("driver_id", driverId).not("tip_payment_intent_id", "is", null).is("tip_transfer_id", null);
  for (const job of tipJobs || []) {
    try {
      const pi = await stripe.paymentIntents.retrieve(job.tip_payment_intent_id);
      if (pi.status !== "succeeded") continue;
      const t = await stripe.transfers.create({
        amount: cents(job.tip), currency: "usd", destination: accountId,
        source_transaction: pi.latest_charge, transfer_group: `job_${job.id}`,
        metadata: { job_id: job.id, kind: "tip" },
      }, { idempotencyKey: `tip-transfer-${job.id}` });
      await updateJob(job.id, { tip_transfer_id: t.id });
      total += Number(job.tip || 0);
    } catch (e) {
      console.error("[pay:connect-status] owed tip failed", job.id, e.message);
    }
  }
  return total;
}

// ---------- 6. nightly cleanup (Vercel cron) ----------
// Releases card holds on offers that expired, were cancelled, or were abandoned
// on the card screen, in case the customer's phone never told us.
async function sweep(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized");
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: stale } = await admin.from("jobs").select("*")
    .in("payment_status", ["pending", "authorized"])
    .or(`status.in.(cancelled,expired),and(status.eq.requested,expires_at.lt.${new Date().toISOString()}),and(status.eq.requested,payment_status.eq.pending,created_at.lt.${cutoff})`);
  let released = 0;
  for (const job of stale || []) {
    try {
      await releaseHold(job);
      await updateJob(job.id, {
        status: job.status === "requested" ? "expired" : job.status,
        payment_status: "canceled",
      });
      released += 1;
    } catch (e) { console.error("[pay:sweep]", job.id, e.message); }
  }
  // Same daily run: check the forecast and send a snow alert if a storm is coming.
  let snow = null;
  try { snow = await snowCheck(); } catch (e) { console.error("[pay:snow]", e.message); }
  return { released, snow };
}
