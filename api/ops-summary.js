// GET /api/ops-summary
// Operator/admin view of today's activity. Uses the Supabase SERVICE ROLE key
// (server-only) to read across ALL jobs, bypassing row-level security — so this
// must never be exposed with the public anon key. Returns KPIs + recent jobs.
//
// Needs SUPABASE_SERVICE_ROLE_KEY and the project URL (VITE_SUPABASE_URL is fine —
// Vercel exposes all env vars to serverless functions regardless of prefix).
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (!URL || !KEY) return res.status(503).json({ error: "Supabase admin not configured" });
  const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { data: jobs, error } = await supabase
      .from("jobs").select("*")
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = jobs || [];
    const active = rows.filter(j => ["requested", "accepted", "enroute", "plowing"].includes(j.status));
    const done = rows.filter(j => j.status === "completed");
    const num = (v) => Number(v || 0);
    const kpis = {
      jobsToday: rows.length,
      activeNow: active.length,
      completedToday: done.length,
      revenueToday: done.reduce((s, j) => s + num(j.price), 0),
      payoutsToday: done.reduce((s, j) => s + num(j.driver_pay), 0),
      platformToday: done.reduce((s, j) => s + num(j.platform_fee), 0),
      tipsToday: done.reduce((s, j) => s + num(j.tip), 0),
    };

    // Count distinct drivers seen today + those currently assigned to active jobs.
    const activeDrivers = new Set(active.map(j => j.driver_id).filter(Boolean)).size;

    res.status(200).json({ kpis, activeDrivers, jobs: rows.slice(0, 40) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
