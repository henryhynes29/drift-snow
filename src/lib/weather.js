// Weather provider for DRIFT.
//
// Right now this returns a fixed demo storm so the app is predictable. When you
// wire a real feed (OpenWeather, NWS, Tomorrow.io), you only change the ONE
// function `fetchLiveConditions` below — everything else in the app already
// reads through these helpers, so pricing, the storm surcharge, the emergency
// banner, and auto-plow all go live at once.
//
// To go live: set VITE_WEATHER_API_KEY in Vercel and fill in fetchLiveConditions.

const KEY = import.meta.env.VITE_WEATHER_API_KEY || "";
export const WEATHER_LIVE = !!KEY;

// Duluth, MN — the launch market. Swap per-market later.
export const MARKET = { name: "Duluth, MN", lat: 46.7867, lng: -92.1005 };

// The demo storm the app shows until a real feed is connected.
const DEMO = {
  depthNow: 7,                    // inches on the ground now (drives the surcharge)
  forecast: { low: 3, high: 5, when: "Friday night" }, // next incoming storm
  updatedAt: "just now",
};

// Snapshot the rest of the app reads from. Synchronous + cached so pricing never
// blocks on a network call; refreshConditions() updates it in the background.
let _conditions = { ...DEMO };

export function currentConditions() { return _conditions; }
export function snowDepthNow() { return _conditions.depthNow; }
export function nextStorm() { return _conditions.forecast; }

// Swap the body of this for a real API call. Must resolve to the shape of DEMO.
async function fetchLiveConditions() {
  if (!WEATHER_LIVE) return { ...DEMO };
  // TODO (real feed), e.g. OpenWeather One Call:
  //   const r = await fetch(`https://api.openweathermap.org/data/3.0/onecall?lat=${MARKET.lat}&lon=${MARKET.lng}&appid=${KEY}&units=imperial`);
  //   const j = await r.json();
  //   return { depthNow: deriveDepthFromSnowfall(j), forecast: deriveNextStorm(j), updatedAt: new Date().toLocaleTimeString() };
  return { ...DEMO };
}

// Call once on app start (and on an interval later) to keep conditions fresh.
export async function refreshConditions() {
  try { _conditions = await fetchLiveConditions(); } catch { /* keep last good snapshot */ }
  return _conditions;
}
