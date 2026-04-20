import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const X_API_BASE_URL = process.env.X_API_BASE_URL || 'https://api.x.com';

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseJsonMaybe(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getPostsArray(item) {
  const posts = parseJsonMaybe(item?.posts);
  if (!Array.isArray(posts)) return [];
  return posts.map((post) => cleanText(post)).filter(Boolean);
}

function getOAuth1Credentials() {
  const consumerKey = process.env.X_CONSUMER_KEY || process.env.X_API_KEY || '';
  const consumerSecret = process.env.X_CONSUMER_SECRET || process.env.X_API_SECRET || '';
  const accessToken = process.env.X_ACCESS_TOKEN || '';
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET || '';

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    return null;
  }

  return {
    consumerKey,
    consumerSecret,
    accessToken,
    accessTokenSecret,
  };
}

function percentEncode(value) {
  return encodeURIComponent(String(value ?? ''))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuth1Header({ method, url, credentials }) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const parsedUrl = new URL(url);
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;

  const oauthParams = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  const allParams = [];
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    allParams.push([percentEncode(key), percentEncode(value)]);
  }
  for (const [key, value] of Object.entries(oauthParams)) {
    allParams.push([percentEncode(key), percentEncode(value)]);
  }

  allParams.sort((a, b) => {
    if (a[0] === b[0]) return a[1].localeCompare(b[1]);
    return a[0].localeCompare(b[0]);
  });

  const normalizedParams = allParams.map(([key, value]) => `${key}=${value}`).join('&');
  const signatureBaseString = [
    String(method ?? 'POST').toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalizedParams),
  ].join('&');

  const signingKey = `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.accessTokenSecret)}`;
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  const headerParams = {
    ...oauthParams,
    oauth_signature: signature,
  };

  return 'OAuth ' + Object.entries(headerParams)
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(', ');
}

export function isXPublishingConfigured() {
  return Boolean(getOAuth1Credentials() || process.env.X_USER_ACCESS_TOKEN);
}

async function createTweet({ text, replyToId = null }) {
  const bearerToken = process.env.X_USER_ACCESS_TOKEN;
  const oauth1 = getOAuth1Credentials();

  if (!oauth1 && !bearerToken) {
    const err = new Error('X publishing credentials are not configured');
    err.code = 'X_NOT_CONFIGURED';
    throw err;
  }

  const body = replyToId
    ? { text, reply: { in_reply_to_tweet_id: String(replyToId) } }
    : { text };
  const url = `${X_API_BASE_URL}/2/tweets`;
  const headers = {
    'Content-Type': 'application/json',
  };

  if (oauth1) {
    headers.Authorization = buildOAuth1Header({
      method: 'POST',
      url,
      credentials: oauth1,
    });
  } else {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = json?.detail || json?.title || json?.error || response.statusText;
    const err = new Error(`X publish failed: ${detail}`);
    err.code = 'X_PUBLISH_FAILED';
    throw err;
  }

  return {
    id: json?.data?.id ?? null,
    text: json?.data?.text ?? text,
    raw: json,
  };
}

export async function publishQueueItemToX(item) {
  const posts = getPostsArray(item);
  if (posts.length === 0) {
    const err = new Error('Queue item has no posts to publish');
    err.code = 'EMPTY_QUEUE_POSTS';
    throw err;
  }

  const published = [];
  let previousId = null;

  for (const post of posts) {
    const tweet = await createTweet({ text: post, replyToId: previousId });
    published.push(tweet);
    previousId = tweet.id;
  }

  return {
    publish_target: 'x',
    root_post_id: published[0]?.id ?? null,
    post_ids: published.map((tweet) => tweet.id).filter(Boolean),
    count: published.length,
    responses: published.map((tweet) => ({ id: tweet.id, text: tweet.text })),
  };
}
