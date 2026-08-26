// POST /api/create-payment-intent
// Authorizes a card for a job now, captured when the job is marked complete
// ("no storm, no charge"). Needs STRIPE_SECRET_KEY (server-only Vercel env var).
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Stripe not configured yet" });
  try {
    const { amount, jobId, customerId } = req.body || {};
    if (!amount) return res.status(400).json({ error: "amount (in dollars) is required" });

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100), // dollars -> cents
      currency: "usd",
      capture_method: "manual", // authorize now, capture on completion
      automatic_payment_methods: { enabled: true },
      metadata: { jobId: jobId || "", customerId: customerId || "" },
    });

    res.status(200).json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
