/**
 * soccer-weather-api.js — outdoor match-time weather for soccer venues via
 * Open-Meteo (free, no API key). The football analogue of weather-api.js (MLB)
 * and fetchNflWeather (NFL), but with its own stadium coordinate map and
 * soccer-specific interpretation flags.
 *
 * Why a new file: weather-api.js is MLB-coupled (keyed by MLB franchise names),
 * and oracle.js / context-builder.js are frozen. Soccer venues live here.
 *
 * Coverage: the established clubs seeded in soccer-team-map.js across the six
 * supported leagues, keyed by canonical club name. Unseeded / unmapped clubs
 * resolve to null and the context builder degrades gracefully (the match runs
 * weather-neutral, exactly as before this module existed).
 *
 * Roofed venues (Bernabéu retractable roof, Stade Pierre-Mauroy, Mercedes-Benz)
 * are treated as weather-neutral — `roof: true`, no flags. Most football is
 * played open-air, where wind and rain genuinely move totals and set pieces.
 *
 * Metric units (°C, km/h) — the football convention, and Open-Meteo's defaults.
 *
 * Every network call degrades to null and never throws (mirrors the other
 * soccer fetchers). Pure helpers exported for tests: getSoccerStadium,
 * soccerWeatherFlags.
 */

import { findSoccerTeam } from './soccer-team-map.js';

