import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  BarChart,
  Line,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */
const COLORS = {
  bg: "#080A0E",
  panel: "#10141B",
  panelAlt: "#0D1117",
  border: "#1C2330",
  borderLit: "#2A3444",
  text: "#E7EAEE",
  textMuted: "#6E7785",
  textDim: "#454D5A",
  gold: "#D9AF6C",
  goldDim: "#7A6238",
  eur: "#5FA3D9",
  eurDim: "#345E7C",
  buy: "#39CE8B",
  buyDim: "#1B4A38",
  sell: "#EF5B5F",
  sellDim: "#552327",
  hold: "#E3B24C",
  holdDim: "#4E3E1C",
};

const FONTS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');
* { box-sizing: border-box; }
body { margin:0; }
.font-display { font-family:'Space Grotesk', sans-serif; }
.font-mono { font-family:'JetBrains Mono', monospace; }
.font-body { font-family:'Inter', sans-serif; }
@keyframes ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.ticker-track { display:flex; width:max-content; animation: ticker-scroll 26s linear infinite; }
@keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
.live-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
@keyframes needle-in { from { opacity:0; transform: scale(0.9); } to { opacity:1; transform: scale(1); } }
.gauge-wrap { animation: needle-in 0.5s ease-out; }
::-webkit-scrollbar { width:8px; height:8px; }
::-webkit-scrollbar-track { background:${COLORS.panel}; }
::-webkit-scrollbar-thumb { background:${COLORS.border}; border-radius:4px; }
`;

/* ------------------------------------------------------------------ */
/*  Indicator math                                                     */
/* ------------------------------------------------------------------ */
function calcSMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    out[i] = sum / period;
  }
  return out;
}

function calcEMASeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function calcRSI(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  const gains = [0], losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
  avgGain /= period; avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function calcMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = calcEMASeries(closes, fast);
  const emaSlow = calcEMASeries(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const firstValid = macdLine.findIndex((v) => v != null);
  const signalLine = new Array(closes.length).fill(null);
  if (firstValid !== -1) {
    const compact = macdLine.slice(firstValid);
    const signalCompact = calcEMASeries(compact, signalPeriod);
    for (let i = 0; i < signalCompact.length; i++) signalLine[firstValid + i] = signalCompact[i];
  }
  const histogram = closes.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

function buildAnalysis(rawSeries) {
  const closes = rawSeries.map((d) => d.price);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);

  const chartData = rawSeries.map((d, i) => ({
    date: d.date,
    price: closes[i],
    sma20: sma20[i],
    sma50: sma50[i],
    rsi: rsi[i],
    macd: macd.macdLine[i],
    signalLine: macd.signalLine[i],
    histogram: macd.histogram[i],
  }));

  const last = closes.length - 1;
  const price = closes[last];

  let trendScore = 0;
  if (sma20[last] != null && sma50[last] != null) {
    if (price > sma20[last] && sma20[last] > sma50[last]) trendScore = 40;
    else if (price < sma20[last] && sma20[last] < sma50[last]) trendScore = -40;
    else if (price > sma20[last]) trendScore = 15;
    else trendScore = -15;
  }

  let rsiScore = 0;
  const rVal = rsi[last];
  if (rVal != null) {
    if (rVal < 30) rsiScore = 30;
    else if (rVal > 70) rsiScore = -30;
    else rsiScore = ((50 - rVal) / 20) * 15;
  }

  let macdScore = 0;
  const hist = macd.histogram[last];
  const prevHist = macd.histogram[last - 1];
  if (hist != null && prevHist != null) {
    if (hist > 0 && hist > prevHist) macdScore = 30;
    else if (hist > 0) macdScore = 14;
    else if (hist < 0 && hist < prevHist) macdScore = -30;
    else if (hist < 0) macdScore = -14;
  }

  const rawScore = trendScore + rsiScore + macdScore;
  const score = Math.max(-100, Math.min(100, rawScore));
  const signal = score >= 25 ? "BUY" : score <= -25 ? "SELL" : "HOLD";

  const prevClose = closes[last - 1];
  const change = prevClose != null ? price - prevClose : 0;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  return {
    chartData,
    score,
    signal,
    trendScore,
    rsiScore,
    macdScore,
    price,
    change,
    changePct,
    rsiVal: rVal,
    macdVal: hist,
    sma20Val: sma20[last],
    sma50Val: sma50[last],
  };
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */
function isoDate(d) { return d.toISOString().slice(0, 10); }

async function fetchGoldSeries() {
  const res = await fetch("https://freegoldapi.com/data/latest.json");
  if (!res.ok) throw new Error("gold history fetch failed");
  const all = await res.json();
  const daily = all.filter((d) => d.date >= "2025-01-01" && d.price > 0);
  const trimmed = daily.slice(-150);
  const liveRes = await fetch("https://api.gold-api.com/price/XAU");
  if (liveRes.ok) {
    const live = await liveRes.json();
    const liveDate = isoDate(new Date(live.updatedAt || Date.now()));
    const lastEntry = trimmed[trimmed.length - 1];
    if (lastEntry && lastEntry.date === liveDate) {
      lastEntry.price = live.price;
    } else {
      trimmed.push({ date: liveDate, price: live.price });
    }
  }
  return trimmed.map((d) => ({ date: d.date, price: Number(d.price) }));
}

async function fetchEurUsdSeries() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 260);
  const url = `https://api.frankfurter.dev/v1/${isoDate(start)}..${isoDate(end)}?base=EUR&symbols=USD`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("eurusd history fetch failed");
  const data = await res.json();
  const entries = Object.entries(data.rates)
    .map(([date, r]) => ({ date, price: Number(r.USD) }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  const liveRes = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD");
  if (liveRes.ok) {
    const live = await liveRes.json();
    const liveDate = live.date;
    const livePrice = live.rates.USD;
    const lastEntry = entries[entries.length - 1];
    if (lastEntry && lastEntry.date === liveDate) {
      lastEntry.price = livePrice;
    } else {
      entries.push({ date: liveDate, price: livePrice });
    }
  }
  return entries.slice(-150);
}

const ASSETS = {
  GOLD: { key: "GOLD", label: "Gold", pair: "XAU / USD", accent: COLORS.gold, accentDim: COLORS.goldDim, decimals: 2, fetcher: fetchGoldSeries },
  EURUSD: { key: "EURUSD", label: "Euro", pair: "EUR / USD", accent: COLORS.eur, accentDim: COLORS.eurDim, decimals: 4, fetcher: fetchEurUsdSeries },
};

function fmtPrice(v, decimals) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/* ------------------------------------------------------------------ */
/*  Small UI atoms                                                     */
/* ------------------------------------------------------------------ */
function SignalPill({ signal }) {
  const map = {
    BUY: { color: COLORS.buy, bg: COLORS.buyDim, Icon: TrendingUp },
    SELL: { color: COLORS.sell, bg: COLORS.sellDim, Icon: TrendingDown },
    HOLD: { color: COLORS.hold, bg: COLORS.holdDim, Icon: Minus },
  };
  const s = map[signal];
  const Icon = s.Icon;
  return (
    <div
      className="font-display"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "8px 18px", borderRadius: 999,
        background: s.bg, color: s.color, border: `1px solid ${s.color}55`,
        fontWeight: 700, fontSize: 15, letterSpacing: "0.06em",
      }}
    >
      <Icon size={16} strokeWidth={2.5} />
      {signal}
    </div>
  );
}

