// Quick price estimate for the homepage + city pages (no map outline yet).
// MIRRORS the driveway math in src/App.jsx (JOB_TYPES.driveway + quoteJob +
// OFFER_TIERS + fees). If you change pricing there, change it here too, then
// re-run `node scripts/seo-pages.mjs` so the city pages show the new prices.
export const EST = {
  base: 25, rate: 0.035, kneePrice: 50, rateAfterKnee: 0.0175, minTotal: 30,
  calloutFee: 10, driftFee: 5, offerMin: 10, recommended: 1.15,
};

// Typical driveway sizes (plowed area, sq ft) people can pick without a map.
export const SIZES = [
  { id: "one", label: "1-car", hint: "Short, one car wide", sqft: 400 },
  { id: "two", label: "2-car", hint: "The usual Duluth driveway", sqft: 650 },
  { id: "long", label: "Long", hint: "Long or extra wide", sqft: 1000 },
  { id: "big", label: "Huge", hint: "Big, shared or rural", sqft: 1600 },
];

// Recommended total the customer pays for a flat driveway of this size.
export function estimateTotal(sqft, mult = 1) {
  const knee = (EST.kneePrice - EST.base) / EST.rate;
  const plow = EST.base + Math.min(sqft, knee) * EST.rate + Math.max(0, sqft - knee) * EST.rateAfterKnee;
  return fromJobPrice(plow * mult);
}

// Other job types (same fee math): sidewalks $15 + 35¢/ft, car dig-out $45 flat, jump-start $40 flat.
export const sidewalkPrice = (ft) => fromJobPrice(15 + ft * 0.35);
export const digoutPrice = () => fromJobPrice(45);
export const jumpstartPrice = () => fromJobPrice(40);

function fromJobPrice(jobPrice) {
  const core = Math.max(EST.minTotal, jobPrice);
  const standard = Math.max(EST.offerMin, Math.round(core) - (EST.calloutFee + EST.driftFee - 10));
  const offer = Math.max(EST.offerMin, Math.round(standard * EST.recommended));
  const fees = EST.calloutFee + EST.driftFee;
  return { offer, total: offer + fees, standardOffer: standard, standardTotal: standard + fees };
}

// "$49–$54": the app's Standard → Recommended suggestion for a flat driveway,
// total including the $10 call-out and $5 booking fee. Hills cost a little more.
export function estimateRange(sqft) {
  const e = estimateTotal(sqft, 1);
  return { lo: e.standardTotal, hi: e.total, text: `$${e.standardTotal}–$${e.total}` };
}
