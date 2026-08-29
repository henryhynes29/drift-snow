import React, { useState, useEffect, useRef, useMemo, createContext, useContext, useReducer } from "react";
import MapPropertyDesigner, { staticMapUrl, LiveMap, MAP_ENABLED } from "./PropertyMap.jsx";
import { useAuth } from "./lib/auth.jsx";
import { supabaseEnabled } from "./lib/supabase.js";
import { loadProperties, replaceProperties, rateJob, pushDriverLocation, subscribeToDriverLocation, createJobFromOrder, patchJob, sendMessage, subscribeToMessages } from "./lib/db.js";
import { STRIPE_ENABLED, getStripe, createPaymentIntent, capturePayment, createConnectAccount, sendTip } from "./lib/payments.js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { snowDepthNow, nextStorm, refreshConditions } from "./lib/weather.js";
import { deliverExternal } from "./lib/notify.js";
import { surgePct as marketSurgePct, surgeLabel as marketSurgeLabel, SURGE, refreshMarket } from "./lib/market.js";
import Landing from "./Landing.jsx";

// ============================================================
// DRIFT — two-sided snowplow marketplace prototype
// One app · Rider/Driver toggle · shared live state
// Storm surcharge is small, capped, and shown as its own line item — never hidden.
// Single-file. All data mocked; no network calls.
// ============================================================

// ---- Design tokens ---------------------------------------------------------
const C = {
  night: "#08121F", night2: "#0E1E31", slate: "#152A42", slate2: "#1B334E",
  line: "#24435F", lineSoft: "#1A3450",
  ice: "#F5F9FD", mist: "#BCCEE0", mistDim: "#93A8C0",
  amber: "#FFB020", amberDeep: "#B9791A", amberSoft: "#FFC759",
  plow: "#3DCBFF", push: "#6EEE9B", danger: "#FF6B6B", good: "#6EEE9B",
};
const FD = "'Oswald','Arial Narrow',sans-serif";   // display
const FB = "'Inter',system-ui,sans-serif";          // body

// spacing scale — everything snaps to this so rhythm is consistent
const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
// elevation — depth cues like native apps
const E = {
  low: "0 1px 3px rgba(0,0,0,.28)",
  mid: "0 4px 14px rgba(0,0,0,.34)",
  high: "0 12px 34px rgba(0,0,0,.46)",
  sheet: "0 -14px 44px rgba(0,0,0,.55)",
};
// motion — one easing curve everywhere (iOS-like)
const EASE = "cubic-bezier(.22,1,.36,1)";
// minimum touch target (Apple HIG / cold-weather gloves)
const TAP = 48;

// ---- Demand surge (supply/demand, and ALWAYS shown to the rider) ----------
// The price rises only when many customers need a plow and few drivers are out —
// real scarcity, not snow depth. It's disclosed as its own line item, never a
// hidden multiplier, and the driver keeps 75% of it (it's what pulls plows online).
// The surge % + label come from src/lib/market.js (demand/driver counts).
const SNOW_DEPTH_IN = snowDepthNow(); // still used for the weather banner + emergency dispatch, NOT pricing

// Next incoming storm (demo forecast). In production this is the same weather
// feed that will drive auto-dispatch against each customer's snow threshold.
const FORECAST = nextStorm();

// ---- Job types (Duluth-specific) ------------------------------------------
// Each job type has its own tool requirement, pricing basis, and driver match.
// basis: "area" (per sqft), "linear" (per ft of walk/curb), or "flat".
const JOB_TYPES = {
  driveway: { id: "driveway", label: "Driveway plow", icon: "🚜", tool: "Plow truck",
    basis: "area", base: 25, rate: 0.035, minsPer1000: 22, minMins: 18, blurb: "Clear your drive & apron" },
  sidewalk: { id: "sidewalk", label: "Sidewalk clear", icon: "🧹", tool: "Snowblower",
    basis: "linear", base: 15, rate: 0.35, minsPerFt: 0.5, minMins: 15, blurb: "24-hr city ordinance compliance" },
  digout: { id: "digout", label: "Car dig-out", icon: "🚗", tool: "Snowblower / shovel",
    basis: "flat", base: 45, mins: 25, blurb: "Free your street-parked car after a plow berm" },
  commercial: { id: "commercial", label: "Commercial lot", icon: "🏢", tool: "Skid steer",
    basis: "area", base: 120, rate: 0.05, minsPer1000: 16, minMins: 35, blurb: "Lots, multi-bay, private roads" },
  // Roadside jump-start — a minor add-on, not a core service. Flat-rate, no zones.
  jumpstart: { id: "jumpstart", label: "Jump-start", icon: "🔋", tool: "Roadside kit",
    basis: "flat", base: 40, mins: 15, blurb: "Dead battery in the cold — back on the road" },
};

// Roadside jobs live in their own section, not the snow-clearing picker.
const ROADSIDE = ["jumpstart"];

// ---- Property modifiers (surcharge multipliers) ---------------------------
// Duluth hillside reality: grade, ice, retaining walls, shared drives all change
// the job. These stack multiplicatively on the pre-surge base.
const MODIFIERS = {
  grade: { flat: { m: 1.0, label: "Flat" }, moderate: { m: 1.12, label: "Moderate slope" }, steep: { m: 1.28, label: "Steep hillside" } },
  hazards: { // additive per selected hazard
    retaining_wall: { m: 0.06, label: "Retaining wall" },
    tight_turns: { m: 0.05, label: "Tight turns" },
    gravel: { m: 0.05, label: "Gravel surface" },
    low_clearance: { m: 0.05, label: "Low clearance" },
    ice_prone: { m: 0.08, label: "Ice-prone / north-facing" },
  },
  shared: { m: 0.9, label: "Shared driveway (split cost)" }, // discount, not surcharge
};

function modifierMultiplier(property) {
  if (!property) return 1;
  let m = MODIFIERS.grade[property.grade || "flat"].m;
  (property.hazards || []).forEach(h => { if (MODIFIERS.hazards[h]) m += MODIFIERS.hazards[h].m; });
  if (property.shared) m *= MODIFIERS.shared.m;
  return +m.toFixed(3);
}

// ---- Area-based pricing model ---------------------------------------------
// The property designer draws in a 150 x 100 coordinate box (matches the ~1.5:1
// on-screen aspect so shapes never distort). We calibrate that box to a realistic
// residential lot so polygon area maps to believable square feet.
const CANVAS_W = 150, CANVAS_H = 100;
const PRICING = {
  base: 25, perSqFt: 0.035, minTotal: 30,
  lotWidthFt: 90, lotHeightFt: 60, minsPer1000: 14,
};

// Flat platform fee on every order — folded into the price the customer sees (so
// there's no separate "fee" line) but taken off the top before the driver split,
// so it's 100% yours. One number to tune your take.
const PLATFORM_FEE = 8;

// ---- Salting add-on (optional, stacks on any driveway / walk / lot job) ----
// Salt is priced separately and is NOT storm-surged — a bag of ice-melt costs
// the same whether it's a dusting or a blizzard. Riders toggle it on; drivers
// with salt on their profile see it called out on the job card.
const SALT = {
  rate: 0.15, mins: 6,   // salting adds 15% of the job price
  appliesTo: ["driveway", "sidewalk", "commercial"],
  tool: "Salt / ice-melt",
};

function polygonAreaUnits(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}
function zonesToSqFt(zones) {
  const plow = (zones || []).filter(z => z.mode === "plow");
  const lotSqFt = PRICING.lotWidthFt * PRICING.lotHeightFt;
  const total = plow.reduce((sum, z) => {
    const maxX = Math.max(...z.pts.map(p => p.x));
    const canvasArea = maxX > 100 || z._n ? CANVAS_W * CANVAS_H : 100 * 100;
    return sum + (polygonAreaUnits(z.pts) / canvasArea) * lotSqFt;
  }, 0);
  return Math.round(total);
}

// ---- Seed data -------------------------------------------------------------
const SIZES = [
  { id: "s", label: "Small", desc: "1–2 cars · short drive", base: 45, mins: 15 },
  { id: "m", label: "Medium", desc: "2–3 cars · standard", base: 70, mins: 25 },
  { id: "l", label: "Large", desc: "3+ cars · long drive", base: 105, mins: 40 },
  { id: "xl", label: "Commercial", desc: "Lot / multi-bay", base: 180, mins: 70 },
];

const SEED_DRIVER = {
  name: "Marcus T.", rating: 4.9, jobs: 412, truck: "F-350 · 9ft V-Plow", power: 5,
  tier: "Blizzard", tierPct: 0.80,
  tools: ["Plow truck", "Snowblower", "Snowblower / shovel", "Skid steer", "Roadside kit"], // equipped for all job types
  x: 62, y: 38, lng: -92.101, lat: 46.801,
  docs: { license: "verified", insurance: "verified", plate: "verified", w9: "pending" },
  insurancePlan: "own", // "own" = carries their own commercial policy | "perEvent" = DRIFT per-event coverage
  insurancePolicy: { carrier: "North Country Commercial", type: "Commercial GL + Plow", expires: "2026-11-01" },
};

const SEED_PROPERTIES = [
  { id: "p1", label: "Home", addr: "1420 Woodland Ave", grade: "moderate", hazards: ["ice_prone"], shared: false,
    size: SIZES[1],
    zones: [
      { mode: "plow", pts: [{x:44,y:40},{x:56,y:40},{x:56,y:76},{x:44,y:76}] },
      { mode: "push", pts: [{x:60,y:66},{x:80,y:66},{x:80,y:78},{x:60,y:78}] },
    ] },
];

const DRIVE_OVERHEAD_MIN = 12;

// Your platform cut — taken transparently out of the job total; the driver keeps
// the rest. This ONE number sets your take rate. No hidden surge, no add-on fee:
// the customer pays exactly the price they see, and it equals the line items.
const PLATFORM_RATE = 0.15; // reference cut; actual driver share comes from tiers below

// Driver payout tiers — drivers keep more of each job as they complete more.
// Brand-new drivers get a 90% intro on their first few jobs to remove the risk
// of signing up. Tune the thresholds/percentages freely.
const INTRO_JOBS = 5, INTRO_PCT = 0.90;
const DRIVER_TIERS = [
  { id: "blizzard", label: "Blizzard", pct: 0.85, minJobs: 150 },
  { id: "veteran",  label: "Veteran",  pct: 0.80, minJobs: 75 },
  { id: "pro",      label: "Pro",      pct: 0.75, minJobs: 25 },
  { id: "rookie",   label: "Rookie",   pct: 0.70, minJobs: 0 },
];
function driverTier(driver) {
  const jobs = driver?.jobs || 0;
  if (jobs < INTRO_JOBS) return { id: "intro", label: "New driver", pct: INTRO_PCT, intro: true, minJobs: 0 };
  return DRIVER_TIERS.find(t => jobs >= t.minJobs) || DRIVER_TIERS[DRIVER_TIERS.length - 1];
}
const driverPct = (driver) => driverTier(driver).pct;
// Driver's gross pay for a job: their tier % of the base+salt, plus 75% of any
// storm surge. The flat platform fee is NOT shared — it's 100% the platform's.
const driverGrossPay = (q, driver) => Math.round(
  (q?.baseAmount || 0) * driverPct(driver) + (q?.surgeFee || 0) * SURGE.driverShare
);

// Pay-per-event insurance: drivers can use their OWN commercial policy, or opt into
// DRIFT's per-event coverage — no monthly premium, a small fee is deducted from each
// job they actually work. IMPORTANT: this must be backed by a real insurer's on-demand
// program; set `perEvent` to what that insurer charges you per covered job.
const INSURANCE = { perEvent: 5, label: "Per-event coverage" };
const driverOnPerEvent = (driver) => driver?.insurancePlan === "perEvent";
const driverInsuranceFee = (driver) => driverOnPerEvent(driver) ? INSURANCE.perEvent : 0;
// Net take-home = gross pay minus the per-event insurance fee (0 if they carry their own).
const driverNetPay = (q, driver) => Math.max(0, driverGrossPay(q, driver) - driverInsuranceFee(driver));
const driverHourlyFor = (dPay, mins) => Math.round((dPay / ((mins || 25) + DRIVE_OVERHEAD_MIN)) * 60);

// Capture the customer's held card + pay the driver when a job completes.
// Best-effort: the UI still marks the job done even if this network call fails,
// and it's a no-op until Stripe keys are set (demo mode).
async function settleJobPayment(order, driverAmount, driver) {
  if (!STRIPE_ENABLED || !order?.paymentIntentId) return;
  try {
    await capturePayment({
      paymentIntentId: order.paymentIntentId,
      driverAmount,
      driverStripeAccountId: driver?.stripeAccountId,
    });
  } catch (e) { /* swallow — completion shouldn't hinge on the network */ }
}

// ---- Unified quote: honest, transparent pricing ---------------------------
// riderTotal = base + area/linear (× site factors) + optional salt. That's it —
// what the customer sees is what they pay, and the breakdown adds up to it.
function quoteJob({ jobType = "driveway", sqft = 0, linearFt = 0, property = null, salt = false }) {
  const jt = JOB_TYPES[jobType] || JOB_TYPES.driveway;
  let base, mins;
  if (jt.basis === "area") {
    base = jt.base + sqft * jt.rate;
    mins = Math.max(jt.minMins, Math.round((sqft / 1000) * jt.minsPer1000));
  } else if (jt.basis === "linear") {
    base = jt.base + linearFt * jt.rate;
    mins = Math.max(jt.minMins, Math.round(linearFt * jt.minsPerFt));
  } else { // flat
    base = jt.base;
    mins = jt.mins;
  }
  const mod = modifierMultiplier(property);
  const coreBase = Math.max(PRICING.minTotal, base * mod); // the plow price, pre-storm
  // Storm surcharge — disclosed, capped. Roadside/flat jobs aren't snow-depth priced.
  const surged = jt.basis !== "flat";
  const surgePct = surged ? marketSurgePct() : 0; // demand-based, not snow-based
  const surgeFee = Math.round(coreBase * surgePct);
  // Optional salting add-on — priced off the pre-storm base (salt isn't storm-priced).
  const saltable = SALT.appliesTo.includes(jobType);
  const saltFee = salt && saltable ? Math.round(coreBase * SALT.rate) : 0; // +15% of the job
  const saltMins = saltFee ? SALT.mins : 0;

  // Pay components: the base + salt is split by the driver's tier; the surge is
  // split 75/25; the flat platform fee is 100% ours. (Driver share needs the
  // driver's tier, so the real number is computed by driverGrossPay/driverNetPay.)
  const baseAmount = Math.round(coreBase + saltFee); // tier-split portion
  const total = Math.round(baseAmount + surgeFee + PLATFORM_FEE); // what the customer pays
  const nominalDriver = Math.round(baseAmount * 0.8 + surgeFee * SURGE.driverShare); // ~80% tier estimate
  const hourly = Math.round((nominalDriver / (mins + saltMins + DRIVE_OVERHEAD_MIN)) * 60);
  return {
    jobType, jt, sqft, linearFt, mod,
    salt: !!saltFee, saltFee, saltable,
    surge: surgeFee > 0, surgeFee, surgePct, surgeLabel: marketSurgeLabel(),
    riderTotal: total,
    baseAmount, platformFee: PLATFORM_FEE,
    preSurge: Math.round(coreBase),
    driverPay: nominalDriver, fee: total - nominalDriver, platformNet: total - nominalDriver,
    hourly, mins: mins + saltMins,
    tool: jt.tool,
  };
}

// AREA-BASED quote kept as a thin wrapper for existing callers.
function areaQuote(sqft, property = null) {
  return quoteJob({ jobType: property?.size?.id === "xl" ? "commercial" : "driveway", sqft, property });
}

function quoteProperty(property) {
  const sqft = property?.sqft || zonesToSqFt(property?.zones);
  if (sqft > 0) return quoteJob({ jobType: "driveway", sqft, property });
  return quote(property?.size || SIZES[1]);
}

// legacy bucket quote (fallback when nothing is outlined yet)
function quote(size) {
  const total = Math.round(size.base);
  const platformNet = Math.round(total * PLATFORM_RATE);
  const driverPay = total - platformNet;
  const hourly = Math.round((driverPay / (size.mins + DRIVE_OVERHEAD_MIN)) * 60);
  return { riderTotal: total, fee: platformNet, driverPay, hourly, platformNet };
}

// ---- Global store (shared between rider & driver) --------------------------
const StoreCtx = createContext(null);
const useStore = () => useContext(StoreCtx);

const initial = {
  role: "rider",                    // rider | driver
  onboarded: false,                 // fresh customer -> guided setup first
  profile: { name: "", phone: "", email: "" },
  payment: null,                    // { brand, last4 } once added
  driverOnline: false,
  driverOnboarded: false,           // drivers must verify before going online
  properties: [],                   // fresh customer starts with none
  activeProperty: null,
  order: null,                      // the live job, shared by both sides
  scheduled: [],                    // upcoming, future-dated jobs
  offline: false,                   // storm knocked out signal
  queued: 0,                        // ops waiting to sync
  driver: SEED_DRIVER,
  userId: null,                     // set when signed in via Supabase
  autoPlow: false,
  autoPlowThreshold: 2,             // inches of snow that triggers auto-dispatch
  earnings: { today: 0, week: 512, jobsToday: 0, payouts: [
    { d: "Mon", amt: 148 }, { d: "Tue", amt: 96 }, { d: "Wed", amt: 132 }, { d: "Thu", amt: 136 },
  ]},
  history: [
    { id: "h1", date: "Jan 12", size: "Medium", total: 129, driver: "Kyle B.", rating: 5 },
    { id: "h2", date: "Jan 8", size: "Small", total: 83, driver: "Dana R.", rating: 4 },
  ],
  // two-sided referrals
  riderReferral: {
    code: "DRIFT-JANE", credit: 0, invited: 0,
    reward: 15,           // both sides get $15 when a referred neighbor's 1st plow completes
    activity: [],         // {name, status: 'joined'|'first-plow', amt}
  },
  driverReferral: {
    code: "PLOW-MARCUS", credit: 0, invited: 0,
    reward: 150,          // driver bonus when a referred driver completes 20 jobs
    threshold: 20,
    activity: [],         // {name, jobs, status}
  },
  toast: null,
  notifications: [],   // in-app activity feed (bell). {id, kind, title, body, ts, read, role}
};

// Build a notification record. `role` scopes who should see it: rider | driver | both.
let _notifSeq = 0;
function mkNotif({ kind = "job", title, body = "", role = "both" }) {
  _notifSeq += 1;
  return { id: `n${Date.now()}_${_notifSeq}`, kind, title, body, role, read: false, ts: Date.now() };
}
// Persist a newly-created order to Supabase (best-effort, non-blocking). On
// success, stamps the real job id back onto the live order so status updates and
// live-location can key off it. No-op in demo mode (no Supabase / not signed in).
function persistNewJob(dispatch, order, userId) {
  if (!supabaseEnabled || !userId) return;
  createJobFromOrder(order, userId)
    .then((res) => { if (res?.data?.id) dispatch({ type: "ORDER_STATE", patch: { jobId: res.data.id } }); })
    .catch(() => { /* best-effort — the demo flow never depends on this */ });
}

// Open real turn-by-turn directions in the device's native maps app.
// Uses the universal Google Maps URL (opens the Google Maps app on iOS/Android,
// the web map on desktop). Prefers exact coordinates, falls back to the address.
function openDirections(dest) {
  const hasLL = dest && typeof dest.lat === "number" && typeof dest.lng === "number";
  const q = hasLL ? `${dest.lat},${dest.lng}` : encodeURIComponent(dest?.addr || "");
  if (!q) return false;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
  return true;
}

// Emit an in-app notification AND hand it to the external transport (push/SMS,
// which is a no-op until those channels are wired). One call, both paths.
function notify(dispatch, opts, phone) {
  const n = mkNotif(opts);
  dispatch({ type: "NOTIFY", notif: n });
  deliverExternal(n, { phone });
  return n;
}

function reducer(s, a) {
  switch (a.type) {
    case "ROLE": return { ...s, role: a.role };
    case "ONLINE": return { ...s, driverOnline: a.v };
    case "OFFLINE": return { ...s, offline: a.v, queued: a.v ? s.queued : 0 };
    case "DRIVER_ONBOARD_DONE": return {
      ...s, driverOnboarded: true,
      driver: { ...s.driver, name: a.name || s.driver.name, truck: a.truck || s.driver.truck,
        tools: a.tools?.length ? a.tools : s.driver.tools,
        docs: { ...s.driver.docs, ...(a.docs || {}) },
        insurancePlan: a.insurancePlan || s.driver.insurancePlan,
        insurancePolicy: a.insurance || s.driver.insurancePolicy },
      driverReferral: { ...s.driverReferral, code: a.name ? "PLOW-" + a.name.split(" ")[0].toUpperCase() : s.driverReferral.code },
    };
    case "QUEUE": return { ...s, queued: s.queued + 1 };
    case "REFER_RIDER": {
      const r = s.riderReferral;
      return { ...s, riderReferral: { ...r, invited: r.invited + 1,
        activity: [{ name: a.name || "Invited neighbor", status: "joined", amt: 0 }, ...r.activity] } };
    }
    case "REFER_RIDER_CREDIT": {
      const r = s.riderReferral;
      return { ...s, riderReferral: { ...r, credit: r.credit + r.reward,
        activity: r.activity.map((x, i) => i === a.idx ? { ...x, status: "first-plow", amt: r.reward } : x) } };
    }
    case "REFER_DRIVER": {
      const r = s.driverReferral;
      return { ...s, driverReferral: { ...r, invited: r.invited + 1,
        activity: [{ name: a.name || "Invited driver", jobs: 0, status: "signed-up" }, ...r.activity] } };
    }
    case "HYDRATE_USER": {
      if (a.role === "driver") return { ...s, userId: a.userId, role: "driver", profile: a.profile || s.profile };
      const props = a.properties || [];
      return { ...s, userId: a.userId, role: "rider", profile: a.profile || s.profile,
        properties: props, activeProperty: props[0] || null, onboarded: props.length > 0 };
    }
    case "SIGNED_OUT": return { ...initial };
    // DEV ONLY — jump past auth + both onboarding flows with demo data. Remove before production.
    case "DEV_SKIP": {
      const props = s.properties.length ? s.properties : SEED_PROPERTIES;
      return {
        ...s,
        onboarded: true,
        driverOnboarded: true,
        profile: s.profile.name ? s.profile : { name: "Demo User", phone: "218-555-0100", email: "demo@drift.app" },
        payment: s.payment || { brand: "Visa", last4: "4242" },
        properties: props,
        activeProperty: s.activeProperty || props[0] || null,
      };
    }
    case "ONBOARD_DONE": return {
      ...s, onboarded: true,
      profile: a.profile || s.profile,
      payment: a.payment || s.payment,
      properties: a.property ? [a.property] : s.properties,
      activeProperty: a.property || s.activeProperty,
      riderReferral: { ...s.riderReferral, code: a.profile?.name
        ? "DRIFT-" + a.profile.name.split(" ")[0].toUpperCase() : s.riderReferral.code },
    };
    case "SET_PROFILE": return { ...s, profile: { ...s.profile, ...a.patch } };
    case "SET_PAYMENT": return { ...s, payment: a.payment };
    case "ADD_PROPERTY": return { ...s, properties: [...s.properties, a.p], activeProperty: a.p };
    case "SET_PROPERTY": return { ...s, activeProperty: a.p };
    case "UPDATE_PROPERTY": {
      const props = s.properties.map(p => p.id === a.p.id ? a.p : p);
      return { ...s, properties: props, activeProperty: a.p };
    }
    case "AUTOPLOW": return { ...s, autoPlow: a.v, autoPlowThreshold: a.threshold ?? s.autoPlowThreshold };
    case "AUTOPLOW_THRESHOLD": return { ...s, autoPlowThreshold: a.inches };
    case "REQUEST": // rider requests -> job enters "requested" (driver sees it if online)
      return { ...s, order: a.order };
    case "SCHEDULE": // add a future-dated job to the schedule list (not live yet)
      return { ...s, scheduled: [a.job, ...s.scheduled].sort((x, y) => x.when - y.when) };
    case "CANCEL_SCHEDULED":
      return { ...s, scheduled: s.scheduled.filter(j => j.id !== a.id) };
    case "ACTIVATE_SCHEDULED": // scheduled job becomes the live order
      return { ...s, order: a.order, scheduled: s.scheduled.filter(j => j.id !== a.id) };
    case "ORDER_STATE": return { ...s, order: { ...s.order, ...a.patch } };
    case "ADD_PHOTO": { // driver captures a before/after photo on the live order
      const photos = { ...(s.order?.photos || { before: [], after: [] }) };
      photos[a.phase] = [...(photos[a.phase] || []), a.photo];
      return { ...s, order: { ...s.order, photos } };
    }
    case "COMPLETE": {
      const q = a.q;
      return {
        ...s,
        earnings: {
          ...s.earnings,
          today: s.earnings.today + q.driverPay,
          week: s.earnings.week + q.driverPay,
          jobsToday: s.earnings.jobsToday + 1,
        },
        history: [{ id: "h" + Date.now(), date: "Today", size: a.size.label, total: q.riderTotal,
          driver: s.driver.name, rating: 0, photos: s.order?.photos || null }, ...s.history],
      };
    }
    case "CLEAR_ORDER": return { ...s, order: null };
    case "TIP": return { ...s, earnings: { ...s.earnings,
      today: s.earnings.today + a.amt, week: s.earnings.week + a.amt } };
    case "NOTIFY": return { ...s, notifications: [a.notif, ...s.notifications].slice(0, 50) };
    case "NOTIF_READ":
      return { ...s, notifications: s.notifications.map(n => (!a.id || n.id === a.id) ? { ...n, read: true } : n) };
    case "NOTIF_CLEAR": return { ...s, notifications: [] };
    case "RESET": return { ...initial };
    case "TOAST": return { ...s, toast: a.msg };
    default: return s;
  }
}

// ---- UI atoms --------------------------------------------------------------
function Eyebrow({ children, color = C.amber }) {
  return <div style={{ font: `700 12px/1 ${FB}`, letterSpacing: ".16em", textTransform: "uppercase", color }}>{children}</div>;
}
function Stars({ v, size = 13, onSet }) {
  return (
    <span style={{ fontSize: size, letterSpacing: 1 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} onClick={onSet ? () => onSet(i) : undefined}
          style={{ color: i <= Math.round(v) ? C.amber : C.mistDim, cursor: onSet ? "pointer" : "default" }}>★</span>
      ))}
    </span>
  );
}
function Power({ n }) {
  return <span style={{ display: "inline-flex", gap: 2 }}>
    {[1,2,3,4,5].map(i => <span key={i} style={{ width: 5, height: 13, borderRadius: 1, background: i <= n ? C.amber : C.line }} />)}
  </span>;
}
function Btn({ children, onClick, kind = "primary", disabled, full, sm, style }) {
  const [press, setPress] = useState(false);
  const base = {
    font: `700 ${sm ? 14 : 16}px/1 ${FB}`, letterSpacing: "-.01em",
    minHeight: sm ? 40 : TAP, padding: sm ? "0 18px" : "0 24px",
    borderRadius: sm ? 11 : 14, cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent", width: full ? "100%" : "auto",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    transform: press ? "scale(.965)" : "scale(1)",
    transition: `transform .18s ${EASE}, opacity .2s, background .2s`,
    opacity: disabled ? .35 : 1, WebkitTapHighlightColor: "transparent",
  };
  const kinds = {
    primary: { background: `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})`, color: "#231603", boxShadow: disabled ? "none" : "0 6px 20px rgba(255,176,32,.28)" },
    ghost: { background: "transparent", color: C.ice, border: `1px solid ${C.line}` },
    dark: { background: C.slate, color: C.ice, border: `1px solid ${C.line}` },
    danger: { background: "transparent", color: C.danger, border: `1px solid ${C.danger}55` },
    good: { background: `linear-gradient(180deg, #8BF5AE, ${C.push})`, color: "#07240F", boxShadow: disabled ? "none" : "0 6px 20px rgba(110,238,155,.26)" },
  };
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      onPointerDown={() => !disabled && setPress(true)}
      onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}
      style={{ ...base, ...kinds[kind], ...style }}>{children}</button>
  );
}

function Card({ children, style, active, onClick, flat }) {
  const [press, setPress] = useState(false);
  return (
    <div onClick={onClick}
      onPointerDown={() => onClick && setPress(true)}
      onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}
      style={{
        background: active ? `linear-gradient(150deg, ${C.slate2}, ${C.slate})` : C.slate,
        border: `1px solid ${active ? C.amber : C.line}`,
        borderRadius: 16, padding: S.lg, cursor: onClick ? "pointer" : "default",
        boxShadow: active ? `0 0 0 3px rgba(255,176,32,.13), ${E.mid}` : flat ? "none" : E.low,
        transform: press ? "scale(.99)" : "scale(1)",
        transition: `border-color .18s, box-shadow .18s, transform .18s ${EASE}`,
        WebkitTapHighlightColor: "transparent", ...style,
      }}>{children}</div>
  );
}

