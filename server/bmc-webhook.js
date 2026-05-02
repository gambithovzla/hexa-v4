import crypto from 'crypto';
import pool from './db.js';

const BMC_WEBHOOK_SECRET = process.env.BMC_WEBHOOK_SECRET;

// BMC sends different event types depending on product configuration:
//   - extra_purchase.created  → one-time "Extras"
//   - shop_order.created      → digital Shop products
// Both carry the same conceptual fields (supporter_email, an array of items
// with title/amount), but the items live under different keys per event type.
const SUPPORTED_EVENT_TYPES = new Set([
  'extra_purchase.created',
  'shop_order.created',
]);

function extractItems(eventType, data) {
  if (eventType === 'shop_order.created') {
    return data.items ?? data.products ?? data.line_items ?? [];
  }
  // extra_purchase.created
  return data.extras ?? [];
}

function resolveCredits(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let total = 0;
  for (const item of items) {
    const title    = (item.title ?? item.name ?? item.product_name ?? '').toLowerCase();
    const amount   = String(item.amount ?? item.price ?? '');
    const quantity = Number(item.quantity ?? 1) || 1;

    let perUnit = 0;
    if (title.includes('rookie')   || amount === '7.99')  perUnit = 15;
    else if (title.includes('all-star') || amount === '19.99') perUnit = 50;
    else if (title.includes('mvp')      || amount === '39.99') perUnit = 120;
    else {
      // Fallback: ~2 credits per dollar
      const dollars = parseFloat(amount);
      if (!isNaN(dollars) && dollars > 0) {
        perUnit = Math.round(dollars * 2);
        console.warn(`[bmc-webhook] Unknown item "${item.title ?? item.name}" ($${amount}) — assigning ${perUnit} credits/unit (fallback ~$1=2cr)`);
      } else {
        console.warn(`[bmc-webhook] Cannot determine credits for item "${item.title ?? item.name}" ($${amount})`);
        continue;
      }
    }

    total += perUnit * quantity;
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

    const eventType = payload?.type;

    if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
      // Log full payload (without secrets) so we can wire up new event types
      // when BMC introduces them or the creator adds new product categories.
      console.log(`[bmc-webhook] Ignoring event type "${eventType}" — payload keys: ${Object.keys(payload?.data ?? {}).join(',')}`);
      return res.status(200).json({ success: true });
    }

    const data = payload?.data ?? {};

    if (data.status && data.status !== 'succeeded') {
      console.log(`[bmc-webhook] Skipping ${eventType} ${data.id} with status "${data.status}"`);
      return res.status(200).json({ success: true });
    }

    const supporter_email = data.supporter_email ?? data.email ?? data.buyer_email;
    if (!supporter_email) {
      console.warn(`[bmc-webhook] No supporter email in ${eventType} payload — ignoring`);
      return res.status(200).json({ success: true });
    }

    const items           = extractItems(eventType, data);
    const purchase_id     = data.id;
    const email           = supporter_email.toLowerCase().trim();
    const credits         = resolveCredits(items);
    const product_name    = items[0]?.title ?? items[0]?.name ?? null;
    const purchase_amount = items[0]?.amount ?? items[0]?.price ?? null;

    if (credits === 0) {
      console.warn(`[bmc-webhook] ${eventType} ${purchase_id} for ${email} resolved to 0 credits — items: ${JSON.stringify(items)}`);
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
      console.log(`[bmc-webhook] Credited ${credits} credits to ${email} (event: ${eventType}, items: ${items.length})`);
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
      console.log(`[bmc-webhook] User ${email} not found — saved ${credits} pending credits (event: ${eventType}, items: ${items.length})`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[bmc-webhook] Error:', err);
    // Always return 200 to prevent BMC from retrying on our internal errors
    return res.status(200).json({ success: true });
  }
}
