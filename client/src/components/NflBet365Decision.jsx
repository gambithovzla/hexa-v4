import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const reasonsEs = {
  bookmaker_unverified: 'Casa no verificada', selection_invalid: 'Selección inválida',
  line_missing: 'Falta la línea', price_invalid: 'Cuota inválida',
  quote_time_invalid: 'Partido iniciado o fecha inválida', quote_stale: 'Cotización caducada',
  model_unavailable: 'Modelo no disponible', model_line_mismatch: 'El modelo evaluó otra línea',
  model_not_certified: 'Modelo sin validación suficiente', qb_unverified: 'Titulares QB no confirmados',
  data_quality_low: 'Datos incompletos', push_probability_missing: 'Falta estimar la devolución',
  push_probability_invalid: 'Probabilidad de devolución inválida',
  edge_below_minimum: 'Valor esperado insuficiente', bankroll_missing: 'Falta bankroll',
  exposure_invalid: 'No se pudo comprobar exposición', exposure_limit: 'Límite de exposición alcanzado',
  preseason_out_of_distribution: 'Pretemporada fuera del entrenamiento del modelo',
};

const inputStyle = {
  color: '#e8edf4', background: '#121c2a', border: '1px solid #46576e',
  borderRadius: 6, padding: '8px 9px', minWidth: 85,
};
const buttonStyle = {
  color: '#f4f7fa', background: '#1a695f', border: 0, borderRadius: 6,
  padding: '9px 14px', cursor: 'pointer', fontWeight: 700,
};

