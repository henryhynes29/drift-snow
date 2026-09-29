// Data helpers for DRIFT — thin wrappers over Supabase.
// Each returns a friendly shape and is a safe no-op when Supabase isn't set up,
// so callers can be wired in gradually without breaking the demo.
import { supabase, supabaseEnabled } from "./supabase.js";

const isUuid = (v) => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const off = () => ({ data: null, error: { message: "Supabase not configured" } });

// ---------- Properties ----------
export async function getMyProperties(ownerId) {
  if (!supabaseEnabled) return off();
  return supabase.from("properties").select("*").eq("owner_id", ownerId).order("created_at");
}
export async function saveProperty(p) {
  if (!supabaseEnabled) return off();
  return supabase.from("properties").upsert(p).select().single();
}
export async function setAutoPlow(propertyId, on, thresholdInches) {
  if (!supabaseEnabled) return off();
  return supabase.from("properties")
    .update({ auto_plow: on, auto_plow_threshold: thresholdInches })
    .eq("id", propertyId);
}

// ---- map between the app's property shape and DB columns ----
function toPropRow(p, ownerId) {
  return {
    ...(isUuid(p.id) ? { id: p.id } : {}),   // keep saved properties' ids stable across saves
    owner_id: ownerId,
    label: p.label || "Home",
    address: p.addr || null,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    center: p.center || null,
    features: p.features || [],
    sqft: p.sqft || 0,
    grade: p.grade || "flat",
    hazards: p.hazards || [],
    shared: !!p.shared,
    map_img: p.mapImg || null,
    instructions: p.instructions || null,
    zones: p.zones || [],
    size: p.size || null,
  };
}
export function fromPropRow(r) {
  return {
    id: r.id,
    label: r.label,
    addr: r.address,
    lat: r.lat, lng: r.lng,
    center: r.center,
    features: r.features || [],
    sqft: r.sqft || 0,
    grade: r.grade || "flat",
    hazards: r.hazards || [],
    shared: !!r.shared,
    mapImg: r.map_img,
    instructions: r.instructions,
    zones: r.zones || [],
    size: r.size || null,
  };
}

// Load a user's properties, mapped to the app's shape.
export async function loadProperties(userId) {
  if (!supabaseEnabled || !userId) return { data: [] };
  const { data, error } = await supabase.from("properties")
    .select("*").eq("owner_id", userId).order("created_at");
  return { data: (data || []).map(fromPropRow), error };
}

// Replace-all: the simplest robust persistence for a small property set.
export async function replaceProperties(userId, appProps) {
  if (!supabaseEnabled || !userId) return { data: [] };
  await supabase.from("properties").delete().eq("owner_id", userId);
  const rows = (appProps || []).map((p) => toPropRow(p, userId));
  if (!rows.length) return { data: [] };
  const { data, error } = await supabase.from("properties").insert(rows).select();
  return { data: (data || []).map(fromPropRow), error };
}

// ---------- Jobs ----------

export async function createJob(job) {
  if (!supabaseEnabled) return off();
  return supabase.from("jobs").insert(job).select().single();
}
export async function updateJob(id, patch) {
  if (!supabaseEnabled) return off();
  return supabase.from("jobs").update(patch).eq("id", id).select().single();
}

// Map an in-app order to a jobs row and insert it.
// We only send the customer's OFFER — the database computes the total, the
// driver's pay and DRIFT's fee itself (see supabase/dispatch.sql), so a
// tampered phone can't change what anyone pays or earns.
// Also sends a snapshot of the property so drivers can see what they'd accept.
export async function createJobFromOrder(order, customerId) {
  if (!supabaseEnabled || !customerId) return { data: null };
  const q = order?.quote || {};
  const p = order?.property || {};
  const center = p.center || (typeof p.lat === "number" ? { lat: p.lat, lng: p.lng } : null);
  const row = {
    property_id: null,            // the job carries its own snapshot of the property (site) instead
    customer_id: customerId,
    job_type: order?.jobType || "driveway",
    tool: order?.tool || q.tool || null,
    salt: !!q.salt,
    instructions: p.instructions || null,
    quote: q,
    offer: q.offer ?? q.baseAmount ?? null,
    address: p.addr || null,
    lat: center?.lat ?? null,
    lng: center?.lng ?? null,
    site: {
      label: p.label || null, center, features: p.features || [], zones: p.zones || [],
      hazards: p.hazards || [], grade: p.grade || "flat", mapImg: p.mapImg || null,
      sqft: p.sqft || 0, size: order?.size || null, emergency: !!order?.emergency,
    },
    eta_minutes: order?.eta ?? null,
  };
  try { return await supabase.from("jobs").insert(row).select().single(); }
  catch (e) { return { error: e }; }
}

