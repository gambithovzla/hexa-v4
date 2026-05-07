/**
 * plans.js — Single source of truth for credit packs sold via NowPayments.
 *
 * Used by the checkout endpoint to validate planId, price the invoice, and
 * tell the webhook how many credits to grant when payment is finished.
 */

export const PLANS = [
  { id: 'rookie',  label: 'HEXA Rookie',   priceUsd: 7.99,  credits: 15  },
  { id: 'allstar', label: 'HEXA All-Star', priceUsd: 19.99, credits: 50  },
  { id: 'mvp',     label: 'HEXA MVP',      priceUsd: 39.99, credits: 120 },
];

export function getPlan(id) {
  return PLANS.find((p) => p.id === id) || null;
}
