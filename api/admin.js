// /api/admin?action=...  — the owner dashboard's data. Owners only.
//
// Who counts as an owner: the emails in the OWNER_EMAILS Vercel variable
// (comma-separated). Everyone else gets 403, even if signed in.
// Uses the service-role key, so it can read across all accounts — which is
// exactly why every action checks the owner list first.
import { admin, stripe, HttpError, requireUser, readJson, send, driverPayoutsReady, getProfile, driverLevel } from "./_lib.js";
import { forecastSnow, sendSnowAlert } from "./_weather.js";

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
    const [profiles, jobs, openIssues] = await Promise.all([
      all("profiles", "id, role, is_driver, is_online, suspended, payouts_ready, created_at"),
      all("jobs", "id, status, payment_status, payout_status, price, driver_pay, platform_fee, tip, created_at, completed_at"),
      all("job_issues", "id", (q) => q.eq("status", "open")).catch(() => []),
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
        openIssues: openIssues.length,
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

  // ---------- trends: one row per day (Duluth time) for the charts ----------
  async trends({ days } = {}) {
    const n = Math.min(Math.max(Number(days) || 30, 7), 90);
    const start = Date.now() - n * 864e5;
    const iso = new Date(start).toISOString();
    const [profiles, jobs] = await Promise.all([
      all("profiles", "is_driver, created_at", (q) => q.gte("created_at", iso)),
      all("jobs", "status, payment_status, price, tip, platform_fee, created_at, completed_at", (q) => q.gte("created_at", iso)),
    ]);
    const key = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    const rows = {};
    for (let i = n - 1; i >= 0; i--) { const k = key(Date.now() - i * 864e5); rows[k] = { day: k, customers: 0, drivers: 0, jobs: 0, completed: 0, gross: 0, drift: 0 }; }
    for (const p of profiles) { const r = rows[key(p.created_at)]; if (r) r[p.is_driver ? "drivers" : "customers"] += 1; }
    for (const j of jobs) {
      const r = rows[key(j.created_at)]; if (r) r.jobs += 1;
      if (j.status === "completed" && j.completed_at) {
        const c = rows[key(j.completed_at)];
        if (c) { c.completed += 1; if (j.payment_status === "captured") { c.gross = round2(c.gross + num(j.price) + num(j.tip)); c.drift = round2(c.drift + num(j.platform_fee)); } }
      }
    }
    return { days: Object.values(rows) };
  },

  // ---------- live storm-day map: online drivers + open / active jobs ----------
  async live() {
    const soon = new Date(Date.now() + 12 * 3600e3).toISOString();
    const [drivers, jobs] = await Promise.all([
      all("profiles", "id, name, email, truck, is_online", (q) => q.eq("is_driver", true).eq("is_online", true)),
      all("jobs", "id, status, address, lat, lng, price, driver_id, scheduled_for, created_at, expires_at, payment_status",
        (q) => q.in("status", ["requested", "scheduled", "accepted", "enroute", "plowing"]).order("created_at", { ascending: false }).limit(300)),
    ]);
    const now = new Date().toISOString();
    const held = (j) => ["authorized", "not_required"].includes(j.payment_status); // card held (or payments off) — drivers can see it
    const active = jobs.filter((j) => {
      if (j.status === "requested") return held(j) && j.expires_at > now;           // skip expired + abandoned checkouts
      if (j.status === "scheduled") return held(j) && j.scheduled_for && j.scheduled_for < soon;
      return true;
    });
    const driverIds = [...new Set([...drivers.map((d) => d.id), ...active.map((j) => j.driver_id).filter(Boolean)])];
    const locs = driverIds.length ? await all("driver_locations", "driver_id, lat, lng, updated_at", (q) => q.in("driver_id", driverIds)) : [];
    const names = driverIds.length ? await all("profiles", "id, name, email", (q) => q.in("id", driverIds)) : [];
    const nm = (id) => { const p = names.find((x) => x.id === id); return p ? (p.name || p.email) : null; };
    return {
      drivers: driverIds.map((id) => {
        const loc = locs.find((l) => l.driver_id === id);
        const d = drivers.find((x) => x.id === id);
        const busy = active.filter((j) => j.driver_id === id && ["accepted", "enroute", "plowing"].includes(j.status)).length;
        return { id, name: nm(id), truck: d?.truck || null, online: !!d, busy, lat: loc?.lat ?? null, lng: loc?.lng ?? null, seenAt: loc?.updated_at || null };
      }),
      jobs: active.map((j) => ({ id: j.id, status: j.status, address: j.address, price: num(j.price), driver: nm(j.driver_id),
        scheduledFor: j.scheduled_for, createdAt: j.created_at,
        lat: j.lat ?? null, lng: j.lng ?? null })),
      at: new Date().toISOString(),
    };
  },

  // ---------- problems reported on jobs ----------
  async issues({ all: everything } = {}) {
    let rows = await all("job_issues", "id, job_id, reporter_id, kind, note, released, status, created_at, resolved_at",
      (q) => (everything ? q : q.eq("status", "open")).order("created_at", { ascending: false }).limit(100));
    if (!rows.length) return { issues: [] };
    const jobs = await all("jobs", "id, address, status, customer_id, driver_id", (q) => q.in("id", [...new Set(rows.map((r) => r.job_id))]));
    const ids = [...new Set([...rows.map((r) => r.reporter_id), ...jobs.flatMap((j) => [j.customer_id, j.driver_id])].filter(Boolean))];
    const people = await all("profiles", "id, name, email, phone", (q) => q.in("id", ids));
    const who = (id) => { const p = people.find((x) => x.id === id); return p ? { name: p.name || p.email, phone: p.phone || null } : null; };
    return { issues: rows.map((r) => { const j = jobs.find((x) => x.id === r.job_id) || {};
      return { ...r, address: j.address || null, jobStatus: j.status || null, reporter: who(r.reporter_id),
        byDriver: r.reporter_id && r.reporter_id === j.driver_id || r.released, customer: who(j.customer_id), driver: who(j.driver_id) }; }) };
  },
  async "resolve-issue"({ id }) {
    const { error } = await admin.from("job_issues").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  },

  // ---------- drivers ----------
  async drivers() {
    const [drivers, jobs, docs] = await Promise.all([
      all("profiles", "id, name, email, phone, truck, tools, rating, ratings_count, jobs_count, late_cancels, is_online, suspended, payouts_ready, stripe_account_id, ref_source, home_radius_mi, created_at", (q) => q.eq("is_driver", true).order("created_at", { ascending: false })),
      all("jobs", "driver_id, status, driver_pay, tip, payment_status", (q) => q.not("driver_id", "is", null)),
      all("driver_documents", "user_id, kind, status, uploaded_at", (q) => q.order("uploaded_at", { ascending: false })),
    ]);
    return {
      drivers: drivers.map((d) => {
        const mine = jobs.filter((j) => j.driver_id === d.id);
        const latest = (kind) => docs.find((x) => x.user_id === d.id && x.kind === kind);
        return {
          ...d,
          level: driverLevel(d),
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
    const backouts = await all("driver_backouts", "job_id, late, reason, created_at", (q) => q.eq("driver_id", id).order("created_at", { ascending: false }).limit(30));
    return { profile: p, documents: docsWithLinks, agreements: legal, jobs, reviews, stripeStatus, backouts };
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
      all("profiles", "id, name, email, phone, ref_source, created_at", (q) => q.eq("is_driver", false).order("created_at", { ascending: false })),
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

  // ---------- where sign-ups come from (?ref= links) ----------
  async sources() {
    const [people, jobs] = await Promise.all([
      all("profiles", "id, is_driver, ref_source, created_at"),
      all("jobs", "customer_id, status, price, tip, payment_status"),
    ]);
    const rows = {};
    for (const p of people) {
      const k = p.ref_source || "(no link)";
      const r = (rows[k] ||= { source: k, signups: 0, customers: 0, drivers: 0, bookedCustomers: 0, revenue: 0, last7: 0 });
      r.signups += 1;
      if (p.is_driver) r.drivers += 1; else r.customers += 1;
      if (Date.now() - new Date(p.created_at).getTime() < 7 * 864e5) r.last7 += 1;
      const done = jobs.filter((j) => j.customer_id === p.id && j.status === "completed");
      if (done.length) r.bookedCustomers += 1;
      r.revenue = round2(r.revenue + done.filter((j) => j.payment_status === "captured").reduce((s, j) => s + num(j.price) + num(j.tip), 0));
    }
    return { sources: Object.values(rows).sort((a, b) => b.signups - a.signups) };
  },

  // ---------- snow alerts ----------
  async "snow-forecast"() { return await forecastSnow({ fresh: true }); },
  async "snow-alert"({ title, body, audience }) {
    const msg = { title: String(title || "").slice(0, 80), body: String(body || "").slice(0, 160) };
    if (!msg.title) throw new HttpError(400, "Add a title");
    return await sendSnowAlert({
      customers: audience === "customers" || audience === "all" ? msg : null,
      drivers: audience === "drivers" || audience === "all" ? msg : null,
    });
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
