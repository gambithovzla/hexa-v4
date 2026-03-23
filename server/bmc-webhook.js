import crypto from 'crypto';
import pool from './db.js';

const BMC_WEBHOOK_SECRET = process.env.BMC_WEBHOOK_SECRET;

function resolveCredits(purchaseQuestion, purchaseAmount) {
  const name   = (purchaseQuestion ?? '').toLowerCase();
  const amount = String(purchaseAmount ?? '');

  if (name.includes('rookie') || amount === '7.99')   return 15;
  if (name.includes('all-star') || amount === '19.99') return 50;
  if (name.includes('mvp') || amount === '39.99')      return 120;

  // Fallback: ~2 credits per dollar
  const dollars = parseFloat(amount);
  if (!isNaN(dollars) && dollars > 0) {
    const fallback = Math.round(dollars * 2);
    console.warn(`[bmc-webhook] Unknown product "${purchaseQuestion}" ($${amount}) — assigning ${fallback} credits (fallback ~$1=2cr)`);
    return fallback;
  }

  console.warn(`[bmc-webhook] Cannot determine credits for "${purchaseQuestion}" ($${amount})`);
  return 0;
}

export async function handleBMCWebhook(req, res) {
  try {
    // 1. Verify HMAC-SHA256 signature
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

    // 2. Parse payload
    const payload  = JSON.parse(req.body.toString());
    const response = payload?.response ?? {};
    const {
      purchase_id,
      purchase_question,
      purchase_amount,
      purchase_is_revoked,
      supporter_email,
    } = response;

    if (purchase_is_revoked) {
      console.log(`[bmc-webhook] Skipping revoked purchase ${purchase_id}`);
      return res.status(200).json({ success: true });
    }

    if (!supporter_email) {
      console.warn('[bmc-webhook] No supporter_email in payload — ignoring');
      return res.status(200).json({ success: true });
    }

    const email   = supporter_email.toLowerCase().trim();
    const credits = resolveCredits(purchase_question, purchase_amount);

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
      console.log(`[bmc-webhook] Credited ${credits} credits to ${email} (Extra: "${purchase_question}", Amount: $${purchase_amount})`);
    } else {
      await pool.query(
        `INSERT INTO pending_credits (email, credits, source, purchase_id, amount, product_name)
         VALUES ($1, $2, 'buymeacoffee', $3, $4, $5)`,
        [
          email,
          credits,
          String(purchase_id ?? ''),
          parseFloat(purchase_amount) || null,
          purchase_question ?? null,
        ]
      );
      console.log(`[bmc-webhook] User ${email} not found — saved ${credits} pending credits (Extra: "${purchase_question}", Amount: $${purchase_amount})`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[bmc-webhook] Error:', err);
    // Always return 200 to prevent BMC from retrying on our internal errors
    return res.status(200).json({ success: true });
  }
}
