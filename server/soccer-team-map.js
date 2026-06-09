/**
 * server/soccer-team-map.js — soccer club identity / alias map across the six
 * supported leagues.
 *
 * Why aliases matter more than ids here: ESPN and The Odds API name the same
 * club differently ("Tottenham Hotspur" vs "Spurs", "Wolverhampton Wanderers"
 * vs "Wolves", "Inter Milan" vs "Internazionale"). The primary job of this map
 * is to normalize those names so odds match the right game. Following the NHL
 * precedent, we do NOT hardcode ESPN numeric ids (not reliable across soccer
 * endpoints) — the numeric event/team id flows through untouched from the
 * scoreboard feed.
 *
 * This is a SEED covering the established clubs in each league. It is meant to
 * be extended: `findSoccerTeam` degrades gracefully and returns the ESPN-
 * provided name for any club not in the seed, so the pipeline works league-wide
 * even before the map is exhaustive. Promoted/relegated clubs change yearly;
 * verify against a live ESPN scoreboard when completing coverage.
 *
 * Each entry: { name (canonical), short, league, aliases }
 */

const SOCCER_TEAMS = [
  // ── Premier League (eng.1) ───────────────────────────────────────────────
  { name: 'Arsenal',                  short: 'ARS', league: 'eng.1', aliases: ['Arsenal FC'] },
  { name: 'Aston Villa',              short: 'AVL', league: 'eng.1', aliases: ['Villa'] },
  { name: 'AFC Bournemouth',          short: 'BOU', league: 'eng.1', aliases: ['Bournemouth'] },
  { name: 'Brentford',                short: 'BRE', league: 'eng.1', aliases: ['Brentford FC'] },
  { name: 'Brighton & Hove Albion',   short: 'BHA', league: 'eng.1', aliases: ['Brighton', 'Brighton and Hove Albion'] },
  { name: 'Chelsea',                  short: 'CHE', league: 'eng.1', aliases: ['Chelsea FC'] },
  { name: 'Crystal Palace',           short: 'CRY', league: 'eng.1', aliases: ['Palace'] },
  { name: 'Everton',                  short: 'EVE', league: 'eng.1', aliases: ['Everton FC'] },
  { name: 'Fulham',                   short: 'FUL', league: 'eng.1', aliases: ['Fulham FC'] },
  { name: 'Liverpool',                short: 'LIV', league: 'eng.1', aliases: ['Liverpool FC'] },
  { name: 'Manchester City',          short: 'MCI', league: 'eng.1', aliases: ['Man City', 'Man. City'] },
  { name: 'Manchester United',        short: 'MUN', league: 'eng.1', aliases: ['Man United', 'Man Utd', 'Man. United'] },
  { name: 'Newcastle United',         short: 'NEW', league: 'eng.1', aliases: ['Newcastle'] },
  { name: 'Nottingham Forest',        short: 'NFO', league: 'eng.1', aliases: ["Nott'm Forest", 'Forest'] },
  { name: 'Tottenham Hotspur',        short: 'TOT', league: 'eng.1', aliases: ['Tottenham', 'Spurs'] },
  { name: 'West Ham United',          short: 'WHU', league: 'eng.1', aliases: ['West Ham'] },
  { name: 'Wolverhampton Wanderers',  short: 'WOL', league: 'eng.1', aliases: ['Wolves', 'Wolverhampton'] },

  // ── La Liga (esp.1) ──────────────────────────────────────────────────────
  { name: 'Real Madrid',              short: 'RMA', league: 'esp.1', aliases: ['Real Madrid CF'] },
  { name: 'Barcelona',                short: 'BAR', league: 'esp.1', aliases: ['FC Barcelona', 'Barça', 'Barca'] },
  { name: 'Atlético Madrid',          short: 'ATM', league: 'esp.1', aliases: ['Atletico Madrid', 'Atletico de Madrid', 'Atlético de Madrid', 'Atletico'] },
  { name: 'Sevilla',                  short: 'SEV', league: 'esp.1', aliases: ['Sevilla FC'] },
  { name: 'Real Sociedad',            short: 'RSO', league: 'esp.1', aliases: ['Sociedad', 'Real Sociedad de Futbol'] },
  { name: 'Real Betis',               short: 'BET', league: 'esp.1', aliases: ['Betis'] },
  { name: 'Villarreal',               short: 'VIL', league: 'esp.1', aliases: ['Villarreal CF'] },
  { name: 'Athletic Club',            short: 'ATH', league: 'esp.1', aliases: ['Athletic Bilbao', 'Bilbao'] },
  { name: 'Valencia',                 short: 'VAL', league: 'esp.1', aliases: ['Valencia CF'] },
  { name: 'Celta Vigo',              short: 'CEL', league: 'esp.1', aliases: ['Celta', 'RC Celta'] },
  { name: 'Getafe',                   short: 'GET', league: 'esp.1', aliases: ['Getafe CF'] },
  { name: 'Osasuna',                  short: 'OSA', league: 'esp.1', aliases: ['CA Osasuna'] },
  { name: 'Girona',                   short: 'GIR', league: 'esp.1', aliases: ['Girona FC'] },
  { name: 'Rayo Vallecano',           short: 'RAY', league: 'esp.1', aliases: ['Rayo'] },
  { name: 'Mallorca',                 short: 'MLL', league: 'esp.1', aliases: ['RCD Mallorca'] },
  { name: 'Espanyol',                 short: 'ESP', league: 'esp.1', aliases: ['RCD Espanyol'] },

  // ── Serie A (ita.1) ──────────────────────────────────────────────────────
  { name: 'Inter Milan',              short: 'INT', league: 'ita.1', aliases: ['Inter', 'Internazionale', 'FC Internazionale'] },
  { name: 'AC Milan',                 short: 'MIL', league: 'ita.1', aliases: ['Milan'] },
  { name: 'Juventus',                 short: 'JUV', league: 'ita.1', aliases: ['Juve'] },
  { name: 'Napoli',                   short: 'NAP', league: 'ita.1', aliases: ['SSC Napoli'] },
  { name: 'Roma',                     short: 'ROM', league: 'ita.1', aliases: ['AS Roma'] },
  { name: 'Lazio',                    short: 'LAZ', league: 'ita.1', aliases: ['SS Lazio'] },
  { name: 'Atalanta',                 short: 'ATA', league: 'ita.1', aliases: ['Atalanta BC'] },
  { name: 'Fiorentina',              short: 'FIO', league: 'ita.1', aliases: ['ACF Fiorentina'] },
  { name: 'Bologna',                  short: 'BOL', league: 'ita.1', aliases: ['Bologna FC'] },
  { name: 'Torino',                   short: 'TOR', league: 'ita.1', aliases: ['Torino FC'] },
  { name: 'Udinese',                  short: 'UDI', league: 'ita.1', aliases: ['Udinese Calcio'] },
  { name: 'Genoa',                    short: 'GEN', league: 'ita.1', aliases: ['Genoa CFC'] },
  { name: 'Cagliari',                 short: 'CAG', league: 'ita.1', aliases: ['Cagliari Calcio'] },
  { name: 'Como',                     short: 'COM', league: 'ita.1', aliases: ['Como 1907'] },

  // ── Bundesliga (ger.1) ───────────────────────────────────────────────────
  { name: 'Bayern Munich',            short: 'BAY', league: 'ger.1', aliases: ['Bayern München', 'FC Bayern', 'FC Bayern München', 'Bayern'] },
  { name: 'Borussia Dortmund',        short: 'BVB', league: 'ger.1', aliases: ['Dortmund', 'BVB'] },
  { name: 'RB Leipzig',               short: 'RBL', league: 'ger.1', aliases: ['Leipzig'] },
  { name: 'Bayer Leverkusen',         short: 'B04', league: 'ger.1', aliases: ['Leverkusen', 'Bayer 04 Leverkusen'] },
  { name: 'Eintracht Frankfurt',      short: 'SGE', league: 'ger.1', aliases: ['Frankfurt'] },
  { name: 'VfB Stuttgart',            short: 'VFB', league: 'ger.1', aliases: ['Stuttgart'] },
  { name: 'Borussia Mönchengladbach', short: 'BMG', league: 'ger.1', aliases: ['Monchengladbach', 'Mönchengladbach', 'Gladbach', "M'gladbach", "Borussia M'gladbach"] },
  { name: 'VfL Wolfsburg',            short: 'WOB', league: 'ger.1', aliases: ['Wolfsburg'] },
  { name: 'Werder Bremen',            short: 'SVW', league: 'ger.1', aliases: ['Bremen'] },
  { name: 'TSG Hoffenheim',           short: 'TSG', league: 'ger.1', aliases: ['Hoffenheim', '1899 Hoffenheim'] },
  { name: 'SC Freiburg',              short: 'SCF', league: 'ger.1', aliases: ['Freiburg'] },
  { name: 'Mainz 05',                 short: 'M05', league: 'ger.1', aliases: ['Mainz', '1. FSV Mainz 05'] },
  { name: 'Union Berlin',             short: 'FCU', league: 'ger.1', aliases: ['1. FC Union Berlin'] },
  { name: 'FC Augsburg',              short: 'FCA', league: 'ger.1', aliases: ['Augsburg'] },

  // ── Ligue 1 (fra.1) ──────────────────────────────────────────────────────
  { name: 'Paris Saint-Germain',      short: 'PSG', league: 'fra.1', aliases: ['PSG', 'Paris SG', 'Paris'] },
  { name: 'Marseille',                short: 'OM',  league: 'fra.1', aliases: ['Olympique Marseille', 'Olympique de Marseille'] },
  { name: 'Monaco',                   short: 'ASM', league: 'fra.1', aliases: ['AS Monaco'] },
  { name: 'Lille',                    short: 'LIL', league: 'fra.1', aliases: ['LOSC Lille', 'Lille OSC'] },
  { name: 'Lyon',                     short: 'OL',  league: 'fra.1', aliases: ['Olympique Lyonnais', 'Olympique Lyon'] },
  { name: 'Nice',                     short: 'NIC', league: 'fra.1', aliases: ['OGC Nice'] },
  { name: 'Lens',                     short: 'RCL', league: 'fra.1', aliases: ['RC Lens'] },
  { name: 'Rennes',                   short: 'REN', league: 'fra.1', aliases: ['Stade Rennais', 'Stade Rennais FC'] },
  { name: 'Strasbourg',               short: 'STR', league: 'fra.1', aliases: ['RC Strasbourg', 'RC Strasbourg Alsace'] },
  { name: 'Nantes',                   short: 'NAN', league: 'fra.1', aliases: ['FC Nantes'] },
  { name: 'Toulouse',                 short: 'TFC', league: 'fra.1', aliases: ['Toulouse FC'] },
  { name: 'Brest',                    short: 'BRE', league: 'fra.1', aliases: ['Stade Brestois', 'Stade Brestois 29'] },

  // ── MLS (usa.1) ──────────────────────────────────────────────────────────
  { name: 'LA Galaxy',                short: 'LAG', league: 'usa.1', aliases: ['Los Angeles Galaxy'] },
  { name: 'Los Angeles FC',           short: 'LAFC', league: 'usa.1', aliases: ['LAFC'] },
  { name: 'Inter Miami CF',           short: 'MIA', league: 'usa.1', aliases: ['Inter Miami'] },
  { name: 'Seattle Sounders FC',      short: 'SEA', league: 'usa.1', aliases: ['Seattle Sounders', 'Seattle'] },
  { name: 'Atlanta United FC',        short: 'ATL', league: 'usa.1', aliases: ['Atlanta United', 'Atlanta'] },
  { name: 'Portland Timbers',         short: 'POR', league: 'usa.1', aliases: ['Portland'] },
  { name: 'New York City FC',         short: 'NYC', league: 'usa.1', aliases: ['NYCFC', 'New York City'] },
  { name: 'New York Red Bulls',       short: 'RBNY', league: 'usa.1', aliases: ['NY Red Bulls', 'Red Bulls'] },
  { name: 'Columbus Crew',            short: 'CLB', league: 'usa.1', aliases: ['Columbus'] },
  { name: 'Philadelphia Union',       short: 'PHI', league: 'usa.1', aliases: ['Philadelphia'] },
  { name: 'FC Cincinnati',            short: 'CIN', league: 'usa.1', aliases: ['Cincinnati'] },
  { name: 'Nashville SC',             short: 'NSH', league: 'usa.1', aliases: ['Nashville'] },
  { name: 'Austin FC',                short: 'ATX', league: 'usa.1', aliases: ['Austin'] },
  { name: 'Toronto FC',               short: 'TOR', league: 'usa.1', aliases: ['Toronto'] },

  // ── FIFA World Cup (fifa.world) — national teams ─────────────────────────
  { name: 'Argentina',       short: 'ARG', league: 'fifa.world', aliases: [] },
  { name: 'Brazil',          short: 'BRA', league: 'fifa.world', aliases: ['Brasil'] },
  { name: 'France',          short: 'FRA', league: 'fifa.world', aliases: [] },
  { name: 'England',         short: 'ENG', league: 'fifa.world', aliases: ['Three Lions'] },
  { name: 'Spain',           short: 'ESP', league: 'fifa.world', aliases: [] },
  { name: 'Portugal',        short: 'POR', league: 'fifa.world', aliases: [] },
  { name: 'Germany',         short: 'GER', league: 'fifa.world', aliases: ['Deutschland'] },
  { name: 'Netherlands',     short: 'NED', league: 'fifa.world', aliases: ['Holland'] },
  { name: 'Belgium',         short: 'BEL', league: 'fifa.world', aliases: [] },
  { name: 'Italy',           short: 'ITA', league: 'fifa.world', aliases: [] },
  { name: 'United States',   short: 'USA', league: 'fifa.world', aliases: ['USMNT', 'United States of America', 'US', 'USA Men'] },
  { name: 'Mexico',          short: 'MEX', league: 'fifa.world', aliases: [] },
  { name: 'Canada',          short: 'CAN', league: 'fifa.world', aliases: [] },
  { name: 'Uruguay',         short: 'URU', league: 'fifa.world', aliases: [] },
  { name: 'Colombia',        short: 'COL', league: 'fifa.world', aliases: [] },
  { name: 'Ecuador',         short: 'ECU', league: 'fifa.world', aliases: [] },
  { name: 'Chile',           short: 'CHI', league: 'fifa.world', aliases: [] },
  { name: 'Venezuela',       short: 'VEN', league: 'fifa.world', aliases: [] },
  { name: 'Paraguay',        short: 'PAR', league: 'fifa.world', aliases: [] },
  { name: 'Peru',            short: 'PER', league: 'fifa.world', aliases: [] },
  { name: 'Bolivia',         short: 'BOL', league: 'fifa.world', aliases: [] },
  { name: 'Morocco',         short: 'MAR', league: 'fifa.world', aliases: ['Maroc'] },
  { name: 'Senegal',         short: 'SEN', league: 'fifa.world', aliases: [] },
  { name: 'Nigeria',         short: 'NGA', league: 'fifa.world', aliases: ['Super Eagles'] },
  { name: 'Cameroon',        short: 'CMR', league: 'fifa.world', aliases: ['Indomitable Lions'] },
  { name: 'Ivory Coast',     short: 'CIV', league: 'fifa.world', aliases: ["Cote d'Ivoire", "Côte d'Ivoire", 'Cote dIvoire'] },
  { name: 'Egypt',           short: 'EGY', league: 'fifa.world', aliases: [] },
  { name: 'Ghana',           short: 'GHA', league: 'fifa.world', aliases: ['Black Stars'] },
  { name: 'South Africa',    short: 'RSA', league: 'fifa.world', aliases: [] },
  { name: 'Japan',           short: 'JPN', league: 'fifa.world', aliases: ['Samurai Blue'] },
  { name: 'South Korea',     short: 'KOR', league: 'fifa.world', aliases: ['Korea Republic', 'Korea Rep', 'Republic of Korea', 'Korea'] },
  { name: 'Australia',       short: 'AUS', league: 'fifa.world', aliases: ['Socceroos'] },
  { name: 'Iran',            short: 'IRN', league: 'fifa.world', aliases: ['IR Iran', 'Islamic Republic of Iran'] },
  { name: 'Saudi Arabia',    short: 'KSA', league: 'fifa.world', aliases: ['Saudi', 'KSA'] },
  { name: 'Qatar',           short: 'QAT', league: 'fifa.world', aliases: [] },
  { name: 'China',           short: 'CHN', league: 'fifa.world', aliases: ["China PR", 'PR China'] },
  { name: 'Indonesia',       short: 'IDN', league: 'fifa.world', aliases: [] },
  { name: 'Turkey',          short: 'TUR', league: 'fifa.world', aliases: ['Türkiye', 'Turkiye'] },
  { name: 'Croatia',         short: 'CRO', league: 'fifa.world', aliases: ['Hrvatska'] },
  { name: 'Denmark',         short: 'DEN', league: 'fifa.world', aliases: [] },
  { name: 'Switzerland',     short: 'SUI', league: 'fifa.world', aliases: ['Swiss'] },
  { name: 'Poland',          short: 'POL', league: 'fifa.world', aliases: [] },
  { name: 'Austria',         short: 'AUT', league: 'fifa.world', aliases: [] },
  { name: 'Serbia',          short: 'SRB', league: 'fifa.world', aliases: [] },
  { name: 'Czech Republic',  short: 'CZE', league: 'fifa.world', aliases: ['Czechia'] },
  { name: 'Hungary',         short: 'HUN', league: 'fifa.world', aliases: [] },
  { name: 'Slovakia',        short: 'SVK', league: 'fifa.world', aliases: [] },
  { name: 'Scotland',        short: 'SCO', league: 'fifa.world', aliases: [] },
  { name: 'Wales',           short: 'WAL', league: 'fifa.world', aliases: ['Cymru'] },
  { name: 'New Zealand',     short: 'NZL', league: 'fifa.world', aliases: ['All Whites'] },
];