function Chip({ children, color = C.mist, bg, solid }) {
  return <span style={{ font: `700 11px ${FB}`, letterSpacing: ".06em", textTransform: "uppercase",
    color: solid ? "#08121F" : color, background: solid ? color : (bg || color + "1C"),
    padding: "5px 10px", borderRadius: 20, whiteSpace: "nowrap",
    border: solid ? "none" : `1px solid ${color}2E` }}>{children}</span>;
}

function Row({ label, value, muted, amber, big }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", gap: 12 }}>
    <span style={{ font: `${big?700:500} ${big?15:13}px ${FB}`, color: muted ? C.mistDim : amber ? C.amber : C.mist }}>{label}</span>
    <span style={{ font: `700 ${big?22:13}px ${big?FD:FB}`, color: big ? C.amber : amber ? C.amber : C.ice, flexShrink: 0 }}>{value}</span>
  </div>;
}

// avatar with initials
function Avatar({ name, size = 44, color = C.amber }) {
  const init = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return <div style={{ width: size, height: size, borderRadius: size * .32, flexShrink: 0,
    background: `linear-gradient(140deg, ${color}, ${color}99)`, display: "grid", placeItems: "center",
    font: `800 ${size * .36}px ${FD}`, color: "#08121F", boxShadow: E.low }}>{init}</div>;
}

// segmented control (iOS-style)
function Segmented({ options, value, onChange, color = C.amber }) {
  return (
    <div style={{ display: "flex", background: C.night2, border: `1px solid ${C.line}`, borderRadius: 13, padding: 3, position: "relative" }}>
      {options.map(o => {
        const on = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{ flex: 1, minHeight: 38, border: "none", cursor: "pointer",
            borderRadius: 10, background: on ? color : "transparent", color: on ? "#08121F" : C.mist,
            font: `700 13px ${FB}`, transition: `background .22s ${EASE}, color .22s`, WebkitTapHighlightColor: "transparent" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// bottom sheet wrapper with backdrop + drag handle
function Sheet({ children, onClose, maxWidth = 440 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(4,10,18,.76)",
      backdropFilter: "blur(3px)", zIndex: 60, display: "flex", alignItems: "flex-end", justifyContent: "center",
      animation: "fadeIn .2s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth, background: C.night2,
        borderTop: `1px solid ${C.line}`, borderRadius: "24px 24px 0 0", padding: `${S.md}px ${S.xl}px calc(${S.xl}px + env(safe-area-inset-bottom))`,
        boxShadow: E.sheet, animation: `rise .3s ${EASE}`, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ width: 38, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 14px" }} />
        {children}
      </div>
    </div>
  );
}

// skeleton shimmer for loading states
function Skeleton({ h = 16, w = "100%", r = 8, style }) {
  return <div style={{ height: h, width: w, borderRadius: r,
    background: `linear-gradient(90deg, ${C.slate} 25%, ${C.slate2} 50%, ${C.slate} 75%)`,
    backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite", ...style }} />;
}

const h2 = { font: `700 30px/1.05 ${FD}`, letterSpacing: ".01em", margin: "8px 0 8px" };
const sub = { font: `400 15px/1.5 ${FB}`, color: C.mist, margin: 0 };
const miniBtn = { font: `600 13px ${FB}`, minHeight: 38, padding: "0 14px", borderRadius: 11, cursor: "pointer",
  background: C.slate, color: C.ice, border: `1px solid ${C.line}`, display: "inline-flex",
  alignItems: "center", justifyContent: "center", gap: 6, WebkitTapHighlightColor: "transparent" };

// ---- Formatters & validation ----------------------------------------------
const fmtPhone = (v) => {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
};
const fmtCard = (v) => v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
const fmtExp = (v) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0,2)}/${d.slice(2)}`;
};
const validators = {
  name: (v) => v.trim().length >= 2 || "Enter your full name",
  phone: (v) => v.replace(/\D/g, "").length === 10 || "Enter a 10-digit phone",
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || "Enter a valid email",
  card: (v) => v.replace(/\D/g, "").length === 16 || "Enter a 16-digit card",
  exp: (v) => /^\d{2}\/\d{2}$/.test(v) || "MM/YY",
  cvc: (v) => /^\d{3,4}$/.test(v) || "3–4 digits",
  addr: (v) => v.trim().length >= 6 || "Enter a street address",
};

// ---- Field: label, formatting, live validation, focus glow ----------------
function Field({ label, value, onChange, placeholder, validate, format, inputMode, icon, autoFocus, onValid }) {
  const [touched, setTouched] = useState(false);
  const [focus, setFocus] = useState(false);
  const res = validate ? validate(value) : true;
  const valid = res === true;
  const showErr = touched && !focus && value.length > 0 && !valid;
  const showOk = valid && value.length > 0;
  useEffect(() => { onValid && onValid(valid); }, [valid]);
  return (
    <div>
      {label && <div style={{ font: `600 12px ${FB}`, color: C.mist, marginBottom: 6 }}>{label}</div>}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {icon && <span style={{ position: "absolute", left: 12, fontSize: 15, opacity: .8 }}>{icon}</span>}
        <input
          value={value} inputMode={inputMode} autoFocus={autoFocus}
          onChange={(e) => onChange(format ? format(e.target.value) : e.target.value)}
          onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setTouched(true); }}
          placeholder={placeholder}
          style={{
            width: "100%", background: C.slate, color: C.ice, font: `500 15px ${FB}`, outline: "none",
            padding: icon ? "13px 38px 13px 36px" : "13px 38px 13px 13px", borderRadius: 11,
            border: `1px solid ${showErr ? C.danger : focus ? C.amber : C.line}`,
            boxShadow: focus ? `0 0 0 3px ${C.amber}22` : showErr ? `0 0 0 3px ${C.danger}22` : "none",
            transition: "border-color .15s, box-shadow .15s",
          }} />
        {showOk && <span style={{ position: "absolute", right: 13, color: C.push, fontSize: 15, animation: "pop .2s ease" }}>✓</span>}
        {showErr && <span style={{ position: "absolute", right: 13, color: C.danger, fontSize: 15 }}>!</span>}
      </div>
      <div style={{ height: showErr ? 18 : 0, overflow: "hidden", transition: "height .18s" }}>
        <span style={{ font: `500 11px ${FB}`, color: C.danger }}>{showErr ? res : ""}</span>
      </div>
    </div>
  );
}

// ---- Animated view wrapper (fade+slide on mount) --------------------------
function Fade({ children, k, style, dir = "up" }) {
  const off = dir === "up" ? "translateY(10px)" : dir === "right" ? "translateX(16px)" : "translateX(-16px)";
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, [k]);
  return (
    <div key={k} style={{
      opacity: on ? 1 : 0, transform: on ? "none" : off,
      transition: "opacity .32s ease, transform .32s cubic-bezier(.22,1,.36,1)", ...style,
    }}>{children}</div>
  );
}

// ---- Stepper dots ----------------------------------------------------------
function Steps({ n, i }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {Array.from({ length: n }).map((_, k) => (
        <div key={k} style={{
          height: 4, borderRadius: 4, flex: k === i ? 2.2 : 1,
          background: k < i ? C.push : k === i ? C.amber : C.line,
          transition: "flex .3s ease, background .3s",
        }} />
      ))}
    </div>
  );
}

// ---- Count-up number (for prices) -----------------------------------------
function useCountUp(target, ms = 500) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = target;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(a + (b - a) * e));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

// ============================================================
// MAP LAYER
// ------------------------------------------------------------
// The app renders maps through ONE component (<StormMap/>) and one satellite
// canvas (<PropertyDesigner/>). Both consume normalized props, so swapping the
// demo renderer for a real provider is a contained change.
//
// PRODUCTION SWAP — set MAP_PROVIDER and implement the adapter:
//
//   "google"  → Maps JavaScript API + Places + Drawing + Geometry libs
//               • satellite: mapTypeId: 'satellite', tilt: 0
//               • polygons:  google.maps.drawing.DrawingManager
//               • area:      google.maps.geometry.spherical.computeArea(path)
//                            ^ returns m² — multiply by 10.7639 for ft²
//               • grade:     Elevation API over the driveway path; rise/run
//                            gives true slope, replacing our neighborhood guess
//
//   "mapbox"  → Mapbox GL JS + mapbox-gl-draw + @turf/area
//               • satellite: style 'mapbox://styles/mapbox/satellite-streets-v12'
//               • area:      turf.area(polygon) → m²
//               • cheaper at volume, better offline/vector caching
//
// DULUTH GOTCHA: satellite basemaps are summer imagery. That is a FEATURE for
// outlining (you see pavement, not snow) but it means the customer is drawing
// on a scene that looks nothing like what they see out the window in January.
// Keep the address + street-view thumbnail visible so they can orient.
//
// GPS DRIFT: in heavy snow, phone GPS on the hillside can drift 30–50m. For
// driver tracking, smooth positions (Kalman or simple moving average), snap to
// road geometry, and never auto-fire "arrived" on raw GPS alone — require the
// driver's tap plus the before-photo, which is what this app already does.
// ============================================================
const MAP_PROVIDER = "demo"; // "demo" | "google" | "mapbox"

// Normalized lat/lng → screen projection for the demo renderer.
// A real provider handles this internally; we fake it so blips can be driven
// by the same {lat,lng} data shape the production adapter will emit.
const DULUTH_CENTER = { lat: 46.7900, lng: -92.0900 };
const DEMO_SPAN = { lat: 0.115, lng: 0.20 }; // visible window (fits Lincoln Pk → Lakeside)
function projectToDemo(lat, lng) {
  const x = ((lng - (DULUTH_CENTER.lng - DEMO_SPAN.lng / 2)) / DEMO_SPAN.lng) * 100;
  const y = (((DULUTH_CENTER.lat + DEMO_SPAN.lat / 2) - lat) / DEMO_SPAN.lat) * 100;
  return { x: Math.max(4, Math.min(96, x)), y: Math.max(4, Math.min(96, y)) };
}
function StormMap({ blips = [], pin, selected, tracking, driverPos, height = 1.15, showRoute }) {
  const flakes = useRef(Array.from({ length: 38 }, () => ({
    x: Math.random()*100, y: Math.random()*100, s: .5+Math.random()*1.5, d: .3+Math.random()*.7 })) ).current;
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      flakes.forEach(f => { f.y += f.d; f.x += Math.sin(f.y/12)*.15; if (f.y > 102) { f.y = -2; f.x = Math.random()*100; } });
      force(n => n+1);
    }, 70);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: String(height),
      background: `radial-gradient(120% 90% at 50% -10%, #12253C 0%, ${C.night} 70%)`,
      borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}` }}>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: .22 }}>
        <defs><pattern id="g" width="34" height="34" patternUnits="userSpaceOnUse">
          <path d="M34 0H0V34" fill="none" stroke={C.line} strokeWidth="1" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#g)" />
      </svg>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Lake Superior — Duluth's defining edge, runs SW→NE along the shore */}
        <path d="M100 42 L100 100 L38 100 Q58 76 78 58 Q88 49 100 42 Z"
          fill="#0C2237" stroke="#1B4763" strokeWidth="0.8" opacity=".95" />
        <text x="82" y="88" fill="#2E5F7E" fontSize="4.2" fontFamily="Inter, sans-serif"
          fontWeight="700" letterSpacing="0.6" opacity=".85">LAKE SUPERIOR</text>

        {/* the hillside ridge — Skyline Pkwy traces the top of the escarpment */}
        <path d="M0 22 Q26 20 48 30 T100 18" stroke="#2A4A66" strokeWidth="1.4" fill="none"
          strokeDasharray="4 3" opacity=".7" />

        {/* arterials running parallel to the shore */}
        <path d="M0 52 Q30 46 55 58 Q75 68 100 62" stroke={C.line} strokeWidth="2.6" fill="none" opacity=".65" />
        <path d="M0 40 Q32 35 58 47 Q78 57 100 50" stroke={C.line} strokeWidth="1.8" fill="none" opacity=".5" />
        {/* cross streets climbing the hill */}
        <path d="M22 8 L34 78" stroke={C.line} strokeWidth="1.5" fill="none" opacity=".45" />
        <path d="M46 6 L56 70" stroke={C.line} strokeWidth="1.5" fill="none" opacity=".45" />
        <path d="M70 4 L78 58" stroke={C.line} strokeWidth="1.3" fill="none" opacity=".38" />

        {showRoute && driverPos && (
          <line x1={driverPos.x} y1={driverPos.y} x2="50" y2="50" stroke={C.amber} strokeWidth="1.2"
            strokeDasharray="3 2" opacity=".8" />
        )}
      </svg>
      {flakes.map((f, i) => <div key={i} style={{ position: "absolute", left: `${f.x}%`, top: `${f.y}%`,
        width: f.s*2.4, height: f.s*2.4, borderRadius: "50%", background: "rgba(234,243,251,.65)", pointerEvents: "none" }} />)}
      {pin && (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-100%)", textAlign: "center" }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: C.amber, border: "3px solid #20140A",
            margin: "0 auto", boxShadow: "0 0 0 6px rgba(255,176,32,.2)" }} />
          <div style={{ font: `700 10px ${FB}`, color: C.amber, marginTop: 4, letterSpacing: ".1em" }}>{pin === true ? "YOU" : pin}</div>
        </div>
      )}
      {blips.map((d, idx) => {
        // accept either screen coords (demo) or real {lat,lng} (production shape)
        const base = d.lat != null && d.lng != null ? projectToDemo(d.lat, d.lng) : { x: d.x, y: d.y };
        const pos = tracking && selected && d.id === selected.id ? driverPos : base;
        const isSel = selected && selected.id === d.id;
        return (
          <div key={d.id || idx} onClick={d.onClick} style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`,
            transform: "translate(-50%,-50%)", cursor: d.onClick ? "pointer" : "default",
            transition: tracking ? "left 1s linear, top 1s linear" : "none" }}>
            {isSel && <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: `2px solid ${C.amber}`,
              animation: "ping 1.4s ease-out infinite" }} />}
            <div style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center",
              background: isSel ? C.amber : C.night2, border: `2px solid ${isSel ? "#20140A" : C.line}`, fontSize: 15,
              boxShadow: isSel ? "0 6px 18px rgba(255,176,32,.4)" : "0 4px 12px rgba(0,0,0,.4)" }}>🛻</div>
          </div>
        );
      })}
      <style>{`@keyframes ping{0%{transform:scale(1);opacity:.9}100%{transform:scale(2.4);opacity:0}}`}</style>
    </div>
  );
}

// ---- Property designer (satellite outline) ---------------------------------
const tabStyle = (active, col) => ({ font: `700 12px ${FB}`, padding: "9px 14px", borderRadius: 9, cursor: "pointer",
  background: active ? col + "22" : C.night2, color: active ? col : C.mist, border: `1px solid ${active ? col : C.line}` });

function PropertyDesigner({ onDone, existing, compact }) {
  // LOCKED TWO-PHASE FLOW: phase 0 = plow areas, phase 1 = push-to areas.
  // No mode toggle — you can't accidentally draw the wrong kind of zone.
  const [phase, setPhase] = useState(0);
  const [zones, setZones] = useState(existing || []);
  const [draft, setDraft] = useState([]);
  const [nearFirst, setNearFirst] = useState(false);
  const svgRef = useRef();

  const VB_W = 150, VB_H = 100;
  const mode = phase === 0 ? "plow" : "push";
  const col = phase === 0 ? C.plow : C.push;

  // EXACT screen->SVG mapping. Uses the SVG's own matrix so it is correct
  // regardless of preserveAspectRatio, borders, or container rounding.
  const toVB = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const cx = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const cy = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;
    const m = svg.getScreenCTM && svg.getScreenCTM();
    if (m && svg.createSVGPoint) {
      const pt = svg.createSVGPoint();
      pt.x = cx; pt.y = cy;
      const p = pt.matrixTransform(m.inverse());
      return { x: +p.x.toFixed(1), y: +p.y.toFixed(1) };
    }
    const r = svg.getBoundingClientRect(); // fallback
    return { x: +(((cx - r.left) / r.width) * VB_W).toFixed(1), y: +(((cy - r.top) / r.height) * VB_H).toFixed(1) };
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const poly = pts => pts.map(p => `${p.x},${p.y}`).join(" ");

  // commit a finished shape. `_n: true` is stamped HERE (not on save) so the
  // renderer never mistakes a fresh zone for legacy 0-100 data and rescales it.
  const commit = (pts) => {
    if (pts.length > 2) setZones(z => [...z, { mode, pts, _n: true }]);
    setDraft([]); setNearFirst(false);
  };
  const tap = (e) => {
    const p = toVB(e);
    if (draft.length >= 3 && dist(p, draft[0]) < 6) { commit(draft); return; }
    setDraft(d => [...d, p]);
  };

  const zonesOf = (m) => zones.filter(z => z.mode === m);
  const plowSqFt = zonesToSqFt(zones);
  const q = areaQuote(plowSqFt);
  const animPrice = useCountUp(q.riderTotal, 320);
  const animSqft = useCountUp(plowSqFt, 320);
  const hasPlow = plowSqFt > 0;

  // advancing auto-commits any open shape so nothing is silently lost
  const next = () => { if (draft.length > 2) commit(draft); else { setDraft([]); } setPhase(1); };
  const back = () => { setDraft([]); setNearFirst(false); setPhase(0); };
  const save = () => { const all = draft.length > 2 ? [...zones, { mode, pts: draft, _n: true }] : zones; onDone(all); };

  const canAdvance = phase === 0 ? (zonesOf("plow").length > 0 || draft.length > 2) : true;

  return (
    <div>
      {/* phase header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: col + "22", border: `1.5px solid ${col}`,
          display: "grid", placeItems: "center", font: `800 13px ${FB}`, color: col, flexShrink: 0 }}>{phase + 1}</div>
        <div style={{ flex: 1 }}>
          <div style={{ font: `700 15px ${FB}`, color: C.ice }}>
            {phase === 0 ? "Where should we plow?" : "Where should the snow go?"}</div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 1 }}>
            {phase === 0 ? "Step 1 of 2 · this sets your price" : "Step 2 of 2 · keeps snow off what matters"}</div>
        </div>
        <Steps n={2} i={phase} />
      </div>

      {/* single live instruction */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, minHeight: 18 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: col, flexShrink: 0 }} />
        <span style={{ font: `600 12px ${FB}`, color: nearFirst ? col : C.mist }}>
          {draft.length === 0
            ? (zonesOf(mode).length ? "Add another area, or continue." : "Tap each corner of the area.")
            : draft.length < 3 ? `Keep going — ${3 - draft.length} more corner${3 - draft.length > 1 ? "s" : ""}.`
            : nearFirst ? "Release here to close the shape ✓"
            : "Tap the pulsing dot to finish this shape."}
        </span>
      </div>

      <div style={{ position: "relative", borderRadius: 14, overflow: "hidden",
        border: `1.5px solid ${draft.length ? col : C.line}`, transition: "border-color .2s" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg,#2c3a2a,#38472f 40%,#2a3526)" }} />
        <svg ref={svgRef} onClick={tap}
          onMouseMove={(e) => { if (draft.length >= 3) setNearFirst(dist(toVB(e), draft[0]) < 6); }}
          onMouseLeave={() => setNearFirst(false)}
          viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet"
          style={{ position: "relative", width: "100%", aspectRatio: compact ? "1.9" : "1.5", display: "block", cursor: "crosshair", touchAction: "manipulation" }}>
          <rect x="57" y="20" width="36" height="18" rx="1" fill="#5a4634" stroke="#33281d" strokeWidth=".5" />
          <rect x="70" y="38" width="12" height="42" fill="#4b4b52" opacity=".85" />
          <rect x="18" y="72" width="114" height="9" fill="#3a3a40" opacity=".7" />
          <circle cx="36" cy="30" r="7" fill="#2f4a2c" /><circle cx="112" cy="52" r="6" fill="#2f4a2c" />
          <circle cx="126" cy="26" r="5" fill="#2f4a2c" />

          {/* committed zones. Legacy (seed) data is 0-100 on x and lacks _n. */}
          {zones.map((z, i) => {
            const zc = z.mode === "plow" ? C.plow : C.push;
            const legacy = !z._n && Math.max(...z.pts.map(p => p.x)) <= 100;
            const pts = legacy ? z.pts.map(p => ({ x: p.x * 1.5, y: p.y })) : z.pts;
            const dim = z.mode !== mode; // previous phase's zones fade back
            return (
              <g key={i} opacity={dim ? 0.45 : 1}>
                <polygon points={poly(pts)} fill={zc + (dim ? "22" : "3A")} stroke={zc} strokeWidth={dim ? 0.8 : 1.1} strokeLinejoin="round" />
                {!dim && pts.map((p, j) => <circle key={j} cx={p.x} cy={p.y} r="1.3" fill={zc} />)}
              </g>
            );
          })}

          {/* in-progress: always rendered as a closed shape so it reads clearly */}
          {draft.length > 0 && (
            <g>
              {draft.length >= 2 && <polygon points={poly(draft)} fill={col + "26"} stroke={col} strokeWidth="1.1"
                strokeLinejoin="round" strokeDasharray={draft.length >= 3 ? "none" : "3 2"} />}
              {draft.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? (nearFirst ? 3.6 : 2.6) : 1.7}
                  fill={i === 0 ? col : "#0A1626"} stroke={col} strokeWidth={i === 0 ? 1.4 : 1.1}
                  style={{ transition: "r .12s" }} />
              ))}
              {draft.length >= 3 && (
                <circle cx={draft[0].x} cy={draft[0].y} r="4.5" fill="none" stroke={col} strokeWidth="0.8">
                  <animate attributeName="r" values="3.2;5.8;3.2" dur="1.3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values=".8;0;.8" dur="1.3s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          )}
        </svg>

        {/* live price chip — only meaningful in the plow phase */}
        {phase === 0 && (
          <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(10,22,38,.85)", backdropFilter: "blur(6px)",
            border: `1px solid ${hasPlow ? C.amber : C.line}`, borderRadius: 12, padding: "8px 12px", textAlign: "right", transition: "border-color .2s" }}>
            <div style={{ font: `700 22px ${FD}`, color: hasPlow ? C.amber : C.mistDim, lineHeight: 1 }}>{hasPlow ? `$${animPrice}` : "—"}</div>
            <div style={{ font: `600 10px ${FB}`, color: C.mist, marginTop: 3 }}>{hasPlow ? `${animSqft.toLocaleString()} sq ft` : "outline to price"}</div>
          </div>
        )}

        {/* on-canvas controls */}
        <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {draft.length >= 3 && (
            <button onClick={() => commit(draft)} style={{ ...canvasBtn, background: col, color: "#0A1626", border: "none", fontWeight: 800 }}>
              ✓ Finish shape</button>
          )}
          {draft.length > 0 && <button onClick={() => setDraft(d => d.slice(0, -1))} style={canvasBtn}>↶ Undo point</button>}
          {draft.length === 0 && zonesOf(mode).length > 0 && (
            <button onClick={() => { const last = [...zones].reverse().find(z => z.mode === mode);
              setZones(z => z.filter(x => x !== last)); }} style={canvasBtn}>↶ Remove last area</button>
          )}
        </div>
      </div>

      {/* what's locked in so far */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <Chip color={phase === 0 ? C.plow : C.mistDim}>
          {zonesOf("plow").length} plow area{zonesOf("plow").length !== 1 ? "s" : ""}{phase > 0 ? " · locked" : ""}</Chip>
        <Chip color={phase === 1 ? C.push : C.mistDim}>{zonesOf("push").length} push area{zonesOf("push").length !== 1 ? "s" : ""}</Chip>
        {phase === 1 && <Chip color={C.mistDim}>Anything unmarked is left untouched</Chip>}
      </div>

      {/* price breakdown (plow phase) */}
      {phase === 0 && hasPlow && (
        <div style={{ marginTop: 12, background: C.night2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
          <Row label="Base service fee" value={`$${PRICING.base}`} />
          <Row label={`${plowSqFt.toLocaleString()} sq ft × $${PRICING.perSqFt.toFixed(2)}`} value={`$${Math.round(plowSqFt * PRICING.perSqFt)}`} />
          <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
          <Row label="Your price per plow" value={`$${q.riderTotal}`} big />
        </div>
      )}

      {/* footer nav */}
      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        {phase === 1 && <Btn kind="dark" onClick={back}>‹ Back</Btn>}
        {phase === 0 ? (
          <Btn full onClick={next} disabled={!canAdvance}>
            {canAdvance ? "Next · where to push snow ›" : "Outline a plow area first"}
          </Btn>
        ) : (
          <Btn full onClick={save}>Save property · ${q.riderTotal} per plow</Btn>
        )}
      </div>
      {phase === 1 && zonesOf("push").length === 0 && draft.length === 0 && (
        <button onClick={save} style={{ width: "100%", marginTop: 8, background: "transparent", border: "none",
          color: C.mistDim, font: `600 12px ${FB}`, cursor: "pointer", padding: 8 }}>
          Skip — driver picks a safe spot
        </button>
      )}
    </div>
  );
}
const canvasBtn = { font: `600 11px ${FB}`, padding: "8px 12px", borderRadius: 9, cursor: "pointer",
  background: "rgba(10,22,38,.88)", backdropFilter: "blur(6px)", color: C.ice, border: `1px solid ${C.line}` };

// small read-only property thumbnail
function PropertyThumb({ zones, img }) {
  if (img) return (
    <div style={{ width: 58, height: 40, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.line}`, flexShrink: 0 }}>
      <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  );
  const poly = pts => pts.map(p => `${p.x},${p.y}`).join(" ");
  const norm = (z) => {
    const legacy = Math.max(...z.pts.map(p => p.x)) <= 100 && !z._n;
    return legacy ? z.pts.map(p => ({ x: p.x * 1.5, y: p.y })) : z.pts;
  };
  return (
    <div style={{ width: 58, height: 40, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.line}`, flexShrink: 0 }}>
      <div style={{ position: "relative", width: "100%", height: "100%", background: "linear-gradient(115deg,#2c3a2a,#38472f)" }}>
        <svg viewBox="0 0 150 100" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <rect x="57" y="20" width="36" height="18" fill="#5a4634" />
          {zones?.map((z, i) => <polygon key={i} points={poly(norm(z))} fill={(z.mode === "plow" ? C.plow : C.push) + "55"}
            stroke={z.mode === "plow" ? C.plow : C.push} strokeWidth="2" />)}
        </svg>
      </div>
    </div>
  );
}

