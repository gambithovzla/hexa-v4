import { useState, useEffect } from "react";
import useBankroll from "../hooks/useBankroll";
import { useAuth } from "../store/authStore";
import { C, BARLOW, MONO } from "../theme";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
function getToken() {
  return localStorage.getItem("hexa_token");
}
// ── Helpers ──────────────────────────────────────────────────────────
function calcPotentialWin(stake, odds) {
  if (!stake || !odds) return 0;
  const s = parseFloat(stake);
  const o = parseFloat(odds);
  if (o > 0) return Math.round(s * (o / 100) * 100) / 100;
  return Math.round(s * (100 / Math.abs(o)) * 100) / 100;
}
function formatMoney(n) {
  if (n == null) return "$0.00";
  return "$" + parseFloat(n).toFixed(2);
}
function ResultBadge({ result }) {
  const map = {
    won:     { label: "WON",     bg: C.greenDim,  color: C.green,  border: C.greenLine  },
    lost:    { label: "LOST",    bg: C.redDim,    color: C.red,    border: C.redLine    },
    pending: { label: "PENDING", bg: C.cyanDim,   color: C.cyan,   border: C.cyanLine   },
  };
  const s = map[result] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      borderRadius: 0, padding: "2px 8px",
      fontFamily: MONO, fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
    }}>{s.label}</span>
  );
}
// ── Oracle Pick Badge (pick_result from picks table) ─────────────────
function OraclePickBadge({ pickResult }) {
  const map = {
    win:     { label: "ORACLE_WIN",  bg: C.greenDim,  color: C.green,  border: C.greenLine  },
    loss:    { label: "ORACLE_LOSS", bg: C.redDim,    color: C.red,    border: C.redLine    },
    pending: { label: "PENDING",     bg: C.cyanDim,   color: C.cyan,   border: C.cyanLine   },
    push:    { label: "PUSH",        bg: C.accentDim, color: C.accent, border: C.accentLine },
  };
  const s = map[pickResult] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      borderRadius: 0, padding: "2px 7px",
      fontFamily: MONO, fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
    }}>{s.label}</span>
  );
}
// ── Oracle ROI Panel ──────────────────────────────────────────────────
function OracleROIPanel({ bets }) {
  const oracleBets = bets.filter(b => b.pick_id != null);
  if (oracleBets.length === 0) return null;

  const settledBets = oracleBets.filter(
    b => b.pick_result && b.pick_result !== "pending"
  );
  const wins   = settledBets.filter(b => b.pick_result === "win").length;
  const losses = settledBets.filter(b => b.pick_result === "loss").length;
  const pushes = settledBets.filter(b => b.pick_result === "push").length;

  const totalStaked = settledBets.reduce((sum, b) => sum + parseFloat(b.stake || 0), 0);
  const totalReturned = settledBets.reduce((sum, b) => {
    if (b.pick_result === "win")  return sum + parseFloat(b.stake || 0) + calcPotentialWin(b.stake, b.odds);
    if (b.pick_result === "push") return sum + parseFloat(b.stake || 0);
    return sum;
  }, 0);

  const totalProfit = totalReturned - totalStaked;
  const roi = totalStaked > 0
    ? ((totalProfit / totalStaked) * 100).toFixed(1)
    : "0.0";
  const roiPositive = parseFloat(roi) >= 0;
  const winRate = (wins + losses) > 0
    ? ((wins / (wins + losses)) * 100).toFixed(0)
    : 0;

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 0, padding: 16, marginBottom: 20,
      position: "relative",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 3, marginBottom: 10, textTransform: "uppercase" }}>
        // H.E.X.A. ORACLE ROI TRACKER
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ color: C.amber, fontFamily: MONO, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>
          [ ORACLE PERFORMANCE ]
        </span>
        <span style={{ color: C.textMuted, fontFamily: MONO, fontSize: 9, marginLeft: "auto" }}>
          {oracleBets.length} BETS_LINKED
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
        <div style={{
          background: C.bg, borderRadius: 0, padding: "12px 14px",
          border: `1px solid ${roiPositive ? C.greenLine : C.redLine}`,
        }}>
          <div style={{ color: C.textMuted, fontFamily: MONO, fontSize: 8, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>ROI</div>
          <div style={{ color: roiPositive ? C.green : C.red, fontSize: 20, fontFamily: BARLOW, textShadow: `0 0 10px ${roiPositive ? C.green : C.red}44` }}>
            {roiPositive ? "+" : ""}{roi}%
          </div>
        </div>
        <div style={{
          background: C.bg, borderRadius: 0, padding: "12px 14px",
          border: `1px solid ${totalProfit >= 0 ? C.greenLine : C.redLine}`,
        }}>
          <div style={{ color: C.textMuted, fontFamily: MONO, fontSize: 8, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>PROFIT</div>
          <div style={{ color: totalProfit >= 0 ? C.green : C.red, fontSize: 16, fontFamily: BARLOW }}>
            {totalProfit >= 0 ? "+" : ""}{formatMoney(totalProfit)}
          </div>
        </div>
        <div style={{ background: C.bg, borderRadius: 0, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ color: C.textMuted, fontFamily: MONO, fontSize: 8, textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>W / L / P</div>
          <div style={{ fontFamily: MONO, fontSize: 12 }}>
            <span style={{ color: C.green }}>{wins}W</span>
            <span style={{ color: C.textDim, margin: "0 3px" }}>·</span>
            <span style={{ color: C.red }}>{losses}L</span>
            <span style={{ color: C.textDim, margin: "0 3px" }}>·</span>
            <span style={{ color: C.textSecondary }}>{pushes}P</span>
          </div>
        </div>
        <div style={{ background: C.bg, borderRadius: 0, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ color: C.textMuted, fontFamily: MONO, fontSize: 8, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>WIN%</div>
          <div style={{ color: parseFloat(winRate) >= 55 ? C.green : C.amber, fontSize: 20, fontFamily: BARLOW, textShadow: `0 0 10px ${parseFloat(winRate) >= 55 ? C.green : C.amber}44` }}>
            {winRate}%
          </div>
        </div>
      </div>
    </div>
  );
}
// ── Mini gráfica de evolución ─────────────────────────────────────────
function BankrollChart({ history, initial }) {
  if (!history || history.length === 0) return (
    <div style={{ color: C.textMuted, textAlign: "center", padding: "40px 0", fontSize: 13 }}>
      Sin historial suficiente para graficar
    </div>
  );
  // Construir puntos acumulando profit
  let running = parseFloat(initial || 0);
  const points = [running];
  history.forEach(b => {
    if (b.result === "won") running += calcPotentialWin(b.stake, b.odds);
    else if (b.result === "lost") running -= parseFloat(b.stake);
    points.push(running);
  });
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const W = 600, H = 120, pad = 10;
  const px = (i) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const py = (v) => H - pad - ((v - min) / range) * (H - pad * 2);
  const polyline = points.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  const fill = points.map((v, i) => `${px(i)},${py(v)}`).join(" ")
    + ` ${px(points.length - 1)},${H} ${px(0)},${H}`;
  const isPositive = points[points.length - 1] >= points[0];
  const lineColor = isPositive ? C.green : C.red;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 120 }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill="url(#chartGrad)" />
      <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={px(points.length - 1)} cy={py(points[points.length - 1])} r="4" fill={lineColor} />
    </svg>
  );
}
// ── Setup inicial ─────────────────────────────────────────────────────
function SetupBankroll({ onSetup }) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const handleSetup = async () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    setLoading(true);
    await onSetup(n);
    setLoading(false);
  };
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.cyan, letterSpacing: 3, marginBottom: 16, opacity: 0.6 }}>// BANKROLL_INIT_SEQUENCE</div>
      <div style={{ fontFamily: BARLOW, fontSize: 18, color: C.textPrimary, marginBottom: 8, letterSpacing: 3, textTransform: "uppercase" }}>[ Configura tu Bankroll ]</div>
      <p style={{ fontFamily: MONO, fontSize: 11, color: C.textMuted, marginBottom: 28, letterSpacing: 1 }}>
        Define tu bankroll inicial para comenzar a trackear tus apuestas
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", maxWidth: 300, margin: "0 auto" }}>
        <input
          type="number"
          placeholder="Ej: 500"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 0,
            border: `1px solid rgba(0,217,255,0.25)`,
            background: "rgba(0,217,255,0.04)",
            color: C.textPrimary, fontSize: 13,
            fontFamily: MONO, outline: "none", letterSpacing: "0.04em",
          }}
        />
        <button
          onClick={handleSetup}
          disabled={loading || !amount}
          style={{
            padding: "10px 20px", borderRadius: 0,
            background: loading ? "transparent" : "rgba(255,102,0,0.12)",
            color: loading ? C.textMuted : C.accent,
            border: `1px solid ${loading ? C.border : C.accentLine}`,
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 10, fontFamily: MONO, letterSpacing: 3, textTransform: "uppercase",
            boxShadow: loading ? "none" : C.accentGlow,
          }}
        >{loading ? "..." : "[ GUARDAR ]"}</button>
      </div>
    </div>
  );
}
// ── Formulario agregar apuesta ────────────────────────────────────────
function AddBetForm({ onAdd, currentBankroll }) {
  const [form, setForm] = useState({ matchup: "", pick: "", odds: "", stake: "", source: "manual" });
  const [kellyStake, setKellyStake] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const fetchKelly = async () => {
    if (!form.odds || !form.confidence) return;
    try {
      const res = await fetch(
        `${API_URL}/api/bankroll/kelly?odds=${form.odds}&confidence=${form.confidence}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      const json = await res.json();
      if (json.success) setKellyStake(json.data.suggestedStake);
    } catch {}
  };
  const handleSubmit = async () => {
    if (!form.matchup || !form.pick || !form.odds || !form.stake) return;
    setLoading(true);
    await onAdd({
      matchup: form.matchup,
      pick: form.pick,
      odds: parseFloat(form.odds),
      stake: parseFloat(form.stake),
      source: form.source
    });
    setForm({ matchup: "", pick: "", odds: "", stake: "", source: "manual" });
    setKellyStake(null);
    setLoading(false);
    setOpen(false);
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} style={{
      width: "100%", padding: "11px", borderRadius: 0,
      border: `1px dashed ${C.cyanLine}`, background: "transparent",
      color: C.textMuted, cursor: "pointer",
      fontFamily: MONO, fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
      marginBottom: 16, transition: "all 0.2s",
    }}>+ REGISTER_MANUAL_BET</button>
  );
  const potentialWin = calcPotentialWin(form.stake, form.odds);
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.cyanLine}`,
      borderRadius: 0, padding: 16, marginBottom: 16,
      position: "relative",
    }}>
      {/* Corner brackets */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 12, height: 12,
        borderTop: `2px solid ${C.cyan}`, borderLeft: `2px solid ${C.cyan}` }} />
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12,
        borderBottom: `2px solid ${C.accent}`, borderRight: `2px solid ${C.accent}` }} />

      {/* Header */}
      <div style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" }}>
        // BET_REGISTRATION_CONSOLE
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>MATCHUP</label>
          <input placeholder="NYY vs BOS" value={form.matchup}
            onChange={e => set("matchup", e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>PICK</label>
          <input placeholder="NYY -1.5" value={form.pick}
            onChange={e => set("pick", e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>ODDS</label>
          <input placeholder="-110" type="number" value={form.odds}
            onChange={e => set("odds", e.target.value)}
            onBlur={fetchKelly} style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>STAKE ($)</label>
          <div style={{ position: "relative" }}>
            <input placeholder="100" type="number" value={form.stake}
              onChange={e => set("stake", e.target.value)} style={inputStyle} />
            {kellyStake && (
              <button onClick={() => set("stake", kellyStake)} style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: C.accentDim, border: `1px solid ${C.accentLine}`,
                color: C.accent, fontSize: 8, borderRadius: 0,
                padding: "2px 5px", cursor: "pointer", fontFamily: MONO, letterSpacing: 1,
              }}>K:${kellyStake}</button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>CONFIDENCE % (opt)</label>
          <input placeholder="Oracle %" type="number" value={form.confidence || ""}
            onChange={e => set("confidence", e.target.value)}
            onBlur={fetchKelly} style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>SOURCE</label>
          <select value={form.source} onChange={e => set("source", e.target.value)} style={inputStyle}>
            <option value="manual">Manual</option>
            <option value="hexa">Oracle (HEXA)</option>
          </select>
        </div>
      </div>
      {form.stake && form.odds && (
        <div style={{ fontFamily: MONO, fontSize: 9, color: C.textMuted, marginBottom: 12, letterSpacing: 1, borderTop: `1px solid ${C.cyanLine}`, paddingTop: 8 }}>
          WIN: <span style={{ color: C.green }}>{formatMoney(potentialWin)}</span>
          {" ·· "}RISK: <span style={{ color: C.red }}>{formatMoney(form.stake)}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSubmit} disabled={loading} style={{
          flex: 1, padding: "10px", borderRadius: 0,
          background: loading ? "transparent" : C.accentDim,
          color: loading ? C.textMuted : C.accent,
          border: `1px solid ${loading ? C.border : C.accentLine}`,
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: MONO, fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
          boxShadow: loading ? "none" : C.accentGlow,
        }}>{loading ? "SAVING..." : "[ REGISTER_BET ]"}</button>
        <button onClick={() => setOpen(false)} style={{
          padding: "10px 16px", borderRadius: 0, background: "transparent",
          border: `1px solid ${C.cyanLine}`, color: C.textMuted, cursor: "pointer",
          fontFamily: MONO, fontSize: 9, letterSpacing: 2,
        }}>CANCEL</button>
      </div>
    </div>
  );
}
const inputStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 0,
  border: `1px solid ${C.cyanLine}`, background: `rgba(0,217,255,0.04)`,
  color: C.textPrimary, fontFamily: MONO, fontSize: 12,
  letterSpacing: "0.04em", outline: "none", boxSizing: "border-box",
  colorScheme: "dark",
};
// ── Componente principal ──────────────────────────────────────────────
export default function BankrollTracker({ lang = "es" }) {
  const { isAuthenticated } = useAuth();
  const { bankrollData, loading, refreshBankroll, setupBankroll, addBet, updateBetResult, deleteBet, updateInitialBankroll } = useBankroll();
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [filterResult, setFilterResult] = useState("all");
  const [editingBankroll, setEditingBankroll] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  useEffect(() => {
    fetchStats();
  }, []);
  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/bankroll/stats`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const json = await res.json();
      if (json.success) setStats(json.data);
    } catch {}
    setStatsLoading(false);
  };
  const handleAddBet = async (bet) => {
    await addBet(bet);
    await fetchStats();
  };
  const handleUpdateResult = async (id, result) => {
    await updateBetResult(id, result);
    await refreshBankroll();
    await fetchStats();
  };
  const handleDelete = async (id) => {
    await deleteBet(id);
    await refreshBankroll();
    await fetchStats();
  };
  if (!isAuthenticated) return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
      <p style={{ color: C.textMuted, fontSize: 14 }}>Inicia sesión para usar el Bankroll Tracker.</p>
    </div>
  );
  if (loading) return (
    <div style={{ color: C.textMuted, textAlign: "center", padding: 60, fontSize: 13 }}>
      Cargando bankroll...
    </div>
  );
  if (!bankrollData?.initialBankroll) {
    return <SetupBankroll onSetup={setupBankroll} />;
  }
  const { initialBankroll, currentBankroll, bets = [] } = bankrollData;
  const profitLoss = currentBankroll - initialBankroll;
  const isPositive = profitLoss >= 0;
  const filteredBets = filterResult === "all"
    ? bets
    : bets.filter(b => b.result === filterResult);
  const views = ["dashboard", "history", "stats", "chart"];
  const viewLabels = { dashboard: "Dashboard", history: "Historial", stats: "Oracle Stats", chart: "Gráfica" };
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 0" }}>
      {/* Nav interno */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: `1px solid ${C.cyanLine}` }}>
        {views.map(v => (
          <button key={v} onClick={() => setActiveView(v)} style={{
            flex: 1, padding: "9px 4px", border: "none", borderBottom: `2px solid ${activeView === v ? C.cyan : "transparent"}`,
            background: activeView === v ? C.cyanDim : "transparent",
            color: activeView === v ? C.cyan : C.textMuted,
            cursor: "pointer", fontFamily: MONO, fontSize: 8, letterSpacing: 2, textTransform: "uppercase",
            boxShadow: activeView === v ? `0 2px 8px rgba(0,217,255,0.25)` : "none",
            transition: "all 0.15s",
          }}>{viewLabels[v]}</button>
        ))}
      </div>
      {/* ── DASHBOARD ── */}
      {activeView === "dashboard" && (
        <div>
          {/* Oracle ROI Panel — arriba del todo */}
          <OracleROIPanel bets={bets} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 8 }}>
            {/* Bankroll actual card */}
            <div style={{ background: C.surface, border: `1px solid ${C.accentLine}`, borderRadius: 0, padding: "12px 14px", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: 8, height: 8, borderTop: `1px solid ${C.accent}`, borderLeft: `1px solid ${C.accent}` }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontFamily: MONO, color: C.textMuted, fontSize: 7, textTransform: "uppercase", letterSpacing: 2 }}>BANKROLL</div>
                <button onClick={() => { setEditingBankroll(!editingBankroll); setEditAmount(initialBankroll); }} style={{
                  background: "transparent", border: `1px solid ${C.cyanLine}`, color: C.cyan, cursor: "pointer",
                  fontFamily: MONO, fontSize: 8, padding: "2px 5px", borderRadius: 0,
                }}>EDIT</button>
              </div>
              {editingBankroll ? (
                <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
                  <input
                    type="number"
                    value={editAmount}
                    onChange={e => setEditAmount(e.target.value)}
                    style={{ width: "70px", padding: "4px 8px", borderRadius: 0, border: `1px solid ${C.cyanLine}`, background: C.bg, color: C.textPrimary, fontFamily: MONO, fontSize: 12, outline: "none" }}
                  />
                  <button
                    onClick={async () => {
                      const n = parseFloat(editAmount);
                      if (!n || n <= 0) return;
                      setEditLoading(true);
                      await updateInitialBankroll(n);
                      setEditLoading(false);
                      setEditingBankroll(false);
                      await fetchStats();
                    }}
                    disabled={editLoading}
                    style={{ padding: "4px 8px", borderRadius: 0, background: C.accentDim, color: C.accent, border: `1px solid ${C.accentLine}`, cursor: "pointer", fontFamily: MONO, fontSize: 8 }}
                  >{editLoading ? "…" : "OK"}</button>
                  <button onClick={() => setEditingBankroll(false)} style={{
                    padding: "4px 6px", borderRadius: 0, background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, cursor: "pointer", fontFamily: MONO, fontSize: 8,
                  }}>✕</button>
                </div>
              ) : (
                <div style={{ color: C.accent, fontSize: 22, fontFamily: BARLOW, textShadow: `0 0 12px ${C.accent}55` }}>{formatMoney(currentBankroll)}</div>
              )}
            </div>
            {[
              { label: "P&L TOTAL", value: (isPositive ? "+" : "") + formatMoney(profitLoss), color: isPositive ? C.green : C.red, border: isPositive ? C.greenLine : C.redLine },
              { label: "ROI", value: (stats?.general?.roi ?? 0) + "%", color: isPositive ? C.green : C.red, border: isPositive ? C.greenLine : C.redLine },
            ].map(c => (
              <div key={c.label} style={{ background: C.surface, border: `1px solid ${c.border}`, borderRadius: 0, padding: "12px 14px" }}>
                <div style={{ fontFamily: MONO, color: C.textMuted, fontSize: 7, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 22, fontFamily: BARLOW, textShadow: `0 0 10px ${c.color}44` }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginBottom: 20 }}>
            {[
              { label: "WIN_RATE", value: (stats?.general?.winRate ?? 0) + "%", color: C.cyan, border: C.cyanLine },
              { label: "WON", value: stats?.general?.wins ?? 0, color: C.green, border: C.greenLine },
              { label: "LOST", value: stats?.general?.losses ?? 0, color: C.red, border: C.redLine },
            ].map(c => (
              <div key={c.label} style={{ background: C.surface, border: `1px solid ${c.border}`, borderRadius: 0, padding: "12px 14px" }}>
                <div style={{ fontFamily: MONO, color: C.textMuted, fontSize: 7, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 22, fontFamily: BARLOW, textShadow: `0 0 10px ${c.color}44` }}>{c.value}</div>
              </div>
            ))}
          </div>
          <AddBetForm onAdd={handleAddBet} currentBankroll={currentBankroll} />
          {/* Últimas 5 apuestas */}
          <div style={{ fontFamily: MONO, color: C.cyan, fontSize: 8, textTransform: "uppercase", letterSpacing: 3, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.textDim }}>[</span> RECENT_BETS <span style={{ color: C.textDim }}>]</span>
          </div>
          {bets.slice(0, 5).map(bet => (
            <BetRow key={bet.id} bet={bet} onUpdate={handleUpdateResult} onDelete={handleDelete} />
          ))}
        </div>
      )}
      {/* ── HISTORIAL ── */}
      {activeView === "history" && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {[
              { key: "all",     label: "ALL" },
              { key: "pending", label: "PENDING" },
              { key: "won",     label: "WON" },
              { key: "lost",    label: "LOST" },
            ].map(f => (
              <button key={f.key} onClick={() => setFilterResult(f.key)} style={{
                padding: "6px 12px", borderRadius: 0, border: `1px solid ${filterResult === f.key ? C.cyan : C.border}`,
                background: filterResult === f.key ? C.cyanDim : "transparent",
                color: filterResult === f.key ? C.cyan : C.textMuted,
                cursor: "pointer", fontFamily: MONO, fontSize: 8, letterSpacing: 2,
                boxShadow: filterResult === f.key ? `0 0 8px rgba(0,217,255,0.25)` : "none",
              }}>{f.label}</button>
            ))}
          </div>
          <AddBetForm onAdd={handleAddBet} currentBankroll={currentBankroll} />
          {filteredBets.length === 0
            ? <div style={{ color: C.textGhost, textAlign: "center", padding: 40, fontSize: 13 }}>Sin apuestas en esta categoría</div>
            : filteredBets.map(bet => (
              <BetRow key={bet.id} bet={bet} onUpdate={handleUpdateResult} onDelete={handleDelete} />
            ))
          }
        </div>
      )}
      {/* ── ORACLE STATS ── */}
      {activeView === "stats" && (
        <div>
          {statsLoading
            ? <div style={{ fontFamily: MONO, color: C.textMuted, textAlign: "center", padding: 40, fontSize: 10, letterSpacing: 3 }}>// COMPUTING_STATS…</div>
            : stats ? (
              <div>
                <div style={{ background: C.surface, border: `1px solid ${C.cyanLine}`, borderRadius: 0, padding: 16, marginBottom: 10, position: "relative" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${C.cyan}`, borderLeft: `1px solid ${C.cyan}` }} />
                  <div style={{ fontFamily: MONO, color: C.textMuted, fontSize: 7, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>// SOURCE_PERFORMANCE</div>
                  {stats.bySource.length === 0
                    ? <div style={{ fontFamily: MONO, color: C.textMuted, fontSize: 10 }}>NO_DATA</div>
                    : stats.bySource.map(s => (
                      <div key={s.source} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                        <div>
                          <span style={{ color: C.textPrimary, fontFamily: MONO, fontSize: 10, letterSpacing: 1 }}>{s.source === "hexa" ? "ORACLE_HEXA" : "MANUAL_INPUT"}</span>
                          <span style={{ color: C.textMuted, fontFamily: MONO, fontSize: 8, marginLeft: 8 }}>{s.total} BETS</span>
                        </div>
                        <div style={{ color: parseFloat(s.win_rate) >= 55 ? C.green : C.cyan, fontFamily: MONO, fontSize: 11, letterSpacing: 1 }}>
                          {s.win_rate ?? "—"}% WR
                        </div>
                      </div>
                    ))
                  }
                </div>
                <div style={{ background: C.surface, border: `1px solid ${C.cyanLine}`, borderRadius: 0, padding: 16 }}>
                  <div style={{ fontFamily: MONO, color: C.textMuted, fontSize: 7, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>// GENERAL_SUMMARY</div>
                  {[
                    { label: "TOTAL_BETS",    value: stats.general.total,                                          color: C.textPrimary },
                    { label: "PENDING",        value: stats.general.pending,                                        color: C.cyan },
                    { label: "WIN_RATE",       value: stats.general.winRate + "%",                                  color: stats.general.winRate >= 55 ? C.green : C.cyan },
                    { label: "PROFIT",         value: formatMoney(stats.general.totalProfit),                       color: stats.general.totalProfit >= 0 ? C.green : C.red },
                    { label: "ROI",            value: stats.general.roi + "%",                                      color: stats.general.roi >= 0 ? C.green : C.red },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                      <span style={{ color: C.textMuted, fontFamily: MONO, fontSize: 9, letterSpacing: 1 }}>{row.label}</span>
                      <span style={{ color: row.color, fontFamily: MONO, fontSize: 11 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div style={{ fontFamily: MONO, color: C.textMuted, textAlign: "center", padding: 40, fontSize: 10, letterSpacing: 2 }}>NO_DATA_AVAILABLE</div>
          }
        </div>
      )}
      {/* ── GRÁFICA ── */}
      {activeView === "chart" && (
        <div>
          <div style={{ background: C.surface, border: `1px solid ${C.cyanLine}`, borderRadius: 0, padding: 16, position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${C.cyan}`, borderLeft: `1px solid ${C.cyan}` }} />
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${C.accent}`, borderRight: `1px solid ${C.accent}` }} />
            <div style={{ fontFamily: MONO, fontSize: 7, color: C.textMuted, letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>// BANKROLL_EVOLUTION_CHART</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: BARLOW, color: C.textPrimary, fontSize: 12, letterSpacing: 3, textTransform: "uppercase" }}>[ BANKROLL CURVE ]</div>
              <div style={{ color: isPositive ? C.green : C.red, fontFamily: MONO, fontSize: 12, letterSpacing: 1, textShadow: `0 0 8px ${isPositive ? C.green : C.red}66` }}>
                {isPositive ? "▲" : "▼"} {formatMoney(Math.abs(profitLoss))}
              </div>
            </div>
            <BankrollChart history={stats?.bankrollHistory || []} initial={initialBankroll} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontFamily: MONO, color: C.textMuted, fontSize: 8, letterSpacing: 1 }}>INIT: {formatMoney(initialBankroll)}</span>
              <span style={{ fontFamily: MONO, color: C.textMuted, fontSize: 8, letterSpacing: 1 }}>CURRENT: {formatMoney(currentBankroll)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ── Fila de apuesta ───────────────────────────────────────────────────
const PICK_RESULT_BORDER = {
  win:     C.greenLine,
  loss:    C.redLine,
  push:    C.accentLine,
  pending: C.amberLine,
};
function BetRow({ bet, onUpdate, onDelete }) {
  const [updating, setUpdating] = useState(false);
  const handleResult = async (result) => {
    setUpdating(true);
    await onUpdate(bet.id, result);
    setUpdating(false);
  };
  const potentialWin = calcPotentialWin(bet.stake, bet.odds);
  const hasOraclePick = bet.pick_id != null;
  const borderColor = hasOraclePick
    ? (PICK_RESULT_BORDER[bet.pick_result] || PICK_RESULT_BORDER.pending)
    : C.border;
  const dateStr = bet.created_at
    ? new Date(bet.created_at).toISOString().slice(0, 10)
    : "—";
  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 0, padding: "12px 14px", marginBottom: 6,
      position: "relative",
      borderLeft: hasOraclePick ? `3px solid ${borderColor}` : `1px solid ${borderColor}`,
    }}>
      {/* Corner bracket bottom-right */}
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8,
        borderBottom: `1px solid ${borderColor}`, borderRight: `1px solid ${borderColor}` }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Terminal date */}
          <div style={{ fontFamily: MONO, color: C.textMuted, fontSize: 7, letterSpacing: 2, marginBottom: 4 }}>
            LOG // {dateStr}{bet.source === "hexa" ? " · ORACLE" : " · MANUAL"}
          </div>
          <div style={{ color: C.textPrimary, fontFamily: MONO, fontSize: 12, letterSpacing: "0.04em" }}>{bet.pick}</div>
          <div style={{ color: C.textMuted, fontFamily: MONO, fontSize: 9, marginTop: 2, letterSpacing: 1 }}>{bet.matchup}</div>
          {/* Oracle pick info */}
          {hasOraclePick && (bet.oracle_pick || bet.pick_result) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {bet.oracle_pick && (
                <span style={{
                  color: C.accent, fontFamily: MONO, fontSize: 8, background: C.accentDim,
                  border: `1px solid ${C.accentLine}`, borderRadius: 0, padding: "1px 6px", letterSpacing: 1,
                }}>
                  ORACLE: {bet.oracle_pick}
                </span>
              )}
              {bet.pick_result && <OraclePickBadge pickResult={bet.pick_result} />}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <ResultBadge result={bet.result} />
        </div>
      </div>
      {/* Data row */}
      <div style={{ display: "flex", gap: 14, marginBottom: bet.result === "pending" ? 10 : 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, color: C.textMuted, fontSize: 9 }}>STAKE: <span style={{ color: C.textPrimary }}>${bet.stake}</span></span>
        <span style={{ fontFamily: MONO, color: C.textMuted, fontSize: 9 }}>ODDS: <span style={{ color: C.cyan }}>{bet.odds > 0 ? "+" : ""}{bet.odds}</span></span>
        <span style={{ fontFamily: MONO, color: C.textMuted, fontSize: 9 }}>WIN: <span style={{ color: C.green }}>{formatMoney(potentialWin)}</span></span>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {bet.result === "pending" && (
          <>
            <button onClick={() => handleResult("won")} disabled={updating} style={{
              padding: "4px 12px", borderRadius: 0, border: `1px solid ${C.greenLine}`,
              background: C.greenDim, color: C.green, cursor: "pointer",
              fontFamily: MONO, fontSize: 8, letterSpacing: 2,
            }}>✓ WON</button>
            <button onClick={() => handleResult("lost")} disabled={updating} style={{
              padding: "4px 12px", borderRadius: 0, border: `1px solid ${C.redLine}`,
              background: C.redDim, color: C.red, cursor: "pointer",
              fontFamily: MONO, fontSize: 8, letterSpacing: 2,
            }}>✗ LOST</button>
          </>
        )}
        <button onClick={() => onDelete(bet.id)} style={{
          padding: "4px 10px", borderRadius: 0, border: `1px solid ${C.redLine}`,
          background: C.redDim, color: C.red, cursor: "pointer",
          fontFamily: MONO, fontSize: 8, letterSpacing: 1, marginLeft: "auto",
        }}>DEL</button>
      </div>
    </div>
  );
}
