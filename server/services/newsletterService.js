/**
 * newsletterService.js — Weekly newsletter via Resend + newsletter_subscribers table.
 *
 * Public API:
 *   subscribeNewsletter(email, lang)       → { ok, alreadySubscribed }
 *   unsubscribeNewsletter(email, token)    → { ok }
 *   sendWeeklyNewsletter(lang, date)       → { sent, skipped, errors }
 *   getSubscribers({ activeOnly })         → subscriber rows
 *
 * Env vars:
 *   RESEND_API_KEY     — required (shared with email.js)
 *   EMAIL_FROM         — from address (shared with email.js)
 *   NEWSLETTER_ENABLED — '1' to allow sending
 *   FRONTEND_URL       — base URL for unsubscribe links
 */

import crypto from 'crypto';
import pool from '../db.js';
import { generateDraftForType } from './contentDraftService.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://hexaoracle.lat';

function getEmailFrom() {
  return process.env.EMAIL_FROM || 'H.E.X.A. Oracle <noreply@hexaoracle.lat>';
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Subscription management ────────────────────────────────────────────────

export async function subscribeNewsletter(email, lang = 'es') {
  const normEmail = String(email ?? '').trim().toLowerCase();
  if (!normEmail || !normEmail.includes('@')) {
    const err = new Error('Invalid email address');
    err.code = 'INVALID_EMAIL';
    throw err;
  }

  const token = generateToken();
  const normLang = String(lang ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es';

  const existing = await pool.query(
    'SELECT id, active FROM newsletter_subscribers WHERE email = $1',
    [normEmail]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.active) return { ok: true, alreadySubscribed: true };
    // Re-activate
    await pool.query(
      `UPDATE newsletter_subscribers
       SET active = true, unsubscribed_at = NULL, lang = $2,
           unsubscribe_token = $3, subscribed_at = NOW()
       WHERE email = $1`,
      [normEmail, normLang, token]
    );
    return { ok: true, alreadySubscribed: false, reactivated: true };
  }

  await pool.query(
    `INSERT INTO newsletter_subscribers (email, unsubscribe_token, lang)
     VALUES ($1, $2, $3)`,
    [normEmail, token, normLang]
  );
  return { ok: true, alreadySubscribed: false };
}

export async function unsubscribeNewsletter(email, token) {
  const normEmail = String(email ?? '').trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id, unsubscribe_token FROM newsletter_subscribers WHERE email = $1 AND active = true',
    [normEmail]
  );
  if (!rows.length) return { ok: false, reason: 'not_found' };

  const row = rows[0];
  if (row.unsubscribe_token !== String(token ?? '').trim()) {
    return { ok: false, reason: 'invalid_token' };
  }

  await pool.query(
    `UPDATE newsletter_subscribers
     SET active = false, unsubscribed_at = NOW()
     WHERE id = $1`,
    [row.id]
  );
  return { ok: true };
}

export async function getSubscribers({ activeOnly = true } = {}) {
  const { rows } = await pool.query(
    `SELECT id, email, lang, active, subscribed_at, unsubscribed_at
     FROM newsletter_subscribers
     ${activeOnly ? 'WHERE active = true' : ''}
     ORDER BY subscribed_at DESC`
  );
  return rows;
}

// ── Email rendering ────────────────────────────────────────────────────────

function buildUnsubscribeUrl(email, token) {
  const params = new URLSearchParams({ email, token });
  return `${FRONTEND_URL}/newsletter/unsubscribe?${params.toString()}`;
}

function renderNewsletterHtml({ posts, title, hashtags, lang, email, token }) {
  const isEs = lang === 'es';
  const postsHtml = posts
    .map((p) => `<p style="margin:0 0 18px;color:#C8D8E8;line-height:1.65;">${p.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('');
  const tagsHtml = (hashtags ?? [])
    .map((t) => `<span style="color:#00D9FF;font-size:11px;margin-right:6px;">${t}</span>`)
    .join('');
  const unsubUrl = buildUnsubscribeUrl(email, token);
  const unsubLabel = isEs ? 'Cancelar suscripción' : 'Unsubscribe';
  const footerNote = isEs
    ? 'Recibes esto porque te suscribiste al newsletter semanal de H.E.X.A.'
    : 'You are receiving this because you subscribed to the H.E.X.A. weekly newsletter.';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#080C18;font-family:'Share Tech Mono',monospace,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="border-top:2px solid #FF6600;margin-bottom:24px;"></div>

    <h1 style="margin:0 0 6px;font-size:13px;letter-spacing:3px;color:#FF6600;text-transform:uppercase;">
      H.E.X.A. ORACLE
    </h1>
    <h2 style="margin:0 0 28px;font-size:22px;font-weight:700;color:#E8F4FF;letter-spacing:1px;">
      ${title}
    </h2>

    <div style="border-left:2px solid #00D9FF;padding-left:16px;margin-bottom:28px;">
      ${postsHtml}
    </div>

    <div style="margin-bottom:28px;">${tagsHtml}</div>

    <div style="border-top:1px solid rgba(0,217,255,0.15);padding-top:20px;font-size:10px;color:rgba(200,216,232,0.45);">
      <p style="margin:0 0 8px;">${footerNote}</p>
      <a href="${unsubUrl}" style="color:#FF6600;text-decoration:none;">${unsubLabel}</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Send weekly newsletter ─────────────────────────────────────────────────

async function sendOneEmail({ resend, from, to, subject, html }) {
  try {
    await resend.emails.send({ from, to, subject, html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendWeeklyNewsletter(lang = 'es', date = null) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const from = getEmailFrom();
  const isEs = String(lang).startsWith('es');

  // Generate the weekly_recap content
  const draft = await generateDraftForType({ type: 'weekly_recap', lang, date });
  const posts    = Array.isArray(draft.posts) ? draft.posts : [];
  const title    = draft.title ?? (isEs ? 'Resumen semanal HEXA' : 'HEXA Weekly Recap');
  const hashtags = draft.hashtags ?? [];
  const subject  = `${title} — HEXA Oracle`;

  if (posts.length === 0) {
    console.warn('[newsletter] weekly_recap generated no posts — aborting send');
    return { sent: 0, skipped: 0, errors: [], reason: 'no_content' };
  }

  // Fetch active subscribers matching the lang (or all if no lang filter)
  const { rows: subscribers } = await pool.query(
    `SELECT email, unsubscribe_token FROM newsletter_subscribers
     WHERE active = true AND lang = $1
     ORDER BY subscribed_at ASC`,
    [isEs ? 'es' : 'en']
  );

  if (subscribers.length === 0) {
    console.log(`[newsletter] no active ${lang} subscribers — nothing to send`);
    return { sent: 0, skipped: 0, errors: [] };
  }

  let sent = 0, skipped = 0;
  const errors = [];

  for (const sub of subscribers) {
    const html = renderNewsletterHtml({
      posts, title, hashtags, lang: isEs ? 'es' : 'en',
      email: sub.email, token: sub.unsubscribe_token,
    });
    const result = await sendOneEmail({ resend, from, to: sub.email, subject, html });
    if (result.ok) {
      sent++;
    } else {
      errors.push({ email: sub.email, error: result.error });
      skipped++;
      console.warn(`[newsletter] failed to send to ${sub.email}: ${result.error}`);
    }
    // Small throttle to avoid Resend rate-limit (100 req/s on free tier)
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`[newsletter] weekly sent: ${sent} ok / ${skipped} failed / ${subscribers.length} total`);
  return { sent, skipped, errors };
}
