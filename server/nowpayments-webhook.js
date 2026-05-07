/**
 * nowpayments-webhook.js — IPN handler for NowPayments.
 *
 * NowPayments signs IPN payloads with HMAC-SHA512 over the JSON body with
 * keys sorted alphabetically (recursively). The signature comes in the
 * `x-nowpayments-sig` header.
 *
 * Idempotency: nowpayments_invoices.order_id is UNIQUE and the credit-grant
 * UPDATE is gated by `status <> 'completed'`, so replays cannot double-credit.
 */

import crypto from 'crypto';
import pool from './db.js';

const NP_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;

// NowPayments signs the JSON with keys sorted alphabetically (deep). Mirror
// that here so HMACs match what their server produces.
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortObject(value[k]);
        return acc;
      }, {});
  }
  return value;
}

function verifySignature(rawBody, signature) {
  if (!NP_IPN_SECRET || !signature) return false;
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return false;
  }
  const sorted = JSON.stringify(sortObject(payload));
  const digest = crypto.createHmac('sha512', NP_IPN_SECRET).update(sorted).digest('hex');
  if (digest.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

export async function handleNowPaymentsWebhook(req, res) {
  try {
    const signature = req.headers['x-nowpayments-sig'];
    if (!verifySignature(req.body, signature)) {
      console.warn('[nowpayments-webhook] invalid or missing signature');
      return res.status(401).json({ error: 'invalid_signature' });
    }

    const payload = JSON.parse(req.body.toString());
    const orderId       = payload.order_id;
    const status        = payload.payment_status;
    const invoiceId     = payload.invoice_id ? String(payload.invoice_id) : null;
    const payCurrency   = payload.pay_currency || null;

    if (!orderId) {
      console.warn('[nowpayments-webhook] payload missing order_id');
      return res.status(200).json({ received: true });
    }

    // Only credit on terminal-success states. NowPayments uses:
    // waiting → confirming → confirmed → sending → finished
    // We trust 'finished' as the safe credit trigger.
    if (status !== 'finished') {
      console.log(`[nowpayments-webhook] ${orderId} status=${status} — not crediting yet`);
      return res.status(200).json({ received: true });
    }

    // Atomic claim: only the first 'finished' webhook for this order_id wins.
    const claim = await pool.query(
      `UPDATE nowpayments_invoices
          SET status        = 'completed',
              completed_at  = NOW(),
              invoice_id    = COALESCE($2, invoice_id),
              pay_currency  = COALESCE($3, pay_currency)
        WHERE order_id = $1
          AND status <> 'completed'
        RETURNING user_id, credits, plan_id`,
      [orderId, invoiceId, payCurrency]
    );

    if (claim.rowCount === 0) {
      console.log(`[nowpayments-webhook] ${orderId} already processed or unknown — ignoring`);
      return res.status(200).json({ received: true });
    }

    const { user_id, credits, plan_id } = claim.rows[0];
    const grant = await pool.query(
      'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING email, credits',
      [credits, user_id]
    );

    if (grant.rowCount > 0) {
      console.log(`[nowpayments-webhook] ✅ +${credits} credits → ${grant.rows[0].email} (${plan_id}, order ${orderId})`);
    } else {
      console.warn(`[nowpayments-webhook] order ${orderId} completed but user ${user_id} not found`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[nowpayments-webhook] error:', err);
    // Always 200 so NowPayments does not retry on internal errors.
    return res.status(200).json({ received: true });
  }
}
