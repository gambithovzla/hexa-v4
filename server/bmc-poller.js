/**
 * bmc-poller.js — Pull-based fallback for BMC purchases.
 *
 * BMC's webhook UI is no longer exposed for newer creator accounts, so we
 * cannot reliably configure or repair webhook delivery. This poller queries
 * the BMC REST API on a schedule, normalizes purchases, and routes them
 * through the same processBMCPurchase() the webhook uses — dedup is shared
 * via the bmc_processed_purchases table.
 */

import { processBMCPurchase, resolveCreditsForItem } from './bmc-credits.js';

const BMC_API_BASE   = 'https://developers.buymeacoffee.com/api/v1';
const BMC_TOKEN      = process.env.BMC_ACCESS_TOKEN;
const MAX_PAGES      = 20;  // safety cap (~100 purchases per run at per_page=5)

async function fetchPage(endpoint, page) {
  const res = await fetch(`${BMC_API_BASE}${endpoint}?page=${page}`, {
    headers: { Authorization: `Bearer ${BMC_TOKEN}` },
  });

  if (!res.ok) {
    throw new Error(`BMC ${endpoint} page ${page} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Poll /v1/extras and process any new purchases. Idempotent — relies on
 * processBMCPurchase() to dedup against bmc_processed_purchases.
 *
 * Returns { scanned, credited, skipped } for logging/metrics.
 */
export async function pollBMCExtras() {
  if (!BMC_TOKEN) {
    console.log('[bmc-poller] BMC_ACCESS_TOKEN not set — skipping');
    return { scanned: 0, credited: 0, skipped: 0 };
  }

  let scanned       = 0;
  let credited      = 0;
  let skipped       = 0;
  let consecutiveDups = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let body;
    try {
      body = await fetchPage('/extras', page);
    } catch (err) {
      console.error(`[bmc-poller] fetch failed on page ${page}:`, err.message);
      break;
    }

    const rows = Array.isArray(body?.data) ? body.data : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;

      const email   = row.payer_email ?? row.support?.support_email;
      const title   = row.extra?.reward_title;
      const amount  = row.purchase_amount ?? row.extra?.reward_coffee_price;
      const credits = resolveCreditsForItem({
        title,
        amount,
        quantity: row.quantity ?? 1,
      });

      if (!email || credits === 0) {
        skipped++;
        continue;
      }

      const result = await processBMCPurchase({
        purchaseId:  row.purchase_id,
        email,
        credits,
        productName: title,
        amount,
        source:      'poller',
      });

      if (result.alreadyProcessed) {
        consecutiveDups++;
      } else if (result.credited) {
        credited++;
        consecutiveDups = 0;
      } else {
        skipped++;
      }
    }

    // Optimization: BMC returns purchases newest-first. Once we've seen a
    // full page of already-processed purchases, older pages are guaranteed
    // to be processed too — bail out.
    if (consecutiveDups >= rows.length) break;

    if (!body?.next_page_url) break;
  }

  if (credited > 0 || scanned > 0) {
    console.log(`[bmc-poller] scanned=${scanned} credited=${credited} skipped=${skipped}`);
  }
  return { scanned, credited, skipped };
}
