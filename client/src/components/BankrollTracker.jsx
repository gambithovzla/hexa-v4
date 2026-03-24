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
    pending: { label: "PENDING", bg: C.amberDim,  color: C.amber,  border: C.amberLine  },
  };
  const s = map[result] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      borderRadius: 4, padding: "2px 8px",
      fontSize: 11, fontWeight: 700, letterSpacing: 1
    }}>{s.label}</span>
  );
}
// ── Oracle Pick Badge (pick_result from picks table) ─────────────────
function OraclePickBadge({ pickResult }) {
  const map = {
    win:     { label: "ORACLE WIN",  bg: C.greenDim,  color: C.green,  border: C.greenLine  },
    loss:    { label: "ORACLE LOSS", bg: C.redDim,    color: C.red,    border: C.redLine    },
    pending: { label: "PENDIENTE",   bg: C.amberDim,  color: C.amber,  border: C.amberLine  },
    push:    { label: "PUSH",        bg: C.accentDim, color: C.accent, border: C.accentLine },
  };
  const s = map[pickResult] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      borderRadius: 4, padding: "2px 7px",
      fontSize: 10, fontWeight: 700, letterSpacing: 1
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
      borderRadius: 4, padding: 16, marginBottom: 20
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 15 }}>🤖</span>
        <span style={{ color: C.amber, fontWeight: 700, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>
          H.E.X.A. Oracle ROI
        </span>
        <span style={{ color: C.textGhost, fontSize: 11, marginLeft: "auto" }}>
          {oracleBets.length} apuesta{oracleBets.length !== 1 ? "s" : ""} vinculada{oracleBets.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        <div style={{
          background: C.bg, borderRadius: 8, padding: "12px 14px",
          border: `1px solid ${roiPositive ? C.greenLine : C.redLine}`
        }}>
          <div style={{ color: C.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>ROI Oracle</div>
          <div style={{ color: roiPositive ? C.green : C.red, fontSize: 20, fontWeight: 700 }}>
            {roiPositive ? "+" : ""}{roi}%
          </div>
        </div>
        <div style={{
          background: C.bg, borderRadius: 8, padding: "12px 14px",
          border: `1px solid ${totalProfit >= 0 ? C.greenLine : C.redLine}`
        }}>
          <div style={{ color: C.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Profit Neto</div>
          <div style={{ color: totalProfit >= 0 ? C.green : C.red, fontSize: 18, fontWeight: 700 }}>
            {totalProfit >= 0 ? "+" : ""}{formatMoney(totalProfit)}
          </div>
        </div>
        <div style={{ background: C.bg, borderRadius: 8, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ color: C.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Récord</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            <span style={{ color: C.green }}>{wins}W</span>
            <span style={{ color: C.border, margin: "0 3px" }}>·</span>
            <span style={{ color: C.red }}>{losses}L</span>
            <span style={{ color: C.border, margin: "0 3px" }}>·</span>
            <span style={{ color: C.textSecondary }}>{pushes}P</span>
          </div>
        </div>
        <div style={{ background: C.bg, borderRadius: 8, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ color: C.textDim, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Win Rate</div>
          <div style={{ color: parseFloat(winRate) >= 55 ? C.green : C.amber, fontSize: 20, fontWeight: 700 }}>
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
      <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
      <h2 style={{ color: C.amber, marginBottom: 8, fontSize: 20 }}>Configura tu Bankroll</h2>
      <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 28 }}>
        Define tu bankroll inicial para comenzar a trackear tus apuestas
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", maxWidth: 300, margin: "0 auto" }}>
        <input
          type="number"
          placeholder="Ej: 500"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.surfaceAlt,
            color: C.textPrimary, fontSize: 15, outline: "none"
          }}
        />
        <button
          onClick={handleSetup}
          disabled={loading || !amount}
          style={{
            padding: "10px 20px", borderRadius: 8,
            background: loading ? C.border : C.amber,
            color: "#111111", fontWeight: 700,
            border: "none", cursor: loading ? "not-allowed" : "pointer",
            fontSize: 14
          }}
        >{loading ? "..." : "Guardar"}</button>
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
      width: "100%", padding: "12px", borderRadius: 8,
      border: `1px dashed ${C.border}`, background: "transparent",
      color: C.textMuted, cursor: "pointer", fontSize: 13,
      marginBottom: 16, transition: "all 0.2s"
    }}>+ Registrar apuesta manual</button>
  );
  const potentialWin = calcPotentialWin(form.stake, form.odds);
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: 16, marginBottom: 16
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input placeholder="Matchup (ej: NYY vs BOS)" value={form.matchup}
          onChange={e => set("matchup", e.target.value)} style={inputStyle} />
        <input placeholder="Pick (ej: NYY -1.5)" value={form.pick}
          onChange={e => set("pick", e.target.value)} style={inputStyle} />
        <input placeholder="Odds (ej: -110)" type="number" value={form.odds}
          onChange={e => set("odds", e.target.value)}
          onBlur={fetchKelly} style={inputStyle} />
        <div style={{ position: "relative" }}>
          <input placeholder="Stake ($)" type="number" value={form.stake}
            onChange={e => set("stake", e.target.value)} style={inputStyle} />
          {kellyStake && (
            <button onClick={() => set("stake", kellyStake)} style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              background: C.amberDim, border: `1px solid ${C.amberLine}`,
              color: C.amber, fontSize: 10, borderRadius: 4,
              padding: "2px 5px", cursor: "pointer"
            }}>Kelly: ${kellyStake}</button>
          )}
        </div>
        <input placeholder="Confianza Oracle % (opcional)" type="number" value={form.confidence || ""}
          onChange={e => set("confidence", e.target.value)}
          onBlur={fetchKelly} style={inputStyle} />
        <select value={form.source} onChange={e => set("source", e.target.value)} style={inputStyle}>
          <option value="manual">Manual</option>
          <option value="hexa">Oracle (HEXA)</option>
        </select>
      </div>
      {form.stake && form.odds && (
        <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 10 }}>
          Ganancia potencial: <span style={{ color: C.green }}>{formatMoney(potentialWin)}</span>
          {" · "}Riesgo: <span style={{ color: C.red }}>{formatMoney(form.stake)}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSubmit} disabled={loading} style={{
          flex: 1, padding: "9px", borderRadius: 7,
          background: loading ? C.border : C.amber,
          color: "#111111", fontWeight: 700, border: "none",
          cursor: loading ? "not-allowed" : "pointer", fontSize: 13
        }}>{loading ? "Guardando..." : "Registrar apuesta"}</button>
        <button onClick={() => setOpen(false)} style={{
          padding: "9px 14px", borderRadius: 7, background: "transparent",
          border: `1px solid ${C.border}`, color: C.textMuted, cursor: "pointer", fontSize: 13
        }}>Cancelar</button>
      </div>
    </div>
  );
}
const inputStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 7,
  border: `1px solid ${C.border}`, background: C.bg,
  color: C.textSecondary, fontSize: 13, outline: "none", boxSizing: "border-box"
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
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.bg, borderRadius: 8, padding: 4 }}>
        {views.map(v => (
          <button key={v} onClick={() => setActiveView(v)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 6, border: "none",
            background: activeView === v ? C.border : "transparent",
            color: activeView === v ? C.amber : C.textDim,
            cursor: "pointer", fontSize: 12, fontWeight: activeView === v ? 700 : 400,
            transition: "all 0.15s"
          }}>{viewLabels[v]}</button>
        ))}
      </div>
      {/* ── DASHBOARD ── */}
      {activeView === "dashboard" && (
        <div>
          {/* Oracle ROI Panel — arriba del todo */}
          <OracleROIPanel bets={bets} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ color: C.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Bankroll actual</div>
                <button onClick={() => { setEditingBankroll(!editingBankroll); setEditAmount(initialBankroll); }} style={{
                  background: "transparent", border: `1px solid ${C.border}`, color: C.amber, cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 4
                }}>✏️</button>
              </div>
              {editingBankroll ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <input
                    type="number"
                    value={editAmount}
                    onChange={e => setEditAmount(e.target.value)}
                    style={{ width: "80px", padding: "4px 8px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.bg, color: C.textPrimary, fontSize: 13, outline: "none" }}
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
                    style={{ padding: "4px 8px", borderRadius: 5, background: C.amber, color: "#111111", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                  >{editLoading ? "..." : "✓"}</button>
                  <button onClick={() => setEditingBankroll(false)} style={{
                    padding: "4px 8px", borderRadius: 5, background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, cursor: "pointer", fontSize: 11
                  }}>✕</button>
                </div>
              ) : (
                <div style={{ color: C.amber, fontSize: 20, fontWeight: 700 }}>{formatMoney(currentBankroll)}</div>
              )}
            </div>
            {[
              { label: "P&L total", value: (isPositive ? "+" : "") + formatMoney(profitLoss), color: isPositive ? C.green : C.red },
              { label: "ROI", value: (stats?.general?.roi ?? 0) + "%", color: isPositive ? C.green : C.red },
            ].map(c => (
              <div key={c.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "14px 16px" }}>
                <div style={{ color: C.textDim, fontSize: 11, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 20, fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Win Rate", value: (stats?.general?.winRate ?? 0) + "%", color: C.amber },
              { label: "Ganadas", value: stats?.general?.wins ?? 0, color: C.green },
              { label: "Perdidas", value: stats?.general?.losses ?? 0, color: C.red },
            ].map(c => (
              <div key={c.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "14px 16px" }}>
                <div style={{ color: C.textDim, fontSize: 11, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 20, fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>
          <AddBetForm onAdd={handleAddBet} currentBankroll={currentBankroll} />
          {/* Últimas 5 apuestas */}
          <div style={{ color: C.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Últimas apuestas
          </div>
          {bets.slice(0, 5).map(bet => (
            <BetRow key={bet.id} bet={bet} onUpdate={handleUpdateResult} onDelete={handleDelete} />
          ))}
        </div>
      )}
      {/* ── HISTORIAL ── */}
      {activeView === "history" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {["all", "pending", "won", "lost"].map(f => (
              <button key={f} onClick={() => setFilterResult(f)} style={{
                padding: "5px 12px", borderRadius: 6, border: "1px solid",
                borderColor: filterResult === f ? C.amber : C.border,
                background: filterResult === f ? C.amberDim : "transparent",
                color: filterResult === f ? C.amber : C.textDim,
                cursor: "pointer", fontSize: 12
              }}>{f === "all" ? "Todas" : f === "pending" ? "Pendientes" : f === "won" ? "Ganadas" : "Perdidas"}</button>
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
            ? <div style={{ color: C.textDim, textAlign: "center", padding: 40 }}>Calculando estadísticas...</div>
            : stats ? (
              <div>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
                  <div style={{ color: C.amber, fontWeight: 700, marginBottom: 12, fontSize: 13 }}>Rendimiento por fuente</div>
                  {stats.bySource.length === 0
                    ? <div style={{ color: C.textGhost, fontSize: 13 }}>Sin datos suficientes</div>
                    : stats.bySource.map(s => (
                      <div key={s.source} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                        <div>
                          <span style={{ color: C.textSecondary, fontSize: 13, textTransform: "capitalize" }}>{s.source === "hexa" ? "🤖 Oracle (HEXA)" : "✍️ Manual"}</span>
                          <span style={{ color: C.textDim, fontSize: 11, marginLeft: 8 }}>{s.total} apuestas</span>
                        </div>
                        <div style={{ color: parseFloat(s.win_rate) >= 55 ? C.green : C.amber, fontWeight: 700 }}>
                          {s.win_rate ?? "—"}% WR
                        </div>
                      </div>
                    ))
                  }
                </div>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ color: C.amber, fontWeight: 700, marginBottom: 12, fontSize: 13 }}>Resumen general</div>
                  {[
                    { label: "Total apuestas", value: stats.general.total },
                    { label: "Pendientes", value: stats.general.pending, color: C.amber },
                    { label: "Win Rate (settled)", value: stats.general.winRate + "%", color: stats.general.winRate >= 55 ? C.green : C.amber },
                    { label: "Profit total", value: formatMoney(stats.general.totalProfit), color: stats.general.totalProfit >= 0 ? C.green : C.red },
                    { label: "ROI", value: stats.general.roi + "%", color: stats.general.roi >= 0 ? C.green : C.red },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                      <span style={{ color: C.textMuted, fontSize: 13 }}>{row.label}</span>
                      <span style={{ color: row.color || C.textSecondary, fontWeight: 600, fontSize: 13 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div style={{ color: C.textGhost, textAlign: "center", padding: 40 }}>Sin datos disponibles</div>
          }
        </div>
      )}
      {/* ── GRÁFICA ── */}
      {activeView === "chart" && (
        <div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ color: C.amber, fontWeight: 700, fontSize: 13 }}>Evolución del Bankroll</div>
              <div style={{ color: isPositive ? C.green : C.red, fontWeight: 700, fontSize: 15 }}>
                {isPositive ? "▲" : "▼"} {formatMoney(Math.abs(profitLoss))}
              </div>
            </div>
            <BankrollChart history={stats?.bankrollHistory || []} initial={initialBankroll} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ color: C.textGhost, fontSize: 11 }}>Inicial: {formatMoney(initialBankroll)}</span>
              <span style={{ color: C.textGhost, fontSize: 11 }}>Actual: {formatMoney(currentBankroll)}</span>
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
    : C.surfaceAlt;
  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 8, padding: "12px 14px", marginBottom: 8,
      borderLeft: hasOraclePick ? `3px solid ${borderColor.replace("28", "99")}` : undefined,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.textSecondary, fontSize: 13, fontWeight: 600 }}>{bet.pick}</div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 2 }}>{bet.matchup}</div>
          {/* Oracle pick info — only if linked to a pick */}
          {hasOraclePick && (bet.oracle_pick || bet.pick_result) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {bet.oracle_pick && (
                <span style={{
                  color: C.accent, fontSize: 11, background: C.accentDim,
                  border: `1px solid ${C.accentLine}`, borderRadius: 2, padding: "1px 6px"
                }}>
                  🤖 {bet.oracle_pick}
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
      <div style={{ display: "flex", gap: 16, marginBottom: bet.result === "pending" ? 10 : 6 }}>
        <span style={{ color: C.textMuted, fontSize: 12 }}>Stake: <span style={{ color: C.textSecondary }}>${bet.stake}</span></span>
        <span style={{ color: C.textMuted, fontSize: 12 }}>Odds: <span style={{ color: C.textSecondary }}>{bet.odds > 0 ? "+" : ""}{bet.odds}</span></span>
        <span style={{ color: C.textMuted, fontSize: 12 }}>Win: <span style={{ color: C.green }}>{formatMoney(potentialWin)}</span></span>
        {bet.source === "hexa" && !hasOraclePick && (
          <span style={{ color: C.textGhost, fontSize: 11 }}>🤖 Oracle</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {bet.result === "pending" && (
          <>
            <button onClick={() => handleResult("won")} disabled={updating} style={{
              padding: "4px 12px", borderRadius: 2, border: `1px solid ${C.greenLine}`,
              background: C.greenDim, color: C.green, cursor: "pointer", fontSize: 11, fontWeight: 700
            }}>✓ WON</button>
            <button onClick={() => handleResult("lost")} disabled={updating} style={{
              padding: "4px 12px", borderRadius: 2, border: `1px solid ${C.redLine}`,
              background: C.redDim, color: C.red, cursor: "pointer", fontSize: 11, fontWeight: 700
            }}>✗ LOST</button>
          </>
        )}
        <button onClick={() => onDelete(bet.id)} style={{
          padding: "5px 12px", borderRadius: 2, border: `1px solid ${C.redLine}`,
          background: C.redDim, color: C.red, cursor: "pointer", fontSize: 13, marginLeft: "auto", fontWeight: 700
        }}>🗑</button>
      </div>
    </div>
  );
}
