import React, { useState, useEffect, useRef, useMemo, createContext, useContext, useReducer } from "react";
import { staticMapUrl, MAP_ENABLED, hazardsChecked, hazardLabels } from "./mapConfig.js";
// The map library is big (~1.6 MB) — load it only when a map is actually on screen.
const MapDesignerLazy = React.lazy(() => import("./PropertyMap.jsx"));
const LiveMapLazy = React.lazy(() => import("./PropertyMap.jsx").then((m) => ({ default: m.LiveMap })));
const mapPlaceholder = (h) => <div style={{ height: h, background: C.mapBg, borderRadius: 14 }} />;
function MapPropertyDesigner(props) {
  return <React.Suspense fallback={mapPlaceholder(360)}><MapDesignerLazy {...props} /></React.Suspense>;
}
function LiveMap(props) {
  return <React.Suspense fallback={mapPlaceholder(props.height || 220)}><LiveMapLazy {...props} /></React.Suspense>;
}
import { useAuth } from "./lib/auth.jsx";
import { supabaseEnabled } from "./lib/supabase.js";
import { recordLegalAcceptance, loadProperties, replaceProperties, rateJob, pushDriverLocation, subscribeToDriverLocation, createJobFromOrder, patchJob, sendMessage, subscribeToMessages, loadMessages,
  updateMyProfile, rowToOrder, fetchJob, listOpenJobs, listScheduledJobs, listMyQueue, queuePosition, lastCompletedJob, subscribeOpenJobs, claimJob, getProfile, profileToDriver, setDriverStatus, becomeDriver, cancelJob, expireJob, subscribeToJob, loadActiveJob, loadAccountStats, loadReviews, listFavorites, addFavorite, removeFavorite, setSnowAlerts, listRegulars, driverYear, saveJobMiles } from "./lib/db.js";
import { STRIPE_ENABLED, STRIPE_PK, getStripe, startHold, confirmHold, cancelJobPaid, completeJobPaid, tipJob, connectSession, connectStatus, connectDashboard, authedFetch, announceJob,
  schedClaim, schedBackout, schedCheckin, schedStart, schedTick, previewJobs, reportIssue, marketStats } from "./lib/payments.js";
import { LEVELS, driverLevel, nextLevel, mileageRate } from "./lib/levels.js";
import { uploadJobPhoto, uploadDriverDoc, myDriverDocs, signedUrl } from "./lib/photos.js";
import { unlockRinger, startRing, stopRing, keepAwake, isStandalone, isIOS, canPromptInstall, promptInstall,
  onInstallChange, pushSupported, enablePush, pushEnabled, localAlert } from "./lib/alerts.js";
import { loadConnectAndInitialize } from "@stripe/connect-js/pure";
import { ConnectComponentsProvider, ConnectAccountOnboarding, ConnectNotificationBanner } from "@stripe/react-connect-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { snowDepthNow, nextStorm, refreshConditions, fetchSnowForecast } from "./lib/weather.js";
import { deliverExternal } from "./lib/notify.js";
import { surgePct as marketSurgePct, surgeLabel as marketSurgeLabel, SURGE, refreshMarket } from "./lib/market.js";
import Landing from "./Landing.jsx";
import Icon from "./Icon.jsx";
import { C, E, FD, FB, FM, applyTheme, getThemeMode, onThemeChange, isLight } from "./theme.js";
import { LegalReader, LegalHub, CustomerConsent, DriverConsent, ConsentGate, hasCurrentAcceptance } from "./LegalDocs.jsx";

// ============================================================
// DRIFT — two-sided snowplow marketplace
// Customer app + driver app share live state. Colors, type and depth come from
// src/theme.js (dark + light), so every screen switches together.
// ============================================================

// spacing scale — everything snaps to this so rhythm is consistent
const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
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
  driveway: { id: "driveway", label: "Driveway plow", icon: "plowtruck", tool: "Plow truck",
    // Full rate until the plow price reaches $50, then HALF rate per sq ft above that,
    // so big driveways don't get priced out.
    basis: "area", base: 25, rate: 0.035, kneePrice: 50, rateAfterKnee: 0.0175,
    minsPer1000: 22, minMins: 18, blurb: "Clear your drive & apron" },
  sidewalk: { id: "sidewalk", label: "Sidewalk clear", icon: "broom", tool: "Snowblower",
    basis: "linear", base: 15, rate: 0.35, minsPerFt: 0.5, minMins: 15, blurb: "Sidewalks and walkways" },
  digout: { id: "digout", label: "Car dig-out", icon: "car", tool: "Snowblower / shovel",
    basis: "flat", base: 45, mins: 25, blurb: "Free your street-parked car after a plow berm" },
  // Roadside jump-start — a minor add-on, not a core service. Flat-rate, no zones.
  jumpstart: { id: "jumpstart", label: "Jump-start", icon: "battery", tool: "Roadside kit",
    basis: "flat", base: 40, mins: 15, blurb: "Dead battery in the cold — back on the road" },
};

// ---- Snow depth (deep snow is a bigger, slower job → higher suggested price) ----
// Pre-filled from the weather service; the customer taps a different one if it's wrong.
const DEPTHS = [
  { id: "light", label: 'Up to 4"', mult: 1.00 },
  { id: "mid",   label: '4–8"',     mult: 1.15 },
  { id: "deep",  label: '8–12"',    mult: 1.30 },
  { id: "heavy", label: '12"+',     mult: 1.50 },
];
const depthById = (id) => DEPTHS.find((d) => d.id === id) || DEPTHS[0];
const depthForInches = (inches) => DEPTHS[inches >= 12 ? 3 : inches >= 8 ? 2 : inches >= 4 ? 1 : 0];
const NO_DEPTH = ["jumpstart"]; // snow depth doesn't change a jump-start

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

// ---- Marketplace pricing: the CUSTOMER names the price ---------------------
// Customer pays : their OFFER + a $10 call-out fee (100% to the driver) + a $5 DRIFT fee.
// Driver earns  : 80% of the offer + the full $10 call-out + 100% of tips — shown
//                 before they accept, and they can pass on any offer, no penalty.
// DRIFT earns   : the $5 fee + 20% of the offer.
// DRIFT only RECOMMENDS an offer from square footage. "Standard" is set so the
// total matches the old fixed price (rates stay the same); the customer decides.
const CALLOUT_FEE = 10;     // flat, goes entirely to the driver
const DRIFT_FEE = 5;        // DRIFT's booking fee
const DRIVER_SHARE = 0.80;  // of the customer's offer
const OFFER_MIN = 10, OFFER_MAX = 500, OFFER_STEP = 2;
const OFFER_TIERS = [
  { id: "standard", label: "Standard", mult: 1.00, note: "Fair rate" },
  { id: "recommended", label: "Recommended", mult: 1.15, note: "Faster pickup" },
  { id: "priority", label: "Priority", mult: 1.35, note: "First in line" },
];
// Price a quote at a specific offer (the customer's number).
function withOffer(q, offer) {
  const o = Math.min(OFFER_MAX, Math.max(OFFER_MIN, Math.round(offer)));
  const driverPay = Math.round(o * DRIVER_SHARE) + CALLOUT_FEE;
  const riderTotal = o + CALLOUT_FEE + DRIFT_FEE;
  return { ...q, offer: o, baseAmount: o, calloutFee: CALLOUT_FEE, driftFee: DRIFT_FEE,
    riderTotal, driverPay, platformFee: riderTotal - driverPay, fee: riderTotal - driverPay, platformNet: riderTotal - driverPay,
    hourly: Math.round((driverPay / ((q.mins || 25) + DRIVE_OVERHEAD_MIN)) * 60),
    low: o < (q.standardOffer || 0) };
}

// Flat DRIFT fee on every order — the platform's flat take on top of the driver's
// price. 100% yours, never shared with the driver. One number to tune your fee.

// ---- Salting add-on (optional, stacks on any driveway / walk job) ----
// Salt is priced separately and is NOT storm-surged — a bag of ice-melt costs
// the same whether it's a dusting or a blizzard. Riders toggle it on; drivers
// with salt on their profile see it called out on the job card.
const SALT = {
  rate: 0.15, mins: 6,   // salting adds 15% of the job price
  appliesTo: [],         // salting removed from the marketplace — empty = never offered
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
];

const SEED_DRIVER = {
  name: "Marcus T.", rating: 4.9, jobs: 412, truck: "F-350 · 9ft V-Plow", power: 5,
  tools: ["Plow truck", "Snowblower", "Snowblower / shovel", "Roadside kit"], // equipped for all job types
  x: 62, y: 38, lng: -92.101, lat: 46.801,
  docs: { license: "received", plate: "received", w9: "pending" }, // the driver's own upload status
};

const SEED_PROPERTIES = [
  { id: "p1", label: "Home", addr: "1420 Woodland Ave", center: { lng: -92.0905, lat: 46.8149 }, hazardsChecked: true, grade: "moderate", hazards: ["ice_prone"], shared: false,
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
const PLATFORM_RATE = 0.15; // reference cut for the legacy bucket quote

// Flat marketplace split: the driver keeps 80% of the job price, DRIFT keeps 20%
// (plus the flat $10 fee on top). Same rate for every driver — no tiers.
const driverPct = (driver) => 0.80;
// Driver's gross pay for a job: 80% of the offer + the $10 call-out. The DRIFT fee is NOT
// shared — it's 100% the platform's.
const driverGrossPay = (q, driver) =>
  Math.round((q?.baseAmount || 0) * driverPct(driver)) + (q?.calloutFee || 0);

// DRIFT provides no insurance and deducts nothing from driver pay.
// Net take-home = gross pay.
const driverNetPay = (q, driver) => Math.max(0, driverGrossPay(q, driver));
const driverHourlyFor = (dPay, mins) => Math.round((dPay / ((mins || 25) + DRIVE_OVERHEAD_MIN)) * 60);

// ---- Unified quote: honest, transparent pricing ---------------------------
// riderTotal = base + area/linear (× site factors) + optional salt. That's it —
// what the customer sees is what they pay, and the breakdown adds up to it.
function quoteJob({ jobType = "driveway", sqft = 0, linearFt = 0, property = null, salt = false, depth = "light" }) {
  const jt = JOB_TYPES[jobType] || JOB_TYPES.driveway;
  let base, mins;
  if (jt.basis === "area") {
    const kneeSqft = jt.kneePrice ? (jt.kneePrice - jt.base) / jt.rate : Infinity;
    base = jt.base + Math.min(sqft, kneeSqft) * jt.rate
      + Math.max(0, sqft - kneeSqft) * (jt.rateAfterKnee ?? jt.rate);
    mins = Math.max(jt.minMins, Math.round((sqft / 1000) * jt.minsPer1000));
  } else if (jt.basis === "linear") {
    base = jt.base + linearFt * jt.rate;
    mins = Math.max(jt.minMins, Math.round(linearFt * jt.minsPerFt));
  } else { // flat
    base = jt.base;
    mins = jt.mins;
  }
  const mod = modifierMultiplier(property);
  const dep = NO_DEPTH.includes(jobType) ? DEPTHS[0] : depthById(depth);
  mins = Math.round(mins * dep.mult);
  const coreBase = Math.max(PRICING.minTotal, base * mod * dep.mult); // the plow price
  // Demand surcharge removed from the marketplace — the customer's price is the price.
  const surgePct = 0;
  const surgeFee = 0;
  // Optional salting add-on — priced off the pre-storm base (salt isn't storm-priced).
  const saltable = SALT.appliesTo.includes(jobType);
  const saltFee = salt && saltable ? Math.round(coreBase * SALT.rate) : 0; // +15% of the job
  const saltMins = saltFee ? SALT.mins : 0;

  // Recommended offers. Standard = old fixed job price minus $5, so that
  // Standard + $10 call-out + $5 DRIFT fee equals what the old price totaled.
  const standard = Math.max(OFFER_MIN, Math.round(coreBase + saltFee) - (CALLOUT_FEE + DRIFT_FEE - 10));
  const tiers = OFFER_TIERS.map(t => ({ ...t, offer: Math.max(OFFER_MIN, Math.round(standard * t.mult)) }));
  const q = {
    jobType, jt, sqft, linearFt, mod,
    depth: dep.id, depthLabel: dep.label, depthMult: dep.mult,
    salt: !!saltFee, saltFee, saltable,
    surge: false, surgeFee, surgePct, surgeLabel: "",
    preSurge: Math.round(coreBase),
    mins: mins + saltMins, tool: jt.tool,
    standardOffer: standard, tiers, suggested: tiers[1].offer,
  };
  return withOffer(q, q.suggested); // default: the Recommended offer
}

// AREA-BASED quote kept as a thin wrapper for existing callers.
function areaQuote(sqft, property = null) {
  return quoteJob({ jobType: "driveway", sqft, property });
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

// Signed agreements (version + timestamp). Kept on the device and, with Supabase on,
// written to the legal_acceptances table — that record is your proof of agreement.
function loadLegal() {
  try { return JSON.parse(localStorage.getItem("drift-legal") || "null") || { customer: null, driver: null }; }
  catch (e) { return { customer: null, driver: null }; }
}
function saveLegal(legal) { try { localStorage.setItem("drift-legal", JSON.stringify(legal)); } catch (e) { /* private mode */ } }

const AdminApp = React.lazy(() => import("./Admin.jsx"));

// ---- Deep links: notification taps + home-screen shortcuts ----------------
// ?job=<id> (customer job) · ?offer=<id> (driver: a new request) · ?route=1
// (driver: scheduled route / check-in) · ?go=book|jumpstart|drive · ?rebook=1
const deepLink = { job: null, offer: null, route: false, go: null, rebook: false };
const linkListeners = new Set();
function readLink(search) {
  const q = new URLSearchParams(search || "");
  Object.assign(deepLink, { job: q.get("job"), offer: q.get("offer"), route: q.has("route"), go: q.get("go"), rebook: q.has("rebook") });
}
if (typeof window !== "undefined") {
  readLink(window.location.search);
  try {
    navigator.serviceWorker?.addEventListener("message", (e) => {
      if (e.data?.type !== "open" || !e.data.url) return;
      readLink(new URL(e.data.url, window.location.origin).search);
      linkListeners.forEach((f) => f({ ...deepLink }));
    });
  } catch { /* no service worker */ }
}
function useDeepLink() {
  const [l, setL] = useState(() => ({ ...deepLink }));
  useEffect(() => { linkListeners.add(setL); return () => linkListeners.delete(setL); }, []);
  return l;
}
const consumeLink = (k) => { deepLink[k] = (k === "route" || k === "rebook") ? false : null; };
const ADMIN_ROUTE = typeof window !== "undefined" && ["admin", "ops"].some((k) => new URLSearchParams(window.location.search).has(k));

// Came from the "Drive with DRIFT" page (/?drive=1): open straight into driver sign-up.
const DRIVE_INTENT = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("drive") === "1";
let driveIntentPending = DRIVE_INTENT; // applied once, on the first account load
// The demo (fake driver "Marcus", fake card, Skip buttons) only exists when there's
// no real backend, or when someone opens the site with ?demo=1 on purpose.
const DEMO_OK = typeof window !== "undefined" && (!supabaseEnabled || (new URLSearchParams(window.location.search).get("demo") === "1"
  && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)));

const initial = {
  legal: loadLegal(),
  role: DRIVE_INTENT ? "driver" : "rider", // rider | driver
  onboarded: false,                 // fresh customer -> guided setup first
  profile: { name: "", phone: "", email: "" },
  payment: null,                    // { brand, last4 } once added
  driverOnline: false,
  driverOnboarded: false,           // drivers finish onboarding before going online
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
// Record a signed agreement: app state + device + (when configured) the database.
function acceptLegal(dispatch, rec, userId) {
  dispatch({ type: "ACCEPT_LEGAL", rec });
  if (supabaseEnabled && userId) recordLegalAcceptance(userId, rec);
}

// LIVE = real accounts + a real database. Otherwise the app runs its built-in demo.
const isLive = (state) => supabaseEnabled && !!state?.userId;

// Orders the customer cancelled before the database confirmed them — if the
// insert lands afterwards we cancel it right away so no driver can take it.
const cancelledBeforeSaved = new Set();

function persistNewJob(dispatch, order, userId) {
  if (!supabaseEnabled || !userId) return;
  createJobFromOrder(order, userId)
    .then((res) => {
      const row = res?.data;
      if (!row?.id) {
        dispatch({ type: "CLEAR_ORDER" });
        dispatch({ type: "TOAST", msg: res?.error?.message ? `Couldn't send your request — ${res.error.message}` : "Couldn't send your request. Check your connection and try again." });
        return;
      }
      if (cancelledBeforeSaved.has(order.id)) {
        cancelledBeforeSaved.delete(order.id);
        if (row.payment_status === "not_required") cancelJob(row.id); else cancelJobPaid(row.id).catch(() => {});
        return;
      }
      if (row.payment_status === "not_required") announceJob(row.id); // ring online drivers
      dispatch({ type: "ORDER_STATE", patch: { jobId: row.id, live: true, paymentStatus: row.payment_status,
        expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
        quote: { ...order.quote, riderTotal: Number(row.price), driverPay: Number(row.driver_pay) } } });
    })
    .catch(() => {
      dispatch({ type: "CLEAR_ORDER" });
      dispatch({ type: "TOAST", msg: "Couldn't send your request. Check your connection and try again." });
    });
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

// Add money to today's bar in the 7-day earnings chart (the last entry is today).
function bumpToday(payouts = [], amt = 0) {
  const list = payouts.length ? [...payouts] : [{ d: new Date().toLocaleDateString(undefined, { weekday: "short" }), amt: 0 }];
  const last = list.length - 1;
  list[last] = { ...list[last], amt: Math.round(((list[last].amt || 0) + Number(amt || 0)) * 100) / 100 };
  return list;
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
        docs: { ...(s.driver.docs || {}), ...(a.docs || {}) } },
      driverReferral: { ...s.driverReferral, code: a.name ? "PLOW-" + a.name.split(" ")[0].toUpperCase() : s.driverReferral.code },
    };
    case "QUEUE": return { ...s, queued: s.queued + 1 };
    case "DRIVER_PATCH": return { ...s, driver: { ...s.driver, ...a.patch } };
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
      // Real account: drop the demo's made-up earnings, trips and driver.
      const real = { earnings: { today: 0, week: 0, jobsToday: 0, payouts: [] }, history: s.userId === a.userId ? s.history : [] };
      if (a.role === "driver") {
        const d = a.driver || {};
        return { ...s, ...real, userId: a.userId, role: "driver", profile: a.profile || s.profile,
          driverOnboarded: !!a.isDriver,
          driver: { ...s.driver, id: a.userId, name: d.name || a.profile?.name || "",
            truck: d.truck || "", tools: d.tools || [], rating: d.rating ?? null, reviews: d.reviews || 0, jobs: d.jobs ?? 0, lng: null, lat: null,
            lateCancels: d.lateCancels || 0, home: d.home || null, homeRadius: d.homeRadius ?? null } };
      }
      const props = a.properties || [];
      return { ...s, ...real, userId: a.userId, role: "rider", profile: a.profile || s.profile,
        driver: { ...s.driver, id: a.userId, name: a.profile?.name || "", rating: null, jobs: 0, truck: "", tools: [], lng: null, lat: null },
        properties: props, activeProperty: props[0] || null, onboarded: props.length > 0 };
    }
    case "SET_ORDER": return { ...s, order: a.order };
    case "ACCOUNT_STATS": return { ...s, history: a.history, earnings: { ...s.earnings, ...a.earnings } };
    case "SIGNED_OUT": return { ...initial, legal: loadLegal() };
    case "ACCEPT_LEGAL": {
      const legal = { ...s.legal, [a.rec.role]: a.rec };
      saveLegal(legal);
      return { ...s, legal };
    }
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
    case "UPDATE_DRIVER": return { ...s, driver: { ...s.driver, ...a.patch } };
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
    // Ignore late updates for a job that no longer exists (e.g. a match timer firing
    // after the customer cancelled) — otherwise a half-built "ghost" order appears.
    case "ORDER_STATE": return s.order ? { ...s, order: { ...s.order, ...a.patch } } : s;
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
          jobsWeek: (s.earnings.jobsWeek || 0) + 1,
          payouts: bumpToday(s.earnings.payouts, q.driverPay),
        },
        history: [{ id: "h" + Date.now(), date: "Today", size: a.size?.label || "", total: q.riderTotal,
          driver: a.driverName || s.driver.name, rating: 0, photos: s.order?.photos || null }, ...s.history],
      };
    }
    case "CLEAR_ORDER": return { ...s, order: null };
    case "TIP": return { ...s, earnings: { ...s.earnings,
      today: s.earnings.today + a.amt, week: s.earnings.week + a.amt, payouts: bumpToday(s.earnings.payouts, a.amt) } };
    case "NOTIFY": return { ...s, notifications: [a.notif, ...s.notifications].slice(0, 50) };
    case "NOTIF_READ":
      return { ...s, notifications: s.notifications.map(n => (!a.id || n.id === a.id) ? { ...n, read: true } : n) };
    case "NOTIF_CLEAR": return { ...s, notifications: [] };
    case "RESET": { saveLegal({ customer: null, driver: null }); return { ...initial, legal: { customer: null, driver: null } }; }
    case "TOAST": return { ...s, toast: a.msg };
    default: return s;
  }
}

// ---- UI atoms --------------------------------------------------------------
// Section label — small mono "dispatch readout" label (same voice as the landing page).
function Eyebrow({ children, color }) {
  return <div style={{ font: `500 11.5px/1.3 ${FM}`, letterSpacing: ".08em", textTransform: "uppercase", color: color || C.mist }}>{children}</div>;
}
// A driver's written reviews. Reviewers are anonymous ("Customer").
function ReviewsSheet({ userId, name, rating, count, onClose }) {
  const [list, setList] = useState(null);
  useEffect(() => { loadReviews(userId).then(setList); }, [userId]);
  // Prefer the freshest numbers (from the reviews themselves) when they're loaded.
  if (list && list.length && (!count || list.length > count)) {
    count = list.length; rating = (list.reduce((a, r) => a + r.stars, 0) / list.length).toFixed(1);
  }
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), color: C.ice, margin: "0 0 4px" }}>{name ? `${name}'s reviews` : "Reviews"}</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 8, font: `600 13px ${FB}`, color: C.mist, marginBottom: 14 }}>
        {rating ? <><Stars v={Number(rating)} size={14} /> {rating} · {count} review{count === 1 ? "" : "s"}</> : "No ratings yet"}
      </div>
      {list === null ? <div style={{ font: `500 13px ${FB}`, color: C.mist, padding: "12px 0" }}>Loading…</div>
        : list.length === 0 ? <div style={{ font: `500 13px ${FB}`, color: C.mist, padding: "12px 0" }}>No reviews yet.</div>
        : <div style={{ display: "grid", gap: 10 }}>
          {list.map(r => (
            <div key={r.id} style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Stars v={r.stars} size={13} />
                <span style={{ font: `500 13px ${FB}`, color: C.mistDim }}>
                  {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>
              {r.comment && <p style={{ font: `400 14px/1.45 ${FB}`, color: C.ice, margin: "8px 0 0" }}>{r.comment}</p>}
            </div>
          ))}
        </div>}
    </Sheet>
  );
}

function Stars({ v, size = 13, onSet }) {
  return (
    <span style={{ fontSize: size, letterSpacing: 1 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} onClick={onSet ? () => onSet(i) : undefined}
          style={{ color: i <= Math.round(v) ? C.amber : C.mistDim, cursor: onSet ? "pointer" : "default" }}><Icon e="star" s={size} color={i <= Math.round(v) ? C.amber : C.mistDim} /></span>
      ))}
    </span>
  );
}
function Power({ n }) {
  return <span style={{ display: "inline-flex", gap: 2 }}>
    {[1,2,3,4,5].map(i => <span key={i} style={{ width: 5, height: 13, borderRadius: 1, background: i <= n ? C.amber : C.line }} />)}
  </span>;
}
function Btn({ children, onClick, kind = "primary", disabled, full, sm, style, id }) {
  const [press, setPress] = useState(false);
  const base = {
    font: `700 ${sm ? 14 : 16}px/1 ${FB}`, letterSpacing: "-.01em",
    minHeight: sm ? 40 : TAP, padding: sm ? "0 18px" : "0 24px",
    borderRadius: 999, cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent", width: full ? "100%" : "auto",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    transform: press ? "scale(.965)" : "scale(1)",
    transition: `transform .18s ${EASE}, opacity .2s, background .2s`,
    opacity: disabled ? .35 : 1, WebkitTapHighlightColor: "transparent",
  };
  const kinds = {
    primary: { background: C.amber, color: C.onAmber },
    ghost: { background: "transparent", color: C.ice, border: `1px solid ${C.line}` },
    dark: { background: C.slate, color: C.ice, border: `1px solid ${C.line}` },
    danger: { background: "transparent", color: C.danger, border: `1px solid ${C.danger}55` },
    good: { background: C.push, color: C.onPush },
  };
  return (
    <button id={id} onClick={disabled ? undefined : onClick} disabled={disabled}
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
        background: active ? C.slate2 : C.slate,
        border: `1px solid ${active ? C.amber : C.line}`,
        borderRadius: 16, padding: S.lg, cursor: onClick ? "pointer" : "default",
        boxShadow: active ? `0 0 0 1px ${C.amber}` : flat ? "none" : E.low,
        transform: press ? "scale(.99)" : "scale(1)",
        transition: `border-color .18s, box-shadow .18s, transform .18s ${EASE}`,
        WebkitTapHighlightColor: "transparent", ...style,
      }}>{children}</div>
  );
}

function Chip({ children, color = C.mist, bg, solid }) {
  return <span style={{ font: `600 11.5px ${FB}`,
    color: solid ? C.night : color, background: solid ? color : (bg || color + "1C"),
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
    background: color, display: "grid", placeItems: "center",
    font: `800 ${size * .36}px ${FD}`, textTransform: "uppercase", color: C.onAmber, boxShadow: E.low }}>{init}</div>;
}

// segmented control (iOS-style)
function Segmented({ options, value, onChange, color = C.amber }) {
  return (
    <div style={{ display: "flex", background: C.night2, border: `1px solid ${C.line}`, borderRadius: 13, padding: 3, position: "relative" }}>
      {options.map(o => {
        const on = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{ flex: 1, minHeight: 38, border: "none", cursor: "pointer",
            borderRadius: 10, background: on ? color : "transparent", color: on ? C.onAmber : C.mist,
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: C.scrim,
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

// Headings: calm sentence case. The tall caps display font is saved for big moments (prices, ETA, "Plowed").
const H = (size) => ({ font: `700 ${size}px/1.15 ${FB}`, letterSpacing: "-.022em" });
const h2 = { ...H(28), margin: "10px 0 10px" };
const sub = { font: `400 15px/1.5 ${FB}`, color: C.mist, margin: 0 };
const legalLink = { background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit",
  color: C.plow, textDecoration: "underline", textUnderlineOffset: 2 };
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
        {icon && <span style={{ position: "absolute", left: 12, fontSize: 15, opacity: .8 }}><Icon e={icon} s={15} /></span>}
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
        {showOk && <span style={{ position: "absolute", right: 13, color: C.push, fontSize: 15, animation: "pop .2s ease" }}><Icon e="check" s={15} /></span>}
        {showErr && <span style={{ position: "absolute", right: 13, color: C.danger, fontSize: 15 }}>!</span>}
      </div>
      <div style={{ height: showErr ? 18 : 0, overflow: "hidden", transition: "height .18s" }}>
        <span style={{ font: `500 13px ${FB}`, color: C.danger }}>{showErr ? res : ""}</span>
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
      background: C.mapBg,
      borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}` }}>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: .5 }}>
        <defs><pattern id="g" width="34" height="34" patternUnits="userSpaceOnUse">
          <path d="M34 0H0V34" fill="none" stroke={C.mapGrid} strokeWidth="1" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#g)" />
      </svg>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Lake Superior — Duluth's defining edge, runs SW→NE along the shore */}
        <path d="M100 42 L100 100 L38 100 Q58 76 78 58 Q88 49 100 42 Z"
          fill={C.plow + "1F"} stroke={C.plow + "40"} strokeWidth="0.8" />


        {/* the hillside ridge — Skyline Pkwy traces the top of the escarpment */}
        <path d="M0 22 Q26 20 48 30 T100 18" stroke={C.mistDim} strokeWidth="1.2" fill="none"
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
      <div style={{ position: "absolute", right: 12, bottom: 9, font: `600 11px ${FB}`, color: C.plow, opacity: .75,
        pointerEvents: "none" }}>Lake Superior</div>
      {flakes.map((f, i) => <div key={i} style={{ position: "absolute", left: `${f.x}%`, top: `${f.y}%`,
        width: f.s*2.4, height: f.s*2.4, borderRadius: "50%", background: isLight ? "rgba(120,128,145,.35)" : "rgba(234,243,251,.5)", pointerEvents: "none" }} />)}
      {pin && (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-100%)", textAlign: "center" }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: C.amber, border: `3px solid ${C.slate}`,
            margin: "0 auto", boxShadow: E.low }} />
          <div style={{ font: `600 11px ${FB}`, color: C.ice, marginTop: 4 }}>{pin === true ? "You" : pin}</div>
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
              background: isSel ? C.amber : C.slate, border: `1.5px solid ${isSel ? C.slate : C.line}`,
              color: isSel ? C.onAmber : C.ice, boxShadow: E.mid }}><Icon e="pickup" s={15} /></div>
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
  const animPrice = useCountUp(q.suggested, 320); // a suggestion — the customer names the price
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
          <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 1 }}>
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
            : nearFirst ? "Release here to close the shape"
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
                  fill={i === 0 ? col : C.night} stroke={col} strokeWidth={i === 0 ? 1.4 : 1.1}
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
          <div style={{ position: "absolute", top: 10, right: 10, background: C.glassStrong, backdropFilter: "blur(6px)",
            border: `1px solid ${hasPlow ? C.amber : C.line}`, borderRadius: 12, padding: "8px 12px", textAlign: "right", transition: "border-color .2s" }}>
            <div style={{ font: `800 26px ${FD}`, textTransform: "uppercase", color: hasPlow ? C.amber : C.mistDim, lineHeight: 1 }}>{hasPlow ? `$${animPrice}` : "—"}</div>
            <div style={{ font: `600 10px ${FB}`, color: C.mist, marginTop: 3 }}>{hasPlow ? `${animSqft.toLocaleString()} sq ft` : "outline to price"}</div>
          </div>
        )}

        {/* on-canvas controls */}
        <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {draft.length >= 3 && (
            <button onClick={() => commit(draft)} style={{ ...canvasBtn, background: col, color: C.onAmber, border: "none", fontWeight: 800 }}>
              <Icon e="check" s={13} /> Finish shape</button>
          )}
          {draft.length > 0 && <button onClick={() => setDraft(d => d.slice(0, -1))} style={canvasBtn}><Icon e="undo" s={13} /> Undo point</button>}
          {draft.length === 0 && zonesOf(mode).length > 0 && (
            <button onClick={() => { const last = [...zones].reverse().find(z => z.mode === mode);
              setZones(z => z.filter(x => x !== last)); }} style={canvasBtn}><Icon e="undo" s={13} /> Remove last area</button>
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
          <Row label="Measured area" value={`${plowSqFt.toLocaleString()} sq ft`} />
          <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
          <Row label="Suggested offer" value={`$${q.suggested}`} big />
          <div style={{ font: `400 13px ${FB}`, color: C.mistDim, marginTop: 4 }}>A suggestion — you choose your offer when you book.</div>
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
          <Btn full onClick={save}>Save property</Btn>
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
  background: C.glassStrong, backdropFilter: "blur(6px)", color: C.ice, border: `1px solid ${C.line}` };

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
  // iOS-style tab bar: glass, tint-only selection, no pills or glows.
  return (
    <nav style={{ position: "sticky", bottom: 0, display: "flex", gap: 4,
      background: C.glass, backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)",
      borderTop: `1px solid ${C.line}`, zIndex: 20,
      padding: `6px ${S.sm}px calc(6px + env(safe-area-inset-bottom))` }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} aria-current={on ? "page" : undefined}
            style={{ flex: 1, background: "transparent", border: "none",
            cursor: "pointer", minHeight: 52, padding: "6px 2px", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 4, color: on ? C.amber : C.mistDim,
            transition: "color .2s", WebkitTapHighlightColor: "transparent" }}>
            <Icon e={t.icon} s={22} strokeWidth={on ? 2 : 1.7} />
            <span style={{ font: `600 10.5px ${FB}` }}>{t.label}</span>
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
    background: C.glassStrong, backdropFilter: "blur(12px)", border: `1px solid ${C.line}`, color: C.ice,
    font: `600 13px/1.4 ${FB}`, padding: "13px 18px", borderRadius: 14, boxShadow: E.high, maxWidth: 340,
    display: "flex", alignItems: "center", gap: 10, animation: `toastIn .34s ${EASE}` }}>
    <span style={{ fontSize: 15, flexShrink: 0 }}><Icon e="snowflake" s={15} /></span>{msg}</div>;
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
  downtown:    { label: "Downtown",      grade: "flat",     note: "Flat · city grid" },
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
      <Field icon="pin" value={value} onChange={onChange} placeholder="Street address"
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
              borderTopColor: C.plow, animation: "spin .7s linear infinite", display: "block" }} /> : <Icon e="target" s={14} />}</span>
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
                placeItems: "center", fontSize: 13, flexShrink: 0 }}><Icon e="pin" s={13} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 14px ${FB}`, color: C.ice }}>{a.line1}</div>
                <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>
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
              placeItems: "center", fontSize: 13, color: C.onPush, fontWeight: 900, flexShrink: 0 }}><Icon e="check" s={13} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `700 14px ${FB}`, color: C.ice }}>{picked.line1}</div>
              <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 1 }}>
                {picked.city}, {picked.state} {picked.zip}</div>
            </div>
            <button onClick={() => { onChange(""); onPick(null); }}
              style={{ ...miniBtn, minHeight: 32, fontSize: 12 }}>Change</button>
          </div>
          {/* terrain auto-detect */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 10,
            borderTop: `1px solid ${C.push}22` }}>
            <span style={{ fontSize: 14 }}><Icon e="mountain" s={14} /></span>
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
  // The homepage price check can hand over the address they typed, so the map opens on their house.
  const [prop, setProp] = useState(() => {
    try { const p = JSON.parse(localStorage.getItem("drift.prefill") || "null"); return p?.center ? { address: p.address, center: p.center } : null; } catch { return null; }
  }); // { address, center, features, sqft, mapImg }
  const [profile, setProfile] = useState({ name: "", phone: "", email: "" });
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
    try { localStorage.removeItem("drift.prefill"); } catch { /* ignore */ }
    dispatch({ type: "ONBOARD_DONE", profile: fp, property });
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
            background: "radial-gradient(120% 100% at 50% 0%, #202026 0%, #141418 72%)", color: "#F5F5F7", border: `1px solid ${C.line}` }}>
            <HeroSnow />
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 52, color: "#F5F5F7" }}><Icon e="snowflake" s={52} /></div>
                <div style={{ font: `700 13px ${FB}`, letterSpacing: ".08em", color: "#FFB020", marginTop: 6 }}>DRIFT</div>
              </div>
            </div>
            {/* faux truck ticker */}
            <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6 }}>
              {["plowtruck", "pickup", "plowtruck"].map((e, i) => (
                <span key={i} style={{ fontSize: 15, opacity: .5, animation: `bob 2.4s ${i * .35}s ease-in-out infinite` }}><Icon e={e} s={15} /></span>
              ))}
            </div>
          </div>

          <h1 style={{ font: `800 50px/0.96 ${FD}`, textTransform: "uppercase", margin: "0 0 10px", textAlign: "center", letterSpacing: ".01em" }}>
            Never shovel<br />again.</h1>
          <p style={{ ...sub, maxWidth: 300, margin: "0 auto 18px", textAlign: "center", fontSize: 15 }}>
            Map your property once. Tap once each storm. A local plow operator clears it exactly how you drew it.
          </p>

          {/* what you get (no made-up reviews or customer counts) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap", marginBottom: S.xl,
            font: `600 12px ${FB}`, color: C.mist }}>
            <span>Pay per storm</span><span>·</span><span>Local drivers</span><span>·</span><span>Photo proof</span>
          </div>

          <Btn full onClick={() => go(1)}>Get started</Btn>
          <button onClick={() => dispatch({ type: "ROLE", role: "driver" })}
            style={{ width: "100%", marginTop: S.md, background: "transparent", border: "none", cursor: "pointer",
              color: C.mist, font: `600 14px ${FB}`, padding: 12, WebkitTapHighlightColor: "transparent" }}>
            I want to plow &amp; earn →
          </button>
          <p style={{ font: `500 13px ${FB}`, color: C.mistDim, marginTop: 4, textAlign: "center" }}>
            Setup takes about a minute · no commitment
          </p>
        </Fade>
      )}

      {step === 1 && (
        <Fade k="map">
          <Eyebrow>Step 1 · Map your property</Eyebrow>
          <h2 style={h2}>Where should we plow?</h2>
          <p style={sub}>Search your address and we'll place a starting outline on the satellite view. Confirm it or redraw it — we measure it and price it for you.</p>
          <div style={{ height: 14 }} />
          <MapPropertyDesigner existing={prop} saveLabel="Continue" autoStart
            onQuote={(sqft) => quoteJob({ jobType: "driveway", sqft }).suggested}
            onDone={(data) => { setProp(data); go(state.userId ? 3 : 2); }} />
        </Fade>
      )}

      {step === 2 && (
        <Fade k="c">
          <Eyebrow>Step 2 · Contact</Eyebrow>
          <h2 style={h2}>Who's it for?</h2>
          <p style={sub}>So your driver can reach you and you get updates.</p>
          <div style={{ display: "grid", gap: 12, margin: "16px 0" }}>
            <Field label="Full name" icon="user" value={profile.name} autoFocus
              onChange={(v) => setProfile(p => ({ ...p, name: v }))} validate={validators.name}
              placeholder="Jane Doe" onValid={(v) => setV("name", v)} />
            <Field label="Phone" icon="mobile" value={profile.phone} inputMode="tel" format={fmtPhone}
              onChange={(v) => setProfile(p => ({ ...p, phone: v }))} validate={validators.phone}
              placeholder="(218) 555-0123" onValid={(v) => setV("phone", v)} />
            <Field label="Email" icon="mail" value={profile.email} inputMode="email"
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
          <Eyebrow>Step 3 · How DRIFT works</Eyebrow>
          <h2 style={h2}>One last thing</h2>
          <p style={sub}>Please read before you finish. You'll add a card the first time you book — Stripe keeps it safe, and you're only charged after the job is done.</p>
          {/* clickwrap: required before the account is created */}
          <div style={{ marginTop: 16 }}>
            <CustomerConsent agreeLabel="Agree and finish setup"
              onAgree={(rec) => { acceptLegal(dispatch, rec, state.userId); finish(); }} />
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
    { id: "home", label: "Plow", icon: "snowflake" },
    { id: "props", label: "Properties", icon: "map" },
    { id: "trips", label: "History", icon: "receipt" },
    { id: "account", label: "Account", icon: "user" },
  ];

  const openTab = (t) => { setSub(null); setTab(t); };

  return (
    <>
      <div style={{ padding: "0 20px", flex: 1 }}>
        {sub === "referral" ? <RiderReferral onBack={() => setSub(null)} />
          : <>
            {tab === "home" && (order && order.state !== "done" ? <RiderTracking /> : <RiderHome go={openTab} />)}
            {tab === "props" && <RiderProperties onBackToBook={() => openTab("home")} />}
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
// A reminder of the city's deadline with a one-tap booking.
function OrdinanceCountdown({ onBook, price }) {
  const DEADLINE_HRS = 24;
  const SNOW_ENDED_HRS_AGO = 6; // storm ended 6 hrs ago in this sim
  const [left, setLeft] = useState((DEADLINE_HRS - SNOW_ENDED_HRS_AGO) * 3600);
  useEffect(() => {
    const t = setInterval(() => setLeft(s => Math.max(0, s - 60)), 1000); // 1s = 1min, for demo
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
  const urgent = h < 6;
  const col = urgent ? C.danger : C.amber;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, marginBottom: 12,
      background: C.slate, border: `1px solid ${urgent ? C.danger + "66" : C.line}` }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: col + "1F", color: col,
        display: "grid", placeItems: "center", flexShrink: 0 }}><Icon e="broom" s={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14px ${FB}`, color: C.ice, whiteSpace: "nowrap" }}>Sidewalk due in {h}h {String(m).padStart(2, "0")}m</div>
        <div style={{ font: `400 13px ${FB}`, color: C.mist, marginTop: 2 }}>City rule: 24 hrs after snow{price ? ` · $${price}` : ""}</div>
      </div>
      <Btn sm kind="dark" onClick={onBook} style={{ padding: "0 14px" }}>Clear it</Btn>
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
      <span style={{ fontSize: 14 }}><Icon e="signal" s={14} /></span>
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

// One-time nudge on the home screen to turn on snow alerts (until they do, or dismiss it).
function SnowAlertNudge() {
  const { state, dispatch } = useStore();
  const [show, setShow] = useState(false);
  const [howTo, setHowTo] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem("drift.snowNudge") === "1"; } catch { /* private mode */ }
    if (dismissed) return;
    if (isIOS() && !isStandalone()) { setShow(true); return; }
    if (!pushSupported()) return;
    pushEnabled().then((on) => setShow(!on)).catch(() => {});
  }, []);
  const dismiss = () => { setShow(false); try { localStorage.setItem("drift.snowNudge", "1"); } catch { /* ignore */ } };
  const turnOn = async () => {
    if (isIOS() && !isStandalone()) { setHowTo(true); return; }
    try { await enablePush(state.userId); setShow(false); dispatch({ type: "TOAST", msg: "Snow alerts on — we'll give you a heads-up before storms" }); }
    catch (e) { dispatch({ type: "TOAST", msg: e.message }); }
  };
  if (!show) return howTo ? <InstallSheet onClose={() => setHowTo(false)} /> : null;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 12px 12px 14px", borderRadius: 14, marginBottom: 12,
      background: C.slate, border: `1px solid ${C.line}` }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: C.amber + "1F", color: C.amber,
        display: "grid", placeItems: "center", flexShrink: 0 }}><Icon e="bell" s={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14px ${FB}`, color: C.ice }}>Get snow alerts</div>
        <div style={{ font: `400 13px/1.35 ${FB}`, color: C.mist, marginTop: 2 }}>A heads-up before a storm so you can book early.</div>
      </div>
      <Btn sm kind="dark" onClick={turnOn} style={{ padding: "0 12px" }}>Turn on</Btn>
      <button onClick={dismiss} aria-label="Dismiss" style={{ background: "none", border: "none", color: C.mistDim, cursor: "pointer", padding: 4,
        display: "grid", placeItems: "center" }}><Icon e="close" s={15} /></button>
      {howTo && <InstallSheet onClose={() => setHowTo(false)} />}
    </div>
  );
}

