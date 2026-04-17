import express from 'express';
import crypto from 'crypto';
import pool from './db.js';
import { verifyToken } from './middleware/auth-middleware.js';

const router = express.Router();

const LS_API_KEY        = process.env.LEMONSQUEEZY_API_KEY;
const LS_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
const LS_STORE_ID       = process.env.LEMONSQUEEZY_STORE_ID;

const VARIANT_CREDITS = {
  '1407032': { credits: 30,  type: 'one_time',     label: 'Starter Pack'  },
  '1407417': { credits: 80,  type: 'subscription', label: 'MVP Monthly'   },
  '1407425': { credits: 18,  type: 'one_time',     label: 'Add-on Pack'   },
};

// POST /api/lemon/checkout — creates a Lemon Squeezy checkout URL
// Authenticated; requires a verified email before allowing a payment to be created.
router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const { variantId } = req.body;
    if (!variantId) return res.status(400).json({ error: 'Faltan parámetros' });

    const userCheck = await pool.query(
      'SELECT id, email, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    const dbUser = userCheck.rows[0];
    if (!dbUser) return res.status(401).json({ error: 'Unauthorized' });
    if (!dbUser.email_verified) {
      return res.status(403).json({
        error:             'EMAIL_NOT_VERIFIED',
        message:           'Verify your email before purchasing credits.',
        requiresVerification: true,
      });
    }

    const userId    = dbUser.id;
    const userEmail = dbUser.email;

    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LS_API_KEY}`,
        'Content-Type': 'application/vnd.api+json',
        'Accept':        'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email:  userEmail,
              custom: { user_id: String(userId), variant_id: String(variantId) },
            },
            product_options: {
              redirect_url: `${process.env.FRONTEND_URL || 'https://hexa-v4.vercel.app'}?payment=success`,
            },
          },
          relationships: {
            store:   { data: { type: 'stores',   id: String(LS_STORE_ID) } },
            variant: { data: { type: 'variants', id: String(variantId)   } },
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'Error al crear checkout' });

    const checkoutUrl = data?.data?.attributes?.url;
    if (!checkoutUrl) return res.status(500).json({ error: 'No se obtuvo URL' });

    res.json({ url: checkoutUrl });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/lemon/webhook — receives Lemon Squeezy payment events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-signature'];
    if (!signature || !LS_WEBHOOK_SECRET) return res.status(401).json({ error: 'Sin firma' });

    const hmac   = crypto.createHmac('sha256', LS_WEBHOOK_SECRET);
    const digest = hmac.update(req.body).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const payload   = JSON.parse(req.body.toString());
    const eventName = payload?.meta?.event_name;
    const customData = payload?.meta?.custom_data;
    const variantId  = String(payload?.data?.attributes?.variant_id || customData?.variant_id || '');
    const userId     = customData?.user_id;

    if (['order_created', 'subscription_created', 'subscription_payment_success'].includes(eventName)) {
      if (!userId || !variantId) return res.status(200).json({ received: true });

      const variantConfig = VARIANT_CREDITS[variantId];
      if (!variantConfig) return res.status(200).json({ received: true });

      const { credits, label } = variantConfig;
      const result = await pool.query(
        'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, email, credits',
        [credits, String(userId)]
      );
      if (result.rows.length > 0) console.log(`✅ +${credits} créditos → ${result.rows[0].email} (${label})`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[LS Webhook] Error:', err);
    res.status(200).json({ received: true });
  }
});

export default router;
