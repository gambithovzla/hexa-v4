/**
 * infographicsService.js — Auto-generated pick infographics (B8).
 *
 * Generates SVG infographics from pick data. The SVG can be:
 *   - Returned as image/svg+xml from the API
 *   - Attached to X/Telegram posts (via content queue media_url)
 *   - Served from a static URL for embedding
 *
 * Endpoints:
 *   GET /api/picks/:id/infographic?format=svg   — single pick card
 *   GET /api/mlb/slate-infographic?date=YYYY-MM-DD — daily slate overview
 *
 * Design: navy background, volt accent (#C3FF00), Oswald-compatible geometry.
 * No external rendering deps — pure SVG string generation.
 */

const NAVY  = '#0B2540';
const DARK  = '#071B30';
const VOLT  = '#C3FF00';
const CYAN  = '#00D9FF';
const WHITE = '#E8F4FF';
const GRAY  = '#4A6785';
const WIN   = '#00FF6A';
const LOSS  = '#FF4444';
const PUSH  = '#FFB800';

function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function resultColor(result) {
  if (result === 'win') return WIN;
  if (result === 'loss') return LOSS;
  if (result === 'push') return PUSH;
  return GRAY;
}

function resultLabel(result) {
  if (result === 'win') return 'WIN ✓';
  if (result === 'loss') return 'LOSS ✗';
  if (result === 'push') return 'PUSH';
  return 'PENDING';
}

/**
 * Generate a pick card SVG (400×220px).
 */