// bottom nav
function TabBar({ tabs, active, onChange }) {
  return (
    <nav style={{ position: "sticky", bottom: 0, display: "flex", gap: 4,
      background: "rgba(14,30,49,.92)", backdropFilter: "blur(16px)",
      borderTop: `1px solid ${C.line}`, zIndex: 20,
      padding: `6px ${S.sm}px calc(6px + env(safe-area-inset-bottom))` }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{ flex: 1, background: "transparent", border: "none",
            cursor: "pointer", minHeight: 54, padding: "6px 2px", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 3, position: "relative",
            WebkitTapHighlightColor: "transparent" }}>
            <div style={{ position: "absolute", top: 2, width: 44, height: 30, borderRadius: 10,
              background: on ? C.amber + "1C" : "transparent", transition: `background .25s ${EASE}` }} />
            <span style={{ fontSize: 19, position: "relative", zIndex: 1,
              filter: on ? "none" : "grayscale(1) opacity(.5)",
              transform: on ? "translateY(-1px) scale(1.06)" : "none",
              transition: `transform .25s ${EASE}, filter .25s` }}>{t.icon}</span>
            <span style={{ font: `700 10px ${FB}`, color: on ? C.amber : C.mistDim,
              transition: "color .25s", position: "relative", zIndex: 1 }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// toast
function Toast({ msg }) {
  if (!msg) return null;
  return <div style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", zIndex: 80,
    background: "rgba(27,51,78,.97)", backdropFilter: "blur(12px)", border: `1px solid ${C.line}`, color: C.ice,
    font: `600 13px/1.4 ${FB}`, padding: "13px 18px", borderRadius: 14, boxShadow: E.high, maxWidth: 340,
    display: "flex", alignItems: "center", gap: 10, animation: `toastIn .34s ${EASE}` }}>
    <span style={{ fontSize: 15, flexShrink: 0 }}>❄️</span>{msg}</div>;
}
// ============================================================
// ONBOARDING — guided, sub-60-second first-time setup
// ============================================================
// ============================================================
// GEOCODING LAYER
// ------------------------------------------------------------
// PRODUCTION SWAP: only `geocode()` and `locateMe()` touch address data.
// Replace their bodies with Google Places Autocomplete or Mapbox Geocoding
// and the rest of the app is unchanged — everything downstream consumes the
// same normalized shape: { id, line1, city, state, zip, lat, lng, hood }.
// ============================================================

// Duluth rises ~800ft from the lake in about a mile, so neighborhood is a
// strong predictor of driveway grade. We use it to PRE-FILL the pricing
// modifier instead of making the customer guess.
const HOODS = {
  hillside:    { label: "Hillside",      grade: "steep",    note: "Steep grade · ice-prone" },
  chester:     { label: "Chester Park",  grade: "steep",    note: "Steep grade" },
  congdon:     { label: "Congdon Park",  grade: "moderate", note: "Rolling terrain" },
  woodland:    { label: "Woodland",      grade: "moderate", note: "Rolling terrain" },
  kenwood:     { label: "Kenwood",       grade: "moderate", note: "Rolling terrain" },
  piedmont:    { label: "Piedmont",      grade: "steep",    note: "Steep grade" },
  heights:     { label: "Duluth Heights", grade: "moderate", note: "Upper plateau" },
  lakeside:    { label: "Lakeside",      grade: "moderate", note: "Lake-effect belt" },
  lincoln:     { label: "Lincoln Park",  grade: "moderate", note: "West hillside" },
  downtown:    { label: "Downtown",      grade: "flat",     note: "Flat · commercial" },
  parkpoint:   { label: "Park Point",    grade: "flat",     note: "Flat · sand spit" },
  endion:      { label: "Endion",        grade: "moderate", note: "Near lake" },
};

// A realistic Duluth street sample. In production this comes from the
// autocomplete provider; the shape is identical.
const ADDRESS_DB = [
  { n: "1420", st: "Woodland Ave",     zip: "55803", hood: "woodland",  lat: 46.8203, lng: -92.0794 },
  { n: "2115", st: "Woodland Ave",     zip: "55803", hood: "woodland",  lat: 46.8256, lng: -92.0781 },
  { n: "1418", st: "E 4th St",         zip: "55805", hood: "hillside",  lat: 46.7902, lng: -92.0902 },
  { n: "824",  st: "E 5th St",         zip: "55805", hood: "hillside",  lat: 46.7891, lng: -92.0967 },
  { n: "1310", st: "E 8th St",         zip: "55805", hood: "chester",   lat: 46.7935, lng: -92.0921 },
  { n: "2201", st: "London Rd",        zip: "55812", hood: "endion",    lat: 46.8021, lng: -92.0724 },
  { n: "3410", st: "London Rd",        zip: "55804", hood: "lakeside",  lat: 46.8168, lng: -92.0448 },
  { n: "4520", st: "London Rd",        zip: "55804", hood: "lakeside",  lat: 46.8290, lng: -92.0221 },
  { n: "31",   st: "W Superior St",    zip: "55802", hood: "downtown",  lat: 46.7825, lng: -92.1013 },
  { n: "402",  st: "W Superior St",    zip: "55802", hood: "downtown",  lat: 46.7808, lng: -92.1052 },
  { n: "1201", st: "E Superior St",    zip: "55805", hood: "endion",    lat: 46.7938, lng: -92.0836 },
  { n: "2630", st: "Piedmont Ave",     zip: "55811", hood: "piedmont",  lat: 46.7745, lng: -92.1436 },
  { n: "1815", st: "Kenwood Ave",      zip: "55811", hood: "kenwood",   lat: 46.8145, lng: -92.1075 },
  { n: "920",  st: "Arrowhead Rd",     zip: "55811", hood: "kenwood",   lat: 46.8221, lng: -92.1128 },
  { n: "1425", st: "Arrowhead Rd",     zip: "55811", hood: "heights",   lat: 46.8235, lng: -92.1210 },
  { n: "310",  st: "Skyline Pkwy",     zip: "55805", hood: "hillside",  lat: 46.7960, lng: -92.1005 },
  { n: "2114", st: "W 3rd St",         zip: "55806", hood: "lincoln",   lat: 46.7671, lng: -92.1291 },
  { n: "1902", st: "Grand Ave",        zip: "55806", hood: "lincoln",   lat: 46.7398, lng: -92.1584 },
  { n: "5230", st: "Glenwood St",      zip: "55804", hood: "lakeside",  lat: 46.8343, lng: -92.0189 },
  { n: "1130", st: "Rice Lake Rd",     zip: "55811", hood: "heights",   lat: 46.8322, lng: -92.1102 },
  { n: "2727", st: "Minnesota Ave",    zip: "55802", hood: "parkpoint", lat: 46.7512, lng: -92.0801 },
  { n: "1615", st: "Vermilion Rd",     zip: "55812", hood: "congdon",   lat: 46.8098, lng: -92.0637 },
  { n: "2340", st: "E Superior St",    zip: "55812", hood: "congdon",   lat: 46.8055, lng: -92.0688 },
  { n: "615",  st: "Chester Park Dr",  zip: "55812", hood: "chester",   lat: 46.7988, lng: -92.0873 },
];

function normalizeAddr(r, i) {
  const hood = HOODS[r.hood];
  return {
    id: `a${i}`, line1: `${r.n} ${r.st}`, city: "Duluth", state: "MN", zip: r.zip,
    full: `${r.n} ${r.st}, Duluth, MN ${r.zip}`,
    lat: r.lat, lng: r.lng, hood: r.hood,
    hoodLabel: hood.label, gradeHint: hood.grade, hoodNote: hood.note,
  };
}

// fuzzy-ish scoring: prefix on house number, substring on street, hood match
function geocode(query, limit = 5) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const toks = q.split(/\s+/);
  return ADDRESS_DB.map(normalizeAddr)
    .map(a => {
      const hay = `${a.line1} ${a.hoodLabel} ${a.zip}`.toLowerCase();
      let score = 0;
      toks.forEach(t => {
        if (hay.startsWith(t)) score += 6;
        else if (hay.includes(t)) score += 3;
        if (a.line1.toLowerCase().split(" ").some(w => w.startsWith(t))) score += 2;
      });
      return { a, score };
    })
    .filter(x => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(x => x.a);
}

// PRODUCTION: navigator.geolocation.getCurrentPosition + reverse geocode
function locateMe() {
  return new Promise(res => setTimeout(() => res(normalizeAddr(ADDRESS_DB[0], 0)), 700));
}

// ambient drifting snow for the hero
function HeroSnow() {
  const flakes = useRef(Array.from({ length: 26 }, (_, i) => ({
    x: Math.random() * 100, d: 3 + Math.random() * 4, delay: -Math.random() * 6,
    s: 1.5 + Math.random() * 2.5, o: .3 + Math.random() * .5,
  }))).current;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {flakes.map((f, i) => (
        <div key={i} style={{ position: "absolute", left: `${f.x}%`, top: -8, width: f.s, height: f.s,
          borderRadius: "50%", background: "#fff", opacity: f.o,
          animation: `fall ${f.d}s ${f.delay}s linear infinite` }} />
      ))}
    </div>
  );
}

// ---- Address search with locate-me + terrain read -------------------------
function AddressSearch({ value, onChange, picked, onPick, compact }) {
  const [locating, setLocating] = useState(false);
  const [focused, setFocused] = useState(false);
  const results = useMemo(() => (picked ? [] : geocode(value)), [value, picked]);

  const useMyLocation = async () => {
    setLocating(true);
    const a = await locateMe();
    setLocating(false);
    onPick(a);
  };

  return (
    <div>
      <Field icon="📍" value={value} onChange={onChange} placeholder="Street address"
        autoFocus={!compact} />

      {/* locate me */}
      {!picked && (
        <button onClick={useMyLocation} disabled={locating}
          style={{ width: "100%", marginTop: 8, display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px", borderRadius: 12, minHeight: TAP, cursor: "pointer", textAlign: "left",
            background: C.night2, border: `1px solid ${C.line}`, WebkitTapHighlightColor: "transparent" }}>
          <span style={{ width: 28, height: 28, borderRadius: 9, background: C.plow + "1E", display: "grid",
            placeItems: "center", fontSize: 14, flexShrink: 0 }}>
            {locating ? <span style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${C.plow}44`,
              borderTopColor: C.plow, animation: "spin .7s linear infinite", display: "block" }} /> : "🎯"}</span>
          <span style={{ font: `600 13px ${FB}`, color: locating ? C.mist : C.plow }}>
            {locating ? "Finding you…" : "Use my current location"}</span>
        </button>
      )}

      {/* results */}
      {results.length > 0 && (
        <div style={{ marginTop: 8, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14,
          overflow: "hidden", boxShadow: E.mid }}>
          {results.map((a, i) => (
            <button key={a.id} onClick={() => onPick(a)}
              style={{ display: "flex", gap: 11, alignItems: "center", width: "100%", textAlign: "left",
                cursor: "pointer", background: "transparent", border: "none", minHeight: TAP,
                borderBottom: i < results.length - 1 ? `1px solid ${C.lineSoft}` : "none",
                padding: "12px 14px", WebkitTapHighlightColor: "transparent" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: C.night2, display: "grid",
                placeItems: "center", fontSize: 13, flexShrink: 0 }}>📍</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 14px ${FB}`, color: C.ice }}>{a.line1}</div>
                <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>
                  {a.hoodLabel} · {a.city}, {a.state} {a.zip}</div>
              </div>
              {a.gradeHint !== "flat" && (
                <Chip color={a.gradeHint === "steep" ? C.danger : C.amber}>
                  {a.gradeHint}</Chip>
              )}
            </button>
          ))}
        </div>
      )}

      {/* confirmed address + terrain read */}
      {picked && (
        <div style={{ marginTop: 10, background: C.push + "10", border: `1px solid ${C.push}44`,
          borderRadius: 14, padding: 14, animation: `rise .25s ${EASE}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: C.push, display: "grid",
              placeItems: "center", fontSize: 13, color: "#07240F", fontWeight: 900, flexShrink: 0 }}>✓</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `700 14px ${FB}`, color: C.ice }}>{picked.line1}</div>
              <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 1 }}>
                {picked.city}, {picked.state} {picked.zip}</div>
            </div>
            <button onClick={() => { onChange(""); onPick(null); }}
              style={{ ...miniBtn, minHeight: 32, fontSize: 12 }}>Change</button>
          </div>
          {/* terrain auto-detect */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 10,
            borderTop: `1px solid ${C.push}22` }}>
            <span style={{ fontSize: 14 }}>⛰️</span>
            <div style={{ font: `500 11px/1.45 ${FB}`, color: C.mist }}>
              <b style={{ color: C.ice }}>{picked.hoodLabel}</b> — {picked.hoodNote}. We've pre-set your
              grade to <b style={{ color: C.amber }}>{MODIFIERS.grade[picked.gradeHint].label.toLowerCase()}</b>; you can change it next.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Onboarding() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState(state.userId ? 1 : 0); // signed-in users skip the welcome hero
  const [prop, setProp] = useState(null); // { address, center, features, sqft, mapImg }
  const [profile, setProfile] = useState({ name: "", phone: "", email: "" });
  const [card, setCard] = useState({ num: "", exp: "", cvc: "" });
  const [valid, setValid] = useState({});

  const go = (n) => setStep(n);
  const setV = (k, v) => setValid((s) => ({ ...s, [k]: v }));

  const finish = () => {
    const fp = state.userId ? state.profile : profile; // signed-in users reuse their account details
    const property = {
      id: "p" + Date.now(), label: "Home",
      addr: prop?.address || "Your property",
      lat: prop?.center?.lat, lng: prop?.center?.lng,
      grade: "flat", hazards: [], shared: false,
      size: SIZES[1],
      features: prop?.features || [], sqft: prop?.sqft || 0, center: prop?.center, mapImg: prop?.mapImg,
      zones: [],
    };
    dispatch({ type: "ONBOARD_DONE", profile: fp, property, payment: { brand: "Visa", last4: card.num.replace(/\D/g,"").slice(-4) || "4242" } });
    dispatch({ type: "TOAST", msg: `Welcome${fp?.name ? ", " + fp.name.split(" ")[0] : ""}! You're all set.` });
  };

  const TOTAL = 4;

  return (
    <div style={{ padding: "0 20px", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* progress + back */}
      {step > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 16px" }}>
          <button onClick={() => go(step - 1)} style={{ ...miniBtn, padding: "7px 11px" }}>‹</button>
          <div style={{ flex: 1 }}><Steps n={TOTAL - 1} i={step - 1} /></div>
        </div>
      )}

      {step === 0 && (
        <Fade k="w" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 24 }}>
          {/* ambient hero */}
          <div style={{ position: "relative", height: 190, marginBottom: S.lg, borderRadius: 22, overflow: "hidden",
            background: `radial-gradient(120% 100% at 50% 0%, #16324F 0%, ${C.night} 72%)`, border: `1px solid ${C.line}` }}>
            <HeroSnow />
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 52, filter: "drop-shadow(0 6px 18px rgba(255,176,32,.4))" }}>❄️</div>
                <div style={{ font: `700 13px ${FB}`, letterSpacing: ".3em", color: C.amber, marginTop: 6 }}>DRIFT</div>
              </div>
            </div>
            {/* faux truck ticker */}
            <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
              {["🚜", "🛻", "🚜"].map((e, i) => (
                <span key={i} style={{ fontSize: 15, opacity: .5, animation: `bob 2.4s ${i * .35}s ease-in-out infinite` }}>{e}</span>
              ))}
            </div>
          </div>

          <h1 style={{ font: `700 42px/0.96 ${FD}`, margin: "0 0 10px", textAlign: "center", letterSpacing: ".01em" }}>
            Never shovel<br />again.</h1>
          <p style={{ ...sub, maxWidth: 300, margin: "0 auto 18px", textAlign: "center", fontSize: 15 }}>
            Map your property once. Tap once each storm. A pro clears it exactly how you drew it.
          </p>

          {/* social proof */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: S.xl }}>
            <div style={{ display: "flex" }}>
              {["JM", "SP", "RK"].map((n, i) => (
                <div key={n} style={{ marginLeft: i ? -9 : 0, width: 26, height: 26, borderRadius: "50%",
                  background: [C.amber, C.plow, C.push][i], border: `2px solid ${C.night}`, display: "grid",
                  placeItems: "center", font: `800 9px ${FB}`, color: "#08121F" }}>{n}</div>
              ))}
            </div>
            <div style={{ font: `600 12px ${FB}`, color: C.mist }}>
              <Stars v={5} size={11} /> <span style={{ color: C.ice }}>4.9</span> · 2,400+ Duluth driveways
            </div>
          </div>

          <Btn full onClick={() => go(1)}>Get started</Btn>
          <button onClick={() => dispatch({ type: "ROLE", role: "driver" })}
            style={{ width: "100%", marginTop: S.md, background: "transparent", border: "none", cursor: "pointer",
              color: C.mist, font: `600 14px ${FB}`, padding: 12, WebkitTapHighlightColor: "transparent" }}>
            I want to plow &amp; earn →
          </button>
          <p style={{ font: `500 12px ${FB}`, color: C.mistDim, marginTop: 4, textAlign: "center" }}>
            Setup takes about a minute · no commitment
          </p>
        </Fade>
      )}

      {step === 1 && (
        <Fade k="map">
          <Eyebrow>Step 1 · Map your property</Eyebrow>
          <h2 style={h2}>Draw what needs clearing</h2>
          <p style={sub}>Search your address, then outline the plow &amp; push zones right on the satellite image. We measure it and set the price automatically.</p>
          <div style={{ height: 14 }} />
          <MapPropertyDesigner existing={prop} saveLabel="Continue"
            onQuote={(sqft) => quoteJob({ jobType: "driveway", sqft }).riderTotal}
            onDone={(data) => { setProp(data); go(state.userId ? 3 : 2); }} />
        </Fade>
      )}

      {step === 2 && (
        <Fade k="c">
          <Eyebrow>Step 2 · Contact</Eyebrow>
          <h2 style={h2}>Who's it for?</h2>
          <p style={sub}>So your driver can reach you and you get updates.</p>
          <div style={{ display: "grid", gap: 12, margin: "16px 0" }}>
            <Field label="Full name" icon="👤" value={profile.name} autoFocus
              onChange={(v) => setProfile(p => ({ ...p, name: v }))} validate={validators.name}
              placeholder="Jane Doe" onValid={(v) => setV("name", v)} />
            <Field label="Phone" icon="📱" value={profile.phone} inputMode="tel" format={fmtPhone}
              onChange={(v) => setProfile(p => ({ ...p, phone: v }))} validate={validators.phone}
              placeholder="(218) 555-0123" onValid={(v) => setV("phone", v)} />
            <Field label="Email" icon="✉️" value={profile.email} inputMode="email"
              onChange={(v) => setProfile(p => ({ ...p, email: v }))} validate={validators.email}
              placeholder="jane@email.com" onValid={(v) => setV("email", v)} />
          </div>
          <div style={{ position: "sticky", bottom: 16 }}>
            <Btn full onClick={() => go(3)} disabled={!(valid.name && valid.phone && valid.email)}>Continue</Btn>
          </div>
        </Fade>
      )}

      {step === 3 && (
        <Fade k="p">
          <Eyebrow>Step 3 · Payment</Eyebrow>
          <h2 style={h2}>Add a card</h2>
          <p style={sub}>You're only charged after a job is done. No storm, no charge.</p>
          {/* live card preview */}
          <div style={{ margin: "16px 0", borderRadius: 16, padding: 18, position: "relative", overflow: "hidden",
            background: "linear-gradient(120deg,#14304d,#0d2138)", border: `1px solid ${C.line}`, minHeight: 130 }}>
            <div style={{ position: "absolute", top: -30, right: -20, width: 120, height: 120, borderRadius: "50%", background: C.amber + "22" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ font: `700 12px ${FB}`, color: C.mist, letterSpacing: ".1em" }}>DRIFT</span>
              <span style={{ fontSize: 20 }}>💳</span>
            </div>
            <div style={{ font: `600 19px ${FB}`, letterSpacing: ".08em", color: C.ice, margin: "22px 0 14px" }}>
              {card.num || "•••• •••• •••• ••••"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", font: `500 12px ${FB}`, color: C.mist }}>
              <span>{profile.name || "YOUR NAME"}</span><span>{card.exp || "MM/YY"}</span>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <Field label="Card number" icon="💳" value={card.num} inputMode="numeric" format={fmtCard}
              onChange={(v) => setCard(c => ({ ...c, num: v }))} validate={validators.card}
              placeholder="4242 4242 4242 4242" onValid={(v) => setV("card", v)} autoFocus />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Expiry" value={card.exp} inputMode="numeric" format={fmtExp}
                onChange={(v) => setCard(c => ({ ...c, exp: v }))} validate={validators.exp}
                placeholder="MM/YY" onValid={(v) => setV("exp", v)} />
              <Field label="CVC" value={card.cvc} inputMode="numeric"
                onChange={(v) => setCard(c => ({ ...c, cvc: v.replace(/\D/g,"").slice(0,4) }))} validate={validators.cvc}
                placeholder="123" onValid={(v) => setV("cvc", v)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0", font: `500 12px ${FB}`, color: C.mistDim }}>
            <span>🔒</span> Secured by Stripe · we never store your card
          </div>
          <div style={{ position: "sticky", bottom: 16 }}>
            <Btn full onClick={finish} disabled={!(valid.card && valid.exp && valid.cvc)}>Finish setup</Btn>
          </div>
        </Fade>
      )}
    </div>
  );
}

// ============================================================
// RIDER APP
// ============================================================
function RiderApp() {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState("home");
  const [sub, setSub] = useState(null); // e.g. "referral"
  const order = state.order;

  const riderTabs = [
    { id: "home", label: "Plow", icon: "❄️" },
    { id: "props", label: "Properties", icon: "🗺️" },
    { id: "trips", label: "History", icon: "🧾" },
    { id: "account", label: "Account", icon: "👤" },
  ];

  const openTab = (t) => { setSub(null); setTab(t); };

  return (
    <>
      <div style={{ padding: "0 20px", flex: 1 }}>
        {sub === "referral" ? <RiderReferral onBack={() => setSub(null)} />
          : <>
            {tab === "home" && (order && order.state !== "done" ? <RiderTracking /> : <RiderHome go={openTab} />)}
            {tab === "props" && <RiderProperties />}
            {tab === "trips" && <RiderHistory />}
            {tab === "account" && <RiderAccount onReferral={() => setSub("referral")} />}
          </>}
      </div>
      <TabBar tabs={riderTabs} active={tab} onChange={openTab} />
    </>
  );
}

// ---- Duluth 24-hr sidewalk ordinance countdown ----------------------------
// City ordinance requires walks cleared within 24 hrs of snowfall ending.
// This turns a compliance deadline into a one-tap booking.
function OrdinanceCountdown({ onBook }) {
  const DEADLINE_HRS = 24;
  const SNOW_ENDED_HRS_AGO = 6; // storm ended 6 hrs ago in this sim
  const [left, setLeft] = useState((DEADLINE_HRS - SNOW_ENDED_HRS_AGO) * 3600);
  useEffect(() => {
    const t = setInterval(() => setLeft(s => Math.max(0, s - 60)), 1000); // 1s = 1min, for demo
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
  const pct = left / (DEADLINE_HRS * 3600);
  const urgent = h < 6;
  const col = urgent ? C.danger : C.amber;
  return (
    <div style={{ marginBottom: 14, background: `linear-gradient(120deg, ${col}18, ${C.night2})`,
      border: `1.5px solid ${col}55`, borderRadius: 14, padding: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 11 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: col + "26", display: "grid",
          placeItems: "center", fontSize: 19, flexShrink: 0 }}>🧹</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `700 13px ${FB}`, color: C.ice }}>Sidewalk ordinance deadline</div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>
            Duluth requires walks cleared within 24 hrs</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ font: `700 22px ${FD}`, color: col, lineHeight: 1 }}>{h}h {String(m).padStart(2, "0")}m</div>
          <div style={{ font: `600 10px ${FB}`, color: C.mistDim, marginTop: 2 }}>remaining</div>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 6, background: C.night, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: `linear-gradient(90deg,${col},${col}88)`,
          transition: "width 1s linear" }} />
      </div>
      <Btn full sm onClick={onBook}>Clear my sidewalk — stay compliant</Btn>
    </div>
  );
}

// ---- Offline / poor-signal handling ---------------------------------------
// Storms kill cell signal on the hillside. Actions queue locally and sync.
function OfflineBanner() {
  const { state, dispatch } = useStore();
  if (!state.offline) return null;
  return (
    <div style={{ margin: "0 20px 8px", background: C.danger + "18", border: `1px solid ${C.danger}55`,
      borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ fontSize: 14 }}>📡</span>
      <div style={{ flex: 1 }}>
        <div style={{ font: `700 11px ${FB}`, color: C.danger }}>Offline — working from cache</div>
        <div style={{ font: `500 10px ${FB}`, color: C.mist, marginTop: 1 }}>
          {state.queued} action{state.queued !== 1 ? "s" : ""} queued · will sync automatically</div>
      </div>
      <button onClick={() => { dispatch({ type: "OFFLINE", v: false }); dispatch({ type: "TOAST", msg: `Back online — ${state.queued} action${state.queued !== 1 ? "s" : ""} synced` }); }}
        style={{ ...miniBtn, padding: "6px 10px", fontSize: 11 }}>Retry</button>
    </div>
  );
}

// Weather-driven storm banner — active storm vs. incoming forecast, dismissible.
function StormBanner() {
  const [hide, setHide] = useState(false);
  if (hide) return null;
  const depth = SNOW_DEPTH_IN, f = FORECAST;
  const incoming = f && (f.low || f.high);
  if (depth < 3 && !incoming) return null; // nothing worth shouting about
  const active = depth >= 3;
  const accent = active ? C.amber : C.plow;
  const title = active ? `Storm active · ${depth}" down` : "Snow day likely";
  const body = active
    ? "Roads and driveways are rough — book now before the morning rush."
    : `${f.low}–${f.high}" expected ${f.when}. Line up your plow before everyone else does.`;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 14, marginBottom: 14,
      background: `linear-gradient(120deg, ${accent}22, ${C.night2})`, border: `1px solid ${accent}66` }}>
      <div style={{ fontSize: 24, animation: active ? "bob 2.4s ease-in-out infinite" : "none" }}>{active ? "🌨️" : "❄️"}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `700 13px ${FB}`, color: C.ice }}>{title}</div>
        <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2, lineHeight: 1.35 }}>{body}</div>
      </div>
      <button onClick={() => setHide(true)} aria-label="Dismiss" style={{ background: "none", border: "none",
        color: C.mistDim, fontSize: 20, cursor: "pointer", padding: 4, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>×</button>
    </div>
  );
}