function NflTicketHistory({ gameId, token, lang, refreshKey }) {
  const spanish = lang === 'es';
  const [bets, setBets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [performanceTruncated, setPerformanceTruncated] = useState(false);
  const [closeInputs, setCloseInputs] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [betsResponse, performanceResponse] = await Promise.all([
        fetch(`${API_URL}/api/nfl/bets`, { headers }),
        fetch(`${API_URL}/api/nfl/performance`, { headers }),
      ]);
      const [betsJson, performanceJson] = await Promise.all([
        betsResponse.json(), performanceResponse.json(),
      ]);
      if (!betsResponse.ok || !betsJson.success) throw new Error(betsJson.error || 'Could not load bets');
      if (!performanceResponse.ok || !performanceJson.success) throw new Error(performanceJson.error || 'Could not load quote history');
      setBets(betsJson.bets.filter(bet => String(bet.game_pk) === String(gameId)));
      setSummary(betsJson.summary);
      setPerformance(performanceJson.summary);
      setPerformanceTruncated(performanceJson.truncated === true);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [gameId, token, refreshKey]);

  async function saveClose(bet) {
    const entry = closeInputs[bet.id] || {};
    const decimalOdds = Number(entry.odds);
    const line = bet.market === 'moneyline' ? null : Number(entry.line);
    if (!entry.odds || !Number.isFinite(decimalOdds) || decimalOdds <= 1
        || (bet.market !== 'moneyline' && (entry.line == null || entry.line === '' || !Number.isFinite(line)))) {
      setError(spanish ? 'Introduce una cuota y línea válidas.' : 'Enter valid odds and line.');
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/nfl/bets/${bet.id}/closing-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decimalOdds, line }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not record closing quote');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!token) return null;
  return <div style={{ marginTop: 18, borderTop: '1px solid #38546c', paddingTop: 12 }}>
    <strong>{spanish ? 'Mis tickets NFL' : 'My NFL tickets'}</strong>{' '}
    <button type="button" onClick={refresh} disabled={loading} style={{ ...buttonStyle, padding: '5px 9px' }}>
      {spanish ? 'Actualizar' : 'Refresh'}
    </button>
    {summary && <p style={{ fontSize: 13, color: '#a7b7c9' }}>
      {spanish ? 'ROI liquidado' : 'Settled ROI'}: {summary.roi == null ? '—' : `${(summary.roi * 100).toFixed(1)}%`}
      {' · '}P/L: {summary.pnl.toFixed(2)}{' · '}{spanish ? 'Pendientes' : 'Pending'}: {summary.pending}
    </p>}
    {performance && <div style={{ fontSize: 13, color: '#a7b7c9', marginBottom: 10 }}>
      <div>{spanish ? 'Cuotas evaluadas' : 'Evaluated quotes'}{performanceTruncated ? (spanish ? ' (últimas 2000)' : ' (latest 2000)') : ''}: {performance.evaluatedQuotes}
        {' · '}{spanish ? 'Con resultado' : 'Graded'}: {performance.gradedQuotes}
        {' · '}{spanish ? 'No apostar' : 'No bet'}: {performance.decisionCounts.NO_BET}
      </div>
      {Object.entries(performance.calibrationByMarket).map(([market, stats]) => <div key={market}>
        {market}: Brier {stats.brier.toFixed(4)} (N={stats.n}; {spanish ? 'modelo certificado' : 'certified model'} N={stats.certifiedN})
      </div>)}
      <small>{spanish
        ? 'Brier diagnóstico: usa la primera cuota por partido y mercado, salvo pushes; modelo certificado N indica evidencia aprobada. El ROI solo incluye tickets colocados.'
        : 'Diagnostic Brier uses the first quote per game and market, excluding pushes; certified model N indicates approved evidence. ROI includes placed tickets only.'}</small>
    </div>}
    {error && <p role="alert" style={{ color: '#ff9a9a' }}>{error}</p>}
    {bets.map(bet => {
      const untilKickoff = (Date.parse(bet.kickoff_at) - Date.now()) / 60_000;
      const canCaptureClose = untilKickoff > 0 && untilKickoff <= 30;
      const entry = closeInputs[bet.id] || {};
      return <div key={bet.id} style={{ marginTop: 10, padding: 10, background: '#121c2a', borderRadius: 6 }}>
        <div>#{bet.id} · {bet.market} {bet.side} {bet.line == null ? '' : bet.line} @ {Number(bet.accepted_decimal).toFixed(2)}
          {' · '}{spanish ? 'Importe' : 'Stake'} {Number(bet.stake).toFixed(2)}
          {' · '}{bet.result || (spanish ? 'pendiente' : 'pending')}
          {bet.result && ` · P/L ${Number(bet.pnl).toFixed(2)}`}</div>
        {bet.closing_decimal != null && <small>
          {spanish ? 'Cierre' : 'Close'}: {bet.closing_line == null ? '' : `${bet.closing_line} @ `}{Number(bet.closing_decimal).toFixed(2)}
          {' · '}CLV: {bet.clv == null ? '—' : `${(bet.clv * 100).toFixed(1)}%`}
        </small>}
        {canCaptureClose && <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'end' }}>
          {bet.market !== 'moneyline' && <label>{spanish ? 'Línea cierre' : 'Closing line'}<br />
            <input style={inputStyle} type="number" step="0.5" value={entry.line ?? ''}
              onChange={e => setCloseInputs(prev => ({ ...prev, [bet.id]: { ...prev[bet.id], line: e.target.value } }))} />
          </label>}
          <label>{spanish ? 'Cuota cierre' : 'Closing odds'}<br />
            <input style={inputStyle} type="number" min="1.01" step="0.01" value={entry.odds ?? ''}
              onChange={e => setCloseInputs(prev => ({ ...prev, [bet.id]: { ...prev[bet.id], odds: e.target.value } }))} />
          </label>
          <button style={buttonStyle} type="button" onClick={() => saveClose(bet)}>
            {spanish ? 'Guardar cierre' : 'Save close'}
          </button>
        </div>}
      </div>;
    })}
  </div>;
}

