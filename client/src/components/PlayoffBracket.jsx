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
  nba: id => `https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg`,
  mlb: id => `https://www.mlbstatic.com/team-logos/${id}.svg`,
};

const COPY = {
  en: {
    eyebrow:       'Playoff bracket',
    projected:     'Projected — based on current standings',
    playIn:        'Play-In Tournament',
    seedShort:     '#',
    bestOf:        'Best of',
    bye:           'BYE',
    tbd:           'TBD',
    divWinner:     'Div Winner',
    champion:      'Champion',
    playInWinner: 'Play-In Winner',
  },
  es: {
    eyebrow:       'Cuadro de playoffs',
    projected:     'Proyectado — basado en posiciones actuales',
    playIn:        'Torneo Play-In',
    seedShort:     '#',
    bestOf:        'Al mejor de',
    bye:           'BYE',
    tbd:           'POR DEFINIR',
    divWinner:     'Líder Div',
    champion:      'Campeón',
    playInWinner: 'Ganador Play-In',
  },
};

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

function TeamLine({ team, sport, copy, tbdLabel }) {
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
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.45 }}>
      <SeedBadge seed={team.seed} />
      <TeamLogo teamId={team.teamId} sport={sport} abbr={team.abbreviation} size={22} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          noWrap
          sx={{ fontFamily: BARLOW, fontSize: '0.78rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.05 }}
        >
          {team.abbreviation || team.name}
        </Typography>
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, letterSpacing: '0.04em', flexShrink: 0 }}>
        {team.wins != null && team.losses != null ? `${team.wins}-${team.losses}` : '—'}
      </Typography>
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

      <TeamLine team={matchup.top}    sport={sport} copy={copy} />
      <Box sx={{ height: 1, background: C.border }} />
      <TeamLine team={matchup.bottom} sport={sport} copy={copy} />

      {matchup.series && (
        <Typography
          sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.cyan, letterSpacing: '0.08em', mt: 0.5 }}
        >
          {matchup.series}
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

export default function PlayoffBracket({ data, lang = 'es' }) {
  const copy = COPY[lang] ?? COPY.es;
  if (!data) return null;

  const sport = data.sport === 'mlb' ? 'mlb' : 'nba';
  const groups = sport === 'nba' ? data.conferences : data.leagues;
  if (!groups || groups.length === 0) return null;

  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <Box>
        <Typography
          sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.cyan, letterSpacing: '0.2em', textTransform: 'uppercase' }}
        >
          {copy.eyebrow}
        </Typography>
        <Typography
          sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, mt: 0.4 }}
        >
          {copy.projected}
        </Typography>
      </Box>

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