// Real forecast (National Weather Service via /api/weather). Only shows when snow is expected.
function LiveSnowBanner() {
  const [f, setF] = useState(null);
  const [hide, setHide] = useState(false);
  useEffect(() => { fetchSnowForecast().then(setF); }, []);
  if (hide || !f || !(f.next24 >= 1)) return null;
  const soon = f.next12 >= 1;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 12px 12px 14px", borderRadius: 14, marginBottom: 12,
      background: C.slate, border: `1px solid ${C.line}` }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: C.plow + "1F", color: C.plow,
        display: "grid", placeItems: "center", flexShrink: 0 }}><Icon e="snowflake" s={19} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14px ${FB}`, color: C.ice }}>Snow on the way · {f.range24 || `${f.next24}"`}</div>
        <div style={{ font: `400 13px/1.35 ${FB}`, color: C.mist, marginTop: 2 }}>
          {soon ? "Expected in the next 12 hours." : "Expected in the next 24 hours."} Book now to get in line before the rush.</div>
      </div>
      <button onClick={() => setHide(true)} aria-label="Dismiss" style={{ background: "none", border: "none",
        color: C.mistDim, cursor: "pointer", padding: 6, display: "grid", placeItems: "center",
        WebkitTapHighlightColor: "transparent" }}><Icon e="close" s={16} /></button>
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
    ? "Plows ~9 min out · 4 working nearby"
    : `${f.low}–${f.high}" expected ${f.when}. Book ahead of the rush.`;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 12px 12px 14px", borderRadius: 14, marginBottom: 12,
      background: C.slate, border: `1px solid ${C.line}` }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: accent + "1F", color: accent,
        display: "grid", placeItems: "center", flexShrink: 0 }}><Icon e={active ? "snow" : "snowflake"} s={19} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14px ${FB}`, color: C.ice }}>{title}</div>
        <div style={{ font: `400 13px/1.35 ${FB}`, color: C.mist, marginTop: 2 }}>{body}</div>
      </div>
      <button onClick={() => setHide(true)} aria-label="Dismiss" style={{ background: "none", border: "none",
        color: C.mistDim, cursor: "pointer", padding: 6, display: "grid", placeItems: "center",
        WebkitTapHighlightColor: "transparent" }}><Icon e="close" s={16} /></button>
    </div>
  );
}

// Small secondary-service tile (dig-out, jump-start) — deliberately quieter than the main card.
function ServiceTile({ icon, title, sub, onClick, disabled, tone }) {
  const col = tone || C.ice;
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1,
        background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 14px 13px",
        display: "flex", flexDirection: "column", gap: 10, WebkitTapHighlightColor: "transparent" }}>
      <span style={{ color: col, display: "flex" }}><Icon e={icon} s={20} /></span>
      <span>
        <span style={{ display: "block", font: `600 14px ${FB}`, color: C.ice }}>{title}</span>
        <span style={{ display: "block", font: `400 12.5px ${FB}`, color: C.mist, marginTop: 2 }}>{sub}</span>
      </span>
    </button>
  );
}

// Small frosted chip that sits on the satellite photo.
const heroChip = (tint) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 999,
  font: `600 12px ${FB}`, color: tint || "#fff", background: "rgba(8,10,14,.6)", border: "1px solid rgba(255,255,255,.18)",
  backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" });

function RiderHome({ go }) {
  const { state, dispatch } = useStore();
  const LIVE = isLive(state);
  const prop = state.activeProperty;
  const [jobType, setJobType] = useState("driveway");
  const [showSched, setShowSched] = useState(false);
  const [schedAt, setSchedAt] = useState(null); // { when, label } — null = as soon as possible
  const [adjust, setAdjust] = useState(false);     // price / schedule drawer
  const [depthOpen, setDepthOpen] = useState(false);
  const [salt, setSalt] = useState(false);
  const [showBreak, setShowBreak] = useState(false); // breakdown one tap away — keeps the card calm
  const [payOpen, setPayOpen] = useState(false);    // Stripe authorization sheet (only when keys are set)
  // Clickwrap gate: nothing books until the current Terms + Release are signed.
  const [gate, setGate] = useState(null);   // the action to run once they agree
  const [doc, setDoc] = useState(null);     // legal doc open in the reader
  const signed = hasCurrentAcceptance(state.legal?.customer);
  const guard = (fn) => (...args) => (signed ? fn(...args) : setGate(() => () => fn(...args)));

  const sqft = prop?.sqft || zonesToSqFt(prop?.zones);
  // sidewalk length: derive a sensible default from the property, editable later
  const linearFt = prop?.sidewalkFt || 80;
  // The customer names the price. DRIFT only recommends (by square footage).
  const [offer, setOffer] = useState(null);           // null = use the Recommended tier
  const [typing, setTyping] = useState(null);         // text in the price box while typing
  useEffect(() => { setOffer(null); setTyping(null); }, [jobType, prop?.id]);
  // Snow on the ground — pre-filled from the weather service until the customer picks one.
  const [depth, setDepthState] = useState("light");
  const [depthNote, setDepthNote] = useState(null);
  const depthTouched = useRef(false);
  const setDepth = (id) => { depthTouched.current = true; setDepthState(id); setOffer(null); setTyping(null); };
  useEffect(() => {
    let on = true;
    fetchSnowForecast().then((f) => {
      if (!on || !f || depthTouched.current) return;
      const est = Math.max(f.last24 || 0, f.next12 || 0);
      if (est >= 1) { setDepthState(depthForInches(est).id); setDepthNote(`Weather service: about ${Math.round(est)}"`); }
    });
    return () => { on = false; };
  }, []);
  const qRec = quoteJob({ jobType, sqft, linearFt, property: prop, salt, depth });
  const q = offer == null ? qRec : withOffer(qRec, offer);
  const tierId = (qRec.tiers.find(t => t.offer === q.offer) || {}).id || "custom";
  // One-tap extras (dig-out, jump-start, quick sidewalk) book at the Standard
  // suggestion so their totals match what they used to cost. Price shown on the button.
  const quickQuote = (type) => { const qq = quoteJob({ jobType: type, linearFt, property: prop, depth }); return withOffer(qq, qq.standardOffer); };
  const bump = (d) => setOffer(Math.min(OFFER_MAX, Math.max(OFFER_MIN, q.offer + d)));
  const animPrice = useCountUp(q.riderTotal);
  const first = state.profile.name ? state.profile.name.split(" ")[0] : null;
  const jt = JOB_TYPES[jobType];
  const needsOutline = (jt.basis === "area") && sqft === 0;
  // One-time hazard check before the first plow (existing customers included).
  const needsHazards = !!prop && jt.basis !== "flat" && !hazardsChecked(prop);
  const markHazards = () => { editPropertyOnOpen = prop.id; go("props"); };
  const hazardNotice = !!prop && !hazardsChecked(prop);
  const [setupShown, setSetupShown] = useState(false);

  // ---- One-tap "Book again": same driveway, same tier, priced for today's snow ----
  const link = useDeepLink();
  const [lastJob, setLastJob] = useState(null);
  useEffect(() => { if (LIVE && state.userId) lastCompletedJob(state.userId).then(setLastJob).catch(() => {}); }, [LIVE, state.userId]);
  const rbType = lastJob && JOB_TYPES[lastJob.job_type] && lastJob.job_type !== "jumpstart" ? lastJob.job_type : "driveway";
  const rbQuote = lastJob && prop && !hazardNotice && !(JOB_TYPES[rbType].basis === "area" && !sqft)
    ? quoteJob({ jobType: rbType, sqft, linearFt, property: prop, depth }) : null;
  const rbTier = lastJob ? ((lastJob.quote?.tiers || []).find((t) => t.offer === Number(lastJob.quote?.offer))?.id || "recommended") : null;
  const rbQ = rbQuote ? withOffer(rbQuote, (rbQuote.tiers.find((t) => t.id === rbTier) || rbQuote.tiers[1]).offer) : null;
  const rebook = () => {
    const order = { id: "o" + Date.now(), state: "requested", jobType: rbType, size: prop?.size || SIZES[1], property: prop,
      quote: rbQ, tool: rbQ.tool, createdAt: Date.now(), driverPos: { x: state.driver.x, y: state.driver.y }, eta: 9,
      timeline: [{ k: "requested", t: "now", label: "Booked again" }], photos: { before: [], after: [] } };
    dispatch({ type: "REQUEST", order });
    if (!(isLive(state) && STRIPE_ENABLED)) dispatch({ type: "TOAST", msg: "Offer sent — same as last time" });
    autoMatch(dispatch, state, order);
  };
  useEffect(() => {
    if (link.go !== "jumpstart") return;
    setTimeout(() => document.getElementById("other-services")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    consumeLink("go");
  }, [link.go]);
  const rbRef = useRef(null);
  useEffect(() => { if (link.rebook && rbRef.current) { rbRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); consumeLink("rebook"); } }, [link.rebook, !!rbQ]);
  const rebookCard = rbQ ? (
    <div ref={rbRef} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 12px 12px 14px", borderRadius: 16, marginBottom: 12,
      background: C.slate, border: `1px solid ${C.amber}66` }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: C.amber + "1F", color: C.amber, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon e="undo" s={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14.5px ${FB}`, color: C.ice }}>Book again · ${rbQ.riderTotal}</div>
        <div style={{ font: `400 12.5px/1.35 ${FB}`, color: C.mist, marginTop: 2 }}>
          {JOB_TYPES[rbType].label} · {(OFFER_TIERS.find((t) => t.id === rbTier) || OFFER_TIERS[1]).label}{rbQ.depthMult > 1 ? ` · ${rbQ.depthLabel} snow` : ""} · same as last time</div>
      </div>
      <Btn sm onClick={guard(rebook)} style={{ padding: "0 14px" }}>Book</Btn>
    </div>
  ) : null;

  // ---- Sticky "Send offer" bar: always one thumb-tap away while you scroll ----
  const [sendVisible, setSendVisible] = useState(true);
  useEffect(() => {
    const el = typeof document !== "undefined" && document.getElementById("send-offer");
    if (!el || typeof IntersectionObserver === "undefined") { setSendVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setSendVisible(e.isIntersecting), { rootMargin: "0px 0px -70px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [needsOutline, needsHazards, jobType, !!prop]);
  const modActive = q.mod !== 1;
  const canSalt = SALT.appliesTo.includes(jobType);

  const buildOrder = (extra = {}) => ({
    id: "o" + Date.now(), state: schedAt ? "scheduled" : "requested", jobType, size: prop?.size || SIZES[1], property: prop,
    quote: q, tool: q.tool, createdAt: Date.now(), driverPos: { x: state.driver.x, y: state.driver.y },
    eta: 9, timeline: [{ k: "requested", t: "now", label: schedAt ? `Scheduled · ${schedAt.label}` : "Request sent" }],
    photos: { before: [], after: [] },
    ...(schedAt ? { scheduledFor: schedAt.when, windowEnd: schedAt.when + 2 * 3600e3 } : {}), ...extra,
  });

  const request = () => {
    const order = buildOrder();
    dispatch({ type: "REQUEST", order });
    // With payments on, the card sheet explains the next step instead.
    if (!(isLive(state) && STRIPE_ENABLED)) dispatch({ type: "TOAST", msg: schedAt ? `Scheduled for ${schedAt.label}` : `Offer sent — finding a nearby ${q.tool.toLowerCase()}` });
    notify(dispatch, { kind: "job", title: schedAt ? "Plow scheduled" : "Offer sent", body: schedAt ? `${schedAt.label} · drivers can claim it now.` : `Finding a nearby ${q.tool.toLowerCase()} for ${prop?.label || "your property"}.`, role: "rider" });
    autoMatch(dispatch, state, order);
    setSchedAt(null);
  };

  // With Stripe on, authorize the card first; otherwise straight to the demo request.
  // Card hold (when payments are on) happens on the tracking screen, after the
  // offer is saved — the server reads the amount from the saved job.
  const startRequest = () => request();
  const onAuthorized = (paymentIntentId) => {
    setPayOpen(false);
    const order = buildOrder({ paymentIntentId });
    dispatch({ type: "REQUEST", order });
    dispatch({ type: "TOAST", msg: `Card authorized — finding a nearby ${q.tool.toLowerCase()}` });
    notify(dispatch, { kind: "job", title: "Card authorized", body: `We'll only charge $${q.riderTotal} once ${prop?.label || "your property"} is plowed.`, role: "rider" });
    autoMatch(dispatch, state, order);
  };

  // roadside / emergency dispatch — flat-rate, no property zones required
  const requestRoadside = (type) => {
    const rq = quickQuote(type);
    const rjt = JOB_TYPES[type];
    const order = {
      id: "o" + Date.now(), state: "requested", jobType: type, size: prop?.size || SIZES[1], property: prop,
      quote: rq, tool: rq.tool, emergency: true, createdAt: Date.now(),
      driverPos: { x: state.driver.x, y: state.driver.y }, eta: 7,
      timeline: [{ k: "requested", t: "now", label: `${rjt.label} requested` }], photos: { before: [], after: [] },
    };
    dispatch({ type: "REQUEST", order });
    dispatch({ type: "TOAST", msg: `${rjt.label} requested — finding the nearest driver` });
    autoMatch(dispatch, state, order);
  };

  // Scheduled plow: picked in the sheet, sent with the normal "Send offer" button.
  const schedule = (when, label) => { setSchedAt({ when, label }); setShowSched(false); };

  // one-tap emergency dig-out (street-parked car buried by the city plow berm)
  const emergencyDigout = () => {
    const eq = quickQuote("digout");
    const order = {
      id: "o" + Date.now(), state: "requested", jobType: "digout", size: prop?.size || SIZES[1], property: prop,
      quote: eq, tool: eq.tool, emergency: true, createdAt: Date.now(),
      driverPos: { x: state.driver.x, y: state.driver.y }, eta: 6,
      timeline: [{ k: "requested", t: "now", label: "Dig-out request sent" }], photos: { before: [], after: [] },
    };
    dispatch({ type: "REQUEST", order });
    dispatch({ type: "TOAST", msg: "Dig-out requested — finding the nearest crew" });
    autoMatch(dispatch, state, order);
  };
  const bookSidewalk = () => {
    const oq = quickQuote("sidewalk");
    const order = {
      id: "o" + Date.now(), state: "requested", jobType: "sidewalk", size: prop?.size || SIZES[1], property: prop,
      quote: oq, tool: oq.tool, createdAt: Date.now(), driverPos: { x: state.driver.x, y: state.driver.y },
      eta: 9, timeline: [{ k: "requested", t: "now", label: "Sidewalk clearing requested" }], photos: { before: [], after: [] },
    };
    dispatch({ type: "REQUEST", order });
    dispatch({ type: "TOAST", msg: "Sidewalk clearing requested" });
    autoMatch(dispatch, state, order);
  };

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const SERVICES = [["driveway", "Driveway"], ["sidewalk", "Sidewalk"]];
  const basisLine = jt.basis === "area" ? `per plow · ${sqft.toLocaleString()} sq ft`
    : jt.basis === "linear" ? `per clearing · ~${linearFt} ft of walk`
    : `flat rate · ${jt.label.toLowerCase()}`;

  return (
    <Fade k="home"><section style={{ paddingTop: 10, paddingBottom: 28 }}>
      <h1 style={{ ...H(30), color: C.ice, margin: "6px 0 18px" }}>
        {greet}{first ? `, ${first}` : ""}</h1>

      {/* One notice at a time, most important first: hazards → get the app → snow forecast. */}
      {rebookCard}
      {!hazardNotice && <AppSetupCard role="rider" onShown={setSetupShown} />}
      {!hazardNotice && !setupShown && (LIVE ? <LiveSnowBanner /> : <StormBanner />)}
      {hazardNotice && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 12px 12px 14px", borderRadius: 14, marginBottom: 12,
          background: C.slate, border: `1px solid ${C.danger}55` }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: C.danger + "1F", color: C.danger,
            display: "grid", placeItems: "center", flexShrink: 0 }}><Icon e="cone" s={17} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `600 14px ${FB}`, color: C.ice }}>New: mark your hazards</div>
            <div style={{ font: `400 13px/1.35 ${FB}`, color: C.mist, marginTop: 2 }}>Curbs, raised concrete, well caps, septic. One time, about a minute — needed before your next plow.</div>
          </div>
          <Btn sm onClick={markHazards} style={{ padding: "0 12px" }}>Mark</Btn>
        </div>
      )}
      {!LIVE && !hazardNotice && !setupShown && SNOW_DEPTH_IN >= 2 && prop && <OrdinanceCountdown price={quickQuote("sidewalk").riderTotal} onBook={guard(bookSidewalk)} />}

      {/* ---- THE primary action: your saved place + one button (Uber "Home" / DoorDash reorder) ---- */}
      {prop ? (
        <div style={{ marginTop: 4, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 24, overflow: "hidden", boxShadow: E.mid }}>
          {/* hero: their actual driveway from above */}
          <div style={{ position: "relative", height: 178, background: C.mapBg }}>
            {prop.mapImg ? (
              <img src={prop.mapImg} alt={`Satellite view of ${prop.addr || "your property"}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : MAP_ENABLED && prop.center ? (
              <LiveMap center={prop.center} height={178} interactive={false} markers={[{ lng: prop.center.lng, lat: prop.center.lat, size: 26 }]} />
            ) : (
              <StormMap pin blips={LIVE ? [] : [{ id: 1, x: 62, y: 38 }, { id: 2, x: 30, y: 64 }]} height={2.1} />
            )}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(5,7,10,.05) 30%, rgba(5,7,10,.82) 100%)" }} />
            <button onClick={() => go("props")} style={{ position: "absolute", top: 10, right: 10, minHeight: 34, padding: "0 12px",
              borderRadius: 999, border: "1px solid rgba(255,255,255,.22)", background: "rgba(8,10,14,.55)", color: "#fff",
              backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", font: `600 13px ${FB}`, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6 }}><Icon e="edit" s={13} /> Edit</button>
            <div style={{ position: "absolute", left: 14, right: 14, bottom: 12, color: "#fff" }}>
              <div style={{ font: `600 17px/1.2 ${FB}`, textShadow: "0 1px 8px rgba(0,0,0,.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {prop.addr || prop.label}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                {sqft > 0 && <span style={heroChip()}>{sqft.toLocaleString()} sq ft</span>}
                {prop.grade && prop.grade !== "flat" && <span style={heroChip()}>{MODIFIERS.grade[prop.grade].label}</span>}
                {hazardsChecked(prop)
                  ? <span style={heroChip("#3DDC84")}><Icon e="check" s={11} strokeWidth={2.6} /> {hazardLabels(prop).length ? `${hazardLabels(prop).length} hazard${hazardLabels(prop).length > 1 ? "s" : ""} marked` : "Hazards checked"}</span>
                  : <span style={heroChip("#FF8A80")}>Hazards not marked</span>}
              </div>
            </div>
          </div>

          <div style={{ padding: "14px 16px 16px" }}>
            {/* what to clear */}
            <div style={{ display: "flex", background: C.night2, borderRadius: 12, padding: 3 }}>
              {SERVICES.map(([id, label]) => {
                const on = jobType === id;
                return (
                  <button key={id} onClick={() => setJobType(id)} style={{ flex: 1, minHeight: 38, border: "none", borderRadius: 10,
                    cursor: "pointer", font: `600 14px ${FB}`, color: on ? C.ice : C.mist,
                    background: on ? C.slate2 : "transparent", boxShadow: on ? E.low : "none",
                    transition: `background .2s ${EASE}`, WebkitTapHighlightColor: "transparent" }}>{label}</button>
                );
              })}
            </div>

            {needsOutline ? (
              <div style={{ padding: "18px 2px 2px" }}>
                <div style={{ font: `600 16px ${FB}`, color: C.ice }}>Outline this area to get a price</div>
                <div style={{ font: `400 14px/1.45 ${FB}`, color: C.mist, marginTop: 4, marginBottom: 14 }}>
                  We'll place a starting outline for you. Your square footage sets a suggested price — you choose the final number.</div>
                <Btn full onClick={() => go("props")}>Map it</Btn>
              </div>
            ) : (
              <>
                {/* the answer: one price */}
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 18 }}>
                  <div>
                    <div style={{ font: `500 13px ${FB}`, color: C.mist }}>{tierId === "custom" ? "Your price" : `${(OFFER_TIERS.find(t => t.id === tierId) || OFFER_TIERS[1]).label} price`}</div>
                    <div style={{ font: `800 58px/.92 ${FD}`, color: C.ice, letterSpacing: "-.005em", marginTop: 4 }} aria-live="polite">${animPrice}</div>
                  </div>
                  {!NO_DEPTH.includes(jobType) && (
                    <button onClick={() => setDepthOpen(v => !v)} aria-expanded={depthOpen} aria-label={`Snow depth: ${depthById(depth).label}. Change`} style={{ display: "flex", alignItems: "center", gap: 7,
                      minHeight: 40, padding: "0 12px", borderRadius: 999, cursor: "pointer", marginBottom: 4,
                      background: depthOpen ? C.amber + "18" : C.night2, border: `1px solid ${depthOpen ? C.amber : C.line}`,
                      color: C.ice, font: `600 13.5px ${FB}`, WebkitTapHighlightColor: "transparent" }}>
                      <Icon e="snowflake" s={14} color={C.amber} /> {depthById(depth).label} snow
                      <span style={{ display: "flex", color: C.mist, transform: depthOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}><Icon e="chevrondown" s={13} /></span>
                    </button>
                  )}
                </div>
                <div style={{ font: `400 13.5px ${FB}`, color: C.mist, marginTop: 8 }}>
                  ~{q.mins} min on site · charged when it's done · <span style={{ color: C.push, fontWeight: 600 }}>no contract</span></div>

                {depthOpen && !NO_DEPTH.includes(jobType) && (
                  <div style={{ marginTop: 12, animation: "fadeIn .18s ease" }}>
                    <div role="radiogroup" aria-label="Snow depth" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                      {DEPTHS.map(d => {
                        const on = depth === d.id;
                        return (
                          <button key={d.id} role="radio" aria-checked={on} onClick={() => { setDepth(d.id); setDepthOpen(false); }}
                            style={{ minHeight: 44, borderRadius: 12, cursor: "pointer", font: `600 14px ${FB}`,
                              color: on ? C.amber : C.ice, background: on ? C.amber + "16" : C.night2,
                              border: `1.5px solid ${on ? C.amber : "transparent"}`, WebkitTapHighlightColor: "transparent" }}>{d.label}</button>
                        );
                      })}
                    </div>
                    <div style={{ font: `400 12.5px ${FB}`, color: C.mistDim, marginTop: 7 }}>
                      {depthNote && !depthTouched.current ? `${depthNote} · ` : ""}Deeper snow is a bigger job, so the suggested price goes up.</div>
                  </div>
                )}

                {needsHazards && (
                  <div role="note" style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, padding: "11px 13px",
                    borderRadius: 12, background: C.danger + "10", border: `1px solid ${C.danger}40` }}>
                    <span style={{ color: C.danger, display: "flex", marginTop: 1 }}><Icon e="cone" s={15} /></span>
                    <span style={{ font: `400 13.5px/1.45 ${FB}`, color: C.mist }}>
                      <span style={{ color: C.ice, fontWeight: 600 }}>One-time step:</span> mark curbs, raised concrete, well caps and septic so your driver knows what's under the snow.</span>
                  </div>
                )}
                {schedAt && !needsHazards && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 12px", borderRadius: 12,
                    background: C.amber + "12", border: `1px solid ${C.amber}55`, font: `500 14px ${FB}`, color: C.ice }}>
                    <Icon e="calendar" s={15} color={C.amber} /> <span style={{ flex: 1 }}>Scheduled for <b>{schedAt.label}</b></span>
                    <button onClick={() => setSchedAt(null)} aria-label="Book now instead" style={{ background: "none", border: "none", color: C.mist, cursor: "pointer", padding: 4, display: "flex" }}><Icon e="close" s={15} /></button>
                  </div>
                )}

                {/* the one button */}
                <div style={{ marginTop: 16 }}>
                  {needsHazards
                    ? <Btn full onClick={markHazards}>Mark hazards to book · 1 min</Btn>
                    : <Btn full onClick={guard(startRequest)} id="send-offer" style={{ minHeight: 58, fontSize: 17 }}>
                        {schedAt ? `Schedule plow · $${animPrice}` : jobType === "sidewalk" ? `Clear my sidewalk · $${animPrice}` : `Plow my driveway · $${animPrice}`}</Btn>}
                </div>

                {/* everything else, one tap away */}
                {!needsHazards && (
                  <button onClick={() => setAdjust(v => !v)} aria-expanded={adjust} style={{ width: "100%", background: "none", border: "none",
                    cursor: "pointer", padding: "14px 0 2px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    font: `600 14px ${FB}`, color: C.mist, WebkitTapHighlightColor: "transparent" }}>
                    {adjust ? "Done adjusting" : "Change price or schedule for later"}
                    <span style={{ display: "flex", transform: adjust ? "rotate(180deg)" : "none", transition: "transform .2s" }}><Icon e="chevrondown" s={14} /></span>
                  </button>
                )}
                {adjust && !needsHazards && (
                  <div style={{ marginTop: 10, paddingTop: 14, borderTop: `1px solid ${C.lineSoft}`, animation: "fadeIn .2s ease" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ font: `600 15px ${FB}`, color: C.ice }}>Suggested prices</div>
                      <div style={{ font: `400 13px ${FB}`, color: C.mistDim, whiteSpace: "nowrap" }}>{basisLine.replace("per plow · ", "")}</div>
                    </div>
                    <div style={{ font: `400 13.5px/1.45 ${FB}`, color: C.mist, marginTop: 3 }}>Pick one, or type any price you want — drivers choose which jobs to take.</div>
                    <div role="radiogroup" aria-label="Offer" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
                      {qRec.tiers.map(t => {
                        const on = tierId === t.id;
                        return (
                          <button key={t.id} role="radio" aria-checked={on} onClick={() => setOffer(t.offer)}
                            style={{ textAlign: "left", cursor: "pointer", padding: "10px 10px 9px", borderRadius: 13,
                              background: on ? C.amber + "16" : C.night2, border: `1.5px solid ${on ? C.amber : "transparent"}`,
                              transition: `background .15s, border-color .15s`, WebkitTapHighlightColor: "transparent" }}>
                            <div style={{ font: `600 13px ${FB}`, color: on ? C.amber : C.mist }}>{t.label}</div>
                            <div style={{ font: `800 26px/1.1 ${FD}`, color: C.ice, marginTop: 3 }}>${t.offer + CALLOUT_FEE + DRIFT_FEE}</div>
                            <div style={{ font: `400 13px ${FB}`, color: C.mistDim, marginTop: 1 }}>{t.note}</div>
                          </button>
                        );
                      })}
                    </div>
                    {/* custom amount */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8,
                      background: C.night2, borderRadius: 13, padding: "6px 6px 6px 14px",
                      border: `1.5px solid ${tierId === "custom" ? C.amber : "transparent"}` }}>
                      <span style={{ font: `500 14px ${FB}`, color: tierId === "custom" ? C.ice : C.mist }}>
                        {tierId === "custom" ? "Your offer" : "Or type your own"}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button onClick={() => bump(-OFFER_STEP)} aria-label="Lower offer" disabled={q.offer <= OFFER_MIN}
                          style={{ ...miniBtn, width: 40, minHeight: 40, padding: 0, borderRadius: 11, opacity: q.offer <= OFFER_MIN ? .4 : 1 }}><Icon e="minus" s={16} /></button>
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 66, height: 40,
                          borderRadius: 11, background: C.slate, border: `1px solid ${C.line}`, cursor: "text", padding: "0 6px" }}>
                          <span style={{ font: `800 20px ${FD}`, color: C.mist }}>$</span>
                          <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Your price in dollars"
                            value={typing ?? String(q.offer)}
                            onFocus={(e) => { setTyping(String(q.offer)); e.target.select(); }}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, "").slice(0, 3);
                              setTyping(v);
                              const n = parseInt(v, 10);
                              if (n >= OFFER_MIN) setOffer(Math.min(OFFER_MAX, n));
                            }}
                            onBlur={() => {
                              const n = parseInt(typing, 10);
                              if (n) setOffer(Math.min(OFFER_MAX, Math.max(OFFER_MIN, n)));
                              setTyping(null);
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                            style={{ width: `${Math.max(2, String(typing ?? q.offer).length)}ch`, border: "none", outline: "none",
                              background: "transparent", padding: 0, font: `800 20px ${FD}`, color: C.ice, textAlign: "center" }} />
                        </label>
                        <button onClick={() => bump(OFFER_STEP)} aria-label="Raise offer"
                          style={{ ...miniBtn, width: 40, minHeight: 40, padding: 0, borderRadius: 11 }}><Icon e="plus" s={16} /></button>
                      </div>
                    </div>
                    {q.low && (
                      <div role="note" style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 8, padding: "10px 12px",
                        borderRadius: 12, background: C.amber + "12", border: `1px solid ${C.amber}40` }}>
                        <span style={{ color: C.amber, display: "flex", marginTop: 1 }}><Icon e="warning" s={15} /></span>
                        <span style={{ font: `400 13.5px/1.45 ${FB}`, color: C.mist }}>
                          Prices under ${qRec.standardOffer + CALLOUT_FEE + DRIFT_FEE} can take longer to get picked up — drivers choose which jobs to accept, especially mid-storm.</span>
                      </div>
                    )}

                    {/* schedule */}
                    <button onClick={() => (schedAt ? setSchedAt(null) : setShowSched(true))} aria-label={schedAt ? "Book now instead" : "Schedule for later"}
                      style={{ ...miniBtn, width: "100%", minHeight: 48, marginTop: 12, justifyContent: "center", gap: 8, fontSize: 14.5,
                        ...(schedAt ? { color: C.amber, borderColor: C.amber } : {}) }}>
                      <Icon e={schedAt ? "close" : "calendar"} s={16} /> {schedAt ? `Scheduled ${schedAt.label} — book now instead` : "Schedule for later (pick a 2-hour window)"}</button>

                    {/* what's in the total */}
                    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: C.night2 }}>
                      <Row label="Your offer to the driver" value={`$${q.offer}`} />
                      <Row label="Call-out fee (all to your driver)" value={`$${CALLOUT_FEE}`} />
                      <Row label="DRIFT booking fee" value={`$${DRIFT_FEE}`} />
                      <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
                      <Row label="Total" value={`$${q.riderTotal}`} big />
                      <div style={{ font: `400 12.5px/1.45 ${FB}`, color: C.mistDim, marginTop: 6 }}>
                        Based on {jt.basis === "area" ? `${sqft.toLocaleString()} sq ft` : jt.basis === "linear" ? `~${linearFt} ft of walk` : "the job"}{q.depthMult > 1 ? `, ${q.depthLabel} of snow` : ""}{modActive ? " and your property's slope and hazards" : ""}. Tips are optional and go 100% to your driver.</div>
                    </div>
                  </div>
                )}
                <p style={{ font: `400 12.5px/1.5 ${FB}`, color: C.mistDim, textAlign: "center", margin: "12px 6px 0" }}>
                  Booking connects you with an independent local operator under our{" "}
                  <button onClick={() => setDoc("customerTerms")} style={legalLink}>Terms</button> and{" "}
                  <button onClick={() => setDoc("customerRelease")} style={legalLink}>Release</button>.</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.amber + "1F", color: C.amber,
            display: "grid", placeItems: "center", marginBottom: 14 }}><Icon e="home" s={22} /></div>
          <div style={{ ...H(22), color: C.ice }}>Add your driveway</div>
          <div style={{ font: `400 14px/1.5 ${FB}`, color: C.mist, margin: "6px 0 18px" }}>
            Search your address and we'll place a starting outline. Takes about a minute — then it's one tap every storm.</div>
          <Btn full onClick={() => go("props")}>Add my driveway</Btn>
        </div>
      )}

      {/* ---- secondary: quieter, below the fold ---- */}
      <div style={{ marginTop: 28 }}>
        <div id="other-services" />
        <Eyebrow>Other services</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <ServiceTile icon="car" title="Dig out my car" sub={`Buried by the berm · $${quickQuote("digout").riderTotal}`} onClick={guard(emergencyDigout)} disabled={!prop} />
          <ServiceTile icon="battery" title="Jump-start" sub={`Dead battery · $${quickQuote("jumpstart").riderTotal}`} onClick={guard(() => requestRoadside("jumpstart"))} disabled={!prop} />
        </div>
      </div>

      {showSched && <ScheduleSheet price={q.riderTotal} onClose={() => setShowSched(false)} onPick={schedule} />}
      {prop && !needsOutline && !needsHazards && !sendVisible && !showSched && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: "calc(65px + env(safe-area-inset-bottom))", zIndex: 19,
          background: C.glassStrong, backdropFilter: "saturate(180%) blur(18px)", WebkitBackdropFilter: "saturate(180%) blur(18px)",
          borderTop: `1px solid ${C.line}`, animation: "fadeIn .15s ease" }}>
          <div style={{ maxWidth: 440, margin: "0 auto", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: `800 26px/1 ${FD}`, color: C.ice }}>${q.riderTotal}</div>
              <div style={{ font: `400 13px ${FB}`, color: C.mist, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {schedAt ? schedAt.label : jt.label}{q.depthMult > 1 ? ` · ${q.depthLabel}` : ""}</div>
            </div>
            <Btn full onClick={guard(startRequest)} style={{ minHeight: 50 }}>{schedAt ? "Schedule plow" : "Book now"}</Btn>
          </div>
        </div>
      )}
      {gate && <ConsentGate role="customer" onClose={() => setGate(null)}
        onAgree={(rec) => { acceptLegal(dispatch, rec, state.userId); const run = gate; setGate(null); run(); }} />}
      {doc && <LegalReader docId={doc} onClose={() => setDoc(null)} />}
    </section></Fade>
  );
}

// ---- Schedule sheet: pick when to plow ------------------------------------
// 2-hour windows, up to 6 days out (card holds last about a week).
const SCHED_WINDOWS = [5, 7, 9, 11, 13, 15, 17]; // start hours
const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? " AM" : " PM"}`;
const windowLabel = (h) => { const a = hourLabel(h), b = hourLabel(h + 2); return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`; };
const dayWord = (d, i) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" });
function fmtWindowLocal(ms) {
  if (!ms) return "";
  const d = new Date(ms), today = new Date(); today.setHours(0, 0, 0, 0);
  const day0 = new Date(d); day0.setHours(0, 0, 0, 0);
  const i = Math.round((day0 - today) / 864e5);
  return `${i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" })} ${windowLabel(d.getHours())}`;
}

function ScheduleSheet({ onClose, onPick, price }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; }), []);
  const ok = (dayIdx, h) => { const t = new Date(days[dayIdx]); t.setHours(h, 0, 0, 0); return t.getTime() >= Date.now() + 60 * 60 * 1000; };
  const firstDay = SCHED_WINDOWS.some((h) => ok(0, h)) ? 0 : 1;
  const [day, setDay] = useState(firstDay);
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(null); }, [day]);
  const confirm = () => {
    const d = new Date(days[day]); d.setHours(slot, 0, 0, 0);
    onPick(d.getTime(), `${dayWord(days[day], day)} ${windowLabel(slot)}`);
  };
  return (
    <Sheet onClose={onClose}>
      <Eyebrow>Schedule a plow</Eyebrow>
      <h2 style={{ ...H(26), margin: "8px 0 4px" }}>When should we come?</h2>
      <p style={{ ...sub, marginBottom: 14 }}>Pick a 2-hour window. Your card is held now and charged only after it's plowed.</p>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14, WebkitOverflowScrolling: "touch" }}>
        {days.map((d, i) => {
          const any = SCHED_WINDOWS.some((h) => ok(i, h)), on = day === i;
          return (
            <button key={i} disabled={!any} onClick={() => setDay(i)} style={{ flex: "0 0 auto", cursor: any ? "pointer" : "default",
              padding: "10px 14px", borderRadius: 14, textAlign: "center", minWidth: 64, minHeight: 60, opacity: any ? 1 : .35,
              background: on ? C.amber : C.slate, border: `1px solid ${on ? C.amber : C.line}`, color: on ? C.onAmber : C.ice,
              WebkitTapHighlightColor: "transparent" }}>
              <div style={{ font: `700 11px ${FB}`, opacity: .85 }}>{dayWord(d, i)}</div>
              <div style={{ font: `800 22px ${FD}`, marginTop: 2 }}>{d.getDate()}</div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {SCHED_WINDOWS.map((h) => {
          const can = ok(day, h), on = slot === h;
          return (
            <button key={h} disabled={!can} onClick={() => setSlot(h)} style={{ cursor: can ? "pointer" : "default", minHeight: 52,
              borderRadius: 13, font: `700 15px ${FB}`, opacity: can ? 1 : .35,
              color: on ? C.amber : C.ice, background: on ? C.amber + "18" : C.slate, border: `1.5px solid ${on ? C.amber : C.line}`,
              WebkitTapHighlightColor: "transparent" }}>{windowLabel(h)}</button>
          );
        })}
      </div>
      <Btn full onClick={confirm} disabled={slot == null}>{slot != null ? `Schedule for ${dayWord(days[day], day)} ${windowLabel(slot)}` : "Pick a time window"}</Btn>
      <p style={{ font: `500 11.5px/1.5 ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
        Drivers claim scheduled plows ahead of time. Free to cancel until your driver starts.</p>
    </Sheet>
  );
}

// simulate driver accepting + driving if no live human driver is online.
// if the driver IS online, leave the job in "requested" so they see the incoming card.
function autoMatch(dispatch, state, order) {
  // Real accounts: save the offer to the database and let real drivers take it.
  if (isLive(state)) { if (order) persistNewJob(dispatch, order, state.userId); return; }
  if (state.driverOnline || order?.scheduledFor) return; // demo: scheduled plows wait for their window
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
function PayForm({ amount, jobId, onAuthorized, onClose, scheduled }) {
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
    try { const r = await confirmHold(jobId); onAuthorized(r.job); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div>
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" },
        paymentMethodOrder: ["apple_pay", "google_pay", "card"] }} />
      {err && <p style={{ font: `600 12px ${FB}`, color: C.danger, margin: "10px 0 0" }}>{err}</p>}
      <div style={{ marginTop: 16 }}>
        <Btn full onClick={pay} disabled={busy || !stripe}>{busy ? "Holding…" : scheduled ? `Hold $${amount} and schedule` : `Hold $${amount} and send offer`}</Btn>
      </div>
      <p style={{ font: `500 13px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
        Charged only when the job is done. Payments secured by Stripe.
      </p>
    </div>
  );
}

// Outer sheet: fetches a PaymentIntent, then mounts Stripe Elements.
function PaymentSheet({ amount, jobId, onAuthorized, onClose, scheduled }) {
  const [secret, setSecret] = useState(null);
  const [custSecret, setCustSecret] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let ok = true;
    startHold(jobId)
      .then(r => {
        if (!ok) return;
        if (r.alreadyAuthorized || r.authorized || r.required === false) { onAuthorized(r.job); return; }
        if (r.clientSecret) { setCustSecret(r.customerSessionClientSecret || null); setSecret(r.clientSecret); }
        else setErr(r.error || "Couldn't start payment");
      })
      .catch(e => ok && setErr(e.message));
    return () => { ok = false; };
  }, [jobId]);
  const appearance = { theme: isLight ? "stripe" : "night", variables: { colorPrimary: C.amber, colorBackground: C.night2,
    colorText: C.ice, fontFamily: "-apple-system, system-ui, sans-serif", borderRadius: "12px" } };
  return (
    <Sheet onClose={onClose}>
      <Eyebrow>Hold your card</Eyebrow>
      <h3 style={{ font: `800 31px ${FD}`, textTransform: "uppercase", margin: "8px 0 4px" }}>${amount}</h3>
      <p style={{ ...sub, marginBottom: 16 }}>{scheduled
        ? "Your scheduled plow goes on drivers' routes once your card is held. You're only charged after it's plowed. If no driver makes it, the hold is released."
        : "Your offer goes to drivers once your card is held. You're only charged after the job is done. If nobody takes it, the hold is released."}</p>
      {err ? (
        <div style={{ padding: "14px 16px", background: C.slate, borderRadius: 12, border: `1px solid ${C.danger}55` }}>
          <p style={{ font: `600 13px ${FB}`, color: C.danger, margin: 0 }}>{err}</p>
          <button onClick={onClose} style={{ marginTop: 10, background: "none", border: "none", padding: 0, cursor: "pointer",
            font: `600 13px ${FB}`, color: C.mist }}>Cancel this offer</button>
        </div>
      ) : !secret ? (
        <div style={{ display: "grid", gap: 10 }}>
          <Skeleton h={44} /><Skeleton h={44} /><Skeleton h={48} r={14} />
        </div>
      ) : (
        <Elements stripe={getStripe()} options={{ clientSecret: secret, appearance,
          ...(custSecret ? { customerSessionClientSecret: custSecret } : {}) }}>
          <PayForm amount={amount} jobId={jobId} onAuthorized={onAuthorized} onClose={onClose} scheduled={scheduled} />
        </Elements>
      )}
    </Sheet>
  );
}

// ---- Shared job chat (rider <-> driver) ------------------------------------
// Uses Supabase realtime when the job is persisted (real jobId + Supabase on);
// otherwise falls back to a local, in-session thread so the demo still chats.
function JobChat({ jobId, senderId, peerName, seed }) {
  const live = supabaseEnabled && !!jobId && !!senderId;
  const [msgs, setMsgs] = useState(live || (supabaseEnabled && senderId) ? [] : (seed || []));
  const [text, setText] = useState("");

  useEffect(() => {
    if (!live) return;
    let on = true;
    const add = (list) => setMsgs(cur => {
      const seen = new Set(cur.map(m => m.id));
      return [...cur, ...list.filter(m => !seen.has(m.id)).map(m => ({ id: m.id, me: m.sender_id === senderId, t: m.body }))];
    });
    loadMessages(jobId).then(({ data }) => { if (on) add(data); });
    const unsub = subscribeToMessages(jobId, (m) => add([m]));
    return () => { on = false; unsub(); };
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
          <div style={{ font: `500 13px ${FB}`, color: C.mistDim, textAlign: "center", padding: "6px 0" }}>Say hi <Icon e="wave" s={12} /></div>
        ) : msgs.map((m, i) => (
          <div key={m.id || i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start", marginBottom: 6 }}>
            <span style={{ font: `500 13px ${FB}`, background: m.me ? C.amber : C.slate, color: m.me ? C.onAmber : C.ice,
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
const NOTIF_ICON = { job: "plowtruck", payment: "cash", system: "snowflake", promo: "gift" };

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
      <Icon e="bell" s={17} />
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
        <div><Eyebrow>Activity</Eyebrow><h3 style={{ ...H(24), margin: "6px 0 0" }}>Notifications</h3></div>
        {list.some(n => !n.read) && (
          <button onClick={() => dispatch({ type: "NOTIF_READ" })} style={{ ...miniBtn, padding: "7px 12px" }}>Mark all read</button>
        )}
      </div>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "34px 10px" }}>
          <div style={{ fontSize: 34, marginBottom: 8, opacity: .5 }}><Icon e="bell" s={34} /></div>
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
                background: C.night2, fontSize: 17 }}><Icon e={NOTIF_ICON[n.kind] || "snowflake"} s={17} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ font: `700 13px ${FB}`, color: C.ice }}>{n.title}</span>
                  <span style={{ font: `500 10px ${FB}`, color: C.mistDim, flexShrink: 0 }}>{timeAgo(n.ts)}</span>
                </div>
                {n.body && <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 3, lineHeight: 1.35 }}>{n.body}</div>}
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
  const LIVE = isLive(state);
  // In live mode the driver is whoever actually accepted; the demo uses a sample driver.
  const d = LIVE ? (o.driver || { name: "Your driver", rating: null, jobs: 0, truck: "Plow truck" }) : state.driver;
  const [reviewsOpen, setReviewsOpen] = useState(false);
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
  const driverLL = LIVE ? liveLL : (liveLL || simLL);

  // ---- LIVE: follow the real job in the database ----
  const applyRow = async (row) => {
    if (!row) return;
    if (row.status === "cancelled" || row.status === "expired") {
      dispatch({ type: "CLEAR_ORDER" });
      dispatch({ type: "TOAST", msg: row.status === "expired" ? (row.scheduled_for ? "No driver made your scheduled window — you weren't charged." : "No plow took this offer — you weren't charged. Try a higher offer.")
        : "This job was cancelled. You weren't charged." });
      return;
    }
    const map = { requested: "requested", scheduled: "scheduled", accepted: "enroute", enroute: "enroute", plowing: "plowing", completed: "arrived_done" };
    const patch = { state: map[row.status] || o.state, driverId: row.driver_id || null, photos: row.photos || o.photos,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).getTime() : o.scheduledFor || null,
      checkedInAt: row.checked_in_at ? new Date(row.checked_in_at).getTime() : null,
      paymentStatus: row.payment_status, expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : o.expiresAt,
      exclusiveUntil: row.exclusive_until ? new Date(row.exclusive_until).getTime() : null,
      preferredDriverIds: row.preferred_driver_ids || [] };
    if (row.driver_id && (!o.driver || o.driver.id !== row.driver_id)) {
      const { data: p } = await getProfile(row.driver_id);
      patch.driver = profileToDriver(p) || { id: row.driver_id, name: "Your driver", rating: null, jobs: 0, truck: "Plow truck" };
      if (o.state === "requested" || (o.state === "scheduled" && row.status === "scheduled")) {
        notify(dispatch, { kind: "job", title: o.state === "scheduled" ? `${patch.driver.name.split(" ")[0]} claimed your scheduled plow` : `${patch.driver.name.split(" ")[0]} accepted your offer`,
          body: "Your driver is heading to your property.", role: "rider" }, state.profile?.phone);
      }
    }
    if (row.status === "completed" && o.state !== "arrived_done") {
      patch.completed = true;
      dispatch({ type: "COMPLETE", q: { ...o.quote, driverPay: Number(row.driver_pay) }, size: o.size, driverName: (patch.driver || o.driver)?.name });
      notify(dispatch, { kind: "job", title: "Your property is plowed",
        body: `${o.property?.label || "Your driveway"} is clear.`, role: "rider" }, state.profile?.phone);
    }
    dispatch({ type: "ORDER_STATE", patch });
  };
  useEffect(() => {
    if (!LIVE || !o.jobId) return;
    fetchJob(o.jobId).then(({ data }) => applyRow(data));
    const unsub = subscribeToJob(o.jobId, applyRow);
    const iv = setInterval(() => fetchJob(o.jobId).then(({ data }) => applyRow(data)), 10000); // safety net if realtime drops
    return () => { unsub(); clearInterval(iv); };
  }, [LIVE, o.jobId, o.state, o.driver?.id]);

  // Your driver may have a job or two before yours (drivers can line up 3).
  const [ahead, setAhead] = useState(0);
  useEffect(() => {
    if (!LIVE || !o.jobId || !["accepted", "enroute"].includes(o.state)) { setAhead(0); return; }
    let on = true;
    const check = () => queuePosition(o.jobId).then((n) => on && setAhead(n));
    check(); const iv = setInterval(check, 20000);
    return () => { on = false; clearInterval(iv); };
  }, [LIVE, o.jobId, o.state]);

  // ---- LIVE: offers expire after 20 minutes if nobody takes them ----
  const [now, setNow] = useState(Date.now());
  const needsCard = LIVE && !!o.jobId && o.paymentStatus === "pending";
  const paidJob = LIVE && o.paymentStatus && o.paymentStatus !== "not_required";
  useEffect(() => {
    if (!LIVE || o.state !== "requested" || !o.expiresAt || needsCard) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [LIVE, o.state, o.expiresAt, needsCard]);
  const leftMs = LIVE && o.expiresAt && !needsCard ? Math.max(0, o.expiresAt - now) : null;
  useEffect(() => {
    if (leftMs !== 0 || o.state !== "requested") return;
    (paidJob ? cancelJobPaid(o.jobId, "expired").catch(() => null) : expireJob(o.jobId)).then(() => fetchJob(o.jobId)).then((r) => {
      if (r?.data?.status === "requested" || r?.data?.status === "expired") applyRow({ ...r.data, status: "expired" });
      else applyRow(r?.data);
    });
  }, [leftMs === 0]);
  const mmss = leftMs != null ? `${Math.floor(leftMs / 60000)}:${String(Math.floor(leftMs / 1000) % 60).padStart(2, "0")}` : null;
  // Favorite drivers get the offer alone for 2 minutes; then everyone else is alerted.
  const dibsMs = LIVE && o.state === "requested" && o.exclusiveUntil && !needsCard ? Math.max(0, o.exclusiveUntil - now) : 0;
  const favCount = (o.preferredDriverIds || []).length;
  // First look goes to your favorites, or (if none are online) to Elite drivers nearby.
  const [myFavIds, setMyFavIds] = useState(null);
  useEffect(() => { if (LIVE && favCount) listFavorites(state.userId).then((fs) => setMyFavIds((fs || []).map((f) => f.id))); }, [LIVE, favCount]);
  const dibsToFavs = !myFavIds || (o.preferredDriverIds || []).some((id) => myFavIds.includes(id));
  useEffect(() => {
    if (!LIVE || !o.jobId || o.state !== "requested" || !o.exclusiveUntil || needsCard) return;
    const wait = Math.max(0, o.exclusiveUntil - Date.now()) + 1500;
    const t = setTimeout(() => announceJob(o.jobId), wait);
    return () => clearTimeout(t);
  }, [LIVE, o.jobId, o.state, o.exclusiveUntil, needsCard]);

  // once accepted, advance to "en route" so the stepper shows the driving leg
  useEffect(() => {
    if (LIVE) return;
    if (o.state === "accepted" && !state.driverOnline) {
      dispatch({ type: "ORDER_STATE", patch: { state: "enroute" } });
    }
  }, [o.state, state.driverOnline]);

  // drive toward pin while en route
  useEffect(() => {
    if (LIVE) return;
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
    if (LIVE) return;
    if ((o.state === "enroute" || o.state === "accepted") && !state.driverOnline && eta <= 0) {
      dispatch({ type: "ORDER_STATE", patch: { state: "plowing" } });
    }
  }, [eta, o.state, state.driverOnline]);

  // plowing -> done (auto-sim only; if a driver is online they drive the flow + photos)
  useEffect(() => {
    if (LIVE) return;
    if (o.state !== "plowing" || state.driverOnline) return;
    const t = setTimeout(() => {
      // auto-generate before/after photos so the receipt still shows proof
      const before = { seed: 12, phase: "before", ts: Date.now() };
      const after = { seed: 12, phase: "after", ts: Date.now() };
      dispatch({ type: "ADD_PHOTO", phase: "before", photo: before });
      dispatch({ type: "ADD_PHOTO", phase: "after", photo: after });
      const driverPay = driverNetPay(o.quote, state.driver);
      // credit earnings at the driver's flat 80% share
      dispatch({ type: "COMPLETE", q: { ...o.quote, driverPay }, size: o.size });
      dispatch({ type: "ORDER_STATE", patch: { state: "arrived_done", completed: true } });
      notify(dispatch, { kind: "job", title: "Your property is plowed",
        body: `${o.property?.label || "Your driveway"} is clear. Before & after photos are on your receipt.`, role: "rider" }, state.profile?.phone);
      notify(dispatch, { kind: "payment", title: `Charged $${o.quote?.riderTotal}`,
        body: "Payment complete — thanks for using DRIFT.", role: "rider" });
    }, 4200);
    return () => clearTimeout(t);
  }, [o.state, state.driverOnline]);

  const cancelOffer = async (quiet) => {
    if (LIVE) {
      if (!o.jobId) cancelledBeforeSaved.add(o.id);
      else if (paidJob) {
        try { await cancelJobPaid(o.jobId); }
        catch (e) { dispatch({ type: "TOAST", msg: `Couldn't cancel — ${e.message}` }); return; }
      } else cancelJob(o.jobId);
    }
    dispatch({ type: "CLEAR_ORDER" });
    dispatch({ type: "TOAST", msg: quiet ? "Offer not sent — you weren't charged" : "Request cancelled — you weren't charged" });
  };

  if (o.state === "arrived_done") return <RiderReceipt />;
  if (o.state === "scheduled") return <RiderScheduled o={o} d={o.driver} cancelOffer={cancelOffer} needsCard={needsCard}
    onAuthorized={() => { dispatch({ type: "ORDER_STATE", patch: { paymentStatus: "authorized" } }); dispatch({ type: "TOAST", msg: `Card held — scheduled for ${fmtWindowLocal(o.scheduledFor)}` }); }} />;

  const first = d.name.split(" ")[0];
  const finding = o.state === "requested";
  const liveArrived = o.state === "plowing";
  const shownArrived = LIVE ? liveArrived : arrived;
  const stage = finding ? 0 : shownArrived ? 2 : 1;         // 0 sent · 1 on the way · 2 plowing · 3 done
  // Live: real distance + drive time from the driver's phone to your driveway.
  const liveEta = LIVE && !finding && !shownArrived && ahead === 0 && driverLL && trackCenter ? driveEstimate(driverLL, trackCenter) : null;
  const big = finding ? "Finding your plow" : shownArrived ? "Plowing now" : LIVE ? (liveEta ? `${liveEta.mins} min` : ahead > 0 ? "You're next" : "On the way") : `${Math.max(1, Math.ceil(eta))} min`;
  const line = finding ? (LIVE ? (needsCard ? "Hold your card to send your offer to drivers"
        : !o.jobId ? "Sending your offer…"
        : dibsMs > 0 ? `${dibsToFavs ? `Sent to your favorite driver${favCount === 1 ? "" : "s"} first` : "Sent to top-rated drivers nearby first"} · everyone else sees it in ${Math.floor(dibsMs / 60000)}:${String(Math.floor(dibsMs / 1000) % 60).padStart(2, "0")}`
        : `Your $${o.quote?.offer} offer is live for drivers nearby${mmss ? ` · ${mmss} left` : ""}`)
      : "Sent to plows near you — usually under 2 minutes")
    : shownArrived ? `${first} is clearing ${o.property?.label?.toLowerCase() === "home" ? "your driveway" : (o.property?.label || "your property")}`
    : ahead > 0 ? `${first} is finishing ${ahead} job${ahead > 1 ? "s" : ""} first, then heading to you`
    : liveEta ? `${first} is ${miText(liveEta.mi)} away` : `${first} is on the way`;

  return (
    <section style={{ paddingTop: 10, paddingBottom: 28 }}>
      {/* one big answer, one line (Uber / DoorDash) */}
      <div style={{ padding: "14px 2px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, font: `500 12px ${FM}`, letterSpacing: ".1em", textTransform: "uppercase",
          color: finding ? C.amber : shownArrived ? C.push : C.plow }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: "pulse 1.6s ease-in-out infinite" }} />
          {finding ? "Finding a driver" : shownArrived ? "On site" : "On the way"}</div>
        <div style={{ font: `800 ${finding || shownArrived || !/min$/.test(big) ? 42 : 64}px/.92 ${FD}`, textTransform: "uppercase", letterSpacing: ".005em", color: C.ice, marginTop: 8 }}>{big}</div>
        <div style={{ font: `400 15.5px/1.4 ${FB}`, color: C.mist, marginTop: 8 }}>{line}</div>
      </div>

      {/* your driver, up top */}
      {!finding && (
        <div style={{ marginTop: 16, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 18, padding: "12px 12px 12px 14px",
          display: "flex", gap: 12, alignItems: "center" }}>
          <Avatar name={d.name} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `600 16px ${FB}`, color: C.ice }}>{d.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, font: `400 13.5px ${FB}`, color: C.mist, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {d.rating && <span style={{ color: C.amber, display: "flex" }}><Icon e="star" s={12} /></span>}
              {d.rating ? `${d.rating}${d.reviews ? ` (${d.reviews})` : ""}` : d.jobs ? `${d.jobs} plows` : "New driver"}{d.truck ? ` · ${d.truck}` : ""}</div>
            {LIVE && d.id && d.reviews > 0 && <button onClick={() => setReviewsOpen(true)} style={{ background: "none", border: "none", padding: 0,
              marginTop: 3, cursor: "pointer", font: `600 13px ${FB}`, color: C.amber }}>Read reviews ›</button>}
          </div>
          {!LIVE && <button onClick={() => dispatch({ type: "TOAST", msg: `Calling ${first}…` })} aria-label={`Call ${first}`}
            style={{ ...miniBtn, width: 46, minHeight: 46, padding: 0, borderRadius: "50%", background: C.night2 }}><Icon e="phone" s={17} /></button>}
          <button onClick={() => document.getElementById("chatbox")?.scrollIntoView({ behavior: "smooth" })} aria-label={`Message ${first}`}
            style={{ ...miniBtn, width: 46, minHeight: 46, padding: 0, borderRadius: "50%", background: C.amber, color: C.onAmber, border: "none" }}><Icon e="chat" s={17} /></button>
        </div>
      )}

      {/* the live map */}
      <div style={{ marginTop: 14, borderRadius: 20, overflow: "hidden", border: `1px solid ${C.line}` }}>
        {MAP_ENABLED && trackCenter ? (
          <LiveMap center={trackCenter} height={300}
            route={finding || !driverLL ? [] : [[driverLL.lng, driverLL.lat], [trackCenter.lng, trackCenter.lat]]}
            markers={finding || !driverLL ? [{ lng: trackCenter.lng, lat: trackCenter.lat, size: 26, pulse: finding }] : [
              { lng: trackCenter.lng, lat: trackCenter.lat, size: 26 },
              { lng: driverLL.lng, lat: driverLL.lat, size: 30, kind: "truck", pulse: true },
            ]} />
        ) : (
          <StormMap pin blips={finding || LIVE ? [] : [{ id: d.id || "d", x: pos.x, y: pos.y }]} selected={{ id: d.id || "d" }}
            tracking={!LIVE} driverPos={pos} showRoute={!finding && !LIVE} height={1.3} />
        )}
      </div>

      {/* one thin progress bar */}
      <div style={{ padding: "16px 2px 0" }}>
        <div style={{ display: "flex", gap: 5 }} aria-label={`Step ${stage + 1} of 4`}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, overflow: "hidden", background: C.line }}>
              <div style={{ height: "100%", borderRadius: 4, background: C.amber,
                width: i < stage ? "100%" : i === stage ? "55%" : "0%",
                animation: i === stage ? "pulse 1.6s ease-in-out infinite" : "none",
                transition: `width .6s ${EASE}` }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, font: `500 12.5px ${FB}`, color: C.mistDim }}>
          {["Sent", "On the way", "Plowing", "Done"].map((l, i) => <span key={l} style={{ color: i === stage ? C.ice : i < stage ? C.mist : C.mistDim, fontWeight: i === stage ? 600 : 500 }}>{l}</span>)}
        </div>
      </div>

      {needsCard && (STRIPE_ENABLED
        ? <PaymentSheet amount={o.quote?.riderTotal} jobId={o.jobId} onClose={() => cancelOffer(true)}
            onAuthorized={(job) => {
              dispatch({ type: "ORDER_STATE", patch: { paymentStatus: "authorized",
                expiresAt: job?.expires_at ? new Date(job.expires_at).getTime() : Date.now() + 20 * 60 * 1000,
                exclusiveUntil: job?.exclusive_until ? new Date(job.exclusive_until).getTime() : null,
                preferredDriverIds: job?.preferred_driver_ids || [] } });
              dispatch({ type: "TOAST", msg: "Card held — your offer is live" });
            }} />
        : <Sheet onClose={() => cancelOffer(true)}>
            <p style={{ ...sub }}>Card payments aren't switched on in this version of the app yet.</p>
            <Btn full onClick={() => cancelOffer(true)}>Cancel offer</Btn>
          </Sheet>)}

      {/* chat — real Supabase thread when the job is persisted, else in-session */}
      {!finding && <JobChat jobId={o.jobId} senderId={state.userId} peerName={first}
        seed={[{ me: false, t: "On my way — about 8 min." }]} />}

      {!shownArrived && (
        <button onClick={() => cancelOffer()}
          style={{ display: "block", margin: "18px auto 0", background: "none", border: "none", cursor: "pointer",
            font: `500 14px ${FB}`, color: C.danger, padding: 8 }}>Cancel request</button>
      )}
      {reviewsOpen && <ReviewsSheet userId={d.id} name={d.name?.split(" ")[0]} rating={d.rating} count={d.reviews}
        onClose={() => setReviewsOpen(false)} />}
    </section>
  );
}

