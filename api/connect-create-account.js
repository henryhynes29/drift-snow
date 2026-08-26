// POST /api/connect-create-account
// Creates a Stripe Connect (Express) account for a driver and returns a hosted
// onboarding link where they enter bank + tax info. Needs STRIPE_SECRET_KEY.
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Stripe not configured yet" });
  try {
    const { driverId, email, returnUrl } = req.body || {};

    const account = await stripe.accounts.create({
      type: "express",
      email,
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
      metadata: { driverId: driverId || "" },
    });

    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: returnUrl || "https://your-app.vercel.app/driver/payouts",
      return_url: returnUrl || "https://your-app.vercel.app/driver/payouts?onboarded=1",
      type: "account_onboarding",
    });

    // TODO: save account.id onto the driver's profile (profiles.stripe_account_id)
    res.status(200).json({ accountId: account.id, onboardingUrl: link.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