// Canonical club name → { lat, lon, name, roof? }. Coordinates are the home
// stadium; precision to ~0.01° is ample for a weather forecast lookup.
const STADIUM_COORDS = {
  // ── Premier League (eng.1) ─────────────────────────────────────────────────
  'Arsenal':                     { lat: 51.5549, lon: -0.1084, name: 'Emirates Stadium' },
  'Aston Villa':                 { lat: 52.5092, lon: -1.8849, name: 'Villa Park' },
  'AFC Bournemouth':             { lat: 50.7352, lon: -1.8384, name: 'Vitality Stadium' },
  'Brentford':                   { lat: 51.4906, lon: -0.2889, name: 'Gtech Community Stadium' },
  'Brighton & Hove Albion':      { lat: 50.8616, lon: -0.0838, name: 'Amex Stadium' },
  'Chelsea':                     { lat: 51.4817, lon: -0.1910, name: 'Stamford Bridge' },
  'Everton':                     { lat: 53.4388, lon: -2.9663, name: 'Goodison Park' },
  'Fulham':                      { lat: 51.4749, lon: -0.2217, name: 'Craven Cottage' },
  'Liverpool':                   { lat: 53.4308, lon: -2.9608, name: 'Anfield' },
  'Manchester City':             { lat: 53.4831, lon: -2.2004, name: 'Etihad Stadium' },
  'Manchester United':           { lat: 53.4631, lon: -2.2913, name: 'Old Trafford' },
  'Newcastle United':            { lat: 54.9756, lon: -1.6217, name: "St James' Park" },
  'Nottingham Forest':           { lat: 52.9400, lon: -1.1327, name: 'City Ground' },
  'Tottenham Hotspur':           { lat: 51.6043, lon: -0.0664, name: 'Tottenham Hotspur Stadium' },
  'West Ham United':             { lat: 51.5386, lon: -0.0166, name: 'London Stadium' },
  'Wolverhampton Wanderers':     { lat: 52.5903, lon: -2.1303, name: 'Molineux' },

  // ── La Liga (esp.1) ────────────────────────────────────────────────────────
  'Real Madrid':                 { lat: 40.4531, lon: -3.6883, name: 'Santiago Bernabéu', roof: true },
  'Barcelona':                   { lat: 41.3809, lon:  2.1228, name: 'Camp Nou' },
  'Atlético Madrid':             { lat: 40.4362, lon: -3.5995, name: 'Riyadh Air Metropolitano' },
  'Sevilla':                     { lat: 37.3841, lon: -5.9706, name: 'Ramón Sánchez-Pizjuán' },
  'Real Sociedad':               { lat: 43.3017, lon: -1.9735, name: 'Reale Arena' },
  'Real Betis':                  { lat: 37.3564, lon: -5.9817, name: 'Benito Villamarín' },
  'Villarreal':                  { lat: 39.9440, lon: -0.1036, name: 'Estadio de la Cerámica' },
  'Athletic Club':               { lat: 43.2641, lon: -2.9496, name: 'San Mamés' },
  'Valencia':                    { lat: 39.4747, lon: -0.3582, name: 'Mestalla' },
  'Celta Vigo':                  { lat: 42.2118, lon: -8.7397, name: 'Balaídos' },
  'Getafe':                      { lat: 40.3258, lon: -3.7147, name: 'Coliseum' },
  'Osasuna':                     { lat: 42.7967, lon: -1.6369, name: 'El Sadar' },
  'Girona':                      { lat: 41.9613, lon:  2.8285, name: 'Montilivi' },
  'Rayo Vallecano':              { lat: 40.3920, lon: -3.6586, name: 'Estadio de Vallecas' },
  'Mallorca':                    { lat: 39.5896, lon:  2.6303, name: 'Son Moix' },
  'Espanyol':                    { lat: 41.3475, lon:  2.0750, name: 'RCDE Stadium' },

  // ── Serie A (ita.1) ────────────────────────────────────────────────────────
  'Inter Milan':                 { lat: 45.4781, lon:  9.1240, name: 'San Siro' },
  'AC Milan':                    { lat: 45.4781, lon:  9.1240, name: 'San Siro' },
  'Juventus':                    { lat: 45.1097, lon:  7.6413, name: 'Allianz Stadium' },
  'Napoli':                      { lat: 40.8279, lon: 14.1931, name: 'Stadio Diego Armando Maradona' },
  'Roma':                        { lat: 41.9339, lon: 12.4547, name: 'Stadio Olimpico' },
  'Lazio':                       { lat: 41.9339, lon: 12.4547, name: 'Stadio Olimpico' },
  'Atalanta':                    { lat: 45.7090, lon:  9.6809, name: 'Gewiss Stadium' },
  'Fiorentina':                  { lat: 43.7809, lon: 11.2820, name: 'Stadio Artemio Franchi' },
  'Bologna':                     { lat: 44.4923, lon: 11.3097, name: "Stadio Renato Dall'Ara" },
  'Torino':                      { lat: 45.0418, lon:  7.6500, name: 'Stadio Olimpico Grande Torino' },
  'Udinese':                     { lat: 46.0815, lon: 13.2002, name: 'Bluenergy Stadium' },
  'Genoa':                       { lat: 44.4164, lon:  8.9526, name: 'Stadio Luigi Ferraris' },
  'Cagliari':                    { lat: 39.2000, lon:  9.1374, name: 'Unipol Domus' },
  'Como':                        { lat: 45.8141, lon:  9.0699, name: 'Stadio Giuseppe Sinigaglia' },

  // ── Bundesliga (ger.1) ─────────────────────────────────────────────────────
  'Bayern Munich':               { lat: 48.2188, lon: 11.6247, name: 'Allianz Arena' },
  'Borussia Dortmund':           { lat: 51.4926, lon:  7.4518, name: 'Signal Iduna Park' },
  'RB Leipzig':                  { lat: 51.3459, lon: 12.3483, name: 'Red Bull Arena' },
  'Bayer Leverkusen':            { lat: 51.0383, lon:  7.0021, name: 'BayArena' },
  'Eintracht Frankfurt':         { lat: 50.0686, lon:  8.6456, name: 'Deutsche Bank Park' },
  'VfB Stuttgart':               { lat: 48.7924, lon:  9.2320, name: 'MHPArena' },
  'Borussia Mönchengladbach':    { lat: 51.1746, lon:  6.3856, name: 'Borussia-Park' },
  'VfL Wolfsburg':               { lat: 52.4319, lon: 10.8039, name: 'Volkswagen Arena' },
  'Werder Bremen':               { lat: 53.0664, lon:  8.8378, name: 'Weserstadion' },
  'TSG Hoffenheim':              { lat: 49.2386, lon:  8.8875, name: 'PreZero Arena' },
  'SC Freiburg':                 { lat: 48.0217, lon:  7.8298, name: 'Europa-Park Stadion' },
  'Mainz 05':                    { lat: 49.9841, lon:  8.2244, name: 'Mewa Arena' },
  'Union Berlin':                { lat: 52.4574, lon: 13.5681, name: 'An der Alten Försterei' },
  'FC Augsburg':                 { lat: 48.3231, lon: 10.8861, name: 'WWK Arena' },

  // ── Ligue 1 (fra.1) ────────────────────────────────────────────────────────
  'Paris Saint-Germain':         { lat: 48.8414, lon:  2.2530, name: 'Parc des Princes' },
  'Marseille':                   { lat: 43.2699, lon:  5.3958, name: 'Stade Vélodrome' },
  'Monaco':                      { lat: 43.7277, lon:  7.4156, name: 'Stade Louis II' },
  'Lille':                       { lat: 50.6119, lon:  3.1304, name: 'Stade Pierre-Mauroy', roof: true },
  'Lyon':                        { lat: 45.7653, lon:  4.9822, name: 'Groupama Stadium' },
  'Nice':                        { lat: 43.7053, lon:  7.1925, name: 'Allianz Riviera' },
  'Lens':                        { lat: 50.4328, lon:  2.8153, name: 'Stade Bollaert-Delelis' },
  'Rennes':                      { lat: 48.1075, lon: -1.7128, name: 'Roazhon Park' },
  'Strasbourg':                  { lat: 48.5601, lon:  7.7551, name: 'Stade de la Meinau' },
  'Nantes':                      { lat: 47.2559, lon: -1.5249, name: 'Stade de la Beaujoire' },
  'Toulouse':                    { lat: 43.5833, lon:  1.4342, name: 'Stadium de Toulouse' },
  'Brest':                       { lat: 48.4028, lon: -4.4615, name: 'Stade Francis-Le Blé' },

  // ── MLS (usa.1) ────────────────────────────────────────────────────────────
  'LA Galaxy':                   { lat: 33.8644, lon: -118.2611, name: 'Dignity Health Sports Park' },
  'Los Angeles FC':              { lat: 34.0128, lon: -118.2848, name: 'BMO Stadium' },
  'Inter Miami CF':              { lat: 26.1934, lon:  -80.1614, name: 'Chase Stadium' },
  'Seattle Sounders FC':         { lat: 47.5952, lon: -122.3316, name: 'Lumen Field' },
  'Atlanta United FC':           { lat: 33.7553, lon:  -84.4006, name: 'Mercedes-Benz Stadium', roof: true },
  'Portland Timbers':            { lat: 45.5215, lon: -122.6916, name: 'Providence Park' },
  'New York City FC':            { lat: 40.8296, lon:  -73.9262, name: 'Yankee Stadium' },
  'New York Red Bulls':          { lat: 40.7369, lon:  -74.1503, name: 'Red Bull Arena' },
  'Columbus Crew':               { lat: 39.9685, lon:  -83.0166, name: 'Lower.com Field' },
  'Philadelphia Union':          { lat: 39.8328, lon:  -75.3782, name: 'Subaru Park' },
  'FC Cincinnati':               { lat: 39.1112, lon:  -84.5222, name: 'TQL Stadium' },
  'Nashville SC':                { lat: 36.1306, lon:  -86.7656, name: 'Geodis Park' },
  'Austin FC':                   { lat: 30.3880, lon:  -97.7194, name: 'Q2 Stadium' },
  'Toronto FC':                  { lat: 43.6332, lon:  -79.4185, name: 'BMO Field' },
};

