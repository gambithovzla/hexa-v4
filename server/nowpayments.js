/**
 * nowpayments.js — Checkout router for NowPayments (crypto gateway).
 *
 * POST /api/nowpayments/checkout
 *   body: { planId: 'rookie' | 'allstar' | 'mvp' }
 *   auth: Bearer JWT, email_verified required
 *   returns: { url: invoice_url }
 *
 * Creates an invoice on NowPayments, persists a 'new' row in
 * nowpayments_invoices, and returns the hosted invoice URL the client
 * redirects the user to.
 */

import express from 'express';
import crypto from 'crypto';
import pool from './db.js';
import { verifyToken } from './middleware/auth-middleware.js';
import { getPlan } from './plans.js';

const router = express.Router();

const NP_API_KEY  = process.env.NOWPAYMENTS_API_KEY;
const NP_API_BASE = process.env.NOWPAYMENTS_API_BASE || 'https://api.nowpayments.io';

router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const { planId } = req.body || {};
    const plan = getPlan(planId);
    if (!plan) return res.status(400).json({ error: 'INVALID_PLAN' });

    if (!NP_API_KEY) {
      console.error('[nowpayments] NOWPAYMENTS_API_KEY missing');
      return res.status(500).json({ error: 'GATEWAY_NOT_CONFIGURED' });
    }

    const userCheck = await pool.query(
      'SELECT id, email, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    const dbUser = userCheck.rows[0];
    if (!dbUser) return res.status(401).json({ error: 'Unauthorized' });
    if (!dbUser.email_verified) {
      return res.status(403).json({
        error:                'EMAIL_NOT_VERIFIED',
        message:              'Verify your email before purchasing credits.',
        requiresVerification: true,
      });
    }

    const orderId = `np_${crypto.randomUUID()}`;
    const frontend = process.env.FRONTEND_URL || 'https://hexa-v4.vercel.app';
    const apiHost  = `${req.protocol}://${req.get('host')}`;

    const invoiceBody = {
      price_amount:      plan.priceUsd,
      price_currency:    'usd',
      order_id:          orderId,
      order_description: `${plan.label} · ${plan.credits} credits`,
      ipn_callback_url:  `${apiHost}/api/nowpayments/webhook`,
      success_url:       `${frontend}?payment=success`,
      cancel_url:        `${frontend}?payment=cancel`,
    };

    // Insert pending invoice BEFORE calling NowPayments so the webhook always
    // has a row to match against (race-safe even if IPN arrives near-instant).
    await pool.query(
      `INSERT INTO nowpayments_invoices
         (order_id, user_id, plan_id, credits, price_usd, status)
       VALUES ($1, $2, $3, $4, $5, 'new')`,
      [orderId, dbUser.id, plan.id, plan.credits, plan.priceUsd]
    );

    const response = await fetch(`${NP_API_BASE}/v1/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key':    NP_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoiceBody),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.invoice_url) {
      console.error('[nowpayments] invoice creation failed:', response.status, data);
      // Roll back the pending row so the user can retry without orphan records.
      await pool.query('DELETE FROM nowpayments_invoices WHERE order_id = $1', [orderId]);
      return res.status(502).json({ error: 'CHECKOUT_FAILED' });
    }

    await pool.query(
      `UPDATE nowpayments_invoices SET invoice_id = $1 WHERE order_id = $2`,
      [String(data.id ?? ''), orderId]
    );

    console.log(`[nowpayments] invoice ${orderId} created for ${dbUser.email} (${plan.id}, $${plan.priceUsd})`);
    res.json({ url: data.invoice_url });
  } catch (err) {
    console.error('[nowpayments] checkout error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