// A scheduled plow: when it is, who's on it, and the card hold.
function RiderScheduled({ o, d, cancelOffer, needsCard, onAuthorized }) {
  const first = d?.name ? d.name.split(" ")[0] : null;
  const steps = [
    ["Scheduled", true],
    [first ? `${first} claimed it` : "Waiting for a driver to claim it", !!first],
    [first && o.checkedInAt ? `${first} checked in` : "Driver checks in before your window", !!(first && o.checkedInAt)],
    ["Plowed + photos", false],
  ];
  return (
    <section style={{ paddingTop: 14, paddingBottom: 28 }}>
      <Eyebrow>Scheduled plow</Eyebrow>
      <div style={{ font: `800 44px/.95 ${FD}`, textTransform: "uppercase", color: C.ice, marginTop: 8 }}>{fmtWindowLocal(o.scheduledFor)}</div>
      <div style={{ font: `400 15px ${FB}`, color: C.mist, marginTop: 8 }}>
        {o.property?.addr || o.property?.label || "Your property"} · ${o.quote?.riderTotal} total · charged only after it's plowed</div>
      <div style={{ marginTop: 18, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 18, padding: "6px 16px" }}>
        {steps.map(([label, done], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0,
              background: done ? C.push + "22" : C.night2, color: done ? C.push : C.mistDim }}>
              {done ? <Icon e="check" s={14} strokeWidth={2.4} /> : <span style={{ font: `700 12px ${FB}` }}>{i + 1}</span>}</span>
            <span style={{ font: `${done ? 600 : 400} 14.5px ${FB}`, color: done ? C.ice : C.mist }}>{label}</span>
          </div>
        ))}
      </div>
      <p style={{ font: `400 13px/1.5 ${FB}`, color: C.mistDim, margin: "14px 2px 0" }}>
        Drivers claim scheduled plows ahead of time and must check in before your window. If a driver drops out, it goes back to every driver nearby. We'll notify you at each step.</p>
      {needsCard && (STRIPE_ENABLED
        ? <PaymentSheet amount={o.quote?.riderTotal} jobId={o.jobId} scheduled onClose={() => cancelOffer(true)} onAuthorized={onAuthorized} />
        : <Sheet onClose={() => cancelOffer(true)}><p style={{ ...sub }}>Card payments aren't switched on yet.</p><Btn full onClick={() => cancelOffer(true)}>Cancel</Btn></Sheet>)}
      <button onClick={() => cancelOffer()} style={{ display: "block", margin: "20px auto 0", background: "none", border: "none",
        cursor: "pointer", font: `500 14px ${FB}`, color: C.danger, padding: 8 }}>Cancel scheduled plow</button>
    </section>
  );
}

