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
  onlineFavorites, onlineElites, FIRST_DIBS_MINUTES, ELITE_DIBS_MINUTES, ownerIds, pushTo, announceScheduled, announceOpenScheduled, fmtWindow, fmtTime, JOB_KIND,
} from "./_lib.js";
import { snowCheck } from "./_weather.js";

const OPEN = ["requested", "scheduled"];
const NO_STRIPE_OK = ["announce", "tick", "sched-claim", "sched-backout", "sched-checkin", "sched-start", "market", "preview-jobs", "report-issue", "release-job"];
const H = 3600e3, MIN = 60e3;
const FREE_BACKOUT_HOURS = 3;     // drivers can drop a scheduled job for free until 3 hrs before
const CHECKIN_DEADLINE_MIN = 45;  // ...and must check in by 45 min before the window
const OPEN_TO_ALL_MIN = 30;       // unclaimed scheduled jobs go to everyone 30 min before
const MAX_ROUTE = 12;             // scheduled jobs one driver can hold
const ACTIVE = ["accepted", "enroute", "plowing"];

export default async function handler(req, res) {
  const action = (req.query?.action || new URL(req.url, "http://x").searchParams.get("action") || "").toString();
  try {
    if (!stripe && !NO_STRIPE_OK.includes(action)) throw new HttpError(503, "Payments aren't set up on the server yet");
    if (!admin) throw new HttpError(503, "Server isn't connected to the database yet");
    // Vercel's nightly cron calls GET /api/pay (no action) with the CRON_SECRET.
    if (action === "sweep" || (req.method === "GET" && !action)) return send(res, 200, await sweep(req));
    // Every few minutes (Supabase cron, or any signed-in app as a backup): scheduled-plow reminders & hand-offs.
    // No secret needed: it only does what's already due, and it's throttled to once per 90 seconds.
    if (action === "tick" && req.method === "GET") return send(res, 200, await throttledTick());
    // Public: how busy DRIFT is (the Drive page and the driver sign-up screen show this). Counts only.
    if (action === "market" && req.method === "GET") {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      return send(res, 200, await marketStats());
    }
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
    if (job.status === "scheduled") return { sent: job.payment_status === "not_required" ? await announceScheduled(job) : 0 };
    if (job.status !== "requested" || !["not_required", "authorized"].includes(job.payment_status)) return { sent: 0 };
    if (job.payment_status === "not_required" && !job.announced_at && !job.exclusive_until) {
      const favs = await onlineFavorites(job.customer_id);
      const dibs = favs.length ? favs : await onlineElites(job);
      if (dibs.length) job = await updateJob(job.id, { preferred_driver_ids: dibs,
        exclusive_until: new Date(Date.now() + (favs.length ? FIRST_DIBS_MINUTES : ELITE_DIBS_MINUTES) * 60 * 1000).toISOString() });
    }
    return { sent: await announceJob(job), exclusiveUntil: job.exclusive_until || null };
  },

  // ---------- 2. cancel / expire: release the hold ----------
  async cancel(user, { jobId, reason }) {
    const job = await getJob(jobId);
    if (job.customer_id !== user.id) throw new HttpError(403, "Not your job");
    const expired = reason === "expired";
    if (expired && !(OPEN.includes(job.status) && new Date(job.expires_at) <= new Date())) {
      throw new HttpError(409, "This offer hasn't expired");
    }
    if (!(OPEN.includes(job.status) || (!expired && ["accepted", "enroute"].includes(job.status)))) {
      throw new HttpError(409, job.status === "plowing" ? "Your driver has already started" : "This job can't be cancelled");
    }
    await releaseHold(job);
    if (job.status === "scheduled" && job.driver_id) {
      await pushTo([job.driver_id], { title: "A scheduled job was cancelled",
        body: `${job.address || "A customer"} cancelled their ${fmtWindow(job.scheduled_for, job.window_end)} plow. It's off your route.`,
        tag: `job-${job.id}`, url: "/?route=1" });
    }
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

  // ---------- scheduled plows: driver routes ----------
  // Put a scheduled job on your route. Also takes over a job whose driver missed check-in.
  async "sched-claim"(user, { jobId }) {
    const me = await getProfile(user.id);
    if (!me?.is_driver || me.suspended) throw new HttpError(403, "Only active drivers can take jobs");
    const job = await getJob(jobId);
    const now = Date.now(), start = new Date(job.scheduled_for).getTime();
    if (job.status !== "scheduled" || new Date(job.window_end).getTime() <= now) throw new HttpError(409, "This job isn't open anymore");
    if (!["authorized", "not_required"].includes(job.payment_status)) throw new HttpError(409, "This job isn't ready yet");
    if (job.customer_id === user.id) throw new HttpError(409, "That's your own job");
    if (job.driver_id === user.id) return { job, already: true };
    const noShow = job.driver_id && !job.checked_in_at && now >= start - CHECKIN_DEADLINE_MIN * MIN;
    if (job.driver_id && !noShow) throw new HttpError(409, "Another driver already has this one");
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true })
      .eq("driver_id", user.id).eq("status", "scheduled").gt("window_end", new Date().toISOString());
    if ((count || 0) >= MAX_ROUTE) throw new HttpError(409, `Your route is full (${MAX_ROUTE} jobs)`);
    // Claiming within 2 hours of the window counts as checking in.
    const patch = { driver_id: user.id, claimed_at: new Date().toISOString(), reminders_sent: 0,
      checked_in_at: now >= start - 2 * H ? new Date().toISOString() : null };
    let q = admin.from("jobs").update(patch).eq("id", job.id).eq("status", "scheduled");
    q = job.driver_id ? q.eq("driver_id", job.driver_id).is("checked_in_at", null) : q.is("driver_id", null);
    const { data: got } = await q.select().maybeSingle();
    if (!got) throw new HttpError(409, "Another driver just took this one");
    if (noShow) await recordBackout(job, job.driver_id, true, "no_checkin");
    const first = (me.name || "A driver").split(" ")[0];
    await pushTo([job.customer_id], { title: `${first} will plow ${fmtWindow(job.scheduled_for, job.window_end)}`,
      body: `Your scheduled plow has a driver. We'll let you know when they're on the way.`, tag: `job-${job.id}`, url: `/?job=${job.id}` });
    return { job: got };
  },

  // Drop a scheduled job. Free until 3 hours before the window; later counts as a late cancel.
  async "sched-backout"(user, { jobId }) {
    const job = await getJob(jobId);
    if (job.driver_id !== user.id || job.status !== "scheduled") throw new HttpError(409, "This job isn't on your route");
    const start = new Date(job.scheduled_for).getTime();
    const late = Date.now() > start - FREE_BACKOUT_HOURS * H;
    const { data: got } = await admin.from("jobs").update({ driver_id: null, claimed_at: null, checked_in_at: null,
      reminders_sent: 0, released_at: new Date().toISOString(), announced_all_at: null })
      .eq("id", job.id).eq("driver_id", user.id).eq("status", "scheduled").select().maybeSingle();
    if (!got) throw new HttpError(409, "This job isn't on your route");
    await recordBackout(job, user.id, late, "backed_out");
    await pushTo([job.customer_id], { title: "Finding you a new driver",
      body: `Your ${fmtWindow(job.scheduled_for, job.window_end)} driver had to cancel. Your plow is back open to every driver.`,
      tag: `job-${job.id}`, url: `/?job=${job.id}` });
    if (Date.now() >= start - 2 * H) await announceOpenScheduled(got, "the driver had to cancel");
    else await announceScheduled(got);
    return { job: got, late };
  },

  // "I'm on it" — confirms every scheduled job on today's route (within the next 12 hours).
  async "sched-checkin"(user) {
    const until = new Date(Date.now() + 12 * H).toISOString();
    const { data: rows } = await admin.from("jobs").update({ checked_in_at: new Date().toISOString() })
      .eq("driver_id", user.id).eq("status", "scheduled").is("checked_in_at", null)
      .lte("scheduled_for", until).gt("window_end", new Date().toISOString()).select();
    const me = await getProfile(user.id);
    const first = (me?.name || "Your driver").split(" ")[0];
    for (const j of rows || []) {
      await pushTo([j.customer_id], { title: `${first} is confirmed for ${fmtWindow(j.scheduled_for, j.window_end)}`,
        body: "Your driver checked in for today's route.", tag: `job-${j.id}`, url: `/?job=${j.id}` });
    }
    return { checkedIn: (rows || []).length };
  },

  // Start a scheduled job (up to 90 min before its window) — it becomes a normal live job.
  async "sched-start"(user, { jobId }) {
    const job = await getJob(jobId);
    if (job.driver_id !== user.id || job.status !== "scheduled") throw new HttpError(409, "This job isn't on your route");
    if (Date.now() < new Date(job.scheduled_for).getTime() - 90 * MIN) throw new HttpError(409, `You can start this one after ${fmtTime(new Date(new Date(job.scheduled_for).getTime() - 90 * MIN).toISOString())}`);
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true })
      .eq("driver_id", user.id).in("status", ["accepted", "enroute", "plowing"]);
    if ((count || 0) >= 3) throw new HttpError(409, "Finish a job first — you have 3 going");
    const got = await updateJob(job.id, { status: "accepted", accepted_at: new Date().toISOString(),
      checked_in_at: job.checked_in_at || new Date().toISOString() });
    return { job: got };
  },

  // Backup for the cron: any signed-in app can nudge the scheduler (at most every 90 seconds).
  async tick() { return await throttledTick(); },

  // ---------- drivers: look at open jobs before finishing setup ----------
  // Any signed-in user. Approximate spots only (rounded ~half a mile), no address
  // or customer — enough to see what the work pays, not who it's for.
  async "preview-jobs"() {
    const now = new Date().toISOString();
    const { data } = await admin.from("jobs")
      .select("id, status, job_type, lat, lng, driver_pay, quote, scheduled_for, window_end, expires_at, payment_status, driver_id")
      .in("status", ["requested", "scheduled"]).in("payment_status", ["authorized", "not_required"])
      .order("created_at", { ascending: false }).limit(60);
    const rows = (data || []).filter((j) => j.status === "requested" ? !j.driver_id && j.expires_at > now : !j.driver_id && j.window_end > now);
    const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
    return {
      jobs: rows.map((j) => ({ id: j.id, kind: j.job_type || "driveway", lat: r2(j.lat), lng: r2(j.lng),
        pay: Math.round(Number(j.driver_pay || 0)), sqft: j.quote?.sqft || null, depth: j.quote?.depthLabel || null,
        scheduledFor: j.status === "scheduled" ? j.scheduled_for : null })),
      market: await marketStats(),
    };
  },

  // ---------- a problem on a job (driver or customer) ----------
  // kinds: blocked (car/object in the way), no_access (can't reach it), damage, unsafe, other
  // release: the driver gives the job back so another driver can take it (only before plowing starts).
  async "report-issue"(user, { jobId, kind, note, release }) {
    const KINDS = { blocked: "Something's in the way", no_access: "Can't get to the property", damage: "Damage happened", unsafe: "Unsafe conditions", other: "A problem" };
    if (!KINDS[kind]) throw new HttpError(400, "Pick what's wrong");
    const job = await getJob(jobId);
    const isDriver = job.driver_id === user.id, isCustomer = job.customer_id === user.id;
    if (!isDriver && !isCustomer) throw new HttpError(403, "Not your job");
    const text = String(note || "").trim().slice(0, 500);
    let released = false;
    if (release) {
      if (!isDriver) throw new HttpError(403, "Only the driver can give a job back");
      await releaseLiveJob(job, user.id);
      released = true;
    }
    const { data: issue, error } = await admin.from("job_issues")
      .insert({ job_id: job.id, reporter_id: user.id, kind, note: text || null, released }).select().single();
    if (error) throw new HttpError(500, error.message);
    // Put it in the job's chat so the other person sees it right away.
    const who = isDriver ? "Driver" : "Customer";
    await admin.from("messages").insert({ job_id: job.id, sender_id: user.id,
      body: `⚠ ${KINDS[kind]}${text ? ` — ${text}` : ""}${released ? " (I can't finish this one — DRIFT is finding you another driver.)" : ""}` });
    const other = isDriver ? job.customer_id : job.driver_id;
    if (other && !released) await pushTo([other], { title: `${who} reported: ${KINDS[kind]}`, body: text || "Open DRIFT to see the message.",
      tag: `job-${job.id}`, url: `/?job=${job.id}` });
    await pushTo(await ownerIds(), { title: `Problem on a job · ${KINDS[kind]}`, body: `${who}${job.address ? " at " + job.address : ""}${text ? ": " + text : ""}${released ? " · job given back" : ""}`,
      tag: `issue-${issue.id}`, url: "/?admin=1" }, { urgency: "normal" });
    return { issue, released };
  },


  // ---------- 5. driver payouts (Stripe Connect, Accounts v2) ----------
  // Creates the driver's Stripe account once, then returns a short-lived
  // session for the embedded onboarding form inside the app.
  // entityType: "individual" (paid as yourself, SSN) or "company" (a business —
  // paid to the business bank account under its EIN; Stripe sends the 1099 to
  // the business). Only used the first time, when the Stripe account is created.
  async "connect-session"(user, body = {}) {
    const profile = await getProfile(user.id);
    if (!profile?.is_driver) throw new HttpError(403, "Finish driver setup first");
    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const entity = body.entityType === "company" ? "company" : "individual";
      const businessName = entity === "company" ? String(body.businessName || "").trim().slice(0, 80) : "";
      const acct = await stripe.v2.core.accounts.create({
        contact_email: user.email,
        display_name: businessName || profile.name || user.email,
        dashboard: "express",
        identity: { country: "us", entity_type: entity }, // Stripe's form collects the legal name + EIN for businesses
        configuration: {
          recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
        },
        defaults: {
          currency: "usd",
          responsibilities: { fees_collector: "application", losses_collector: "application" },
        },
        metadata: { driver_id: user.id, paid_as: entity },
        include: ["configuration.recipient"],
      }, { idempotencyKey: `acct-${user.id}-${entity}` });
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

// Runs the scheduler at most once every 90 seconds, no matter who asks.
// A driver gives back a live job (before plowing starts): it goes back to every
// driver with a fresh 20 minutes and the customer's card hold stays in place.
async function releaseLiveJob(job, driverId) {
  if (!["accepted", "enroute"].includes(job.status)) throw new HttpError(409, job.status === "plowing" ? "You've already started — finish it or report the problem without giving it back" : "This job can't be given back");
  const { data: got } = await admin.from("jobs").update({ driver_id: null, status: "requested", accepted_at: null,
    expires_at: new Date(Date.now() + 20 * MIN).toISOString(), announced_at: null, announced_all_at: null,
    preferred_driver_ids: null, exclusive_until: null })
    .eq("id", job.id).eq("driver_id", driverId).in("status", ["accepted", "enroute"]).select().maybeSingle();
  if (!got) throw new HttpError(409, "This job isn't yours anymore");
  await admin.from("driver_backouts").insert({ job_id: job.id, driver_id: driverId, late: false, reason: "released" });
  await pushTo([job.customer_id], { title: "Finding you a new driver",
    body: "Your driver couldn't finish this one. Your request is back open to every driver nearby.", tag: `job-${job.id}`, url: `/?job=${job.id}` });
  await announceJob(got);
  return got;
}

// How much work is open right now — safe to show publicly (no customer/driver counts).
let marketCache = null;
async function marketStats() {
  if (marketCache && Date.now() - marketCache.at < 60e3) return marketCache.data;
  const now = new Date().toISOString();
  // Open work only. Customer and driver counts are never public (owner dashboard only).
  const [{ data: open }] = await Promise.all([
    admin.from("jobs").select("status, driver_pay, driver_id, expires_at, window_end")
      .in("status", ["requested", "scheduled"]).in("payment_status", ["authorized", "not_required"]).limit(500),
  ]);
  const live = (open || []).filter((j) => j.status === "requested" && !j.driver_id && j.expires_at > now);
  const sched = (open || []).filter((j) => j.status === "scheduled" && !j.driver_id && j.window_end > now);
  const data = { openNow: live.length, openScheduled: sched.length,
    openPay: Math.round([...live, ...sched].reduce((t, j) => t + Number(j.driver_pay || 0), 0)), at: now };
  marketCache = { at: Date.now(), data };
  return data;
}

async function throttledTick() {
  const { data: row } = await admin.from("app_settings").select("last_tick").eq("id", 1).maybeSingle();
  const prev = row?.last_tick || null;
  if (prev && Date.now() - new Date(prev).getTime() < 90e3) return { skipped: true };
  let q = admin.from("app_settings").update({ last_tick: new Date().toISOString() }).eq("id", 1);
  q = prev ? q.eq("last_tick", prev) : q.is("last_tick", null);   // only one caller wins
  const { data: claimed } = await q.select("id");
  if (!claimed?.length) return { skipped: true };
  return await tick();
}

function cronAuth(req) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.authorization || "";
  const key = new URL(req.url, "http://x").searchParams.get("key");
  if (!secret || (got !== `Bearer ${secret}` && key !== secret)) throw new HttpError(401, "Unauthorized");
}