function Gauge({ score, signal }) {
  const angle = (Math.max(-100, Math.min(100, score)) / 100) * 90; // -90..90
  const map = { BUY: COLORS.buy, SELL: COLORS.sell, HOLD: COLORS.hold };
  const needleColor = map[signal];
  const cx = 110, cy = 108, r = 92;
  const arcColors = [
    { from: -90, to: -30, color: COLORS.sell },
    { from: -30, to: 30, color: COLORS.hold },
    { from: 30, to: 90, color: COLORS.buy },
  ];
  const polar = (deg, radius) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const arcPath = (from, to, radius) => {
    const [x1, y1] = polar(from, radius);
    const [x2, y2] = polar(to, radius);
    const large = to - from > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };
  const [nx, ny] = polar(angle, r - 14);

  return (
    <div className="gauge-wrap" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width="220" height="130" viewBox="0 0 220 130">
        {arcColors.map((seg, i) => (
          <path key={i} d={arcPath(seg.from, seg.to, r)} stroke={seg.color} strokeWidth="10" fill="none" strokeLinecap="butt" opacity="0.9" />
        ))}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleColor} strokeWidth="3" strokeLinecap="round" style={{ transition: "all 0.7s cubic-bezier(.4,1.4,.4,1)" }} />
        <circle cx={cx} cy={cy} r="5.5" fill={needleColor} style={{ transition: "fill 0.5s" }} />
        <text x="24" y="126" fill={COLORS.sell} fontSize="10" fontFamily="JetBrains Mono" opacity="0.8">SELL</text>
        <text x="98" y="20" fill={COLORS.hold} fontSize="10" fontFamily="JetBrains Mono" opacity="0.8">HOLD</text>
        <text x="182" y="126" fill={COLORS.buy} fontSize="10" fontFamily="JetBrains Mono" opacity="0.8">BUY</text>
      </svg>
      <div className="font-mono" style={{ marginTop: -6, fontSize: 26, fontWeight: 700, color: needleColor }}>
        {score > 0 ? "+" : ""}{score.toFixed(0)}
      </div>
      <div className="font-mono" style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.12em" }}>COMPOSITE SCORE</div>
    </div>
  );
}

