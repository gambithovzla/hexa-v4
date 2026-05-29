/**
 * telegramPublisher.js — Telegram Bot API adapter for the content queue.
 *
 * Mirrors the shape of xPublisher.js:
 *   - isTelegramConfigured() → boolean
 *   - publishQueueItemToTelegram(item) → publishResult object
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN   — from BotFather (e.g. 123456:ABC-DEF...)
 *   TELEGRAM_CHANNEL_ID  — channel/group ID (e.g. @myChannel or -100xxxxxxxxxx)
 *   TELEGRAM_ENABLED     — '1' to enable (default off)
 *
 * For threads (item.posts is an array), messages are sent sequentially and
 * each reply is threaded to the previous message via reply_to_message_id.
 */

const TG_API_BASE = 'https://api.telegram.org';
const MAX_TEXT_LENGTH = 4096;

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseJsonMaybe(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function getPostsArray(item) {
  const posts = parseJsonMaybe(item?.posts);
  if (!Array.isArray(posts)) return [];
  return posts.map((p) => cleanText(p)).filter(Boolean);
}

function truncate(text, max = MAX_TEXT_LENGTH) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

export function isTelegramConfigured() {
  return (
    process.env.TELEGRAM_ENABLED === '1' &&
    Boolean(process.env.TELEGRAM_BOT_TOKEN) &&
    Boolean(process.env.TELEGRAM_CHANNEL_ID)
  );
}

async function sendMessage({ text, replyToMessageId = null }) {
  const token     = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  if (!token || !channelId) {
    const err = new Error('Telegram credentials are not configured');
    err.code = 'TELEGRAM_NOT_CONFIGURED';
    throw err;
  }

  const body = {
    chat_id: channelId,
    text:    truncate(text),
    parse_mode: 'HTML',
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
  };

  const url = `${TG_API_BASE}/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    const detail = json?.description ?? response.statusText;
    const err = new Error(`Telegram publish failed: ${detail}`);
    err.code = 'TELEGRAM_PUBLISH_FAILED';
    throw err;
  }

  return {
    message_id: json.result?.message_id ?? null,
    text:       json.result?.text ?? text,
    raw:        json,
  };
}

export async function publishQueueItemToTelegram(item) {
  const posts = getPostsArray(item);
  if (posts.length === 0) {
    const err = new Error('Queue item has no posts to publish');
    err.code = 'EMPTY_QUEUE_POSTS';
    throw err;
  }

  const published = [];
  let previousMessageId = null;

  for (const post of posts) {
    const msg = await sendMessage({ text: post, replyToMessageId: previousMessageId });
    published.push(msg);
    previousMessageId = msg.message_id;
  }

  return {
    publish_target:    'telegram',
    root_message_id:   published[0]?.message_id ?? null,
    message_ids:       published.map((m) => m.message_id).filter(Boolean),
    count:             published.length,
    responses:         published.map((m) => ({ id: m.message_id, text: m.text })),
  };
}
