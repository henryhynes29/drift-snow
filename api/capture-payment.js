// POST /api/capture-payment
// Called when a job is marked complete. Captures the card authorization created
// at request time ("no storm, no charge" means we only charge on completion),
// then — if the driver has finished payout onboarding — transfers their share to
// their Stripe Connect account. Needs STRIPE_SECRET_KEY (server-only Vercel env).
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Stripe not configured yet" });
  try {
    const { paymentIntentId, driverAmount, driverStripeAccountId } = req.body || {};
    if (!paymentIntentId) return res.status(400).json({ error: "paymentIntentId is required" });

    // 1) Capture the held authorization (charges the customer now).
    const captured = await stripe.paymentIntents.capture(paymentIntentId);

    // 2) Pay the driver their share, if they've connected a payout account.
    let transfer = null;
    if (driverStripeAccountId && Number(driverAmount) > 0) {
      transfer = await stripe.transfers.create({
        amount: Math.round(Number(driverAmount) * 100), // dollars -> cents
        currency: "usd",
        destination: driverStripeAccountId,
        transfer_group: paymentIntentId,
        metadata: { paymentIntentId },
      });
    }

    res.status(200).json({
      captured: captured.status, // "succeeded" when done
      transferId: transfer ? transfer.id : null,
      driverPaid: !!transfer,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
