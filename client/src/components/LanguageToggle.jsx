/**
 * LanguageToggle.jsx
 * Single pill button that shows the language you'd switch TO.
 * Clicking "ES" when on English switches to Spanish, and vice-versa.
 *
 * Props:
 *   lang      — current language: 'en' | 'es'
 *   onToggle  — (nextLang: string) => void
 */

const MONO = '"JetBrains Mono", "Fira Code", monospace';

export default function LanguageToggle({ lang, onToggle }) {
  const target = lang === 'en' ? 'es' : 'en';
  const label  = lang === 'en' ? 'ES'  : 'EN';

  return (
    <button
      onClick={() => onToggle(target)}
      title={lang === 'en' ? 'Cambiar a Español' : 'Switch to English'}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        padding:        '5px 14px',
        background:     '#111827',
        border:         '1px solid #1e293b',
        borderRadius:   '999px',
        color:          '#e2e8f0',
        fontFamily:     MONO,
        fontSize:       '12px',
        fontWeight:     600,
        letterSpacing:  '0.06em',
        cursor:         'pointer',
        transition:     'border-color 0.15s, color 0.15s',
        whiteSpace:     'nowrap',
        userSelect:     'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#f59e0b';
        e.currentTarget.style.color       = '#f59e0b';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#1e293b';
        e.currentTarget.style.color       = '#e2e8f0';
      }}
    >
      {label}
    </button>
  );
}