export function generatePickCardSvg(pick) {
  const {
    matchup = '', pick: pickText = '', confidence, result = 'pending',
    sport = 'mlb', created_at,
  } = pick;

  const confPct = confidence != null ? `${Math.round(confidence * 100)}%` : '';
  const confBarW = confidence != null ? Math.round(confidence * 200) : 0;
  const resColor = resultColor(result);
  const resLabel = resultLabel(result);
  const dateStr = created_at ? new Date(created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const sportLabel = (sport ?? 'mlb').toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220" viewBox="0 0 400 220">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${DARK}"/>
      <stop offset="100%" stop-color="${NAVY}"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="400" height="220" fill="url(#bg)"/>
  <rect width="4" height="220" fill="${VOLT}"/>
  <rect x="0" y="0" width="400" height="3" fill="${VOLT}" opacity="0.4"/>

  <!-- Logo -->
  <text x="20" y="30" font-family="Arial Black, sans-serif" font-size="16" font-weight="900" fill="${VOLT}" letter-spacing="4">H.E.X.A.</text>
  <text x="120" y="30" font-family="Arial, sans-serif" font-size="10" fill="${GRAY}" letter-spacing="2">${escapeXml(sportLabel)} · ORACLE</text>
  <text x="380" y="30" font-family="Arial, sans-serif" font-size="10" fill="${GRAY}" text-anchor="end">${escapeXml(dateStr)}</text>

  <!-- Divider -->
  <line x1="20" y1="38" x2="380" y2="38" stroke="${VOLT}" stroke-width="0.5" opacity="0.3"/>

  <!-- Matchup -->
  <text x="20" y="62" font-family="Arial, sans-serif" font-size="13" fill="${GRAY}">${escapeXml(matchup)}</text>

  <!-- Pick -->
  <text x="20" y="100" font-family="Arial Black, sans-serif" font-size="22" font-weight="900" fill="${WHITE}">${escapeXml(pickText)}</text>

  <!-- Confidence bar -->
  <text x="20" y="125" font-family="Arial, sans-serif" font-size="10" fill="${GRAY}">CONFIDENCE</text>
  ${confPct ? `<text x="380" y="125" font-family="Arial Black, sans-serif" font-size="11" fill="${CYAN}" text-anchor="end">${escapeXml(confPct)}</text>` : ''}
  <rect x="20" y="130" width="200" height="4" rx="2" fill="${GRAY}" opacity="0.4"/>
  ${confBarW > 0 ? `<rect x="20" y="130" width="${confBarW}" height="4" rx="2" fill="${CYAN}"/>` : ''}

  <!-- Result badge -->
  <rect x="20" y="158" width="100" height="30" rx="4" fill="${resColor}" opacity="0.15"/>
  <rect x="20" y="158" width="100" height="30" rx="4" fill="none" stroke="${resColor}" stroke-width="1.5"/>
  <text x="70" y="178" font-family="Arial Black, sans-serif" font-size="13" font-weight="900" fill="${resColor}" text-anchor="middle">${escapeXml(resLabel)}</text>

  <!-- Footer -->
  <text x="380" y="210" font-family="Arial, sans-serif" font-size="9" fill="${GRAY}" text-anchor="end" opacity="0.6">hexaoracle.lat</text>
</svg>`;
}

/**
 * Generate a daily slate SVG (500×350px) showing top N picks.
 */
export function generateSlateSvg({ picks, date }) {
  const dateLabel = date ?? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const topPicks = (picks ?? []).slice(0, 6);
  const rows = topPicks.map((p, i) => {
    const y = 100 + i * 36;
    const conf = p.confidence != null ? `${Math.round(p.confidence * 100)}%` : '--';
    const res = p.result && p.result !== 'pending' ? resultLabel(p.result) : '';
    const resColor = res ? resultColor(p.result) : GRAY;
    return `
  <text x="20" y="${y}" font-family="Arial, sans-serif" font-size="11" fill="${GRAY}">${escapeXml(p.matchup ?? '')}</text>
  <text x="200" y="${y}" font-family="Arial Black, sans-serif" font-size="11" fill="${WHITE}">${escapeXml(p.pick ?? '')}</text>
  <text x="400" y="${y}" font-family="Arial, sans-serif" font-size="11" fill="${CYAN}" text-anchor="end">${escapeXml(conf)}</text>
  <text x="490" y="${y}" font-family="Arial Black, sans-serif" font-size="10" fill="${resColor}" text-anchor="end">${escapeXml(res)}</text>
  <line x1="20" y1="${y + 6}" x2="490" y2="${y + 6}" stroke="${GRAY}" stroke-width="0.3" opacity="0.4"/>`;
  }).join('');

  const wins = picks?.filter(p => p.result === 'win').length ?? 0;
  const total = picks?.filter(p => p.result && p.result !== 'pending').length ?? 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="510" height="${120 + topPicks.length * 36 + 60}" viewBox="0 0 510 ${120 + topPicks.length * 36 + 60}">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${DARK}"/>
      <stop offset="100%" stop-color="${NAVY}"/>
    </linearGradient>
  </defs>
  <rect width="510" height="${120 + topPicks.length * 36 + 60}" fill="url(#bg2)"/>
  <rect width="5" height="${120 + topPicks.length * 36 + 60}" fill="${VOLT}"/>

  <!-- Header -->
  <text x="20" y="32" font-family="Arial Black, sans-serif" font-size="20" font-weight="900" fill="${VOLT}" letter-spacing="4">H.E.X.A.</text>
  <text x="130" y="32" font-family="Arial, sans-serif" font-size="12" fill="${GRAY}">ORACLE · DAILY SLATE</text>
  <text x="490" y="32" font-family="Arial, sans-serif" font-size="11" fill="${WHITE}" text-anchor="end">${escapeXml(dateLabel)}</text>
  ${total > 0 ? `<text x="490" y="52" font-family="Arial, sans-serif" font-size="10" fill="${WIN}" text-anchor="end">${wins}/${total} resolved · ${Math.round(wins/total*100)}% hit</text>` : ''}

  <line x1="20" y1="62" x2="490" y2="62" stroke="${VOLT}" stroke-width="0.8" opacity="0.5"/>

  <!-- Column headers -->
  <text x="20" y="82" font-family="Arial, sans-serif" font-size="9" fill="${GRAY}" letter-spacing="2">MATCHUP</text>
  <text x="200" y="82" font-family="Arial, sans-serif" font-size="9" fill="${GRAY}" letter-spacing="2">PICK</text>
  <text x="400" y="82" font-family="Arial, sans-serif" font-size="9" fill="${GRAY}" letter-spacing="2" text-anchor="end">CONF</text>
  <text x="490" y="82" font-family="Arial, sans-serif" font-size="9" fill="${GRAY}" letter-spacing="2" text-anchor="end">RESULT</text>

  <!-- Picks -->
  ${rows}

  <!-- Footer -->
  <text x="490" y="${110 + topPicks.length * 36 + 40}" font-family="Arial, sans-serif" font-size="9" fill="${GRAY}" text-anchor="end" opacity="0.6">hexaoracle.lat</text>
</svg>`;
}
