/**
 * BrandToggle — 2-way segmented control: CLASSIC / LEAGUE.
 *
 * Sits next to ThemeToggle in the Topbar. Switches the visual identity
 * between the cyber-neon "classic" look and the broadcast "League ×
 * Kinetic v.2.6" brand. Persisted via useHexaTheme().setBrand to
 * localStorage; the swap is global through data-brand on <html>.
 *
 * The brand axis is independent of dark/light — a user can pick
 * CLASSIC + DARK, LEAGUE + DARK, CLASSIC + LIGHT, LEAGUE + LIGHT.
 */

import { useHexaTheme } from '../../themeProvider';

const COPY = {
  en: { classic: 'CLASSIC', league: 'LEAGUE', a11y: 'Brand' },
  es: { classic: 'CLÁSICO', league: 'LEAGUE', a11y: 'Marca' },
};

const OPTIONS = [
  { value: 'classic',        labelKey: 'classic' },
  { value: 'league-kinetic', labelKey: 'league'  },
];

export default function BrandToggle({ lang = 'en' }) {
  const { brand, setBrand, C, isLeague } = useHexaTheme();
  const t = COPY[lang] || COPY.en;

  return (
    <div
      role="group"
      aria-label={t.a11y}
      style={{
        display:    'inline-flex',
        border:     `1px solid ${C.border}`,
        background: C.surface,
        padding:    2,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = brand === opt.value;
        // When league is active, highlight uses the bronze ribbon so it
        // reads as "this is the brand toggle, not a sport toggle".
        const activeBg   = isLeague ? C.amber : C.cyan;
        const activeText = isLeague ? C.ink   : C.bg;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setBrand(opt.value)}
            aria-pressed={active}
            title={`${t.a11y}: ${t[opt.labelKey]}`}
            style={{
              minWidth:       64,
              padding:        '5px 10px',
              background:     active ? activeBg : 'transparent',
              color:          active ? activeText : C.textSecondary,
              border:         'none',
              borderRadius:   0,
              fontFamily:     "'Share Tech Mono', monospace",
              fontSize:       '0.64rem',
              fontWeight:     700,
              letterSpacing:  '0.14em',
              textTransform:  'uppercase',
              cursor:         'pointer',
              whiteSpace:     'nowrap',
              transition:     'background 0.15s, color 0.15s',
            }}
          >
            {t[opt.labelKey]}
          </button>
        );
      })}
    </div>
  );
}
