// GET /api/weather — expected new snow for Duluth from the National Weather
// Service. Public (no sign-in); cached for 20 minutes so we don't hammer NWS.
import { send } from "./_lib.js";
import { forecastSnow, rangeText } from "./_weather.js";

export default async function handler(req, res) {
  try {
    const f = await forecastSnow();
    res.setHeader("Cache-Control", "public, s-maxage=1200, stale-while-revalidate=3600");
    return send(res, 200, { ...f, range24: f.next24 >= 1 ? rangeText(f.next24) : null });
  } catch (e) {
    console.error("[weather]", e.message);
    return send(res, 200, { next12: 0, next24: 0, next36: 0, unavailable: true });
  }
}