function RiderHome({ go }) {
  const { state, dispatch } = useStore();
  const prop = state.activeProperty;
  const [jobType, setJobType] = useState("driveway");
  const [showSched, setShowSched] = useState(false);
  const [salt, setSalt] = useState(false);
  const [showBreak, setShowBreak] = useState(true); // price breakdown open by default (transparency)
  const [payOpen, setPayOpen] = useState(false);    // Stripe authorization sheet (only when keys are set)

  const sqft = prop?.sqft || zonesToSqFt(prop?.zones);
  // sidewalk length: derive a sensible default from the property, editable later
  const linearFt = prop?.sidewalkFt || 80;
  const q = quoteJob({ jobType, sqft, linearFt, property: prop, salt });
  const animPrice = useCountUp(q.riderTotal);
  const first = state.profile.name ? state.profile.name.split(" ")[0] : null;
  const jt = JOB_TYPES[jobType];
  const needsOutline = (jt.basis === "area") && sqft === 0;
  const modActive = q.mod !== 1;
  const canSalt = SALT.appliesTo.includes(jobType);

  const buildOrder = (extra = {}) => ({
    id: "o" + Date.now(), state: "requested", jobType, size: prop?.size || SIZES[1], property: prop,
    quote: q, tool: q.tool, createdAt: Date.now(), driverPos: { x: state.driver.x, y: state.driver.y },
    eta: 9, timeline: [{ k: "requested", t: "now", label: "Request sent" }],
    photos: { before: [], after: [] }, ...extra,
  });

  const request = () => {
    const order = buildOrder();
    dispatch({ type: "REQUEST", order });
    persistNewJob(dispatch, order, state.userId);
    dispatch({ type: "TOAST", msg: `Request sent — finding a nearby ${q.tool.toLowerCase()}` });
    notify(dispatch, { kind: "job", title: "Request sent", body: `Finding a nearby ${q.tool.toLowerCase()} for ${prop?.label || "your property"}.`, role: "rider" });
    autoMatch(dispatch, state);
  };

  // With Stripe on, authorize the card first; otherwise straight to the demo request.
  const startRequest = () => {
    if (STRIPE_ENABLED) { setPayOpen(true); return; }
    request();
  };
  const onAuthorized = (paymentIntentId) => {
    setPayOpen(false);
    const order = buildOrder({ paymentIntentId });
    dispatch({ type: "REQUEST", order });
    persistNewJob(dispatch, order, state.userId);
    dispatch({ type: "TOAST", msg: `Card authorized — finding a nearby ${q.tool.toLowerCase()}` });
    notify(dispatch, { kind: "job", title: "Card authorized", body: `We'll only charge $${q.riderTotal} once ${prop?.label || "your property"} is plowed.`, role: "rider" });
    autoMatch(dispatch, state);
  };

  // roadside / emergency dispatch — flat-rate, no property zones required
  const requestRoadside = (type) => {
    const rq = quoteJob({ jobType: type, property: prop });
    const rjt = JOB_TYPES[type];
    dispatch({ type: "REQUEST", order: {
      id: "o" + Date.now(), state: "requested", jobType: type, size: prop?.size || SIZES[1], property: prop,
      quote: rq, tool: rq.tool, emergency: true, createdAt: Date.now(),
      driverPos: { x: state.driver.x, y: state.driver.y }, eta: 7,
      timeline: [{ k: "requested", t: "now", label: `${rjt.label} requested` }], photos: { before: [], after: [] },
    }});
    dispatch({ type: "TOAST", msg: `${rjt.label} requested — finding the nearest driver` });
    autoMatch(dispatch, state);
  };

  const schedule = (when, label) => {
    dispatch({ type: "SCHEDULE", job: { id: "s" + Date.now(), when, label, jobType, size: prop?.size || SIZES[1], property: prop, quote: q, tool: q.tool, createdAt: Date.now() } });
    dispatch({ type: "TOAST", msg: `Scheduled ${label.toLowerCase()} · we'll dispatch automatically` });
    setShowSched(false);
    go("trips");
  };

  return (
    <Fade k="home"><section style={{ paddingTop: 4 }}>
      <div style={{ marginBottom: 12 }}>
        <Eyebrow>{first ? `Hi ${first}` : "On-demand snow removal"}</Eyebrow>
        <h1 style={{ font: `700 32px/1 ${FD}`, margin: "8px 0 8px" }}>What needs clearing?</h1>
      </div>

      <StormBanner />

      {/* emergency dispatch — one tap when you're blocked in */}
      {SNOW_DEPTH_IN >= 3 && prop && (
        <button onClick={() => {
            const eq = quoteJob({ jobType: "digout", property: prop });
            dispatch({ type: "REQUEST", order: {
              id: "o" + Date.now(), state: "requested", jobType: "digout", size: prop?.size || SIZES[1], property: prop,
              quote: eq, tool: eq.tool, emergency: true, createdAt: Date.now(),
              driverPos: { x: state.driver.x, y: state.driver.y }, eta: 6,
              timeline: [{ k: "requested", t: "now", label: "Emergency request sent" }], photos: { before: [], after: [] },
            }});
            dispatch({ type: "TOAST", msg: "Emergency dispatch — prioritizing the nearest crew" });
            autoMatch(dispatch, state);
          }}
          style={{ width: "100%", marginBottom: 14, cursor: "pointer", textAlign: "left",
            background: `linear-gradient(120deg, ${C.danger}22, ${C.night2})`, border: `1.5px solid ${C.danger}66`,
            borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: C.danger + "26", display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>🆘</div>
          <div style={{ flex: 1 }}>
            <div style={{ font: `700 14px ${FB}`, color: C.ice }}>Blocked in? Emergency dig-out</div>
            <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>Fastest crew, priority queue · one tap</div>
          </div>
          <span style={{ color: C.danger, fontSize: 18 }}>›</span>
        </button>
      )}

      {/* Duluth 24-hr sidewalk ordinance countdown */}
      {SNOW_DEPTH_IN >= 2 && prop && <OrdinanceCountdown onBook={() => {
        const oq = quoteJob({ jobType: "sidewalk", linearFt, property: prop });
        dispatch({ type: "REQUEST", order: {
          id: "o" + Date.now(), state: "requested", jobType: "sidewalk", size: prop?.size || SIZES[1], property: prop,
          quote: oq, tool: oq.tool, createdAt: Date.now(), driverPos: { x: state.driver.x, y: state.driver.y },
          eta: 9, timeline: [{ k: "requested", t: "now", label: "Sidewalk clearing requested" }], photos: { before: [], after: [] },
        }});
        dispatch({ type: "TOAST", msg: "Sidewalk crew requested — you'll be compliant" });
        autoMatch(dispatch, state);
      }} />}

      {/* SNOW REMOVAL — the main event. Driveway plowing leads. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <Eyebrow>Snow removal</Eyebrow>
        <span style={{ font: `500 11px ${FB}`, color: C.mistDim }}>pick what needs clearing</span>
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
        {Object.values(JOB_TYPES).filter(t => !ROADSIDE.includes(t.id)).map(t => {
          const on = jobType === t.id;
          const hero = t.id === "driveway";
          return (
            <button key={t.id} onClick={() => setJobType(t.id)} style={{ flex: "0 0 auto", cursor: "pointer", position: "relative",
              minWidth: hero ? 128 : 104, padding: "13px 12px", borderRadius: 14, textAlign: "left",
              background: on ? C.amber + "18" : C.slate, border: `1.5px solid ${on ? C.amber : hero ? C.amber + "77" : C.line}`,
              transition: "all .15s" }}>
              {hero && <span style={{ position: "absolute", top: 8, right: 9, font: `800 8px ${FB}`, letterSpacing: ".09em", color: C.push }}>POPULAR</span>}
              <div style={{ fontSize: hero ? 26 : 22, marginBottom: 6 }}>{t.icon}</div>
              <div style={{ font: `700 ${hero ? 13 : 12}px ${FB}`, color: on ? C.amber : C.ice }}>{t.label}</div>
              <div style={{ font: `500 10px ${FB}`, color: C.mist, marginTop: 2 }}>{t.tool}</div>
            </button>
          );
        })}
      </div>

      {/* Roadside jump-start — minor, clearly-secondary add-on */}
      {prop && (
        <button onClick={() => requestRoadside("jumpstart")} style={{ width: "100%", marginBottom: 14, cursor: "pointer",
          textAlign: "left", display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 12,
          background: C.slate, border: `1px solid ${C.line}`, WebkitTapHighlightColor: "transparent" }}>
          <span style={{ fontSize: 18 }}>🔋</span>
          <div style={{ flex: 1, font: `600 12px ${FB}`, color: C.mist }}>Dead battery? Roadside jump-start · flat ${JOB_TYPES.jumpstart.base}</div>
          <span style={{ color: C.mistDim, fontSize: 15 }}>›</span>
        </button>
      )}

      {/* live weather / demand strip */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
        {[["🌨️", `${SNOW_DEPTH_IN}" now`, "lake-effect"], ["⏱️", "~9 min", "nearest crew"], ["🚜", "4 rigs", "in your area"]].map(([i, a, b], k) => (
          <div key={k} style={{ flex: "0 0 auto", display: "flex", gap: 9, alignItems: "center", background: C.slate,
            border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 13px" }}>
            <span style={{ fontSize: 17 }}>{i}</span>
            <div><div style={{ font: `700 12px ${FB}`, color: C.ice }}>{a}</div>
              <div style={{ font: `500 11px ${FB}`, color: C.mist }}>{b}</div></div>
          </div>
        ))}
      </div>

      {MAP_ENABLED && prop?.center ? (
        <LiveMap center={prop.center} height={200} markers={[
          { lng: prop.center.lng, lat: prop.center.lat, emoji: "📍", size: 28 },
          { lng: prop.center.lng + 0.0034, lat: prop.center.lat + 0.0016, emoji: "🛻", size: 20 },
          { lng: prop.center.lng - 0.0041, lat: prop.center.lat - 0.0025, emoji: "🛻", size: 20 },
          { lng: prop.center.lng + 0.0019, lat: prop.center.lat - 0.0037, emoji: "🛻", size: 20 },
        ]} />
      ) : (
        <StormMap pin blips={[{ id: 1, x: 62, y: 38 }, { id: 2, x: 40, y: 61 }, { id: 3, x: 74, y: 66 }]} />
      )}

      {/* property selector */}
      <Card style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }} onClick={() => go("props")}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          {prop ? <PropertyThumb zones={prop.zones} img={prop.mapImg} /> : <span style={{ fontSize: 22 }}>➕</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ font: `700 14px ${FB}` }}>{prop ? prop.label : "Add a property"}</div>
            <div style={{ font: `500 12px ${FB}`, color: C.mist, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {prop ? prop.addr : "Draw your plow & push zones"}</div>
            {prop && modActive && (
              <div style={{ marginTop: 5, display: "flex", gap: 5, flexWrap: "wrap" }}>
                {prop.grade && prop.grade !== "flat" && <Chip color={C.amber}>{MODIFIERS.grade[prop.grade].label}</Chip>}
                {(prop.hazards || []).slice(0, 2).map(h => <Chip key={h} color={C.danger}>{MODIFIERS.hazards[h]?.label}</Chip>)}
              </div>
            )}
          </div>
        </div>
        <span style={{ color: C.mist, fontSize: 18 }}>›</span>
      </Card>

      {/* price card */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>Your price</Eyebrow>
          {jt.basis === "area" && sqft > 0 && <button onClick={() => go("props")} style={{ ...miniBtn, padding: "6px 11px" }}>Edit outline</button>}
        </div>
        <div style={{ marginTop: 10, background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
          {!needsOutline ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
                <div>
                  <div style={{ font: `700 34px ${FD}`, color: C.amber, lineHeight: 1 }}>${animPrice}</div>
                  <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 4 }}>
                    {jt.basis === "area" ? `per job · ${sqft.toLocaleString()} sq ft`
                      : jt.basis === "linear" ? `per job · ~${linearFt} ft of walk`
                      : `flat rate · ${jt.label.toLowerCase()}`}</div>
                </div>
                <span style={{ fontSize: 30 }}>{jt.icon}</span>
              </div>
              <div style={{ height: 1, background: C.line, margin: "4px 0 10px" }} />
              <button onClick={() => setShowBreak(v => !v)} style={{ width: "100%", background: "none", border: "none",
                cursor: "pointer", padding: "2px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between",
                font: `700 12px ${FB}`, color: C.mist, WebkitTapHighlightColor: "transparent" }}>
                <span>How this price is built</span>
                <span style={{ fontSize: 13, transform: showBreak ? "rotate(180deg)" : "none", transition: "transform .2s" }}>⌄</span>
              </button>
              {showBreak && (
                <div style={{ animation: "fadeIn .2s ease" }}>
                  <Row label={`${jt.label} base`} value={`$${jt.base + PLATFORM_FEE}`} />
                  {jt.basis === "area" && <Row label={`${sqft.toLocaleString()} sq ft × $${jt.rate.toFixed(2)}`} value={`$${Math.round(sqft * jt.rate)}`} />}
                  {jt.basis === "linear" && <Row label={`${linearFt} ft × $${jt.rate.toFixed(2)}`} value={`$${Math.round(linearFt * jt.rate)}`} />}
                  {modActive && <Row label={`Property factors ×${q.mod.toFixed(2)}`} value={q.mod > 1 ? "surcharge" : "discount"} amber />}
                  {q.surge && <Row label={`⚡ ${q.surgeLabel} +${Math.round(q.surgePct * 100)}%`} value={`+$${q.surgeFee}`} amber />}
                  {q.salt && <Row label="🧂 Salt / ice-melt add-on" value={`+$${q.saltFee}`} amber />}
                  <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
                  <Row label="You pay" value={`$${q.riderTotal}`} big />
                </div>
              )}
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7, font: `600 12px ${FB}`, color: C.mist }}>
                <span style={{ fontSize: 13 }}>{jt.icon}</span> Sends a <b style={{ color: C.ice }}>{q.tool}</b>{q.salt ? " + salt" : ""} · ~{q.mins} min on site
              </div>
              <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 6, font: `600 11px ${FB}`, color: C.push }}>
                <span style={{ fontSize: 12 }}>✓</span> No contracts · no membership · {q.surge ? "demand surcharge shown above" : "no hidden fees"}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "8px 4px" }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>✏️</div>
              <div style={{ font: `700 14px ${FB}`, marginBottom: 4 }}>Outline the area to see the price</div>
              <div style={{ font: `500 12px ${FB}`, color: C.mist, marginBottom: 12 }}>${jt.base + PLATFORM_FEE} base + ${jt.rate.toFixed(2)} per sq ft.</div>
              <Btn sm onClick={() => go("props")}>Map it</Btn>
            </div>
          )}
        </div>
      </div>

      {/* salt / ice-melt add-on — stacks on the job selected above */}
      {canSalt && prop && !needsOutline && (
        <button onClick={() => setSalt(v => !v)} style={{ width: "100%", marginTop: 14, cursor: "pointer",
          textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 14,
          background: salt ? C.amber + "14" : C.slate, border: `1.5px solid ${salt ? C.amber : C.line}`,
          transition: "all .18s", WebkitTapHighlightColor: "transparent" }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center",
            background: salt ? C.amber + "26" : C.night2, fontSize: 19 }}>🧂</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `700 13px ${FB}`, color: C.ice }}>Add salt / ice-melt</div>
            <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>
              {salt ? "Keeps the cleared surface from re-freezing" : "Prevent re-freeze after we clear it"}</div>
          </div>
          <span style={{ font: `700 13px ${FD}`, color: salt ? C.amber : C.mistDim }}>
            {salt ? `+$${q.saltFee}` : "+15%"}</span>
        </button>
      )}

      <div style={{ position: "sticky", bottom: 14, marginTop: 18, marginBottom: 4, paddingTop: 6,
        background: `linear-gradient(transparent, ${C.night} 30%)` }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn full onClick={startRequest} disabled={!prop || needsOutline}>Clear now · ${animPrice}</Btn>
          <Btn kind="dark" onClick={() => setShowSched(true)} disabled={!prop || needsOutline}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>🗓️</span>
          </Btn>
        </div>
        <p style={{ font: `500 11px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
          One flat price · you're only charged when it's done.
        </p>
      </div>

      {showSched && <ScheduleSheet price={q.riderTotal} onClose={() => setShowSched(false)} onPick={schedule} />}
      {payOpen && <PaymentSheet amount={q.riderTotal} jobId={"pending"} customerId={state.userId || ""}
        onAuthorized={onAuthorized} onClose={() => setPayOpen(false)} />}
    </section></Fade>
  );
}

// ---- Schedule sheet: pick when to plow ------------------------------------
function ScheduleSheet({ onClose, onPick, price }) {
  const days = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(null);
  const SLOTS = [
    { id: "early", label: "Before 7 AM", hint: "Cleared before you leave", h: 6 },
    { id: "am", label: "Morning", hint: "7 AM – 12 PM", h: 9 },
    { id: "noon", label: "Midday", hint: "12 – 4 PM", h: 13 },
    { id: "pm", label: "Evening", hint: "4 – 8 PM", h: 17 },
  ];
  const dayLabel = (d, i) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" });

  const confirm = () => {
    const d = new Date(days[day]);
    const s = SLOTS.find(x => x.id === slot);
    d.setHours(s.h, 0, 0, 0);
    onPick(d.getTime(), `${dayLabel(days[day], day)}, ${s.label}`);
  };

  return (
    <Sheet onClose={onClose}>
      <Eyebrow>Schedule a plow</Eyebrow>
      <h2 style={{ font: `700 26px ${FD}`, margin: "8px 0 16px" }}>When should we come?</h2>

      {/* day picker */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: S.lg }}>
        {days.map((d, i) => (
          <button key={i} onClick={() => setDay(i)} style={{ flex: "0 0 auto", cursor: "pointer",
            padding: "11px 15px", borderRadius: 14, textAlign: "center", minWidth: 66, minHeight: 62,
            background: day === i ? `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})` : C.slate,
            border: `1px solid ${day === i ? C.amber : C.line}`,
            color: day === i ? "#231603" : C.ice, transition: `all .2s ${EASE}`,
            boxShadow: day === i ? "0 4px 14px rgba(255,176,32,.28)" : "none", WebkitTapHighlightColor: "transparent" }}>
            <div style={{ font: `700 11px ${FB}`, opacity: .85 }}>{dayLabel(d, i)}</div>
            <div style={{ font: `700 19px ${FD}`, marginTop: 2 }}>{d.getDate()}</div>
          </button>
        ))}
      </div>

      {/* slots */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: S.lg }}>
        {SLOTS.map(s => (
          <button key={s.id} onClick={() => setSlot(s.id)} style={{ textAlign: "left", cursor: "pointer",
            padding: 15, borderRadius: 14, minHeight: 72,
            background: slot === s.id ? C.amber + "18" : C.slate,
            border: `1.5px solid ${slot === s.id ? C.amber : C.line}`, transition: `all .2s ${EASE}`,
            WebkitTapHighlightColor: "transparent" }}>
            <div style={{ font: `700 14px ${FB}`, color: slot === s.id ? C.amber : C.ice }}>{s.label}</div>
            <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 4 }}>{s.hint}</div>
          </button>
        ))}
      </div>

      <Btn full onClick={confirm} disabled={!slot}>
        {slot ? `Schedule · $${price}` : "Pick a time window"}
      </Btn>
      <p style={{ font: `500 11px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
        We auto-dispatch in your window · only charged after it's plowed.
      </p>
    </Sheet>
  );
}

// simulate driver accepting + driving if no live human driver is online.
// if the driver IS online, leave the job in "requested" so they see the incoming card.
function autoMatch(dispatch, state) {
  if (state.driverOnline) return;
  setTimeout(() => {
    dispatch({ type: "ORDER_STATE", patch: {
      state: "accepted", driver: state.driver, eta: 8,
      timeline: [{ k: "requested", t: "now", label: "Request sent" }, { k: "accepted", t: "now", label: `${state.driver.name} accepted` }],
    }});
    dispatch({ type: "TOAST", msg: `${state.driver.name} is on the way` });
    notify(dispatch, { kind: "job", title: `${state.driver.name} is on the way`,
      body: "Your driver accepted and is heading to your property.", role: "rider" }, state.profile?.phone);
  }, 2400);
}

// ---- Stripe card authorization (real payments, only when keys are set) -----
// Inner form: renders Stripe's PaymentElement and authorizes (not captures) the
// card. Manual capture means the hold is only charged when the job is completed.
function PayForm({ amount, paymentIntentId, onAuthorized, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required", // cards authorize without leaving the app
    });
    if (error) { setErr(error.message || "Card couldn't be authorized"); setBusy(false); return; }
    onAuthorized(paymentIntentId);
  };
  return (
    <div>
      <PaymentElement options={{ layout: "tabs" }} />
      {err && <p style={{ font: `600 12px ${FB}`, color: C.danger, margin: "10px 0 0" }}>{err}</p>}
      <div style={{ marginTop: 16 }}>
        <Btn full onClick={pay} disabled={busy || !stripe}>{busy ? "Authorizing…" : `Authorize $${amount}`}</Btn>
      </div>
      <p style={{ font: `500 11px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
        You're only charged after it's plowed. No storm, no charge.
      </p>
    </div>
  );
}

// Outer sheet: fetches a PaymentIntent, then mounts Stripe Elements.
function PaymentSheet({ amount, jobId, customerId, onAuthorized, onClose }) {
  const [secret, setSecret] = useState(null);
  const [piId, setPiId] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let ok = true;
    createPaymentIntent({ amount, jobId, customerId })
      .then(r => { if (!ok) return; r.clientSecret ? (setSecret(r.clientSecret), setPiId(r.paymentIntentId)) : setErr(r.error || "Couldn't start payment"); })
      .catch(e => ok && setErr(e.message));
    return () => { ok = false; };
  }, []);
  const appearance = { theme: "night", variables: { colorPrimary: C.amber, colorBackground: C.night2,
    colorText: C.ice, fontFamily: "Inter, sans-serif", borderRadius: "12px" } };
  return (
    <Sheet onClose={onClose}>
      <Eyebrow>Confirm & authorize</Eyebrow>
      <h3 style={{ font: `700 26px ${FD}`, margin: "8px 0 4px" }}>${amount}</h3>
      <p style={{ ...sub, marginBottom: 16 }}>Add a card to hold your spot — we only charge once your property is plowed.</p>
      {err ? (
        <div style={{ padding: "14px 16px", background: C.slate, borderRadius: 12, border: `1px solid ${C.danger}55` }}>
          <p style={{ font: `600 13px ${FB}`, color: C.danger, margin: 0 }}>{err}</p>
          <p style={{ font: `500 12px ${FB}`, color: C.mist, margin: "6px 0 0" }}>Payments aren't fully set up yet. You can still explore the app.</p>
        </div>
      ) : !secret ? (
        <div style={{ display: "grid", gap: 10 }}>
          <Skeleton h={44} /><Skeleton h={44} /><Skeleton h={48} r={14} />
        </div>
      ) : (
        <Elements stripe={getStripe()} options={{ clientSecret: secret, appearance }}>
          <PayForm amount={amount} paymentIntentId={piId} onAuthorized={onAuthorized} onClose={onClose} />
        </Elements>
      )}
    </Sheet>
  );
}

// ---- Shared job chat (rider <-> driver) ------------------------------------
// Uses Supabase realtime when the job is persisted (real jobId + Supabase on);
// otherwise falls back to a local, in-session thread so the demo still chats.
function JobChat({ jobId, senderId, peerName, seed }) {
  const [msgs, setMsgs] = useState(seed || []);
  const [text, setText] = useState("");
  const live = supabaseEnabled && !!jobId && !!senderId;

  useEffect(() => {
    if (!live) return;
    const unsub = subscribeToMessages(jobId, (m) => {
      setMsgs(cur => [...cur, { id: m.id, me: m.sender_id === senderId, t: m.body }]);
    });
    return unsub;
  }, [jobId, senderId]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    if (live) {
      sendMessage(jobId, senderId, body); // the realtime subscription echoes it back
    } else {
      setMsgs(c => [...c, { me: true, t: body }]);
    }
  };

  return (
    <div id="chatbox" style={{ marginTop: 14 }}>
      <Eyebrow>Message {peerName}</Eyebrow>
      <div style={{ marginTop: 8, background: C.night2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, maxHeight: 150, overflowY: "auto" }}>
        {msgs.length === 0 ? (
          <div style={{ font: `500 12px ${FB}`, color: C.mistDim, textAlign: "center", padding: "6px 0" }}>Say hi 👋</div>
        ) : msgs.map((m, i) => (
          <div key={m.id || i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start", marginBottom: 6 }}>
            <span style={{ font: `500 13px ${FB}`, background: m.me ? C.amber : C.slate, color: m.me ? "#20140A" : C.ice,
              padding: "7px 11px", borderRadius: 12, maxWidth: "80%" }}>{m.t}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }} placeholder="Type a message…"
          style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px",
            color: C.ice, font: `500 13px ${FB}`, outline: "none" }} />
        <Btn sm onClick={send}>Send</Btn>
      </div>
    </div>
  );
}

// ---- Notification Center ---------------------------------------------------
function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  const m = Math.floor(sec / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
const NOTIF_ICON = { job: "🚜", payment: "💵", system: "❄️", promo: "🎁" };

function unreadCount(state) {
  const role = state.role === "driver" ? "driver" : "rider";
  return state.notifications.filter(n => !n.read && (n.role === "both" || n.role === role)).length;
}

// Bell with unread badge for the header.
function Bell({ count, onClick }) {
  return (
    <button onClick={onClick} aria-label="Notifications" style={{ position: "relative", width: 38, height: 38,
      borderRadius: 12, border: `1px solid ${C.line}`, background: C.night2, cursor: "pointer",
      display: "grid", placeItems: "center", fontSize: 17, WebkitTapHighlightColor: "transparent" }}>
      🔔
      {count > 0 && (
        <span style={{ position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, padding: "0 4px",
          borderRadius: 10, background: C.danger, color: "#fff", font: `800 10px ${FB}`,
          display: "grid", placeItems: "center", border: `2px solid ${C.night}` }}>{count > 9 ? "9+" : count}</span>
      )}
    </button>
  );
}

function NotificationSheet({ onClose }) {
  const { state, dispatch } = useStore();
  const role = state.role === "driver" ? "driver" : "rider";
  const list = state.notifications.filter(n => n.role === "both" || n.role === role);
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div><Eyebrow>Activity</Eyebrow><h3 style={{ font: `700 24px ${FD}`, margin: "6px 0 0" }}>Notifications</h3></div>
        {list.some(n => !n.read) && (
          <button onClick={() => dispatch({ type: "NOTIF_READ" })} style={{ ...miniBtn, padding: "7px 12px" }}>Mark all read</button>
        )}
      </div>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "34px 10px" }}>
          <div style={{ fontSize: 34, marginBottom: 8, opacity: .5 }}>🔔</div>
          <div style={{ font: `700 15px ${FB}`, color: C.ice }}>You're all caught up</div>
          <div style={{ ...sub, marginTop: 4 }}>Job updates and payouts will show up here.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {list.map(n => (
            <button key={n.id} onClick={() => dispatch({ type: "NOTIF_READ", id: n.id })}
              style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", cursor: "pointer",
                padding: "13px 14px", borderRadius: 13, width: "100%",
                background: n.read ? C.slate : C.slate2, border: `1px solid ${n.read ? C.line : C.amber + "55"}`,
                WebkitTapHighlightColor: "transparent" }}>
              <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: "grid", placeItems: "center",
                background: C.night2, fontSize: 17 }}>{NOTIF_ICON[n.kind] || "❄️"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ font: `700 13px ${FB}`, color: C.ice }}>{n.title}</span>
                  <span style={{ font: `500 10px ${FB}`, color: C.mistDim, flexShrink: 0 }}>{timeAgo(n.ts)}</span>
                </div>
                {n.body && <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 3, lineHeight: 1.35 }}>{n.body}</div>}
              </div>
              {!n.read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, flexShrink: 0, marginTop: 6 }} />}
            </button>
          ))}
          <button onClick={() => dispatch({ type: "NOTIF_CLEAR" })} style={{ ...miniBtn, marginTop: 6, justifyContent: "center" }}>
            Clear all
          </button>
        </div>
      )}
    </Sheet>
  );
}

function RiderTracking() {
  const { state, dispatch } = useStore();
  const o = state.order;
  const d = state.driver;
  const [pos, setPos] = useState(o.driverPos || { x: d.x, y: d.y });
  const [eta, setEta] = useState(o.eta || 8);
  const arrived = o.state === "plowing" || o.state === "arrived" || eta <= 0;
  const trackCenter = o.property?.center;
  const initEta = o.eta || 8;
  const prog = trackCenter ? Math.min(1, Math.max(0, 1 - eta / initEta)) : 0;
  const simLL = trackCenter ? { lng: trackCenter.lng - 0.006 * (1 - prog), lat: trackCenter.lat + 0.004 * (1 - prog) } : null;

  // Subscribe to the driver's REAL location when Supabase is on and the job has a
  // known driver id. Until jobs are persisted with a driver_id this stays dormant
  // and we fall back to the simulated route below.
  const [liveLL, setLiveLL] = useState(null);
  useEffect(() => {
    const driverId = o.driverId || o.driver?.id;
    if (!supabaseEnabled || !driverId) return;
    const unsub = subscribeToDriverLocation(driverId, (row) => {
      if (row && typeof row.lng === "number" && typeof row.lat === "number") {
        setLiveLL({ lng: row.lng, lat: row.lat });
      }
    });
    return unsub;
  }, [o.driverId, o.driver?.id]);
  const driverLL = liveLL || simLL;

  // once accepted, advance to "en route" so the stepper shows the driving leg
  useEffect(() => {
    if (o.state === "accepted" && !state.driverOnline) {
      dispatch({ type: "ORDER_STATE", patch: { state: "enroute" } });
    }
  }, [o.state, state.driverOnline]);

  // drive toward pin while en route
  useEffect(() => {
    if (o.state !== "accepted" && o.state !== "enroute") return;
    if (state.driverOnline) return;
    const iv = setInterval(() => {
      setPos(p => ({ x: p.x + (50 - p.x) * .13, y: p.y + (50 - p.y) * .13 }));
      setEta(e => Math.max(0, +(e - .6).toFixed(1)));
    }, 1000);
    return () => clearInterval(iv);
  }, [o.state, state.driverOnline]);

  // arrival: when the ETA runs out during the drive, start plowing (side effect
  // lives here, not inside a setState updater, so StrictMode can't double-fire it)
  useEffect(() => {
    if ((o.state === "enroute" || o.state === "accepted") && !state.driverOnline && eta <= 0) {
      dispatch({ type: "ORDER_STATE", patch: { state: "plowing" } });
    }
  }, [eta, o.state, state.driverOnline]);

  // plowing -> done (auto-sim only; if a driver is online they drive the flow + photos)
  useEffect(() => {
    if (o.state !== "plowing" || state.driverOnline) return;
    const t = setTimeout(() => {
      // auto-generate before/after photos so the receipt still shows proof
      const before = { seed: 12, phase: "before", ts: Date.now() };
      const after = { seed: 12, phase: "after", ts: Date.now() };
      dispatch({ type: "ADD_PHOTO", phase: "before", photo: before });
      dispatch({ type: "ADD_PHOTO", phase: "after", photo: after });
      const tierPay = driverNetPay(o.quote, state.driver); // net of per-event insurance
      settleJobPayment(o, tierPay, state.driver);
      // credit earnings at the driver's real tier rate (minus any per-event insurance)
      dispatch({ type: "COMPLETE", q: { ...o.quote, driverPay: tierPay }, size: o.size });
      dispatch({ type: "ORDER_STATE", patch: { state: "arrived_done", completed: true } });
      notify(dispatch, { kind: "job", title: "Your property is plowed ✓",
        body: `${o.property?.label || "Your driveway"} is clear. Before & after photos are on your receipt.`, role: "rider" }, state.profile?.phone);
      notify(dispatch, { kind: "payment", title: `Charged $${o.quote?.riderTotal}`,
        body: "Payment complete — thanks for using DRIFT.", role: "rider" });
    }, 4200);
    return () => clearTimeout(t);
  }, [o.state, state.driverOnline]);

  const steps = [
    { k: "requested", label: "Request sent", short: "Sent", icon: "📨" },
    { k: "accepted", label: `${d.name} accepted`, short: "Accepted", icon: "🤝" },
    { k: "enroute", label: "En route to you", short: "En route", icon: "🛻" },
    { k: "plowing", label: "Plowing your property", short: "Plowing", icon: "🚜" },
    { k: "arrived_done", label: "Complete", short: "Done", icon: "✅" },
  ];
  const order = ["requested", "accepted", "enroute", "plowing", "arrived_done"];
  const curIdx = Math.max(order.indexOf(o.state), o.state === "accepted" ? 1 : 0);

  if (o.state === "arrived_done") return <RiderReceipt />;

  return (
    <section style={{ paddingTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <Eyebrow color={arrived ? C.push : C.amber}>{arrived ? "Plowing now" : "On the way"}</Eyebrow>
          <h2 style={{ font: `700 30px ${FD}`, margin: "6px 0 0" }}>{arrived ? "In progress" : `${Math.ceil(eta)} min away`}</h2>
        </div>
        <Chip color={C.plow}>{o.property?.label}</Chip>
      </div>

      {MAP_ENABLED && trackCenter ? (
        <LiveMap center={trackCenter} height={220}
          route={[[driverLL.lng, driverLL.lat], [trackCenter.lng, trackCenter.lat]]}
          markers={[
            { lng: trackCenter.lng, lat: trackCenter.lat, emoji: "📍", size: 26 },
            { lng: driverLL.lng, lat: driverLL.lat, emoji: "🛻", size: 26, pulse: true },
          ]} />
      ) : (
        <StormMap pin blips={[{ id: d.id || "d", x: pos.x, y: pos.y }]} selected={{ id: d.id || "d" }}
          tracking driverPos={pos} showRoute />
      )}

      {/* horizontal status stepper (DoorDash-style) */}
      <div style={{ margin: "16px 0", background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 14px 14px" }}>
        <div style={{ font: `700 13px ${FB}`, color: C.ice, marginBottom: 14 }}>
          {curIdx >= 4 ? "All done — your property is clear." : steps[curIdx]?.label}
        </div>
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between" }}>
          {/* track behind the nodes */}
          <div style={{ position: "absolute", top: 15, left: 15, right: 15, height: 3, background: C.line, borderRadius: 3 }} />
          <div style={{ position: "absolute", top: 15, left: 15, height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.amber}, ${C.amberSoft})`,
            width: `calc((100% - 30px) * ${steps.length > 1 ? curIdx / (steps.length - 1) : 0})`, transition: "width .6s cubic-bezier(.22,1,.36,1)" }} />
          {steps.map((s, i) => {
            const done = i < curIdx, current = i === curIdx;
            return (
              <div key={s.k} style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, flex: "0 0 auto", width: 56 }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 14,
                  background: done ? C.amber : current ? C.night2 : C.night2,
                  border: `2.5px solid ${done || current ? C.amber : C.line}`,
                  boxShadow: current ? `0 0 0 5px ${C.amber}22` : "none", color: done ? "#20140A" : C.ice,
                  transition: "all .3s" }}>
                  {done ? "✓" : s.icon}
                </div>
                <span style={{ font: `${current ? 700 : 600} 10px ${FB}`, color: done || current ? C.ice : C.mistDim, textAlign: "center", lineHeight: 1.1 }}>{s.short}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* driver card */}
      <Card style={{ padding: S.lg }}>
        <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <Avatar name={d.name} size={52} />
            <div style={{ position: "absolute", bottom: -2, right: -2, width: 19, height: 19, borderRadius: "50%",
              background: C.push, border: `2.5px solid ${C.slate}`, display: "grid", placeItems: "center",
              fontSize: 9, color: "#07240F", fontWeight: 900 }}>✓</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ font: `700 17px ${FB}`, letterSpacing: "-.01em" }}>{d.name}</div>
              <Chip color={C.amber} solid>{d.tier}</Chip></div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
              <Stars v={d.rating} size={12} />
              <span style={{ font: `600 12px ${FB}`, color: C.mist }}>{d.rating} · {d.jobs} jobs</span></div>
            <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 4 }}>{d.truck}</div>
          </div>
        </div>
        {/* actions */}
        <div style={{ display: "flex", gap: 9, marginTop: S.md, paddingTop: S.md, borderTop: `1px solid ${C.line}66` }}>
          <button onClick={() => dispatch({ type: "TOAST", msg: `Calling ${d.name.split(" ")[0]}…` })}
            style={{ ...miniBtn, flex: 1, minHeight: 44, fontSize: 14 }}>📞 Call</button>
          <button onClick={() => document.getElementById("chatbox")?.scrollIntoView({ behavior: "smooth" })}
            style={{ ...miniBtn, flex: 1, minHeight: 44, fontSize: 14 }}>💬 Message</button>
          <button onClick={() => dispatch({ type: "TOAST", msg: "Live location shared with your contact" })}
            style={{ ...miniBtn, minHeight: 44, fontSize: 14, paddingLeft: 14, paddingRight: 14 }}>↗</button>
        </div>
      </Card>

      {/* chat — real Supabase thread when the job is persisted, else in-session */}
      <JobChat jobId={o.jobId} senderId={state.userId} peerName={d.name.split(" ")[0]}
        seed={[{ me: false, t: "On my way — about 8 min." }]} />

      {!arrived && (
        <div style={{ marginTop: 14 }}>
          <Btn kind="danger" full sm onClick={() => { dispatch({ type: "CLEAR_ORDER" }); dispatch({ type: "TOAST", msg: "Order cancelled" }); }}>
            Cancel request</Btn>
        </div>
      )}
    </section>
  );
}

