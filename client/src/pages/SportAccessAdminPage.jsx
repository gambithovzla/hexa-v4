import { useState, useEffect } from 'react';
import { Box, Typography, Switch, CircularProgress, Chip, Avatar } from '@mui/material';

const SPORTS = [
  { key: 'nba',    label: 'NBA',    color: '#f59e0b' },
  { key: 'nfl',    label: 'NFL',    color: '#10b981' },
  { key: 'nhl',    label: 'NHL',    color: '#3b82f6' },
  { key: 'soccer', label: 'Soccer', color: '#22c55e' },
];

const API  = import.meta.env.VITE_API_URL ?? '';
const MONO = "'JetBrains Mono','Fira Mono',monospace";
const C    = { bg: '#0a1014', card: '#0f1923', line: '#1e2a35', cyan: '#00e5ff', ink0: '#e8f0f5', ink1: '#8faabf', ink2: '#4a6070' };

function initials(email = '') {
  return email.slice(0, 2).toUpperCase();
}

export default function SportAccessAdminPage({ token, onBack }) {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState({});
  const [search,  setSearch]  = useState('');

  useEffect(() => {
    fetch(`${API}/api/admin/sport-access/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { setUsers(d.users ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const toggle = async (userId, sport, currentAccess) => {
    const has = (currentAccess ?? ['mlb']).includes(sport);
    const newAccess = has
      ? (currentAccess ?? ['mlb']).filter(s => s !== sport)
      : [...(currentAccess ?? ['mlb']), sport];

    setUsers(prev => prev.map(u => u.id === userId ? { ...u, sport_access: newAccess } : u));
    setSaving(prev => ({ ...prev, [userId + sport]: true }));

    try {
      const r = await fetch(`${API}/api/admin/sport-access/${userId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sports: newAccess }),
      });
      const d = await r.json();
      if (d.success) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, sport_access: d.user.sport_access } : u));
      } else {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, sport_access: currentAccess } : u));
      }
    } catch {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, sport_access: currentAccess } : u));
    } finally {
      setSaving(prev => ({ ...prev, [userId + sport]: false }));
    }
  };

  const filtered = users.filter(u =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, color: C.ink0, fontFamily: MONO }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 2,
        borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 0, bgcolor: C.bg, zIndex: 10 }}>
        <Box component="button" onClick={onBack}
          sx={{ background: 'none', border: 'none', color: C.cyan, cursor: 'pointer',
            fontSize: '1.2rem', display: 'flex', alignItems: 'center', p: '4px 8px',
            borderRadius: '6px', '&:hover': { bgcolor: C.card } }}>
          ← Volver
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontFamily: MONO, fontWeight: 700, fontSize: '1rem', color: C.ink0 }}>
            Acceso por Deporte
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.ink2, letterSpacing: '0.1em' }}>
            {users.length} USUARIOS
          </Typography>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 860, mx: 'auto', p: 3 }}>
        {/* Search */}
        <Box component="input"
          placeholder="Buscar usuario..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{
            width: '100%', mb: 3, p: '10px 14px',
            bgcolor: C.card, border: `1px solid ${C.line}`, borderRadius: '8px',
            color: C.ink0, fontFamily: MONO, fontSize: '0.85rem',
            outline: 'none', '&:focus': { borderColor: C.cyan },
            '&::placeholder': { color: C.ink2 },
            boxSizing: 'border-box',
          }}
        />

        {/* Column headers */}
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, mb: 1, gap: 2 }}>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Chip label="MLB" size="small"
              sx={{ bgcolor: '#15803d22', color: '#22c55e', fontFamily: MONO, fontSize: '0.6rem',
                border: '1px solid #22c55e44', width: 52 }} />
            {SPORTS.map(s => (
              <Box key={s.key} sx={{ width: 52, textAlign: 'center',
                fontFamily: MONO, fontSize: '0.65rem', color: C.ink2, letterSpacing: '0.08em' }}>
                {s.label}
              </Box>
            ))}
          </Box>
        </Box>

        {/* User list */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={32} sx={{ color: C.cyan }} />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, color: C.ink2, fontFamily: MONO, fontSize: '0.8rem' }}>
            Sin resultados
          </Box>
        ) : (
          filtered.map(user => {
            const access = user.sport_access ?? ['mlb'];
            return (
              <Box key={user.id} sx={{
                display: 'flex', alignItems: 'center', gap: 2, px: 2, py: '10px',
                mb: '4px', bgcolor: C.card, borderRadius: '8px',
                border: `1px solid ${C.line}`,
                '&:hover': { borderColor: '#2a3f50' },
              }}>
                {/* Avatar + info */}
                <Avatar sx={{ width: 34, height: 34, bgcolor: '#1a3a4a',
                  color: C.cyan, fontFamily: MONO, fontSize: '0.75rem', fontWeight: 700 }}>
                  {initials(user.email)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.ink0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.email}
                  </Typography>
                  {user.is_admin && (
                    <Chip label="Admin" size="small"
                      sx={{ bgcolor: '#00e5ff22', color: C.cyan, fontFamily: MONO,
                        fontSize: '0.55rem', height: 16, mt: '2px', border: `1px solid ${C.cyan}44` }} />
                  )}
                </Box>

                {/* Sport toggles */}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {/* MLB — always on, locked */}
                  <Box sx={{ width: 52, display: 'flex', justifyContent: 'center' }}>
                    <Switch checked disabled size="small"
                      sx={{ '& .MuiSwitch-thumb': { bgcolor: '#22c55e' },
                        '& .MuiSwitch-track': { bgcolor: '#15803d !important', opacity: '0.6 !important' } }} />
                  </Box>

                  {/* NBA / NFL / NHL / Soccer */}
                  {SPORTS.map(s => {
                    const isSaving = saving[user.id + s.key];
                    const isOn = user.is_admin || access.includes(s.key);
                    return (
                      <Box key={s.key} sx={{ width: 52, display: 'flex', justifyContent: 'center' }}>
                        {isSaving ? (
                          <CircularProgress size={18} sx={{ color: s.color, my: '11px' }} />
                        ) : (
                          <Switch
                            checked={isOn}
                            disabled={user.is_admin}
                            size="small"
                            onChange={() => toggle(user.id, s.key, access)}
                            sx={{
                              '& .MuiSwitch-thumb': { bgcolor: isOn ? s.color : C.ink2 },
                              '& .MuiSwitch-track': {
                                bgcolor: isOn ? `${s.color}44 !important` : `${C.line} !important`,
                                opacity: '1 !important',
                              },
                            }}
                          />
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