// ---------- Live dispatch ----------
// Turn a jobs row back into the app's order shape (used by both sides).
export function rowToOrder(r, driver) {
  const site = r.site || {};
  const statusToState = { requested: "requested", accepted: "accepted", enroute: "enroute",
    plowing: "plowing", completed: "arrived_done", cancelled: "cancelled", expired: "expired" };
  const quote = { ...(r.quote || {}), offer: Number(r.offer), baseAmount: Number(r.offer),
    calloutFee: Number(r.callout_fee), driftFee: Number(r.drift_fee),
    riderTotal: Number(r.price), driverPay: Number(r.driver_pay) };
  return {
    id: r.id, jobId: r.id, state: statusToState[r.status] || r.status,
    jobType: r.job_type, tool: r.tool, quote,
    size: site.size || r.quote?.size || null,
    property: { id: r.property_id, label: site.label, addr: r.address, center: site.center,
      lat: r.lat, lng: r.lng, features: site.features || [], zones: site.zones || [],
      hazards: site.hazards || [], grade: site.grade || "flat", mapImg: site.mapImg || null,
      sqft: site.sqft || 0, instructions: r.instructions },
    emergency: !!site.emergency,
    customerId: r.customer_id, driverId: r.driver_id || null,
    driver: driver || null,
    createdAt: new Date(r.created_at).getTime(),
    expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null,
    eta: r.eta_minutes, photos: r.photos || { before: [], after: [] },
    paymentStatus: r.payment_status || "not_required", payoutStatus: r.payout_status || "none",
    timeline: [{ k: "requested", t: "now", label: "Request sent" }],
    live: true,
  };
}

export async function fetchJob(jobId) {
  if (!supabaseEnabled || !isUuid(jobId)) return { data: null };
  return supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
}

// The open-job pool a driver sees while online (the database only returns
// jobs nobody has taken yet that haven't expired, and only to drivers).
export async function listOpenJobs() {
  if (!supabaseEnabled) return { data: [] };
  const { data, error } = await supabase.from("jobs").select("*")
    .eq("status", "requested").is("driver_id", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true }).limit(25);
  return { data: data || [], error };
}

// Calls back whenever the jobs table changes in a way this driver can see.
// Also re-checks every 15s, because taken/expired jobs vanish silently.
export function subscribeOpenJobs(onChange) {
  if (!supabaseEnabled) return () => {};
  const ch = supabase.channel("open-jobs-" + Math.random().toString(36).slice(2))
    .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => onChange())
    .subscribe();
  const iv = setInterval(onChange, 15000);
  return () => { clearInterval(iv); supabase.removeChannel(ch); };
}

// First tap wins. Returns { data: jobId } if you got it, { data: null } if
// another driver got there first or it expired.
export async function claimJob(jobId) {
  if (!supabaseEnabled || !isUuid(jobId)) return { data: null };
  return supabase.rpc("claim_job", { p_job: jobId });
}

export async function getProfile(userId) {
  if (!supabaseEnabled || !isUuid(userId)) return { data: null };
  return supabase.from("profiles").select("id, name, truck, tools, rating, jobs_count, tier").eq("id", userId).maybeSingle();
}
// Profile row -> the driver card the customer sees.
export function profileToDriver(p) {
  if (!p) return null;
  return { id: p.id, name: p.name || "Your driver", truck: p.truck || "Plow truck",
    tools: p.tools || [], rating: Number(p.rating || 5).toFixed(1), jobs: p.jobs_count || 0, tier: p.tier || "" };
}

// Switch a driver online/offline (and mark them as a driver after they sign the
// contractor agreement). The database refuses is_driver without a signed agreement.
export async function setDriverStatus(userId, patch) {
  if (!supabaseEnabled || !isUuid(userId)) return { data: null };
  return supabase.from("profiles").update(patch).eq("id", userId);
}
export async function becomeDriver(userId, { name, phone, truck, tools }, legalRec) {
  if (!supabaseEnabled || !isUuid(userId)) return { data: null };
  const patch = { is_driver: true, role: "driver", truck: truck || null, tools: tools || [] };
  if (name) patch.name = name;
  if (phone) patch.phone = phone;
  let res = await setDriverStatus(userId, patch);
  if (res?.error && legalRec) {           // agreement row not saved yet — save it, then retry
    await recordLegalAcceptance(userId, legalRec);
    res = await setDriverStatus(userId, patch);
  }
  return res;
}

