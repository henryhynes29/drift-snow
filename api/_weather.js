// Snow forecast from the National Weather Service (free, no API key) and the
// daily snow alert. Files starting with "_" are helpers, not web addresses.
//
//   forecastSnow()  -> { next12, next24, next36 } inches of new snow expected
//   snowCheck()     -> sends ONE alert per day to customers (and drivers) when
//                      a storm is coming. Runs from the daily Vercel cron.
import { admin, pushTo } from "./_lib.js";

export const MARKET = { name: "Duluth", lat: 46.7867, lng: -92.1005 };
const UA = { "User-Agent": "DRIFT snow app (support@driftplowing.com)", Accept: "application/geo+json" };
const ALERT_MIN_INCHES = Number(process.env.SNOW_ALERT_MIN_INCHES || 2);

// ISO-8601 duration like PT6H, P1D, P1DT12H -> milliseconds
export function durationMs(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d || "");
  if (!m) return 0;
  return ((+m[1] || 0) * 24 * 60 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 60 * 1000;
}

// Add up NWS snowfallAmount values (mm) that fall inside [from, to], counting
// partial overlaps proportionally. Returns inches.
export function sumSnow(values, from, to, unit = "wmoUnit:mm") {
  let mm = 0;
  for (const v of values || []) {
    if (v.value == null) continue;
    const [startStr, dur] = String(v.validTime).split("/");
    const start = Date.parse(startStr), end = start + durationMs(dur);
    if (!(end > start)) continue;
    const overlap = Math.max(0, Math.min(end, to) - Math.max(start, from));
    if (overlap > 0) mm += v.value * (overlap / (end - start));
  }
  const inches = /mm$/.test(unit) ? mm / 25.4 : /cm$/.test(unit) ? mm / 2.54 : mm; // m unit is rare; treat as-is otherwise
  return Math.round(inches * 10) / 10;
}

let cache = null; // { at, data }
export async function forecastSnow({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 20 * 60 * 1000) return cache.data;
  const pt = await fetch(`https://api.weather.gov/points/${MARKET.lat},${MARKET.lng}`, { headers: UA });
  if (!pt.ok) throw new Error(`NWS points ${pt.status}`);
  const grid = (await pt.json()).properties?.forecastGridData;
  if (!grid) throw new Error("NWS: no grid");
  const g = await fetch(grid, { headers: UA });
  if (!g.ok) throw new Error(`NWS grid ${g.status}`);
  const snow = (await g.json()).properties?.snowfallAmount || {};
  const now = Date.now(), h = 3600 * 1000;
  const data = {
    market: MARKET.name,
    next12: sumSnow(snow.values, now, now + 12 * h, snow.uom),
    next24: sumSnow(snow.values, now, now + 24 * h, snow.uom),
    next36: sumSnow(snow.values, now, now + 36 * h, snow.uom),
    updatedAt: new Date().toISOString(),
  };
  cache = { at: now, data };
  return data;
}

// "3–5 in" style range around a point forecast
export function rangeText(inches) {
  const lo = Math.max(1, Math.floor(inches * 0.8)), hi = Math.max(lo + 1, Math.ceil(inches * 1.2));
  return `${lo}–${hi}"`;
}

// Daily: if a real storm is coming in the next 24 hours, tell customers (who
// haven't turned alerts off) and drivers — at most once per day.
export async function snowCheck({ force = false } = {}) {
  if (!admin) return { skipped: "no database" };
  const f = await forecastSnow({ fresh: true });
  if (!force && f.next24 < ALERT_MIN_INCHES) return { forecast: f, sent: 0, reason: "not enough snow" };
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD in Duluth
  const { data: claimed, error } = await admin.from("snow_alerts").insert({ day, inches: f.next24 }).select("day");
  if (error?.code === "23505") return { forecast: f, sent: 0, reason: "already alerted today" };
  if (error || !claimed?.length) throw new Error(`snow_alerts: ${error?.message || "insert failed"}`);
  const r = await sendSnowAlert({
    customers: { title: `Snow's coming · ${rangeText(f.next24)} expected`,
      body: "Book your plow now to get in line before the rush. You only pay once it's done." },
    drivers: { title: `Busy night ahead · ${rangeText(f.next24)} of snow`,
      body: "Customers will be booking. Go online in DRIFT when it starts to pile up." },
  });
  await admin.from("snow_alerts").update({ sent: r.customers + r.drivers }).eq("day", day);
  return { forecast: f, ...r };
}

// Send an alert to customers and/or drivers. Used by the daily check and by the
// owner dashboard's "Send snow alert" button.
export async function sendSnowAlert({ customers, drivers }) {
  let c = 0, d = 0;
  if (customers) {
    const { data } = await admin.from("profiles").select("id").eq("is_driver", false).eq("snow_alerts", true);
    c = await pushTo((data || []).map((p) => p.id), { ...customers, tag: "snow", url: "/", sticky: false },
      { ttl: 6 * 3600, urgency: "normal" });
  }
  if (drivers) {
    const { data } = await admin.from("profiles").select("id").eq("is_driver", true).eq("suspended", false);
    d = await pushTo((data || []).map((p) => p.id), { ...drivers, tag: "snow-driver", url: "/", sticky: false },
      { ttl: 6 * 3600, urgency: "normal" });
  }
  return { customers: c, drivers: d };
}