function RiderReceipt() {
  const { state, dispatch } = useStore();
  const o = state.order, q = o.quote, d = state.driver;
  const jtR = JOB_TYPES[o.jobType || "driveway"];
  const isRoadside = ROADSIDE.includes(o.jobType);
  const [rating, setRating] = useState(0);
  const [tip, setTip] = useState(0);
  const [done, setDone] = useState(false);

  const finish = () => {
    // save the rating (best-effort; persists when signed in + Supabase is on)
    if (rating > 0 && state.userId) {
      rateJob({ jobId: o.id, raterId: state.userId, rateeId: d.id || "driver", stars: rating });
    }
    // route the tip to the driver: earnings + notification now, real charge when Stripe's on
    if (tip > 0) {
      dispatch({ type: "TIP", amt: tip });
      notify(dispatch, { kind: "payment", title: `$${tip} tip from your customer`,
        body: `Nice work on ${o.property?.label || "the job"} — 100% of the tip is yours.`, role: "driver" });
      if (STRIPE_ENABLED) {
        sendTip({ amount: tip, jobId: o.id, driverStripeAccountId: d.stripeAccountId, customerId: state.userId })
          .catch(() => { /* best-effort; never block the receipt */ });
      }
    }
    dispatch({ type: "CLEAR_ORDER" });
    dispatch({ type: "TOAST", msg: tip ? `Thanks! $${tip} tip sent to ${d.name.split(" ")[0]}` : "Thanks! Receipt saved to Trips" });
  };

  return (
    <section style={{ paddingTop: 8 }}>
      <div style={{ textAlign: "center", margin: "10px 0 20px" }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: C.push + "22", border: `2px solid ${C.push}`,
          display: "grid", placeItems: "center", margin: "0 auto 14px", fontSize: 28, color: C.push }}>✓</div>
        <h2 style={{ font: `700 28px ${FD}`, margin: 0 }}>{isRoadside ? "Back on the road" : "Plowed & clear"}</h2>
        <p style={{ ...sub, marginTop: 6 }}>{d.name} finished your {jtR.label.toLowerCase()}{q.salt ? " + salting" : ""}.</p>
      </div>

      <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 }}>
        <Row label={`${jtR.label}${q.salt ? " + salt" : ""}`} value={`$${q.riderTotal}`} big />
        <p style={{ font: `500 11px ${FB}`, color: C.mistDim, margin: "8px 0 0" }}>One flat price · charged to ···4242</p>
      </div>

      {/* proof of work: before / after */}
      {(o.photos?.before?.length || o.photos?.after?.length) ? (
        <div style={{ marginTop: 16 }}>
          <Eyebrow color={C.push}>Proof of work</Eyebrow>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            {["before", "after"].map(phase => {
              const p = o.photos?.[phase]?.[0];
              return (
                <div key={phase} style={{ flex: 1 }}>
                  <div style={{ width: "100%", aspectRatio: "1.2", borderRadius: 12, overflow: "hidden",
                    border: `1px solid ${phase === "before" ? C.plow : C.push}55`, position: "relative", background: C.slate }}>
                    {p ? <FauxPhoto seed={p.seed} phase={phase} /> :
                      <div style={{ display: "grid", placeItems: "center", height: "100%", color: C.mistDim, font: `500 11px ${FB}` }}>no photo</div>}
                    <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,.6)", borderRadius: 5,
                      padding: "2px 7px", font: `700 9px ${FB}`, color: "#fff" }}>{phase.toUpperCase()}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <Eyebrow>Rate {d.name.split(" ")[0]}</Eyebrow>
        <div style={{ margin: "10px 0" }}><Stars v={rating} size={30} onSet={setRating} /></div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {[5, 10, 15].map(t => (
            <button key={t} onClick={() => setTip(tip === t ? 0 : t)} style={{ ...miniBtn, background: tip === t ? C.amber : C.night2,
              color: tip === t ? "#20140A" : C.ice, border: tip === t ? "none" : `1px solid ${C.line}` }}>Tip ${t}</button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <Btn full onClick={finish}>{tip ? `Submit + tip $${tip}` : "Submit"}</Btn>
      </div>
    </section>
  );
}

// ---- Site details: grade, hazards, shared drive (feeds pricing modifiers) --
function SiteDetails({ grade, setGrade, hazards, setHazards, shared, setShared }) {
  const toggleHaz = (h) => setHazards(hs => hs.includes(h) ? hs.filter(x => x !== h) : [...hs, h]);
  const gradeOpts = [
    { id: "flat", label: "Flat", icon: "▬" },
    { id: "moderate", label: "Moderate", icon: "◢" },
    { id: "steep", label: "Steep", icon: "◣" },
  ];
  return (
    <div>
      <Eyebrow color={C.amber}>Site details</Eyebrow>
      <p style={{ font: `500 12px ${FB}`, color: C.mist, margin: "6px 0 12px" }}>
        Duluth's hills and ice change the job. This keeps your price accurate and warns your driver.
      </p>

      {/* grade */}
      <div style={{ font: `600 12px ${FB}`, color: C.mist, marginBottom: 6 }}>Driveway grade</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {gradeOpts.map(g => {
          const on = grade === g.id;
          return (
            <button key={g.id} onClick={() => setGrade(g.id)} style={{ flex: 1, cursor: "pointer", padding: "12px 8px",
              borderRadius: 12, background: on ? C.amber + "18" : C.slate, border: `1.5px solid ${on ? C.amber : C.line}` }}>
              <div style={{ fontSize: 18, color: on ? C.amber : C.mist }}>{g.icon}</div>
              <div style={{ font: `700 12px ${FB}`, color: on ? C.amber : C.ice, marginTop: 4 }}>{g.label}</div>
            </button>
          );
        })}
      </div>

      {/* hazards */}
      <div style={{ font: `600 12px ${FB}`, color: C.mist, marginBottom: 6 }}>Hazards on site <span style={{ color: C.mistDim }}>(tap all that apply)</span></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {Object.entries(MODIFIERS.hazards).map(([id, h]) => {
          const on = hazards.includes(id);
          return (
            <button key={id} onClick={() => toggleHaz(id)} style={{ cursor: "pointer", padding: "10px 13px", borderRadius: 20,
              background: on ? C.danger + "1E" : C.slate, border: `1.5px solid ${on ? C.danger : C.line}`,
              color: on ? C.danger : C.mist, font: `600 12px ${FB}`, display: "flex", alignItems: "center", gap: 6 }}>
              <span>{on ? "⚠️" : "+"}</span>{h.label}
            </button>
          );
        })}
      </div>

      {/* shared drive */}
      <button onClick={() => setShared(!shared)} style={{ width: "100%", cursor: "pointer", textAlign: "left",
        display: "flex", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 12,
        background: C.slate, border: `1.5px solid ${shared ? C.push : C.line}` }}>
        <div><div style={{ font: `700 13px ${FB}`, color: C.ice }}>Shared driveway</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>Split cost with neighbors — 10% off</div></div>
        <Toggle on={shared} />
      </button>
    </div>
  );
}

function RiderProperties() {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState(null); // property being edited or "new"
  const [label, setLabel] = useState(""); const [addr, setAddr] = useState("");
  const [grade, setGrade] = useState("flat");
  const [hazards, setHazards] = useState([]);
  const [shared, setShared] = useState(false);

  const startEdit = (p) => {
    setGrade(p.grade || "flat"); setHazards(p.hazards || []); setShared(!!p.shared);
    setEditing(p);
  };
  const startNew = () => { setLabel(""); setAddr(""); setGrade("flat"); setHazards([]); setShared(false); setEditing("new"); };

  if (editing) {
    const existing = editing === "new" ? null : { center: editing.center, features: editing.features, sqft: editing.sqft, address: editing.addr };
    return (
      <Fade k="edit"><section style={{ paddingTop: 4 }}>
        <button onClick={() => setEditing(null)} style={{ ...miniBtn, marginBottom: 12 }}>‹ Back</button>
        <Eyebrow>{editing === "new" ? "New property" : "Edit property"}</Eyebrow>
        <h2 style={h2}>Set up the property</h2>
        {editing === "new" && (
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Home, Office)" style={inp} />
            <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="Address" style={inp} />
          </div>
        )}

        <SiteDetails grade={grade} setGrade={setGrade} hazards={hazards} setHazards={setHazards} shared={shared} setShared={setShared} />

        <div style={{ marginTop: 18 }}>
          <Eyebrow color={C.plow}>Map &amp; outline the property</Eyebrow>
          <div style={{ height: 10 }} />
          <MapPropertyDesigner existing={existing}
            onQuote={(sqft) => quoteJob({ jobType: "driveway", sqft, property: { grade, hazards, shared } }).riderTotal}
            onDone={(data) => {
              const details = { grade, hazards, shared };
              const base = { addr: data.address || addr || "Property", center: data.center,
                features: data.features, sqft: data.sqft, mapImg: data.mapImg, zones: [] };
              if (editing === "new") {
                const p = { id: "p" + Date.now(), label: label || "Property", size: SIZES[1], ...base, ...details };
                dispatch({ type: "ADD_PROPERTY", p });
              } else {
                dispatch({ type: "UPDATE_PROPERTY", p: { ...editing, ...base, ...details } });
              }
              dispatch({ type: "TOAST", msg: "Property saved" });
              setEditing(null);
            }} />
        </div>
      </section></Fade>
    );
  }

  return (
    <Fade k="props"><section style={{ paddingTop: 4 }}>
      <Eyebrow>Your properties</Eyebrow>
      <h2 style={{ ...h2, marginBottom: 6 }}>Properties</h2>
      <p style={{ ...sub, marginBottom: S.lg }}>Set each up once. Every future job reuses the map and site details.</p>

      {state.properties.length === 0 ? (
        <EmptyState icon="🗺️" title="No properties yet"
          body="Add your home or business, outline what needs clearing, and we'll price it instantly."
          action={<Btn onClick={startNew}>Add your first property</Btn>} />
      ) : (
        <div style={{ display: "grid", gap: 10, marginBottom: S.lg }}>
          {state.properties.map(p => {
            const isActive = state.activeProperty?.id === p.id;
            const pq = quoteProperty(p);
            return (
              <Card key={p.id} active={isActive} onClick={() => dispatch({ type: "SET_PROPERTY", p })}
                style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  <PropertyThumb zones={p.zones} img={p.mapImg} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ font: `700 15px ${FB}` }}>{p.label}</span>
                      {isActive && <Chip color={C.amber} solid>Active</Chip>}
                    </div>
                    <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.addr}</div>
                    <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Chip color={C.plow}>{p.zones.filter(z => z.mode === "plow").length} plow</Chip>
                      <Chip color={C.push}>{p.zones.filter(z => z.mode === "push").length} push</Chip>
                      {p.grade && p.grade !== "flat" && <Chip color={C.amber}>{MODIFIERS.grade[p.grade].label}</Chip>}
                      {(p.hazards || []).length > 0 && <Chip color={C.danger}>{p.hazards.length} hazard{p.hazards.length > 1 ? "s" : ""}</Chip>}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ font: `700 19px ${FD}`, color: C.amber }}>${pq.riderTotal}</div>
                  <button onClick={(ev) => { ev.stopPropagation(); startEdit(p); }}
                    style={{ ...miniBtn, minHeight: 32, fontSize: 12, marginTop: 7 }}>Edit</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {state.properties.length > 0 && <Btn full kind="dark" onClick={startNew}>+ Add a property</Btn>}

      {/* auto-plow — no contract: set a snow trigger, only pay when it snows */}
      <div style={{ marginTop: S.xl }}>
        <Eyebrow>Auto-plow</Eyebrow>
        <Card active={state.autoPlow} onClick={() => { const turningOn = !state.autoPlow; dispatch({ type: "AUTOPLOW", v: turningOn });
          dispatch({ type: "TOAST", msg: turningOn ? `Auto-plow on — we'll dispatch at ${state.autoPlowThreshold}"+ snow` : "Auto-plow off" }); }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: state.autoPlow ? C.amber + "1E" : C.night2,
              display: "grid", placeItems: "center", fontSize: 19, flexShrink: 0 }}>🔁</div>
            <div><div style={{ font: `700 14px ${FB}` }}>Auto-plow this winter</div>
              <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>
                {state.autoPlow ? `Dispatches at ${state.autoPlowThreshold}"+ · cancel anytime` : "Set a trigger once — only pay when it snows, no contract"}</div></div>
          </div>
          <Toggle on={state.autoPlow} />
        </Card>

        {state.autoPlow && (
          <div style={{ marginTop: 10, background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 15 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ font: `600 12px ${FB}`, color: C.mist }}>Send a plow when snow reaches</span>
              <span style={{ font: `700 24px ${FD}`, color: C.amber, lineHeight: 1 }}>{state.autoPlowThreshold}"</span>
            </div>
            <input type="range" min="1" max="12" step="1" value={state.autoPlowThreshold}
              onChange={e => dispatch({ type: "AUTOPLOW_THRESHOLD", inches: +e.target.value })}
              style={{ width: "100%", accentColor: C.amber }} />
            <div style={{ display: "flex", justifyContent: "space-between", font: `500 10px ${FB}`, color: C.mistDim, marginTop: 2 }}>
              <span>1" · every dusting</span><span>12" · big storms only</span>
            </div>

            {/* quick presets */}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {[2, 3, 4, 6].map(v => {
                const on = state.autoPlowThreshold === v;
                return (
                  <button key={v} onClick={() => dispatch({ type: "AUTOPLOW_THRESHOLD", inches: v })}
                    style={{ flex: 1, cursor: "pointer", padding: "9px 0", borderRadius: 10,
                      background: on ? C.amber + "18" : C.slate, border: `1.5px solid ${on ? C.amber : C.line}`,
                      color: on ? C.amber : C.mist, font: `700 13px ${FB}`, WebkitTapHighlightColor: "transparent" }}>{v}"</button>
                );
              })}
            </div>

            {/* forecast checked against the chosen trigger */}
            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              <span style={{ fontSize: 16 }}>🌨️</span>
              <span style={{ font: `500 12px/1.45 ${FB}`, color: C.mist }}>
                Next storm: <b style={{ color: C.ice }}>{FORECAST.low}–{FORECAST.high}" {FORECAST.when}</b>.{" "}
                {FORECAST.high >= state.autoPlowThreshold
                  ? <b style={{ color: C.push }}>Meets your {state.autoPlowThreshold}" trigger — you're queued.</b>
                  : <span style={{ color: C.mistDim }}>Below your {state.autoPlowThreshold}" trigger — we'll sit this one out.</span>}
              </span>
            </div>

            <div style={{ marginTop: 10, font: `500 11px ${FB}`, color: C.mistDim, textAlign: "center" }}>
              No monthly fee · $0 when it doesn't snow · turn off anytime
            </div>
          </div>
        )}
      </div>
    </section></Fade>
  );
}

function Toggle({ on }) {
  return <div style={{ width: 50, height: 30, borderRadius: 20, flexShrink: 0,
    background: on ? `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})` : C.line,
    position: "relative", transition: `background .28s ${EASE}`,
    boxShadow: on ? "0 2px 10px rgba(255,176,32,.34)" : "inset 0 1px 3px rgba(0,0,0,.3)" }}>
    <div style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: "50%",
      background: "#fff", transition: `left .28s ${EASE}`, boxShadow: "0 2px 5px rgba(0,0,0,.28)" }} /></div>;
}
const inp = { background: C.slate, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 13px", color: C.ice, font: `500 14px ${FB}`, outline: "none", width: "100%" };

function RiderHistory() {
  const { state, dispatch } = useStore();
  const sched = state.scheduled;
  const [viewPhotos, setViewPhotos] = useState(null);

  // demo: let user "activate" a scheduled job now to see the live flow
  const activateNow = (job) => {
    const o = {
      id: "o" + Date.now(), state: "requested", size: job.size, property: job.property,
      quote: job.quote, createdAt: Date.now(), driverPos: { x: state.driver.x, y: state.driver.y },
      eta: 9, timeline: [{ k: "requested", t: "now", label: "Scheduled job dispatched" }],
      photos: { before: [], after: [] },
    };
    dispatch({ type: "ACTIVATE_SCHEDULED", id: job.id, order: o });
    dispatch({ type: "TOAST", msg: "Dispatching your scheduled plow now" });
    autoMatch(dispatch, state);
  };

  const [tab, setTab] = useState("upcoming");
  const totalSpent = state.history.reduce((s, h) => s + h.total, 0);
  const list = tab === "upcoming" ? sched : state.history;

  return (
    <Fade k="hist"><section style={{ paddingTop: 4 }}>
      <Eyebrow>Your plows</Eyebrow>
      <h2 style={{ ...h2, marginBottom: S.md }}>Trips</h2>

      {/* summary strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: S.lg }}>
        {[
          { v: sched.length, l: "Upcoming", c: C.plow },
          { v: state.history.length, l: "Completed", c: C.push },
          { v: `$${totalSpent}`, l: "Total spent", c: C.amber },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 12px" }}>
            <div style={{ font: `700 22px ${FD}`, color: s.c, lineHeight: 1 }}>{s.v}</div>
            <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      <Segmented value={tab} onChange={setTab}
        options={[{ id: "upcoming", label: `Upcoming${sched.length ? ` (${sched.length})` : ""}` }, { id: "past", label: "Past" }]} />

      <div style={{ height: S.lg }} />

      {/* UPCOMING */}
      {tab === "upcoming" && (
        sched.length === 0 ? (
          <EmptyState icon="🗓️" title="Nothing scheduled"
            body="Book a plow ahead of the next storm and we'll dispatch automatically."
            note={`Next storm: 3–5" forecast Friday night`} />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {sched.map(job => {
              const jt = JOB_TYPES[job.jobType || "driveway"];
              return (
                <Card key={job.id} style={{ borderColor: C.plow + "44" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                      <PropertyThumb zones={job.property?.zones} img={job.property?.mapImg} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ font: `700 15px ${FB}` }}>{job.label}</div>
                        <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.property?.addr}</div>
                        <div style={{ marginTop: 7, display: "flex", gap: 6 }}>
                          <Chip color={C.plow}>{jt.icon} {jt.label}</Chip>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ font: `700 20px ${FD}`, color: C.ice }}>${job.quote.riderTotal}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 9, marginTop: S.md }}>
                    <Btn sm full onClick={() => activateNow(job)}>Dispatch now</Btn>
                    <button onClick={() => { dispatch({ type: "CANCEL_SCHEDULED", id: job.id }); dispatch({ type: "TOAST", msg: "Scheduled plow cancelled" }); }}
                      style={{ ...miniBtn, minHeight: 40, color: C.danger, borderColor: C.danger + "44" }}>Cancel</button>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* PAST */}
      {tab === "past" && (
        state.history.length === 0 ? (
          <EmptyState icon="🧾" title="No plows yet" body="Your completed jobs and before/after photos will show up here." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {state.history.map(h => {
              const hasPhotos = h.photos && (h.photos.after?.length || h.photos.before?.length);
              return (
                <Card key={h.id} onClick={hasPhotos ? () => setViewPhotos(h) : undefined}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                    {hasPhotos ? <PhotoThumb photos={h.photos} />
                      : <div style={{ width: 46, height: 46, borderRadius: 12, background: C.night2,
                          border: `1px solid ${C.line}`, display: "grid", placeItems: "center", fontSize: 19, flexShrink: 0 }}>❄️</div>}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: `700 15px ${FB}` }}>{h.size} plow</div>
                      <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 3 }}>{h.date} · {h.driver}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                        {h.rating > 0 && <Stars v={h.rating} size={11} />}
                        {hasPhotos && <span style={{ font: `600 11px ${FB}`, color: C.plow }}>📷 Before / after</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ font: `700 20px ${FD}`, color: C.ice }}>${h.total}</div>
                    {hasPhotos && <div style={{ font: `600 11px ${FB}`, color: C.mistDim, marginTop: 2 }}>View ›</div>}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {viewPhotos && <PhotoViewer job={viewPhotos} onClose={() => setViewPhotos(null)} />}
    </section></Fade>
  );
}

// reusable empty state
function EmptyState({ icon, title, body, note, action }) {
  return (
    <div style={{ textAlign: "center", padding: `${S.xxl}px ${S.xl}px`, background: C.slate,
      border: `1px dashed ${C.line}`, borderRadius: 18 }}>
      <div style={{ fontSize: 34, marginBottom: S.md, opacity: .9 }}>{icon}</div>
      <div style={{ font: `700 16px ${FB}`, color: C.ice, marginBottom: 6 }}>{title}</div>
      <div style={{ font: `500 13px/1.5 ${FB}`, color: C.mist, maxWidth: 260, margin: "0 auto" }}>{body}</div>
      {note && <div style={{ marginTop: S.md, display: "inline-flex", alignItems: "center", gap: 7,
        background: C.night2, border: `1px solid ${C.line}`, borderRadius: 20, padding: "7px 13px",
        font: `600 11px ${FB}`, color: C.mist }}>🌨️ {note}</div>}
      {action && <div style={{ marginTop: S.lg }}>{action}</div>}
    </div>
  );
}

// tiny before/after thumbnail stack
function PhotoThumb({ photos }) {
  const img = (photos.after?.[0] || photos.before?.[0]);
  return (
    <div style={{ width: 46, height: 46, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.line}`,
      background: img?.bg || C.slate, position: "relative", flexShrink: 0 }}>
      {img && <FauxPhoto seed={img.seed} phase={img.phase} />}
      <div style={{ position: "absolute", bottom: 2, right: 2, background: "rgba(0,0,0,.6)", borderRadius: 4,
        padding: "1px 4px", font: `700 8px ${FB}`, color: "#fff" }}>{(photos.after?.length || 0) + (photos.before?.length || 0)}</div>
    </div>
  );
}

// a generated "photo" — a snowy vs cleared driveway gradient, deterministic by seed
function FauxPhoto({ seed = 1, phase = "after", style }) {
  const snowy = phase === "before";
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden",
      background: snowy
        ? "linear-gradient(160deg,#c9d6e5 0%,#e8eef5 45%,#dbe4ee 100%)"
        : "linear-gradient(160deg,#3a3f47 0%,#4b5058 50%,#33383f 100%)", ...style }}>
      {/* driveway */}
      <div style={{ position: "absolute", left: "30%", top: "18%", width: "40%", height: "72%",
        background: snowy ? "linear-gradient(#eef3f9,#dde6f0)" : "linear-gradient(#2b2f35,#23262b)",
        borderRadius: "3px 3px 0 0", transform: "perspective(60px) rotateX(6deg)" }} />
      {/* snow flecks on 'before' */}
      {snowy && [...Array(8)].map((_, i) => (
        <div key={i} style={{ position: "absolute", width: 3, height: 3, borderRadius: "50%", background: "#fff",
          left: `${(seed * 13 + i * 29) % 90 + 3}%`, top: `${(seed * 7 + i * 37) % 80 + 8}%`, opacity: .8 }} />
      ))}
      {/* piles at edges on 'after' */}
      {!snowy && <>
        <div style={{ position: "absolute", left: "22%", top: "20%", width: "8%", height: "70%", background: "#dfe8f2", opacity: .85, borderRadius: 4 }} />
        <div style={{ position: "absolute", right: "22%", top: "20%", width: "8%", height: "70%", background: "#dfe8f2", opacity: .85, borderRadius: 4 }} />
      </>}
    </div>
  );
}

// full-screen before/after viewer with a wipe slider
function PhotoViewer({ job, onClose }) {
  const before = job.photos?.before?.[0] || { seed: 3, phase: "before" };
  const after = job.photos?.after?.[0] || { seed: 3, phase: "after" };
  const [wipe, setWipe] = useState(50);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(5,12,22,.9)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ font: `700 18px ${FD}`, color: C.ice }}>Before / After</div>
          <button onClick={onClose} style={{ ...miniBtn, padding: "7px 12px" }}>Close</button>
        </div>
        {/* wipe comparison */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "1.3", borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}` }}>
          <div style={{ position: "absolute", inset: 0 }}><FauxPhoto seed={after.seed} phase="after" /></div>
          <div style={{ position: "absolute", inset: 0, width: `${wipe}%`, overflow: "hidden", borderRight: `2px solid ${C.amber}` }}>
            <div style={{ width: `${100 / (wipe / 100)}%`, height: "100%" }}><FauxPhoto seed={before.seed} phase="before" /></div>
          </div>
          <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,.55)", borderRadius: 6, padding: "3px 8px", font: `700 10px ${FB}`, color: "#fff" }}>BEFORE</div>
          <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,.55)", borderRadius: 6, padding: "3px 8px", font: `700 10px ${FB}`, color: "#fff" }}>AFTER</div>
        </div>
        <input type="range" min="0" max="100" value={wipe} onChange={e => setWipe(+e.target.value)}
          style={{ width: "100%", marginTop: 14, accentColor: C.amber }} />
        <p style={{ font: `500 12px ${FB}`, color: C.mist, textAlign: "center", marginTop: 6 }}>
          Drag to compare · {job.driver} · {job.date}
        </p>
      </div>
    </div>
  );
}

function RiderAccount({ onReferral }) {
  const { state, dispatch } = useStore();
  const auth = useAuth();
  const p = state.profile, pay = state.payment;
  const ref = state.riderReferral;
  return (
    <Fade k="acct"><section style={{ paddingTop: 4 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 18 }}>
        <Avatar name={p.name || "You"} size={56} />
        <div><div style={{ font: `700 19px ${FB}` }}>{p.name || "Your account"}</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist }}>{p.phone || "—"} · {p.email || "—"}</div></div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}>💳</span>
            <div><div style={{ font: `700 13px ${FB}` }}>{pay ? `${pay.brand} ···${pay.last4}` : "No card on file"}</div>
              <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Default payment</div></div></div>
          <Chip color={C.good}>Active</Chip>
        </Card>
        {/* referral card — opens full screen */}
        <Card onClick={onReferral} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          borderColor: C.amber + "55", background: `linear-gradient(120deg, ${C.slate}, ${C.night2})` }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}>🎁</span>
            <div><div style={{ font: `700 13px ${FB}` }}>Refer neighbors · earn ${ref.reward} each</div>
              <div style={{ font: `500 12px ${FB}`, color: C.mist }}>
                {ref.credit > 0 ? `$${ref.credit} earned · ${ref.invited} invited` : "You both get $" + ref.reward}</div></div></div>
          <span style={{ color: C.amber, fontSize: 18 }}>›</span>
        </Card>
        <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}>🛟</span>
            <div><div style={{ font: `700 13px ${FB}` }}>Help & support</div>
              <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Report an issue, get help</div></div></div>
          <span style={{ color: C.mist }}>›</span>
        </Card>
      </div>
      {auth?.isConfigured && auth?.session && (
        <button onClick={async () => { await auth.signOut(); dispatch({ type: "SIGNED_OUT" }); }}
          style={{ width: "100%", marginTop: 12, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12,
            color: C.ice, font: `700 13px ${FB}`, cursor: "pointer", padding: 13 }}>
          Sign out
        </button>
      )}
      <button onClick={() => dispatch({ type: "RESET" })}
        style={{ width: "100%", marginTop: 12, background: "transparent", border: `1px dashed ${C.line}`, borderRadius: 12,
          color: C.mistDim, font: `600 12px ${FB}`, cursor: "pointer", padding: 12 }}>
        ↺ Reset demo (replay onboarding)
      </button>
    </section></Fade>
  );
}

