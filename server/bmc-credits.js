/**
 * bmc-credits.js — Shared logic for resolving BMC purchases → app credits.
 *
 * Used by both the webhook handler (push) and the API poller (pull) so that
 * credit math, dedup, and DB writes stay consistent regardless of source.
 */

import pool from './db.js';

/**
 * Resolve credits for a single purchase line item.
 *   - title: product/reward name (e.g. "HEXA All-Star - 50 Credits")
 *   - amount: USD as string or number (e.g. "19.99")
 *   - quantity: defaults to 1
 *
 * Returns total credits for the line item (perUnit * quantity).
 */
export function resolveCreditsForItem({ title, amount, quantity = 1 } = {}) {
  const t       = (title ?? '').toLowerCase();
  const dollars = parseFloat(amount);
  const qty     = Number(quantity) || 1;

  // Tolerate "19.99" and "19.9900" — BMC's API returns 4-decimal strings,
  // their webhook returns 2-decimal. Compare numerically to avoid drift.
  const eq = (a, b) => !isNaN(a) && Math.abs(a - b) < 0.005;

  let perUnit = 0;
  if (t.includes('rookie')   || eq(dollars, 7.99))  perUnit = 15;
  else if (t.includes('all-star') || eq(dollars, 19.99)) perUnit = 50;
  else if (t.includes('mvp')      || eq(dollars, 39.99)) perUnit = 120;
  else if (!isNaN(dollars) && dollars > 0) {
    perUnit = Math.round(dollars * 2);
    console.warn(`[bmc-credits] Unknown product "${title}" ($${amount}) — fallback ${perUnit} credits/unit (~$1=2cr)`);
  } else {
    console.warn(`[bmc-credits] Cannot resolve credits for "${title}" ($${amount}) — skipping`);
    return 0;
  }

  return perUnit * qty;
}

/**
 * Idempotently mark a BMC purchase as processed and grant credits.
 *
 * Inserts into bmc_processed_purchases (purchase_id is unique). On conflict,
 * the function returns { alreadyProcessed: true } without touching credits —
 * this is what makes webhook + poller safe to run together.
 *
 * On first-time success, credits land on the matching user, or fall back to
 * pending_credits if no user has registered with that email yet.
 */
export async function processBMCPurchase({
  purchaseId,
  email,
  credits,
  productName = null,
  amount      = null,
  source,                    // 'webhook' | 'poller'
}) {
  if (!purchaseId || !email || !credits) {
    return { skipped: true, reason: 'missing fields' };
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  // 1. Try to claim this purchase_id. If another caller (webhook vs poller)
  //    already processed it, the INSERT no-ops and RETURNING is empty.
  const claim = await pool.query(
    `INSERT INTO bmc_processed_purchases (purchase_id, source, email, credits, product_name, amount)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (purchase_id) DO NOTHING
     RETURNING purchase_id`,
    [String(purchaseId), source, normalizedEmail, credits, productName, parseFloat(amount) || null]
  );

  if (claim.rowCount === 0) {
    return { alreadyProcessed: true };
  }

  // 2. Credit the user if registered, else queue under pending_credits.
  const userResult = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (userResult.rows.length > 0) {
    await pool.query(
      'UPDATE users SET credits = credits + $1 WHERE email = $2',
      [credits, normalizedEmail]
    );
    console.log(`[bmc-credits] (${source}) Credited ${credits} to ${normalizedEmail} — purchase ${purchaseId}`);
    return { credited: true, target: 'user' };
  }

  await pool.query(
    `INSERT INTO pending_credits (email, credits, source, purchase_id, amount, product_name)
     VALUES ($1, $2, 'buymeacoffee', $3, $4, $5)`,
    [normalizedEmail, credits, String(purchaseId), parseFloat(amount) || null, productName]
  );
  console.log(`[bmc-credits] (${source}) Queued ${credits} pending for ${normalizedEmail} — purchase ${purchaseId}`);
  return { credited: true, target: 'pending' };
}
