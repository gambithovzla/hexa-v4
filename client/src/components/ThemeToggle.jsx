/**
 * ThemeToggle — 3-way segmented control: LIGHT / SYSTEM / DARK.
 *
 * Text-only, terminal-style, keyboard accessible. Reads and writes through
 * useHexaTheme() so it stays in sync no matter who triggered the change.
 *
 * Two layouts:
 *   layout='pill'   (default) — horizontal segmented row, fits next to LanguageToggle
 *   layout='compact'          — single button that cycles (for tight spaces)
 *
 * Bilingual via `lang` prop so it matches the rest of the header.
 */

import { useHexaTheme } from '../themeProvider';

const COPY = {
  en: { light: 'LIGHT', system: 'SYSTEM', dark: 'DARK', a11y: 'Theme' },
  es: { light: 'CLARO', system: 'AUTO',   dark: 'OSCURO', a11y: 'Tema' },
};

const OPTIONS = ['light', 'system', 'dark'];

export default function ThemeToggle({ lang = 'en', layout = 'pill' }) {
  const { mode, setMode, C } = useHexaTheme();
  const t = COPY[lang] || COPY.en;

  if (layout === 'compact') {
    const nextIdx = (OPTIONS.indexOf(mode) + 1) % OPTIONS.length;
    const next = OPTIONS[nextIdx];
    return (
      <button
        type="button"
        onClick={() => setMode(next)}
        aria-label={`${t.a11y}: ${t[mode]}`}
        title={`${t.a11y}: ${t[mode]} → ${t[next]}`}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          minWidth:       72,
          padding:        '6px 12px',
          background:     'transparent',
          border:         `1px solid ${C.border}`,
          borderRadius:   0,
          color:          C.textSecondary,
          fontFamily:     "'Share Tech Mono', monospace",
          fontSize:       '0.68rem',
          fontWeight:     700,
          letterSpacing:  '0.14em',
          textTransform:  'uppercase',
          cursor:         'pointer',
          whiteSpace:     'nowrap',
          userSelect:     'none',
          transition:     'border-color 0.15s, color 0.15s',
        }}
      >
        {t[mode]}
      </button>
    );
  }

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
        const active = mode === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => setMode(opt)}
            aria-pressed={active}
            style={{
              minWidth:       54,
              padding:        '5px 10px',
              background:     active ? C.cyan : 'transparent',
              color:          active ? C.bg : C.textSecondary,
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
              boxShadow:      active && C.cyanGlow !== 'none' ? `0 0 8px ${C.cyanLine}` : 'none',
            }}
          >
            {t[opt]}
          </button>
        );
      })}
    </div>
  );
}
