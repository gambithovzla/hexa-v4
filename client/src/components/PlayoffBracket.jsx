/**
 * PlayoffBracket.jsx
 *
 * Generic bracket viewer for NBA and MLB playoff structures. Renders the
 * full bracket derived from current standings (matchups will populate
 * automatically once series data is wired in).
 *
 * Expected `data` shapes:
 *   NBA: { sport: 'nba', conferences: [{ key, name, playIn[], rounds[] }], final }
 *   MLB: { sport: 'mlb', leagues:     [{ key, name, seeds[], rounds[]   }], final }
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, BARLOW, MONO } from '../theme';

const TEAM_LOGO_URL = {
  // espn:-prefixed IDs come from the live bracket (ESPN API); use ESPN CDN.
  // Plain numeric IDs are NBA official team IDs; use NBA CDN.
  nba: id => id?.startsWith?.('espn:')
    ? `https://a.espncdn.com/i/teamlogos/nba/500/${id.slice(5)}.png`
    : `https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg`,
  mlb: id => `https://www.mlbstatic.com/team-logos/${id}.svg`,
};

const COPY = {
  en: {
    eyebrow:        'Playoff bracket',
    projectedTitle: 'PROJECTED BRACKET',
    projectedBody:  'Matchups derived from current standings. They will keep shifting as the season unfolds — this is not the official bracket.',
    seasonProgress: 'Season progress',
    liveTitle:      'NBA PLAYOFFS — LIVE',
    liveBody:       'Real bracket updated from official results. Series records reflect the latest completed game.',
    playIn:         'Play-In Tournament',
    seedShort:      '#',
    bestOf:         'Best of',
    bye:            'BYE',
    tbd:            'TBD',
    divWinner:      'Div Winner',
    champion:       'Champion',
    playInWinner:   'Play-In Winner',
    seriesWins:     'W',
  },
  es: {
    eyebrow:        'Cuadro de playoffs',
    projectedTitle: 'CUADRO PROYECTADO',
    projectedBody:  'Enfrentamientos derivados de las posiciones actuales. Cambiarán a medida que avance la temporada — no es el cuadro oficial.',
    seasonProgress: 'Avance de temporada',
    liveTitle:      'PLAYOFFS NBA — EN VIVO',
    liveBody:       'Cuadro real actualizado con resultados oficiales. Los marcadores de series reflejan el último partido disputado.',
    playIn:         'Torneo Play-In',
    seedShort:      '#',
    bestOf:         'Al mejor de',
    bye:            'BYE',
    tbd:            'POR DEFINIR',
    divWinner:      'Líder Div',
    champion:       'Campeón',
    playInWinner:   'Ganador Play-In',
    seriesWins:     'W',
  },
};

// Total games in a regular season — used to estimate season progress.
const REG_SEASON_GAMES = { nba: 82, mlb: 162 };

function TeamLogo({ teamId, sport, abbr, size = 22 }) {
  const [failed, setFailed] = useState(false);
  if (!teamId || failed) {
    return (
      <Box
        sx={{
          width: size, height: size, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${C.border}`,
          background: 'rgba(255,255,255,0.04)',
          flexShrink: 0,
        }}
      >
        <Typography sx={{ fontFamily: MONO, fontSize: size * 0.32, color: C.textPrimary }}>
          {(abbr || '—').slice(0, 3)}
        </Typography>
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={TEAM_LOGO_URL[sport](teamId)}
      alt={abbr || 'team'}
      loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

function SeedBadge({ seed, isWinner }) {
  if (seed == null) return null;
  return (
    <Box
      sx={{
        minWidth: 22, px: '4px', py: '1px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${isWinner ? C.accentLine : C.border}`,
        background: isWinner ? C.accentDim : 'rgba(255,255,255,0.03)',
        fontFamily: MONO, fontSize: '0.55rem',
        color: isWinner ? C.accent : C.textMuted,
        letterSpacing: '0.05em',
      }}
    >
      {seed}
    </Box>
  );
}

function TeamLine({ team, sport, copy, tbdLabel, isWinner }) {
  if (!team) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: 0.55, py: 0.5 }}>
        <Box sx={{ minWidth: 22 }} />
        <Box sx={{ width: 22, height: 22, border: `1px dashed ${C.border}` }} />
        <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.08em' }}>
          {tbdLabel ?? copy.tbd}
        </Typography>
      </Box>
    );
  }
  const recordText = team.seriesWins != null
    ? `${team.seriesWins}${copy.seriesWins ?? 'W'}`
    : (team.wins != null && team.losses != null ? `${team.wins}-${team.losses}` : null);
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, py: 0.45, px: isWinner ? 0.5 : 0,
        background: isWinner ? 'rgba(0,217,255,0.07)' : 'transparent',
        borderLeft: isWinner ? `2px solid ${C.cyan}` : '2px solid transparent',
        mx: isWinner ? '-0.5px' : 0,
      }}
    >
      <SeedBadge seed={team.seed} isWinner={isWinner} />
      <TeamLogo teamId={team.teamId} sport={sport} abbr={team.abbreviation} size={22} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          noWrap
          sx={{
            fontFamily: BARLOW, fontSize: '0.78rem', fontWeight: 800,
            color: isWinner ? C.cyan : C.textPrimary,
            letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.05,
          }}
        >
          {team.abbreviation || team.name}
          {isWinner && (
            <Box component="span" sx={{ ml: 0.6, fontSize: '0.55rem', color: C.cyan, verticalAlign: 'middle' }}>✓</Box>
          )}
        </Typography>
      </Box>
      {recordText && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: isWinner ? C.cyan : C.textMuted, letterSpacing: '0.04em', flexShrink: 0 }}>
          {recordText}
        </Typography>
      )}
    </Box>
  );
}

function MatchupCard({ matchup, sport, copy, accent = C.cyan }) {
  if (!matchup) return null;
  const isPlayIn   = matchup.round === 'play_in';
  const accentLine = accent === C.accent ? C.accentLine : C.cyanLine;
  const isByeRound = matchup.top && !matchup.bottom && matchup.label?.includes('BYE');

  return (
    <Box
      sx={{
        position: 'relative',
        p: '10px 12px',
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${accent}`,
        background: 'linear-gradient(180deg, rgba(12,16,24,0.96), rgba(4,6,10,0.94))',
        boxShadow: '0 6px 16px rgba(0,0,0,0.25)',
        display: 'grid', gap: 0.3,
        minWidth: 200,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.4 }}>
        <Typography
          sx={{ fontFamily: MONO, fontSize: '0.52rem', color: accent, letterSpacing: '0.12em', textTransform: 'uppercase' }}
        >
          {matchup.label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {matchup.bestOf > 1 && (
          <Typography
            sx={{
              fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted,
              border: `1px solid ${C.border}`, px: '4px', py: '1px',
            }}
          >
            BO{matchup.bestOf}
          </Typography>
        )}
        {isPlayIn && (
          <Typography
            sx={{
              fontFamily: MONO, fontSize: '0.5rem', color: C.amber,
              border: `1px solid ${C.amber}55`, background: 'rgba(255,170,0,0.08)',
              px: '4px', py: '1px',
            }}
          >
            PI
          </Typography>
        )}
      </Box>

      <TeamLine team={matchup.top}    sport={sport} copy={copy} isWinner={matchup.winner === 'top'} />
      <Box sx={{ height: 1, background: C.border }} />
      <TeamLine team={matchup.bottom} sport={sport} copy={copy} isWinner={matchup.winner === 'bottom'} />

      {(matchup.summary || matchup.series) && (
        <Typography
          sx={{
            fontFamily: MONO, fontSize: '0.56rem', mt: 0.5, letterSpacing: '0.06em',
            color: matchup.completed ? C.cyan : C.amber,
          }}
        >
          {matchup.summary || matchup.series}
        </Typography>
      )}
    </Box>
  );
}

function RoundColumn({ name, matchups, sport, copy, accent }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.4, alignContent: 'start' }}>
      <Typography
        sx={{
          fontFamily: BARLOW, fontSize: '0.66rem', fontWeight: 800, color: accent,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          borderBottom: `1px solid ${accent}55`, pb: 0.5, mb: 0.3,
        }}
      >
        {name}
      </Typography>
      <Box sx={{ display: 'grid', gap: 1.2 }}>
        {matchups.map(m => (
          <MatchupCard key={m.id} matchup={m} sport={sport} copy={copy} accent={accent} />
        ))}
      </Box>
    </Box>
  );
}

function ConferenceBracket({ conference, sport, copy, lang, accent }) {
  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2 },
        border: `1px solid ${C.border}`,
        background: 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
        display: 'grid', gap: 1.6,
      }}
    >
      <Typography
        sx={{
          fontFamily: BARLOW, fontSize: '0.96rem', fontWeight: 800,
          color: accent, letterSpacing: '0.14em', textTransform: 'uppercase',
        }}
      >
        {conference.name?.[lang] ?? conference.name?.en ?? conference.key}
      </Typography>

      {conference.playIn?.length > 0 && (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography
            sx={{
              fontFamily: MONO, fontSize: '0.58rem', color: C.amber,
              letterSpacing: '0.16em', textTransform: 'uppercase',
            }}
          >
            ★ {copy.playIn}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
              gap: 1.2,
            }}
          >
            {conference.playIn.map(m => (
              <MatchupCard key={m.id} matchup={m} sport={sport} copy={copy} accent={C.amber} />
            ))}
          </Box>
        </Box>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: `repeat(${conference.rounds.length}, minmax(0, 1fr))` },
          gap: { xs: 1.6, md: 2 },
        }}
      >
        {conference.rounds.map(round => (
          <RoundColumn
            key={round.key}
            name={round.name?.[lang] ?? round.name?.en ?? round.key}
            matchups={round.matchups}
            sport={sport}
            copy={copy}
            accent={accent}
          />
        ))}
      </Box>
    </Box>
  );
}

function LeagueBracket({ league, sport, copy, lang, accent }) {
  // MLB: seeds 1-2 get a bye, render them as inert cards in column 1.
  const byeSeeds = (league.seeds ?? []).slice(0, 2).filter(Boolean);

  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2 },
        border: `1px solid ${C.border}`,
        background: 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
        display: 'grid', gap: 1.6,
      }}
    >
      <Typography
        sx={{
          fontFamily: BARLOW, fontSize: '0.96rem', fontWeight: 800,
          color: accent, letterSpacing: '0.14em', textTransform: 'uppercase',
        }}
      >
        {league.name?.[lang] ?? league.name?.en ?? league.key}
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: `repeat(${league.rounds.length}, minmax(0, 1fr))` },
          gap: { xs: 1.6, md: 2 },
        }}
      >
        {league.rounds.map((round, idx) => (
          <Box key={round.key} sx={{ display: 'grid', gap: 1.4 }}>
            <Typography
              sx={{
                fontFamily: BARLOW, fontSize: '0.66rem', fontWeight: 800, color: accent,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                borderBottom: `1px solid ${accent}55`, pb: 0.5, mb: 0.3,
              }}
            >
              {round.name?.[lang] ?? round.name?.en ?? round.key}
            </Typography>
            <Box sx={{ display: 'grid', gap: 1.2 }}>
              {/* In the WC column, also render the byes inline so users see seeds 1-2 there. */}
              {idx === 0 && byeSeeds.map(team => (
                <Box
                  key={`bye-${team.teamId}`}
                  sx={{
                    p: '10px 12px',
                    border: `1px dashed ${C.border}`,
                    background: 'rgba(0,217,255,0.04)',
                    display: 'grid', gap: 0.3,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                    <Typography
                      sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.cyan, letterSpacing: '0.12em', textTransform: 'uppercase' }}
                    >
                      Seed {team.seed} · {copy.divWinner}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography
                      sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.cyan,
                        border: `1px solid ${C.cyanLine}`, background: 'rgba(0,217,255,0.08)',
                        px: '5px', py: '1px',
                      }}
                    >
                      {copy.bye}
                    </Typography>
                  </Box>
                  <TeamLine team={team} sport={sport} copy={copy} />
                </Box>
              ))}
              {round.matchups.map(m => (
                <MatchupCard key={m.id} matchup={m} sport={sport} copy={copy} accent={accent} />
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function FinalCard({ matchup, name, sport, copy, lang }) {
  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2 },
        border: `1px solid ${C.accentLine}`,
        background: 'linear-gradient(180deg, rgba(255,102,0,0.10), rgba(2,4,8,0.96))',
        boxShadow: '0 10px 28px rgba(255,102,0,0.18)',
        display: 'grid', gap: 1.2,
        maxWidth: 560, mx: 'auto', width: '100%',
      }}
    >
      <Typography
        sx={{
          fontFamily: BARLOW, fontSize: '1rem', fontWeight: 800,
          color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        🏆 {name?.[lang] ?? name?.en ?? matchup?.label}
      </Typography>
      <MatchupCard matchup={matchup} sport={sport} copy={copy} accent={C.accent} />
    </Box>
  );
}

function pickAnyTeam(groups, sport) {
  for (const g of groups) {
    if (sport === 'nba') {
      const t = g.teams?.find(Boolean);
      if (t) return t;
    } else {
      const t = g.seeds?.find(Boolean);
      if (t) return t;
    }
  }
  return null;
}

function computeSeasonProgress(groups, sport) {
  const sample = pickAnyTeam(groups, sport);
  if (!sample) return null;
  const games = (Number(sample.wins) || 0) + (Number(sample.losses) || 0);
  if (games <= 0) return null;
  const total = REG_SEASON_GAMES[sport] ?? 0;
  if (!total) return null;
  return Math.max(0, Math.min(1, games / total));
}

export default function PlayoffBracket({ data, lang = 'es' }) {
  const copy = COPY[lang] ?? COPY.es;
  if (!data) return null;

  const sport = data.sport === 'mlb' ? 'mlb' : 'nba';
  const groups = sport === 'nba' ? data.conferences : data.leagues;
  if (!groups || groups.length === 0) return null;

  const isLive      = data.source === 'live';
  const isProjected = !isLive;

  const progress    = isProjected ? computeSeasonProgress(groups, sport) : null;
  const progressPct = progress != null ? Math.round(progress * 100) : null;

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Box>
        <Typography
          sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.cyan, letterSpacing: '0.2em', textTransform: 'uppercase' }}
        >
          {copy.eyebrow}
        </Typography>
      </Box>

      {/* Live bracket banner — green, shown when bracket comes from ESPN real results */}
      {isLive && (
        <Box
          sx={{
            p: { xs: 1.4, sm: 1.8 },
            border: `1px solid ${C.green}55`,
            borderLeft: `3px solid ${C.green}`,
            background: 'linear-gradient(180deg, rgba(0,200,100,0.08), rgba(2,4,8,0.6))',
            display: 'grid', gap: 0.6,
          }}
        >
          <Box
            sx={{
              px: '8px', py: '2px', display: 'inline-flex', alignSelf: 'start',
              border: `1px solid ${C.green}`,
              background: 'rgba(0,200,100,0.15)',
              fontFamily: MONO, fontSize: '0.6rem', fontWeight: 800,
              color: C.green, letterSpacing: '0.18em', textTransform: 'uppercase',
            }}
          >
            ● {copy.liveTitle}
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textSecondary, lineHeight: 1.5 }}>
            {copy.liveBody}
          </Typography>
        </Box>
      )}

      {/* Projected bracket banner — amber, shown during regular season */}
      {isProjected && (
        <Box
          sx={{
            p: { xs: 1.4, sm: 1.8 },
            border: `1px solid ${C.amber}66`,
            borderLeft: `3px solid ${C.amber}`,
            background: 'linear-gradient(180deg, rgba(255,170,0,0.10), rgba(2,4,8,0.6))',
            display: 'grid', gap: 0.8,
          }}
        >
          <Box
            sx={{
              px: '8px', py: '2px', display: 'inline-flex', alignSelf: 'start',
              border: `1px solid ${C.amber}`,
              background: 'rgba(255,170,0,0.18)',
              fontFamily: MONO, fontSize: '0.6rem', fontWeight: 800,
              color: C.amber, letterSpacing: '0.18em', textTransform: 'uppercase',
            }}
          >
            ⚠ {copy.projectedTitle}
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textSecondary, lineHeight: 1.5 }}>
            {copy.projectedBody}
          </Typography>
          {progressPct != null && (
            <Box sx={{ display: 'grid', gap: 0.5, mt: 0.4 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  {copy.seasonProgress}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.amber, fontWeight: 700 }}>
                  {progressPct}%
                </Typography>
              </Box>
              <Box
                sx={{
                  height: 4, width: '100%',
                  background: 'rgba(255,255,255,0.05)',
                  border: `1px solid ${C.border}`,
                  position: 'relative', overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    height: '100%', width: `${progressPct}%`,
                    background: progressPct < 50 ? C.red : progressPct < 80 ? C.amber : C.green,
                    transition: 'width 0.3s ease',
                  }}
                />
              </Box>
            </Box>
          )}
        </Box>
      )}

      {groups.map((group, i) => {
        const accent = i === 0 ? C.cyan : C.accent;
        return sport === 'nba' ? (
          <ConferenceBracket key={group.key} conference={group} sport={sport} copy={copy} lang={lang} accent={accent} />
        ) : (
          <LeagueBracket    key={group.key} league={group}     sport={sport} copy={copy} lang={lang} accent={accent} />
        );
      })}

      {data.final?.matchup && (
        <FinalCard matchup={data.final.matchup} name={data.final.name} sport={sport} copy={copy} lang={lang} />
      )}
    </Box>
  );
}