// ---- Shared referral card (code, copy, share targets, progress) -----------
function ReferralHero({ code, reward, subtitle, accent = C.amber }) {
  const { dispatch } = useStore();
  const copy = () => dispatch({ type: "TOAST", msg: `Code ${code} copied to clipboard` });
  return (
    <div style={{ borderRadius: 16, padding: 20, position: "relative", overflow: "hidden",
      background: `linear-gradient(135deg, ${accent}22, ${C.night2})`, border: `1px solid ${accent}55` }}>
      <div style={{ position: "absolute", top: -40, right: -30, fontSize: 130, opacity: .08 }}>🎁</div>
      <div style={{ font: `700 13px ${FB}`, color: accent, letterSpacing: ".08em" }}>YOUR CODE</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 14px" }}>
        <div style={{ font: `700 26px ${FD}`, letterSpacing: ".04em", color: C.ice }}>{code}</div>
        <button onClick={copy} style={{ ...miniBtn, padding: "6px 10px", borderColor: accent + "66" }}>Copy</button>
      </div>
      <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: "0 0 16px", maxWidth: 300 }}>{subtitle}</p>
      <div style={{ display: "flex", gap: 8 }}>
        {[["💬", "Text"], ["✉️", "Email"], ["🔗", "Copy link"]].map(([ic, lbl]) => (
          <button key={lbl} onClick={() => dispatch({ type: "TOAST", msg: `Sharing via ${lbl}…` })}
            style={{ flex: 1, ...miniBtn, padding: "11px 8px", display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 17 }}>{ic}</span><span style={{ font: `600 11px ${FB}` }}>{lbl}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RiderReferral({ onBack }) {
  const { state, dispatch } = useStore();
  const ref = state.riderReferral;
  const animCredit = useCountUp(ref.credit, 400);

  // demo: simulate inviting + a referred neighbor completing their first plow
  const simulateInvite = () => {
    const names = ["Sam P.", "The Olsons", "Rick M.", "Dana K.", "Chris B."];
    dispatch({ type: "REFER_RIDER", name: names[ref.invited % names.length] });
    dispatch({ type: "TOAST", msg: "Invite sent!" });
    setTimeout(() => { dispatch({ type: "REFER_RIDER_CREDIT", idx: 0 });
      dispatch({ type: "TOAST", msg: `They booked their first plow — you earned $${ref.reward}!` }); }, 1600);
  };

  return (
    <Fade k="rref"><section style={{ paddingTop: 4 }}>
      <button onClick={onBack} style={{ ...miniBtn, marginBottom: 14 }}>‹ Account</button>
      <Eyebrow>Referrals</Eyebrow>
      <h2 style={h2}>Give $15, get $15</h2>

      {/* credit banner */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `700 24px ${FD}`, color: C.amber }}>${animCredit}</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Credit earned</div>
        </div>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `700 24px ${FD}`, color: C.ice }}>{ref.invited}</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Neighbors invited</div>
        </div>
      </div>

      <ReferralHero code={ref.code} reward={ref.reward}
        subtitle={`Share your code. When a neighbor books their first plow, you both get $${ref.reward} in credit — stacked toward your next storm.`} />

      <div style={{ marginTop: 14 }}>
        <Btn full onClick={simulateInvite}>Invite a neighbor</Btn>
      </div>

      {/* how it works */}
      <div style={{ marginTop: 18 }}>
        <Eyebrow color={C.mist}>How it works</Eyebrow>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {[["1", "Share your code", "Text or email it to a neighbor."],
            ["2", "They book a plow", "Your code applies $" + ref.reward + " off their first job."],
            ["3", "You both earn", "$" + ref.reward + " credit lands when their plow completes."]].map(([n, t, d]) => (
            <div key={n} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: C.slate,
              border: `1px solid ${C.line}`, borderRadius: 12, padding: 13 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.amber, color: "#20140A",
                display: "grid", placeItems: "center", font: `800 12px ${FB}`, flexShrink: 0 }}>{n}</div>
              <div><div style={{ font: `700 13px ${FB}` }}>{t}</div>
                <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>{d}</div></div>
            </div>
          ))}
        </div>
      </div>

      {/* activity */}
      {ref.activity.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Eyebrow color={C.mist}>Your invites</Eyebrow>
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {ref.activity.map((x, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 17 }}>{x.status === "first-plow" ? "✅" : "⏳"}</span>
                  <div><div style={{ font: `700 13px ${FB}` }}>{x.name}</div>
                    <div style={{ font: `500 11px ${FB}`, color: C.mist }}>
                      {x.status === "first-plow" ? "Booked first plow" : "Joined — waiting on first plow"}</div></div>
                </div>
                {x.amt > 0 && <Chip color={C.good}>+${x.amt}</Chip>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section></Fade>
  );
}
// ============================================================
// DRIVER APP
// ============================================================
// ============================================================
// DRIVER ONBOARDING — verify before you can go online
// ============================================================
const TOOL_OPTIONS = [
  { id: "Plow truck", icon: "🚜", label: "Plow truck", note: "Driveways, lots" },
  { id: "Snowblower", icon: "🧹", label: "Snowblower", note: "Sidewalks, walks" },
  { id: "Snowblower / shovel", icon: "🚗", label: "Shovel kit", note: "Car dig-outs" },
  { id: "Skid steer", icon: "🏢", label: "Skid steer", note: "Commercial lots" },
  { id: "Roadside kit", icon: "🔋", label: "Roadside kit", note: "Jump-starts" },
];

// Guided-insurance partners. Our target driver — a guy who plows his own drive —
// almost never has commercial coverage yet, so onboarding HELPS him buy it
// instead of turning him away. In production these are real broker quote APIs.
const INSURANCE_PARTNERS = [
  { id: "ncc", name: "North Country Commercial", monthly: 89, coverage: "$1M GL + plow endorsement",
    badge: "Fastest bind", note: "MN-based · covers you same day", accent: C.push },
  { id: "snowbelt", name: "Snowbelt Mutual", monthly: 74, coverage: "$500K GL + plow",
    badge: "Budget pick", note: "Seasonal Nov–Apr option available", accent: C.amber },
  { id: "frostline", name: "Frostline Coverage", monthly: 112, coverage: "$2M GL + commercial auto + plow",
    badge: "Full coverage", note: "Best if you also run commercial lots", accent: C.plow },
];

function DriverOnboarding() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState(0); // 0 intro, 1 identity, 2 equipment, 3 insurance, 4 payout
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [truck, setTruck] = useState("");
  const [tools, setTools] = useState([]);
  const [carrier, setCarrier] = useState("");
  const [policy, setPolicy] = useState("");
  const [valid, setValid] = useState({});
  const [uploads, setUploads] = useState({});
  // insurance step: "have" (verify own commercial policy) | "perEvent" (opt into DRIFT per-event coverage)
  const [coverage, setCoverage] = useState(null);
  const [perEventOptIn, setPerEventOptIn] = useState(false);
  const setV = (k, v) => setValid(s => ({ ...s, [k]: v }));
  const TOTAL = 4;

  const step3Ready = coverage === "have" ? !!uploads.insurance
    : coverage === "perEvent" ? perEventOptIn
    : false;

  const upload = (k) => {
    setUploads(u => ({ ...u, [k]: "uploading" }));
    setTimeout(() => { setUploads(u => ({ ...u, [k]: "verified" }));
      dispatch({ type: "TOAST", msg: "Document received — verifying" }); }, 900);
  };

  const finish = () => {
    const perEvent = coverage === "perEvent";
    const insured = (coverage === "have" && uploads.insurance) || (perEvent && perEventOptIn);
    const carrierName = perEvent ? "DRIFT per-event coverage" : (carrier || "North Country Commercial");
    const coverType = perEvent ? `Per-event · $${INSURANCE.perEvent}/job` : "Commercial GL + Plow";
    dispatch({ type: "DRIVER_ONBOARD_DONE", name, truck: truck || "F-350 · 9ft V-Plow", tools,
      docs: { license: "verified", insurance: insured ? "verified" : "pending", plate: "verified", w9: "pending" },
      insurancePlan: perEvent ? "perEvent" : "own",
      insurance: { carrier: carrierName, type: coverType, expires: perEvent ? "per job" : "2026-11-01" } });
    dispatch({ type: "TOAST", msg: insured
      ? `You're verified, ${name.split(" ")[0] || "driver"}! Go online to start earning.`
      : `Almost there, ${name.split(" ")[0] || "driver"} — you can go online once your coverage is confirmed.` });
  };

  const UploadRow = ({ k, label, hint }) => {
    const st = uploads[k];
    return (
      <button onClick={() => !st && upload(k)} disabled={st === "uploading"}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 14,
          minHeight: TAP, cursor: st ? "default" : "pointer", textAlign: "left",
          background: st === "verified" ? C.push + "12" : C.slate,
          border: `1px solid ${st === "verified" ? C.push + "55" : C.line}`, WebkitTapHighlightColor: "transparent" }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center",
          background: st === "verified" ? C.push + "26" : C.night2, fontSize: 17 }}>
          {st === "verified" ? "✓" : st === "uploading" ? "…" : "📄"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `700 13px ${FB}`, color: C.ice }}>{label}</div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>
            {st === "verified" ? "Uploaded · verifying" : st === "uploading" ? "Uploading…" : hint}</div>
        </div>
        {!st && <span style={{ font: `700 12px ${FB}`, color: C.amber }}>Upload</span>}
      </button>
    );
  };

  return (
    <div style={{ padding: `0 ${S.xl}px`, flex: 1, display: "flex", flexDirection: "column" }}>
      {step > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 16px" }}>
          <button onClick={() => setStep(step - 1)} style={{ ...miniBtn, minHeight: 34, padding: "0 12px" }}>‹</button>
          <div style={{ flex: 1 }}><Steps n={TOTAL} i={step - 1} /></div>
        </div>
      )}

      {step === 0 && (
        <Fade k="di" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 24 }}>
          <div style={{ position: "relative", height: 170, marginBottom: S.lg, borderRadius: 22, overflow: "hidden",
            background: `radial-gradient(120% 100% at 50% 0%, #133D2C 0%, ${C.night} 74%)`, border: `1px solid ${C.push}44` }}>
            <HeroSnow />
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <div style={{ fontSize: 50 }}>🚜</div>
            </div>
          </div>
          <h1 style={{ font: `700 38px/1 ${FD}`, margin: "0 0 10px", textAlign: "center" }}>
            Plow on your<br />own schedule.</h1>
          <p style={{ ...sub, maxWidth: 300, margin: "0 auto 20px", textAlign: "center", fontSize: 15 }}>
            Turn on when the snow flies. Take the jobs you want. Cash out the same day.
          </p>
          <div style={{ display: "grid", gap: 10, marginBottom: S.xl }}>
            {[["💵", "Keep up to 85% per job", "Starts at 70% · first jobs pay 90%"],
              ["⚡", "Steady work every storm", "Jobs near you when it snows"],
              ["🏦", "Instant cash out", "Stripe Connect, same day"]].map(([i, t, d]) => (
              <div key={t} style={{ display: "flex", gap: 12, alignItems: "center", background: C.slate,
                border: `1px solid ${C.line}`, borderRadius: 14, padding: 13 }}>
                <span style={{ fontSize: 19 }}>{i}</span>
                <div><div style={{ font: `700 13px ${FB}` }}>{t}</div>
                  <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>{d}</div></div>
              </div>
            ))}
          </div>
          <Btn full kind="good" onClick={() => setStep(1)}>Start driver setup</Btn>
          <button onClick={() => dispatch({ type: "ROLE", role: "rider" })}
            style={{ width: "100%", marginTop: S.md, background: "transparent", border: "none", cursor: "pointer",
              color: C.mist, font: `600 14px ${FB}`, padding: 12 }}>I need a plow instead →</button>
        </Fade>
      )}

      {step === 1 && (
        <Fade k="d1">
          <Eyebrow color={C.push}>Step 1 · Identity</Eyebrow>
          <h2 style={h2}>Who's driving?</h2>
          <p style={sub}>We verify every operator before they take jobs.</p>
          <div style={{ display: "grid", gap: 12, margin: "16px 0" }}>
            <Field label="Full name" icon="👤" value={name} autoFocus onChange={setName}
              validate={validators.name} placeholder="Marcus Trent" onValid={v => setV("name", v)} />
            <Field label="Phone" icon="📱" value={phone} inputMode="tel" format={fmtPhone} onChange={setPhone}
              validate={validators.phone} placeholder="(218) 555-0123" onValid={v => setV("phone", v)} />
            <UploadRow k="license" label="Driver's license" hint="Front and back · photo or scan" />
          </div>
          <div style={{ position: "sticky", bottom: 16 }}>
            <Btn full kind="good" onClick={() => setStep(2)} disabled={!(valid.name && valid.phone && uploads.license)}>Continue</Btn>
          </div>
        </Fade>
      )}

      {step === 2 && (
        <Fade k="d2">
          <Eyebrow color={C.push}>Step 2 · Equipment</Eyebrow>
          <h2 style={h2}>What do you run?</h2>
          <p style={sub}>You'll only be offered jobs your gear can handle.</p>
          <div style={{ display: "grid", gap: 10, margin: "16px 0" }}>
            {TOOL_OPTIONS.map(t => {
              const on = tools.includes(t.id);
              return (
                <button key={t.id} onClick={() => setTools(ts => on ? ts.filter(x => x !== t.id) : [...ts, t.id])}
                  style={{ display: "flex", alignItems: "center", gap: 13, padding: 14, borderRadius: 14, minHeight: TAP,
                    cursor: "pointer", textAlign: "left", background: on ? C.push + "14" : C.slate,
                    border: `1.5px solid ${on ? C.push : C.line}`, transition: `all .18s ${EASE}`,
                    WebkitTapHighlightColor: "transparent" }}>
                  <span style={{ fontSize: 23 }}>{t.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ font: `700 14px ${FB}`, color: on ? C.push : C.ice }}>{t.label}</div>
                    <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>{t.note}</div>
                  </div>
                  <span style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center",
                    background: on ? C.push : "transparent", border: `2px solid ${on ? C.push : C.line}`,
                    color: "#07240F", fontWeight: 900, fontSize: 12 }}>{on ? "✓" : ""}</span>
                </button>
              );
            })}
            <Field label="Vehicle" icon="🛻" value={truck} onChange={setTruck}
              placeholder="F-350 · 9ft V-Plow" />
            <UploadRow k="plate" label="Registration / plate" hint="Proof the rig is yours" />
          </div>
          <div style={{ position: "sticky", bottom: 16 }}>
            <Btn full kind="good" onClick={() => setStep(3)} disabled={!(tools.length && uploads.plate)}>
              {tools.length ? "Continue" : "Pick at least one"}</Btn>
          </div>
        </Fade>
      )}

      {step === 3 && (
        <Fade k="d3">
          <Eyebrow color={C.push}>Step 3 · Insurance</Eyebrow>
          <h2 style={h2}>Let's get you covered</h2>
          <div style={{ display: "flex", gap: 11, alignItems: "flex-start", background: C.danger + "12",
            border: `1px solid ${C.danger}44`, borderRadius: 14, padding: 14, margin: "14px 0" }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div style={{ font: `500 12px/1.5 ${FB}`, color: C.mist }}>
              Your <b style={{ color: C.ice }}>personal auto policy won't cover commercial plowing</b> — drop a blade on it
              and the claim can be denied outright. Commercial coverage is required to take jobs. Most new drivers don't have it
              yet — that's normal, and we'll help you get it in a few minutes.
            </div>
          </div>

          {/* use your own vs opt into per-event coverage */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {[["have", "🛡️", "I have my own", "Commercial policy"], ["perEvent", "🎟️", "Cover me per job", `No monthly bill`]].map(([id, ic, label, sub]) => {
              const on = coverage === id;
              return (
                <button key={id} onClick={() => setCoverage(id)} style={{ flex: 1, cursor: "pointer", textAlign: "left",
                  padding: 14, borderRadius: 14, background: on ? C.push + "14" : C.slate,
                  border: `1.5px solid ${on ? C.push : C.line}`, transition: "all .18s", WebkitTapHighlightColor: "transparent" }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{ic}</div>
                  <div style={{ font: `700 13px ${FB}`, color: on ? C.push : C.ice }}>{label}</div>
                  <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>{sub}</div>
                </button>
              );
            })}
          </div>

          {/* HAVE IT: verify existing policy */}
          {coverage === "have" && (
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="Insurance carrier" icon="🏢" value={carrier} onChange={setCarrier}
                placeholder="North Country Commercial" autoFocus />
              <Field label="Policy number" icon="#️⃣" value={policy} onChange={setPolicy} placeholder="NCC-4482910" />
              <UploadRow k="insurance" label="Certificate of insurance" hint="Must show commercial plow coverage" />
            </div>
          )}

          {/* PER-EVENT: opt into DRIFT coverage, paid only when you work */}
          {coverage === "perEvent" && (
            <div>
              <div style={{ background: `linear-gradient(130deg, ${C.push}14, ${C.night2})`, border: `1px solid ${C.push}55`,
                borderRadius: 16, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ font: `800 15px ${FD}`, color: C.ice }}>DRIFT per-event coverage</div>
                    <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 4 }}>Commercial liability, active only while you're on a job.</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ font: `800 22px ${FD}`, color: C.push }}>${INSURANCE.perEvent}</div>
                    <div style={{ font: `500 10px ${FB}`, color: C.mistDim }}>per job</div>
                  </div>
                </div>
                <div style={{ height: 1, background: C.line, margin: "14px 0" }} />
                {[
                  ["💸", "No monthly premium", "You only pay when you actually plow a job."],
                  ["➖", "Deducted from your pay", `$${INSURANCE.perEvent} comes out of each job — nothing out of pocket.`],
                  ["🌤️", "Slow week? Pay nothing", "No storms, no jobs, no charge."],
                ].map(([ic, t, d]) => (
                  <div key={t} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 15 }}>{ic}</span>
                    <div><div style={{ font: `700 12px ${FB}`, color: C.ice }}>{t}</div>
                      <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 1 }}>{d}</div></div>
                  </div>
                ))}
              </div>
              <button onClick={() => setPerEventOptIn(v => !v)} style={{ width: "100%", marginTop: 12, cursor: "pointer",
                textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12,
                background: perEventOptIn ? C.push + "12" : "transparent", border: `1px solid ${perEventOptIn ? C.push : C.line}` }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "grid", placeItems: "center",
                  background: perEventOptIn ? C.push : "transparent", border: `2px solid ${perEventOptIn ? C.push : C.line}`,
                  color: "#07240F", fontWeight: 900, fontSize: 11 }}>{perEventOptIn ? "✓" : ""}</span>
                <span style={{ font: `500 12px ${FB}`, color: C.mist }}>
                  I want DRIFT per-event coverage — deduct <b style={{ color: C.ice }}>${INSURANCE.perEvent}</b> from each job I complete.</span>
              </button>
            </div>
          )}

          <div style={{ position: "sticky", bottom: 16, marginTop: S.lg }}>
            <Btn full kind="good" onClick={() => setStep(4)} disabled={!step3Ready}>
              {!coverage ? "Choose an option above"
                : coverage === "have" ? (uploads.insurance ? "Continue" : "Upload your certificate")
                : perEventOptIn ? "Continue — you're covered per job"
                : "Opt in to continue"}
            </Btn>
          </div>
        </Fade>
      )}

      {step === 4 && (
        <Fade k="d4">
          <Eyebrow color={C.push}>Step 4 · Get paid</Eyebrow>
          <h2 style={h2}>Where should we send it?</h2>
          <p style={sub}>Payouts run through Stripe Connect. Cash out the same day.</p>
          <div style={{ margin: "16px 0", borderRadius: 16, padding: 18, position: "relative", overflow: "hidden",
            background: `linear-gradient(135deg, ${C.push}1E, ${C.night2})`, border: `1px solid ${C.push}44` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ font: `700 11px ${FB}`, letterSpacing: ".14em", color: C.push }}>PAYOUT ACCOUNT</span>
              <span style={{ fontSize: 19 }}>🏦</span>
            </div>
            <div style={{ font: `700 20px ${FB}`, letterSpacing: ".08em", color: C.ice }}>•••• •••• 6789</div>
            <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 6 }}>{name || "Your name"} · Checking</div>
          </div>
          <UploadRow k="w9" label="W-9 tax form" hint="Required for 1099 contractors" />
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0", font: `500 12px ${FB}`, color: C.mistDim }}>
            <span>🔒</span> Bank details handled by Stripe · we never see them
          </div>
          <div style={{ position: "sticky", bottom: 16 }}>
            <Btn full kind="good" onClick={finish}>Finish — start earning</Btn>
          </div>
        </Fade>
      )}
    </div>
  );
}

function DriverApp() {
  const { state } = useStore();
  const [tab, setTab] = useState("drive");
  const [sub, setSub] = useState(null);
  const driverTabs = [
    { id: "drive", label: "Drive", icon: "🚜" },
    { id: "earn", label: "Earnings", icon: "💰" },
    { id: "account", label: "Account", icon: "🪪" },
  ];
  const openTab = (t) => { setSub(null); setTab(t); };
  return (
    <>
      <div style={{ padding: "0 20px", flex: 1 }}>
        {sub === "referral" ? <DriverReferral onBack={() => setSub(null)} />
          : <>
            {tab === "drive" && <DriverDrive />}
            {tab === "earn" && <DriverEarnings onReferral={() => setSub("referral")} />}
            {tab === "account" && <DriverAccount onReferral={() => setSub("referral")} />}
          </>}
      </div>
      <TabBar tabs={driverTabs} active={tab} onChange={openTab} />
    </>
  );
}

function DriverDrive() {
  const { state, dispatch } = useStore();
  const online = state.driverOnline;
  const o = state.order;
  // driver "has a job" if there's an order that they've accepted, OR an incoming request while online
  const incoming = online && o && o.state === "requested";
  const working = o && ["accepted", "enroute", "plowing", "arrived_done"].includes(o.state);

  if (working) return <DriverActiveJob />;

  return (
    <Fade k="drive"><section style={{ paddingTop: 4 }}>
      {/* status hero */}
      <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", marginBottom: S.md,
        background: online
          ? `linear-gradient(150deg, ${C.push}1E, ${C.night2})`
          : `linear-gradient(150deg, ${C.slate2}, ${C.night2})`,
        border: `1px solid ${online ? C.push + "55" : C.line}`, padding: S.lg,
        transition: `all .3s ${EASE}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: S.sm }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: online ? C.push : C.mistDim,
            boxShadow: online ? `0 0 10px ${C.push}` : "none",
            animation: online ? "pulse 1.6s infinite" : "none" }} />
          <span style={{ font: `700 11px ${FB}`, letterSpacing: ".16em", textTransform: "uppercase",
            color: online ? C.push : C.mistDim }}>{online ? "Online · taking jobs" : "Offline"}</span>
        </div>
        <h1 style={{ font: `700 30px/1.02 ${FD}`, margin: "0 0 4px" }}>
          {online ? "Watching for jobs" : "Go online to earn"}</h1>
        <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: 0 }}>
          {online ? `${SNOW_DEPTH_IN}" falling · demand is high right now`
            : "Heavy snow means surge pay. Flip on when you're ready."}</p>

        {/* today's earnings inline */}
        <div style={{ display: "flex", gap: S.lg, marginTop: S.lg, paddingTop: S.md, borderTop: `1px solid ${C.line}66` }}>
          <div>
            <div style={{ font: `700 24px ${FD}`, color: C.amber }}>${state.earnings.today}</div>
            <div style={{ font: `500 11px ${FB}`, color: C.mist }}>Today</div>
          </div>
          <div>
            <div style={{ font: `700 24px ${FD}`, color: C.ice }}>{state.earnings.jobsToday}</div>
            <div style={{ font: `500 11px ${FB}`, color: C.mist }}>Jobs</div>
          </div>
          <div>
            <div style={{ font: `700 24px ${FD}`, color: C.ice }}>${state.earnings.week}</div>
            <div style={{ font: `500 11px ${FB}`, color: C.mist }}>This week</div>
          </div>
        </div>
      </div>

      {MAP_ENABLED && state.driver.lng ? (
        <LiveMap center={{ lng: state.driver.lng, lat: state.driver.lat }} height={200}
          markers={[{ lng: state.driver.lng, lat: state.driver.lat, emoji: "🛻", size: 28, pulse: true }]} />
      ) : (
        <StormMap pin="JOB" blips={[{ id: "me", x: state.driver.x, y: state.driver.y }]} selected={{ id: "me" }} />
      )}

      {/* big online switch — primary action, oversized for gloves */}
      <button onClick={() => { dispatch({ type: "ONLINE", v: !online }); dispatch({ type: "TOAST", msg: !online ? "You're online — jobs will come in" : "You're offline" }); }}
        style={{ width: "100%", marginTop: S.lg, minHeight: 60, borderRadius: 16, cursor: "pointer",
          border: "none", font: `700 17px ${FB}`, letterSpacing: "-.01em",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: online ? C.slate : `linear-gradient(180deg, #8BF5AE, ${C.push})`,
          color: online ? C.ice : "#07240F",
          boxShadow: online ? `inset 0 0 0 1px ${C.line}` : "0 8px 26px rgba(110,238,155,.3)",
          transition: `all .28s ${EASE}`, WebkitTapHighlightColor: "transparent" }}>
        <span style={{ fontSize: 19 }}>{online ? "⏸" : "▶"}</span>
        {online ? "Go offline" : "Go online"}
      </button>

      {/* demand heat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: S.lg }}>
        {[
          { v: `${SNOW_DEPTH_IN}"`, l: "Snow depth", c: C.plow, i: "🌨️" },
          { v: `${Math.round(driverPct(state.driver) * 100)}%`, l: "You keep", c: C.push, i: "💵" },
          { v: "12", l: "Open jobs", c: C.push, i: "📍" },
        ].map((s, i) => (
          <div key={i} style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 11px" }}>
            <div style={{ fontSize: 15, marginBottom: 5 }}>{s.i}</div>
            <div style={{ font: `700 20px ${FD}`, color: s.c, lineHeight: 1 }}>{s.v}</div>
            <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* storm connectivity */}
      <button onClick={() => { dispatch({ type: "OFFLINE", v: !state.offline });
          if (!state.offline) { dispatch({ type: "QUEUE" }); dispatch({ type: "TOAST", msg: "Signal lost — job data cached locally" }); } }}
        style={{ width: "100%", marginTop: S.md, cursor: "pointer", textAlign: "left", display: "flex",
          alignItems: "center", gap: 11, padding: "13px 15px", borderRadius: 14, minHeight: TAP,
          background: state.offline ? C.danger + "14" : C.slate,
          border: `1px solid ${state.offline ? C.danger + "55" : C.line}`, WebkitTapHighlightColor: "transparent" }}>
        <span style={{ fontSize: 17 }}>{state.offline ? "📡" : "📶"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ font: `700 13px ${FB}`, color: state.offline ? C.danger : C.ice }}>
            {state.offline ? "Offline — cached mode" : "Signal good"}</div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>
            {state.offline ? "Jobs stay on-device until signal returns" : "Tap to simulate a hillside dead zone"}</div>
        </div>
      </button>

      {/* waiting state with skeletons — feels alive, not empty */}
      {online && !incoming && (
        <div style={{ marginTop: S.lg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: S.md, justifyContent: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.push, animation: "pulse 1.4s infinite" }} />
            <span style={{ font: `600 13px ${FB}`, color: C.mist }}>Listening for nearby requests…</span>
          </div>
          <div style={{ display: "grid", gap: 8, opacity: .45 }}>
            {[0, 1].map(i => (
              <div key={i} style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14,
                display: "flex", gap: 12, alignItems: "center" }}>
                <Skeleton h={38} w={38} r={11} />
                <div style={{ flex: 1 }}>
                  <Skeleton h={11} w="62%" />
                  <div style={{ height: 7 }} />
                  <Skeleton h={9} w="40%" />
                </div>
                <Skeleton h={22} w={52} r={8} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* incoming job request */}
      {incoming && <IncomingJob order={o} />}
    </section></Fade>
  );
}