function RiderReceipt() {
  const { state, dispatch } = useStore();
  const o = state.order, q = o.quote, d = isLive(state) ? (o.driver || { name: "Your driver", rating: null, jobs: 0, truck: "" }) : state.driver;
  const jtR = JOB_TYPES[o.jobType || "driveway"];
  const isRoadside = ROADSIDE.includes(o.jobType);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [fav, setFav] = useState(false);
  const canFav = isLive(state) && !!(d.id || o.driverId);
  const toggleFav = async () => {
    const id = d.id || o.driverId;
    const r = fav ? await removeFavorite(state.userId, id) : await addFavorite(state.userId, id);
    if (r?.error) { dispatch({ type: "TOAST", msg: "Couldn't save that — try again from Account" }); return; }
    setFav(!fav);
    dispatch({ type: "TOAST", msg: fav ? "Removed from favorites" : `${d.name.split(" ")[0]} saved — they'll get first dibs on your next offer` });
  };
  const [tip, setTip] = useState(0);
  const [done, setDone] = useState(false);

  const finish = () => {
    // save the rating + written review (shows on the driver's profile)
    if (rating > 0 && state.userId) {
      rateJob({ jobId: o.jobId || o.id, raterId: state.userId, rateeId: d.id || o.driverId, stars: rating, comment })
        .then((r) => { if (r?.error && isLive(state)) console.warn("rating not saved:", r.error.message); });
    }
    // route the tip to the driver: earnings + notification now, real charge when Stripe's on
    if (tip > 0) {
      dispatch({ type: "TIP", amt: tip });
      notify(dispatch, { kind: "payment", title: `$${tip} tip from your customer`,
        body: `Nice work on ${o.property?.label || "the job"} — 100% of the tip is yours.`, role: "driver" });
      if (isLive(state) && o.jobId && o.paymentStatus && o.paymentStatus !== "not_required") {
        tipJob(o.jobId, tip).catch((e) => dispatch({ type: "TOAST", msg: `Tip didn't go through — ${e.message}` }));
      }
    }
    dispatch({ type: "CLEAR_ORDER" });
    dispatch({ type: "TOAST", msg: tip ? `Thanks! $${tip} tip sent to ${d.name.split(" ")[0]}` : "Thanks! Receipt saved to Trips" });
  };

  return (
    <section style={{ paddingTop: 8 }}>
      <div style={{ textAlign: "center", margin: "12px 0 20px" }}>
        <DoneCheck />
        <h2 style={{ font: `800 40px/1 ${FD}`, textTransform: "uppercase", margin: "16px 0 0" }}>{isRoadside ? "Back on the road" : "Plowed & clear"}</h2>
        <p style={{ ...sub, marginTop: 8, fontSize: 15 }}>{d.name} finished your {jtR.label.toLowerCase()}{q.salt ? " + salting" : ""}.</p>
      </div>

      {/* proof of work: drag to compare */}
      {(o.photos?.before?.length || o.photos?.after?.length) ? (
        <div style={{ marginBottom: 16 }}>
          <BeforeAfter before={o.photos?.before?.[0]} after={o.photos?.after?.[0]} />
          <div style={{ font: `500 13px ${FB}`, color: C.mist, textAlign: "center", marginTop: 8 }}>Drag to compare before and after</div>
        </div>
      ) : null}

      <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 }}>
        {q.offer != null && <>
          <Row label="Your offer" value={`$${q.offer}`} />
          <Row label="Driver call-out fee" value={`$${q.calloutFee || CALLOUT_FEE}`} />
          <Row label="DRIFT booking fee" value={`$${q.driftFee || DRIFT_FEE}`} />
          <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
        </>}
        <Row label={q.offer != null ? "Total" : jtR.label} value={`$${q.riderTotal}`} big />
        <p style={{ font: `400 13px ${FB}`, color: C.mistDim, margin: "8px 0 0" }}>{isLive(state) ? (o.paymentStatus === "captured" ? "Charged to your card when the job was marked done"
          : o.paymentStatus === "failed" ? "We couldn't charge your card — we'll reach out" : "Receipt saved to Trips")
          : `Charged to ···${state.payment?.last4 || "4242"} when the job was marked done`}</p>
      </div>

      <div style={{ marginTop: 18, textAlign: "center" }}>
        <Eyebrow>Rate {d.name.split(" ")[0]}</Eyebrow>
        <div style={{ margin: "10px 0" }}><Stars v={rating} size={30} onSet={setRating} /></div>
        {rating > 0 && (
          <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 500))} rows={3}
            placeholder={rating >= 4 ? "What did they do well? (optional)" : "What could have gone better? (optional)"}
            style={{ ...inp, resize: "none", margin: "4px 0 12px", font: `400 15px/1.4 ${FB}` }} />
        )}
        {canFav && (
          <button onClick={toggleFav} style={{ ...miniBtn, margin: "0 auto 12px", display: "inline-flex", alignItems: "center", gap: 6,
            color: fav ? C.onAmber : C.ice, background: fav ? C.amber : C.night2, border: fav ? "none" : `1px solid ${C.line}` }}>
            <Icon e="heart" s={15} /> {fav ? `${d.name.split(" ")[0]} is a favorite` : `Save ${d.name.split(" ")[0]} as a favorite`}</button>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {[5, 10, 15].map(t => (
            <button key={t} onClick={() => setTip(tip === t ? 0 : t)} style={{ ...miniBtn, background: tip === t ? C.amber : C.night2,
              color: tip === t ? C.onAmber : C.ice, border: tip === t ? "none" : `1px solid ${C.line}` }}>Tip ${t}</button>
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
      <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: "6px 0 12px" }}>
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
              <span>{on ? <Icon e="warning" s={12} /> : "+"}</span>{h.label}
            </button>
          );
        })}
      </div>

      {/* shared drive */}
      <button onClick={() => setShared(!shared)} style={{ width: "100%", cursor: "pointer", textAlign: "left",
        display: "flex", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 12,
        background: C.slate, border: `1.5px solid ${shared ? C.push : C.line}` }}>
        <div><div style={{ font: `700 13px ${FB}`, color: C.ice }}>Shared driveway</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>Split cost with neighbors — 10% off</div></div>
        <Toggle on={shared} />
      </button>
    </div>
  );
}

// Set by the booking screen when a property still needs its one-time hazard check.
let editPropertyOnOpen = null;

function RiderProperties({ onBackToBook }) {
  const { state, dispatch } = useStore();
  // Opened from "Mark hazards" on the booking screen → jump straight into that property's map.
  const [fromBooking] = useState(() => !!editPropertyOnOpen);
  const [editing, setEditing] = useState(() => {
    const p = editPropertyOnOpen && state.properties.find((x) => x.id === editPropertyOnOpen);
    editPropertyOnOpen = null;
    return p || null;
  }); // property being edited or "new"
  const [label, setLabel] = useState(""); const [addr, setAddr] = useState("");
  const [grade, setGrade] = useState(() => (editing && editing !== "new" ? editing.grade || "flat" : "flat"));
  const [hazards, setHazards] = useState(() => (editing && editing !== "new" ? editing.hazards || [] : []));
  const [shared, setShared] = useState(() => !!(editing && editing !== "new" && editing.shared));

  const startEdit = (p) => {
    setGrade(p.grade || "flat"); setHazards(p.hazards || []); setShared(!!p.shared);
    setEditing(p);
  };
  const startNew = () => { setLabel(""); setAddr(""); setGrade("flat"); setHazards([]); setShared(false); setEditing("new"); };

  if (editing) {
    const existing = editing === "new" ? null : { center: editing.center, features: editing.features, sqft: editing.sqft, address: editing.addr };
    return (
      <Fade k="edit"><section style={{ paddingTop: 18 }}>
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
            onQuote={(sqft) => quoteJob({ jobType: "driveway", sqft, property: { grade, hazards, shared } }).suggested}
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
              if (fromBooking && onBackToBook) onBackToBook();
            }} />
        </div>
      </section></Fade>
    );
  }

  return (
    <Fade k="props"><section style={{ paddingTop: 18 }}>
      <Eyebrow>Your properties</Eyebrow>
      <h2 style={{ ...h2, marginBottom: 6 }}>Properties</h2>
      <p style={{ ...sub, marginBottom: S.lg }}>Set each up once. Every future job reuses the map and site details.</p>

      {state.properties.length === 0 ? (
        <EmptyState icon="map" title="No properties yet"
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
                    <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.addr}</div>
                    <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Chip color={C.plow}>{p.zones.filter(z => z.mode === "plow").length} plow</Chip>
                      <Chip color={C.push}>{p.zones.filter(z => z.mode === "push").length} push</Chip>
                      {p.grade && p.grade !== "flat" && <Chip color={C.amber}>{MODIFIERS.grade[p.grade].label}</Chip>}
                      {(p.hazards || []).length > 0 && <Chip color={C.danger}>{p.hazards.length} hazard{p.hazards.length > 1 ? "s" : ""}</Chip>}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ font: `400 12.5px ${FB}`, color: C.mistDim }}>Suggested</div>
                  <div style={{ font: `800 22px ${FD}`, textTransform: "uppercase", color: C.ice }}>${pq.suggested ?? pq.riderTotal}</div>
                  <button onClick={(ev) => { ev.stopPropagation(); startEdit(p); }}
                    style={{ ...miniBtn, minHeight: 32, fontSize: 12, marginTop: 7 }}>Edit</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {state.properties.length > 0 && <Btn full kind="dark" onClick={startNew}>+ Add a property</Btn>}

      {/* auto-plow — no contract: set a snow trigger, only pay when it snows (demo only until weather-based dispatch exists) */}
      {!isLive(state) && <div style={{ marginTop: S.xl }}>
        <Eyebrow>Auto-plow</Eyebrow>
        <Card active={state.autoPlow} onClick={() => { const turningOn = !state.autoPlow; dispatch({ type: "AUTOPLOW", v: turningOn });
          dispatch({ type: "TOAST", msg: turningOn ? `Auto-plow on — we'll dispatch at ${state.autoPlowThreshold}"+ snow` : "Auto-plow off" }); }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: state.autoPlow ? C.amber + "1E" : C.night2,
              display: "grid", placeItems: "center", fontSize: 19, flexShrink: 0 }}><Icon e="repeat" s={19} /></div>
            <div><div style={{ font: `700 14px ${FB}` }}>Auto-plow this winter</div>
              <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>
                {state.autoPlow ? `Dispatches at ${state.autoPlowThreshold}"+ · cancel anytime` : "Set a trigger once — only pay when it snows, no contract"}</div></div>
          </div>
          <Toggle on={state.autoPlow} />
        </Card>

        {state.autoPlow && (
          <div style={{ marginTop: 10, background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 15 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ font: `600 12px ${FB}`, color: C.mist }}>Send a plow when snow reaches</span>
              <span style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.amber, lineHeight: 1 }}>{state.autoPlowThreshold}"</span>
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
              <span style={{ fontSize: 16 }}><Icon e="snow" s={16} /></span>
              <span style={{ font: `500 12px/1.45 ${FB}`, color: C.mist }}>
                Next storm: <b style={{ color: C.ice }}>{FORECAST.low}–{FORECAST.high}" {FORECAST.when}</b>.{" "}
                {FORECAST.high >= state.autoPlowThreshold
                  ? <b style={{ color: C.push }}>Meets your {state.autoPlowThreshold}" trigger — you're queued.</b>
                  : <span style={{ color: C.mistDim }}>Below your {state.autoPlowThreshold}" trigger — we'll sit this one out.</span>}
              </span>
            </div>

            <div style={{ marginTop: 10, font: `500 13px ${FB}`, color: C.mistDim, textAlign: "center" }}>
              No monthly fee · $0 when it doesn't snow · turn off anytime
            </div>
          </div>
        )}
      </div>}
    </section></Fade>
  );
}

function Toggle({ on }) {
  return <div style={{ width: 50, height: 30, borderRadius: 20, flexShrink: 0,
    background: on ? C.amber : C.line,
    position: "relative", transition: `background .28s ${EASE}`,
    boxShadow: "none" }}>
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
    autoMatch(dispatch, state, o);
  };

  const LIVE = isLive(state);
  const [tab, setTab] = useState(LIVE ? "past" : "upcoming");
  const totalSpent = Math.round(state.history.reduce((s, h) => s + h.total, 0) * 100) / 100;
  const list = tab === "upcoming" ? sched : state.history;

  return (
    <Fade k="hist"><section style={{ paddingTop: 18 }}>
      <Eyebrow>Your plows</Eyebrow>
      <h2 style={{ ...h2, marginBottom: S.md }}>Trips</h2>

      {/* summary strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: S.lg }}>
        {[
          ...(LIVE ? [] : [{ v: sched.length, l: "Upcoming", c: C.plow }]),
          { v: state.history.length, l: "Completed", c: C.push },
          { v: `$${totalSpent}`, l: "Total spent", c: C.amber },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 12px" }}>
            <div style={{ font: `800 26px ${FD}`, textTransform: "uppercase", color: s.c, lineHeight: 1 }}>{s.v}</div>
            <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {!LIVE && <><Segmented value={tab} onChange={setTab}
        options={[{ id: "upcoming", label: `Upcoming${sched.length ? ` (${sched.length})` : ""}` }, { id: "past", label: "Past" }]} />

      <div style={{ height: S.lg }} /></>}

      {/* UPCOMING */}
      {tab === "upcoming" && (
        sched.length === 0 ? (
          <EmptyState icon="calendar" title="Nothing scheduled"
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
                        <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.property?.addr}</div>
                        <div style={{ marginTop: 7, display: "flex", gap: 6 }}>
                          <Chip color={C.plow}><Icon e={jt.icon} s={13} /> {jt.label}</Chip>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ font: `800 24px ${FD}`, textTransform: "uppercase", color: C.ice }}>${job.quote.riderTotal}</div>
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
          <EmptyState icon="receipt" title="No plows yet" body="Your completed jobs and before/after photos will show up here." />
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
                          border: `1px solid ${C.line}`, display: "grid", placeItems: "center", fontSize: 19, flexShrink: 0 }}><Icon e="snowflake" s={19} /></div>}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: `700 15px ${FB}` }}>{h.jobType && JOB_TYPES[h.jobType] ? JOB_TYPES[h.jobType].label : `${h.size} plow`}</div>
                      <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 3 }}>{h.date} · {h.driver}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                        {h.rating > 0 && <Stars v={h.rating} size={11} />}
                        {hasPhotos && <span style={{ font: `600 11px ${FB}`, color: C.plow }}><Icon e="camera" s={13} /> Before / after</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ font: `800 24px ${FD}`, textTransform: "uppercase", color: C.ice }}>${h.total}</div>
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
      <div style={{ fontSize: 34, marginBottom: S.md, opacity: .9 }}><Icon e={icon} s={34} /></div>
      <div style={{ font: `700 16px ${FB}`, color: C.ice, marginBottom: 6 }}>{title}</div>
      <div style={{ font: `500 13px/1.5 ${FB}`, color: C.mist, maxWidth: 260, margin: "0 auto" }}>{body}</div>
      {note && <div style={{ marginTop: S.md, display: "inline-flex", alignItems: "center", gap: 7,
        background: C.night2, border: `1px solid ${C.line}`, borderRadius: 20, padding: "7px 13px",
        font: `600 11px ${FB}`, color: C.mist }}><Icon e="snow" s={12} /> {note}</div>}
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
      {img && <FauxPhoto seed={img.seed} phase={img.phase} path={img.path} />}
      <div style={{ position: "absolute", bottom: 2, right: 2, background: "rgba(0,0,0,.6)", borderRadius: 4,
        padding: "1px 4px", font: `700 8px ${FB}`, color: "#fff" }}>{(photos.after?.length || 0) + (photos.before?.length || 0)}</div>
    </div>
  );
}

// a generated "photo" — a snowy vs cleared driveway gradient, deterministic by seed
function RealPhoto({ path, style }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let on = true; signedUrl("job-photos", path).then((u) => on && setUrl(u)); return () => { on = false; }; }, [path]);
  return url
    ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...style }} />
    : <div style={{ width: "100%", height: "100%", background: C.slate, ...style }} />;
}

function FauxPhoto({ seed = 1, phase = "after", style, path }) {
  if (path) return <RealPhoto path={path} style={style} />;
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

// Animated "done" check: the ring pops, then the tick draws itself.
function DoneCheck({ size = 68, color }) {
  const c = color || C.push;
  return (
    <div style={{ width: size, height: size, margin: "0 auto", borderRadius: "50%", display: "grid", placeItems: "center",
      background: c + "1F", border: `2px solid ${c}`, animation: "ring .45s cubic-bezier(.2,.9,.3,1.2) both" }}>
      <svg width={size * .46} height={size * .46} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 12.5l5 5 10-11" strokeDasharray="30" strokeDashoffset="30" style={{ animation: "draw .45s .3s ease-out forwards" }} />
      </svg>
    </div>
  );
}

// Drag-to-compare before/after photo (the moment people screenshot and share).
function BeforeAfter({ before, after, height }) {
  const [x, setX] = useState(50);
  const ref = useRef(null), drag = useRef(false);
  const move = (e) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    setX(Math.min(97, Math.max(3, ((e.clientX - r.left) / r.width) * 100)));
  };
  return (
    <div ref={ref} role="slider" aria-label="Drag to compare before and after" aria-valuenow={Math.round(x)} tabIndex={0}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") setX((v) => Math.max(3, v - 5)); if (e.key === "ArrowRight") setX((v) => Math.min(97, v + 5)); }}
      onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); move(e); }}
      onPointerMove={(e) => drag.current && move(e)} onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
      style={{ position: "relative", width: "100%", height: height || undefined, aspectRatio: height ? undefined : "1.25", borderRadius: 18,
        overflow: "hidden", border: `1px solid ${C.line}`, touchAction: "pan-y", cursor: "ew-resize", userSelect: "none", background: C.slate }}>
      <div style={{ position: "absolute", inset: 0 }}><FauxPhoto seed={after?.seed || 3} phase="after" path={after?.path} /></div>
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - x}% 0 0)` }}>
        <FauxPhoto seed={before?.seed || 3} phase="before" path={before?.path} /></div>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${x}%`, width: 2, marginLeft: -1, background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,.4)" }} />
      <div style={{ position: "absolute", top: "50%", left: `${x}%`, width: 38, height: 38, margin: "-19px 0 0 -19px", borderRadius: "50%",
        background: "#fff", color: "#14161A", display: "grid", placeItems: "center", boxShadow: "0 4px 14px rgba(0,0,0,.35)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" /></svg>
      </div>
      {[["BEFORE", 10, "left"], ["AFTER", 10, "right"]].map(([t, o, side]) => (
        <div key={t} style={{ position: "absolute", top: 10, [side]: o, background: "rgba(0,0,0,.55)", borderRadius: 7,
          padding: "4px 9px", font: `700 10.5px ${FM}`, letterSpacing: ".08em", color: "#fff" }}>{t}</div>
      ))}
    </div>
  );
}

// full-screen before/after viewer with a wipe slider
function PhotoViewer({ job, onClose }) {
  const before = job.photos?.before?.[0] || { seed: 3, phase: "before" };
  const after = job.photos?.after?.[0] || { seed: 3, phase: "after" };
  const [wipe, setWipe] = useState(50);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: C.scrim, zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ ...H(20), color: C.ice }}>Before & after</div>
          <button onClick={onClose} style={{ ...miniBtn, padding: "7px 12px" }}>Close</button>
        </div>
        <BeforeAfter before={before} after={after} />
        <p style={{ font: `500 13px ${FB}`, color: C.mist, textAlign: "center", marginTop: 10 }}>
          Drag to compare · {job.driver} · {job.date}
        </p>
      </div>
    </div>
  );
}

// ---- iOS-style grouped list (Settings / Account screens) -------------------
function ListGroup({ children, style }) {
  return <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", ...style }}>{children}</div>;
}
function ListRow({ icon, tint, title, sub, right, onClick, last }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px",
      background: "transparent", border: "none", borderBottom: last ? "none" : `1px solid ${C.lineSoft}`,
      cursor: onClick ? "pointer" : "default", textAlign: "left", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, background: (tint || C.mist) + "1F", color: tint || C.mist,
        display: "grid", placeItems: "center", flexShrink: 0 }}><Icon e={icon} s={17} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", font: `600 15px ${FB}`, color: C.ice }}>{title}</span>
        {sub && <span style={{ display: "block", font: `400 13px ${FB}`, color: C.mist, marginTop: 1 }}>{sub}</span>}
      </span>
      {right}
      {onClick && <span style={{ color: C.mistDim, display: "flex" }}><Icon e="chevronright" s={16} /></span>}
    </Tag>
  );
}

// Appearance: Auto follows the phone; Light is easier to read outside in bright snow.
function AppearancePicker() {
  const [mode, setMode] = useState(getThemeMode());
  const opts = [["auto", "Auto", "auto"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]];
  return (
    <ListGroup style={{ padding: 14 }}>
      <div style={{ font: `600 15px ${FB}`, color: C.ice }}>Appearance</div>
      <div style={{ font: `400 13px/1.4 ${FB}`, color: C.mist, marginTop: 2 }}>
        Light is easier to read outside in bright snow. Auto follows your phone.</div>
      <div role="radiogroup" aria-label="Appearance" style={{ display: "flex", background: C.night2, borderRadius: 11, padding: 3, marginTop: 12 }}>
        {opts.map(([id, label, ic]) => {
          const on = mode === id;
          return (
            <button key={id} role="radio" aria-checked={on} onClick={() => { setMode(id); applyTheme(id); }}
              style={{ flex: 1, minHeight: 38, border: "none", borderRadius: 9, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                font: `600 13px ${FB}`, color: on ? C.ice : C.mist, background: on ? C.slate2 : "transparent",
                boxShadow: on ? E.low : "none", WebkitTapHighlightColor: "transparent" }}>
              <Icon e={ic} s={15} />{label}</button>
          );
        })}
      </div>
    </ListGroup>
  );
}

// ---- Account settings: profile + saved cards ------------------------------
function ProfileSheet({ onClose, driver }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(driver ? (state.driver.name || state.profile.name || "") : (state.profile.name || ""));
  const [phone, setPhone] = useState(state.profile.phone || "");
  const [truck, setTruck] = useState(state.driver.truck || "");
  const [tools, setTools] = useState(state.driver.tools || []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const patch = { name: name.trim(), phone: phone.trim(), ...(driver ? { truck: truck.trim(), tools } : {}) };
    if (isLive(state)) {
      const { error } = await updateMyProfile(state.userId, patch);
      if (error) { setBusy(false); dispatch({ type: "TOAST", msg: `Couldn't save — ${error.message}` }); return; }
    }
    dispatch({ type: "SET_PROFILE", patch: { name: patch.name, phone: patch.phone } });
    if (driver) dispatch({ type: "UPDATE_DRIVER", patch: { name: patch.name, truck: patch.truck, tools } });
    dispatch({ type: "TOAST", msg: "Saved" });
    onClose();
  };
  const input = { width: "100%", background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 14px",
    color: C.ice, font: `500 16px ${FB}`, outline: "none" };
  const label = { font: `600 13px ${FB}`, color: C.mist, margin: "14px 0 6px", display: "block" };
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), margin: "0 0 4px" }}>{driver ? "Profile and equipment" : "Your profile"}</h3>
      <label style={label}>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={input} autoComplete="name" />
      <label style={label}>Phone</label>
      <input value={phone} onChange={(e) => setPhone(fmtPhone(e.target.value))} style={input} inputMode="tel" autoComplete="tel" placeholder="(218) 555-0123" />
      <label style={label}>Email</label>
      <div style={{ ...input, color: C.mist }}>{state.profile.email || "—"}</div>
      {driver && <>
        <label style={label}>Truck</label>
        <input value={truck} onChange={(e) => setTruck(e.target.value)} style={input} placeholder="F-350 · 9ft V-Plow" />
        <label style={label}>Equipment</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TOOL_OPTIONS.map((t) => { const on = tools.includes(t.id); return (
            <button key={t.id} onClick={() => setTools((ts) => on ? ts.filter((x) => x !== t.id) : [...ts, t.id])}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 13px", borderRadius: 20, cursor: "pointer",
                background: on ? C.push + "18" : C.slate, border: `1px solid ${on ? C.push : C.line}`,
                font: `600 13px ${FB}`, color: on ? C.push : C.mist }}>
              <Icon e={t.icon} s={15} />{t.label}{on && <Icon e="check" s={13} />}</button>); })}
        </div>
        <p style={{ font: `400 13px ${FB}`, color: C.mistDim, margin: "8px 0 0" }}>You'll only see jobs your equipment can do.</p>
      </>}
      <div style={{ marginTop: 18 }}>
        <Btn full onClick={save} disabled={busy || !name.trim() || (driver && !tools.length)}>{busy ? "Saving…" : "Save"}</Btn>
      </div>
    </Sheet>
  );
}

// Snow alerts: on for everyone by default; the phone has to allow notifications.
function SnowAlertsRow({ on, onInstall }) {
  const { state, dispatch } = useStore();
  const auth = useAuth();
  const [phoneOn, setPhoneOn] = useState(null);
  useEffect(() => { pushEnabled().then(setPhoneOn).catch(() => setPhoneOn(false)); }, []);
  const active = on && phoneOn;
  const tap = async () => {
    try {
      if (active) {                               // turn off
        await setSnowAlerts(state.userId, false); auth.refreshProfile();
        dispatch({ type: "TOAST", msg: "Snow alerts off" }); return;
      }
      if (isIOS() && !isStandalone()) { onInstall(); return; }   // iPhone needs the home-screen app first
      await enablePush(state.userId); setPhoneOn(true);
      if (!on) { await setSnowAlerts(state.userId, true); auth.refreshProfile(); }
      dispatch({ type: "TOAST", msg: "Snow alerts on — we'll give you a heads-up before storms" });
    } catch (e) { dispatch({ type: "TOAST", msg: e.message }); }
  };
  return <ListRow icon="snowflake" tint={C.plow} title={active ? "Snow alerts on" : "Turn on snow alerts"}
    sub={active ? "A heads-up before storms · tap to turn off" : "Get a heads-up before a storm hits"} onClick={tap} />;
}

