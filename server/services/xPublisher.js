import dotenv from 'dotenv';

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

export function isXPublishingConfigured() {
  return Boolean(process.env.X_USER_ACCESS_TOKEN);
}

async function createTweet({ text, replyToId = null }) {
  const token = process.env.X_USER_ACCESS_TOKEN;
  if (!token) {
    const err = new Error('X_USER_ACCESS_TOKEN is not configured');
    err.code = 'X_NOT_CONFIGURED';
    throw err;
  }

  const body = replyToId
    ? { text, reply: { in_reply_to_tweet_id: String(replyToId) } }
    : { text };

  const response = await fetch(`${X_API_BASE_URL}/2/tweets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
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
