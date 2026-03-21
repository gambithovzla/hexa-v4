import { useState, useEffect } from "react";
import { useBankroll } from "../hooks/useBankroll";
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
    won:     { label: "WON",     bg: "#00ff8820", color: "#00ff88", border: "#00ff8840" },
    lost:    { label: "LOST",    bg: "#ff444420", color: "#ff4444", border: "#ff444440" },
    pending: { label: "PENDING", bg: "#f5c84220", color: "#f5c842", border: "#f5c84240" },
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
// ── Mini gráfica de evolución ─────────────────────────────────────────
function BankrollChart({ history, initial }) {
  if (!history || history.length === 0) return (
    <div style={{ color: "#666", textAlign: "center", padding: "40px 0", fontSize: 13 }}>
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
  const lineColor = isPositive ? "#00ff88" : "#ff4444";
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
      <h2 style={{ color: "#e8d5a3", marginBottom: 8, fontSize: 20 }}>Configura tu Bankroll</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 28 }}>
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
            border: "1px solid #333", background: "#1a1a1a",
            color: "#fff", fontSize: 15, outline: "none"
          }}
        />
        <button
          onClick={handleSetup}
          disabled={loading || !amount}
          style={{
            padding: "10px 20px", borderRadius: 8,
            background: loading ? "#333" : "#e8d5a3",
            color: "#0a0a0a", fontWeight: 700,
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
      border: "1px dashed #333", background: "transparent",
      color: "#888", cursor: "pointer", fontSize: 13,
      marginBottom: 16, transition: "all 0.2s"
    }}>+ Registrar apuesta manual</button>
  );
  const potentialWin = calcPotentialWin(form.stake, form.odds);
  return (
    <div style={{
      background: "#111", border: "1px solid #2a2a2a",
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
              background: "#e8d5a320", border: "1px solid #e8d5a340",
              color: "#e8d5a3", fontSize: 10, borderRadius: 4,
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
        <div style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
          Ganancia potencial: <span style={{ color: "#00ff88" }}>{formatMoney(potentialWin)}</span>
          {" · "}Riesgo: <span style={{ color: "#ff4444" }}>{formatMoney(form.stake)}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSubmit} disabled={loading} style={{
          flex: 1, padding: "9px", borderRadius: 7,
          background: loading ? "#333" : "#e8d5a3",
          color: "#0a0a0a", fontWeight: 700, border: "none",
          cursor: loading ? "not-allowed" : "pointer", fontSize: 13
        }}>{loading ? "Guardando..." : "Registrar apuesta"}</button>
        <button onClick={() => setOpen(false)} style={{
          padding: "9px 14px", borderRadius: 7, background: "transparent",
          border: "1px solid #333", color: "#666", cursor: "pointer", fontSize: 13
        }}>Cancelar</button>
      </div>
    </div>
  );
}
const inputStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 7,
  border: "1px solid #2a2a2a", background: "#0d0d0d",
  color: "#ccc", fontSize: 13, outline: "none", boxSizing: "border-box"
};
// ── Componente principal ──────────────────────────────────────────────
export default function BankrollTracker({ lang = "es" }) {
  const { bankrollData, loading, refreshBankroll, setupBankroll, addBet, updateBetResult, deleteBet } = useBankroll();
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [filterResult, setFilterResult] = useState("all");
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
  if (loading) return (
    <div style={{ color: "#666", textAlign: "center", padding: 60, fontSize: 13 }}>
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
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0d0d0d", borderRadius: 8, padding: 4 }}>
        {views.map(v => (
          <button key={v} onClick={() => setActiveView(v)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 6, border: "none",
            background: activeView === v ? "#1e1e1e" : "transparent",
            color: activeView === v ? "#e8d5a3" : "#555",
            cursor: "pointer", fontSize: 12, fontWeight: activeView === v ? 700 : 400,
            transition: "all 0.15s"
          }}>{viewLabels[v]}</button>
        ))}
      </div>
      {/* ── DASHBOARD ── */}
      {activeView === "dashboard" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Bankroll actual", value: formatMoney(currentBankroll), color: "#e8d5a3" },
              { label: "P&L total", value: (isPositive ? "+" : "") + formatMoney(profitLoss), color: isPositive ? "#00ff88" : "#ff4444" },
              { label: "ROI", value: (stats?.general?.roi ?? 0) + "%", color: isPositive ? "#00ff88" : "#ff4444" },
            ].map(c => (
              <div key={c.label} style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ color: "#555", fontSize: 11, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 20, fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Win Rate", value: (stats?.general?.winRate ?? 0) + "%", color: "#e8d5a3" },
              { label: "Ganadas", value: stats?.general?.wins ?? 0, color: "#00ff88" },
              { label: "Perdidas", value: stats?.general?.losses ?? 0, color: "#ff4444" },
            ].map(c => (
              <div key={c.label} style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ color: "#555", fontSize: 11, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 20, fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>
          <AddBetForm onAdd={handleAddBet} currentBankroll={currentBankroll} />
          {/* Últimas 5 apuestas */}
          <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
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
                borderColor: filterResult === f ? "#e8d5a3" : "#222",
                background: filterResult === f ? "#e8d5a310" : "transparent",
                color: filterResult === f ? "#e8d5a3" : "#555",
                cursor: "pointer", fontSize: 12
              }}>{f === "all" ? "Todas" : f === "pending" ? "Pendientes" : f === "won" ? "Ganadas" : "Perdidas"}</button>
            ))}
          </div>
          <AddBetForm onAdd={handleAddBet} currentBankroll={currentBankroll} />
          {filteredBets.length === 0
            ? <div style={{ color: "#444", textAlign: "center", padding: 40, fontSize: 13 }}>Sin apuestas en esta categoría</div>
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
            ? <div style={{ color: "#555", textAlign: "center", padding: 40 }}>Calculando estadísticas...</div>
            : stats ? (
              <div>
                <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: 16, marginBottom: 12 }}>
                  <div style={{ color: "#e8d5a3", fontWeight: 700, marginBottom: 12, fontSize: 13 }}>Rendimiento por fuente</div>
                  {stats.bySource.length === 0
                    ? <div style={{ color: "#444", fontSize: 13 }}>Sin datos suficientes</div>
                    : stats.bySource.map(s => (
                      <div key={s.source} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                        <div>
                          <span style={{ color: "#ccc", fontSize: 13, textTransform: "capitalize" }}>{s.source === "hexa" ? "🤖 Oracle (HEXA)" : "✍️ Manual"}</span>
                          <span style={{ color: "#555", fontSize: 11, marginLeft: 8 }}>{s.total} apuestas</span>
                        </div>
                        <div style={{ color: parseFloat(s.win_rate) >= 55 ? "#00ff88" : "#e8d5a3", fontWeight: 700 }}>
                          {s.win_rate ?? "—"}% WR
                        </div>
                      </div>
                    ))
                  }
                </div>
                <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: 16 }}>
                  <div style={{ color: "#e8d5a3", fontWeight: 700, marginBottom: 12, fontSize: 13 }}>Resumen general</div>
                  {[
                    { label: "Total apuestas", value: stats.general.total },
                    { label: "Pendientes", value: stats.general.pending, color: "#f5c842" },
                    { label: "Win Rate (settled)", value: stats.general.winRate + "%", color: stats.general.winRate >= 55 ? "#00ff88" : "#e8d5a3" },
                    { label: "Profit total", value: formatMoney(stats.general.totalProfit), color: stats.general.totalProfit >= 0 ? "#00ff88" : "#ff4444" },
                    { label: "ROI", value: stats.general.roi + "%", color: stats.general.roi >= 0 ? "#00ff88" : "#ff4444" },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #1a1a1a" }}>
                      <span style={{ color: "#666", fontSize: 13 }}>{row.label}</span>
                      <span style={{ color: row.color || "#ccc", fontWeight: 600, fontSize: 13 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div style={{ color: "#444", textAlign: "center", padding: 40 }}>Sin datos disponibles</div>
          }
        </div>
      )}
      {/* ── GRÁFICA ── */}
      {activeView === "chart" && (
        <div>
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ color: "#e8d5a3", fontWeight: 700, fontSize: 13 }}>Evolución del Bankroll</div>
              <div style={{ color: isPositive ? "#00ff88" : "#ff4444", fontWeight: 700, fontSize: 15 }}>
                {isPositive ? "▲" : "▼"} {formatMoney(Math.abs(profitLoss))}
              </div>
            </div>
            <BankrollChart history={stats?.bankrollHistory || []} initial={initialBankroll} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ color: "#444", fontSize: 11 }}>Inicial: {formatMoney(initialBankroll)}</span>
              <span style={{ color: "#444", fontSize: 11 }}>Actual: {formatMoney(currentBankroll)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ── Fila de apuesta ───────────────────────────────────────────────────
function BetRow({ bet, onUpdate, onDelete }) {
  const [updating, setUpdating] = useState(false);
  const handleResult = async (result) => {
    setUpdating(true);
    await onUpdate(bet.id, result);
    setUpdating(false);
  };
  const potentialWin = calcPotentialWin(bet.stake, bet.odds);
  return (
    <div style={{
      background: "#0d0d0d", border: "1px solid #1a1a1a",
      borderRadius: 8, padding: "12px 14px", marginBottom: 8
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ color: "#ccc", fontSize: 13, fontWeight: 600 }}>{bet.pick}</div>
          <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>{bet.matchup}</div>
        </div>
        <ResultBadge result={bet.result} />
      </div>
      <div style={{ display: "flex", gap: 16, marginBottom: bet.result === "pending" ? 10 : 0 }}>
        <span style={{ color: "#666", fontSize: 12 }}>Stake: <span style={{ color: "#ccc" }}>${bet.stake}</span></span>
        <span style={{ color: "#666", fontSize: 12 }}>Odds: <span style={{ color: "#ccc" }}>{bet.odds > 0 ? "+" : ""}{bet.odds}</span></span>
        <span style={{ color: "#666", fontSize: 12 }}>Win: <span style={{ color: "#00ff88" }}>{formatMoney(potentialWin)}</span></span>
        {bet.source === "hexa" && <span style={{ color: "#e8d5a350", fontSize: 11 }}>🤖 Oracle</span>}
      </div>
      {bet.result === "pending" && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => handleResult("won")} disabled={updating} style={{
            padding: "4px 12px", borderRadius: 5, border: "1px solid #00ff8840",
            background: "#00ff8810", color: "#00ff88", cursor: "pointer", fontSize: 11, fontWeight: 700
          }}>✓ WON</button>
          <button onClick={() => handleResult("lost")} disabled={updating} style={{
            padding: "4px 12px", borderRadius: 5, border: "1px solid #ff444440",
            background: "#ff444410", color: "#ff4444", cursor: "pointer", fontSize: 11, fontWeight: 700
          }}>✗ LOST</button>
          <button onClick={() => onDelete(bet.id)} style={{
            padding: "4px 10px", borderRadius: 5, border: "1px solid #222",
            background: "transparent", color: "#444", cursor: "pointer", fontSize: 11, marginLeft: "auto"
          }}>🗑</button>
        </div>
      )}
    </div>
  );
}