// Customer's favorite drivers (they get the first 2 minutes on every offer).
function FavoritesSheet({ onClose }) {
  const { state, dispatch } = useStore();
  const [list, setList] = useState(null);
  useEffect(() => { listFavorites(state.userId).then(setList); }, [state.userId]);
  const remove = async (id) => {
    await removeFavorite(state.userId, id);
    setList((l) => l.filter((x) => x.id !== id));
    dispatch({ type: "TOAST", msg: "Removed from favorites" });
  };
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), color: C.ice, margin: "0 0 4px" }}>Favorite drivers</h3>
      <p style={{ font: `400 14px/1.45 ${FB}`, color: C.mist, margin: "0 0 14px" }}>
        When you book, your favorites who are online get your offer first, for 2 minutes, before anyone else sees it.</p>
      {list === null ? <div style={{ font: `500 13px ${FB}`, color: C.mist }}>Loading…</div>
        : list.length === 0 ? <div style={{ font: `500 14px/1.45 ${FB}`, color: C.mist, padding: "8px 0 4px" }}>
            None yet. After a job, tap <b style={{ color: C.ice }}>Save as a favorite</b> on your receipt.</div>
        : <div style={{ display: "grid", gap: 10 }}>
          {list.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 12, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 12px" }}>
              <Avatar name={f.name} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 15px ${FB}`, color: C.ice }}>{f.name}</div>
                <div style={{ font: `400 13px ${FB}`, color: C.mist }}>{f.rating ? `★ ${f.rating} (${f.reviews})` : "New driver"}{f.truck ? ` · ${f.truck}` : ""}</div>
              </div>
              <button onClick={() => remove(f.id)} style={{ ...miniBtn, color: C.danger }}>Remove</button>
            </div>
          ))}
        </div>}
    </Sheet>
  );
}

function RiderAccount({ onReferral }) {
  const { state, dispatch } = useStore();
  const auth = useAuth();
  const p = state.profile, pay = state.payment;
  const ref = state.riderReferral;
  const [legalOpen, setLegalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  // Real accounts: Stripe keeps the card and shows it (with Remove) in the card box
  // when booking, so there's no separate card screen here.
  const realCards = isLive(state) && STRIPE_ENABLED;
  const [favsOpen, setFavsOpen] = useState(false);
  const snowOn = auth?.profile?.snow_alerts !== false;
  return (
    <Fade k="acct"><section style={{ paddingTop: 10, paddingBottom: 28 }}>
      <button onClick={() => setEditOpen(true)} style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 22, width: "100%",
        background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
        <Avatar name={p.name || "You"} size={58} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ ...H(24), color: C.ice }}>{p.name || "Your account"}</div>
          <div style={{ font: `400 13px ${FB}`, color: C.mist, marginTop: 2 }}>{[p.phone, p.email].filter(Boolean).join(" · ") || "Add your contact info"}</div>
          <div style={{ font: `600 13px ${FB}`, color: C.amber, marginTop: 4 }}>Edit profile</div>
        </div>
      </button>

      <ListGroup>
        {!realCards && <ListRow icon="card" tint={C.plow} title={pay ? `${pay.brand} ···${pay.last4}` : "Add a card"}
          sub="Charged only after a job is done" />}
        {!isStandalone() && <ListRow icon="download" tint={C.plow} title="Add DRIFT to your Home Screen" sub="Opens like an app, one tap away"
          onClick={async () => { if (canPromptInstall()) await promptInstall(); else setInstallOpen(true); }} />}
        {isLive(state) && <SnowAlertsRow on={snowOn} onInstall={() => setInstallOpen(true)} />}
        {isLive(state) && <ListRow icon="heart" tint={C.amber} title="Favorite drivers" sub="They get first dibs on your offers"
          onClick={() => setFavsOpen(true)} />}
        {!isLive(state) && <ListRow icon="gift" tint={C.amber} title={`Invite neighbors · $${ref.reward} each`}
          sub={ref.credit > 0 ? `$${ref.credit} earned · ${ref.invited} invited` : `You both get $${ref.reward}`} onClick={onReferral} />}
        <ListRow icon="lifebuoy" tint={C.push} title="Help" sub="Email support@driftplowing.com" last
          onClick={() => { window.location.href = "mailto:support@driftplowing.com?subject=DRIFT%20help"; }} />
      </ListGroup>

      <div style={{ height: 14 }} />
      <AppearancePicker />

      <div style={{ height: 14 }} />
      <ListGroup>
        <ListRow icon="plowtruck" tint={C.amber} title="Drive with DRIFT" sub="Have a plow? Earn during storms"
          onClick={() => dispatch({ type: "ROLE", role: "driver" })} />
        <ListRow icon="doc" tint={C.mist} title="Legal" sub="Terms, release, and what you agreed to"
          onClick={() => setLegalOpen(true)} last />
      </ListGroup>
      {legalOpen && <LegalHub onClose={() => setLegalOpen(false)}
        acceptance={[state.legal?.customer, state.legal?.driver].filter(Boolean)} />}
      {editOpen && <ProfileSheet onClose={() => setEditOpen(false)} />}
      {installOpen && <InstallSheet onClose={() => setInstallOpen(false)} />}
      {favsOpen && <FavoritesSheet onClose={() => setFavsOpen(false)} />}

      {auth?.isConfigured && auth?.session && (
        <button onClick={async () => { await auth.signOut(); dispatch({ type: "SIGNED_OUT" }); }}
          style={{ width: "100%", marginTop: 14, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14,
            color: C.danger, font: `600 15px ${FB}`, cursor: "pointer", padding: 14 }}>Sign out</button>
      )}
      {!supabaseEnabled && (
        <button onClick={() => dispatch({ type: "RESET" })}
          style={{ display: "flex", alignItems: "center", gap: 6, margin: "18px auto 0", background: "none", border: "none",
            color: C.mistDim, font: `500 13px ${FB}`, cursor: "pointer", padding: 8 }}>
          <Icon e="undo" s={13} /> Reset demo</button>
      )}
    </section></Fade>
  );
}

// ---- Shared referral card (code, copy, share targets, progress) -----------
function ReferralHero({ code, reward, subtitle, accent = C.amber }) {
  const { dispatch } = useStore();
  const copy = () => dispatch({ type: "TOAST", msg: `Code ${code} copied to clipboard` });
  return (
    <div style={{ borderRadius: 16, padding: 20, position: "relative", overflow: "hidden",
      background: C.slate, border: `1px solid ${accent}55` }}>
      <div style={{ position: "absolute", top: -40, right: -30, fontSize: 130, opacity: .08 }}><Icon e="gift" s={130} /></div>
      <div style={{ font: `700 13px ${FB}`, color: accent, letterSpacing: ".01em" }}>Your code</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 14px" }}>
        <div style={{ font: `800 31px ${FD}`, textTransform: "uppercase", letterSpacing: ".04em", color: C.ice }}>{code}</div>
        <button onClick={copy} style={{ ...miniBtn, padding: "6px 10px", borderColor: accent + "66" }}>Copy</button>
      </div>
      <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: "0 0 16px", maxWidth: 300 }}>{subtitle}</p>
      <div style={{ display: "flex", gap: 8 }}>
        {[["chat", "Text"], ["mail", "Email"], ["link", "Copy link"]].map(([ic, lbl]) => (
          <button key={lbl} onClick={() => dispatch({ type: "TOAST", msg: `Sharing via ${lbl}…` })}
            style={{ flex: 1, ...miniBtn, padding: "11px 8px", display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 17 }}><Icon e={ic} s={17} /></span><span style={{ font: `600 11px ${FB}` }}>{lbl}</span>
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
    <Fade k="rref"><section style={{ paddingTop: 18 }}>
      <button onClick={onBack} style={{ ...miniBtn, marginBottom: 14 }}>‹ Account</button>
      <Eyebrow>Referrals</Eyebrow>
      <h2 style={h2}>Give $15, get $15</h2>

      {/* credit banner */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.amber }}>${animCredit}</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist }}>Credit earned</div>
        </div>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.ice }}>{ref.invited}</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist }}>Neighbors invited</div>
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
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.amber, color: C.onAmber,
                display: "grid", placeItems: "center", font: `800 12px ${FB}`, flexShrink: 0 }}>{n}</div>
              <div><div style={{ font: `700 13px ${FB}` }}>{t}</div>
                <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>{d}</div></div>
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
                  <span style={{ fontSize: 17 }}>{x.status === "first-plow" ? <Icon e="checkfill" s={17} /> : <Icon e="hourglass" s={17} />}</span>
                  <div><div style={{ font: `700 13px ${FB}` }}>{x.name}</div>
                    <div style={{ font: `500 13px ${FB}`, color: C.mist }}>
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
// DRIVER ONBOARDING — finish setup before you can go online
// ============================================================
const TOOL_OPTIONS = [
  { id: "Plow truck", icon: "plowtruck", label: "Plow truck", note: "Driveways" },
  { id: "Snowblower", icon: "broom", label: "Snowblower", note: "Sidewalks, walks" },
  { id: "Snowblower / shovel", icon: "car", label: "Shovel kit", note: "Car dig-outs" },
  { id: "Roadside kit", icon: "battery", label: "Roadside kit", note: "Jump-starts" },
];

// ---- Driver documents (license, registration) — stored privately ----------
const DOC_LABELS = { license: "Driver's license", registration: "Vehicle registration", insurance: "Insurance card (optional)" };
function DocUpload({ kind, label, hint, onDone, status }) {
  const { state, dispatch } = useStore();
  const ref = useRef(null);
  const [st, setSt] = useState(status || null); // null | uploading | done
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setSt("uploading");
    try { await uploadDriverDoc(state.userId, kind, f); setSt("done"); onDone && onDone(); dispatch({ type: "TOAST", msg: `${label} uploaded` }); }
    catch (err) { setSt(status || null); dispatch({ type: "TOAST", msg: `Upload failed — ${err.message}` }); }
  };
  const done = st === "done" || st === "approved" || st === "pending";
  const bad = st === "rejected";
  return (
    <button onClick={() => st !== "uploading" && ref.current?.click()} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12,
      padding: 14, borderRadius: 14, minHeight: TAP, cursor: "pointer", textAlign: "left",
      background: done ? C.push + "12" : C.slate, border: `1px solid ${bad ? C.danger + "88" : done ? C.push + "55" : C.line}`,
      WebkitTapHighlightColor: "transparent" }}>
      <input ref={ref} type="file" accept="image/*,application/pdf" onChange={pick} style={{ display: "none" }} />
      <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center",
        background: done ? C.push + "26" : C.night2, color: bad ? C.danger : done ? C.push : C.mist }}>
        {st === "uploading" ? <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${C.line}`, borderTopColor: C.amber, animation: "spin .7s linear infinite" }} />
          : <Icon e={done ? "check" : "doc"} s={16} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14px ${FB}`, color: C.ice }}>{label}</div>
        <div style={{ font: `400 13px ${FB}`, color: bad ? C.danger : C.mist, marginTop: 2 }}>
          {st === "uploading" ? "Uploading…" : st === "approved" ? "Approved" : bad ? "Needs a new photo — tap to replace" : done ? "Uploaded · tap to replace" : hint}</div>
      </div>
      {!done && st !== "uploading" && <span style={{ font: `600 13px ${FB}`, color: C.amber }}>Upload</span>}
    </button>
  );
}

function DriverDocsCard() {
  const { state } = useStore();
  const [docs, setDocs] = useState(null);
  const load = () => myDriverDocs(state.userId).then(setDocs);
  useEffect(() => { load(); }, []);
  const latest = (k) => docs?.find((d) => d.kind === k);
  return (
    <Card style={{ marginBottom: 14 }}>
      <Eyebrow>Documents</Eyebrow>
      <p style={{ font: `400 13px/1.45 ${FB}`, color: C.mistDim, margin: "6px 0 10px" }}>
        Stored privately. Only you and DRIFT can see them — never customers.</p>
      {!docs ? <Skeleton h={56} r={14} /> : (
        <div style={{ display: "grid", gap: 8 }}>
          {["license", "registration", "insurance"].map((k) => {
            const d = latest(k);
            return <DocUpload key={k + (d?.id || "")} kind={k} label={DOC_LABELS[k]} status={d?.status}
              hint={k === "insurance" ? "Optional" : "Required to drive"} onDone={load} />;
          })}
          {docs.filter((d) => d.status === "rejected" && d.note).slice(0, 1).map((d) => (
            <p key={d.id} style={{ font: `500 13px ${FB}`, color: C.danger, margin: 0 }}>Note from DRIFT: {d.note}</p>))}
        </div>
      )}
    </Card>
  );
}

const INSURANCE_NOTE = (
  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 13px", borderRadius: 14, background: C.slate, border: `1px solid ${C.line}` }}>
    <span style={{ color: C.plow, display: "flex", marginTop: 1 }}><Icon e="shield" s={17} /></span>
    <div style={{ font: `400 13px/1.45 ${FB}`, color: C.mist }}>
      <b style={{ color: C.ice }}>About insurance:</b> DRIFT doesn't insure you or your truck. Most personal auto policies don't cover plowing for pay, so check with your agent,
      or compare snow-plowing business coverage online at{" "}
      <a href="https://www.nextinsurance.com/" target="_blank" rel="noopener noreferrer" style={{ color: C.plow, fontWeight: 600 }}>NEXT Insurance</a>.</div>
  </div>
);

function DriverOnboarding() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState(0); // 0 intro, 1 identity, 2 equipment, 3 contractor agreement, 4 payout
  const [browsing, setBrowsing] = useState(false); // look at open jobs before any paperwork
  const market = useMarket();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [truck, setTruck] = useState("");
  const [tools, setTools] = useState([]);
  const [valid, setValid] = useState({});
  const [uploads, setUploads] = useState({});
  const setV = (k, v) => setValid(s => ({ ...s, [k]: v }));
  const TOTAL = 4;
  // Real accounts: document uploads and bank setup aren't wired yet, so don't fake them.
  const LIVE_ONB = isLive(state);


  const upload = (k) => {
    setUploads(u => ({ ...u, [k]: "uploading" }));
    setTimeout(() => { setUploads(u => ({ ...u, [k]: "verified" }));
      dispatch({ type: "TOAST", msg: "Document received" }); }, 900);
  };

  const [saving, setSaving] = useState(false);
  const finish = async () => {
    if (isLive(state)) {
      setSaving(true);
      const res = await becomeDriver(state.userId, { name, phone, truck, tools }, state.legal?.driver);
      setSaving(false);
      if (res?.error) { dispatch({ type: "TOAST", msg: `Couldn't finish setup — ${res.error.message}` }); return; }
    }
    dispatch({ type: "DRIVER_ONBOARD_DONE", name, truck: truck || (LIVE_ONB ? "" : "F-350 · 9ft V-Plow"), tools,
      docs: { license: uploads.license ? "received" : "pending", plate: uploads.plate ? "received" : "pending", w9: uploads.w9 ? "received" : "pending" } });
    dispatch({ type: "TOAST", msg: `You're set up, ${name.split(" ")[0] || "driver"}. Go online whenever you want to work.` });
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
          {st === "verified" ? <Icon e="check" s={16} /> : st === "uploading" ? "…" : <Icon e="doc" s={16} />}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `700 13px ${FB}`, color: C.ice }}>{label}</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>
            {st === "verified" ? "Uploaded" : st === "uploading" ? "Uploading…" : hint}</div>
        </div>
        {!st && <span style={{ font: `700 12px ${FB}`, color: C.amber }}>Upload</span>}
      </button>
    );
  };

  if (browsing) return (
    <div style={{ padding: `10px ${S.xl}px 0`, flex: 1 }}>
      <JobsPreview onBack={() => setBrowsing(false)} onSetup={() => { setBrowsing(false); setStep(1); }} />
    </div>
  );

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
            background: "radial-gradient(120% 100% at 50% 0%, #202026 0%, #141418 74%)", color: "#F5F5F7", border: `1px solid ${C.push}44` }}>
            <HeroSnow />
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <div style={{ fontSize: 50, color: "#F5F5F7" }}><Icon e="plowtruck" s={50} /></div>
            </div>
          </div>
          <h1 style={{ font: `800 45px/1 ${FD}`, textTransform: "uppercase", margin: "0 0 10px", textAlign: "center" }}>
            Plow on your<br />own schedule.</h1>
          <p style={{ ...sub, maxWidth: 300, margin: "0 auto 16px", textAlign: "center", fontSize: 15 }}>
            Turn on when the snow flies. Take the jobs you want. You're your own boss.
          </p>
          <div style={{ font: `500 12px ${FM}`, letterSpacing: ".08em", textTransform: "uppercase", color: C.mist, textAlign: "center", marginBottom: 8 }}>Right now in Duluth</div>
          <DemandStrip m={market} style={{ marginBottom: 12 }} />
          <div style={{ display: "grid", gap: 10, marginBottom: S.xl }}>
            {[["cash", "80% of every offer + $10 per job", "The call-out fee and all tips are yours"],
              ["bolt", "Work when you want", "Go online during storms — take only the jobs you like"],
              ["bank", "Paid through Stripe", "Payouts to your bank via Stripe Connect"]].map(([i, t, d]) => (
              <div key={t} style={{ display: "flex", gap: 12, alignItems: "center", background: C.slate,
                border: `1px solid ${C.line}`, borderRadius: 14, padding: 13 }}>
                <span style={{ fontSize: 19 }}><Icon e={i} s={19} /></span>
                <div><div style={{ font: `700 13px ${FB}` }}>{t}</div>
                  <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>{d}</div></div>
              </div>
            ))}
          </div>
          <Btn full kind="good" onClick={() => setBrowsing(true)}>See open jobs and pay first</Btn>
          <div style={{ height: 8 }} />
          <Btn full kind="dark" onClick={() => setStep(1)}>Start driver setup · about 3 min</Btn>
          <button onClick={() => dispatch({ type: "ROLE", role: "rider" })}
            style={{ width: "100%", marginTop: S.md, background: "transparent", border: "none", cursor: "pointer",
              color: C.mist, font: `600 14px ${FB}`, padding: 12 }}>I need a plow instead →</button>
        </Fade>
      )}

      {step === 1 && (
        <Fade k="d1">
          <Eyebrow color={C.push}>Step 1 · Identity</Eyebrow>
          <h2 style={h2}>Who's driving?</h2>
          <p style={sub}>Used for payouts and so customers know who's coming.</p>
          <div style={{ display: "grid", gap: 12, margin: "16px 0" }}>
            <Field label="Full name" icon="user" value={name} autoFocus onChange={setName}
              validate={validators.name} placeholder="Marcus Trent" onValid={v => setV("name", v)} />
            <Field label="Phone" icon="mobile" value={phone} inputMode="tel" format={fmtPhone} onChange={setPhone}
              validate={validators.phone} placeholder="(218) 555-0123" onValid={v => setV("phone", v)} />
            {!LIVE_ONB && <UploadRow k="license" label="Driver's license" hint="Front and back · photo or scan" />}
            {LIVE_ONB && <DocUpload kind="license" label="Driver's license" hint="A clear photo of the front" onDone={() => setUploads(u => ({ ...u, license: "verified" }))} />}
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
                  <span style={{ fontSize: 23 }}><Icon e={t.icon} s={23} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ font: `700 14px ${FB}`, color: on ? C.push : C.ice }}>{t.label}</div>
                    <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>{t.note}</div>
                  </div>
                  <span style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center",
                    background: on ? C.push : "transparent", border: `2px solid ${on ? C.push : C.line}`,
                    color: C.onPush, fontWeight: 900, fontSize: 12 }}>{on ? <Icon e="check" s={12} /> : ""}</span>
                </button>
              );
            })}
            <Field label="Vehicle" icon="pickup" value={truck} onChange={setTruck}
              placeholder="F-350 · 9ft V-Plow" />
            {!LIVE_ONB && <UploadRow k="plate" label="Registration / plate" hint="Proof the rig is yours" />}
            {LIVE_ONB && <DocUpload kind="registration" label="Vehicle registration" hint="Photo of the registration card" onDone={() => setUploads(u => ({ ...u, plate: "verified" }))} />}
            {INSURANCE_NOTE}
          </div>
          <div style={{ position: "sticky", bottom: 16 }}>
            <Btn full kind="good" onClick={() => setStep(3)} disabled={!(tools.length && uploads.plate)}>
              {tools.length ? "Continue" : "Pick at least one"}</Btn>
          </div>
        </Fade>
      )}

      {step === 3 && (
        <Fade k="d3">
          <Eyebrow color={C.push}>Step 3 · Your agreement</Eyebrow>
          <h2 style={h2}>You work for yourself</h2>
          <p style={sub}>DRIFT is an app that connects you with customers — not your employer, and not your insurer. Confirm each point to continue.</p>
          <div style={{ height: 16 }} />
          <DriverConsent agreeLabel="Agree and continue"
            onAgree={(rec) => { acceptLegal(dispatch, rec, state.userId); setStep(4); }} />
        </Fade>
      )}

      {step === 4 && (
        <Fade k="d4">
          <Eyebrow color={C.push}>Step 4 · Get paid</Eyebrow>
          <h2 style={h2}>Where should we send it?</h2>
          <p style={sub}>{LIVE_ONB ? "Payouts go to your bank through Stripe. Set it up any time in the Earnings tab — Stripe collects your bank and W-9 details, DRIFT never sees them."
            : "Payouts run through Stripe Connect. Cash out the same day."}</p>
          {!LIVE_ONB && <>
          <div style={{ margin: "16px 0", borderRadius: 16, padding: 18, position: "relative", overflow: "hidden",
            background: C.slate, border: `1px solid ${C.push}44` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ font: `700 11px ${FB}`, letterSpacing: ".01em", color: C.push }}>Payout account</span>
              <span style={{ fontSize: 19 }}><Icon e="bank" s={19} /></span>
            </div>
            <div style={{ font: `700 20px ${FB}`, letterSpacing: ".08em", color: C.ice }}>•••• •••• 6789</div>
            <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 6 }}>{name || "Your name"} · Checking</div>
          </div>
          <UploadRow k="w9" label="W-9 tax form" hint="Required for 1099 contractors" />
          </>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0", font: `500 13px ${FB}`, color: C.mistDim }}>
            <span><Icon e="lock" s={14} /></span> Bank details handled by Stripe · we never see them
          </div>
          <div style={{ position: "sticky", bottom: 16 }}>
            <Btn full kind="good" onClick={finish} disabled={saving}>{saving ? "Saving…" : LIVE_ONB ? "Finish setup" : "Finish — start earning"}</Btn>
          </div>
        </Fade>
      )}
    </div>
  );
}

// ============================================================
// Driver tools: demand numbers, browse-before-setup, storm mode, home zone,
// levels, regulars, problem reports, mileage + tax summary.
// ============================================================

// How busy DRIFT is (public counts). Demo mode shows example numbers.
const DEMO_MARKET = { openNow: 3, openScheduled: 6, openPay: 410 }; // open work only, never customer/driver counts
function useMarket() {
  const { state } = useStore();
  const LIVE = isLive(state) || supabaseEnabled;
  const [m, setM] = useState(LIVE ? null : DEMO_MARKET);
  useEffect(() => {
    if (!LIVE) return;
    let on = true;
    const load = () => marketStats().then((x) => on && x && setM(x));
    load(); const iv = setInterval(load, 60000);
    return () => { on = false; clearInterval(iv); };
  }, [LIVE]);
  return m;
}

const kindLabel = (k) => (JOB_TYPES[k] || JOB_TYPES.driveway).label;

// "Right now in Duluth" strip — three numbers that sell the gig.
function DemandStrip({ m, style }) {
  if (!m) return <Skeleton h={74} r={16} />;
  const open = (m.openNow || 0) + (m.openScheduled || 0);
  const cells = [[open, open === 1 ? "open job now" : "open jobs now"], [`$${(m.openPay || 0).toLocaleString()}`, "waiting to be earned"], ["80%", "+ $10 call-out per job"]];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, ...style }}>
      {cells.map(([v, l], i) => (
        <div key={l} style={{ padding: "13px 10px", borderLeft: i ? `1px solid ${C.lineSoft}` : "none", textAlign: "center" }}>
          <div style={{ font: `800 28px/1 ${FD}`, color: i === 1 ? C.push : C.ice }}>{v ?? "—"}</div>
          <div style={{ font: `400 12.5px/1.25 ${FB}`, color: C.mist, marginTop: 5 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

// Browse open jobs before any paperwork: approximate spots + what each one pays.
function JobsPreview({ onSetup, onBack }) {
  const { state } = useStore();
  const LIVE = isLive(state);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [pick, setPick] = useState(null);
  useEffect(() => {
    if (!LIVE) {
      const c = DULUTH_CENTER;
      setD({ market: DEMO_MARKET, jobs: [
        { id: "p1", kind: "driveway", lat: c.lat + .012, lng: c.lng - .02, pay: 42, sqft: 620, depth: '4–8"' },
        { id: "p2", kind: "driveway", lat: c.lat + .03, lng: c.lng + .015, pay: 61, sqft: 1400 },
        { id: "p3", kind: "sidewalk", lat: c.lat - .004, lng: c.lng + .03, pay: 27 },
        { id: "p4", kind: "driveway", lat: c.lat + .05, lng: c.lng - .06, pay: 48, sqft: 900, scheduledFor: Date.now() + 14 * 3600e3 },
      ] });
      return;
    }
    previewJobs().then(setD).catch((e) => setErr(e.message));
  }, [LIVE]);
  const jobs = d?.jobs || [];
  const total = jobs.reduce((t, j) => t + (j.pay || 0), 0);
  const markers = jobs.filter((j) => j.lat != null).map((j) => ({ lat: j.lat, lng: j.lng, label: `$${j.pay}` }));
  return (
    <Fade k="jp">
      <button onClick={onBack} style={{ ...miniBtn, marginBottom: 14 }}>‹ Back</button>
      <Eyebrow color={C.push}>Open jobs right now</Eyebrow>
      <h2 style={{ ...H(28), margin: "6px 0 4px" }}>{d ? (jobs.length ? `$${total} waiting on ${jobs.length} job${jobs.length > 1 ? "s" : ""}` : "No open jobs this minute") : "Loading jobs…"}</h2>
      <p style={{ ...sub, fontSize: 14, marginBottom: 14 }}>
        {jobs.length ? "This is your take-home pay for each job. Spots are approximate until you're set up." : "Jobs pour in when it snows. Finish setup now so you're ready and get alerts for the next storm."}</p>
      {err && <p style={{ ...sub, color: C.danger }}>{err}</p>}
      {MAP_ENABLED && markers.length > 0 && <div style={{ borderRadius: 18, overflow: "hidden", marginBottom: 12 }}>
        <LiveMap center={DULUTH_CENTER} height={210} markers={markers} fit /></div>}
      <div style={{ display: "grid", gap: 8 }}>
        {!d && [0, 1, 2].map((i) => <Skeleton key={i} h={62} r={14} />)}
        {jobs.map((j) => (
          <button key={j.id} onClick={() => setPick(j)} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", textAlign: "left",
            background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
            <div style={{ font: `800 26px/1 ${FD}`, color: C.push, minWidth: 58 }}>${j.pay}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `600 14.5px ${FB}`, color: C.ice }}>{kindLabel(j.kind)}{j.sqft ? ` · ${j.sqft.toLocaleString()} sq ft` : ""}</div>
              <div style={{ font: `400 12.5px ${FB}`, color: C.mist, marginTop: 3 }}>
                {[j.scheduledFor ? `Scheduled ${fmtWindowLocal(new Date(j.scheduledFor).getTime())}` : "Needs a plow now", j.depth ? `${j.depth} snow` : null].filter(Boolean).join(" · ")}</div>
            </div>
            <Icon e="lock" s={15} color={C.mistDim} />
          </button>
        ))}
      </div>
      <div style={{ position: "sticky", bottom: 16, marginTop: 18 }}>
        <Btn full kind="good" onClick={onSetup}>Finish setup to take jobs · about 3 min</Btn>
      </div>
      {pick && (
        <Sheet onClose={() => setPick(null)}>
          <div style={{ font: `800 48px/1 ${FD}`, color: C.push }}>${pick.pay}</div>
          <div style={{ font: `600 15px ${FB}`, color: C.ice, marginTop: 6 }}>{kindLabel(pick.kind)}{pick.sqft ? ` · ${pick.sqft.toLocaleString()} sq ft` : ""}</div>
          <p style={{ ...sub, fontSize: 14, margin: "10px 0 16px" }}>To take a job you need three quick things: a photo of your license, your truck, and the contractor agreement. Then jobs like this one ring your phone.</p>
          <Btn full kind="good" onClick={onSetup}>Finish setup</Btn>
          <div style={{ height: 8 }} />
          <Btn full kind="dark" onClick={() => setPick(null)}>Keep looking</Btn>
        </Sheet>
      )}
    </Fade>
  );
}

// Storm mode: the night before / day of a storm, show the work that's waiting.
function DriverStormCard({ onRoute }) {
  const { state } = useStore();
  const LIVE = isLive(state);
  const m = useMarket();
  const [f, setF] = useState(LIVE ? null : { next24: 5, next12: 2, range24: '4–6"' });
  const [hide, setHide] = useState(false);
  useEffect(() => { if (LIVE) fetchSnowForecast().then(setF); }, [LIVE]);
  if (hide || !f || !(f.next24 >= 1)) return null;
  const sched = m?.openScheduled || 0, now = m?.openNow || 0;
  return (
    <div style={{ marginBottom: 14, borderRadius: 18, padding: "16px 16px 14px", position: "relative", overflow: "hidden",
      background: `linear-gradient(160deg, ${C.plow}26, ${C.slate} 60%)`, border: `1px solid ${C.plow}66` }}>
      <button onClick={() => setHide(true)} aria-label="Dismiss" style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none",
        color: C.mistDim, cursor: "pointer", padding: 6 }}><Icon e="close" s={15} /></button>
      <div style={{ font: `500 12px ${FM}`, letterSpacing: ".08em", textTransform: "uppercase", color: C.plow }}>Storm mode</div>
      <div style={{ font: `800 30px/1.05 ${FD}`, textTransform: "uppercase", color: C.ice, marginTop: 6 }}>
        {f.range24 || `${f.next24}"`} {f.next12 >= 1 ? "in the next 12 hrs" : "in the next 24 hrs"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, margin: "12px 0 14px" }}>
        {[[sched, "scheduled plows open"], [now, "need a plow now"], [m ? `$${(m.openPay || 0).toLocaleString()}` : null, "waiting to be earned"]].map(([v, l]) => (
          <div key={l}><div style={{ font: `800 28px/1 ${FD}`, color: C.ice }}>{v ?? "—"}</div>
            <div style={{ font: `400 12.5px/1.3 ${FB}`, color: C.mist, marginTop: 4 }}>{l}</div></div>
        ))}
      </div>
      <button onClick={onRoute} style={{ width: "100%", minHeight: 52, borderRadius: 14, border: "none", cursor: "pointer",
        background: C.plow, color: "#fff", font: `700 16px ${FB}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Icon e="map" s={17} /> {sched ? "Build your route for tonight" : "Open your route"}</button>
      <div style={{ font: `400 12.5px/1.4 ${FB}`, color: C.mist, marginTop: 9, textAlign: "center" }}>
        Then go online when it starts to pile up. More customers book once it's falling.</div>
    </div>
  );
}

// Home zone: where you work from + how far you'll drive. Only jobs inside it ring your phone.
const ZONE_OPTIONS = [5, 10, 15, 25, null];
function HomeZoneSheet({ onClose }) {
  const { state, dispatch } = useStore();
  const d = state.driver;
  const [home, setHome] = useState(d.home || null);
  const [radius, setRadius] = useState(d.homeRadius ?? 15);
  const [busy, setBusy] = useState(false);
  const [locErr, setLocErr] = useState(null);
  const locate = () => {
    setLocErr(null);
    if (!navigator.geolocation) { setLocErr("This phone can't share its location."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setHome({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }); setBusy(false); },
      () => { setLocErr("Couldn't get your location. Allow location for DRIFT, or use Duluth's center."); setBusy(false); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  };
  const save = async () => {
    const h = home || DULUTH_CENTER;
    setBusy(true);
    const r = isLive(state) ? await updateMyProfile(state.userId, { home_lat: h.lat, home_lng: h.lng, home_radius_mi: radius }) : {};
    setBusy(false);
    if (r?.error) { dispatch({ type: "TOAST", msg: `Couldn't save — ${r.error.message}` }); return; }
    dispatch({ type: "DRIVER_PATCH", patch: { home: h, homeRadius: radius } });
    dispatch({ type: "TOAST", msg: radius ? `Saved — you'll get jobs within ${radius} miles` : "Saved — you'll get jobs anywhere we serve" });
    onClose();
  };
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), margin: "0 0 4px" }}>Your home zone</h3>
      <p style={{ ...sub, fontSize: 14, marginBottom: 14 }}>Where you start from and how far you'll go. You'll only get job alerts inside it, so no pings for jobs across town.</p>
      {MAP_ENABLED && <div style={{ borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
        <LiveMap center={home || DULUTH_CENTER} height={170} interactive={false}
          markers={[{ ...(home || DULUTH_CENTER), kind: "truck", size: 30 }]} /></div>}
      <button onClick={locate} disabled={busy} style={{ ...miniBtn, width: "100%", minHeight: 50, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 15 }}>
        <Icon e="target" s={17} /> {home ? "Update to where I am now" : "Use where I am now"}</button>
      <div style={{ font: `400 12.5px ${FB}`, color: locErr ? C.danger : C.mistDim, margin: "7px 2px 14px" }}>
        {locErr || (home ? `Set at ${home.lat.toFixed(3)}, ${home.lng.toFixed(3)}. Do this from home or where you park the truck.` : "Do this from home or where you park the truck. Skip it and we'll use Duluth's center.")}</div>
      <Eyebrow>How far will you drive?</Eyebrow>
      <div role="radiogroup" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, margin: "8px 0 18px" }}>
        {ZONE_OPTIONS.map((r) => {
          const on = radius === r;
          return <button key={String(r)} role="radio" aria-checked={on} onClick={() => setRadius(r)} style={{ minHeight: 50, borderRadius: 12, cursor: "pointer",
            font: `700 15px ${FB}`, color: on ? C.push : C.ice, background: on ? C.push + "16" : C.night2,
            border: `1.5px solid ${on ? C.push : "transparent"}` }}>{r ? `${r} mi` : "Any"}</button>;
        })}
      </div>
      <Btn full kind="good" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save home zone"}</Btn>
    </Sheet>
  );
}
const zoneText = (d) => d.homeRadius ? `Jobs within ${d.homeRadius} mi of ${d.home ? "home" : "Duluth"}` : d.home ? "Any distance" : "Not set — you get every job";
// Is a job inside this driver's zone? (no zone, or no pin = yes)
function inMyZone(driver, job) {
  if (!driver?.homeRadius || !driver.home) return true;
  const mi = milesBetween(driver.home, jobLL(job));
  return mi == null || mi <= driver.homeRadius;
}

// Level badge + what it takes to reach the next one.
const LEVEL_COLOR = { rookie: () => C.mist, pro: () => C.plow, elite: () => C.amber };
function LevelCard({ d }) {
  const input = { jobs_count: d.jobs, rating: d.rating, ratings_count: d.reviews, late_cancels: d.lateCancels };
  const lvl = driverLevel(input), next = nextLevel(input), col = LEVEL_COLOR[lvl]();
  return (
    <Card style={{ marginBottom: 14, borderColor: col + "66" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, display: "grid", placeItems: "center", background: col + "22", color: col, flexShrink: 0 }}>
          <Icon e={lvl === "elite" ? "star" : lvl === "pro" ? "shield" : "snowflake"} s={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `500 12px ${FM}`, letterSpacing: ".08em", textTransform: "uppercase", color: C.mist }}>Your level</div>
          <div style={{ font: `800 28px/1 ${FD}`, textTransform: "uppercase", color: col, marginTop: 3 }}>{LEVELS[lvl].label}</div>
        </div>
      </div>
      <div style={{ font: `400 13.5px/1.45 ${FB}`, color: C.ice, marginTop: 10 }}>{LEVELS[lvl].perk}</div>
      {next && <>
        <div style={{ display: "flex", justifyContent: "space-between", font: `600 13px ${FB}`, color: C.mist, margin: "14px 0 6px" }}>
          <span>Next: {LEVELS[next.to].label}</span><span>{Math.round(next.progress * 100)}%</span></div>
        <div style={{ height: 8, borderRadius: 8, background: C.night2, overflow: "hidden" }}>
          <div style={{ width: `${next.progress * 100}%`, height: "100%", background: LEVEL_COLOR[next.to](), transition: `width .6s ${EASE}` }} /></div>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {next.items.map((it) => (
            <div key={it.text} style={{ display: "flex", gap: 8, alignItems: "center", font: `400 13.5px ${FB}`, color: it.done ? C.mist : C.ice }}>
              {it.done ? <span style={{ color: C.push, display: "flex" }}><Icon e="check" s={15} strokeWidth={2.6} /></span>
                : <span style={{ width: 13, height: 13, margin: 1, borderRadius: 99, border: `2px solid ${C.mistDim}`, flexShrink: 0 }} />}{it.text}</div>
          ))}
        </div>
        <div style={{ font: `400 12.5px/1.4 ${FB}`, color: C.mistDim, marginTop: 10 }}>{LEVELS[next.to].perk}</div>
      </>}
    </Card>
  );
}

// Customers who made you a favorite — they get you first when they book.
function RegularsSheet({ onClose }) {
  const { state } = useStore();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!isLive(state)) { setRows([{ id: "a", name: "Jane", jobs: 4, last: Date.now() - 6 * 864e5, address: "1420 Woodland Ave" }, { id: "b", name: "Tom", jobs: 2, last: Date.now() - 20 * 864e5, address: "512 N 21st Ave E" }]); return; }
    listRegulars(state.userId).then(({ data }) => setRows(data || []));
  }, []);
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), margin: "0 0 4px" }}>Your regulars</h3>
      <p style={{ ...sub, fontSize: 14, marginBottom: 14 }}>Customers who saved you as a favorite. When they book and you're online, you get it alone for 2 minutes before anyone else.</p>
      {!rows ? <Skeleton h={60} r={14} /> : rows.length === 0 ? (
        <div style={{ padding: "16px 14px", font: `400 14px/1.45 ${FB}`, color: C.mist, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14 }}>
          No regulars yet. After a job, customers can tap the heart on their receipt. Good photos and a clean edge are what earn it.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 99, background: C.amber + "22", color: C.amber, display: "grid", placeItems: "center", font: `700 15px ${FB}` }}>{(r.name || "?")[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 15px ${FB}`, color: C.ice }}>{r.name}</div>
                <div style={{ font: `400 12.5px ${FB}`, color: C.mist, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.jobs} job{r.jobs === 1 ? "" : "s"} with you{r.last ? ` · last ${new Date(r.last).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}{r.address ? ` · ${r.address}` : ""}</div>
              </div>
              <Icon e="heart" s={16} color={C.danger} />
            </div>
          ))}
        </div>
      )}
      <div style={{ height: 14 }} /><Btn full kind="dark" onClick={onClose}>Done</Btn>
    </Sheet>
  );
}

// Share a link that brings another plow owner to the Drive page (tracked by ?ref=).
async function inviteDriver(state, dispatch) {
  const first = (state.driver.name || "driver").split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "driver";
  const url = `https://driftplowing.com/drive.html?ref=driver-${first}`;
  const text = "I plow driveways through DRIFT. You pick the jobs, keep 80% plus a $10 call-out on each one, and get paid through Stripe.";
  try {
    if (navigator.share) { await navigator.share({ title: "Plow with DRIFT", text, url }); return; }
    await navigator.clipboard.writeText(`${text} ${url}`);
    dispatch({ type: "TOAST", msg: "Invite link copied — send it to a plow buddy" });
  } catch { /* share sheet closed */ }
}

// Report a problem during a job. Drivers can also give the job back (before plowing starts).
const PROBLEMS = [
  { id: "blocked", icon: "car", label: "Something's in the way", hint: "Car parked in the driveway, trash cans, a pile you can't move" },
  { id: "no_access", icon: "lock", label: "Can't get to the property", hint: "Gate locked, road closed, wrong address" },
  { id: "unsafe", icon: "warning", label: "Unsafe to plow", hint: "Ice, people or pets in the way, a hazard that wasn't marked" },
  { id: "damage", icon: "shield", label: "Something got damaged", hint: "Curb, lawn, mailbox, your truck. Report it right away" },
  { id: "other", icon: "chat", label: "Something else", hint: "Anything DRIFT should know" },
];
function ProblemSheet({ job, canRelease, onClose, onReleased }) {
  const { state, dispatch } = useStore();
  const [kind, setKind] = useState(null);
  const [note, setNote] = useState("");
  const [release, setRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const showRelease = canRelease && ["blocked", "no_access", "unsafe"].includes(kind);
  const send = async () => {
    setBusy(true);
    if (!isLive(state)) { dispatch({ type: "TOAST", msg: "Reported (demo)" }); onClose(); return; }
    try {
      const r = await reportIssue(job.jobId, kind, note, showRelease && release);
      dispatch({ type: "TOAST", msg: r.released ? "Job given back — DRIFT is finding another driver" : "Reported — the customer and DRIFT can see it" });
      if (r.released) onReleased?.(); else onClose();
    } catch (e) { dispatch({ type: "TOAST", msg: e.message }); setBusy(false); }
  };
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), margin: "0 0 4px" }}>What's wrong?</h3>
      <p style={{ ...sub, fontSize: 14, marginBottom: 12 }}>It goes to the customer's chat and to DRIFT. If someone's hurt, call 911 first.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {PROBLEMS.map((p) => {
          const on = kind === p.id;
          return (
            <button key={p.id} onClick={() => setKind(p.id)} aria-pressed={on} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", minHeight: 62,
              textAlign: "left", borderRadius: 14, cursor: "pointer", background: on ? C.amber + "14" : C.slate,
              border: `1.5px solid ${on ? C.amber : C.line}`, WebkitTapHighlightColor: "transparent" }}>
              <span style={{ color: on ? C.amber : C.mist, display: "flex" }}><Icon e={p.icon} s={20} /></span>
              <div style={{ flex: 1 }}><div style={{ font: `600 15px ${FB}`, color: C.ice }}>{p.label}</div>
                <div style={{ font: `400 12.5px/1.35 ${FB}`, color: C.mist, marginTop: 2 }}>{p.hint}</div></div>
            </button>
          );
        })}
      </div>
      {kind && <>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="Add a quick note (optional)"
          style={{ width: "100%", boxSizing: "border-box", marginTop: 12, padding: 12, borderRadius: 12, background: C.night2, border: `1px solid ${C.line}`,
            color: C.ice, font: `400 15px/1.4 ${FB}`, resize: "vertical" }} />
        {showRelease && (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, padding: 12, borderRadius: 12, background: C.slate, border: `1px solid ${C.line}`, cursor: "pointer" }}>
            <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: C.amber }} />
            <span style={{ font: `400 14px/1.4 ${FB}`, color: C.ice }}><b>I can't do this job — give it back.</b> It goes back to other drivers right away. No late cancel on your record.</span>
          </label>
        )}
        <div style={{ height: 12 }} />
        <Btn full kind={release && showRelease ? "danger" : "primary"} onClick={send} disabled={busy}>{busy ? "Sending…" : release && showRelease ? "Report and give job back" : "Send report"}</Btn>
      </>}
    </Sheet>
  );
}

