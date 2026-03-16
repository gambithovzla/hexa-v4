/**
 * weather-api.js
 * Real-time weather data for MLB stadiums via Open-Meteo (free, no API key required).
 */

const STADIUM_COORDS = {
  'New York Yankees':        { lat: 40.8296, lon: -73.9262, name: 'Yankee Stadium' },
  'New York Mets':           { lat: 40.7571, lon: -73.8458, name: 'Citi Field' },
  'Los Angeles Dodgers':     { lat: 34.0739, lon: -118.2400, name: 'Dodger Stadium' },
  'Los Angeles Angels':      { lat: 33.8003, lon: -117.8827, name: 'Angel Stadium' },
  'San Francisco Giants':    { lat: 37.7786, lon: -122.3893, name: 'Oracle Park' },
  'Oakland Athletics':       { lat: 37.7516, lon: -122.2005, name: 'Oakland Coliseum' },
  'Chicago Cubs':            { lat: 41.9484, lon: -87.6553,  name: 'Wrigley Field' },
  'Chicago White Sox':       { lat: 41.8300, lon: -87.6339,  name: 'Guaranteed Rate Field' },
  'Boston Red Sox':          { lat: 42.3467, lon: -71.0972,  name: 'Fenway Park' },
  'Houston Astros':          { lat: 29.7573, lon: -95.3555,  name: 'Minute Maid Park' },
  'Atlanta Braves':          { lat: 33.8908, lon: -84.4678,  name: 'Truist Park' },
  'Philadelphia Phillies':   { lat: 39.9061, lon: -75.1665,  name: 'Citizens Bank Park' },
  'Washington Nationals':    { lat: 38.8730, lon: -77.0074,  name: 'Nationals Park' },
  'Miami Marlins':           { lat: 25.7781, lon: -80.2197,  name: 'LoanDepot Park' },
  'Pittsburgh Pirates':      { lat: 40.4469, lon: -80.0057,  name: 'PNC Park' },
  'Cincinnati Reds':         { lat: 39.0979, lon: -84.5082,  name: 'Great American Ball Park' },
  'Milwaukee Brewers':       { lat: 43.0280, lon: -87.9712,  name: 'American Family Field' },
  'St. Louis Cardinals':     { lat: 38.6226, lon: -90.1928,  name: 'Busch Stadium' },
  'Minnesota Twins':         { lat: 44.9817, lon: -93.2777,  name: 'Target Field' },
  'Detroit Tigers':          { lat: 42.3390, lon: -83.0485,  name: 'Comerica Park' },
  'Cleveland Guardians':     { lat: 41.4962, lon: -81.6852,  name: 'Progressive Field' },
  'Kansas City Royals':      { lat: 39.0517, lon: -94.4803,  name: 'Kauffman Stadium' },
  'Texas Rangers':           { lat: 32.7473, lon: -97.0822,  name: 'Globe Life Field' },
  'Seattle Mariners':        { lat: 47.5914, lon: -122.3325, name: 'T-Mobile Park' },
  'Colorado Rockies':        { lat: 39.7559, lon: -104.9942, name: 'Coors Field' },
  'Arizona Diamondbacks':    { lat: 33.4453, lon: -112.0667, name: 'Chase Field' },
  'San Diego Padres':        { lat: 32.7076, lon: -117.1570, name: 'Petco Park' },
  'Tampa Bay Rays':          { lat: 27.7682, lon: -82.6534,  name: 'Tropicana Field' },
  'Baltimore Orioles':       { lat: 39.2838, lon: -76.6218,  name: 'Camden Yards' },
  'Toronto Blue Jays':       { lat: 43.6414, lon: -79.3894,  name: 'Rogers Centre' },
};

const INDOOR_STADIUMS = new Set([
  'Tropicana Field',
  'Minute Maid Park',
  'Chase Field',
  'Rogers Centre',
  'LoanDepot Park',
  'Globe Life Field',
  'American Family Field',
]);

function buildWeatherAnalysis(hourly, index, stadiumName) {
  const wind   = hourly.windspeed_10m[index];
  const temp   = hourly.temperature_2m[index];
  const precip = hourly.precipitation_probability[index];

  const flags = [];

  if (wind > 15)              flags.push(`HIGH WIND ${wind}mph — affects fly balls significantly`);
  else if (wind > 10)         flags.push(`MODERATE WIND ${wind}mph — minor fly ball impact`);
  if (temp > 85)              flags.push(`HIGH TEMP ${temp}°F — ball carries farther, favor OVER`);
  if (temp < 50)              flags.push(`COLD ${temp}°F — ball dies, favor UNDER`);
  if (precip > 70)            flags.push(`HIGH RAIN RISK ${precip}% — consider avoiding`);
  else if (precip > 50)       flags.push(`RAIN RISK ${precip}% — game delay possible`);

  return flags;
}

async function getGameWeather(homeTeam, gameTime) {
  const stadium = STADIUM_COORDS[homeTeam];
  if (!stadium) return null;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${stadium.lat}&longitude=${stadium.lon}` +
      `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
      `&windspeed_unit=mph&temperature_unit=fahrenheit&timezone=auto&forecast_days=2`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const data = await response.json();

    // Find the hourly slot closest to (or at) the game's local hour
    const gameHour = gameTime ? new Date(gameTime).getHours() : 19; // default 7pm
    let index = data.hourly.time.findIndex(t => new Date(t).getHours() >= gameHour);
    if (index === -1) index = data.hourly.time.length - 1;

    const isIndoor = INDOOR_STADIUMS.has(stadium.name);

    return {
      stadium:                stadium.name,
      temperature:            data.hourly.temperature_2m[index],
      windSpeed:              data.hourly.windspeed_10m[index],
      windDirection:          data.hourly.winddirection_10m[index],
      precipitationProbability: data.hourly.precipitation_probability[index],
      weatherCode:            data.hourly.weathercode[index],
      isIndoor,
      analysis:               isIndoor ? [] : buildWeatherAnalysis(data.hourly, index, stadium.name),
    };
  } catch (err) {
    console.warn(`[weather-api] Failed to fetch weather for ${homeTeam}:`, err.message);
    return null;
  }
}

export { getGameWeather };