/**
 * Resolve the home club's stadium via the canonical club name. Falls back to a
 * raw-name lookup so an unseeded ESPN name still matches when it happens to be
 * canonical. Returns { lat, lon, name, roof? } or null.
 */
export function getSoccerStadium(teamName, leagueSlug = null) {
  if (!teamName) return null;
  const seeded = findSoccerTeam(teamName, leagueSlug);
  const canonical = seeded?.name ?? teamName;
  return STADIUM_COORDS[canonical] ?? STADIUM_COORDS[teamName] ?? null;
}

/**
 * Soccer-specific interpretation of match-time conditions. Metric units.
 * Wind disrupts passing/crossing/set-piece accuracy; cold/heat slow tempo;
 * rain makes the surface slick and error-prone — all nudge toward variance and
 * (mildly) UNDER. Pure function, exported for tests.
 */
export function soccerWeatherFlags(tempC, windKmh, precipPct) {
  const flags = [];
  if (windKmh != null) {
    if (windKmh > 45)      flags.push(`HIGH WIND ${Math.round(windKmh)}km/h — disrupts passing, crossing & set pieces, adds variance, mild UNDER lean`);
    else if (windKmh > 30) flags.push(`WIND ${Math.round(windKmh)}km/h — affects long balls & set-piece accuracy`);
  }
  if (tempC != null) {
    if (tempC > 30)        flags.push(`HOT ${Math.round(tempC)}°C — slower tempo, dehydration, favor UNDER`);
    else if (tempC < 0)    flags.push(`FREEZING ${Math.round(tempC)}°C — heavy/slick pitch, favor UNDER`);
  }
  if (precipPct != null) {
    if (precipPct > 60)    flags.push(`HEAVY RAIN ${Math.round(precipPct)}% — slick surface, error-prone, variance up`);
    else if (precipPct > 40) flags.push(`RAIN ${Math.round(precipPct)}% — wet surface, ball handling & pace affected`);
  }
  return flags;
}