function ScoreBar({ label, value, max = 40 }) {
  const pct = Math.max(-1, Math.min(1, value / max));
  const color = value > 5 ? COLORS.buy : value < -5 ? COLORS.sell : COLORS.hold;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span className="font-body" style={{ fontSize: 12, color: COLORS.textMuted }}>{label}</span>
        <span className="font-mono" style={{ fontSize: 12, color }}>{value > 0 ? "+" : ""}{value.toFixed(0)}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: COLORS.panelAlt, borderRadius: 3, border: `1px solid ${COLORS.border}` }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: COLORS.border }} />
        <div
          style={{
            position: "absolute", top: 0, bottom: 0,
            left: pct >= 0 ? "50%" : `${50 + pct * 50}%`,
            width: `${Math.abs(pct) * 50}%`,
            background: color, borderRadius: 3, transition: "all 0.5s",
          }}
        />
      </div>
    </div>
  );
}

function StatBlock({ label, value, accent }) {
  return (
    <div style={{ padding: "10px 14px", background: COLORS.panelAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8 }}>
      <div className="font-mono" style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 16, fontWeight: 600, color: accent || COLORS.text }}>{value}</div>
    </div>
  );
}

function CustomTooltip({ active, payload, label, decimals }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.borderLit}`, borderRadius: 6, padding: "8px 12px" }}>
      <div className="font-mono" style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} className="font-mono" style={{ fontSize: 12, color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(decimals ?? 2) : p.value}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */
export default function App() {
  const [assetKey, setAssetKey] = useState("GOLD");
  const [store, setStore] = useState({
    GOLD: { loading: true, error: null, analysis: null },
    EURUSD: { loading: true, error: null, analysis: null },
  });
  const [now, setNow] = useState(new Date());
  const pollRef = useRef(null);

  const asset = ASSETS[assetKey];

  const load = useCallback(async (key) => {
    setStore((s) => ({ ...s, [key]: { ...s[key], loading: true, error: null } }));
    try {
      const series = await ASSETS[key].fetcher();
      if (series.length < 30) throw new Error("insufficient data");
      const analysis = buildAnalysis(series);
      setStore((s) => ({ ...s, [key]: { loading: false, error: null, analysis } }));
    } catch (e) {
      setStore((s) => ({ ...s, [key]: { ...s[key], loading: false, error: e.message || "failed to load" } }));
    }
  }, []);

  useEffect(() => {
    load("GOLD");
    load("EURUSD");
    const clock = setInterval(() => setNow(new Date()), 1000);
    pollRef.current = setInterval(() => {
      load("GOLD");
      load("EURUSD");
    }, 60000);
    return () => { clearInterval(clock); clearInterval(pollRef.current); };
  }, [load]);

  const current = store[assetKey];
  const goldA = store.GOLD.analysis;
  const eurA = store.EURUSD.analysis;

  const chartSlice = useMemo(() => {
    if (!current.analysis) return [];
    return current.analysis.chartData.slice(-90);
  }, [current.analysis]);

  return (
    <div className="font-body" style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text }}>
      <style>{FONTS_CSS}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, padding: "18px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.02em" }}>
              SIGNAL&nbsp;DESK
            </div>
            <div className="font-mono" style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
              Technical read on Gold &amp; EUR/USD — SMA · RSI · MACD
            </div>
          </div>
          <div className="font-mono" style={{ fontSize: 12, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="live-dot" style={{ width: 7, height: 7, borderRadius: 999, background: COLORS.buy, display: "inline-block" }} />
            {now.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Ticker tape */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, background: COLORS.panelAlt, overflow: "hidden", padding: "10px 0" }}>
        <div className="ticker-track">
          {[0, 1].map((rep) => (
            <div key={rep} style={{ display: "flex" }}>
              {Object.values(ASSETS).map((a) => {
                const d = store[a.key].analysis;
                const up = d && d.change >= 0;
                return (
                  <div key={a.key + rep} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 28px", borderRight: `1px solid ${COLORS.border}` }}>
                    <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: a.accent }}>{a.pair}</span>
                    <span className="font-mono" style={{ fontSize: 13 }}>{d ? fmtPrice(d.price, a.decimals) : "…"}</span>
                    {d && (
                      <span className="font-mono" style={{ fontSize: 12, color: up ? COLORS.buy : COLORS.sell }}>
                        {up ? "▲" : "▼"} {Math.abs(d.changePct).toFixed(2)}%
                      </span>
                    )}
                    {d && <SignalPillMini signal={d.signal} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Asset tabs */}
      <div style={{ padding: "18px 24px 0", display: "flex", gap: 8 }}>
        {Object.values(ASSETS).map((a) => (
          <button
            key={a.key}
            onClick={() => setAssetKey(a.key)}
            className="font-display"
            style={{
              padding: "9px 18px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${assetKey === a.key ? a.accent : COLORS.border}`,
              background: assetKey === a.key ? `${a.accent}1A` : "transparent",
              color: assetKey === a.key ? a.accent : COLORS.textMuted,
              fontWeight: 600, fontSize: 13, letterSpacing: "0.03em",
              transition: "all 0.2s",
            }}
          >
            {a.label} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {a.pair}</span>
          </button>
        ))}
        <button
          onClick={() => load(assetKey)}
          title="Refresh"
          style={{ marginLeft: "auto", border: `1px solid ${COLORS.border}`, background: "transparent", borderRadius: 8, padding: "0 12px", cursor: "pointer", color: COLORS.textMuted, display: "flex", alignItems: "center" }}
        >
          <RefreshCw size={14} className={current.loading ? "spin" : ""} style={current.loading ? { animation: "spin 1s linear infinite" } : {}} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 24 }}>
        {current.error && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: COLORS.sellDim, border: `1px solid ${COLORS.sell}55`, borderRadius: 8, marginBottom: 16, color: COLORS.sell }}>
            <AlertTriangle size={16} />
            <span className="font-mono" style={{ fontSize: 12 }}>Couldn't load {asset.label} data ({current.error}). Try refresh.</span>
          </div>
        )}

        {current.loading && !current.analysis ? (
          <div className="font-mono" style={{ color: COLORS.textMuted, padding: 40, textAlign: "center" }}>Loading {asset.label} data…</div>
        ) : current.analysis ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 20 }}>
            {/* Left: charts */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <Panel title={`${asset.label} — Price · SMA 20/50`}>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={chartSlice} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: COLORS.textDim }} tickLine={false} axisLine={{ stroke: COLORS.border }} minTickGap={40} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: COLORS.textDim }} tickLine={false} axisLine={false} width={asset.decimals > 2 ? 55 : 65} tickFormatter={(v) => fmtPrice(v, asset.decimals)} />
                    <Tooltip content={<CustomTooltip decimals={asset.decimals} />} />
                    <Line type="monotone" dataKey="price" stroke={asset.accent} strokeWidth={2} dot={false} name="Price" />
                    <Line type="monotone" dataKey="sma20" stroke="#8DD3FF" strokeWidth={1.3} dot={false} name="SMA 20" strokeDasharray="0" opacity={0.8} />
                    <Line type="monotone" dataKey="sma50" stroke="#C58DFF" strokeWidth={1.3} dot={false} name="SMA 50" strokeDasharray="4 3" opacity={0.8} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Panel>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Panel title="RSI (14)">
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={chartSlice} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={false} axisLine={{ stroke: COLORS.border }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: COLORS.textDim }} tickLine={false} axisLine={false} width={26} ticks={[30, 50, 70]} />
                      <ReferenceLine y={70} stroke={COLORS.sell} strokeDasharray="3 3" opacity={0.6} />
                      <ReferenceLine y={30} stroke={COLORS.buy} strokeDasharray="3 3" opacity={0.6} />
                      <Tooltip content={<CustomTooltip decimals={1} />} />
                      <Line type="monotone" dataKey="rsi" stroke="#E3B24C" strokeWidth={1.6} dot={false} name="RSI" />
                    </LineChart>
                  </ResponsiveContainer>
                </Panel>
                <Panel title="MACD (12,26,9)">
                  <ResponsiveContainer width="100%" height={150}>
                    <ComposedChart data={chartSlice} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={false} axisLine={{ stroke: COLORS.border }} />
                      <YAxis tick={{ fontSize: 10, fill: COLORS.textDim }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip content={<CustomTooltip decimals={asset.decimals > 2 ? 5 : 3} />} />
                      <Bar dataKey="histogram" name="Hist">
                        {chartSlice.map((d, i) => (
                          <Cell key={i} fill={d.histogram != null && d.histogram >= 0 ? COLORS.buy : COLORS.sell} opacity={0.55} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="macd" stroke="#8DD3FF" strokeWidth={1.3} dot={false} name="MACD" />
                      <Line type="monotone" dataKey="signalLine" stroke="#EF5B5F" strokeWidth={1.3} dot={false} name="Signal" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Panel>
              </div>
            </div>

            {/* Right: signal panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Panel title="Composite Signal">
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "6px 0 4px" }}>
                  <Gauge score={current.analysis.score} signal={current.analysis.signal} />
                  <SignalPill signal={current.analysis.signal} />
                </div>
                <div style={{ marginTop: 18 }}>
                  <ScoreBar label="Trend (SMA)" value={current.analysis.trendScore} max={40} />
                  <ScoreBar label="Momentum (RSI)" value={current.analysis.rsiScore} max={30} />
                  <ScoreBar label="MACD" value={current.analysis.macdScore} max={30} />
                </div>
              </Panel>

              <Panel title="Key Levels">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <StatBlock label="PRICE" value={fmtPrice(current.analysis.price, asset.decimals)} accent={asset.accent} />
                  <StatBlock label="24H CHANGE" value={`${current.analysis.change >= 0 ? "+" : ""}${current.analysis.changePct.toFixed(2)}%`} accent={current.analysis.change >= 0 ? COLORS.buy : COLORS.sell} />
                  <StatBlock label="RSI 14" value={current.analysis.rsiVal != null ? current.analysis.rsiVal.toFixed(1) : "—"} />
                  <StatBlock label="MACD HIST" value={current.analysis.macdVal != null ? current.analysis.macdVal.toFixed(asset.decimals > 2 ? 5 : 2) : "—"} />
                  <StatBlock label="SMA 20" value={fmtPrice(current.analysis.sma20Val, asset.decimals)} />
                  <StatBlock label="SMA 50" value={fmtPrice(current.analysis.sma50Val, asset.decimals)} />
                </div>
              </Panel>

              <div className="font-mono" style={{ fontSize: 10.5, color: COLORS.textDim, lineHeight: 1.6, padding: "0 4px" }}>
                Signals are generated from historical price data using standard technical indicators.
                This is not financial advice — markets carry risk and past patterns don't guarantee future moves.
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SignalPillMini({ signal }) {
  const map = { BUY: COLORS.buy, SELL: COLORS.sell, HOLD: COLORS.hold };
  return (
    <span className="font-mono" style={{ fontSize: 10, fontWeight: 700, color: map[signal], border: `1px solid ${map[signal]}55`, borderRadius: 4, padding: "2px 6px" }}>
      {signal}
    </span>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
      <div className="font-display" style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.textMuted, letterSpacing: "0.04em", marginBottom: 10, textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
