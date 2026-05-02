import crypto from 'crypto';
import { processBMCPurchase, resolveCreditsForItem } from './bmc-credits.js';

const BMC_WEBHOOK_SECRET = process.env.BMC_WEBHOOK_SECRET;

// BMC sends different event types depending on product configuration.
// Both extras and shop orders carry the same conceptual fields, but the
// items live under different keys per event type.
const SUPPORTED_EVENT_TYPES = new Set([
  'extra_purchase.created',
  'shop_order.created',
]);

function extractItems(eventType, data) {
  if (eventType === 'shop_order.created') {
    return data.items ?? data.products ?? data.line_items ?? [];
  }
  return data.extras ?? [];
}

function totalCreditsForItems(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => sum + resolveCreditsForItem({
    title:    it.title ?? it.name ?? it.product_name,
    amount:   it.amount ?? it.price,
    quantity: it.quantity ?? 1,
  }), 0);
}

export async function handleBMCWebhook(req, res) {
  try {
    const payload = JSON.parse(req.body.toString());

    // Verify HMAC-SHA256 signature (skip for BMC test events)
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

    const items   = extractItems(eventType, data);
    const credits = totalCreditsForItems(items);

    if (credits === 0) {
      console.warn(`[bmc-webhook] ${eventType} ${data.id} for ${supporter_email} resolved to 0 credits — items: ${JSON.stringify(items)}`);
      return res.status(200).json({ success: true });
    }

    const result = await processBMCPurchase({
      purchaseId:  data.id,
      email:       supporter_email,
      credits,
      productName: items[0]?.title ?? items[0]?.name ?? null,
      amount:      items[0]?.amount ?? items[0]?.price ?? null,
      source:      'webhook',
    });

    if (result.alreadyProcessed) {
      console.log(`[bmc-webhook] purchase ${data.id} already processed — skipping`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[bmc-webhook] Error:', err);
    // Always return 200 to prevent BMC from retrying on our internal errors
    return res.status(200).json({ success: true });
  }
}