async function recordBackout(job, driverId, late, reason) {
  try {
    await admin.from("driver_backouts").insert({ job_id: job.id, driver_id: driverId, late, reason });
    if (late) {
      const p = await getProfile(driverId);
      await updateProfile(driverId, { late_cancels: (p?.late_cancels || 0) + 1 });
    }
  } catch (e) { console.error("[sched] backout record", e.message); }
}

// ---------- scheduled plows: reminders, no-shows, hand-offs (every few minutes) ----------
async function tick() {
  const now = Date.now(), iso = (t) => new Date(t).toISOString();
  const out = { reminded: 0, released: 0, opened: 0, expired: 0 };
  const { data: sched } = await admin.from("jobs").select("*").eq("status", "scheduled")
    .in("payment_status", ["authorized", "not_required"]).lte("scheduled_for", iso(now + 3 * H));

  // 1. Check-in reminders: 2 hrs, 75 min and 50 min before each driver's first job.
  const byDriver = {};
  for (const j of sched || []) if (j.driver_id && !j.checked_in_at) (byDriver[j.driver_id] ||= []).push(j);
  for (const [driverId, jobs] of Object.entries(byDriver)) {
    jobs.sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
    const first = jobs[0], start = new Date(first.scheduled_for).getTime();
    const deadline = start - CHECKIN_DEADLINE_MIN * MIN;
    if (now >= deadline) continue; // handled below
    const due = now >= start - 50 * MIN ? 3 : now >= start - 75 * MIN ? 2 : now >= start - 2 * H ? 1 : 0;
    const sent = Math.min(...jobs.map((j) => j.reminders_sent || 0));
    if (due <= sent) continue;
    const by = fmtTime(iso(deadline));
    await pushTo([driverId], due === 3
      ? { title: `CHECK IN NOW — jobs drop at ${by}`, body: `You haven't checked in. At ${by} your ${jobs.length} scheduled job${jobs.length > 1 ? "s go" : " goes"} to other drivers and it counts as a late cancel.`, tag: "checkin", url: "/?route=1", sticky: true }
      : { title: `Check in for your route by ${by}`, body: `${jobs.length} scheduled job${jobs.length > 1 ? "s" : ""} starting ${fmtWindow(first.scheduled_for, first.window_end)}. Open DRIFT and tap "I'm on it" — if you don't, they go to other drivers.`, tag: "checkin", url: "/?route=1", sticky: true },
      { ttl: 3600, urgency: "high" });
    await admin.from("jobs").update({ reminders_sent: due }).in("id", jobs.map((j) => j.id));
    out.reminded += 1;
  }

  // 2. Missed check-in: 45 min before the window, the job goes back to everyone.
  for (const j of sched || []) {
    if (!j.driver_id || j.checked_in_at || now < new Date(j.scheduled_for).getTime() - CHECKIN_DEADLINE_MIN * MIN) continue;
    const { data: got } = await admin.from("jobs").update({ driver_id: null, claimed_at: null, released_at: iso(now), announced_all_at: iso(now) })
      .eq("id", j.id).eq("driver_id", j.driver_id).is("checked_in_at", null).select().maybeSingle();
    if (!got) continue;
    await recordBackout(j, j.driver_id, true, "no_checkin");
    await pushTo([j.driver_id], { title: "You missed check-in", body: `Your ${fmtWindow(j.scheduled_for, j.window_end)} job at ${j.address || "a customer's"} went to other drivers. This counts as a late cancel.`, tag: "checkin", url: "/?route=1" });
    await pushTo([j.customer_id], { title: "Finding you a new driver", body: `Your driver didn't confirm, so your ${fmtWindow(j.scheduled_for, j.window_end)} plow is open to every driver nearby.`, tag: `job-${j.id}`, url: `/?job=${j.id}` });
    await announceOpenScheduled(got, "the scheduled driver didn't check in");
    out.released += 1;
  }

  // 3. Nobody claimed it: 30 min before the window, alert every online driver.
  for (const j of sched || []) {
    if (j.driver_id || j.announced_all_at || now < new Date(j.scheduled_for).getTime() - OPEN_TO_ALL_MIN * MIN) continue;
    const { data: got } = await admin.from("jobs").update({ announced_all_at: iso(now) })
      .eq("id", j.id).is("announced_all_at", null).is("driver_id", null).select().maybeSingle();
    if (got) { await announceOpenScheduled(got); out.opened += 1; }
  }

  // 4. Window over and nobody started it: release the hold, tell the customer.
  const { data: late } = await admin.from("jobs").select("*").eq("status", "scheduled").lt("window_end", iso(now));
  for (const j of late || []) {
    try {
      if (stripe && j.payment_status === "authorized") await releaseHold(j);
      await updateJob(j.id, { status: "expired", payment_status: j.payment_status === "not_required" ? "not_required" : "canceled" });
      await pushTo([j.customer_id], { title: "Sorry — no driver made it", body: `Your ${fmtWindow(j.scheduled_for, j.window_end)} plow wasn't done, so you weren't charged. Book again anytime.`, tag: `job-${j.id}`, url: "/" });
      out.expired += 1;
    } catch (e) { console.error("[tick] expire", j.id, e.message); }
  }
  return out;
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
    .or(`status.in.(cancelled,expired),and(status.in.(requested,scheduled),expires_at.lt.${new Date().toISOString()}),and(status.in.(requested,scheduled),payment_status.eq.pending,created_at.lt.${cutoff})`);
  let released = 0;
  for (const job of stale || []) {
    try {
      await releaseHold(job);
      await updateJob(job.id, {
        status: ["requested", "scheduled"].includes(job.status) ? "expired" : job.status,
        payment_status: "canceled",
      });
      released += 1;
    } catch (e) { console.error("[pay:sweep]", job.id, e.message); }
  }
  // Same daily run: check the forecast and send a snow alert if a storm is coming.
  let snow = null;
  try { snow = await snowCheck(); } catch (e) { console.error("[pay:snow]", e.message); }
  let sched = null;
  try { sched = await tick(); } catch (e) { console.error("[pay:tick]", e.message); }
  return { released, snow, sched };
}
