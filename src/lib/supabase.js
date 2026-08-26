// Supabase client. Reads public keys from env; stays null (and the app runs
// in local demo mode) until VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(url && anon);
export const supabase = supabaseEnabled ? createClient(url, anon) : null;
