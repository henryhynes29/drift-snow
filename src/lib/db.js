// Data helpers for DRIFT — thin wrappers over Supabase.
// Each returns a friendly shape and is a safe no-op when Supabase isn't set up,
// so callers can be wired in gradually without breaking the demo.
import { supabase, supabaseEnabled } from "./supabase.js";

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
    zones: [],
    size: null,
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
const isUuid = (v) => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function createJob(job) {
  if (!supabaseEnabled) return off();
  return supabase.from("jobs").insert(job).select().single();
}
export async function updateJob(id, patch) {
  if (!supabaseEnabled) return off();
  return supabase.from("jobs").update(patch).eq("id", id).select().single();
}

// Map an in-app order to a jobs row and insert it. Best-effort + non-blocking:
// returns { data: { id } } on success, or a soft failure the caller can ignore.
export async function createJobFromOrder(order, customerId) {
  if (!supabaseEnabled || !customerId) return { data: null };
  const q = order?.quote || {};
  const row = {
    property_id: isUuid(order?.property?.id) ? order.property.id : null,
    customer_id: customerId,
    job_type: order?.jobType || "driveway",
    status: "requested",
    tool: order?.tool || q.tool || null,
    salt: !!q.salt,
    instructions: order?.property?.instructions || null,
    quote: q,
    price: q.riderTotal ?? null,
    driver_pay: q.driverPay ?? null,
    platform_fee: q.platformNet ?? null,
    eta_minutes: order?.eta ?? null,
  };
  try { return await createJob(row); }
  catch (e) { return { error: e }; }
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
