// Auth layer for DRIFT.
// Wraps Supabase Auth in a React context. If Supabase isn't configured yet,
// every method is a safe no-op and `isConfigured` is false, so the existing
// demo app keeps working untouched.
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase, supabaseEnabled } from "./supabase.js";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(supabaseEnabled);

  const loadProfile = useCallback(async (userId) => {
    if (!supabaseEnabled || !userId) { setProfile(null); return; }
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data || null);
  }, []);

  useEffect(() => {
    if (!supabaseEnabled) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session?.user?.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      loadProfile(s?.user?.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // --- actions (all no-op safely when not configured) ---
  const signUp = async ({ email, password, name, phone, role = "customer" }) => {
    if (!supabaseEnabled) return { error: notConfigured() };
    return supabase.auth.signUp({ email, password, options: { data: { name, phone, role } } });
  };
  const signIn = async ({ email, password }) => {
    if (!supabaseEnabled) return { error: notConfigured() };
    return supabase.auth.signInWithPassword({ email, password });
  };
  // passwordless phone OTP (uses Twilio behind Supabase once you enable phone auth)
  const sendPhoneOtp = async (phone) => {
    if (!supabaseEnabled) return { error: notConfigured() };
    return supabase.auth.signInWithOtp({ phone });
  };
  const verifyPhoneOtp = async (phone, token) => {
    if (!supabaseEnabled) return { error: notConfigured() };
    return supabase.auth.verifyOtp({ phone, token, type: "sms" });
  };
  const signOut = async () => {
    if (!supabaseEnabled) return;
    await supabase.auth.signOut();
    setProfile(null);
  };
  const refreshProfile = () => loadProfile(session?.user?.id);

  const value = {
    isConfigured: supabaseEnabled,
    loading,
    session,
    user: session?.user || null,
    profile,
    role: profile?.role || null,
    signUp, signIn, sendPhoneOtp, verifyPhoneOtp, signOut, refreshProfile,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

function notConfigured() {
  return { message: "Supabase isn't configured yet — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." };
}