/**
 * Match-time weather for a soccer fixture, keyed off the home club's venue.
 *
 * @param {object} opts
 * @param {string} opts.homeTeamName     — ESPN/canonical home club name
 * @param {string} [opts.leagueSlug]     — narrows the stadium lookup
 * @param {string|Date} [opts.gameTime]  — kickoff; picks the closest hourly slot
 * @returns {Promise<object|null>} weather block, or null when the venue is
 *   unmapped or the fetch fails. Roofed venues return a weather-neutral block.
 */
export async function getSoccerWeather({ homeTeamName, leagueSlug = null, gameTime = null }) {
  const stadium = getSoccerStadium(homeTeamName, leagueSlug);
  if (!stadium) return null;

  if (stadium.roof) {
    return { stadium: stadium.name, roof: true, analysis: [] };
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${stadium.lat}&longitude=${stadium.lon}` +
      `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
      `&timezone=auto&forecast_days=2`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let data;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      data = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    const times = data?.hourly?.time ?? [];
    if (!times.length) return null;

    // Most top-flight kickoffs are mid-afternoon to evening; default 16:00 local.
    const gameHour = gameTime ? new Date(gameTime).getHours() : 16;
    let idx = times.findIndex(t => new Date(t).getHours() >= gameHour);
    if (idx === -1) idx = times.length - 1;

    const temp   = data.hourly.temperature_2m?.[idx] ?? null;
    const wind   = data.hourly.windspeed_10m?.[idx] ?? null;
    const precip = data.hourly.precipitation_probability?.[idx] ?? null;

    return {
      stadium: stadium.name,
      roof: false,
      temperature: temp,
      windSpeed: wind,
      windDirection: data.hourly.winddirection_10m?.[idx] ?? null,
      precipitationProbability: precip,
      weatherCode: data.hourly.weathercode?.[idx] ?? null,
      analysis: soccerWeatherFlags(temp, wind, precip),
    };
  } catch (err) {
    console.warn(`[soccer-weather] fetch failed for ${homeTeamName}: ${err.message}`);
    return null;
  }
}

export default { getSoccerWeather, getSoccerStadium, soccerWeatherFlags };
