// /api/admin?action=...  — the owner dashboard's data. Owners only.
//
// Who counts as an owner: the emails in the OWNER_EMAILS Vercel variable
// (comma-separated). Everyone else gets 403, even if signed in.
// Uses the service-role key, so it can read across all accounts — which is
// exactly why every action checks the owner list first.
import { admin, stripe, HttpError, requireUser, readJson, send, driverPayoutsReady, getProfile } from "./_lib.js";

const OWNERS = (process.env.OWNER_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const num = (v) => Number(v || 0);
const round2 = (v) => Math.round(v * 100) / 100;
// Stripe's standard US card pricing, used to ESTIMATE fees (exact numbers are in Stripe).
const stripeFee = (dollars) => (dollars > 0 ? dollars * 0.029 + 0.3 : 0);

export default async function handler(req, res) {
  const action = (req.query?.action || new URL(req.url, "http://x").searchParams.get("action") || "").toString();
  try {
    if (!admin) throw new HttpError(503, "Server isn't connected to the database yet");
    const user = await requireUser(req);
    if (!OWNERS.includes((user.email || "").toLowerCase())) throw new HttpError(403, "Owners only");
    const body = req.method === "POST" ? await readJson(req) : {};
    const fn = ACTIONS[action];
    if (!fn) throw new HttpError(404, "Unknown action");
    return send(res, 200, await fn(body, user));
  } catch (e) {
    if ((e.status || 500) >= 500) console.error(`[admin:${action}]`, e);
    return send(res, e.status || 500, { error: e.message || "Something went wrong" });
  }
}

async function all(table, select, build) {
  let q = admin.from(table).select(select);
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  return data || [];
}

async function signed(bucket, path) {
  if (!path) return null;
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10);
  return data?.signedUrl || null;
}

