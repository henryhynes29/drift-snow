// POST /api/stripe-webhook
// Stripe tells us when things happen to a payment. The app already updates jobs
// directly when it can; this is the backup that keeps the database right even if
// a phone dies mid-checkout.
//
// In Stripe: Developers → Webhooks → Add endpoint →
//   URL:    https://driftplowing.com/api/stripe-webhook
//   Events: payment_intent.amount_capturable_updated, payment_intent.canceled,
//           payment_intent.payment_failed, charge.refunded, charge.dispute.created
// Then copy its signing secret (whsec_...) into Vercel as STRIPE_WEBHOOK_SECRET.
import { stripe, admin, markAuthorized, send } from "./_lib.js";

export const config = { api: { bodyParser: false } }; // signature check needs the raw body

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

async function jobForIntent(piId) {
  if (!piId) return null;
  const { data } = await admin.from("jobs").select("*").eq("payment_intent_id", piId).maybeSingle();
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !admin || !secret) return send(res, 503, { error: "Webhook not configured" });

  let event;
  try {
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers["stripe-signature"], secret);
  } catch (e) {
    return send(res, 400, { error: `Signature check failed: ${e.message}` });
  }

  try {
    const obj = event.data.object;
    switch (event.type) {
      case "payment_intent.amount_capturable_updated": { // card hold succeeded
        const job = await jobForIntent(obj.id);
        if (job && job.status === "requested" && job.payment_status === "pending") await markAuthorized(job, obj);
        break;
      }
      case "payment_intent.canceled": {
        const job = await jobForIntent(obj.id);
        if (job && ["pending", "authorized"].includes(job.payment_status)) {
          await admin.from("jobs").update({
            payment_status: "canceled",
            ...(job.status === "requested" ? { status: "expired" } : {}),
          }).eq("id", job.id);
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const job = await jobForIntent(obj.id);
        if (job && job.payment_status === "pending") {
          console.log("[webhook] card declined for job", job.id, obj.last_payment_error?.message);
        }
        break;
      }
      case "charge.refunded": {
        const job = await jobForIntent(obj.payment_intent);
        if (job && obj.refunded) await admin.from("jobs").update({ payment_status: "refunded" }).eq("id", job.id);
        break;
      }
      case "charge.dispute.created": {
        const { data: job } = await admin.from("jobs").select("id").eq("charge_id", obj.charge).maybeSingle();
        if (job) await admin.from("jobs").update({ payment_status: "disputed" }).eq("id", job.id);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[webhook]", event.type, e);
    return send(res, 500, { error: "Handler failed" }); // Stripe will retry
  }
  return send(res, 200, { received: true });
}
