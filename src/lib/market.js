// Demand-based surge for DRIFT.
//
// Price rises when many customers need a plow and few drivers are out — the same
// supply/demand model rideshare uses. This is the honest reason a price moves:
// scarcity, not snow depth. It's ALWAYS disclosed as a line item, never hidden.
//
// Today this runs on a mock market snapshot so the demo is predictable. To go
// live, feed refreshMarket() the real counts from Supabase:
//   - activeRequests: open/unassigned jobs in the area right now
//   - driversOnline: drivers currently online and available
// Everything else (pricing, the surge line, the driver's 75% share) already reads
// through these helpers, so it goes live the moment those two numbers are real.

export const SURGE = {
  driverShare: 0.75, // of the surge, the driver keeps 75% (it pulls supply); 25% to the platform
  startRatio: 1.1,   // no surge until demand-per-driver passes this
  perRatio: 0.15,    // each unit of demand/driver above that adds 15%
  cap: 0.35,         // never more than +35%
};

// Mock snapshot: 9 people waiting, 4 plows out → busy. Swap for live counts.
const DEMO = { activeRequests: 9, driversOnline: 4 };
let _m = { ...DEMO };

export function marketSnapshot() { return _m; }
export function demandRatio() {
  const { activeRequests, driversOnline } = _m;
  if (driversOnline > 0) return activeRequests / driversOnline;
  return activeRequests > 0 ? SURGE.cap / SURGE.perRatio + SURGE.startRatio : 0; // no drivers = max surge
}

// Current surge as a fraction (0 = none, .20 = +20%).
export function surgePct() {
  const r = demandRatio();
  if (r <= SURGE.startRatio) return 0;
  return Math.min(SURGE.cap, +((r - SURGE.startRatio) * SURGE.perRatio).toFixed(2));
}

// Short, human label for the disclosed surge line.
export function surgeLabel() {
  const r = demandRatio();
  if (r <= SURGE.startRatio) return "";
  if (r >= 2.6) return "Very high demand";
  if (r >= 1.8) return "High demand";
  return "Busy right now";
}

// Refresh the snapshot (no-op with demo data; wire to live Supabase counts later).
export async function refreshMarket(counts) {
  if (counts && typeof counts.activeRequests === "number" && typeof counts.driversOnline === "number") {
    _m = { activeRequests: counts.activeRequests, driversOnline: counts.driversOnline };
  }
  return _m;
}