// The job you're in the middle of (customer or driver) — so a refresh or a
// dead phone battery doesn't lose it.
export async function loadActiveJob(userId) {
  if (!supabaseEnabled || !isUuid(userId)) return { data: null };
  const { data } = await supabase.from("jobs").select("*")
    .or(`customer_id.eq.${userId},driver_id.eq.${userId}`)
    .in("status", ["requested", "accepted", "enroute", "plowing"])
    .order("created_at", { ascending: false }).limit(5);
  const now = Date.now();
  const live = (data || []).find(r => r.status !== "requested" || (r.customer_id === userId && new Date(r.expires_at).getTime() > now));
  return { data: live || null };
}

export async function cancelJob(jobId) { return patchJob(jobId, { status: "cancelled" }); }
export async function expireJob(jobId) {
  if (!supabaseEnabled || !isUuid(jobId)) return { data: null };
  return supabase.from("jobs").update({ status: "expired" }).eq("id", jobId).eq("status", "requested");
}

// Patch a persisted job by id (no-op unless it's a real Supabase uuid).
export async function patchJob(jobId, patch) {
  if (!supabaseEnabled || !isUuid(jobId)) return { data: null };
  try { return await updateJob(jobId, patch); }
  catch (e) { return { error: e }; }
}
export async function openJobs() {
  // the dispatch pool a driver sees when online
  if (!supabaseEnabled) return off();
  return supabase.from("jobs").select("*, properties(*)")
    .is("driver_id", null).eq("status", "requested").order("created_at");
}
export async function myJobs(userId) {
  if (!supabaseEnabled) return off();
  return supabase.from("jobs").select("*, properties(*)")
    .or(`customer_id.eq.${userId},driver_id.eq.${userId}`).order("created_at", { ascending: false });
}
// live updates for a single job (status changes, driver position, etc.)
export function subscribeToJob(jobId, onChange) {
  if (!supabaseEnabled) return () => {};
  const ch = supabase.channel(`job:${jobId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        (payload) => onChange(payload.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---------- Messages ----------
export async function sendMessage(jobId, senderId, body) {
  if (!supabaseEnabled) return off();
  return supabase.from("messages").insert({ job_id: jobId, sender_id: senderId, body });
}
export async function loadMessages(jobId) {
  if (!supabaseEnabled || !isUuid(jobId)) return { data: [] };
  const { data } = await supabase.from("messages").select("*").eq("job_id", jobId).order("created_at");
  return { data: data || [] };
}
export function subscribeToMessages(jobId, onMessage) {
  if (!supabaseEnabled) return () => {};
  const ch = supabase.channel(`msgs:${jobId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `job_id=eq.${jobId}` },
        (payload) => onMessage(payload.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---------- Driver location (live tracking) ----------
export async function pushDriverLocation(driverId, lng, lat, heading) {
  if (!supabaseEnabled) return off();
  return supabase.from("driver_locations")
    .upsert({ driver_id: driverId, lng, lat, heading, updated_at: new Date().toISOString() });
}
export function subscribeToDriverLocation(driverId, onMove) {
  if (!supabaseEnabled) return () => {};
  const ch = supabase.channel(`loc:${driverId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "driver_locations", filter: `driver_id=eq.${driverId}` },
        (payload) => onMove(payload.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ---------- Ratings ----------
export async function rateJob({ jobId, raterId, rateeId, stars, comment }) {
  if (!supabaseEnabled) return off();
  return supabase.from("ratings").insert({ job_id: jobId, rater_id: raterId, ratee_id: rateeId, stars, comment });
}

// ---------- Legal: signed agreements (your proof of consent) ----------
// One row per acceptance: who, which documents, which version, when, and from
// what device. Never updated or deleted by the app. See supabase/legal_acceptances.sql.
export async function recordLegalAcceptance(userId, rec) {
  if (!supabaseEnabled || !userId || !rec) return off();
  return supabase.from("legal_acceptances").insert({
    user_id: userId,
    role: rec.role,
    documents: rec.docs,
    version: rec.version,
    accepted_at: rec.at,
    user_agent: rec.ua || null,
  });
}

// ---------- Account settings ----------
// Name / phone (and, for drivers, truck + equipment). Money and verification
// fields are protected by the database and can't be changed from here.
export async function updateMyProfile(userId, patch) {
  if (!supabaseEnabled || !isUuid(userId)) return { data: null };
  const allowed = {};
  for (const k of ["name", "phone", "truck", "tools"]) if (k in patch) allowed[k] = patch[k];
  return supabase.from("profiles").update(allowed).eq("id", userId);
}