// Year-to-date earnings, miles and the mileage deduction estimate, plus a CSV for taxes.
function TaxCard() {
  const { state, dispatch } = useStore();
  const LIVE = isLive(state);
  const year = new Date().getFullYear();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!LIVE) { setRows([{ completed_at: new Date().toISOString(), job_type: "driveway", address: "1420 Woodland Ave", driver_pay: 42, tip: 5, driver_miles: 3.1 },
      { completed_at: new Date().toISOString(), job_type: "driveway", address: "512 N 21st Ave E", driver_pay: 58, tip: 0, driver_miles: 4.4 }]); return; }
    driverYear(state.userId, year).then(({ data }) => setRows(data || []));
  }, [LIVE, state.userId]);
  if (!rows) return null;
  const earned = rows.reduce((t, r) => t + Number(r.driver_pay || 0) + Number(r.tip || 0), 0);
  const miles = rows.reduce((t, r) => t + Number(r.driver_miles || 0), 0);
  const deduction = rows.reduce((t, r) => t + Number(r.driver_miles || 0) * mileageRate(r.completed_at), 0);
  const money = (v) => `$${Math.round(v).toLocaleString()}`;
  const download = () => {
    const head = ["Date", "Job", "Address", "Pay", "Tip", "Total", "Miles", "Mileage deduction (est.)"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) => {
      const mi = Number(r.driver_miles || 0), pay = Number(r.driver_pay || 0), tip = Number(r.tip || 0);
      return [new Date(r.completed_at).toLocaleDateString("en-US"), kindLabel(r.job_type), r.address || "", pay.toFixed(2), tip.toFixed(2), (pay + tip).toFixed(2),
        mi.toFixed(1), (mi * mileageRate(r.completed_at)).toFixed(2)].map(esc).join(",");
    });
    const csv = [head.map(esc).join(","), ...lines, "", `${esc("Totals")},,,,,${esc(earned.toFixed(2))},${esc(miles.toFixed(1))},${esc(deduction.toFixed(2))}`].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `DRIFT-${year}-earnings-and-miles.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    dispatch({ type: "TOAST", msg: "Downloaded — give it to whoever does your taxes" });
  };
  return (
    <Card style={{ marginBottom: S.lg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Eyebrow color={C.mist}>{year} for taxes</Eyebrow>
        <span style={{ font: `500 12.5px ${FB}`, color: C.mistDim }}>{rows.length} job{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, margin: "12px 0 10px" }}>
        {[[money(earned), "Earned"], [`${miles.toFixed(miles < 100 ? 1 : 0)}`, "Miles on jobs"], [money(deduction), "Mileage deduction"]].map(([v, l], i) => (
          <div key={l}><div style={{ font: `800 24px/1 ${FD}`, color: i === 2 ? C.push : C.ice }}>{v}</div>
            <div style={{ font: `400 12.5px ${FB}`, color: C.mist, marginTop: 4 }}>{l}</div></div>
        ))}
      </div>
      <div style={{ font: `400 12.5px/1.45 ${FB}`, color: C.mistDim }}>
        Miles are logged from your phone's GPS while you're on a DRIFT job. The deduction uses the IRS standard mileage rate (76¢ a mile since July 2026) and is an estimate. Stripe sends your 1099. Ask a tax pro what you can claim.</div>
      <button onClick={download} disabled={!rows.length} style={{ ...miniBtn, width: "100%", minHeight: 46, marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: rows.length ? 1 : .5 }}>
        <Icon e="download" s={16} /> Download {year} spreadsheet (CSV)</button>
    </Card>
  );
}

// Miles driven on the current job, from GPS fixes (kept across page reloads).
const milesKey = (jobId) => `drift.miles.${jobId}`;
function addJobMiles(jobId, prev, next) {
  if (!jobId || !prev || !next) return;
  const mi = milesBetween(prev, next);
  if (mi == null || mi < 0.015 || mi > 3) return; // ignore GPS jitter and jumps
  try { const cur = Number(localStorage.getItem(milesKey(jobId)) || 0); localStorage.setItem(milesKey(jobId), String(cur + mi)); } catch { /* private mode */ }
}
function jobMiles(jobId) { try { return Number(localStorage.getItem(milesKey(jobId)) || 0); } catch { return 0; } }

function DriverApp() {
  const { state } = useStore();
  const [tab, setTab] = useState("drive");
  const [sub, setSub] = useState(null);
  const driverTabs = [
    { id: "drive", label: "Drive", icon: "plowtruck" },
    { id: "earn", label: "Earnings", icon: "cash" },
    { id: "account", label: "Account", icon: "id" },
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

// ---- Job alerts + "Add to Home Screen" --------------------------------------
// Facebook / Instagram open links in their own browser, which can't add to the Home Screen.
const inAppBrowser = () => typeof navigator !== "undefined" && /FBAN|FBAV|FB_IAB|Instagram|Messenger/i.test(navigator.userAgent);

function InstallSheet({ onClose }) {
  const ios = isIOS(), inApp = inAppBrowser();
  const [copied, setCopied] = useState(false);
  const step = (n, text) => (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0" }}>
      <div style={{ width: 26, height: 26, borderRadius: 8, background: C.slate, border: `1px solid ${C.line}`, flexShrink: 0,
        display: "grid", placeItems: "center", font: `700 13px ${FB}`, color: C.ice }}>{n}</div>
      <div style={{ font: `400 15px/1.45 ${FB}`, color: C.ice, paddingTop: 2 }}>{text}</div>
    </div>
  );
  const copyLink = async () => {
    try { await navigator.clipboard.writeText("https://driftplowing.com"); setCopied(true); } catch { /* ignore */ }
  };
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), margin: "0 0 4px" }}>Add DRIFT to your Home Screen</h3>
      <p style={{ ...sub, marginBottom: 8 }}>It opens full screen like a normal app, one tap away{ios ? ", and on iPhone it's needed for notifications" : ""}. Takes 20 seconds.</p>
      {inApp ? <>
        {step(1, <>You're in the Facebook browser, which can't do this. Tap <b>{ios ? "⋯" : "⋮"}</b> at the top and choose <b>{ios ? "Open in Safari" : "Open in Chrome"}</b>.</>)}
        {step(2, <>Then come back to this button and follow the steps.</>)}
        <button onClick={copyLink} style={{ ...miniBtn, width: "100%", minHeight: 44, marginTop: 4 }}>
          <Icon e="link" s={15} /> {copied ? "Link copied — paste it in " + (ios ? "Safari" : "Chrome") : "Or copy the link"}</button>
      </> : ios ? <>
        {step(1, <>Tap the <b>Share</b> button <span style={{ display: "inline-flex", verticalAlign: "-3px", color: C.plow }}><Icon e="share" s={17} /></span> {/CriOS/.test(navigator.userAgent) ? "at the top right" : "at the bottom of Safari"}.</>)}
        {step(2, <>Scroll down and tap <b>Add to Home Screen</b>.</>)}
        {step(3, <>Tap <b>Add</b>, then open DRIFT from the new snowflake icon.</>)}
        {step(4, <>In the app, tap <b>Turn on notifications</b> and allow them.</>)}
      </> : <>
        {step(1, <>Tap the <b>⋮</b> menu at the top right of Chrome.</>)}
        {step(2, <>Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.</>)}
        {step(3, <>Open DRIFT from the new icon and tap <b>Turn on notifications</b>.</>)}
      </>}
      <div style={{ marginTop: 12 }}><Btn full kind="dark" onClick={onClose}>Got it</Btn></div>
    </Sheet>
  );
}

// "Get the app" card: 1) add to Home Screen  2) turn on notifications.
// Shows until both are done (or they tap Later — then it comes back in a few days).
function AppSetupCard({ role = "rider", onShown }) {
  const { state, dispatch } = useStore();
  const [, bump] = useState(0);
  const [pushOn, setPushOn] = useState(null); // null = still checking
  const [howTo, setHowTo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState(() => {
    try { return Number(localStorage.getItem("drift.setupLater") || 0) > Date.now(); } catch { return false; }
  });
  useEffect(() => onInstallChange(() => bump((x) => x + 1)), []);
  useEffect(() => { pushEnabled().then(setPushOn).catch(() => setPushOn(false)); }, []);
  const installed = isStandalone();
  const needsInstallFirst = isIOS() && !installed;           // iPhone: notifications only work from the Home Screen app
  const canPush = pushSupported() && !needsInstallFirst;
  const hide = later || pushOn === null || (installed && pushOn) || (installed && !pushSupported());
  useEffect(() => { onShown?.(!hide); }, [hide]);
  if (hide) return null;

  const install = async () => { if (canPromptInstall()) await promptInstall(); else setHowTo(true); };
  const turnOn = async () => {
    if (!canPush) { setHowTo(true); return; }
    setBusy(true);
    try { await enablePush(state.userId); setPushOn(true);
      dispatch({ type: "TOAST", msg: role === "driver" ? "Job alerts are on for this phone" : "Notifications on — we'll tell you when your plow is coming" }); }
    catch (e) { dispatch({ type: "TOAST", msg: e.message }); }
    setBusy(false);
  };
  const snooze = () => { setLater(true); try { localStorage.setItem("drift.setupLater", String(Date.now() + 3 * 864e5)); } catch { /* ignore */ } };

  const item = (n, done, title, body, action) => (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0", borderTop: n > 1 ? `1px solid ${C.lineSoft}` : "none" }}>
      <div style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center",
        background: done ? C.push + "22" : C.night2, color: done ? C.push : C.ice, font: `700 13px ${FB}` }}>
        {done ? <Icon e="check" s={15} strokeWidth={2.4} /> : n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14px ${FB}`, color: done ? C.mist : C.ice, textDecoration: done ? "line-through" : "none" }}>{title}</div>
        {!done && <div style={{ font: `400 12.5px/1.35 ${FB}`, color: C.mist, marginTop: 2 }}>{body}</div>}
      </div>
      {!done && action}
    </div>
  );
  const small = { ...miniBtn, minHeight: 38, padding: "0 13px", fontSize: 13, flexShrink: 0 };
  return (
    <div style={{ marginBottom: 12, background: C.slate, border: `1px solid ${C.amber}55`, borderRadius: 16, padding: "13px 14px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, font: `600 15px ${FB}`, color: C.ice }}>
          <span style={{ color: C.amber, display: "flex" }}><Icon e="mobile" s={17} /></span> Get the DRIFT app</div>
        <button onClick={snooze} style={{ background: "none", border: "none", color: C.mistDim, cursor: "pointer", font: `500 12.5px ${FB}`, padding: 4 }}>Later</button>
      </div>
      {item(1, installed, "Add to your Home Screen", "Opens like a real app, one tap away.",
        <button onClick={install} style={{ ...small, background: C.amber, color: C.onAmber, border: "none" }}>{canPromptInstall() ? "Install" : "Show me"}</button>)}
      {item(2, !!pushOn, "Turn on notifications",
        needsInstallFirst ? "On iPhone, do step 1 first, then open DRIFT from your Home Screen."
          : role === "driver" ? "Get new jobs even when DRIFT is closed." : "Know when your plow is on the way, plus snow alerts.",
        <button onClick={turnOn} disabled={busy} style={small}>{busy ? "…" : needsInstallFirst ? "How" : "Turn on"}</button>)}
      {howTo && <InstallSheet onClose={() => setHowTo(false)} />}
    </div>
  );
}

function DriverAlertsCard() {
  const { state, dispatch } = useStore();
  const [, bump] = useState(0);
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => onInstallChange(() => bump((x) => x + 1)), []);
  useEffect(() => { pushEnabled().then(setPushOn); }, []);
  const installed = isStandalone();
  const install = async () => { if (canPromptInstall()) await promptInstall(); else setHowTo(true); };
  const turnOnPush = async () => {
    setBusy(true);
    try { await enablePush(state.userId); setPushOn(true); dispatch({ type: "TOAST", msg: "Job alerts are on for this phone" }); }
    catch (e) { dispatch({ type: "TOAST", msg: e.message }); }
    setBusy(false);
  };
  const testRing = () => {
    unlockRinger();
    if (testing) { stopRing(); setTesting(false); return; }
    startRing(); setTesting(true);
    setTimeout(() => { stopRing(); setTesting(false); }, 4000);
  };
  const row = { display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: `1px solid ${C.lineSoft}` };
  const small = { ...miniBtn, minHeight: 36, padding: "0 12px", fontSize: 13, flexShrink: 0 };
  const canPush = pushSupported() && !(isIOS() && !installed);
  return (
    <div style={{ marginTop: 14, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px 4px" }}>
      <div style={{ font: `600 15px ${FB}`, color: C.ice }}>Job alerts</div>
      <div style={{ ...row, borderTop: "none", paddingTop: 8 }}>
        <span style={{ color: C.amber, display: "flex" }}><Icon e="bell" s={18} /></span>
        <div style={{ flex: 1, font: `400 13.5px/1.4 ${FB}`, color: C.mist }}>Rings and vibrates for new jobs while DRIFT is open. Your screen stays on while you're online.</div>
        <button onClick={testRing} style={small}>{testing ? "Stop" : "Test ring"}</button>
      </div>
      {!installed && (
        <div style={row}>
          <span style={{ color: C.plow, display: "flex" }}><Icon e="download" s={18} /></span>
          <div style={{ flex: 1, font: `400 13.5px/1.4 ${FB}`, color: C.mist }}>Add DRIFT to your Home Screen so it opens like an app.</div>
          <button onClick={install} style={small}>{canPromptInstall() ? "Install" : "How"}</button>
        </div>
      )}
      <div style={row}>
        <span style={{ color: pushOn ? C.push : C.mist, display: "flex" }}><Icon e={pushOn ? "checkfill" : "mobile"} s={18} /></span>
        <div style={{ flex: 1, font: `400 13.5px/1.4 ${FB}`, color: C.mist }}>
          {pushOn ? "Alerts when DRIFT is closed are on for this phone."
            : canPush ? "Get a notification for new jobs even when DRIFT is closed."
            : isIOS() && !installed ? "On iPhone, add DRIFT to your Home Screen first to get alerts when it's closed."
            : "This browser can't show alerts when DRIFT is closed."}</div>
        {!pushOn && canPush && isLive(state) && <button onClick={turnOnPush} disabled={busy} style={small}>{busy ? "…" : "Turn on"}</button>}
      </div>
      {howTo && <InstallSheet onClose={() => setHowTo(false)} />}
    </div>
  );
}

// ---- Driver: nearby jobs, queue (up to 3) and scheduled routes ----------------
const jobLL = (j) => j?.property?.center?.lat != null ? j.property.center
  : j?.lat != null ? { lat: j.lat, lng: j.lng } : j?.property?.lat != null ? { lat: j.property.lat, lng: j.property.lng } : null;
const miText = (mi) => `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;

function JobRow({ job, here, onClick, right, sub, num }) {
  const { state } = useStore();
  const pay = driverNetPay(job.quote, state.driver);
  const dr = driveEstimate(here, jobLL(job));
  const jt = JOB_TYPES[job.jobType || "driveway"];
  const sqft = job.property?.sqft || job.quote?.sqft;
  const bits = [sub, dr ? miText(dr.mi) : null, jt.basis === "area" && sqft ? `${sqft.toLocaleString()} sq ft` : jt.label,
    job.quote?.depthMult > 1 ? `${job.quote.depthLabel} snow` : null].filter(Boolean);
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px",
      background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, cursor: onClick ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}>
      {num != null && <div aria-label={`Stop ${num}`} style={{ width: 30, height: 30, borderRadius: 99, flex: "none", display: "grid", placeItems: "center",
        background: C.amber, color: C.onAmber, font: `800 16px/1 ${FD}` }}>{num}</div>}
      <div style={{ font: `800 26px/1 ${FD}`, color: C.ice, minWidth: 58 }}>${pay}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: `600 14.5px ${FB}`, color: C.ice, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {job.property?.addr || job.address || "Nearby"}</div>
        <div style={{ font: `400 12.5px ${FB}`, color: C.mist, marginTop: 3 }}>{bits.join(" · ")}</div>
      </div>
      {right !== undefined ? right : <Icon e="chevronright" s={16} color={C.mistDim} />}
    </div>
  );
}

function JobsMap({ jobs, here, height = 200, numbered }) {
  const { state } = useStore();
  const markers = [
    ...(here ? [{ lng: here.lng, lat: here.lat, size: 28, kind: "truck" }] : []),
    ...jobs.map((j) => ({ ll: jobLL(j), j })).filter((x) => x.ll).map(({ ll, j }, i) => ({ lng: ll.lng, lat: ll.lat, label: numbered ? `${i + 1} · $${driverNetPay(j.quote, state.driver)}` : `$${driverNetPay(j.quote, state.driver)}` })),
  ];
  if (!MAP_ENABLED) return null;
  return <LiveMap center={here || DULUTH_CENTER} height={height} markers={markers} fit />;
}

// Open jobs near the driver: price-tag pins on a map + a list sorted by distance.
function NearbyJobs({ pool, here, onOpen, emptyText }) {
  const sorted = [...pool].sort((a, b) => (driveEstimate(here, jobLL(a))?.mi ?? 99) - (driveEstimate(here, jobLL(b))?.mi ?? 99));
  return (
    <div>
      {sorted.length > 0 && <div style={{ borderRadius: 18, overflow: "hidden", marginBottom: 10 }}><JobsMap jobs={sorted} here={here} /></div>}
      {sorted.length === 0
        ? <div style={{ padding: "18px 14px", textAlign: "center", font: `400 14px ${FB}`, color: C.mist, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14 }}>{emptyText || "No open jobs right now."}</div>
        : <div style={{ display: "grid", gap: 8 }}>{sorted.map((j) => <JobRow key={j.jobId} job={j} here={here} onClick={() => onOpen(j)} />)}</div>}
    </div>
  );
}

// Sheet to add more live jobs while working (up to 3 at a time).
function NearbySheet({ here, onClose, onAdded, queued }) {
  const { state, dispatch } = useStore();
  const [pool, setPool] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let on = true;
    const load = () => listOpenJobs().then(({ data }) => on && setPool((data || []).filter((r) => r.customer_id !== state.userId).map((r) => rowToOrder(r))));
    load(); const unsub = subscribeOpenJobs(load);
    return () => { on = false; unsub(); };
  }, []);
  const take = async (j) => {
    setBusy(true);
    const { data, error } = await claimJob(j.jobId);
    setBusy(false); setOpen(null);
    if (error || !data) { dispatch({ type: "TOAST", msg: error ? error.message : "Another driver already took this one" }); return; }
    dispatch({ type: "TOAST", msg: "Added to your queue" });
    onAdded();
  };
  return (
    <Sheet onClose={onClose}>
      <Eyebrow>Nearby jobs</Eyebrow>
      <h3 style={{ ...H(24), margin: "6px 0 4px" }}>Line up your next job</h3>
      <p style={{ ...sub, marginBottom: 12 }}>You can hold up to 3 jobs at once ({queued} now). Finish them in order — customers see you're on the way after your current one.</p>
      <NearbyJobs pool={pool} here={here} onOpen={setOpen} emptyText="No open jobs nearby right now." />
      {open && <IncomingJob order={open} here={here} browse busy={busy} acceptLabel="Add to queue" onAccept={() => take(open)} onPass={() => setOpen(null)} />}
    </Sheet>
  );
}

// Scheduled plows: build a route ahead of a storm, check in, start each job.
function RouteBoard({ here }) {
  const { state, dispatch } = useStore();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmDrop, setConfirmDrop] = useState(null);
  const [now, setNow] = useState(Date.now());
  const load = () => listScheduledJobs().then(({ data }) => setRows((data || []).filter((r) => r.customer_id !== state.userId).map((r) => rowToOrder(r))));
  useEffect(() => { load(); const unsub = subscribeOpenJobs(load); const iv = setInterval(() => setNow(Date.now()), 30000); return () => { unsub(); clearInterval(iv); }; }, []);
  if (!rows) return <div style={{ display: "grid", gap: 8 }}><Skeleton h={64} r={14} /><Skeleton h={64} r={14} /></div>;
  const mine = rows.filter((r) => r.driverId === state.userId).sort((a, b) => a.scheduledFor - b.scheduledFor);
  // Route summary: stops in time order, miles from here → stop 1 → stop 2 …
  let routeMi = 0, prevLL = here, routePay = 0;
  mine.forEach((j) => { const ll = jobLL(j); const d = driveEstimate(prevLL, ll); if (d) routeMi += d.mi; if (ll) prevLL = ll; routePay += driverNetPay(j.quote, state.driver) || 0; });
  const open_ = rows.filter((r) => r.driverId !== state.userId);
  const soon = mine.filter((r) => r.scheduledFor - now < 12 * 3600e3);
  const needCheckin = soon.filter((r) => !r.checkedInAt);
  const firstNeed = needCheckin[0];
  const deadline = firstNeed ? firstNeed.scheduledFor - 45 * 60e3 : null;
  const minsLeft = deadline ? Math.max(0, Math.round((deadline - now) / 60e3)) : null;
  const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try { const r = await fn(); if (okMsg) dispatch({ type: "TOAST", msg: typeof okMsg === "function" ? okMsg(r) : okMsg }); await load(); return r; }
    catch (e) { dispatch({ type: "TOAST", msg: e.message }); }
    finally { setBusy(null); }
  };
  const claim = (j) => run(j.jobId, () => schedClaim(j.jobId), "Added to your route").then(() => setOpen(null));
  const checkIn = () => run("checkin", () => schedCheckin(), (r) => `Checked in for ${r.checkedIn} job${r.checkedIn === 1 ? "" : "s"} — customers have been told`);
  const drop = (j) => run(j.jobId, () => schedBackout(j.jobId), (r) => r.late ? "Dropped — counted as a late cancel" : "Dropped from your route").then(() => setConfirmDrop(null));
  const start = async (j) => {
    const r = await run(j.jobId, () => schedStart(j.jobId));
    if (!r?.job) return;
    if (state.order && ["accepted", "enroute", "plowing"].includes(state.order.state)) { dispatch({ type: "TOAST", msg: "Started — it's next in your queue" }); return; }
    dispatch({ type: "SET_ORDER", order: { ...rowToOrder(r.job, state.driver), state: "accepted", driver: state.driver, timeline: [{ k: "accepted", t: "now", label: "Started scheduled job" }] } });
  };
  const byDay = {};
  open_.forEach((j) => { const k = new Date(j.scheduledFor).toDateString(); (byDay[k] ||= []).push(j); });
  const lateDrop = (j) => Date.now() > j.scheduledFor - 3 * 3600e3;

  return (
    <div>
      {firstNeed && (
        <div style={{ padding: "16px 16px 14px", borderRadius: 18, marginBottom: 14, background: C.amber + "1A", border: `2px solid ${C.amber}` }}>
          <div style={{ font: `800 24px/1 ${FD}`, textTransform: "uppercase", color: C.amber }}>Check in by {clock(deadline)}</div>
          <div style={{ font: `400 14px/1.45 ${FB}`, color: C.ice, marginTop: 8 }}>
            You have {needCheckin.length} scheduled job{needCheckin.length > 1 ? "s" : ""} starting {fmtWindowLocal(firstNeed.scheduledFor)}.
            {" "}<b>If you don't check in {minsLeft != null && minsLeft < 180 ? `in the next ${minsLeft} min` : "by then"}, your jobs go to other drivers and it counts as a late cancel.</b></div>
          <button onClick={checkIn} disabled={busy === "checkin"} style={{ width: "100%", marginTop: 12, minHeight: 56, borderRadius: 16, border: "none",
            cursor: "pointer", background: C.amber, color: C.onAmber, font: `700 18px ${FB}` }}>{busy === "checkin" ? "Checking in…" : "I'm on it — check in"}</button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Eyebrow>My route</Eyebrow>
        {mine.length > 0 && <div style={{ font: `500 13px ${FM}`, color: C.mist }}>{mine.length} stop{mine.length > 1 ? "s" : ""}{routeMi > 0 ? ` · ${miText(routeMi)}` : ""} · <b style={{ color: C.push }}>${Math.round(routePay)}</b></div>}
      </div>
      {mine.length > 1 && <div style={{ borderRadius: 18, overflow: "hidden", marginTop: 8 }}><JobsMap jobs={mine} here={here} height={170} numbered /></div>}
      <div style={{ display: "grid", gap: 8, margin: "8px 0 18px" }}>
        {mine.length === 0 && <div style={{ padding: "16px 14px", font: `400 14px/1.45 ${FB}`, color: C.mist, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14 }}>
          No scheduled jobs yet. Add some below the night or day before a storm. You'll check in 45 minutes before your first one.</div>}
        {mine.map((j, i) => {
          const canStart = now >= j.scheduledFor - 90 * 60e3;
          return (
            <div key={j.jobId}>
              <JobRow job={j} here={i === 0 ? here : jobLL(mine[i - 1]) || here} num={mine.length > 1 ? i + 1 : undefined} sub={fmtWindowLocal(j.scheduledFor)} right={j.checkedInAt
                ? <Chip color={C.push}>Checked in</Chip> : <Chip color={C.amber}>Check in by {clock(j.scheduledFor - 45 * 60e3)}</Chip>} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {canStart && <Btn sm kind="good" onClick={() => start(j)} disabled={busy === j.jobId} style={{ flex: 1 }}>Start this job</Btn>}
                <Btn sm kind="dark" onClick={() => openDirections({ lat: jobLL(j)?.lat, lng: jobLL(j)?.lng, addr: j.property?.addr })} style={{ flex: 1 }}>Directions</Btn>
                <Btn sm kind="danger" onClick={() => setConfirmDrop(j)} style={{ flex: canStart ? "0 0 auto" : 1 }}>Drop</Btn>
              </div>
            </div>
          );
        })}
      </div>

      <Eyebrow>Open scheduled jobs</Eyebrow>
      <div style={{ font: `400 13px ${FB}`, color: C.mist, margin: "6px 0 10px" }}>Claim them now to plan your route. Free to drop until 3 hours before.</div>
      {open_.length > 0 && <div style={{ borderRadius: 18, overflow: "hidden", marginBottom: 10 }}><JobsMap jobs={open_} here={here} /></div>}
      {open_.length === 0 ? <div style={{ padding: "16px 14px", font: `400 14px ${FB}`, color: C.mist, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, textAlign: "center" }}>
        No open scheduled jobs right now. We'll notify you when customers book ahead.</div>
        : Object.entries(byDay).map(([k, js]) => (
          <div key={k} style={{ marginBottom: 12 }}>
            <div style={{ font: `600 13px ${FB}`, color: C.ice, margin: "4px 2px 8px" }}>{fmtWindowLocal(js[0].scheduledFor).split(" ")[0]} · {js.length} job{js.length > 1 ? "s" : ""}</div>
            <div style={{ display: "grid", gap: 8 }}>{js.map((j) => <JobRow key={j.jobId} job={j} here={here} sub={fmtWindowLocal(j.scheduledFor).split(" ").slice(1).join(" ")} onClick={() => setOpen(j)} />)}</div>
          </div>
        ))}

      {open && <IncomingJob order={open} here={here} browse busy={busy === open.jobId} acceptLabel="Add to my route" onAccept={() => claim(open)} onPass={() => setOpen(null)} />}
      {confirmDrop && (
        <Sheet onClose={() => setConfirmDrop(null)}>
          <h3 style={{ ...H(24), margin: "0 0 6px" }}>Drop this job?</h3>
          <p style={{ ...sub, marginBottom: 14 }}>{lateDrop(confirmDrop)
            ? <><b style={{ color: C.danger }}>It's less than 3 hours before the window, so this counts as a late cancel</b> on your record. The customer is counting on you — only drop it if you really can't make it.</>
            : "It's more than 3 hours out, so dropping it is free. It goes back to every driver and the customer is told we're finding someone new."}</p>
          <Btn full kind="danger" onClick={() => drop(confirmDrop)} disabled={busy === confirmDrop.jobId}>{lateDrop(confirmDrop) ? "Drop anyway (late cancel)" : "Drop it"}</Btn>
          <div style={{ height: 8 }} />
          <Btn full kind="dark" onClick={() => setConfirmDrop(null)}>Keep it</Btn>
        </Sheet>
      )}
    </div>
  );
}

function DriverDrive() {
  const { state, dispatch } = useStore();
  const LIVE = isLive(state);
  const online = state.driverOnline;
  const o = state.order;
  // Contractor agreement must be signed (current version) before going online.
  const [gate, setGate] = useState(false);

  // Live jobs vs scheduled routes. Tapping a "check in" / scheduled-job alert opens the route.
  const link = useDeepLink();
  const [view, setView] = useState(() => (deepLink.route ? "route" : "live"));
  useEffect(() => { if (link.route) { setView("route"); consumeLink("route"); } }, [link.route]);

  // ---- LIVE: the real pool of open offers from customers nearby ----
  const [allPool, setPool] = useState([]);
  const [showAll, setShowAll] = useState(false); // jobs outside your home zone are hidden unless you ask
  const pool = showAll ? allPool : allPool.filter(j => inMyZone(state.driver, j));
  const outsideZone = allPool.length - pool.length;
  const [passed, setPassed] = useState(() => new Set());
  const [claiming, setClaiming] = useState(false);
  const [browseJob, setBrowseJob] = useState(null);
  // Jobs already open when you go online show in the list; only NEW ones ring.
  const seen = useRef(new Set()), primed = useRef(false);
  useEffect(() => {
    if (!LIVE || !online) { setPool([]); primed.current = false; return; }
    let on = true;
    const load = () => listOpenJobs().then(({ data }) => {
      if (!on) return;
      const rows = (data || []).filter(r => r.customer_id !== state.userId).map(r => rowToOrder(r));
      if (!primed.current) { rows.forEach(r => seen.current.add(r.jobId)); primed.current = true; }
      setPool(rows);
    });
    load();
    const unsub = subscribeOpenJobs(load);
    return () => { on = false; unsub(); };
  }, [LIVE, online, state.userId]);
  // Live: show where the driver actually is (asks for location once they go online or open the route).
  const [here, setHere] = useState(null);
  useEffect(() => {
    if (!LIVE || !(online || view === "route") || typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setHere({ lng: p.coords.longitude, lat: p.coords.latitude }),
      () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [LIVE, online, view]);
  const liveOffer = LIVE && online && !o && !browseJob && view === "live"
    ? pool.find(j => !passed.has(j.jobId) && !seen.current.has(j.jobId) && (!j.expiresAt || j.expiresAt > Date.now())) : null;
  // A tapped "new request" notification opens that job.
  useEffect(() => {
    if (!link.offer || !allPool.length) return;
    const j = allPool.find(x => x.jobId === link.offer);
    if (j) { setView("live"); setBrowseJob(j); }
    consumeLink("offer");
  }, [link.offer, allPool.length]);

  // driver "has a job" if there's an order that they've accepted, OR an incoming request while online
  const incoming = LIVE ? !!liveOffer : online && o && o.state === "requested";
  const working = o && ["accepted", "enroute", "plowing", "arrived_done"].includes(o.state);

  if (working) return <DriverActiveJob />;

  const goOnline = (v) => {
    dispatch({ type: "ONLINE", v });
    if (v) unlockRinger();   // this tap lets the phone ring later on its own
    keepAwake(v);            // keep the screen on while online
    if (LIVE) setDriverStatus(state.userId, { is_online: v });
    dispatch({ type: "TOAST", msg: v ? "You're online — requests will pop up here" : "You're offline" });
  };
  // First tap wins — the database decides, so two drivers can never get the same job.
  const acceptLive = async (job) => {
    if (claiming || !job) return;
    setClaiming(true);
    const { data, error } = await claimJob(job.jobId);
    seen.current.add(job.jobId); setBrowseJob(null);
    if (error || !data) {
      setClaiming(false);
      setPassed(p => new Set(p).add(job.jobId));
      dispatch({ type: "TOAST", msg: error ? `Couldn't accept — ${error.message}` : "Another driver already took this one" });
      return;
    }
    const { data: row } = await fetchJob(job.jobId);
    setClaiming(false);
    dispatch({ type: "SET_ORDER", order: { ...(row ? rowToOrder(row, state.driver) : job), state: "accepted", driver: state.driver,
      timeline: [{ k: "accepted", t: "now", label: "You accepted" }] } });
    dispatch({ type: "TOAST", msg: "Job accepted — tap Navigate for directions" });
  };
  const passLive = (job, auto) => {
    if (job) { setPassed(p => new Set(p).add(job.jobId)); seen.current.add(job.jobId); }
    dispatch({ type: "TOAST", msg: auto ? "Request passed to the next driver" : "Request passed" });
  };
  const toggle = () => {
    unlockRinger();
    if (!online && !hasCurrentAcceptance(state.legal?.driver)) { setGate(true); return; }
    goOnline(!online);
  };

  return (
    <Fade k="drive"><section style={{ paddingTop: 10, paddingBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, font: `500 14px ${FB}`, color: online ? C.push : C.mist }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: online ? C.push : C.mistDim,
          animation: online ? "pulse 1.6s infinite" : "none" }} />
        {online ? "Online" : "Offline"}
      </div>
      <h1 style={{ ...H(30), color: C.ice, margin: "6px 0 4px" }}>
        {online ? "Watching for requests" : "Ready to plow?"}</h1>
      <p style={{ font: `400 15px ${FB}`, color: C.mist, margin: "0 0 16px" }}>
        {online ? (LIVE ? `${pool.length} open request${pool.length === 1 ? "" : "s"} nearby` : `${SNOW_DEPTH_IN}" down · 12 open requests nearby`)
          : LIVE ? "Go online to see requests from customers near you." : `${SNOW_DEPTH_IN}" down in Duluth — demand is high right now.`}</p>

      {view === "live" && <DriverStormCard onRoute={() => setView("route")} />}

      {/* live jobs vs scheduled routes */}
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 14, background: C.night2, border: `1px solid ${C.line}`, marginBottom: 14 }}>
        {[["live", "Live jobs"], ["route", "Scheduled route"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} style={{ flex: 1, minHeight: 42, borderRadius: 11, border: "none",
            cursor: "pointer", font: `600 14px ${FB}`, color: view === k ? C.ice : C.mist, background: view === k ? C.slate2 : "transparent",
            boxShadow: view === k ? E.low : "none", WebkitTapHighlightColor: "transparent" }}>{l}</button>
        ))}
      </div>

      {view === "route" ? <RouteBoard here={here} /> : <>
      <div style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${C.line}` }}>
        {LIVE ? (MAP_ENABLED ? (online && pool.length ? <JobsMap jobs={pool} here={here} height={230} /> :
          <LiveMap center={here || DULUTH_CENTER} height={210}
            markers={here ? [{ lng: here.lng, lat: here.lat, size: 30, kind: "truck", pulse: online }] : []} />
        ) : <StormMap blips={[]} height={1.75} />)
        : MAP_ENABLED && state.driver.lng ? (
          <LiveMap center={{ lng: state.driver.lng, lat: state.driver.lat }} height={210}
            markers={[{ lng: state.driver.lng, lat: state.driver.lat, size: 30, kind: "truck", pulse: online }]} />
        ) : (
          <StormMap blips={[{ id: "me", x: state.driver.x, y: state.driver.y }]} selected={online ? { id: "me" } : null} height={1.75} />
        )}
      </div>

      {/* THE primary action — oversized for gloves */}
      <button onClick={toggle} aria-pressed={online}
        style={{ width: "100%", marginTop: 14, minHeight: 68, borderRadius: 18, cursor: "pointer",
          font: `700 19px ${FB}`, letterSpacing: "-.01em",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: online ? C.slate : C.push, color: online ? C.ice : C.onPush,
          border: online ? `1px solid ${C.line}` : "none",
          transition: `background .25s ${EASE}, color .25s`, WebkitTapHighlightColor: "transparent" }}>
        <Icon e={online ? "pause" : "play"} s={20} />
        {online ? "Go offline" : "Go online"}
      </button>

      {/* today at a glance — one card, three numbers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", marginTop: 14, background: C.slate,
        border: `1px solid ${C.line}`, borderRadius: 16 }}>
        {[[`$${state.earnings.today}`, "Today"], [state.earnings.jobsToday, "Jobs"], [`$${state.earnings.week}`, "This week"]].map(([v, l], i) => (
          <div key={l} style={{ padding: "14px 12px", borderLeft: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <div style={{ font: `800 25px/1 ${FD}`, textTransform: "uppercase", letterSpacing: ".005em", color: C.ice }}>{v}</div>
            <div style={{ font: `400 12.5px ${FB}`, color: C.mist, marginTop: 5 }}>{l}</div>
          </div>
        ))}
      </div>

      <AppSetupCard role="driver" />
      <DriverAlertsCard />

      {/* open jobs nearby — tap one to see the details and accept */}
      {LIVE && online && pool.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Eyebrow>Open jobs nearby</Eyebrow>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {[...pool].sort((a, b) => (driveEstimate(here, jobLL(a))?.mi ?? 99) - (driveEstimate(here, jobLL(b))?.mi ?? 99))
              .map(j => <JobRow key={j.jobId} job={j} here={here} onClick={() => setBrowseJob(j)} />)}
          </div>
        </div>
      )}
      {LIVE && online && (outsideZone > 0 || showAll) && (
        <button onClick={() => setShowAll(v => !v)} style={{ ...miniBtn, width: "100%", minHeight: 44, marginTop: 10 }}>
          {showAll ? "Only show jobs in my home zone" : `${outsideZone} more job${outsideZone > 1 ? "s" : ""} outside your home zone · show`}</button>
      )}

      {/* waiting state — calm, not empty */}
      {online && !incoming && !(LIVE && pool.length) && (
        <div style={{ marginTop: 18 }}>
          <div style={{ font: `500 13px ${FB}`, color: C.mist, textAlign: "center", marginBottom: 10 }}>
            Listening for nearby requests…</div>
          <div style={{ display: "grid", gap: 8, opacity: .5 }}>
            {[0, 1].map(i => (
              <div key={i} style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14,
                display: "flex", gap: 12, alignItems: "center" }}>
                <Skeleton h={36} w={36} r={10} />
                <div style={{ flex: 1 }}><Skeleton h={11} w="60%" /><div style={{ height: 7 }} /><Skeleton h={9} w="38%" /></div>
                <Skeleton h={20} w={48} r={8} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* demo: hillside dead-zone simulator (hidden once real accounts are on) */}
      {!supabaseEnabled && (
        <button onClick={() => { dispatch({ type: "OFFLINE", v: !state.offline });
            if (!state.offline) { dispatch({ type: "QUEUE" }); dispatch({ type: "TOAST", msg: "Signal lost — job data cached locally" }); } }}
          style={{ display: "flex", alignItems: "center", gap: 6, margin: "18px auto 0", background: "none", border: "none",
            cursor: "pointer", font: `500 13px ${FB}`, color: state.offline ? C.danger : C.mistDim, padding: 8 }}>
          <Icon e={state.offline ? "nosignal" : "signal"} s={14} />
          {state.offline ? "Offline mode — tap to reconnect" : "Simulate a dead zone"}
        </button>
      )}

      </>}

      {incoming && (LIVE
        ? <IncomingJob key={liveOffer.jobId} order={liveOffer} busy={claiming} here={here}
            onAccept={() => acceptLive(liveOffer)} onPass={(auto) => passLive(liveOffer, auto)} />
        : <IncomingJob order={o} here={{ lng: state.driver.lng, lat: state.driver.lat }} />)}
      {browseJob && <IncomingJob key={"b" + browseJob.jobId} order={browseJob} busy={claiming} here={here} browse
        onAccept={() => acceptLive(browseJob)} onPass={() => setBrowseJob(null)} />}
      {gate && <ConsentGate role="driver" onClose={() => setGate(false)}
        onAgree={async (rec) => {
          setGate(false);
          if (LIVE) {
            // Save the signed agreement FIRST — the database won't let anyone drive without it.
            dispatch({ type: "ACCEPT_LEGAL", rec });
            await recordLegalAcceptance(state.userId, rec);
            const r = await becomeDriver(state.userId, {}, null);
            if (r?.error) { dispatch({ type: "TOAST", msg: `Couldn't go online — ${r.error.message}` }); return; }
          } else acceptLegal(dispatch, rec, state.userId);
          goOnline(true); }} />}
    </section></Fade>
  );
}

