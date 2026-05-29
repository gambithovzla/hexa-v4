/**
 * discordBot.js — H.E.X.A. Discord bot (B3).
 *
 * Slash commands:
 *   /today            — slate summary for today's MLB games
 *   /pick <gameId>    — Oracle analysis for a specific game (admin only in private channels)
 *   /futures          — MLB futures odds snapshot
 *   /injuries         — recent injury signals from beat reporters
 *
 * Auto-post: responds to the content queue when publish_target = 'discord'
 *            (via the adapter pattern used by xPublisher/telegramPublisher).
 *
 * Feature flag: DISCORD_ENABLED=1
 * Required env:
 *   DISCORD_BOT_TOKEN     — bot token from Discord Developer Portal
 *   DISCORD_GUILD_ID      — server (guild) ID to register slash commands
 *   DISCORD_CHANNEL_ID    — default channel for auto-posts
 *   DISCORD_ADMIN_ROLE    — role ID allowed to run /pick (optional, defaults to server owner)
 */

import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import pool from '../db.js';

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('today')
    .setDescription('Slate summary and top picks for today\'s MLB games'),

  new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Get Oracle analysis for a game')
    .addStringOption(opt =>
      opt.setName('game').setDescription('Game ID or matchup (e.g. "NYY vs BOS")').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('futures')
    .setDescription('MLB futures odds — World Series, AL/NL pennant'),

  new SlashCommandBuilder()
    .setName('injuries')
    .setDescription('Recent injury signals from MLB beat reporters')
    .addStringOption(opt =>
      opt.setName('team').setDescription('Filter by team abbreviation (e.g. NYY)').setRequired(false)
    ),
].map(c => c.toJSON());

let _client = null;
let _ready = false;

export function isDiscordConfigured() {
  return process.env.DISCORD_ENABLED === '1' &&
    Boolean(process.env.DISCORD_BOT_TOKEN) &&
    Boolean(process.env.DISCORD_CHANNEL_ID);
}

/**
 * Register slash commands with Discord (run once on startup or when commands change).
 */
async function registerCommands() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token) return;

  const rest = new REST().setToken(token);
  const clientId = process.env.DISCORD_CLIENT_ID ?? '';
  if (!clientId) { console.warn('[discord] DISCORD_CLIENT_ID not set — skipping command registration'); return; }

  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: COMMANDS });
  console.log(`[discord] Registered ${COMMANDS.length} slash commands`);
}

/**
 * Format a slate summary from the DB (last 50 picks today, highest confidence).
 */
async function buildTodaySlate() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const { rows } = await pool.query(
    `SELECT matchup, pick, confidence, result, created_at
     FROM picks
     WHERE game_date = $1 AND deleted_at IS NULL AND sport = 'mlb'
     ORDER BY confidence DESC NULLS LAST
     LIMIT 10`,
    [today]
  );
  if (!rows.length) return `**No picks found for ${today}**`;

  const lines = rows.map(r => {
    const conf = r.confidence ? ` (${Math.round(r.confidence * 100)}%)` : '';
    const res = r.result && r.result !== 'pending' ? ` → **${r.result.toUpperCase()}**` : '';
    return `• ${r.matchup} | ${r.pick}${conf}${res}`;
  });
  return `**H.E.X.A. Slate — ${today}**\n${lines.join('\n')}`;
}

export async function startDiscordBot() {
  if (!isDiscordConfigured()) {
    console.log('[discord] DISCORD_ENABLED not set or missing token — bot disabled');
    return;
  }

  try {
    await registerCommands();
  } catch (err) {
    console.warn('[discord] Command registration failed:', err.message);
  }

  _client = new Client({ intents: [GatewayIntentBits.Guilds] });

  _client.on('ready', () => {
    _ready = true;
    console.log(`[discord] Bot ready as ${_client.user?.tag}`);
  });

  _client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === 'today') {
        await interaction.deferReply();
        const content = await buildTodaySlate();
        await interaction.editReply(content);

      } else if (interaction.commandName === 'pick') {
        const adminRole = process.env.DISCORD_ADMIN_ROLE;
        const hasRole = adminRole
          ? interaction.member?.roles?.cache?.has(adminRole)
          : interaction.memberPermissions?.has('Administrator');
        if (!hasRole) {
          return interaction.reply({ content: 'This command requires admin role.', ephemeral: true });
        }
        const game = interaction.options.getString('game');
        await interaction.reply({ content: `🔮 Analysis for **${game}** — use the web UI at hexaoracle.lat for full Oracle analysis.`, ephemeral: false });

      } else if (interaction.commandName === 'futures') {
        await interaction.deferReply();
        const { getMlbFutures } = await import('./hexaScoutService.js');
        const futures = await getMlbFutures();
        const ws = futures.filter(f => f.market_key.includes('world_series')).slice(0, 10);
        if (!ws.length) return interaction.editReply('No futures data available at this time.');
        const lines = ws.map(f => `• **${f.team}**: ${f.odds > 0 ? '+' : ''}${f.odds} (${f.implied_prob}%)`);
        await interaction.editReply(`**World Series Futures**\n${lines.join('\n')}`);

      } else if (interaction.commandName === 'injuries') {
        await interaction.deferReply();
        const { getRecentInjurySignals } = await import('./beatReporterService.js');
        const team = interaction.options.getString('team') ?? undefined;
        const signals = await getRecentInjurySignals({ teamAbbr: team, hoursBack: 24, limit: 10 });
        if (!signals.length) return interaction.editReply('No injury signals in the last 24h.');
        const lines = signals.map(s =>
          `• **${s.player_name ?? '?'}** (${s.team_abbr ?? '?'}) — ${s.signal.toUpperCase()} [${(s.confidence * 100).toFixed(0)}%] via @${s.reporter_handle}`
        );
        await interaction.editReply(`**Injury Signals (24h)**\n${lines.join('\n')}`);
      }
    } catch (err) {
      console.error(`[discord] Command error (${interaction.commandName}):`, err.message);
      const msg = { content: 'An error occurred. Please try again.', ephemeral: true };
      if (interaction.deferred) await interaction.editReply(msg.content).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  });

  _client.on('error', err => console.error('[discord] Client error:', err.message));

  await _client.login(process.env.DISCORD_BOT_TOKEN);
}

/**
 * Post a message to the default Discord channel.
 * Called by contentQueueService when publish_target = 'discord'.
 */
export async function publishToDiscord(item) {
  if (!_ready || !_client) throw new Error('DISCORD_NOT_READY');
  const channelId = process.env.DISCORD_CHANNEL_ID;
  const channel = await _client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('DISCORD_CHANNEL_NOT_TEXT');

  const posts = item.posts ?? [];
  if (!posts.length) throw new Error('EMPTY_QUEUE_POSTS');

  const messages = [];
  for (const post of posts) {
    const msg = await channel.send(post.content?.slice(0, 2000) ?? '');
    messages.push(msg.id);
  }

  return { publish_target: 'discord', message_ids: messages, count: messages.length };
}