function IncomingJob({ order }) {
  const { state, dispatch } = useStore();
  const q = order.quote;
  const prop = order.property;
  const insFee = driverInsuranceFee(state.driver);
  const dPay = driverNetPay(q, state.driver); // take-home, net of per-event insurance
  const dHourly = driverHourlyFor(dPay, order.size?.mins || q.mins);
  const jt = JOB_TYPES[order.jobType || "driveway"];
  const toolMatch = state.driver.tools?.includes(order.tool || jt.tool);
  const hazards = (prop?.hazards || []).map(h => MODIFIERS.hazards[h]?.label).filter(Boolean);
  const steep = prop?.grade === "steep";
  const markedHazards = (prop?.features || []).filter(f => f.geometry?.type === "Point").map(f => f.properties?.label).filter(Boolean);

  // 15s auto-decline countdown (jobs are time-sensitive in a storm)
  const [secs, setSecs] = useState(15);
  useEffect(() => {
    if (secs <= 0) { decline(true); return; }
    const t = setTimeout(() => setSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs]);

  const accept = () => {
    dispatch({ type: "ORDER_STATE", patch: { state: "accepted", driver: state.driver, eta: 8,
      timeline: [...(order.timeline || []), { k: "accepted", t: "now", label: "You accepted" }] }});
    dispatch({ type: "TOAST", msg: "Job accepted — navigate to the property" });
  };
  const decline = (auto) => { dispatch({ type: "CLEAR_ORDER" }); dispatch({ type: "TOAST", msg: auto ? "Job passed to next driver" : "Job declined" }); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,12,22,.8)", zIndex: 40, display: "flex",
      alignItems: "flex-end", justifyContent: "center", padding: 12 }}>
      <div style={{ width: "100%", maxWidth: 416, background: C.night2, border: `2px solid ${C.amber}`, borderRadius: 20,
        padding: 18, boxShadow: "0 -10px 50px rgba(0,0,0,.6)", animation: "rise .22s ease" }}>

        {/* header: job type + countdown ring */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>{jt.icon}</span>
            <div><div style={{ font: `700 15px ${FB}`, color: C.ice }}>{jt.label}</div>
              <div style={{ font: `600 11px ${FB}`, color: C.mist }}>{order.size?.mins || q.mins} min on site</div></div>
          </div>
          <div style={{ position: "relative", width: 46, height: 46 }}>
            <svg width="46" height="46" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="23" cy="23" r="19" fill="none" stroke={C.line} strokeWidth="4" />
              <circle cx="23" cy="23" r="19" fill="none" stroke={secs <= 5 ? C.danger : C.amber} strokeWidth="4"
                strokeDasharray={119} strokeDashoffset={119 * (1 - secs / 15)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s linear" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", font: `700 15px ${FD}`, color: secs <= 5 ? C.danger : C.ice }}>{secs}</div>
          </div>
        </div>

        {/* pay — huge */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ font: `700 44px ${FD}`, color: C.push, lineHeight: 1 }}>${dPay}</div>
          <Chip color={C.amber}>${dHourly}/hr est</Chip>
        </div>
        <div style={{ font: `500 13px ${FB}`, color: C.mist, marginBottom: 14 }}>{prop?.addr}</div>

        {/* tool match */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 11, marginBottom: 10,
          background: toolMatch ? C.push + "14" : C.danger + "14", border: `1px solid ${toolMatch ? C.push + "55" : C.danger + "55"}` }}>
          <span style={{ fontSize: 15 }}>{toolMatch ? "✅" : "⚠️"}</span>
          <span style={{ font: `600 12px ${FB}`, color: toolMatch ? C.push : C.danger }}>
            {toolMatch ? `Requires ${order.tool || jt.tool} — you're equipped` : `Requires ${order.tool || jt.tool} — not on your profile`}</span>
        </div>

        {/* salting add-on — customer paid for ice-melt, pay reflects it */}
        {q.salt && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 11, marginBottom: 10,
            background: C.amber + "14", border: `1px solid ${C.amber}55` }}>
            <span style={{ fontSize: 15 }}>🧂</span>
            <span style={{ font: `600 12px ${FB}`, color: C.amber }}>Customer added salting — bring ice-melt (+${q.saltFee} in your pay)</span>
          </div>
        )}

        {/* hazard warnings — surfaced BEFORE accept */}
        {(hazards.length > 0 || steep) && (
          <div style={{ padding: "11px 12px", borderRadius: 11, marginBottom: 12,
            background: C.danger + "12", border: `1px solid ${C.danger}44` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: hazards.length ? 7 : 0 }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <span style={{ font: `700 11px ${FB}`, color: C.danger, letterSpacing: ".05em" }}>SITE HAZARDS</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {steep && <Chip color={C.danger}>Steep hillside</Chip>}
              {hazards.map((h, i) => <Chip key={i} color={C.danger}>{h}</Chip>)}
            </div>
          </div>
        )}

        {/* customer-marked hazards (dropped pins) — avoid these */}
        {markedHazards.length > 0 && (
          <div style={{ padding: "11px 12px", borderRadius: 11, marginBottom: 12,
            background: C.danger + "12", border: `1px solid ${C.danger}44` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
              <span style={{ fontSize: 14 }}>🚧</span>
              <span style={{ font: `700 11px ${FB}`, color: C.danger, letterSpacing: ".05em" }}>AVOID — CUSTOMER-MARKED</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {markedHazards.map((h, i) => <Chip key={i} color={C.danger}>🚧 {h}</Chip>)}
            </div>
          </div>
        )}

        {/* property map + zones */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", background: C.slate, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <PropertyThumb zones={prop?.zones} img={prop?.mapImg} />
          <div style={{ font: `500 12px ${FB}`, color: C.mist }}>
            <span style={{ color: C.plow }}>{prop?.zones?.filter(z => z.mode === "plow").length || 0} plow</span> ·
            <span style={{ color: C.push }}> {prop?.zones?.filter(z => z.mode === "push").length || 0} push</span> zones mapped
            <div style={{ marginTop: 3, color: C.mistDim, font: `500 11px ${FB}` }}>Follow the customer's outline exactly</div>
          </div>
        </div>

        {/* density hint: nearby cluster */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, font: `600 11px ${FB}`, color: C.plow }}>
          <span style={{ fontSize: 13 }}>📍</span> 2 more jobs within 3 blocks — accept to see the cluster route
        </div>

        {/* glove-friendly buttons: big targets */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => decline(false)} style={{ flex: "0 0 34%", padding: "18px 0", borderRadius: 14, cursor: "pointer",
            background: C.slate, color: C.mist, border: `1px solid ${C.line}`, font: `700 15px ${FB}` }}>Pass</button>
          <button onClick={accept} disabled={!toolMatch} style={{ flex: 1, padding: "18px 0", borderRadius: 14, cursor: toolMatch ? "pointer" : "not-allowed",
            background: toolMatch ? C.push : C.line, color: toolMatch ? "#0A2015" : C.mistDim, border: "none", font: `700 17px ${FB}`,
            boxShadow: toolMatch ? "0 6px 20px rgba(124,242,156,.3)" : "none" }}>
            Accept · ${dPay}
          </button>
        </div>
        {insFee > 0 && (
          <p style={{ font: `500 10px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 8 }}>
            Take-home after ${insFee} per-event insurance
          </p>
        )}
      </div>
    </div>
  );
}

// ---- Density routing: batch nearby jobs on one street run -----------------
function ClusterRoute() {
  const { dispatch } = useStore();
  const [added, setAdded] = useState({});
  const nearby = [
    { id: "c1", addr: "1432 Woodland Ave", type: "driveway", pay: 61, dist: "1 block", mins: 18 },
    { id: "c2", addr: "1440 Woodland Ave", type: "sidewalk", pay: 54, dist: "1 block", mins: 15 },
    { id: "c3", addr: "205 Chester Pkwy", type: "digout", pay: 45, dist: "3 blocks", mins: 20 },
  ];
  const addedList = nearby.filter(n => added[n.id]);
  const bonusPay = addedList.reduce((s, n) => s + n.pay, 0);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={C.plow}>Nearby on your route</Eyebrow>
        {bonusPay > 0 && <Chip color={C.push}>+${bonusPay} added</Chip>}
      </div>
      <p style={{ font: `500 11px ${FB}`, color: C.mist, margin: "6px 0 10px" }}>
        Batch these while you're on this street — less deadhead, more per hour.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {nearby.map(n => {
          const jt = JOB_TYPES[n.type];
          const on = added[n.id];
          return (
            <button key={n.id} onClick={() => { setAdded(a => ({ ...a, [n.id]: !a[n.id] }));
              dispatch({ type: "TOAST", msg: on ? "Removed from route" : `Added ${n.addr} to your route` }); }}
              style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer",
                background: on ? C.push + "14" : C.slate, border: `1.5px solid ${on ? C.push : C.line}`, borderRadius: 12, padding: 13 }}>
              <span style={{ fontSize: 22 }}>{jt.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `700 13px ${FB}`, color: C.ice }}>{n.addr}</div>
                <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 2 }}>{jt.label} · {n.dist} · {n.mins} min</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ font: `700 15px ${FD}`, color: C.push }}>${n.pay}</div>
                <div style={{ font: `700 11px ${FB}`, color: on ? C.push : C.mistDim }}>{on ? "✓ Added" : "+ Add"}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DriverActiveJob() {
  const { state, dispatch } = useStore();
  const o = state.order, q = o.quote;
  const insFee = driverInsuranceFee(state.driver);
  const dGross = driverGrossPay(q, state.driver);
  const dPay = driverNetPay(q, state.driver); // take-home after per-event insurance
  const dHourly = driverHourlyFor(dPay, o.size?.mins || q.mins);
  const [pos, setPos] = useState({ x: state.driver.x, y: state.driver.y });
  const [eta, setEta] = useState(o.eta || 8);
  const [checks, setChecks] = useState({});
  const zones = o.property?.zones || [];
  const plowZones = zones.filter(z => z.mode === "plow");
  // flat roadside/dig-out jobs have no plow zones to check off
  const jtA = JOB_TYPES[o.jobType || "driveway"];
  const checkableZones = jtA.basis === "area" ? plowZones : [];

  const [gps, setGps] = useState(null); // real device location {lng, lat, heading}

  useEffect(() => {
    if (o.state !== "accepted" && o.state !== "enroute") return;
    if (eta <= 0) return; // truck has arrived — stop the drive sim
    const iv = setInterval(() => {
      setPos(p => ({ x: p.x + (50 - p.x) * .13, y: p.y + (50 - p.y) * .13 }));
      setEta(e => Math.max(0, +(e - .7).toFixed(1)));
    }, 1000);
    return () => clearInterval(iv);
  }, [o.state, eta]);

  // Real GPS: while a job is active, stream the driver's true location to the map
  // and (when Supabase is on) push it so the customer can watch the truck live.
  useEffect(() => {
    const active = ["accepted", "enroute", "plowing"].includes(o.state);
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const loc = { lng: p.coords.longitude, lat: p.coords.latitude, heading: p.coords.heading || 0 };
        setGps(loc);
        if (supabaseEnabled && state.userId) {
          pushDriverLocation(state.userId, loc.lng, loc.lat, loc.heading);
        }
      },
      () => { /* permission denied / unavailable — keep the simulated route */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [o.state, state.userId]);

  const arrived = eta <= 0 || o.state === "plowing";
  const allChecked = checkableZones.length === 0 || checkableZones.every((_, i) => checks[i]);
  const jobCenter = o.property?.center;
  const initEtaD = o.eta || 8;
  const progD = jobCenter ? Math.min(1, Math.max(0, 1 - eta / initEtaD)) : 0;
  const driverLLD = jobCenter ? { lng: jobCenter.lng - 0.006 * (1 - progD), lat: jobCenter.lat + 0.004 * (1 - progD) } : null;

  const startPlow = () => dispatch({ type: "ORDER_STATE", patch: { state: "plowing" } });
  const complete = () => {
    settleJobPayment(o, dPay, state.driver); // capture the customer's card + pay the driver
    dispatch({ type: "COMPLETE", q: { ...q, driverPay: dPay }, size: o.size });
    dispatch({ type: "ORDER_STATE", patch: { state: "arrived_done", completed: true } });
    dispatch({ type: "TOAST", msg: `Job complete · $${dPay} added to today` });
    notify(dispatch, { kind: "payment", title: `You earned $${dPay}`,
      body: `${o.property?.label || "Job"} complete · paid out to your account.`, role: "driver" });
    notify(dispatch, { kind: "job", title: "Your property is plowed ✓",
      body: `${o.property?.label || "Your driveway"} is clear. Photos are on your receipt.`, role: "rider" });
  };

  // driver's own completion screen
  if (o.state === "arrived_done") {
    return (
      <Fade k="jobdone"><section style={{ paddingTop: 8 }}>
        <div style={{ textAlign: "center", margin: "20px 0" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.push + "22", border: `2px solid ${C.push}`,
            display: "grid", placeItems: "center", margin: "0 auto 16px", fontSize: 30, color: C.push }}>✓</div>
          <h2 style={{ font: `700 30px ${FD}`, margin: 0 }}>Job complete</h2>
          <p style={{ ...sub, marginTop: 6 }}>Nice work. Payout added to today's earnings.</p>
        </div>
        <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 14 }}>
          {insFee > 0 && <Row label="Job pay" value={`$${dGross}`} muted />}
          {insFee > 0 && <Row label="🎟️ Per-event insurance" value={`−$${insFee}`} amber />}
          <Row label="You earned" value={`$${dPay}`} big />
          <Row label="Effective rate" value={`$${dHourly}/hr`} amber />
        </div>
        {(o.photos?.before?.length || o.photos?.after?.length) ? (
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {["before", "after"].map(phase => {
              const p = o.photos?.[phase]?.[0];
              return p ? (
                <div key={phase} style={{ flex: 1, aspectRatio: "1.2", borderRadius: 12, overflow: "hidden",
                  border: `1px solid ${phase === "before" ? C.plow : C.push}55`, position: "relative" }}>
                  <FauxPhoto seed={p.seed} phase={phase} />
                  <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,.6)", borderRadius: 5, padding: "2px 7px", font: `700 9px ${FB}`, color: "#fff" }}>{phase.toUpperCase()}</div>
                </div>
              ) : null;
            })}
          </div>
        ) : null}
        <Btn full kind="good" onClick={() => dispatch({ type: "CLEAR_ORDER" })}>Back online for more jobs</Btn>
      </section></Fade>
    );
  }

  return (
    <section style={{ paddingTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <Eyebrow color={arrived ? C.push : C.amber}>{arrived ? "At the property" : "En route"}</Eyebrow>
          <h2 style={{ font: `700 28px ${FD}`, margin: "6px 0 0" }}>{arrived ? "Plow the job" : `${Math.ceil(eta)} min to site`}</h2>
        </div>
        <div style={{ font: `700 20px ${FD}`, color: C.push }}>${dPay}</div>
      </div>

      {MAP_ENABLED && jobCenter ? (
        <LiveMap center={jobCenter} height={220}
          route={[[(gps || driverLLD).lng, (gps || driverLLD).lat], [jobCenter.lng, jobCenter.lat]]}
          markers={[
            { lng: jobCenter.lng, lat: jobCenter.lat, emoji: "🏁", size: 24 },
            { lng: (gps || driverLLD).lng, lat: (gps || driverLLD).lat, emoji: "🛻", size: 26, pulse: true },
          ]} />
      ) : (
        <StormMap pin="SITE" blips={[{ id: "me", x: pos.x, y: pos.y }]} selected={{ id: "me" }} tracking driverPos={pos} showRoute />
      )}

      {/* navigation / address */}
      <Card style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div style={{ font: `700 14px ${FB}` }}>{o.property?.addr}</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>{o.property?.label} · {(JOB_TYPES[o.jobType || "driveway"]).label}</div></div>
        <Btn sm onClick={() => {
          const ok = openDirections({ lat: jobCenter?.lat, lng: jobCenter?.lng, addr: o.property?.addr });
          dispatch({ type: "TOAST", msg: ok ? "Opening directions in Maps…" : "No address on this job yet" });
        }}>Navigate</Btn>
      </Card>

      {/* density routing: cluster of nearby jobs to batch */}
      {!arrived && <ClusterRoute />}

      {/* chat with the customer */}
      <JobChat jobId={o.jobId} senderId={state.userId} peerName="your customer" seed={[]} />

      {/* property map with zones — the driver's instructions */}
      <div style={{ marginTop: 14 }}>
        <Eyebrow color={C.plow}>Property map</Eyebrow>
        {o.property?.mapImg ? (
        <img src={o.property.mapImg} alt="Property outline" style={{ marginTop: 8, width: "100%", borderRadius: 14, border: `1px solid ${C.line}`, display: "block" }} />
        ) : (
        <div style={{ marginTop: 8, position: "relative", borderRadius: 14, overflow: "hidden", border: `1px solid ${C.line}` }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(115deg,#2c3a2a,#38472f 40%,#2a3526)" }} />
          <svg viewBox="0 0 150 100" preserveAspectRatio="xMidYMid slice" style={{ position: "relative", width: "100%", aspectRatio: "1.7", display: "block" }}>
            <rect x="57" y="20" width="36" height="18" rx="1" fill="#5a4634" /><rect x="70" y="38" width="12" height="42" fill="#4b4b52" opacity=".85" />
            <rect x="18" y="72" width="114" height="9" fill="#3a3a40" opacity=".7" />
            {zones.map((z, i) => {
              const legacy = Math.max(...z.pts.map(p => p.x)) <= 100 && !z._n;
              const pts = legacy ? z.pts.map(p => ({ x: p.x * 1.5, y: p.y })) : z.pts;
              const col = z.mode === "plow" ? C.plow : C.push;
              return (
                <g key={i}>
                  <polygon points={pts.map(p => `${p.x},${p.y}`).join(" ")} fill={col + "3A"} stroke={col} strokeWidth="1.1" strokeLinejoin="round" />
                  {pts.map((p, j) => <circle key={j} cx={p.x} cy={p.y} r="1.4" fill={col} />)}
                </g>
              );
            })}
          </svg>
        </div>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 8, font: `600 11px ${FB}` }}>
          <span style={{ color: C.plow }}>■ Plow these</span><span style={{ color: C.push }}>■ Push snow here</span>
        </div>
      </div>

      {/* arrival -> before photo -> plow -> checklist + after photo -> complete */}
      {arrived && (
        <div style={{ marginTop: 14 }}>
          {o.state !== "plowing" ? (
            <>
              <Eyebrow color={C.plow}>Before you plow</Eyebrow>
              <p style={{ font: `500 12px ${FB}`, color: C.mist, margin: "6px 0 10px" }}>
                Snap a quick "before" photo. The customer sees it as proof of the starting conditions.
              </p>
              <PhotoCapture phase="before" photos={o.photos?.before || []}
                onCapture={(photo) => dispatch({ type: "ADD_PHOTO", phase: "before", photo })} />
              <div style={{ marginTop: 12 }}>
                <Btn full kind="good" onClick={startPlow} disabled={!(o.photos?.before?.length)}>
                  {o.photos?.before?.length ? "Start plowing" : "Take a before photo first"}
                </Btn>
              </div>
            </>
          ) : (
            <>
              {checkableZones.length > 0 && <>
              <Eyebrow>Zone checklist</Eyebrow>
              <div style={{ display: "grid", gap: 8, margin: "10px 0" }}>
                {checkableZones.map((z, i) => (
                  <button key={i} onClick={() => setChecks(c => ({ ...c, [i]: !c[i] }))}
                    style={{ display: "flex", gap: 12, alignItems: "center", textAlign: "left", cursor: "pointer",
                      background: C.slate, border: `1px solid ${checks[i] ? C.push : C.line}`, borderRadius: 12, padding: 13 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: "grid", placeItems: "center",
                      background: checks[i] ? C.push : "transparent", border: `2px solid ${checks[i] ? C.push : C.line}`,
                      color: "#0A2015", fontWeight: 800 }}>{checks[i] ? "✓" : ""}</span>
                    <span style={{ font: `600 13px ${FB}`, color: C.ice }}>Plow zone {i + 1} cleared</span>
                  </button>
                ))}
              </div>
              </>}

              <Eyebrow color={C.push}>After photo</Eyebrow>
              <p style={{ font: `500 12px ${FB}`, color: C.mist, margin: "6px 0 10px" }}>
                Show the finished job. This lands on the customer's receipt.
              </p>
              <PhotoCapture phase="after" photos={o.photos?.after || []}
                onCapture={(photo) => dispatch({ type: "ADD_PHOTO", phase: "after", photo })} />

              <div style={{ marginTop: 14 }}>
                <Btn full onClick={complete} disabled={!allChecked || !(o.photos?.after?.length)}>
                  {!allChecked ? "Check off all zones" : !(o.photos?.after?.length) ? "Add an after photo" : `Complete job · collect $${dPay}`}
                </Btn>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---- Photo capture: simulated camera that produces a faux before/after ----
function PhotoCapture({ phase, photos, onCapture }) {
  const [capturing, setCapturing] = useState(false);
  const snap = () => {
    setCapturing(true);
    setTimeout(() => {
      onCapture({ seed: Math.floor(Math.random() * 90) + 1, phase, ts: Date.now() });
      setCapturing(false);
    }, 550);
  };
  const col = phase === "before" ? C.plow : C.push;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {photos.map((p, i) => (
          <div key={i} style={{ width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: `1px solid ${col}66`, position: "relative" }}>
            <FauxPhoto seed={p.seed} phase={phase} />
            <div style={{ position: "absolute", bottom: 3, left: 3, background: "rgba(0,0,0,.6)", borderRadius: 4, padding: "1px 5px", font: `700 8px ${FB}`, color: "#fff" }}>{phase.toUpperCase()}</div>
          </div>
        ))}
        <button onClick={snap} disabled={capturing}
          style={{ width: 72, height: 72, borderRadius: 10, cursor: capturing ? "default" : "pointer",
            background: C.slate, border: `1.5px dashed ${col}88`, color: col, display: "grid", placeItems: "center" }}>
          {capturing
            ? <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${col}44`, borderTopColor: col, animation: "spin .7s linear infinite" }} />
            : <span style={{ fontSize: 22 }}>📷</span>}
        </button>
      </div>
    </div>
  );
}

function DriverEarnings({ onReferral }) {
  const { state, dispatch } = useStore();
  const e = state.earnings;
  const ref = state.driverReferral;
  const max = Math.max(...e.payouts.map(p => p.amt), 1);
  const [sel, setSel] = useState(null);
  const WEEK_GOAL = 900;
  const goalPct = Math.min(1, e.week / WEEK_GOAL);
  const animWeek = useCountUp(e.week, 600);

  return (
    <Fade k="earn"><section style={{ paddingTop: 4 }}>
      {/* hero balance */}
      <div style={{ borderRadius: 20, padding: S.xl, marginBottom: S.lg, position: "relative", overflow: "hidden",
        background: `linear-gradient(150deg, ${C.amber}1E, ${C.night2})`, border: `1px solid ${C.amber}44` }}>
        <div style={{ position: "absolute", top: -46, right: -30, fontSize: 150, opacity: .06 }}>💰</div>
        <Eyebrow>This week</Eyebrow>
        <div style={{ font: `700 46px/1 ${FD}`, color: C.amber, margin: "8px 0 4px" }}>${animWeek}</div>
        <div style={{ font: `500 13px ${FB}`, color: C.mist, marginBottom: S.lg }}>
          ${e.today} today · {e.jobsToday} job{e.jobsToday !== 1 ? "s" : ""} completed
        </div>
        {/* weekly goal */}
        <div style={{ display: "flex", justifyContent: "space-between", font: `600 11px ${FB}`, color: C.mist, marginBottom: 6 }}>
          <span>Weekly goal</span><span style={{ color: C.ice }}>${e.week} / ${WEEK_GOAL}</span>
        </div>
        <div style={{ height: 8, borderRadius: 8, background: C.night, overflow: "hidden" }}>
          <div style={{ width: `${goalPct * 100}%`, height: "100%",
            background: `linear-gradient(90deg, ${C.amber}, ${C.push})`, transition: `width .8s ${EASE}` }} />
        </div>
      </div>

      {/* quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: S.lg }}>
        <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: S.lg }}>
          <div style={{ font: `700 24px ${FD}`, color: C.ice }}>$92<span style={{ fontSize: 13 }}>/hr</span></div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 3 }}>Active-job rate at peak</div></div>
        <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: S.lg }}>
          <div style={{ font: `700 24px ${FD}`, color: C.push }}>{Math.round(driverPct(state.driver) * 100)}%</div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 3 }}>You keep per job</div></div>
      </div>

      {/* interactive chart */}
      <Card style={{ marginBottom: S.lg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: S.lg }}>
          <Eyebrow color={C.mist}>Daily payouts</Eyebrow>
          {sel && <Chip color={C.amber}>{sel.d} · ${sel.amt}</Chip>}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 9, height: 130 }}>
          {e.payouts.map(p => {
            const on = sel?.d === p.d;
            return (
              <button key={p.d} onClick={() => setSel(on ? null : p)}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                  background: "none", border: "none", cursor: "pointer", padding: 0, WebkitTapHighlightColor: "transparent" }}>
                <div style={{ width: "100%", height: `${(p.amt / max) * 92}px`, borderRadius: "8px 8px 3px 3px",
                  background: on ? `linear-gradient(${C.push},${C.amber})` : `linear-gradient(${C.amber},${C.amberDeep})`,
                  boxShadow: on ? `0 0 0 2px ${C.push}55` : "none",
                  transition: `all .25s ${EASE}` }} />
                <span style={{ font: `600 11px ${FB}`, color: on ? C.ice : C.mist }}>{p.d}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* cash out / payout setup */}
      {STRIPE_ENABLED && !state.driver.stripeAccountId ? (
        <div style={{ background: `linear-gradient(140deg, ${C.plow}18, ${C.night2})`, border: `1px solid ${C.plow}55`,
          borderRadius: 16, padding: S.lg, marginBottom: S.md }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 22 }}>🏦</span>
            <div style={{ font: `700 15px ${FB}`, color: C.ice }}>Set up your payouts</div>
          </div>
          <p style={{ font: `500 12px ${FB}`, color: C.mist, margin: "0 0 14px" }}>
            Connect a bank account through Stripe to get paid — takes about 2 minutes. You keep {Math.round(driverPct(state.driver) * 100)}% of every job, deposited automatically.
          </p>
          <Btn full kind="dark" onClick={async () => {
            dispatch({ type: "TOAST", msg: "Opening secure Stripe setup…" });
            try {
              const r = await createConnectAccount({ driverId: state.userId || "driver",
                email: state.profile.email, returnUrl: window.location.href });
              if (r.onboardingUrl) window.location.href = r.onboardingUrl;
              else dispatch({ type: "TOAST", msg: r.error || "Payouts aren't set up on the server yet" });
            } catch (err) { dispatch({ type: "TOAST", msg: err.message }); }
          }}>Connect bank with Stripe ›</Btn>
          <p style={{ font: `500 11px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
            Secured by Stripe · we never see your bank details
          </p>
        </div>
      ) : (
        <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 16, padding: S.lg, marginBottom: S.md }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: S.md }}>
            <div>
              <div style={{ font: `700 14px ${FB}`, color: C.ice }}>Available now</div>
              <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>Stripe Connect · same-day</div>
            </div>
            <div style={{ font: `700 26px ${FD}`, color: C.push }}>${e.week}</div>
          </div>
          <Btn full kind="good" onClick={() => dispatch({ type: "TOAST", msg: `$${e.week} sent — arrives in seconds` })}>
            Cash out instantly
          </Btn>
          <p style={{ font: `500 11px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
            $0.50 instant fee · free if you wait for Tuesday deposit
          </p>
        </div>
      )}

      {/* referral CTA */}
      <Card onClick={onReferral} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        borderColor: C.push + "55", background: `linear-gradient(120deg, ${C.slate}, ${C.night2})` }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.push + "1E", display: "grid",
            placeItems: "center", fontSize: 19, flexShrink: 0 }}>🤝</div>
          <div><div style={{ font: `700 14px ${FB}` }}>Refer a driver · earn ${ref.reward}</div>
            <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>
              {ref.credit > 0 ? `$${ref.credit} earned · ${ref.invited} referred` : `Paid when they finish ${ref.threshold} jobs`}</div></div></div>
        <span style={{ color: C.push, fontSize: 18 }}>›</span>
      </Card>
    </section></Fade>
  );
}