// Straight-line miles between two {lat, lng} points.
function milesBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Road distance is longer than a straight line (Duluth's hills + grid): ~1.3x.
// Drive time assumes ~20 mph on snowy streets, plus a minute to get rolling.
const ROAD_FACTOR = 1.3, SNOW_MPH = 20;
function driveEstimate(from, to) {
  const crow = milesBetween(from, to);
  if (crow == null) return null;
  const mi = crow * ROAD_FACTOR;
  return { mi, mins: Math.max(2, Math.round(1 + (mi / SNOW_MPH) * 60)) };
}

function IncomingJob({ order, onAccept, onPass, busy, here, browse, acceptLabel }) {
  const { state, dispatch } = useStore();
  const q = order.quote;
  const prop = order.property;
  const dPay = driverNetPay(q, state.driver); // take-home
  const onSite = q.mins || order.size?.mins;  // measured from their outline when we have it
  const jobAt = prop?.center?.lat != null ? prop.center : (prop?.lat != null ? { lat: prop.lat, lng: prop.lng } : null);
  const drive = driveEstimate(here, jobAt);
  // hourly counts the real drive there when we know it (otherwise a typical 12 min)
  const dHourly = drive ? Math.round((dPay / ((onSite || 25) + drive.mins)) * 60) : driverHourlyFor(dPay, onSite);
  const jt = JOB_TYPES[order.jobType || "driveway"];
  const toolMatch = !state.driver.tools?.length || state.driver.tools.includes(order.tool || jt.tool);
  const hazards = (prop?.hazards || []).map(h => MODIFIERS.hazards[h]?.label).filter(Boolean);
  const steep = prop?.grade === "steep";
  const markedHazards = hazardLabels(prop);
  const headsUp = [...(steep ? ["Steep hillside"] : []), ...hazards, ...markedHazards];
  const plowN = prop?.zones?.filter(z => z.mode === "plow").length || (prop?.features || []).filter(f => f.geometry?.type === "Polygon" && f.properties?.mode !== "push" && f.properties?.mode !== "hazard").length;
  const pushN = prop?.zones?.filter(z => z.mode === "push").length || (prop?.features || []).filter(f => f.properties?.mode === "push").length;

  // Ring loudly (and buzz) until the driver accepts or passes (not when just browsing the list).
  useEffect(() => {
    if (browse) return;
    startRing();
    localAlert(`New plow request · $${dPay}`, `${jt.label}${prop?.addr ? ` · ${prop.addr}` : ""}`);
    return () => stopRing();
  }, []);

  // 15s auto-pass countdown (jobs are time-sensitive in a storm)
  const [secs, setSecs] = useState(15);
  useEffect(() => {
    if (browse) return;
    if (secs <= 0) { decline(true); return; }
    const t = setTimeout(() => setSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs]);

  const accept = () => {
    if (onAccept) { onAccept(); return; }
    dispatch({ type: "ORDER_STATE", patch: { state: "accepted", driver: state.driver, eta: 8,
      timeline: [...(order.timeline || []), { k: "accepted", t: "now", label: "You accepted" }] }});
    dispatch({ type: "TOAST", msg: "Job accepted — navigate to the property" });
  };
  const decline = (auto) => { if (onPass) { onPass(auto); return; } dispatch({ type: "CLEAR_ORDER" }); dispatch({ type: "TOAST", msg: auto ? "Request passed to the next driver" : "Request passed" }); };

  // Full-screen takeover: one decision, nothing else competing for attention.
  return (
    <div role="dialog" aria-modal="true" aria-label="New plow request" style={{ position: "fixed", inset: 0, zIndex: 40,
      background: C.night, display: "flex", justifyContent: "center", animation: "fadeIn .18s ease" }}>
      <div style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column",
        padding: "calc(18px + env(safe-area-inset-top)) 20px calc(18px + env(safe-area-inset-bottom))", overflowY: "auto" }}>

        {/* top: label + countdown */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ font: `600 15px ${FB}`, color: C.amber }}>{order.scheduledFor ? `Scheduled · ${fmtWindowLocal(order.scheduledFor)}`
            : (order.preferredDriverIds || []).includes(state.userId) ? "Your regular customer · first dibs" : browse ? "Open job" : "New request"}</div>
          {browse ? <button onClick={() => decline(false)} aria-label="Close" style={{ ...miniBtn, width: 44, height: 44, padding: 0, borderRadius: 14 }}><Icon e="close" s={18} /></button>
          : <div style={{ position: "relative", width: 44, height: 44 }} aria-label={`${secs} seconds left`}>
            <svg width="44" height="44" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="22" cy="22" r="18" fill="none" stroke={C.line} strokeWidth="3.5" />
              <circle cx="22" cy="22" r="18" fill="none" stroke={secs <= 5 ? C.danger : C.amber} strokeWidth="3.5"
                strokeDasharray={113} strokeDashoffset={113 * (1 - secs / 15)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s linear" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", font: `600 15px ${FB}`, color: secs <= 5 ? C.danger : C.ice }}>{secs}</div>
          </div>}
        </div>

        {/* pay — the number that matters */}
        <div style={{ font: `800 71px/1 ${FD}`, textTransform: "uppercase", letterSpacing: ".005em", color: C.ice, marginTop: 14 }}>${dPay}</div>
        <div style={{ font: `400 15px ${FB}`, color: C.mist, marginTop: 8 }}>
          Your pay · {jt.label}{q.depthLabel && !NO_DEPTH.includes(order.jobType) ? ` · ${q.depthLabel} snow` : ""} · ~${dHourly}/hr{drive ? " incl. drive" : ""}</div>

        {/* distance · area · time — everything needed to decide, before accepting */}
        {(() => {
          const sqft = prop?.sqft || q.sqft || 0;
          const areaTile = jt.basis === "area"
            ? { v: sqft ? `${sqft.toLocaleString()}` : "—", unit: sqft ? "sq ft" : "", l: `${plowN || 1} plow area${(plowN || 1) !== 1 ? "s" : ""}` }
            : jt.basis === "linear"
              ? { v: `~${q.linearFt || 80}`, unit: "ft", l: "of walkway" }
              : { v: "Flat", unit: "", l: "one-time job" };
          const tiles = [
            { k: "dist", label: "Distance", v: drive ? (drive.mi < 10 ? drive.mi.toFixed(1) : Math.round(drive.mi)) : "—",
              unit: drive ? "mi" : "", l: drive ? `~${drive.mins} min drive` : "turn on location" },
            { k: "area", label: jt.basis === "linear" ? "Walkway" : "Area", ...areaTile },
            { k: "time", label: "On site", v: `~${onSite || 25}`, unit: "min", l: "estimated" },
          ];
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
              {tiles.map(t => (
                <div key={t.k} style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: "11px 12px 10px" }}>
                  <div style={{ font: `500 10.5px ${FM}`, letterSpacing: ".08em", textTransform: "uppercase", color: C.mistDim }}>{t.label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 5 }}>
                    <span style={{ font: `800 26px/1 ${FD}`, textTransform: "uppercase", color: C.ice }}>{t.v}</span>
                    {t.unit && <span style={{ font: `600 12px ${FB}`, color: C.mist }}>{t.unit}</span>}
                  </div>
                  <div style={{ font: `400 13px ${FB}`, color: C.mist, marginTop: 4 }}>{t.l}</div>
                </div>
              ))}
            </div>
          );
        })()}
        {q.offer != null && (
          <div style={{ font: `400 14px ${FB}`, color: C.mist, marginTop: 10 }}>
            Customer offered ${q.offer} · you get 80% + the ${q.calloutFee || CALLOUT_FEE} call-out</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, font: `500 15px ${FB}`, color: C.ice, marginTop: 14 }}>
          <span style={{ color: C.mist, display: "flex" }}><Icon e="pin" s={16} /></span>{prop?.addr || "Nearby"}</div>

        {/* where + what */}
        <div style={{ marginTop: 16, borderRadius: 18, overflow: "hidden", border: `1px solid ${C.line}` }}>
          {prop?.mapImg ? (
            <img src={prop.mapImg} alt="" style={{ width: "100%", height: 170, objectFit: "cover", display: "block" }} />
          ) : MAP_ENABLED && prop?.center ? (
            <LiveMap center={prop.center} height={170} interactive={false} markers={[{ lng: prop.center.lng, lat: prop.center.lat, size: 26 }]} />
          ) : (
            <StormMap pin="Job" height={2.2} />
          )}
        </div>
        <div style={{ font: `400 13px ${FB}`, color: C.mist, marginTop: 8 }}>
          Follow the customer's outline — {plowN || 1} plow area{(plowN || 1) !== 1 ? "s" : ""}{pushN ? `, ${pushN} snow pile spot${pushN !== 1 ? "s" : ""}` : ""}.</div>

        {/* heads up — hazards before you accept */}
        {headsUp.length > 0 && (
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: C.danger + "12", border: `1px solid ${C.danger}40` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, font: `600 14px ${FB}`, color: C.danger, marginBottom: 8 }}>
              <Icon e="warning" s={15} /> Heads up</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {headsUp.map((h, i) => <Chip key={i} color={C.danger}>{h}</Chip>)}
            </div>
          </div>
        )}

        {!toolMatch && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderRadius: 14,
            background: C.slate, border: `1px solid ${C.line}`, font: `500 13px ${FB}`, color: C.mist }}>
            <span style={{ color: C.danger, display: "flex" }}><Icon e="warning" s={15} /></span>
            Needs a {(order.tool || jt.tool).toLowerCase()} — add it in Account to accept jobs like this.</div>
        )}

        <div style={{ flex: 1, minHeight: 20 }} />

        {/* one decision — theirs */}
        <p style={{ font: `400 12.5px/1.45 ${FB}`, color: C.mistDim, textAlign: "center", margin: "0 8px 10px" }}>
          Your call. Accepting means you're taking this job as an independent contractor under your Driver Agreement.</p>
        <button onClick={accept} disabled={!toolMatch || busy}
          style={{ width: "100%", minHeight: 64, borderRadius: 18, border: "none", cursor: toolMatch ? "pointer" : "not-allowed",
            background: toolMatch ? C.push : C.line, color: toolMatch ? C.onPush : C.mistDim,
            font: `700 19px ${FB}`, letterSpacing: "-.01em", WebkitTapHighlightColor: "transparent" }}>
          {busy ? "Accepting…" : acceptLabel ? `${acceptLabel} · $${dPay}` : `Accept · $${dPay}`}</button>
        <button onClick={() => decline(false)}
          style={{ display: "block", margin: "10px auto 0", background: "none", border: "none", cursor: "pointer",
            font: `500 15px ${FB}`, color: C.mist, padding: 10 }}>{browse ? "Back to the list" : "Pass"}</button>
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
      <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: "6px 0 10px" }}>
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
              <span style={{ fontSize: 22 }}><Icon e={jt.icon} s={22} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `700 13px ${FB}`, color: C.ice }}>{n.addr}</div>
                <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>{jt.label} · {n.dist} · {n.mins} min</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ font: `800 18px ${FD}`, textTransform: "uppercase", color: C.push }}>${n.pay}</div>
                <div style={{ font: `700 11px ${FB}`, color: on ? C.push : C.mistDim }}>{on ? <><Icon e="check" s={11} /> Added</> : "+ Add"}</div>
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
  const LIVE = isLive(state);
  const o = state.order, q = o.quote;
  const [here, setHere] = useState(o.state === "plowing");
  const dPay = driverNetPay(q, state.driver); // take-home
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
  const [problemOpen, setProblemOpen] = useState(false);
  const lastFix = useRef(null);         // previous GPS fix, for the mileage log

  // LIVE: tell the customer you're on the way, and bail out if they cancel.
  useEffect(() => {
    if (!LIVE || !o.jobId) return;
    if (o.state === "accepted") dispatch({ type: "ORDER_STATE", patch: { state: "enroute" } });
    const unsub = subscribeToJob(o.jobId, (row) => {
      if (row?.status === "cancelled") {
        dispatch({ type: "CLEAR_ORDER" });
        dispatch({ type: "TOAST", msg: "The customer cancelled this job" });
      }
    });
    return unsub;
  }, [LIVE, o.jobId]);

  useEffect(() => {
    if (LIVE) return;
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
        if (!(p.coords.accuracy > 100)) { addJobMiles(o.jobId, lastFix.current, loc); lastFix.current = loc; } // miles for the tax log
        if (supabaseEnabled && state.userId) {
          pushDriverLocation(state.userId, loc.lng, loc.lat, loc.heading);
        }
      },
      () => { /* permission denied / unavailable — keep the simulated route */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [o.state, state.userId]);

  const arrived = LIVE ? (here || o.state === "plowing") : (eta <= 0 || o.state === "plowing");
  const allChecked = checkableZones.length === 0 || checkableZones.every((_, i) => checks[i]);
  const jobCenter = o.property?.center;
  const initEtaD = o.eta || 8;
  const progD = jobCenter ? Math.min(1, Math.max(0, 1 - eta / initEtaD)) : 0;
  const driverLLD = LIVE ? null : jobCenter ? { lng: jobCenter.lng - 0.006 * (1 - progD), lat: jobCenter.lat + 0.004 * (1 - progD) } : null;
  const meLL = gps || driverLLD;

  const startPlow = () => dispatch({ type: "ORDER_STATE", patch: { state: "plowing" } });
  // Save each photo to the job right away so the customer can see it too.
  const savePhoto = (phase, photo) => {
    dispatch({ type: "ADD_PHOTO", phase, photo });
    if (LIVE && o.jobId) {
      const cur = o.photos || { before: [], after: [] };
      patchJob(o.jobId, { photos: { ...cur, [phase]: [...(cur[phase] || []), photo] } });
    }
  };
  const [finishing, setFinishing] = useState(false);
  const complete = async () => {
    if (LIVE && o.jobId) Promise.resolve(saveJobMiles(o.jobId, jobMiles(o.jobId))).catch(() => {}); // tax log
    if (LIVE && o.jobId && o.paymentStatus && o.paymentStatus !== "not_required") {
      setFinishing(true);
      try { await completeJobPaid(o.jobId, o.photos); }
      catch (e) { setFinishing(false); dispatch({ type: "TOAST", msg: `Couldn't finish — ${e.message}` }); return; }
      setFinishing(false);
    }
    dispatch({ type: "COMPLETE", q: { ...q, driverPay: dPay }, size: o.size });
    dispatch({ type: "ORDER_STATE", patch: { state: "arrived_done", completed: true } });
    dispatch({ type: "TOAST", msg: `Job complete · $${dPay} added to today` });
    notify(dispatch, { kind: "payment", title: `You earned $${dPay}`,
      body: `${o.property?.label || "Job"} complete · ${isLive(state) ? "sent to your payouts" : "paid out to your account"}.`, role: "driver" });
    notify(dispatch, { kind: "job", title: "Your property is plowed",
      body: `${o.property?.label || "Your driveway"} is clear. Photos are on your receipt.`, role: "rider" });
  };

  // ---- Queue: up to 3 live jobs, done in order ----
  const [queue, setQueue] = useState([]);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const loadQueue = () => { if (LIVE) listMyQueue(state.userId).then(({ data }) => setQueue((data || []).filter((r) => r.id !== o.jobId))); };
  useEffect(() => { loadQueue(); const iv = setInterval(loadQueue, 20000); return () => clearInterval(iv); }, [LIVE, o.jobId, o.state]);
  const startNext = () => {
    const next = queue[0];
    if (!next) { dispatch({ type: "CLEAR_ORDER" }); return; }
    dispatch({ type: "SET_ORDER", order: { ...rowToOrder(next, state.driver), state: "accepted", driver: state.driver,
      timeline: [{ k: "accepted", t: "now", label: "Next job" }] } });
  };
  const queueBlock = LIVE && (
    <div style={{ marginTop: 14 }}>
      {queue.length > 0 && <>
        <Eyebrow>Up next ({queue.length})</Eyebrow>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {queue.map((r, i) => { const j = rowToOrder(r, state.driver); return <JobRow key={j.jobId} job={j} here={meLL} sub={i === 0 ? "Next" : `#${i + 2}`} right={null} />; })}
        </div>
      </>}
      {queue.length < 2 && o.state !== "arrived_done" && (
        <button onClick={() => setNearbyOpen(true)} style={{ ...miniBtn, width: "100%", minHeight: 46, marginTop: 10, justifyContent: "center", gap: 8 }}>
          <Icon e="plus" s={16} /> Line up another nearby job ({queue.length + 1}/3)</button>
      )}
      {nearbyOpen && <NearbySheet here={meLL} queued={queue.length + 1} onClose={() => setNearbyOpen(false)} onAdded={() => { setNearbyOpen(false); loadQueue(); }} />}
    </div>
  );

  // driver's own completion screen
  if (o.state === "arrived_done") {
    return (
      <Fade k="jobdone"><section style={{ paddingTop: 8 }}>
        <div style={{ textAlign: "center", margin: "20px 0" }}>
          <DoneCheck size={72} />
          <h2 style={{ font: `800 40px/1 ${FD}`, textTransform: "uppercase", margin: "16px 0 0" }}>Job complete</h2>
          <p style={{ ...sub, marginTop: 6 }}>Nice work. Payout added to today's earnings.</p>
        </div>
        <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 14 }}>
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
                  <FauxPhoto seed={p.seed} phase={phase} path={p.path} />
                  <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,.6)", borderRadius: 5, padding: "2px 7px", font: `700 9px ${FB}`, color: "#fff" }}>{phase.toUpperCase()}</div>
                </div>
              ) : null;
            })}
          </div>
        ) : null}
        {queue.length > 0
          ? <Btn full kind="good" onClick={startNext}>Next job · {queue[0].address || "up next"}</Btn>
          : <Btn full kind="good" onClick={() => dispatch({ type: "CLEAR_ORDER" })}>Back online for more jobs</Btn>}
        {queue.length > 1 && <p style={{ ...sub, textAlign: "center", marginTop: 8 }}>{queue.length} jobs left in your queue</p>}
      </section></Fade>
    );
  }

  return (
    <section style={{ paddingTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <Eyebrow color={arrived ? C.push : C.amber}>{arrived ? "At the property" : "En route"}</Eyebrow>
          <h2 style={{ ...H(28), margin: "6px 0 0" }}>{arrived ? "Plow the job" : LIVE ? "Head to the property" : `${Math.ceil(eta)} min to site`}</h2>
        </div>
        <div style={{ font: `800 24px ${FD}`, textTransform: "uppercase", color: C.push }}>${dPay}</div>
      </div>

      {MAP_ENABLED && jobCenter ? (
        <LiveMap center={jobCenter} height={220}
          route={meLL ? [[meLL.lng, meLL.lat], [jobCenter.lng, jobCenter.lat]] : []}
          markers={[
            { lng: jobCenter.lng, lat: jobCenter.lat, size: 24 },
            ...(meLL ? [{ lng: meLL.lng, lat: meLL.lat, size: 26, pulse: true }] : []),
          ]} />
      ) : (
        <StormMap pin="Site" blips={[{ id: "me", x: pos.x, y: pos.y }]} selected={{ id: "me" }} tracking driverPos={pos} showRoute />
      )}

      {/* navigation / address */}
      <Card style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div style={{ font: `700 14px ${FB}` }}>{o.property?.addr}</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>{o.property?.label} · {(JOB_TYPES[o.jobType || "driveway"]).label}</div></div>
        <Btn onClick={() => {
          const ok = openDirections({ lat: jobCenter?.lat, lng: jobCenter?.lng, addr: o.property?.addr });
          dispatch({ type: "TOAST", msg: ok ? "Opening directions in Maps…" : "No address on this job yet" });
        }} style={{ minHeight: 52, padding: "0 20px", flex: "none" }}><Icon e="send" s={18} /> Navigate</Btn>
      </Card>

      {/* LIVE: the driver says when they've arrived (no fake ETA) */}
      {LIVE && !arrived && (
        <div style={{ marginTop: 12 }}>
          <Btn full kind="good" onClick={() => setHere(true)} style={{ minHeight: 64, fontSize: 18, borderRadius: 18 }}>I'm at the property</Btn>
        </div>
      )}

      {/* density routing: cluster of nearby jobs to batch (demo only for now) */}
      {!arrived && !LIVE && <ClusterRoute />}
      {queueBlock}

      <button onClick={() => setProblemOpen(true)} style={{ width: "100%", marginTop: 12, minHeight: 50, borderRadius: 14, cursor: "pointer",
        background: "transparent", border: `1px solid ${C.line}`, color: C.ice, font: `600 15px ${FB}`,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, WebkitTapHighlightColor: "transparent" }}>
        <Icon e="warning" s={17} color={C.amber} /> Report a problem</button>
      {problemOpen && <ProblemSheet job={o} canRelease={o.state !== "plowing"} onClose={() => setProblemOpen(false)}
        onReleased={() => { setProblemOpen(false); startNext(); }} />}

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
          {hazardLabels(o.property).length > 0 && <span style={{ color: C.danger }}>■ Hazards</span>}
        </div>
        {hazardLabels(o.property).length > 0 && (
          <div style={{ marginTop: 10, padding: "11px 13px", borderRadius: 12, background: C.danger + "12", border: `1px solid ${C.danger}40` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, font: `600 13px ${FB}`, color: C.danger, marginBottom: 7 }}>
              <Icon e="warning" s={14} /> Watch for</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {hazardLabels(o.property).map((h, i) => <Chip key={i} color={C.danger}>{h}</Chip>)}
            </div>
          </div>
        )}
      </div>

      {/* arrival -> before photo -> plow -> checklist + after photo -> complete */}
      {arrived && (
        <div style={{ marginTop: 14 }}>
          {o.state !== "plowing" ? (
            <>
              <Eyebrow color={C.plow}>Before you plow</Eyebrow>
              <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: "6px 0 10px" }}>
                Snap a quick "before" photo. The customer sees it as proof of the starting conditions.
              </p>
              <PhotoCapture phase="before" photos={o.photos?.before || []} jobId={o.jobId}
                onCapture={(photo) => savePhoto("before", photo)} />
              <div style={{ marginTop: 12 }}>
                <Btn full kind="good" onClick={startPlow} disabled={!(o.photos?.before?.length)} style={{ minHeight: 64, fontSize: 18, borderRadius: 18 }}>
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
                      background: C.slate, border: `1px solid ${checks[i] ? C.push : C.line}`, borderRadius: 14, padding: "16px 14px", minHeight: 58 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: "grid", placeItems: "center",
                      background: checks[i] ? C.push : "transparent", border: `2px solid ${checks[i] ? C.push : C.line}`,
                      color: C.onPush, fontWeight: 800 }}>{checks[i] ? <Icon e="check" s={13} /> : ""}</span>
                    <span style={{ font: `600 15px ${FB}`, color: C.ice }}>Plow zone {i + 1} cleared</span>
                  </button>
                ))}
              </div>
              </>}

              <Eyebrow color={C.push}>After photo</Eyebrow>
              <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: "6px 0 10px" }}>
                Show the finished job. This lands on the customer's receipt.
              </p>
              <PhotoCapture phase="after" photos={o.photos?.after || []} jobId={o.jobId}
                onCapture={(photo) => savePhoto("after", photo)} />

              <div style={{ marginTop: 14 }}>
                <Btn full onClick={complete} disabled={!allChecked || !(o.photos?.after?.length) || finishing} style={{ minHeight: 64, fontSize: 18, borderRadius: 18 }}>
                  {finishing ? "Finishing…" : !allChecked ? "Check off all zones" : !(o.photos?.after?.length) ? "Add an after photo" : `Complete job · collect $${dPay}`}
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
function PhotoCapture({ phase, photos, onCapture, jobId }) {
  const { state, dispatch } = useStore();
  const [capturing, setCapturing] = useState(false);
  const fileRef = useRef(null);
  const real = isLive(state) && !!jobId;
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCapturing(true);
    try { onCapture(await uploadJobPhoto(jobId, phase, file)); }
    catch (err) { dispatch({ type: "TOAST", msg: `Photo didn't upload — ${err.message}` }); }
    setCapturing(false);
  };
  const snap = () => {
    if (real) { fileRef.current?.click(); return; }
    setCapturing(true);
    setTimeout(() => {
      onCapture({ seed: Math.floor(Math.random() * 90) + 1, phase, ts: Date.now() });
      setCapturing(false);
    }, 550);
  };
  const col = phase === "before" ? C.plow : C.push;
  return (
    <div>
      {real && <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} style={{ display: "none" }} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {photos.map((p, i) => (
          <div key={i} style={{ width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: `1px solid ${col}66`, position: "relative" }}>
            <FauxPhoto seed={p.seed} phase={phase} path={p.path} />
            <div style={{ position: "absolute", bottom: 3, left: 3, background: "rgba(0,0,0,.6)", borderRadius: 4, padding: "1px 5px", font: `700 8px ${FB}`, color: "#fff" }}>{phase.toUpperCase()}</div>
          </div>
        ))}
        <button onClick={snap} disabled={capturing}
          style={{ width: 72, height: 72, borderRadius: 10, cursor: capturing ? "default" : "pointer",
            background: C.slate, border: `1.5px dashed ${col}88`, color: col, display: "grid", placeItems: "center" }}>
          {capturing
            ? <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${col}44`, borderTopColor: col, animation: "spin .7s linear infinite" }} />
            : <span style={{ fontSize: 22 }}><Icon e="camera" s={22} /></span>}
        </button>
      </div>
    </div>
  );
}

// ---- Driver payouts (Stripe Connect, embedded onboarding) -----------------
// Signed-in drivers set up payouts right inside the app. Stripe collects bank
// and tax (W-9) details; DRIFT never sees them.
function PayoutsCard() {
  const { dispatch } = useStore();
  const [st, setSt] = useState(null);       // { hasAccount, ready, due, owed, paidNow }
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const refresh = () => connectStatus()
    .then((r) => { setSt(r); setErr(null);
      if (r.paidNow > 0) dispatch({ type: "TOAST", msg: `$${r.paidNow} in earnings sent to your Stripe balance` }); })
    .catch((e) => setErr(e.message));
  useEffect(() => { refresh(); }, []);
  const openDashboard = async () => {
    try { const { url } = await connectDashboard(); window.open(url, "_blank", "noopener"); }
    catch (e) { dispatch({ type: "TOAST", msg: e.message }); }
  };
  const card = { background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, padding: S.lg, marginBottom: S.md };
  if (err) return <div style={card}><div style={{ font: `600 14px ${FB}`, color: C.ice }}>Payouts</div>
    <p style={{ font: `400 13px ${FB}`, color: C.mist, margin: "6px 0 0" }}>{err}</p></div>;
  if (!st) return <div style={card}><Skeleton h={16} w="40%" /><div style={{ height: 10 }} /><Skeleton h={44} r={12} /></div>;
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: st.ready ? C.push : C.amber, display: "flex" }}><Icon e="bank" s={20} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ font: `600 15px ${FB}`, color: C.ice }}>{st.ready ? "Payouts are on" : "Set up payouts"}</div>
          <div style={{ font: `400 13px ${FB}`, color: C.mist, marginTop: 2 }}>
            {st.ready ? "Your share of each job goes to your Stripe balance and then your bank automatically."
              : "Add your bank and tax info with Stripe so you can get paid. Takes a few minutes."}</div>
        </div>
      </div>
      {st.owed > 0 && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: C.night2, font: `500 13px ${FB}`, color: C.ice }}>
          ${Math.round(st.owed)} in earnings is waiting for you{st.ready ? "" : " — finish setup to get it"}.
        </div>
      )}
      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        {!st.ready && <Btn full kind="good" onClick={() => setOpen(true)}>{st.hasAccount ? "Continue setup" : "Set up payouts"}</Btn>}
        {st.hasAccount && <Btn full kind="dark" onClick={openDashboard}>Payout history and tax forms</Btn>}
      </div>
      <p style={{ font: `400 13px ${FB}`, color: C.mistDim, textAlign: "center", margin: "10px 0 0" }}>
        Secured by Stripe · DRIFT never sees your bank details</p>
      {open && <PayoutSetupSheet askType={!st.hasAccount} onClose={() => { setOpen(false); refresh(); }} />}
    </div>
  );
}

// First time only: are you getting paid as yourself or as a business?
function PayoutTypeStep({ onPick }) {
  const [type, setType] = useState("individual");
  const [biz, setBiz] = useState("");
  const opt = (id, icon, title, sub) => (
    <button onClick={() => setType(id)} style={{ textAlign: "left", width: "100%", cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start",
      padding: "14px 14px", borderRadius: 14, background: type === id ? C.amber + "14" : C.slate,
      border: `1.5px solid ${type === id ? C.amber : C.line}`, color: C.ice, WebkitTapHighlightColor: "transparent" }}>
      <span style={{ color: type === id ? C.amber : C.mist, display: "flex", marginTop: 2 }}><Icon e={icon} s={20} /></span>
      <span><span style={{ display: "block", font: `600 15px ${FB}` }}>{title}</span>
        <span style={{ display: "block", font: `400 13px/1.45 ${FB}`, color: C.mist, marginTop: 3 }}>{sub}</span></span>
    </button>
  );
  return (
    <div>
      <p style={{ ...sub, margin: "0 0 14px" }}>Who should DRIFT pay?</p>
      <div style={{ display: "grid", gap: 10 }}>
        {opt("individual", "user", "Me", "Paid to your personal bank account. You'll use your SSN for tax forms.")}
        {opt("company", "building", "My business", "Paid to your business bank account under its EIN. Great for plow or landscaping companies — you pay your own crew.")}
      </div>
      {type === "company" && (
        <input value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="Legal business name (e.g. North Shore Plowing LLC)"
          style={{ ...inp, marginTop: 12 }} />
      )}
      <div style={{ marginTop: 16 }}>
        <Btn full disabled={type === "company" && biz.trim().length < 2} onClick={() => onPick({ entityType: type, businessName: biz.trim() })}>Continue</Btn>
      </div>
      <p style={{ font: `400 13px ${FB}`, color: C.mistDim, textAlign: "center", margin: "10px 0 0" }}>This can't be switched later, so pick the one your taxes go under.</p>
    </div>
  );
}

function PayoutSetupSheet({ onClose, askType }) {
  const [choice, setChoice] = useState(askType ? null : {});
  return (
    <Sheet onClose={onClose}>
      <h3 style={{ ...H(24), margin: "0 0 12px" }}>Set up payouts</h3>
      {choice ? <PayoutOnboarding choice={choice} onClose={onClose} /> : <PayoutTypeStep onPick={setChoice} />}
    </Sheet>
  );
}

function PayoutOnboarding({ choice, onClose }) {
  const [instance] = useState(() => loadConnectAndInitialize({
    publishableKey: STRIPE_PK,
    fetchClientSecret: () => connectSession(choice),
    appearance: {
      overlays: "dialog",
      variables: { colorPrimary: C.amber, colorBackground: C.night2, colorText: C.ice,
        colorSecondaryText: C.mist, colorBorder: C.line, borderRadius: "12px",
        fontFamily: "-apple-system, system-ui, sans-serif" },
    },
  }));
  return (
    <ConnectComponentsProvider connectInstance={instance}>
      <ConnectNotificationBanner />
      <ConnectAccountOnboarding onExit={onClose} />
    </ConnectComponentsProvider>
  );
}

function DriverEarnings({ onReferral }) {
  const { state, dispatch } = useStore();
  const LIVE = isLive(state);
  const e = state.earnings;
  const ref = state.driverReferral;
  const max = Math.max(...e.payouts.map(p => p.amt), 1);
  const [sel, setSel] = useState(null);
  const WEEK_GOAL = 900;
  const goalPct = Math.min(1, e.week / WEEK_GOAL);
  const animWeek = useCountUp(e.week, 600);

  return (
    <Fade k="earn"><section style={{ paddingTop: 18 }}>
      {/* hero balance */}
      <div style={{ borderRadius: 20, padding: S.xl, marginBottom: S.lg, position: "relative", overflow: "hidden",
        background: C.slate, border: `1px solid ${C.amber}44` }}>
        <div style={{ position: "absolute", top: -46, right: -30, fontSize: 150, opacity: .06 }}><Icon e="cash" s={150} /></div>
        <Eyebrow>This week</Eyebrow>
        <div style={{ font: `800 54px/1 ${FD}`, textTransform: "uppercase", color: C.amber, margin: "8px 0 4px" }}>${animWeek}</div>
        <div style={{ font: `500 13px ${FB}`, color: C.mist, marginBottom: S.lg }}>
          ${e.today} today · {e.jobsToday} job{e.jobsToday !== 1 ? "s" : ""} completed
        </div>
        {/* weekly goal (demo only) */}
        {!LIVE && <><div style={{ display: "flex", justifyContent: "space-between", font: `600 11px ${FB}`, color: C.mist, marginBottom: 6 }}>
          <span>Weekly goal</span><span style={{ color: C.ice }}>${e.week} / ${WEEK_GOAL}</span>
        </div>
        <div style={{ height: 8, borderRadius: 8, background: C.night, overflow: "hidden" }}>
          <div style={{ width: `${goalPct * 100}%`, height: "100%",
            background: C.amber, transition: `width .8s ${EASE}` }} />
        </div></>}
      </div>

      {/* quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: S.lg }}>
        <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: S.lg }}>
          {LIVE ? <><div style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.ice }}>{e.jobsWeek || 0}</div>
            <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 3 }}>Jobs this week</div></>
          : <><div style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.ice }}>$92<span style={{ fontSize: 13 }}>/hr</span></div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 3 }}>Active-job rate at peak</div></>}</div>
        <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 14, padding: S.lg }}>
          <div style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.push }}>{Math.round(driverPct(state.driver) * 100)}%</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 3 }}>You keep per job</div></div>
      </div>

      {/* this week, day by day */}
      <Card style={{ marginBottom: S.lg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <Eyebrow color={C.mist}>{LIVE ? "Last 7 days" : "Daily payouts"}</Eyebrow>
          <span style={{ font: `500 13px ${FB}`, color: sel ? C.ice : C.mist }}>{sel ? `${sel.d} · $${sel.amt}` : `$${Math.round(e.payouts.reduce((t, p) => t + p.amt, 0))} total`}</span>
        </div>
        {e.payouts.every(p => !p.amt) ? (
          <div style={{ height: 120, display: "grid", placeItems: "center", textAlign: "center", font: `400 14px/1.45 ${FB}`, color: C.mist,
            borderRadius: 12, background: `repeating-linear-gradient(0deg, transparent 0 29px, ${C.lineSoft} 29px 30px)` }}>
            No payouts yet this week.<br />Your first storm will show up here.</div>
        ) : (
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 8, height: 140, paddingTop: 18,
            background: `repeating-linear-gradient(0deg, ${C.lineSoft} 0 1px, transparent 1px 30px)` }}>
            {e.payouts.map((p, i) => {
              const on = sel?.d === p.d, today = i === e.payouts.length - 1;
              return (
                <button key={p.d + i} onClick={() => setSel(on ? null : p)} aria-label={`${p.d}: $${p.amt}`}
                  style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 6,
                    background: "none", border: "none", cursor: "pointer", padding: 0, WebkitTapHighlightColor: "transparent" }}>
                  {p.amt > 0 && <span style={{ font: `600 11.5px ${FB}`, color: on || today ? C.ice : C.mist }}>${Math.round(p.amt)}</span>}
                  <div style={{ width: "100%", height: p.amt ? `${Math.max(6, (p.amt / max) * 88)}px` : 3, borderRadius: "7px 7px 3px 3px",
                    background: on ? C.push : today ? C.amber : C.amber + "99", transition: `all .25s ${EASE}` }} />
                  <span style={{ font: `${today ? 700 : 500} 12px ${FB}`, color: on || today ? C.ice : C.mist }}>{today ? "Today" : p.d}</span>
                </button>
              );
            })}
          </div>
        )}
        {e.week > 0 && <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.lineSoft}`,
          font: `400 13px/1.45 ${FB}`, color: C.mist }}>
          <Icon e="bank" s={15} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>Taxes aren't taken out — a common rule of thumb is to set aside about 25%, so <b style={{ color: C.ice }}>${Math.round(e.week * 0.25)}</b> of this week. Ask a tax pro for your situation.</span>
        </div>}
      </Card>

      <TaxCard />

      {/* payouts: real Stripe setup for signed-in drivers, demo card otherwise */}
      {isLive(state) && STRIPE_ENABLED ? <PayoutsCard /> : (
      !isLive(state) && STRIPE_ENABLED && !state.driver.stripeAccountId ? (
        <div style={{ background: C.slate, border: `1px solid ${C.plow}55`,
          borderRadius: 16, padding: S.lg, marginBottom: S.md }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 22 }}><Icon e="bank" s={22} /></span>
            <div style={{ font: `700 15px ${FB}`, color: C.ice }}>Set up your payouts</div>
          </div>
          <p style={{ font: `500 13px ${FB}`, color: C.mist, margin: "0 0 14px" }}>
            Connect a bank account through Stripe to get paid — takes about 2 minutes. You keep 80% of every offer, the full ${CALLOUT_FEE} call-out fee, and all tips — deposited automatically.
          </p>
          <Btn full kind="dark" onClick={() => {
            dispatch({ type: "TOAST", msg: "Sign in with a driver account to set up payouts" });
          }}>Connect bank with Stripe ›</Btn>
          <p style={{ font: `500 13px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
            Secured by Stripe · we never see your bank details
          </p>
        </div>
      ) : LIVE ? null : (
        <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 16, padding: S.lg, marginBottom: S.md }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: S.md }}>
            <div>
              <div style={{ font: `700 14px ${FB}`, color: C.ice }}>Available now</div>
              <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>Stripe Connect · same-day</div>
            </div>
            <div style={{ font: `800 31px ${FD}`, textTransform: "uppercase", color: C.push }}>${e.week}</div>
          </div>
          <Btn full kind="good" onClick={() => dispatch({ type: "TOAST", msg: `$${e.week} sent — arrives in seconds` })}>
            Cash out instantly
          </Btn>
          <p style={{ font: `500 13px ${FB}`, color: C.mistDim, textAlign: "center", marginTop: 10 }}>
            $0.50 instant fee · free if you wait for Tuesday deposit
          </p>
        </div>
      )
      )}

      {/* referral CTA (demo only until referrals are real) */}
      {!LIVE && <Card onClick={onReferral} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        borderColor: C.push + "55", background: C.slate }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.push + "1E", display: "grid",
            placeItems: "center", fontSize: 19, flexShrink: 0 }}><Icon e="handshake" s={19} /></div>
          <div><div style={{ font: `700 14px ${FB}` }}>Refer a driver · earn ${ref.reward}</div>
            <div style={{ font: `500 13px ${FB}`, color: C.mist, marginTop: 2 }}>
              {ref.credit > 0 ? `$${ref.credit} earned · ${ref.invited} referred` : `Paid when they finish ${ref.threshold} jobs`}</div></div></div>
        <Icon e="chevronright" s={16} color={C.mistDim} />
      </Card>}
    </section></Fade>
  );
}

function DriverAccount({ onReferral }) {
  const { state, dispatch } = useStore();
  const auth = useAuth();
  const base = state.driver;
  const ref = state.driverReferral;
  const [legalOpen, setLegalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [regularsOpen, setRegularsOpen] = useState(false);
  const LIVE = isLive(state);
  const [fresh, setFresh] = useState(null); // latest rating / jobs from the database
  useEffect(() => { if (LIVE) getProfile(state.userId).then(({ data }) => data && setFresh(profileToDriver(data))); }, [LIVE, state.userId]);
  const d = fresh ? { ...base, rating: fresh.rating, reviews: fresh.reviews, jobs: fresh.jobs, lateCancels: fresh.lateCancels } : base;
  const openPayouts = async () => {
    try { const { url } = await connectDashboard(); window.open(url, "_blank", "noopener"); }
    catch (e) { dispatch({ type: "TOAST", msg: "Set up payouts in the Earnings tab first" }); }
  };
  const docRow = (label, status) => {
    const ok = status === "received" || status === "verified";
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${C.lineSoft}` }}>
        <span style={{ font: `600 13px ${FB}`, color: C.ice }}>{label}</span>
        <Chip color={ok ? C.good : C.amber}>{ok ? "On file" : "Needed"}</Chip>
      </div>
    );
  };
  return (
    <section style={{ paddingTop: 18 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: C.slate, border: `1px solid ${C.line}`,
          display: "grid", placeItems: "center", fontSize: 26 }}><Icon e="pickup" s={26} /></div>
        <div><div style={{ font: `700 19px ${FB}` }}>{d.name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
            {d.rating ? <><Stars v={Number(d.rating)} size={13} /><span style={{ font: `600 12px ${FB}`, color: C.mist }}>{d.rating} · {d.jobs} jobs</span></>
              : <span style={{ font: `600 12px ${FB}`, color: C.mist }}>{d.jobs ? `${d.jobs} jobs · no ratings yet` : "New driver"}</span>}</div></div>
      </div>
      <LevelCard d={d} />

      <ListGroup style={{ marginBottom: 14 }}>
        <ListRow icon="pin" tint={C.push} title="Home zone" sub={zoneText(base)} onClick={() => setZoneOpen(true)} />
        <ListRow icon="heart" tint={C.danger} title="Your regulars" sub="Customers who get you first" onClick={() => setRegularsOpen(true)} />
        <ListRow icon="share" tint={C.plow} title="Invite a plow buddy" sub="Send them a link to drive with DRIFT" onClick={() => inviteDriver(state, dispatch)} last />
      </ListGroup>

      <ListGroup style={{ marginBottom: 14 }}>
        <ListRow icon="user" tint={C.amber} title="Profile and equipment" sub="Name, phone, truck and gear" onClick={() => setEditOpen(true)} last={!LIVE} />
        {LIVE && <ListRow icon="star" tint={C.amber} title="Your reviews"
          sub={d.reviews ? `${d.rating} average · ${d.reviews} review${d.reviews === 1 ? "" : "s"}` : "What customers say will show here"}
          onClick={() => setReviewsOpen(true)} />}
        {LIVE && STRIPE_ENABLED && <ListRow icon="bank" tint={C.push} title="Payouts and tax forms" sub="Bank, payout history and 1099s in Stripe" onClick={openPayouts} last />}
      </ListGroup>

      {/* your share — one flat rate, no tiers */}
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow>Your share</Eyebrow>
        <div style={{ font: `800 38px/1 ${FD}`, textTransform: "uppercase", letterSpacing: ".005em", color: C.ice, marginTop: 8 }}>
          80%<span style={{ font: `400 14px ${FB}`, color: C.mist, letterSpacing: 0 }}> of every offer</span></div>
        <p style={{ font: `400 13px/1.45 ${FB}`, color: C.mist, margin: "8px 0 0" }}>
          Plus the full $10 call-out fee and 100% of tips. Customers set their offer — you choose which ones to take. Same rate for every driver.</p>
      </Card>

      {/* equipment — determines which job types you can accept */}
      <Card style={{ marginBottom: 14 }}>
        <Eyebrow color={C.plow}>Your equipment</Eyebrow>
        <p style={{ font: `500 13px ${FB}`, color: C.mistDim, margin: "6px 0 10px" }}>
          You'll only be offered jobs your gear can handle.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Array.from(new Map(Object.values(JOB_TYPES).map(jt => [jt.tool, jt])).values()).map(jt => {
            const has = d.tools?.includes(jt.tool);
            return (
              <div key={jt.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderRadius: 20,
                background: has ? C.push + "16" : C.slate, border: `1px solid ${has ? C.push + "55" : C.line}`,
                font: `600 11px ${FB}`, color: has ? C.push : C.mistDim }}>
                <span><Icon e={jt.icon} s={14} /></span>{jt.tool}{has ? <> <Icon e="check" s={12} /></> : ""}
              </div>
            );
          })}
        </div>
      </Card>

      {LIVE && <DriverDocsCard />}
      {LIVE && <div style={{ marginBottom: 14 }}>{INSURANCE_NOTE}</div>}
      {/* documents (demo only) */}
      {!LIVE && <Card style={{ marginBottom: 14 }}>
        <Eyebrow>Documents</Eyebrow>
        <div style={{ marginTop: 8 }}>
          {docRow("Driver's license", d.docs?.license || "pending")}
          {docRow("Vehicle registration", d.docs?.plate || "pending")}
          {docRow("W-9 / tax info", d.docs?.w9 || "pending")}
        </div>
        <p style={{ font: `500 13px ${FB}`, color: C.mistDim, margin: "10px 0 0" }}>
          DRIFT doesn't provide insurance. Any coverage you carry is your own choice and your responsibility.
        </p>
      </Card>}

      {!LIVE && <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}><Icon e="bank" s={20} /></span>
          <div><div style={{ font: `700 13px ${FB}` }}>Payout account</div>
            <div style={{ font: `500 13px ${FB}`, color: C.mist }}>Stripe Connect · ···6789</div></div></div>
        <Chip color={C.good}>Linked</Chip>
      </Card>}

      {/* referral entry (demo only) */}
      {!LIVE && <Card onClick={onReferral} style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center",
        borderColor: C.push + "55" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 20 }}><Icon e="handshake" s={20} /></span>
          <div><div style={{ font: `700 13px ${FB}` }}>Refer drivers · earn ${ref.reward} each</div>
            <div style={{ font: `500 13px ${FB}`, color: C.mist }}>Bring on plow operators you trust</div></div></div>
        <span style={{ color: C.push, display: "flex" }}><Icon e="chevronright" s={16} /></span>
      </Card>}

      <div style={{ height: 14 }} />
      <AppearancePicker />
      <div style={{ height: 14 }} />
      <ListGroup>
        <ListRow icon="home" tint={C.plow} title="Switch to customer app" sub="Order a plow for your own place"
          onClick={() => dispatch({ type: "ROLE", role: "rider" })} />
        <ListRow icon="doc" tint={C.mist} title="Legal" sub="Your contractor agreement and terms"
          onClick={() => setLegalOpen(true)} last />
      </ListGroup>
      {legalOpen && <LegalHub onClose={() => setLegalOpen(false)}
        acceptance={[state.legal?.driver, state.legal?.customer].filter(Boolean)} />}
      {editOpen && <ProfileSheet driver onClose={() => setEditOpen(false)} />}
      {zoneOpen && <HomeZoneSheet onClose={() => setZoneOpen(false)} />}
      {regularsOpen && <RegularsSheet onClose={() => setRegularsOpen(false)} />}
      {reviewsOpen && <ReviewsSheet userId={state.userId} name="" rating={d.rating} count={d.reviews || 0} onClose={() => setReviewsOpen(false)} />}

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
    <Fade k="dref"><section style={{ paddingTop: 18 }}>
      <button onClick={onBack} style={{ ...miniBtn, marginBottom: 14 }}>‹ Back</button>
      <Eyebrow color={C.push}>Driver referrals</Eyebrow>
      <h2 style={h2}>Earn ${ref.reward} per driver</h2>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.push }}>${ref.credit}</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist }}>Bonuses earned</div>
        </div>
        <div style={{ flex: 1, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ font: `800 28px ${FD}`, textTransform: "uppercase", color: C.ice }}>{ref.invited}</div>
          <div style={{ font: `500 13px ${FB}`, color: C.mist }}>Drivers referred</div>
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
                  <div style={{ width: `${(x.jobs / ref.threshold) * 100}%`, height: "100%", background: C.push }} />
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
function AuthScreen({ auth, onDemo, initialRole, signInOnly, title }) {
  const [mode, setMode] = useState(signInOnly ? "signin" : "signup"); // signup | signin | forgot
  const [role, setRole] = useState(initialRole || "customer"); // customer | driver
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const submit = async () => {
    setErr(""); setInfo("");
    if (mode === "forgot") {
      if (!/.+@.+\..+/.test(email.trim())) { setErr("Enter the email you signed up with."); return; }
      setBusy(true);
      const r = await auth.resetPassword(email.trim());
      setBusy(false);
      if (r?.error) { setErr(r.error.message || "Couldn't send the email. Try again."); return; }
      setInfo("Check your email for a link to reset your password. It can take a minute — check spam too.");
      return;
    }
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
      <style>{`*{box-sizing:border-box;-webkit-font-smoothing:antialiased} input::placeholder{color:${C.mistDim}}`}</style>
      <div style={{ width: "100%", maxWidth: 440, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px" }}>
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: C.amber, color: C.onAmber, display: "grid", placeItems: "center" }}>
              <Icon e="snowflake" s={19} /></span>
            <span style={{ font: `900 28px/1 ${FD}`, textTransform: "uppercase", letterSpacing: ".06em" }}>DRIFT</span>
          </div>
          <h1 style={{ font: `900 52px/.9 ${FD}`, textTransform: "uppercase", margin: "26px 0 10px", color: C.ice }}>
            {mode === "forgot" ? <>Reset your<br /><span style={{ color: C.amber }}>password.</span></>
              : title ? title : mode === "signup" ? <>Let's get you<br /><span style={{ color: C.amber }}>plowed.</span></> : <>Welcome<br /><span style={{ color: C.amber }}>back.</span></>}</h1>
          <div style={{ font: `400 15px/1.5 ${FB}`, color: C.mist }}>
            {mode === "forgot" ? "Enter your email and we'll send you a link to set a new one."
              : mode === "signup" ? "Create your account — it takes about a minute." : "Sign in to your DRIFT account."}</div>
        </div>

        {mode === "signup" && (
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {[["customer", "I need plowing"], ["driver", "I plow & earn"]].map(([id, label]) => {
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
          {mode !== "forgot" && field({ value: password, onChange: (e) => setPassword(e.target.value), placeholder: "Password", type: "password",
            autoComplete: mode === "signup" ? "new-password" : "current-password",
            onKeyDown: (e) => { if (e.key === "Enter") submit(); } })}
        </div>
        {mode === "signin" && (
          <button onClick={() => { setErr(""); setInfo(""); setMode("forgot"); }}
            style={{ alignSelf: "flex-end", marginTop: 8, background: "none", border: "none", cursor: "pointer",
              color: C.amber, font: `600 13px ${FB}`, padding: "6px 2px" }}>Forgot password?</button>
        )}

        {err && <div style={{ marginTop: 12, font: `600 12px ${FB}`, color: C.danger }}>{err}</div>}
        {info && <div style={{ marginTop: 12, font: `600 12px ${FB}`, color: C.push }}>{info}</div>}

        <div style={{ marginTop: 16 }}>
          <Btn full onClick={submit} disabled={busy}>
            {busy ? "One moment…" : mode === "forgot" ? "Email me a reset link" : mode === "signup" ? "Create account" : "Sign in"}</Btn>
        </div>

        {mode === "forgot" ? <button onClick={() => { setErr(""); setInfo(""); setMode("signin"); }}
          style={{ width: "100%", marginTop: 14, background: "transparent", border: "none", cursor: "pointer",
            color: C.mist, font: `600 13px ${FB}`, padding: 8 }}>Back to sign in</button>
        : !signInOnly && <button onClick={() => { setErr(""); setInfo(""); setMode(mode === "signup" ? "signin" : "signup"); }}
          style={{ width: "100%", marginTop: 14, background: "transparent", border: "none", cursor: "pointer",
            color: C.mist, font: `600 13px ${FB}`, padding: 8 }}>
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>}

        {onDemo && <button onClick={onDemo} style={{ width: "100%", marginTop: 6, background: "transparent",
          border: `1px dashed ${C.line}`, borderRadius: 12, cursor: "pointer", color: C.mistDim,
          font: `600 12px ${FB}`, padding: 11 }}>
          Skip — just explore the demo
        </button>}
      </div>
    </div>
  );
}


// Shown after someone opens the reset link from their email.
function ResetPasswordScreen({ auth }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setErr("");
    if (pw.length < 6) { setErr("Use at least 6 characters."); return; }
    if (pw !== pw2) { setErr("Those passwords don't match."); return; }
    setBusy(true);
    const r = await auth.updatePassword(pw);
    setBusy(false);
    if (r?.error) setErr(r.error.message || "Couldn't save it. Try again.");
  };
  const box = { width: "100%", background: C.slate, color: C.ice, font: `500 15px ${FB}`, outline: "none",
    padding: "13px 14px", borderRadius: 11, border: `1px solid ${C.line}` };
  return (
    <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 440, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px" }}>
        <h1 style={{ font: `900 52px/.9 ${FD}`, textTransform: "uppercase", margin: "0 0 10px" }}>
          New<br /><span style={{ color: C.amber }}>password.</span></h1>
        <div style={{ font: `400 15px/1.5 ${FB}`, color: C.mist, marginBottom: 22 }}>
          Pick a new password for {auth.user?.email || "your account"}.</div>
        <div style={{ display: "grid", gap: 11 }}>
          <input type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} style={box} />
          <input type="password" autoComplete="new-password" placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }} style={box} />
        </div>
        {err && <div style={{ marginTop: 12, font: `600 12px ${FB}`, color: C.danger }}>{err}</div>}
        <div style={{ marginTop: 16 }}><Btn full onClick={save} disabled={busy}>{busy ? "Saving…" : "Save new password"}</Btn></div>
      </div>
    </div>
  );
}

function restyleStatics() {
  Object.assign(sub, { color: C.mist });
  Object.assign(legalLink, { color: C.plow });
  Object.assign(miniBtn, { background: C.slate, color: C.ice, border: `1px solid ${C.line}` });
  Object.assign(canvasBtn, { background: C.glassStrong, color: C.ice, border: `1px solid ${C.line}` });
  Object.assign(inp, { background: C.slate, border: `1px solid ${C.line}`, color: C.ice });
}

function Shell({ startEntered = false }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const store = useMemo(() => ({ state, dispatch }), [state]);
  const auth = useAuth();
  const [bypass, setBypass] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null); // landing-page footer → document reader
  const [entered, setEntered] = useState(DRIVE_INTENT || startEntered); // false = show the marketing homepage first
  // Tidy the address bar so a refresh doesn't re-trigger driver sign-up.
  useEffect(() => { if (DRIVE_INTENT && typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname); }, []);
  // Re-render everything when the theme flips (Account → Appearance, or the phone's setting in Auto).
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => { restyleStatics(); setThemeTick(t => t + 1); }), []);

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
    // Live: only the driver moves the job along; the customer's screen just follows.
    if (supabaseEnabled && state.role !== "driver") return;
    const statusMap = { requested: "requested", accepted: "accepted", enroute: "enroute",
      plowing: "plowing", arrived_done: "completed" };
    const status = statusMap[o.state];
    if (!status) return;
    if (status === "requested" || status === "accepted") return; // set by the database itself
    if (status === "completed" && o.paymentStatus && o.paymentStatus !== "not_required") return; // done by the payment server
    const patch = { status };
    if (status === "completed") patch.photos = o.photos || undefined; // money + timestamps are set by the database
    patchJob(o.jobId, patch);
  }, [state.order?.state, state.order?.jobId]);

  // Hydrate the app from the signed-in account (profile + saved properties).
  useEffect(() => {
    if (!supabaseEnabled || !auth.session || !auth.profileReady) return;
    let cancelled = false;
    (async () => {
      const uid = auth.user.id;
      const meta = auth.user.user_metadata || {};
      // Normally the profile row exists; if it somehow doesn't, still treat this as a
      // real account (never fall back to the demo) using the sign-up details.
      const prof = auth.profile || { id: uid, email: auth.user.email, name: meta.name || "", phone: meta.phone || "", role: meta.role || "customer", is_driver: false };
      const role = (driveIntentPending || prof.role === "driver" || prof.is_driver) ? "driver" : "rider";
      driveIntentPending = false;
      let props = [];
      if (role === "rider") {
        try { const { data } = await loadProperties(uid); props = data || []; } catch { /* show setup instead of hanging */ }
      }
      if (cancelled) return;
      const me = profileToDriver(prof);
      dispatch({ type: "HYDRATE_USER", userId: uid, role, isDriver: !!prof.is_driver,
        driver: me && { ...me, tools: prof.tools || [] },
        profile: { name: prof.name || "", phone: prof.phone || "", email: prof.email || auth.user.email || "" },
        properties: props });
      loadAccountStats(uid).then((st) => { if (!cancelled && st) dispatch({ type: "ACCOUNT_STATS", ...st }); }).catch(() => {});
      // Sign-up source (?ref= link they arrived from), saved once.
      try { const ref = localStorage.getItem("drift.ref"); if (ref && !prof.ref_source) updateMyProfile(uid, { ref_source: ref }); } catch { /* ignore */ }
      // Pick up a job that was in progress (page refresh, dead battery, new phone).
      const { data: row } = await loadActiveJob(uid);
      if (cancelled || !row) return;
      if (role === "driver" && row.driver_id === uid) dispatch({ type: "SET_ORDER", order: rowToOrder(row, me) });
      if (role === "rider" && row.customer_id === uid) dispatch({ type: "SET_ORDER", order: rowToOrder(row) });
    })();
    return () => { cancelled = true; };
  }, [auth.session, auth.profile, auth.profileReady]);

  // Scheduled plows need a heartbeat (reminders, check-in deadlines, hand-offs). The
  // server cron does it; any open app also nudges it as a backup (throttled server-side).
  useEffect(() => {
    if (!supabaseEnabled || !state.userId) return;
    schedTick();
    const iv = setInterval(schedTick, 3 * 60 * 1000);
    return () => clearInterval(iv);
  }, [state.userId]);

  // Deep links that belong to the driver side (route / new offer / "Drive" shortcut).
  const link = useDeepLink();
  useEffect(() => {
    if (!state.userId) return;
    const driverLink = link.route || link.offer || link.go === "drive";
    if (driverLink && state.driverOnboarded && state.role !== "driver") dispatch({ type: "ROLE", role: "driver" });
    if (link.go === "drive" || link.go === "book") consumeLink("go");
  }, [state.userId, link.route, link.offer, link.go]);

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
  const SkipButton = !DEMO_OK ? null : (
    <button onClick={devSkip} title="Dev: skip setup"
      style={{ position: "fixed", bottom: "calc(84px + env(safe-area-inset-bottom))", left: 12, zIndex: 9999,
        font: `600 11px ${FB}`, color: C.mist, background: C.glassStrong, border: `1px solid ${C.line}`,
        padding: "6px 11px", borderRadius: 20, cursor: "pointer", opacity: .85,
        WebkitTapHighlightColor: "transparent" }}>
      Skip <Icon e="skipnext" s={11} />
    </button>
  );

  // Opened the "reset your password" email link → set a new one first.
  if (supabaseEnabled && auth.recovering) return <ResetPasswordScreen auth={auth} />;

  // Owner dashboard at ?admin=1 (or ?ops=1). Sign in with an owner account;
  // the server refuses everyone else.
  if (ADMIN_ROUTE) {
    if (!supabaseEnabled) return <div style={{ padding: 40, color: C.ice, background: C.night, minHeight: "100vh", fontFamily: FB }}>Connect Supabase to use the owner dashboard.</div>;
    if (auth.loading) return <div style={{ minHeight: "100vh", background: C.night }} />;
    if (!auth.session) return <AuthScreen auth={auth} signInOnly title="Owner sign in" />;
    return <React.Suspense fallback={<div style={{ minHeight: "100vh", background: C.night }} />}>
      <AdminApp email={auth.user?.email} onSignOut={async () => { await auth.signOut(); dispatch({ type: "SIGNED_OUT" }); }} />
    </React.Suspense>;
  }

  // Auth gate: when Supabase is configured, require sign-in (demo escape hatch stays).
  if (supabaseEnabled && (auth.loading || (auth.session && !state.userId && !bypass))) {
    return <div style={{ minHeight: "100vh", background: C.night, color: C.mist, fontFamily: FB,
      display: "grid", placeItems: "center" }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", border: `3px solid ${C.line}`,
        borderTopColor: C.amber, animation: "spin .7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>;
  }
  // Marketing homepage: the public front door for anyone not signed in yet.
  if (!auth.session && !bypass && !entered) {
    return <>{SkipButton}<Landing onStart={() => setEntered(true)} onLegal={setLegalDoc} />
      {legalDoc && <LegalReader docId={legalDoc} onClose={() => setLegalDoc(null)} />}</>;
  }

  if (supabaseEnabled && !auth.session && !bypass) {
    return <>{SkipButton}<AuthScreen auth={auth} onDemo={DEMO_OK ? () => setBypass(true) : undefined} initialRole={DRIVE_INTENT ? "driver" : "customer"} /></>;
  }

  return (
    <StoreCtx.Provider value={store}>
      {inSetup && SkipButton}
      <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB, display: "flex", justifyContent: "center" }}>
        <style>{`
          *{box-sizing:border-box;-webkit-font-smoothing:antialiased} button{font-family:inherit} input{font-family:inherit}
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
          @keyframes draw{to{stroke-dashoffset:0}}
          @keyframes ring{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1);opacity:1}}
          @keyframes fall{to{transform:translateY(210px)}}
          @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
          @media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
        `}</style>

        <div style={{ width: "100%", maxWidth: 440, minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative",
          background: isLight ? C.night : `radial-gradient(90% 38% at 100% 0%, ${C.amber}12, transparent 70%), radial-gradient(80% 40% at 0% 100%, #0E1A2B, transparent 70%), ${C.night}` }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: `calc(${S.md}px + env(safe-area-inset-top)) ${S.xl}px ${S.md}px`, position: "sticky", top: 0, zIndex: 30,
            background: C.glass, backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)",
            borderBottom: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: C.amber, color: C.onAmber,
                display: "grid", placeItems: "center" }}><Icon e="snowflake" s={17} /></div>
              <div>
                <div style={{ font: `900 25px/1 ${FD}`, textTransform: "uppercase", letterSpacing: ".06em", color: C.ice }}>DRIFT</div>
                <div style={{ font: `500 10px ${FM}`, letterSpacing: ".08em", textTransform: "uppercase", color: C.mistDim, marginTop: 3 }}>
                  {state.role === "driver" && !inSetup ? "Driver · Duluth, MN" : "Duluth, MN"}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* During signup only: a quiet link for people who meant to drive (or meant to order). */}
              {inSetup && (
                <button onClick={() => dispatch({ type: "ROLE", role: onboarding ? "driver" : "rider" })}
                  style={{ background: "none", border: "none", cursor: "pointer", font: `600 13px ${FB}`, color: C.mist,
                    padding: "8px 4px", WebkitTapHighlightColor: "transparent" }}>
                  {onboarding ? "Drive with DRIFT" : "I need a plow"}</button>
              )}
              <Bell count={unreadCount(state)} onClick={() => setNotifOpen(true)} />
            </div>
          </header>

          <OfflineBanner />

          {/* Demo-only hint (hidden once real accounts are on) */}
          {state.order && !inSetup && !supabaseEnabled && (
            <div style={{ margin: "10px 20px 0", background: C.slate, border: `1px solid ${C.line}`, borderRadius: 10,
              padding: "8px 12px", font: `500 13px ${FB}`, color: C.mist, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.amber }} />
              Demo: this job is live on both sides — switch views from Account.
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

export default function App({ startEntered }) { return <Shell startEntered={startEntered} />; }
