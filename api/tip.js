// POST /api/tip
// Charges a customer's tip after a completed job and routes 100% to the driver.
// A tip is a fresh, immediately-captured charge (not part of the job's manual-
// capture hold). Needs STRIPE_SECRET_KEY.
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Stripe not configured yet" });
  try {
    const { amount, jobId, driverStripeAccountId, paymentMethodId, customerId } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "A positive tip amount is required" });

    // If the driver has a Connect account, route the tip straight to them
    // (destination charge). Otherwise the platform holds it and pays out later.
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100),
      currency: "usd",
      customer: customerId || undefined,
      payment_method: paymentMethodId || undefined,
      confirm: !!paymentMethodId, // if we have the saved method, charge now
      off_session: !!paymentMethodId,
      metadata: { jobId: jobId || "", kind: "tip" },
      ...(driverStripeAccountId
        ? { transfer_data: { destination: driverStripeAccountId } }
        : {}),
    });

    res.status(200).json({ paymentIntentId: intent.id, status: intent.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