const ACTIONS = {
  // ---------- headline numbers ----------
  async summary() {
    const [profiles, jobs] = await Promise.all([
      all("profiles", "id, role, is_driver, is_online, suspended, payouts_ready, created_at"),
      all("jobs", "id, status, payment_status, payout_status, price, driver_pay, platform_fee, tip, created_at, completed_at"),
    ]);
    const now = Date.now(), day = 864e5;
    const since = (j, days) => new Date(j.created_at).getTime() > now - days * day;
    const drivers = profiles.filter((p) => p.is_driver);
    const customers = profiles.filter((p) => !p.is_driver);
    const paid = jobs.filter((j) => j.payment_status === "captured");
    const done = jobs.filter((j) => j.status === "completed");

    const money = (list) => {
      const gross = list.reduce((s, j) => s + num(j.price), 0);
      const tips = list.reduce((s, j) => s + num(j.tip), 0);
      const driverPay = list.reduce((s, j) => s + num(j.driver_pay), 0);
      const drift = list.reduce((s, j) => s + num(j.platform_fee), 0);
      const fees = list.reduce((s, j) => s + stripeFee(num(j.price)) + stripeFee(num(j.tip)), 0);
      return { gross: round2(gross), tips: round2(tips), driverPay: round2(driverPay), driftRevenue: round2(drift),
        stripeFeesEst: round2(fees), profitEst: round2(drift - fees), jobs: list.length };
    };

    let stripeBalance = null;
    if (stripe) {
      try {
        const b = await stripe.balance.retrieve();
        const usd = (arr) => round2((arr || []).filter((x) => x.currency === "usd").reduce((s, x) => s + x.amount, 0) / 100);
        stripeBalance = { available: usd(b.available), pending: usd(b.pending), livemode: b.livemode };
      } catch { /* stripe not reachable — skip */ }
    }

    return {
      people: {
        drivers: drivers.length,
        driversOnline: drivers.filter((d) => d.is_online).length,
        driversPayoutsReady: drivers.filter((d) => d.payouts_ready).length,
        driversSuspended: drivers.filter((d) => d.suspended).length,
        customers: customers.length,
        newLast7: profiles.filter((p) => since(p, 7)).length,
      },
      jobs: {
        total: jobs.length,
        last7: jobs.filter((j) => since(j, 7)).length,
        open: jobs.filter((j) => ["requested", "accepted", "enroute", "plowing"].includes(j.status)).length,
        completed: done.length,
        cancelled: jobs.filter((j) => ["cancelled", "expired"].includes(j.status)).length,
        failedPayments: jobs.filter((j) => j.payment_status === "failed").length,
        disputes: jobs.filter((j) => j.payment_status === "disputed").length,
        owedToDrivers: round2(jobs.filter((j) => j.payout_status === "owed").reduce((s, j) => s + num(j.driver_pay), 0)),
      },
      money: {
        allTime: money(paid),
        last30: money(paid.filter((j) => since(j, 30))),
        last7: money(paid.filter((j) => since(j, 7))),
      },
      stripeBalance,
    };
  },

  // ---------- drivers ----------
  async drivers() {
    const [drivers, jobs, docs] = await Promise.all([
      all("profiles", "id, name, email, phone, truck, tools, rating, ratings_count, jobs_count, is_online, suspended, payouts_ready, stripe_account_id, created_at", (q) => q.eq("is_driver", true).order("created_at", { ascending: false })),
      all("jobs", "driver_id, status, driver_pay, tip, payment_status", (q) => q.not("driver_id", "is", null)),
      all("driver_documents", "user_id, kind, status, uploaded_at", (q) => q.order("uploaded_at", { ascending: false })),
    ]);
    return {
      drivers: drivers.map((d) => {
        const mine = jobs.filter((j) => j.driver_id === d.id);
        const latest = (kind) => docs.find((x) => x.user_id === d.id && x.kind === kind);
        return {
          ...d,
          jobsDone: mine.filter((j) => j.status === "completed").length,
          earned: round2(mine.filter((j) => j.payment_status === "captured").reduce((s, j) => s + num(j.driver_pay) + num(j.tip), 0)),
          license: latest("license")?.status || "missing",
          registration: latest("registration")?.status || "missing",
        };
      }),
    };
  },

  // One driver's full record: documents (with private viewing links), signed
  // agreements, job history and Stripe payout status.
  async driver({ id }) {
    const p = await getProfile(id);
    if (!p) throw new HttpError(404, "Driver not found");
    const [docs, legal, jobs, ratings] = await Promise.all([
      all("driver_documents", "*", (q) => q.eq("user_id", id).order("uploaded_at", { ascending: false })),
      all("legal_acceptances", "role, documents, version, accepted_at, recorded_at, user_agent", (q) => q.eq("user_id", id).order("recorded_at", { ascending: false })),
      all("jobs", "id, status, address, price, driver_pay, tip, payment_status, payout_status, created_at, completed_at, photos", (q) => q.eq("driver_id", id).order("created_at", { ascending: false }).limit(50)),
      all("ratings", "id, stars, comment, created_at, rater_id", (q) => q.eq("ratee_id", id).order("created_at", { ascending: false }).limit(50)),
    ]);
    const raters = ratings.length ? await all("profiles", "id, name, email", (q) => q.in("id", [...new Set(ratings.map((r) => r.rater_id))])) : [];
    const reviews = ratings.map((r) => { const who = raters.find((x) => x.id === r.rater_id); return { ...r, rater: who ? (who.name || who.email) : null }; });
    const docsWithLinks = await Promise.all(docs.map(async (d) => ({ ...d, url: await signed("driver-docs", d.path) })));
    let stripeStatus = null;
    if (stripe && p.stripe_account_id) {
      try { stripeStatus = await driverPayoutsReady(p.stripe_account_id); } catch (e) { stripeStatus = { error: e.message }; }
    }
    return { profile: p, documents: docsWithLinks, agreements: legal, jobs, reviews, stripeStatus };
  },

  async "review-document"({ id, status, note }) {
    if (!["approved", "rejected", "pending"].includes(status)) throw new HttpError(400, "Bad status");
    const { error } = await admin.from("driver_documents")
      .update({ status, note: note || null, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  },

  async suspend({ id, suspended }) {
    const { error } = await admin.from("profiles").update({ suspended: !!suspended, ...(suspended ? { is_online: false } : {}) }).eq("id", id);
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  },

  // ---------- customers ----------
  async customers() {
    const [people, jobs] = await Promise.all([
      all("profiles", "id, name, email, phone, created_at", (q) => q.eq("is_driver", false).order("created_at", { ascending: false })),
      all("jobs", "customer_id, status, price, tip, payment_status"),
    ]);
    return {
      customers: people.map((c) => {
        const mine = jobs.filter((j) => j.customer_id === c.id);
        return { ...c, jobs: mine.length, completed: mine.filter((j) => j.status === "completed").length,
          spent: round2(mine.filter((j) => j.payment_status === "captured").reduce((s, j) => s + num(j.price) + num(j.tip), 0)) };
      }),
    };
  },

  // ---------- jobs ----------
  async jobs() {
    const [jobs, people] = await Promise.all([
      all("jobs", "id, status, job_type, address, offer, price, driver_pay, platform_fee, tip, payment_status, payout_status, customer_id, driver_id, created_at, completed_at, payment_intent_id, photos", (q) => q.order("created_at", { ascending: false }).limit(150)),
      all("profiles", "id, name, email"),
    ]);
    const name = (id) => { const p = people.find((x) => x.id === id); return p ? (p.name || p.email) : null; };
    return { jobs: jobs.map((j) => ({ ...j, customer: name(j.customer_id), driver: name(j.driver_id),
      photoCount: (j.photos?.before?.length || 0) + (j.photos?.after?.length || 0) })) };
  },

  // Private viewing links for one job's before/after photos.
  async "job-photos"({ id }) {
    const [job] = await all("jobs", "photos", (q) => q.eq("id", id));
    if (!job) throw new HttpError(404, "Job not found");
    const out = {};
    for (const phase of ["before", "after"]) {
      out[phase] = await Promise.all((job.photos?.[phase] || []).filter((p) => p.path).map((p) => signed("job-photos", p.path)));
    }
    return out;
  },
};
