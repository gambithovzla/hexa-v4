/**
 * beatReporterService.js — Beat reporters injury signal classifier.
 *
 * Fetches recent posts from curated beat reporter X accounts and classifies
 * each post as an injury signal using Haiku (fast, cheap, domain-specific).
 *
 * Signal types:
 *   'playing'   — player confirmed active / returned to lineup
 *   'doubtful'  — questionable / day-to-day / limited practice
 *   'out'       — confirmed out / DL / scratched from lineup
 *   'none'      — not an injury-related post
 *
 * Results are written to `beat_injury_signals` table (created by migration)
 * and exposed via GET /api/mlb/injury-signals (admin).
 *
 * Required env vars for X scraping:
 *   X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 *   (same credentials used by xPublisher.js)
 *
 * Feature flag: BEAT_REPORTER_ENABLED=1
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';

const BEAT_REPORTERS = [
  // MLB beat reporters with injury-relevant tweet volume
  // Format: { handle, team, league }
  { handle: 'JeffPassan',    team: null,  league: 'mlb' },
  { handle: 'BNightengale',  team: null,  league: 'mlb' },
  { handle: 'JonHeyman',     team: null,  league: 'mlb' },
  { handle: 'MikeRousseau',  team: 'NYY', league: 'mlb' },
  { handle: 'BryanHoch',     team: 'NYY', league: 'mlb' },
  { handle: 'IanBrowne',     team: 'BOS', league: 'mlb' },
  { handle: 'BobNightengale', team: null, league: 'mlb' },
  { handle: 'SarahLangdon',  team: 'LAD', league: 'mlb' },
  { handle: 'pedromoura',    team: 'LAD', league: 'mlb' },
  { handle: 'kennedymark',   team: 'HOU', league: 'mlb' },
  { handle: 'mlbtraderumors', team: null, league: 'mlb' },
];

const HAIKU_MODEL = process.env.HAIKU_INJURY_MODEL || 'claude-haiku-4-5-20251001';

const CLASSIFICATION_PROMPT = `You are an injury signal classifier for MLB.
Given a tweet text, classify it as one of:
- "playing" — player confirmed active, returned to lineup, passed health check
- "doubtful" — day-to-day, questionable, limited, might not play, discomfort
- "out" — confirmed out, placed on IL/DL, scratched, out for the season
- "none" — no injury signal, game analysis, stats, trade news, etc.

Respond ONLY with a JSON object:
{"signal": "<type>", "player": "<name or null>", "team": "<abbr or null>", "confidence": 0.0-1.0, "summary": "<10 word max>"}`;

/**
 * Classify a tweet text as an injury signal using Haiku.
 */
export async function classifyInjurySignal(text) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 150,
    messages: [
      { role: 'user', content: `${CLASSIFICATION_PROMPT}\n\nTweet: ${text}` },
    ],
  });
  const raw = message.content[0]?.text?.trim() ?? '';
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { signal: 'none', player: null, team: null, confidence: 0, summary: 'parse error' };
  }
}

/**
 * Fetch recent tweets from a reporter using the X API v2 search endpoint.
 * Requires bearer token auth (from X_CONSUMER_KEY + X_CONSUMER_SECRET).
 */
async function fetchReporterTweets(handle, maxResults = 10) {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    console.warn(`[beat-reporter] X_BEARER_TOKEN not set — cannot fetch tweets for @${handle}`);
    return [];
  }

  const sinceHours = 2;
  const startTime = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    query: `from:${handle} -is:retweet lang:en`,
    max_results: String(maxResults),
    start_time: startTime,
    'tweet.fields': 'created_at,author_id,text',
  });

  const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (!res.ok) {
    console.warn(`[beat-reporter] X API ${res.status} for @${handle}: ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  return (data.data ?? []).map(t => ({ id: t.id, text: t.text, created_at: t.created_at, handle }));
}

/**
 * Run the full beat reporter scan: fetch + classify + persist.
 * Only processes injury signals (signal !== 'none').
 *
 * @returns {{ processed: number, signals: number, errors: string[] }}
 */
export async function runBeatReporterScan() {
  if (process.env.BEAT_REPORTER_ENABLED !== '1') {
    return { processed: 0, signals: 0, errors: ['BEAT_REPORTER_ENABLED not set'] };
  }

  const summary = { processed: 0, signals: 0, errors: [] };

  for (const reporter of BEAT_REPORTERS) {
    let tweets;
    try {
      tweets = await fetchReporterTweets(reporter.handle, 5);
    } catch (err) {
      summary.errors.push(`@${reporter.handle}: ${err.message}`);
      continue;
    }

    for (const tweet of tweets) {
      summary.processed++;
      try {
        const classification = await classifyInjurySignal(tweet.text);

        if (classification.signal === 'none' || classification.confidence < 0.6) continue;

        await pool.query(
          `INSERT INTO beat_injury_signals
             (tweet_id, reporter_handle, reporter_team, tweet_text, tweet_created_at,
              signal, player_name, team_abbr, confidence, summary, classified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (tweet_id) DO NOTHING`,
          [
            tweet.id,
            reporter.handle,
            reporter.team,
            tweet.text,
            tweet.created_at,
            classification.signal,
            classification.player,
            classification.team ?? reporter.team,
            classification.confidence,
            classification.summary,
          ]
        );

        summary.signals++;
        console.log(`[beat-reporter] @${reporter.handle}: ${classification.signal} — ${classification.player ?? '?'} (${classification.confidence.toFixed(2)})`);
      } catch (err) {
        summary.errors.push(`tweet ${tweet.id}: ${err.message}`);
      }
    }
  }

  return summary;
}

/**
 * Get recent injury signals (last 24h), optionally filtered by team.
 */
export async function getRecentInjurySignals({ teamAbbr, hoursBack = 24, limit = 50 } = {}) {
  const args = [hoursBack, limit];
  const teamFilter = teamAbbr ? `AND team_abbr = $3` : '';
  if (teamAbbr) args.push(teamAbbr.toUpperCase());

  const { rows } = await pool.query(
    `SELECT id, reporter_handle, reporter_team, signal, player_name, team_abbr,
            confidence, summary, tweet_text, tweet_created_at, classified_at
     FROM beat_injury_signals
     WHERE classified_at >= NOW() - INTERVAL '1 hour' * $1
       AND signal != 'none'
       ${teamFilter}
     ORDER BY confidence DESC, classified_at DESC
     LIMIT $2`,
    args
  );
  return rows;
}