function DriverAccount({ onReferral }) {
  const { state, dispatch } = useStore();
  const auth = useAuth();
  const d = state.driver;
  const ref = state.driverReferral;
  const docRow = (label, status) => {
    const ok = status === "verified";
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${C.lineSoft}` }}>
        <span style={{ font: `600 13px ${FB}`, color: C.ice }}>{label}</span>
        <Chip color={ok ? C.good : C.amber}>{status}</Chip>
      </div>
    );
  };
  return (
    <section style={{ paddingTop: 4 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: C.slate, border: `1px solid ${C.line}`,
          display: "grid", placeItems: "center", fontSize: 26 }}>🛻</div>
        <div><div style={{ font: `700 19px ${FB}` }}>{d.name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
            <Stars v={d.rating} size={13} /><span style={{ font: `600 12px ${FB}`, color: C.mist }}>{d.rating} · {d.jobs} jobs</span></div></div>
      </div>

      {/* tier — how much of each job you keep, and how to climb */}
      {(() => {
        const cur = driverTier(d);
        const jobs = d.jobs || 0;
        // ladder shown low → high; New-driver bonus sits on top when active
        const ladder = [...DRIVER_TIERS].slice().reverse(); // rookie, pro, veteran, blizzard
        const next = ladder.find(t => t.minJobs > jobs && !cur.intro && t.pct > cur.pct)
          || (cur.intro ? null : ladder.find(t => t.minJobs > jobs));
        return (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <Eyebrow>You keep</Eyebrow>
                <div style={{ font: `800 30px ${FD}`, color: C.push, marginTop: 2, lineHeight: 1 }}>
                  {Math.round(cur.pct * 100)}%<span style={{ font: `600 13px ${FB}`, color: C.mistDim }}> of each job</span>
                </div>
              </div>
              <Chip color={cur.intro ? C.amber : C.push} solid>{cur.label}</Chip>
            </div>

            {cur.intro ? (
              <p style={{ font: `600 12px ${FB}`, color: C.amber, margin: "10px 0 0" }}>
                Welcome bonus — your first {INTRO_JOBS} jobs pay {Math.round(INTRO_PCT * 100)}%. {Math.max(0, INTRO_JOBS - jobs)} to go, then you start at Rookie (70%) and climb.
              </p>
            ) : next ? (
              <p style={{ font: `500 12px ${FB}`, color: C.mistDim, margin: "10px 0 0" }}>
                {next.minJobs - jobs} more jobs → <b style={{ color: C.mist }}>{next.label}</b>, keep {Math.round(next.pct * 100)}%.
              </p>
            ) : (
              <p style={{ font: `500 12px ${FB}`, color: C.mistDim, margin: "10px 0 0" }}>
                Top tier — you keep the most of every job. Nice work.
              </p>
            )}

            {/* the ladder */}
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {ladder.map(t => {
                const active = !cur.intro && cur.id === t.id;
                const reached = jobs >= t.minJobs;
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 11px", borderRadius: 10,
                    background: active ? C.push + "18" : C.slate,
                    border: `1px solid ${active ? C.push + "66" : C.line}`, opacity: reached || active ? 1 : 0.6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ font: `700 12px ${FB}`, color: active ? C.push : C.mist }}>{t.label}</span>
                      <span style={{ font: `500 10px ${FB}`, color: C.mistDim }}>{t.minJobs}+ jobs</span>
                    </div>
                    <span style={{ font: `700 13px ${FD}`, color: active ? C.push : C.mistDim }}>{Math.round(t.pct * 100)}%</span>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {/* equipment — determines which job types you can accept */}
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={C.plow}>Your equipment</Eyebrow>
        <p style={{ font: `500 11px ${FB}`, color: C.mistDim, margin: "6px 0 10px" }}>
          You'll only be offered jobs your gear can handle.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Array.from(new Map(Object.values(JOB_TYPES).map(jt => [jt.tool, jt])).values()).map(jt => {
            const has = d.tools?.includes(jt.tool);
            return (
              <div key={jt.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderRadius: 20,
                background: has ? C.push + "16" : C.slate, border: `1px solid ${has ? C.push + "55" : C.line}`,
                font: `600 11px ${FB}`, color: has ? C.push : C.mistDim }}>
                <span>{jt.icon}</span>{jt.tool}{has ? " ✓" : ""}
              </div>
            );
          })}
        </div>
      </Card>

      {/* documents & insurance */}
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow>Documents & insurance</Eyebrow>
        <div style={{ marginTop: 8 }}>
          {docRow("Driver's license", d.docs.license)}
          {docRow("Commercial plow insurance", d.docs.insurance)}
          {docRow("Vehicle plate / registration", d.docs.plate)}
          {docRow("W-9 / tax info", d.docs.w9)}
        </div>
        <div style={{ marginTop: 12, background: C.night, borderRadius: 12, padding: 12 }}>
          <div style={{ font: `700 12px ${FB}`, color: C.ice }}>{d.insurancePolicy.carrier}</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist, marginTop: 2 }}>{d.insurancePolicy.type} · expires {d.insurancePolicy.expires}</div>
        </div>
        <p style={{ font: `500 11px ${FB}`, color: C.mistDim, margin: "10px 0 0" }}>
          Commercial coverage is required to accept jobs. Platform verifies before you go online.
        </p>
      </Card>

      <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}>🏦</span>
          <div><div style={{ font: `700 13px ${FB}` }}>Payout account</div>
            <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Stripe Connect · ···6789</div></div></div>
        <Chip color={C.good}>Linked</Chip>
      </Card>

      {/* referral entry */}
      <Card onClick={onReferral} style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center",
        borderColor: C.push + "55" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}>🤝</span>
          <div><div style={{ font: `700 13px ${FB}` }}>Refer drivers · earn ${ref.reward} each</div>
            <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Bring on plow operators you trust</div></div></div>
        <span style={{ color: C.push, fontSize: 18 }}>›</span>
      </Card>

      {auth?.isConfigured && auth?.session && (
        <button onClick={async () => { await auth.signOut(); dispatch({ type: "SIGNED_OUT" }); }}
          style={{ width: "100%", marginTop: 14, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12,
            color: C.ice, font: `700 13px ${FB}`, cursor: "pointer", padding: 13 }}>
          Sign out
        </button>
      )}
    </section>
  );
}

function DriverReferral({ onBack }) {
  const { state, dispatch } = useStore();
  const ref = state.driverReferral;
  const simulate = () => {
    const names = ["Tyler R.", "Jake M.", "Cody W.", "Brett L."];
    dispatch({ type: "REFER_DRIVER", name: names[ref.invited % names.length] });
    dispatch({ type: "TOAST", msg: "Driver invite sent!" });
  };
  return (
    <Fade k="dref"><section style={{ paddingTop: 4 }}>
      <button onClick={onBack} style={{ ...miniBtn, marginBottom: 14 }}>‹ Back</button>
      <Eyebrow color={C.push}>Driver referrals</Eyebrow>
      <h2 style={h2}>Earn ${ref.reward} per driver</h2>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `700 24px ${FD}`, color: C.push }}>${ref.credit}</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Bonuses earned</div>
        </div>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `700 24px ${FD}`, color: C.ice }}>{ref.invited}</div>
          <div style={{ font: `500 12px ${FB}`, color: C.mist }}>Drivers referred</div>
        </div>
      </div>

      <ReferralHero code={ref.code} reward={ref.reward} accent={C.push}
        subtitle={`Share your code with plow operators. You earn $${ref.reward} once each referred driver completes ${ref.threshold} jobs.`} />

      <div style={{ marginTop: 14 }}>
        <Btn full kind="good" onClick={simulate}>Invite a driver</Btn>
      </div>

      {ref.activity.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Eyebrow color={C.mist}>Referred drivers</Eyebrow>
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {ref.activity.map((x, i) => (
              <div key={i} style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ font: `700 13px ${FB}` }}>{x.name}</div>
                  <Chip color={C.amber}>{x.jobs}/{ref.threshold} jobs</Chip>
                </div>
                <div style={{ height: 6, borderRadius: 6, background: C.night, overflow: "hidden" }}>
                  <div style={{ width: `${(x.jobs / ref.threshold) * 100}%`, height: "100%", background: `linear-gradient(90deg,${C.push},${C.amber})` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section></Fade>
  );
}

// ============================================================
// SHELL
// ============================================================
// ============================================================
// AUTH SCREEN — real sign up / log in (Supabase)
// ============================================================
function AuthScreen({ auth, onDemo }) {
  const [mode, setMode] = useState("signup"); // signup | signin
  const [role, setRole] = useState("customer"); // customer | driver
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const submit = async () => {
    setErr(""); setInfo("");
    if (!email || !password) { setErr("Enter your email and a password."); return; }
    if (mode === "signup" && password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    const res = mode === "signup"
      ? await auth.signUp({ email, password, name, role })
      : await auth.signIn({ email, password });
    setBusy(false);
    if (res?.error) { setErr(res.error.message || "Something went wrong."); return; }
    if (mode === "signup" && !res?.data?.session) {
      setInfo("Account created — check your email to confirm, then sign in.");
      setMode("signin");
    }
    // on success with a session, the auth listener flips the app in automatically
  };

  const field = (props) => (
    <input {...props} style={{ width: "100%", background: C.slate, color: C.ice, font: `500 15px ${FB}`,
      outline: "none", padding: "13px 14px", borderRadius: 11, border: `1px solid ${C.line}` }} />
  );

  return (
    <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB, display: "flex", justifyContent: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap'); *{box-sizing:border-box} input::placeholder{color:${C.mistDim}}`}</style>
      <div style={{ width: "100%", maxWidth: 440, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 44, filter: "drop-shadow(0 6px 18px rgba(255,176,32,.4))" }}>❄️</div>
          <div style={{ font: `700 26px ${FD}`, letterSpacing: ".08em", marginTop: 6 }}>DRIFT</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 4 }}>
            {mode === "signup" ? "Create your account" : "Welcome back"}</div>
        </div>

        {mode === "signup" && (
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {[["customer", "🏠 I need plowing"], ["driver", "🚜 I plow & earn"]].map(([id, label]) => {
              const on = role === id;
              return (
                <button key={id} onClick={() => setRole(id)} style={{ flex: 1, cursor: "pointer", padding: "13px 8px",
                  borderRadius: 12, background: on ? C.amber + "1E" : C.slate, border: `1.5px solid ${on ? C.amber : C.line}`,
                  color: on ? C.amber : C.mist, font: `700 13px ${FB}` }}>{label}</button>
              );
            })}
          </div>
        )}

        <div style={{ display: "grid", gap: 11 }}>
          {mode === "signup" && field({ value: name, onChange: (e) => setName(e.target.value), placeholder: "Full name" })}
          {field({ value: email, onChange: (e) => setEmail(e.target.value), placeholder: "Email", type: "email", inputMode: "email", autoComplete: "email" })}
          {field({ value: password, onChange: (e) => setPassword(e.target.value), placeholder: "Password", type: "password",
            autoComplete: mode === "signup" ? "new-password" : "current-password",
            onKeyDown: (e) => { if (e.key === "Enter") submit(); } })}
        </div>

        {err && <div style={{ marginTop: 12, font: `600 12px ${FB}`, color: C.danger }}>{err}</div>}
        {info && <div style={{ marginTop: 12, font: `600 12px ${FB}`, color: C.push }}>{info}</div>}

        <div style={{ marginTop: 16 }}>
          <Btn full onClick={submit} disabled={busy}>
            {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}</Btn>
        </div>

        <button onClick={() => { setErr(""); setInfo(""); setMode(mode === "signup" ? "signin" : "signup"); }}
          style={{ width: "100%", marginTop: 14, background: "transparent", border: "none", cursor: "pointer",
            color: C.mist, font: `600 13px ${FB}`, padding: 8 }}>
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>

        <button onClick={onDemo} style={{ width: "100%", marginTop: 6, background: "transparent",
          border: `1px dashed ${C.line}`, borderRadius: 12, cursor: "pointer", color: C.mistDim,
          font: `600 12px ${FB}`, padding: 11 }}>
          Skip — just explore the demo
        </button>
      </div>
    </div>
  );
}


// ---- Operator dashboard (private, ?ops=1) ---------------------------------
const OPS_STATUS = {
  requested: { label: "Requested", c: C.mist },
  accepted: { label: "Accepted", c: C.plow },
  enroute: { label: "En route", c: C.plow },
  plowing: { label: "Plowing", c: C.amber },
  completed: { label: "Done", c: C.push },
  cancelled: { label: "Cancelled", c: C.danger },
};

function OpsTile({ label, value, accent = C.ice, sub }) {
  return (
    <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ font: `600 11px ${FB}`, letterSpacing: ".08em", textTransform: "uppercase", color: C.mistDim }}>{label}</div>
      <div style={{ font: `800 26px ${FD}`, color: accent, marginTop: 6, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ font: `500 11px ${FB}`, color: C.mistDim, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function OpsDashboard() {
  const { state } = useStore();
  const [remote, setRemote] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let ok = true;
    fetch("/api/ops-summary")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (ok) { setRemote(d && !d.error ? d : null); setLoaded(true); } })
      .catch(() => { if (ok) setLoaded(true); });
    return () => { ok = false; };
  }, []);

  // Fallback view from this session's own data until the admin feed is live.
  const local = useMemo(() => {
    const hist = state.history || [];
    const rev = hist.reduce((s, h) => s + (h.total || 0), 0);
    const active = state.order && state.order.state !== "arrived_done" ? [state.order] : [];
    const pay = Math.round(rev * 0.8);
    return {
      kpis: { jobsToday: hist.length + active.length, activeNow: active.length, completedToday: hist.length,
        revenueToday: rev, payoutsToday: pay, platformToday: rev - pay, tipsToday: 0 },
      activeDrivers: state.driverOnline ? 1 : 0,
      jobs: [
        ...active.map(o => ({ status: o.state === "arrived_done" ? "completed" : o.state,
          price: o.quote?.riderTotal, driver_pay: o.quote?.driverPay, job_type: o.jobType,
          address: o.property?.addr || o.property?.label, customer: state.profile?.name || "Customer",
          driver: state.driver?.name })),
        ...hist.map(h => ({ status: "completed", price: h.total, job_type: "driveway",
          address: h.size, customer: "—", driver: h.driver })),
      ],
    };
  }, [state]);

  const data = remote || local;
  const live = !!remote;
  const k = data.kpis;
  const money = (n) => `$${Math.round(n || 0).toLocaleString()}`;

  return (
    <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap'); *{box-sizing:border-box}`}</style>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "26px 20px 60px" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(150deg, ${C.amberSoft}, ${C.amber})`,
              color: "#231603", display: "grid", placeItems: "center", fontWeight: 800 }}>❄</div>
            <div style={{ font: `800 22px ${FD}`, letterSpacing: ".06em" }}>DRIFT OPS</div>
          </div>
          <a href="/" style={{ font: `700 12px ${FB}`, color: C.mist, textDecoration: "none",
            border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px" }}>← Back to app</a>
        </div>
        <div style={{ font: `500 13px ${FB}`, color: live ? C.push : C.amber, marginBottom: 20 }}>
          {!loaded ? "Loading…" : live ? "● Live — connected to your database" : "Demo data — add the Supabase admin key to go live (see SETUP.md)"}
        </div>

        {/* KPI grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
          <OpsTile label="Jobs today" value={k.jobsToday} />
          <OpsTile label="Active now" value={k.activeNow} accent={C.amber} sub={`${data.activeDrivers} driver${data.activeDrivers !== 1 ? "s" : ""} out`} />
          <OpsTile label="Completed" value={k.completedToday} accent={C.push} />
          <OpsTile label="Revenue" value={money(k.revenueToday)} accent={C.amber} sub={`${money(k.platformToday)} platform`} />
          <OpsTile label="Driver payouts" value={money(k.payoutsToday)} accent={C.plow} />
          <OpsTile label="Tips" value={money(k.tipsToday)} accent={C.push} />
        </div>

        {/* jobs table */}
        <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.line}`, font: `700 14px ${FB}` }}>
            Today's jobs {data.jobs.length ? `· ${data.jobs.length}` : ""}
          </div>
          {data.jobs.length === 0 ? (
            <div style={{ padding: "34px 18px", textAlign: "center", color: C.mistDim, font: `500 13px ${FB}` }}>
              No jobs yet today. They'll appear here live as customers book.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr style={{ font: `600 10px ${FB}`, letterSpacing: ".07em", textTransform: "uppercase", color: C.mistDim }}>
                    {["Status", "Type", "Location", "Customer", "Driver", "Price", "Pay"].map(h => (
                      <th key={h} style={{ textAlign: h === "Price" || h === "Pay" ? "right" : "left", padding: "10px 14px", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j, i) => {
                    const st = OPS_STATUS[j.status] || OPS_STATUS.requested;
                    const jt = JOB_TYPES[j.job_type] || JOB_TYPES.driveway;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}55`, font: `500 12px ${FB}` }}>
                        <td style={{ padding: "11px 14px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `700 11px ${FB}`, color: st.c }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.c }} />{st.label}
                          </span>
                        </td>
                        <td style={{ padding: "11px 14px", color: C.mist }}>{jt.icon} {jt.label}</td>
                        <td style={{ padding: "11px 14px", color: C.ice, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.address || "—"}</td>
                        <td style={{ padding: "11px 14px", color: C.mist }}>{j.customer || "—"}</td>
                        <td style={{ padding: "11px 14px", color: C.mist }}>{j.driver || "Unassigned"}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", color: C.ice, fontWeight: 700 }}>{j.price ? money(j.price) : "—"}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", color: C.push }}>{j.driver_pay ? money(j.driver_pay) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p style={{ font: `500 11px ${FB}`, color: C.mistDim, marginTop: 16, textAlign: "center" }}>
          Private operator view · bookmark <code style={{ color: C.mist }}>?ops=1</code>. Add a password before sharing beyond you.
        </p>
      </div>
    </div>
  );
}

function Shell() {
  const [state, dispatch] = useReducer(reducer, initial);
  const store = useMemo(() => ({ state, dispatch }), [state]);
  const auth = useAuth();
  const [bypass, setBypass] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [entered, setEntered] = useState(false); // false = show the marketing homepage first

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: "TOAST", msg: null }), 2600);
    return () => clearTimeout(t);
  }, [state.toast]);

  // Pull fresh storm conditions on load (no-op with demo data; live once a
  // weather API key is set — see src/lib/weather.js).
  useEffect(() => { refreshConditions(); refreshMarket(); }, []);


  // Keep the persisted job row in sync as the order moves through its lifecycle
  // (best-effort; only fires once the job has a real Supabase id).
  useEffect(() => {
    const o = state.order;
    if (!o?.jobId) return;
    const statusMap = { requested: "requested", accepted: "accepted", enroute: "enroute",
      plowing: "plowing", arrived_done: "completed" };
    const status = statusMap[o.state];
    if (!status) return;
    const patch = { status };
    if (o.eta != null) patch.eta_minutes = Math.round(o.eta);
    if (status === "completed") {
      patch.completed_at = new Date().toISOString();
      patch.photos = o.photos || undefined;
      patch.driver_pay = o.quote?.driverPay ?? undefined;
    }
    patchJob(o.jobId, patch);
  }, [state.order?.state, state.order?.jobId]);

  // Hydrate the app from the signed-in account (profile + saved properties).
  useEffect(() => {
    if (!supabaseEnabled || !auth.session || !auth.profile) return;
    let cancelled = false;
    (async () => {
      const role = auth.profile.role === "driver" ? "driver" : "rider";
      let props = [];
      if (role === "rider") {
        const { data } = await loadProperties(auth.user.id);
        props = data || [];
      }
      if (cancelled) return;
      dispatch({ type: "HYDRATE_USER", userId: auth.user.id, role,
        profile: { name: auth.profile.name || "", phone: auth.profile.phone || "", email: auth.profile.email || "" },
        properties: props });
    })();
    return () => { cancelled = true; };
  }, [auth.session, auth.profile]);

  // Persist a customer's properties to Supabase whenever they change.
  useEffect(() => {
    if (!supabaseEnabled || !state.userId || state.role !== "rider") return;
    replaceProperties(state.userId, state.properties);
  }, [state.properties]);

  const onboarding = state.role === "rider" && !state.onboarded;
  const driverSetup = state.role === "driver" && !state.driverOnboarded;
  const inSetup = onboarding || driverSetup;

  // DEV ONLY — floating "Skip" that clears the auth gate + both onboarding flows. Remove before production.
  const devSkip = () => { setBypass(true); dispatch({ type: "DEV_SKIP" }); };
  const SkipButton = (
    <button onClick={devSkip} title="Dev: skip setup"
      style={{ position: "fixed", top: "calc(10px + env(safe-area-inset-top))", right: 12, zIndex: 9999,
        font: `700 11px ${FB}`, letterSpacing: ".04em", color: "#231603",
        background: `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})`, border: "none",
        padding: "7px 12px", borderRadius: 20, cursor: "pointer",
        boxShadow: "0 3px 12px rgba(0,0,0,.4)", WebkitTapHighlightColor: "transparent" }}>
      Skip ⏭
    </button>
  );

  // Operator dashboard — private ops cockpit at ?ops=1 (for the business owner).
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ops") === "1") {
    return <StoreCtx.Provider value={store}><OpsDashboard /></StoreCtx.Provider>;
  }

  // Auth gate: when Supabase is configured, require sign-in (demo escape hatch stays).
  if (supabaseEnabled && auth.loading) {
    return <div style={{ minHeight: "100vh", background: C.night, color: C.mist, fontFamily: FB,
      display: "grid", placeItems: "center" }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", border: `3px solid ${C.line}`,
        borderTopColor: C.amber, animation: "spin .7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>;
  }
  // Marketing homepage: the public front door for anyone not signed in yet.
  if (!auth.session && !bypass && !entered) {
    return <>{SkipButton}<Landing onStart={() => setEntered(true)} /></>;
  }

  if (supabaseEnabled && !auth.session && !bypass) {
    return <>{SkipButton}<AuthScreen auth={auth} onDemo={() => setBypass(true)} /></>;
  }

  return (
    <StoreCtx.Provider value={store}>
      {SkipButton}
      <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB, display: "flex", justifyContent: "center" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
          *{box-sizing:border-box} button{font-family:inherit} input{font-family:inherit}
          ::-webkit-scrollbar{width:0}
          input::placeholder{color:${C.mistDim}}
          @keyframes pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}
          @keyframes rise{from{transform:translateY(48px);opacity:0}to{transform:translateY(0);opacity:1}}
          @keyframes fadeIn{from{opacity:0}to{opacity:1}}
          @keyframes toastIn{0%{transform:translate(-50%,18px);opacity:0}60%{transform:translate(-50%,-3px)}100%{transform:translate(-50%,0);opacity:1}}
          @keyframes ping{0%{transform:scale(1);opacity:.9}100%{transform:scale(2.4);opacity:0}}
          @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
          @keyframes fall{to{transform:translateY(210px)}}
          @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
          @media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
        `}</style>

        <div style={{ width: "100%", maxWidth: 440, minHeight: "100vh", background: C.night, display: "flex", flexDirection: "column", position: "relative" }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: `calc(${S.md}px + env(safe-area-inset-top)) ${S.xl}px ${S.md}px`, position: "sticky", top: 0, zIndex: 30,
            background: "rgba(8,18,31,.86)", backdropFilter: "blur(16px)",
            borderBottom: `1px solid ${C.line}66` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10,
                background: `linear-gradient(150deg, ${C.amberSoft}, ${C.amber})`, color: "#231603",
                display: "grid", placeItems: "center", fontSize: 17, fontWeight: 800,
                boxShadow: "0 4px 14px rgba(255,176,32,.32)" }}>❄</div>
              <div>
                <div style={{ font: `700 20px/1 ${FD}`, letterSpacing: ".07em" }}>DRIFT</div>
                <div style={{ font: `600 9px ${FB}`, letterSpacing: ".14em", color: C.mistDim, marginTop: 1 }}>DULUTH, MN</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Bell count={unreadCount(state)} onClick={() => setNotifOpen(true)} />
              {inSetup ? (
                <button onClick={() => dispatch({ type: "ROLE", role: onboarding ? "driver" : "rider" })}
                  style={{ ...miniBtn, minHeight: 34, fontSize: 12 }}>
                  {onboarding ? "Drive & earn ›" : "Need a plow ›"}</button>
              ) : (
                <div style={{ display: "flex", background: C.night2, border: `1px solid ${C.line}`, borderRadius: 22, padding: 3 }}>
                  {["rider", "driver"].map(r => (
                    <button key={r} onClick={() => dispatch({ type: "ROLE", role: r })}
                      style={{ font: `700 12px ${FB}`, minHeight: 32, padding: "0 15px", borderRadius: 18, cursor: "pointer", border: "none",
                        background: state.role === r ? `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})` : "transparent",
                        color: state.role === r ? "#231603" : C.mist, textTransform: "capitalize",
                        boxShadow: state.role === r ? "0 2px 8px rgba(255,176,32,.3)" : "none",
                        transition: `background .25s ${EASE}, color .2s`, WebkitTapHighlightColor: "transparent" }}>{r}</button>
                  ))}
                </div>
              )}
            </div>
          </header>

          <OfflineBanner />

          {state.order && !inSetup && (
            <div style={{ margin: "0 20px 8px", background: C.slate2, border: `1px solid ${C.amber}55`, borderRadius: 10,
              padding: "8px 12px", font: `600 11px ${FB}`, color: C.amber, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.amber, boxShadow: `0 0 8px ${C.amber}` }} />
              Live job — visible on both sides. Toggle above to watch the other.
            </div>
          )}

          {onboarding ? <Onboarding />
            : state.role === "rider" ? <RiderApp />
            : !state.driverOnboarded ? <DriverOnboarding />
            : <DriverApp />}
          <Toast msg={state.toast} />
          {notifOpen && <NotificationSheet onClose={() => setNotifOpen(false)} />}
        </div>
      </div>
    </StoreCtx.Provider>
  );
}

export default function App() { return <Shell />; }
