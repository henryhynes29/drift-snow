// POST /api/stripe-webhook
// Stripe calls this when things happen (payment captured, driver account ready).
// Needs STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET.
//
// NOTE: signature verification needs the RAW request body. On Vercel this is
// handled by reading the stream below; if you migrate to Next.js, also add
// `export const config = { api: { bodyParser: false } }`.
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-06-20" });

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET not set" });

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, req.headers["stripe-signature"], secret);
  } catch (e) {
    return res.status(400).send(`Webhook signature verification failed: ${e.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      // const jobId = event.data.object.metadata.jobId;
      // TODO: mark the job paid in Supabase (use the service-role key, server-side)
      break;
    }
    case "account.updated": {
      // const acct = event.data.object;
      // TODO: if charges/payouts enabled, set the driver's Connect status ready
      break;
    }
    default:
      break;
  }

  res.status(200).json({ received: true });
}