function normalize(str) {
  return String(str ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|ac|ss|ssc|as|rc|rcd|ca|cfc|bc|calcio|club)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Find a club by any of its names/aliases, optionally scoped to a league.
 * Returns null when not found — callers should fall back to the raw ESPN name.
 */
export function findSoccerTeam(nameOrAbbr, leagueSlug = null) {
  if (!nameOrAbbr) return null;
  const q = normalize(nameOrAbbr);
  const up = String(nameOrAbbr).trim().toUpperCase();
  const pool = leagueSlug
    ? SOCCER_TEAMS.filter((t) => t.league === leagueSlug)
    : SOCCER_TEAMS;

  for (const team of pool) {
    if (team.short === up) return team;
    if (normalize(team.name) === q) return team;
    if (team.aliases.some((a) => normalize(a) === q)) return team;
  }
  return null;
}

/**
 * Canonical club name for odds matching. Falls back to the input name when the
 * club isn't seeded so unseeded clubs still flow through the pipeline.
 */
export function normalizeSoccerTeamName(name, leagueSlug = null) {
  const team = findSoccerTeam(name, leagueSlug);
  return team?.name ?? (name ?? null);
}

export function getSoccerTeamsByLeague(leagueSlug) {
  return SOCCER_TEAMS.filter((t) => t.league === leagueSlug);
}

export const SOCCER_TEAM_COUNT = SOCCER_TEAMS.length;

export default SOCCER_TEAMS;
