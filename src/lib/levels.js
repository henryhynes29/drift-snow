// Driver levels — same rules as driverLevel() in api/_lib.js (the server decides perks).
//   Rookie -> Pro:   5 jobs, 4.5★ or better
//   Pro    -> Elite: 20 jobs, 4.8★ or better (5+ ratings), at most 1 late cancel
export const LEVELS = {
  rookie: { id: "rookie", label: "Rookie", perk: "Every new job alert in your zone." },
  pro: { id: "pro", label: "Pro", perk: "A Pro badge customers see on your profile." },
  elite: { id: "elite", label: "Elite", perk: "First look at new jobs in your zone: a 1-minute head start before other drivers." },
};

export function driverLevel(p) {
  const jobs = Number(p?.jobsCount ?? p?.jobs_count ?? 0), rating = Number(p?.rating || 0);
  const rated = Number(p?.ratingsCount ?? p?.ratings_count ?? 0), late = Number(p?.lateCancels ?? p?.late_cancels ?? 0);
  const ratingOk = (min) => rated === 0 || rating >= min;
  if (jobs >= 20 && rated >= 5 && rating >= 4.8 && late <= 1) return "elite";
  if (jobs >= 5 && ratingOk(4.5)) return "pro";
  return "rookie";
}

// What's left to reach the next level, as short checklist items.
export function nextLevel(p) {
  const lvl = driverLevel(p);
  if (lvl === "elite") return null;
  const jobs = Number(p?.jobsCount ?? p?.jobs_count ?? 0), rating = Number(p?.rating || 0);
  const rated = Number(p?.ratingsCount ?? p?.ratings_count ?? 0), late = Number(p?.lateCancels ?? p?.late_cancels ?? 0);
  if (lvl === "rookie") {
    return { to: "pro", progress: Math.min(1, jobs / 5), items: [
      { done: jobs >= 5, text: `Finish 5 jobs (${Math.min(jobs, 5)}/5)` },
      { done: rated === 0 || rating >= 4.5, text: "Keep a 4.5★ rating or better" },
    ] };
  }
  return { to: "elite", progress: Math.min(1, jobs / 20), items: [
    { done: jobs >= 20, text: `Finish 20 jobs (${Math.min(jobs, 20)}/20)` },
    { done: rated >= 5 && rating >= 4.8, text: rated >= 5 ? `Keep a 4.8★ rating (now ${rating.toFixed(1)})` : `Get 5 ratings at 4.8★+ (${rated}/5)` },
    { done: late <= 1, text: "No more than 1 late cancel" },
  ] };
}

// IRS business standard mileage rate (estimate for the driver's tax summary).
// 2026: 72.5¢ Jan 1–Jun 30, raised to 76¢ from Jul 1. Later years use the latest known rate.
export function mileageRate(date) {
  const d = new Date(date);
  if (d < new Date("2026-07-01T00:00:00")) return 0.725;
  return 0.76;
}
