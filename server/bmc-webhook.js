import crypto from 'crypto';
import pool from './db.js';

const BMC_WEBHOOK_SECRET = process.env.BMC_WEBHOOK_SECRET;

function resolveCredits(extras) {
  if (!Array.isArray(extras) || extras.length === 0) return 0;

  let total = 0;
  for (const extra of extras) {
    const title  = (extra.title ?? '').toLowerCase();
    const amount = String(extra.amount ?? '');

    if (title.includes('rookie') || amount === '7.99')   { total += 15;  continue; }
    if (title.includes('all-star') || amount === '19.99') { total += 50;  continue; }
    if (title.includes('mvp') || amount === '39.99')      { total += 120; continue; }

    // Fallback: ~2 credits per dollar
    const dollars = parseFloat(amount);
    if (!isNaN(dollars) && dollars > 0) {
      const fallback = Math.round(dollars * 2);
      console.warn(`[bmc-webhook] Unknown extra "${extra.title}" ($${amount}) — assigning ${fallback} credits (fallback ~$1=2cr)`);
      total += fallback;
    } else {
      console.warn(`[bmc-webhook] Cannot determine credits for extra "${extra.title}" ($${amount})`);
    }
  }

  return total;
}

export async function handleBMCWebhook(req, res) {
  try {
    // 1. Parse payload (needed early to check live_mode before signature verification)
    const payload = JSON.parse(req.body.toString());

    // 2. Verify HMAC-SHA256 signature (skip for BMC test events)
    if (payload?.live_mode === false) {
      console.log('[bmc-webhook] TEST MODE — skipping signature verification');
    } else {
      const signature = req.headers['x-bmc-signature'];
      if (!signature || !BMC_WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Missing signature' });
      }

      const hmac   = crypto.createHmac('sha256', BMC_WEBHOOK_SECRET);
      const digest = hmac.update(req.body).digest('hex');

      if (
        digest.length !== signature.length ||
        !crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(signature, 'utf8'))
      ) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    if (payload?.type !== 'extra_purchase.created') {
      console.log(`[bmc-webhook] Ignoring event type "${payload?.type}"`);
      return res.status(200).json({ success: true });
    }

    const data = payload?.data ?? {};

    if (data.status !== 'succeeded') {
      console.log(`[bmc-webhook] Skipping purchase ${data.id} with status "${data.status}"`);
      return res.status(200).json({ success: true });
    }

    const supporter_email = data.supporter_email;
    if (!supporter_email) {
      console.warn('[bmc-webhook] No supporter_email in payload — ignoring');
      return res.status(200).json({ success: true });
    }

    const purchase_id    = data.id;
    const extras         = data.extras ?? [];
    const email          = supporter_email.toLowerCase().trim();
    const credits        = resolveCredits(extras);
    const product_name   = extras[0]?.title ?? null;
    const purchase_amount = extras[0]?.amount ?? null;

    if (credits === 0) {
      return res.status(200).json({ success: true });
    }

    // 3. Credit user if exists, otherwise save to pending_credits
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length > 0) {
      await pool.query(
        'UPDATE users SET credits = credits + $1 WHERE email = $2',
        [credits, email]
      );
      console.log(`[bmc-webhook] Credited ${credits} credits to ${email} (supporter: "${data.supporter_name}", extras: ${extras.length})`);
    } else {
      await pool.query(
        `INSERT INTO pending_credits (email, credits, source, purchase_id, amount, product_name)
         VALUES ($1, $2, 'buymeacoffee', $3, $4, $5)`,
        [
          email,
          credits,
          String(purchase_id ?? ''),
          parseFloat(purchase_amount) || null,
          product_name,
        ]
      );
      console.log(`[bmc-webhook] User ${email} not found — saved ${credits} pending credits (supporter: "${data.supporter_name}", extras: ${extras.length})`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[bmc-webhook] Error:', err);
    // Always return 200 to prevent BMC from retrying on our internal errors
    return res.status(200).json({ success: true });
  }
}