export default function NflBet365Decision({ gameId, home, away, token, lang = 'es' }) {
  const spanish = lang === 'es';
  const [market, setMarket] = useState('spread');
  const [side, setSide] = useState('home');
  const [line, setLine] = useState('');
  const [decimalOdds, setDecimalOdds] = useState('');
  const [onlineQuotes, setOnlineQuotes] = useState([]);
  const [autoQuote, setAutoQuote] = useState(null);
  const [loadingOdds, setLoadingOdds] = useState(false);
  const [marketReference, setMarketReference] = useState(null);
  const [referenceStatus, setReferenceStatus] = useState('');
  const [loadingReference, setLoadingReference] = useState(false);
  const [bankroll, setBankroll] = useState('');
  const [acceptedOdds, setAcceptedOdds] = useState('');
  const [homeQb, setHomeQb] = useState('');
  const [awayQb, setAwayQb] = useState('');
  const [startersChecked, setStartersChecked] = useState(false);
  const [decision, setDecision] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setAutoQuote(null); setOnlineQuotes([]); setDecision(null); setMarketReference(null); setReferenceStatus(''); }, [gameId]);
  useEffect(() => { setMarketReference(null); setReferenceStatus(''); }, [market, side, line, decimalOdds]);

  async function compareMarket() {
    setLoadingReference(true);
    setError('');
    setMarketReference(null);
    setReferenceStatus('');
    try {
      const params = new URLSearchParams({ gameId: String(gameId), market, side,
        decimalOdds: String(decimalOdds) });
      if (market !== 'moneyline') params.set('line', String(line));
      const response = await fetch(`${API_URL}/api/nfl/market-reference?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Market comparison failed');
      setMarketReference(json.reference ?? null);
      setReferenceStatus(json.status);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingReference(false);
    }
  }

  async function loadOnlineQuotes() {
    setLoadingOdds(true);
    setError('');
    setAutoQuote(null);
    setOnlineQuotes([]);
    try {
      const response = await fetch(`${API_URL}/api/nfl/bet365-odds?gameId=${encodeURIComponent(gameId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not load Bet365 odds');
      setOnlineQuotes(json.quotes ?? []);
      if (!json.quotes?.length) setError(spanish
        ? 'La API no publicó cuotas bet365 verificables para este partido.'
        : 'The API did not provide verifiable Bet365 odds for this game.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingOdds(false);
    }
  }

  function chooseOnlineQuote(index) {
    const selected = onlineQuotes[Number(index)];
    if (!selected) return;
    setAutoQuote(selected);
    setMarket(selected.market);
    setSide(selected.side);
    setLine(selected.line == null ? '' : String(selected.line));
    setDecimalOdds(String(selected.decimalOdds));
    setDecision(null);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDecision(null);
    setTicket(null);
    try {
      const response = await fetch(`${API_URL}/api/nfl/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          gameId, quote: { market, side, line: market === 'moneyline' ? null : Number(line),
            decimalOdds: Number(decimalOdds), source: autoQuote ? 'odds_api_io' : 'manual' },
          bankroll: Number(bankroll),
          qbConfirmation: { home: homeQb, away: awayQb, confirmed: startersChecked },
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Evaluation failed');
      setDecision(json);
      setAcceptedOdds(String(json.quote?.decimalOdds ?? decimalOdds));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function recordTicket() {
    if (!decision?.decisionId || decision.decision.decision !== 'BET') return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/nfl/bets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          decisionId: decision.decisionId,
          acceptedDecimal: Number(acceptedOdds),
          stake: decision.decision.stake,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not record ticket');
      setTicket(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const label = (es, en) => spanish ? es : en;
  const sides = market === 'total'
    ? [['over', label('Más', 'Over')], ['under', label('Menos', 'Under')]]
    : [['home', home || label('Local', 'Home')], ['away', away || label('Visitante', 'Away')]];

  return (
    <section style={{ border: '1px solid #38546c', borderRadius: 10, padding: 16, color: '#e8edf4' }}>
      <h3 style={{ margin: '0 0 7px' }}>bet365 · {label('Evalúa tu cuota NFL', 'Evaluate your NFL price')}</h3>
      <p style={{ margin: '0 0 14px', color: '#a7b7c9', fontSize: 13 }}>
        {label('Introduce la línea y cuota decimal que ves en tu cuenta bet365. Evaluar no coloca una apuesta.',
          'Enter the line and decimal price shown in your Bet365 account. Evaluation does not place a bet.')}
      </p>
      <details style={{ marginBottom: 12, color: '#a7b7c9', fontSize: 12 }}>
        <summary style={{ cursor: 'pointer' }}>
          {label('Proveedor bet365 opcional (requiere otra clave)', 'Optional Bet365 provider (separate key required)')}
        </summary>
      <div style={{ marginTop: 8 }}>
        <button style={{ ...buttonStyle, padding: '6px 10px' }} type="button"
          disabled={loadingOdds || !token} onClick={loadOnlineQuotes}>
          {loadingOdds ? '…' : label('Buscar cuotas bet365 online', 'Find Bet365 odds online')}
        </button>{' '}
        {onlineQuotes.length > 0 && <select style={inputStyle} value={autoQuote ? String(onlineQuotes.indexOf(autoQuote)) : ''}
          onChange={event => chooseOnlineQuote(event.target.value)}>
          <option value="">{label('Selecciona mercado y línea', 'Select market and line')}</option>
          {onlineQuotes.map((item, index) => <option key={`${item.market}-${item.side}-${item.line}-${index}`} value={index}>
            {item.market} {item.side} {item.line == null ? '' : item.line} @ {item.decimalOdds.toFixed(2)}
          </option>)}
        </select>}
        {autoQuote && <small style={{ display: 'block', color: '#a7b7c9', marginTop: 5 }}>
          {label('Cuota indicativa de API; Hexa la consulta de nuevo al evaluar. Confirma el precio aceptado en tu cuenta.',
            'Indicative API price; Hexa fetches it again at evaluation. Confirm the accepted price in your account.')}
        </small>}
      </div>
      </details>
      <form onSubmit={submit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <label>{label('Mercado', 'Market')}<br />
          <select style={inputStyle} value={market} onChange={e => { setMarket(e.target.value); setSide(e.target.value === 'total' ? 'over' : 'home'); setAutoQuote(null); setDecision(null); }}>
            <option value="spread">Spread</option><option value="total">Total</option><option value="moneyline">Moneyline</option>
          </select>
        </label>
        <label>{label('Selección', 'Selection')}<br />
          <select style={inputStyle} value={side} onChange={e => { setSide(e.target.value); setAutoQuote(null); setDecision(null); }}>
            {sides.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        {market !== 'moneyline' && <label>{label('Línea', 'Line')}<br />
          <input style={inputStyle} type="number" step="0.5" required value={line} onChange={e => { setLine(e.target.value); setAutoQuote(null); setDecision(null); }} placeholder={market === 'spread' ? '-3.5' : '45.5'} />
        </label>}
        <label>{label('Cuota decimal', 'Decimal odds')}<br />
          <input style={inputStyle} type="number" min="1.01" step="0.01" required value={decimalOdds} onChange={e => { setDecimalOdds(e.target.value); setAutoQuote(null); setDecision(null); }} placeholder="1.91" />
        </label>
        <label>Bankroll<br />
          <input style={inputStyle} type="number" min="0.01" step="0.01" required value={bankroll} onChange={e => { setBankroll(e.target.value); setDecision(null); }} />
        </label>
        <label>{home || label('Local', 'Home')} QB<br />
          <input style={inputStyle} value={homeQb} onChange={e => { setHomeQb(e.target.value); setDecision(null); }} />
        </label>
        <label>{away || label('Visitante', 'Away')} QB<br />
          <input style={inputStyle} value={awayQb} onChange={e => { setAwayQb(e.target.value); setDecision(null); }} />
        </label>
        <label style={{ alignSelf: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={startersChecked} onChange={e => { setStartersChecked(e.target.checked); setDecision(null); }} />
          {' '}{label('Confirmé los titulares QB para este partido', 'I confirmed both starting QBs for this game')}
        </label>
        <button style={buttonStyle} type="submit" disabled={busy || !token}>{busy ? '…' : label('Evaluar', 'Evaluate')}</button>
      </form>
      <div style={{ marginTop: 13, padding: 12, border: '1px solid #38546c', borderRadius: 8, background: '#101a27' }}>
        <div style={{ fontWeight: 700, marginBottom: 5 }}>
          {label('Comparador de mercado NFL', 'NFL market comparison')}
        </div>
        <p style={{ color: '#a7b7c9', fontSize: 12, margin: '0 0 9px' }}>
          {label('Introduce la cuota exacta que ves en bet365. Comparamos la misma línea y ambos lados con casas independientes de The Odds API; la comparación no aprueba apuestas.',
            'Enter the exact price shown in your Bet365 account. We compare the same line and both sides with independent books from The Odds API; this comparison does not approve bets.')}
        </p>
        <button type="button" style={{ ...buttonStyle, background: '#284866' }}
          disabled={loadingReference || !token || !gameId || !(Number(decimalOdds) > 1)
            || (market !== 'moneyline' && line === '')} onClick={compareMarket}>
          {loadingReference ? '...' : label('Comparar mi cuota', 'Compare my price')}
        </button>
        {referenceStatus === 'insufficient_same_line_books' && <p style={{ color: '#ffce89', fontSize: 12, marginBottom: 0 }}>
          {label('No hay dos casas recientes con ambos lados de esta misma línea. Comparación no disponible.',
            'Fewer than two recent books have both sides of this exact line. Comparison unavailable.')}
        </p>}
        {referenceStatus === 'odds_unavailable' && <p style={{ color: '#ffce89', fontSize: 12, marginBottom: 0 }}>
          {label('La fuente de cuotas de mercado no respondió. Intenta de nuevo más tarde; la evaluación de tu cuota sigue disponible.',
            'The market odds source is unavailable. Try again later; you can still evaluate your price.')}
        </p>}
        {referenceStatus === 'game_unmatched' && <p style={{ color: '#ffce89', fontSize: 12, marginBottom: 0 }}>
          {label('No encontramos un partido y horario coincidentes en la fuente de mercado.',
            'No matching game and kickoff were found in the market feed.')}
        </p>}
        {marketReference && <div aria-live="polite" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 10 }}>
          {[
            [label('Prob. sin margen', 'No-vig probability'), `${(marketReference.probability * 100).toFixed(1)}%`],
            [label('Cuota justa de referencia', 'Reference fair odds'), marketReference.fairDecimal.toFixed(2)],
            [label('Diferencia a tu precio', 'Difference at your price'), `${(marketReference.impliedEdgeAtQuotedPrice * 100).toFixed(1)}%`],
            [label('Casas comparadas', 'Books compared'), marketReference.bookmakerCount],
          ].map(([title, value]) => <div key={title} style={{ padding: 9, borderRadius: 6, background: '#18283a' }}>
            <div style={{ color: '#9db3c8', fontSize: 11 }}>{title}</div>
            <strong style={{ fontSize: 19 }}>{value}</strong>
          </div>)}
          <small style={{ gridColumn: '1 / -1', color: '#9db3c8' }}>
            {marketReference.bookmakers.join(', ')} · {label('Última actualización', 'Latest update')}: {new Date(marketReference.latestSourceAt).toLocaleTimeString()}
            {' · '}{label('Referencia diagnóstica, no pronóstico validado.', 'Diagnostic reference, not a validated forecast.')}
          </small>
        </div>}
      </div>
      {error && <p role="alert" style={{ color: '#ff9a9a' }}>{error}</p>}
      {decision && <div aria-live="polite" style={{ marginTop: 14 }}>
        <strong>{decision.decision.decision === 'BET' ? label('APOSTAR', 'BET')
          : decision.decision.decision === 'WATCH' ? label('ESPERAR', 'WATCH') : label('NO APOSTAR', 'NO BET')}</strong>
        <p style={{ margin: '7px 0' }}>
          {decision.decision.model.certified
            ? label('Probabilidad estimada', 'Estimated probability')
            : label('Probabilidad experimental, no validada para apostar', 'Experimental probability, not validated for betting')}: {decision.decision.model.probability == null ? '—' : `${(decision.decision.model.probability * 100).toFixed(1)}%`}
          {' · '}EV: {decision.decision.expectedValue == null ? '—' : `${(decision.decision.expectedValue * 100).toFixed(1)}%`}
          {' · '}{label('Cuota mínima de equilibrio', 'Break-even price')}: {decision.decision.minimumDecimalOdds ?? '—'}
        </p>
        {decision.marketReference && <p style={{ margin: '7px 0', fontSize: 13, color: '#a7b7c9' }}>
          {label('Referencia de mercado diagnóstica', 'Diagnostic market reference')}: {(decision.marketReference.probability * 100).toFixed(1)}%
          {' · '}{decision.marketReference.bookmakerCount} {label('casas', 'books')}
          {' · '}{label('Diferencia implícita a tu cuota', 'Implied difference at your price')}: {(decision.marketReference.impliedEdgeAtQuotedPrice * 100).toFixed(1)}%
          {' · '}{label('No certifica una apuesta', 'Does not certify a bet')}
        </p>}
        {decision.decision.reasons.length > 0 && <p style={{ color: '#ffce89', margin: '7px 0' }}>
          {decision.decision.reasons.map(r => spanish ? reasonsEs[r] || r : r.replaceAll('_', ' ')).join(' · ')}
        </p>}
        {decision.decision.decision === 'BET' && !ticket && <div style={{ marginTop: 10 }}>
          <label>{label('Cuota realmente aceptada', 'Accepted odds')} {' '}
            <input style={inputStyle} type="number" min="1.01" step="0.01" value={acceptedOdds} onChange={e => setAcceptedOdds(e.target.value)} />
          </label>{' '}
          <button style={buttonStyle} type="button" disabled={busy} onClick={recordTicket}>
            {label(`Registrar ticket · ${decision.decision.stake.toFixed(2)}`, `Record ticket · ${decision.decision.stake.toFixed(2)}`)}
          </button>
        </div>}
        {ticket && <p>{label('Ticket registrado', 'Ticket recorded')} #{ticket.betId}</p>}
      </div>}
      <NflTicketHistory gameId={gameId} token={token} lang={lang} refreshKey={ticket?.betId} />
    </section>
  );
}
