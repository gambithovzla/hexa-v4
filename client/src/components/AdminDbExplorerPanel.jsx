/**
 * AdminDbExplorerPanel.jsx
 * Read-only DB browser for admins. Lists all whitelisted Postgres tables
 * (users, picks, bets, bankroll, parlay_synergy_runs, etc.) with pagination,
 * search, and per-column filtering.
 *
 * Companion to AdminCreditPanel.jsx — same modal pattern, wider layout.
 *
 * Props:
 *   lang    — 'en' | 'es'
 *   onClose — () => void
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const PAGE_SIZE = 50;

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatCell(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try { return JSON.stringify(value); }
    catch { return String(value); }
  }
  const str = String(value);
  // ISO timestamps → trim ms + Z for readability
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
    return str.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
  }
  return str;
}

function truncate(str, max = 80) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

// ── Small UI atoms (consistent with AdminCreditPanel style) ────────────────────

const inputBase = {
  background:   C.surface,
  border:       `1px solid ${C.border}`,
  borderRadius: '4px',
  color:        C.textPrimary,
  fontFamily:   MONO,
  fontSize:     '0.72rem',
  padding:      '6px 8px',
  outline:      'none',
  boxSizing:    'border-box',
  colorScheme:  'dark',
  transition:   'border-color 0.15s',
};

function Btn({ disabled, onClick, children, primary }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      disabled={disabled}
      sx={{
        py:            '6px',
        px:            '12px',
        border:        primary ? 'none' : `1px solid ${C.border}`,
        borderRadius:  '4px',
        background:    disabled ? C.border : (primary ? C.accent : 'transparent'),
        color:         disabled ? C.textMuted : (primary ? '#111111' : C.textSecondary),
        fontFamily:    MONO,
        fontSize:      '0.65rem',
        fontWeight:    700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor:        disabled ? 'not-allowed' : 'pointer',
        whiteSpace:    'nowrap',
        '&:hover':     { opacity: disabled ? 1 : 0.85 },
      }}
    >
      {children}
    </Box>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function AdminDbExplorerPanel({ lang = 'en', onClose }) {
  const { token } = useAuth();
  const isEs = lang === 'es';

  const [tablesMeta, setTablesMeta] = useState([]); // [{name, columns, filterable, searchable, defaultOrder}, ...]
  const [tableName, setTableName]   = useState('');
  const [search,    setSearch]      = useState('');
  const [filters,   setFilters]     = useState({}); // { columnName: value }
  const [orderBy,   setOrderBy]     = useState('');
  const [orderDir,  setOrderDir]    = useState('desc');
  const [offset,    setOffset]      = useState(0);

  const [rows,    setRows]    = useState([]);
  const [columns, setColumns] = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const currentMeta = useMemo(
    () => tablesMeta.find(t => t.name === tableName),
    [tablesMeta, tableName]
  );

  // ── 1. Load table list once ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/db/tables`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || 'Failed to load tables');
        setTablesMeta(json.tables || []);
        if (!tableName && json.tables?.length) {
          setTableName(json.tables[0].name);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── 2. Reset pagination + filters when table changes ──────────────────────
  useEffect(() => {
    setOffset(0);
    setFilters({});
    setSearch('');
    setOrderBy(currentMeta?.defaultOrder || '');
    setOrderDir('desc');
  }, [tableName, currentMeta?.defaultOrder]);

  // ── 3. Load rows whenever query changes ───────────────────────────────────
  useEffect(() => {
    if (!tableName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set('limit',  String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (orderBy)  params.set('order_by',  orderBy);
    if (orderDir) params.set('order_dir', orderDir);
    if (search)   params.set('search',    search);
    for (const [k, v] of Object.entries(filters)) {
      if (v !== '' && v !== null && v !== undefined) params.set(k, v);
    }

    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/admin/db/${encodeURIComponent(tableName)}?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || 'Failed to load rows');
        setRows(json.rows || []);
        setColumns(json.columns || []);
        setTotal(json.total || 0);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token, tableName, offset, orderBy, orderDir, search, filters]);

  function handleHeaderClick(col) {
    if (orderBy === col) {
      setOrderDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setOrderBy(col);
      setOrderDir('desc');
    }
    setOffset(0);
  }

  function handleFilterChange(col, value) {
    setFilters(prev => {
      const next = { ...prev };
      if (value === '') delete next[col];
      else next[col] = value;
      return next;
    });
    setOffset(0);
  }

  const page      = Math.floor(offset / PAGE_SIZE) + 1;
  const lastPage  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingTo = Math.min(offset + rows.length, total);

  return (
    <Box
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      sx={{
        position:        'fixed',
        inset:           0,
        zIndex:          10050,
        display:         'flex',
        alignItems:      { xs: 'stretch', sm: 'center' },
        justifyContent:  'center',
        bgcolor:         'rgba(0,0,0,0.78)',
        backdropFilter:  'blur(4px)',
        px:              { xs: 0, sm: '16px' },
        py:              { xs: 0, sm: '24px' },
      }}
    >
      <Box
        sx={{
          width:        { xs: '100%', sm: '95vw' },
          maxWidth:     '1200px',
          height:       { xs: '100%', sm: 'auto' },
          maxHeight:    { xs: '100%', sm: '92vh' },
          display:      'flex',
          flexDirection:'column',
          background:   C.bg,
          border:       `1px solid ${C.border}`,
          borderTop:    `2px solid ${C.accent}`,
          borderRadius: { xs: 0, sm: '4px' },
          boxShadow:    '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        {/* ── Header ── */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          p: '14px 18px', borderBottom: `1px solid ${C.border}`,
        }}>
          <Box>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.65rem', color: C.accent,
              letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700,
            }}>
              {isEs ? 'EXPLORADOR DE BASE DE DATOS' : 'DATABASE EXPLORER'}
            </Typography>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted,
              letterSpacing: '0.08em', mt: '2px',
            }}>
              {isEs ? 'SOLO LECTURA · ADMIN' : 'READ-ONLY · ADMIN'}
            </Typography>
          </Box>
          <Box
            component="button"
            onClick={onClose}
            sx={{
              background: 'none', border: 'none', color: C.textMuted,
              cursor: 'pointer', fontSize: '15px', lineHeight: 1, p: '4px 8px',
              '&:hover': { color: C.textSecondary, bgcolor: C.border },
            }}
          >✕</Box>
        </Box>

        {/* ── Toolbar ── */}
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
          p: '10px 18px', borderBottom: `1px solid ${C.border}`, bgcolor: C.surface,
        }}>
          {/* Table selector */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted,
              letterSpacing: '0.09em', textTransform: 'uppercase',
            }}>
              {isEs ? 'TABLA' : 'TABLE'}
            </Typography>
            <Box
              component="select"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              sx={{ ...inputBase, minWidth: '180px' }}
            >
              {tablesMeta.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </Box>
          </Box>

          {/* Search */}
          {currentMeta?.searchable?.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 200px' }}>
              <Typography sx={{
                fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted,
                letterSpacing: '0.09em', textTransform: 'uppercase',
              }}>
                {isEs ? 'BUSCAR' : 'SEARCH'} ({currentMeta.searchable.join(', ')})
              </Typography>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
                placeholder={isEs ? 'texto a buscar...' : 'search text...'}
                style={{ ...inputBase, width: '100%' }}
                onFocus={e => { e.target.style.borderColor = C.accent; }}
                onBlur={e  => { e.target.style.borderColor = C.border; }}
              />
            </Box>
          )}

          {/* Filter inputs (one per filterable column) */}
          {currentMeta?.filterable?.map(col => (
            <Box key={col} sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <Typography sx={{
                fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted,
                letterSpacing: '0.09em', textTransform: 'uppercase',
              }}>
                {col}
              </Typography>
              <input
                type="text"
                value={filters[col] || ''}
                onChange={(e) => handleFilterChange(col, e.target.value)}
                placeholder="="
                style={{ ...inputBase, width: '120px' }}
                onFocus={e => { e.target.style.borderColor = C.accent; }}
                onBlur={e  => { e.target.style.borderColor = C.border; }}
              />
            </Box>
          ))}
        </Box>

        {/* ── Status / Error ── */}
        {error && (
          <Box sx={{
            m: '10px 18px', p: '8px 10px', borderRadius: '4px',
            bgcolor: C.redDim, border: `1px solid ${C.redLine}`,
          }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.red }}>
              {error}
            </Typography>
          </Box>
        )}

        {/* ── Table body ── */}
        <Box sx={{
          flex: 1, minHeight: 0, overflow: 'auto', bgcolor: C.bg,
          fontFamily: MONO, fontSize: '0.7rem',
        }}>
          {loading && rows.length === 0 ? (
            <Box sx={{ p: '24px', textAlign: 'center', color: C.textMuted, fontFamily: MONO, fontSize: '0.7rem' }}>
              {isEs ? 'CARGANDO...' : 'LOADING...'}
            </Box>
          ) : rows.length === 0 ? (
            <Box sx={{ p: '24px', textAlign: 'center', color: C.textMuted, fontFamily: MONO, fontSize: '0.7rem' }}>
              {isEs ? 'SIN RESULTADOS' : 'NO RESULTS'}
            </Box>
          ) : (
            <Box component="table" sx={{
              borderCollapse: 'collapse', width: '100%', tableLayout: 'auto',
            }}>
              <Box component="thead" sx={{
                position: 'sticky', top: 0, bgcolor: C.surface, zIndex: 1,
              }}>
                <Box component="tr">
                  {columns.map(col => {
                    const isSorted = orderBy === col;
                    return (
                      <Box
                        component="th"
                        key={col}
                        onClick={() => handleHeaderClick(col)}
                        sx={{
                          textAlign: 'left',
                          padding:   '8px 10px',
                          borderBottom: `1px solid ${C.border}`,
                          color:     isSorted ? C.accent : C.textSecondary,
                          fontFamily: MONO,
                          fontSize:   '0.55rem',
                          fontWeight: 700,
                          letterSpacing: '0.09em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          userSelect: 'none',
                          '&:hover': { color: C.accent },
                        }}
                      >
                        {col}
                        {isSorted && (orderDir === 'asc' ? ' ↑' : ' ↓')}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
              <Box component="tbody">
                {rows.map((row, idx) => (
                  <Box
                    component="tr"
                    key={idx}
                    sx={{
                      borderBottom: `1px solid ${C.border}`,
                      '&:hover': { bgcolor: C.surface },
                    }}
                  >
                    {columns.map(col => {
                      const text = truncate(formatCell(row[col]));
                      return (
                        <Box
                          component="td"
                          key={col}
                          title={String(formatCell(row[col]))}
                          sx={{
                            padding:    '6px 10px',
                            color:      C.textPrimary,
                            fontFamily: MONO,
                            fontSize:   '0.68rem',
                            whiteSpace: 'nowrap',
                            maxWidth:   '320px',
                            overflow:   'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {text}
                        </Box>
                      );
                    })}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>

        {/* ── Pagination footer ── */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', flexWrap: 'wrap',
          p: '10px 18px', borderTop: `1px solid ${C.border}`, bgcolor: C.surface,
        }}>
          <Typography sx={{
            fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted,
            letterSpacing: '0.06em',
          }}>
            {isEs
              ? `${total > 0 ? offset + 1 : 0}-${showingTo} DE ${total}`
              : `${total > 0 ? offset + 1 : 0}-${showingTo} OF ${total}`}
            {' · '}
            {isEs ? `PÁGINA ${page}/${lastPage}` : `PAGE ${page}/${lastPage}`}
          </Typography>

          <Box sx={{ display: 'flex', gap: '6px' }}>
            <Btn disabled={offset === 0 || loading} onClick={() => setOffset(0)}>
              {isEs ? 'INICIO' : 'FIRST'}
            </Btn>
            <Btn disabled={offset === 0 || loading} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}>
              {isEs ? 'ANT' : 'PREV'}
            </Btn>
            <Btn disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(o => o + PAGE_SIZE)}>
              {isEs ? 'SIG' : 'NEXT'}
            </Btn>
            <Btn disabled={offset + PAGE_SIZE >= total || loading}
                 onClick={() => setOffset((lastPage - 1) * PAGE_SIZE)}>
              {isEs ? 'FIN' : 'LAST'}
            </Btn>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
