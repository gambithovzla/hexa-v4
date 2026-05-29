/**
 * threadsPublisher.js — Meta Threads publisher adapter (B4).
 *
 * Uses the Threads API v1 (Meta Graph API) to publish text posts.
 * Follows the 2-step process: create container → publish.
 *
 * Required env:
 *   THREADS_ENABLED=1
 *   THREADS_ACCESS_TOKEN     — long-lived user access token with threads_basic + threads_content_publish
 *   THREADS_USER_ID          — numeric Threads user ID
 *
 * Content queue: publish_target = 'threads' routes here via contentQueueService.
 */

const THREADS_BASE = 'https://graph.threads.net/v1.0';
const MAX_LENGTH = 500;

export function isThreadsConfigured() {
  return process.env.THREADS_ENABLED === '1' &&
    Boolean(process.env.THREADS_ACCESS_TOKEN) &&
    Boolean(process.env.THREADS_USER_ID);
}

/**
 * Create a Threads media container for a text post.
 * Returns the container ID.
 */
async function createContainer(text) {
  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;

  const body = new URLSearchParams({
    media_type: 'TEXT',
    text: text.slice(0, MAX_LENGTH),
    access_token: token,
  });

  const res = await fetch(`${THREADS_BASE}/${userId}/threads`, {
    method: 'POST',
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Threads container error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.id;
}

/**
 * Publish a previously created container.
 */
async function publishContainer(containerId) {
  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;

  const body = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });

  const res = await fetch(`${THREADS_BASE}/${userId}/threads_publish`, {
    method: 'POST',
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Threads publish error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.id;
}

/**
 * Publish a content queue item to Threads.
 * Each post in item.posts becomes one Threads text post.
 *
 * @param {object} item — content queue item with posts array
 * @returns {{ publish_target, post_ids, count }}
 */
export async function publishQueueItemToThreads(item) {
  if (!isThreadsConfigured()) {
    throw Object.assign(new Error('Threads not configured'), { code: 'THREADS_NOT_CONFIGURED' });
  }

  const posts = item.posts ?? [];
  if (!posts.length) {
    throw Object.assign(new Error('No posts in queue item'), { code: 'EMPTY_QUEUE_POSTS' });
  }

  const postIds = [];

  for (const post of posts) {
    const text = (post.content ?? '').slice(0, MAX_LENGTH);
    if (!text.trim()) continue;

    // Threads requires a brief pause between container creation and publish
    const containerId = await createContainer(text);
    await new Promise(r => setTimeout(r, 1000));
    const postId = await publishContainer(containerId);
    postIds.push(postId);

    console.log(`[threads] Published post ${postId}`);
  }

  return { publish_target: 'threads', post_ids: postIds, count: postIds.length };
}
