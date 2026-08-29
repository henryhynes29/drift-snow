// POST /api/driver-signup
// Captures a driver-recruiting lead from the public /drive.html page and stores
// it in Supabase (driver_applications). Uses the service role key so the public
// page never needs database credentials. Safe no-op response if unconfigured, so
// the page's success state still works while you're setting things up.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const b = req.body || {};
    const name = (b.name || "").toString().trim();
    const phone = (b.phone || "").toString().trim();
    if (!name || !phone) return res.status(400).json({ error: "Name and phone are required" });

    const row = {
      name,
      phone,
      email: (b.email || "").toString().trim() || null,
      area: (b.area || "").toString().trim() || null,
      equipment: Array.isArray(b.equipment) ? b.equipment.join(", ") : (b.equipment || null),
      experience: (b.experience || "").toString().trim() || null,
      status: "new",
    };

    // No DB yet? Still return success so the lead isn't lost to a broken form.
    if (!URL || !KEY) {
      console.log("[driver-signup] (no DB configured) lead:", row);
      return res.status(200).json({ ok: true, stored: false });
    }

    const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
    const { error } = await supabase.from("driver_applications").insert(row);
    if (error) throw error;

    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
