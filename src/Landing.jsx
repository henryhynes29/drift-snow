// DRIFT — marketing homepage (driftplowing.com front door).
//
// Art direction: "storm night on the Twin Ports". A plow's amber beacon cutting
// through lake-effect snow. Always dark on purpose (it's the brand moment; the
// app itself still follows the phone's light/dark setting).
//   Display: Big Shoulders Display — industrial Great-Lakes grotesque.
//   Body:    Instrument Sans.     Readouts: IBM Plex Mono (dispatch-board feel).
// Signature moment: the headline loads buried in snow and a plow blade clears it.
// Everything here is honest — no invented reviews, counts or ETAs. The forecast
// strip is real (National Weather Service via /api/weather).
import React, { useState, useEffect, useRef, useMemo } from "react";
import "@fontsource/big-shoulders-display/800";
import "@fontsource/big-shoulders-display/900";
import "@fontsource/instrument-sans/400";
import "@fontsource/instrument-sans/500";
import "@fontsource/instrument-sans/600";
import "@fontsource/ibm-plex-mono/500";
import EmojiIcon from "./Icon.jsx";
import mapboxgl from "mapbox-gl";
import { MAP_ENABLED } from "./PropertyMap.jsx"; // sets the Mapbox token (and loads its CSS)
import { fetchSnowForecast } from "./lib/weather.js";

// ---------- tokens (fixed dark: lake-night) ----------
const L = {
  bg: "#06080C",
  bg2: "#0B0F16",
  panel: "#10151E",
  panel2: "#151B26",
  line: "rgba(170,195,230,.13)",
  lineHard: "rgba(170,195,230,.22)",
  ice: "#EEF3F8",
  mist: "#9BA7B7",
  dim: "#5F6C7E",
  amber: "#FFB020",
  amberHot: "#FFD166",
  onAmber: "#1A1204",
  steel: "#7FA7D6",
  good: "#3DDC84",
  snow: "#F7FAFD",
};
const DISPLAY = '"Big Shoulders Display", Impact, "Arial Narrow", sans-serif';
const BODY = '"Instrument Sans", -apple-system, system-ui, "Segoe UI", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

// ---------- building blocks ----------
function Btn({ children, onClick, ghost, big, style }) {
  return (
    <button onClick={onClick} className={ghost ? "lp-btn lp-btn-ghost" : "lp-btn"} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer",
      font: `600 ${big ? 17 : 15}px ${BODY}`, letterSpacing: "-.005em", borderRadius: 999,
      padding: big ? "17px 28px" : "11px 20px", whiteSpace: "nowrap",
      background: ghost ? "transparent" : L.amber, color: ghost ? L.ice : L.onAmber,
      border: ghost ? `1.5px solid ${L.lineHard}` : "1.5px solid transparent",
      WebkitTapHighlightColor: "transparent", ...style,
    }}>{children}</button>
  );
}

const Mono = ({ children, style }) => (
  <span style={{ font: `500 12px/1 ${MONO}`, letterSpacing: ".08em", textTransform: "uppercase", ...style }}>{children}</span>
);

// ---------- falling snow (two depths for parallax) ----------
function Snow({ count = 40, near = false }) {
  const flakes = useMemo(() => Array.from({ length: count }, () => ({
    size: near ? 3 + Math.random() * 4 : 1.5 + Math.random() * 2.5,
    left: Math.random() * 100,
    dur: near ? 7 + Math.random() * 6 : 12 + Math.random() * 12,
    delay: -Math.random() * 20,
    drift: (Math.random() - .5) * (near ? 80 : 40),
    op: near ? .35 + Math.random() * .4 : .15 + Math.random() * .3,
    blur: near ? (Math.random() < .3 ? 1.5 : 0) : 0,
  })), [count, near]);
  return (
    <div aria-hidden className="lp-snow" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {flakes.map((f, i) => (
        <span key={i} style={{
          position: "absolute", top: -12, left: `${f.left}%`, width: f.size, height: f.size, borderRadius: "50%",
          background: L.snow, opacity: f.op, filter: f.blur ? `blur(${f.blur}px)` : undefined,
          "--drift": `${f.drift}px`, animation: `lp-fall ${f.dur}s linear ${f.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ---------- the headline that gets plowed ----------
// "PLOWED." starts dusted in snow. A little plow truck drives across the word;
// everything behind its blade turns clean amber, with snow spraying off the blade.
function PlowTruck() {
  return (
    <svg viewBox="0 0 170 74" width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="lpBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4A6284" /><stop offset="1" stopColor="#24324A" />
        </linearGradient>
        <linearGradient id="lpBladeG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#B8760A" /><stop offset=".55" stopColor="#FFB020" /><stop offset="1" stopColor="#FFD166" />
        </linearGradient>
        <radialGradient id="lpBeam" cx="0" cy=".5" r="1">
          <stop offset="0" stopColor="#FFF4D6" stopOpacity=".55" /><stop offset="1" stopColor="#FFF4D6" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* headlight beam */}
      <path d="M140 34 L200 18 L200 52 Z" fill="url(#lpBeam)" />
      {/* bed + cab + hood */}
      <rect x="8" y="30" width="72" height="22" rx="3" fill="url(#lpBody)" />
      <path d="M80 52 V20 Q80 12 88 12 H110 Q116 12 119 18 L126 30 H138 Q142 30 142 34 V52 Z" fill="url(#lpBody)" />
      <path d="M88 16 H108 Q112 16 114 20 L119 30 H88 Z" fill="#9CC3EA" opacity=".55" />
      <rect x="8" y="30" width="72" height="3" fill="#6F88AA" opacity=".6" />
      {/* beacon */}
      <rect x="95" y="7" width="12" height="5" rx="2" fill="#FFB020" />
      <circle cx="101" cy="7" r="9" fill="#FFB020" opacity=".35" className="lp-strobe" />
      {/* headlight */}
      <rect x="137" y="33" width="5" height="4" rx="1" fill="#FFF4D6" />
      {/* plow frame + blade */}
      <path d="M142 44 H152 M142 50 H150" stroke="#1B2433" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 24 Q168 40 158 66 L150 66 Q155 44 146 28 Z" fill="url(#lpBladeG)" />
      <path d="M150 24 Q168 40 158 66" fill="none" stroke="#FFE3A3" strokeWidth="1.2" opacity=".8" />
      {/* wheels */}
      {[36, 112].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="56" r="11" fill="#0A0D13" stroke="#3A4658" strokeWidth="2" />
          <circle cx={cx} cy="56" r="4" fill="#5D6E86" />
        </g>
      ))}
    </svg>
  );
}

function PlowedHeadline() {
  return (
    <h1 style={{ margin: "26px 0 22px", position: "relative", lineHeight: .86, letterSpacing: "-.01em", textTransform: "uppercase" }}>
      <span style={{ display: "block", font: `800 clamp(46px,7.4vw,92px)/.9 ${DISPLAY}`, color: L.ice }}>Your driveway,</span>
      <span className="lp-word" style={{ position: "relative", display: "inline-block", font: `900 clamp(92px,15vw,196px)/.84 ${DISPLAY}`,
        paddingRight: ".04em", paddingBottom: ".06em" }}>
        {/* snow-covered word (underneath) */}
        <span className="lp-snowword" aria-hidden>Plowed.</span>
        {/* clean amber word, revealed behind the blade */}
        <span className="lp-clean" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, color: L.amber }}>Plowed.</span>
        {/* the truck */}
        <span aria-hidden className="lp-truck" style={{ position: "absolute", bottom: "-.03em", width: ".95em", height: ".42em", zIndex: 2,
          filter: "drop-shadow(0 .03em .05em rgba(0,0,0,.55))" }}>
          <PlowTruck />
          {/* snow thrown off the blade */}
          <span className="lp-spray" style={{ position: "absolute", right: "-.04em", bottom: ".04em", width: ".2em", height: ".3em" }}>
            {[0, 1, 2, 3, 4, 5, 6].map((k) => (
              <i key={k} style={{ position: "absolute", left: 0, bottom: 0, width: k % 2 ? ".035em" : ".05em", height: k % 2 ? ".035em" : ".05em",
                borderRadius: "50%", background: "#F2F7FC", animation: `lp-spray .55s ${k * .08}s ease-out infinite`,
                "--sx": `${.08 + (k % 3) * .06}em`, "--sy": `${-.12 - (k % 4) * .05}em` }} />
            ))}
          </span>
          {/* little berm of snow being pushed */}
          <span style={{ position: "absolute", right: "-.1em", bottom: "-.01em", width: ".16em", height: ".07em", borderRadius: "50% 50% 0 0",
            background: "linear-gradient(#FFFFFF,#CFDCE8)", opacity: .85, filter: "blur(.6px)" }} />
        </span>
      </span>
    </h1>
  );
}

// ---------- live forecast strip (real NWS data, or nothing) ----------
function ForecastStrip() {
  const [f, setF] = useState(null);
  useEffect(() => { fetchSnowForecast().then(setF); }, []);
  if (!f) return null;
  const snowy = f.next24 >= 1;
  return (
    <div className="lp-rise" style={{ animationDelay: "1.5s", display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      marginTop: 30, padding: "11px 16px", borderRadius: 12, background: "rgba(16,21,30,.8)", border: `1px solid ${L.line}`,
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span className="lp-live" style={{ width: 8, height: 8, borderRadius: "50%", background: snowy ? L.amber : L.good }} />
        <Mono style={{ color: L.dim }}>NWS · Duluth</Mono>
      </span>
      <Mono style={{ color: snowy ? L.amberHot : L.ice }}>
        {snowy ? `Next 24 hrs: ${f.range24 || `${f.next24}"`} of snow` : "Next 24 hrs: no snow expected"}
      </Mono>
      <span style={{ font: `400 13px ${BODY}`, color: L.mist }}>{snowy ? "Book early — drivers fill up fast." : "Set up now, before the next one."}</span>
    </div>
  );
}

// ---------- phone demo (three real app screens) ----------
const DEMO = [
  { key: "map", tag: "01 · Map it", title: "Outline your driveway" },
  { key: "price", tag: "02 · Price it", title: "Name your price" },
  { key: "track", tag: "03 · Track it", title: "Watch your plow arrive" },
];
function PhoneDemo() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const t = useRef(null);
  useEffect(() => {
    if (paused) return;
    t.current = setTimeout(() => setI((v) => (v + 1) % DEMO.length), 4200);
    return () => clearTimeout(t.current);
  }, [i, paused]);
  const key = DEMO[i].key;
  return (
    <div style={{ position: "relative", width: 300, maxWidth: "82vw", margin: "0 auto" }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* beacon glow behind the phone */}
      <div aria-hidden className="lp-beacon" style={{ position: "absolute", inset: "-18% -30%", borderRadius: "50%",
        background: `radial-gradient(closest-side, ${L.amber}38, transparent 70%)`, zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, borderRadius: 46, padding: 10, background: "linear-gradient(160deg,#2A313D,#12161E 40%,#0B0E14)",
        border: `1px solid ${L.lineHard}`, boxShadow: "0 40px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08)", transform: "rotate(-2.5deg)" }}>
        <div style={{ borderRadius: 37, overflow: "hidden", background: "#0A0A0B", aspectRatio: "9/18.5", position: "relative" }}>
          <div style={{ position: "absolute", top: 9, left: "50%", transform: "translateX(-50%)", width: 86, height: 22, background: "#000", borderRadius: 12, zIndex: 5 }} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 22px 0", font: `600 10px ${BODY}`, color: L.ice }}>
            <span>9:41</span><span style={{ color: L.mist }}>DRIFT</span>
          </div>
          <div key={i} style={{ padding: "20px 15px 16px", animation: "lp-fadeUp .5s ease" }}>
            <Mono style={{ color: L.amber, fontSize: 10 }}>{DEMO[i].tag}</Mono>
            <div style={{ font: `800 25px/1 ${DISPLAY}`, textTransform: "uppercase", color: L.ice, margin: "8px 0 14px" }}>{DEMO[i].title}</div>
            {key === "map" ? <DemoMap /> : key === "price" ? <DemoPrice /> : <DemoTrack />}
          </div>
          <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", gap: 6, justifyContent: "center" }}>
            {DEMO.map((d, k) => (
              <button key={d.key} onClick={() => setI(k)} aria-label={d.title} style={{ width: k === i ? 22 : 7, height: 7, borderRadius: 6,
                border: "none", cursor: "pointer", padding: 0, background: k === i ? L.amber : "#2A2F38", transition: "all .3s" }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function DemoMap() {
  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: "1.3", border: `1px solid ${L.line}` }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#2b3a2c,#38472f 45%,#28331f)" }} />
        <svg viewBox="0 0 130 100" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <rect x="52" y="24" width="34" height="20" rx="1" fill="#5a4634" />
          <rect x="30" y="46" width="70" height="40" fill="#3a3f34" opacity=".6" />
          <polygon points="40,52 62,52 62,84 40,84" fill={`${L.amber}26`} stroke={L.amber} strokeWidth="2"
            strokeDasharray="200" strokeDashoffset="200" style={{ animation: "lp-draw 2.2s ease forwards" }} />
          {[[40, 52], [62, 52], [62, 84], [40, 84]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3" fill={L.amber} />)}
        </svg>
        <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(10,12,16,.85)", borderRadius: 8, padding: "5px 9px" }}>
          <Mono style={{ color: L.ice, fontSize: 9 }}>620 sq ft</Mono></div>
      </div>
      <div style={{ font: `400 11px/1.45 ${BODY}`, color: L.mist, marginTop: 10 }}>Tap the corners of your drive. No measuring, no phone calls.</div>
    </div>
  );
}
function Row({ l, v, strong }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0" }}>
    <span style={{ font: `${strong ? 600 : 400} ${strong ? 13 : 12}px ${BODY}`, color: strong ? L.ice : L.mist }}>{l}</span>
    <span style={{ font: `${strong ? 800 : 500} ${strong ? 20 : 12}px ${strong ? DISPLAY : MONO}`, color: L.ice }}>{v}</span>
  </div>;
}
function DemoPrice() {
  const tiers = [["Standard", 38], ["Recommended", 44], ["Priority", 51]];
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
        {tiers.map(([l, v], k) => (
          <div key={l} style={{ borderRadius: 9, padding: "7px 6px", background: k === 1 ? `${L.amber}1C` : "#15181E",
            border: `1.5px solid ${k === 1 ? L.amber : "#262A33"}` }}>
            <div style={{ font: `600 8.5px ${BODY}`, color: k === 1 ? L.amber : L.mist }}>{l}</div>
            <div style={{ font: `800 18px ${DISPLAY}`, color: L.ice, marginTop: 1 }}>${v}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#15181E", border: "1px solid #262A33", borderRadius: 12, padding: 12, marginTop: 8 }}>
        <Row l="Your offer" v="$44" /><Row l="Driver call-out" v="$10" /><Row l="DRIFT fee" v="$5" />
        <div style={{ height: 1, background: "#262A33", margin: "7px 0" }} />
        <Row l="Total" v="$59" strong />
      </div>
      <div style={{ marginTop: 8, background: L.amber, color: L.onAmber, borderRadius: 999, padding: "10px 0", textAlign: "center", font: `600 13px ${BODY}` }}>Send offer · $59</div>
    </div>
  );
}
function DemoTrack() {
  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: "1.4", border: "1px solid #262A33", background: "#11151C" }}>
        <svg viewBox="0 0 130 90" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {[18, 40, 62, 84, 106].map((x) => <path key={`v${x}`} d={`M${x} 0 V90`} stroke="#1D232D" strokeWidth="1" />)}
          {[15, 38, 61, 84].map((y) => <path key={`h${y}`} d={`M0 ${y} H130`} stroke="#1D232D" strokeWidth="1" />)}
          <path d="M12 74 Q 50 60 66 40 T 112 20" fill="none" stroke={L.steel} strokeWidth="2.4" strokeDasharray="4 4" opacity=".85" />
          <circle cx="112" cy="20" r="5" fill={L.amber} />
          <g style={{ animation: "lp-truck 4s ease-in-out infinite" }}><g transform="translate(4,64)"><EmojiIcon e="pickup" s={18} color={L.ice} /></g></g>
        </svg>
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 5, background: "rgba(10,12,16,.85)", borderRadius: 8, padding: "5px 9px" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: L.good }} /><Mono style={{ color: L.ice, fontSize: 9 }}>On the way</Mono>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, position: "relative" }}>
        <div style={{ position: "absolute", top: 9, left: 10, right: 10, height: 2, background: "#262A33" }} />
        <div style={{ position: "absolute", top: 9, left: 10, width: "55%", height: 2, background: L.amber }} />
        {["Sent", "Accepted", "En route", "Done"].map((s, k) => (
          <div key={s} style={{ position: "relative", zIndex: 1, textAlign: "center", width: 48 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", margin: "0 auto", background: k <= 2 ? L.amber : "#15181E",
              border: `2px solid ${k <= 2 ? L.amber : "#262A33"}`, color: L.onAmber, display: "grid", placeItems: "center" }}>
              {k <= 2 ? <EmojiIcon e="check" s={9} strokeWidth={2.4} /> : null}</div>
            <div style={{ font: `500 8px ${BODY}`, color: k <= 2 ? L.ice : L.dim, marginTop: 4 }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- scrolling hazard band ----------
function Marquee() {
  const words = ["No contracts", "Pay per storm", "Name your price", "Track it live", "Photo proof", "Local drivers"];
  const run = [...words, ...words];
  return (
    <div aria-hidden style={{ position: "relative", background: L.amber, color: L.onAmber, overflow: "hidden", transform: "rotate(-1.2deg)",
      margin: "0 -2%", boxShadow: `0 0 60px ${L.amber}33`, borderTop: "3px solid #111", borderBottom: "3px solid #111" }}>
      <div className="lp-marquee" style={{ display: "flex", width: "max-content", padding: "14px 0" }}>
        {[0, 1].map((dup) => (
          <div key={dup} style={{ display: "flex", flexShrink: 0 }}>
            {run.map((w, k) => (
              <span key={`${dup}-${k}`} style={{ display: "inline-flex", alignItems: "center", gap: 26, paddingRight: 26,
                font: `900 clamp(22px,3vw,34px)/1 ${DISPLAY}`, textTransform: "uppercase", letterSpacing: ".01em" }}>
                {w}<EmojiIcon e="snowflake" s={20} color={L.onAmber} strokeWidth={2.4} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- section shell ----------
function Section({ id, kicker, title, lead, children, style }) {
  return (
    <section id={id} className="lp-section" style={{ padding: "112px 22px", position: "relative", ...style }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        {kicker && <Mono style={{ color: L.amber }}>{kicker}</Mono>}
        {title && <h2 style={{ font: `900 clamp(44px,6.4vw,80px)/.9 ${DISPLAY}`, textTransform: "uppercase", letterSpacing: "-.005em",
          margin: "14px 0 18px", color: L.ice, maxWidth: 820 }}>{title}</h2>}
        {lead && <p style={{ color: L.mist, maxWidth: 560, margin: "0 0 52px", font: `400 18px/1.55 ${BODY}` }}>{lead}</p>}
        {children}
      </div>
    </section>
  );
}

// ---------- Service area on a real Mapbox map ----------
// Dark basemap, amber town markers, a soft coverage zone. Loads only when the
// section scrolls into view (saves map loads), isn't draggable (no scroll traps
// on phones), and falls back to the drawn map if Mapbox isn't available.
function coverageRing() {
  const c = [-92.265, 46.758], rx = 0.27, ry = 0.095, pts = [];
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    // slightly egg-shaped: fuller toward Duluth/Superior
    const k = 1 + 0.12 * Math.cos(t);
    pts.push([c[0] + rx * k * Math.cos(t), c[1] + ry * Math.sin(t)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] } };
}
function MapboxServiceArea() {
  const wrap = useRef(null);
  const el = useRef(null);
  const [state, setState] = useState(MAP_ENABLED ? "waiting" : "failed"); // waiting | loading | ready | failed
  useEffect(() => {
    if (state !== "waiting" || !wrap.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setState("loading"); io.disconnect(); } },
      { rootMargin: "300px" });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, [state]);
  useEffect(() => {
    if (state !== "loading" || !el.current) return;
    let map;
    const fail = setTimeout(() => setState((s) => (s === "loading" ? "failed" : s)), 12000);
    try {
      map = new mapboxgl.Map({
        container: el.current, style: "mapbox://styles/mapbox/dark-v11",
        bounds: [[-92.52, 46.66], [-91.98, 46.86]], fitBoundsOptions: { padding: 40 },
        interactive: false, attributionControl: false, cooperativeGestures: true,
      });
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
      map.on("error", (e) => { if (!map.loaded()) { clearTimeout(fail); setState("failed"); } else console.warn("[map]", e?.error?.message); });
      map.on("load", () => {
        clearTimeout(fail);
        // tint the basemap toward the landing palette
        try {
          map.setPaintProperty("water", "fill-color", "#0E1E33");
          map.setPaintProperty("land", "background-color", "#0A0E15");
        } catch { /* layer names can differ between style versions */ }
        map.addSource("drift-cover", { type: "geojson", data: coverageRing() });
        map.addLayer({ id: "drift-cover-fill", type: "fill", source: "drift-cover", paint: { "fill-color": L.amber, "fill-opacity": 0.07 } });
        map.addLayer({ id: "drift-cover-line", type: "line", source: "drift-cover",
          paint: { "line-color": L.amber, "line-opacity": 0.55, "line-width": 1.5, "line-dasharray": [2, 3] } });
        TOWNS.forEach(([name, lat, lng, st, hq]) => {
          const m = document.createElement("div");
          m.className = "lp-mk" + (hq ? " lp-mk-hq" : "");
          m.innerHTML = `<span class="lp-mk-dot"></span><span class="lp-mk-lbl">${name}<em>${st}</em></span>`;
          new mapboxgl.Marker({ element: m, anchor: "left", offset: [-9, 0] }).setLngLat([lng, lat]).addTo(map);
        });
        setState("ready");
      });
    } catch { clearTimeout(fail); setState("failed"); }
    return () => { clearTimeout(fail); try { map && map.remove(); } catch { /* already gone */ } };
  }, [state]);

  if (state === "failed") return <ServiceMap />;
  return (
    <div ref={wrap} style={{ position: "relative", borderRadius: 24, overflow: "hidden", border: `1px solid ${L.line}`, background: L.bg2 }}>
      <div ref={el} className="lp-map" style={{ width: "100%", height: "clamp(340px, 42vw, 470px)" }} />
      {/* edge vignette so the map melts into the page */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none",
        boxShadow: `inset 0 0 80px 20px ${L.bg}`, borderRadius: 24 }} />
      {state !== "ready" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <Mono style={{ color: L.dim }}>Loading map…</Mono></div>
      )}
      <div style={{ position: "absolute", left: 18, top: 16, padding: "8px 12px", borderRadius: 10, background: "rgba(10,14,21,.8)",
        border: `1px solid ${L.line}`, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
        <Mono style={{ color: L.amber }}>Service area</Mono>
        <div style={{ font: `400 13px ${BODY}`, color: L.mist, marginTop: 4 }}>6 towns · MN &amp; WI</div>
      </div>
    </div>
  );
}

// ---------- Twin Ports service map (real relative positions) ----------
const TOWNS = [
  ["Duluth", 46.787, -92.100, "MN", true], ["Superior", 46.721, -92.104, "WI"], ["Hermantown", 46.807, -92.238, "MN"],
  ["Proctor", 46.747, -92.225, "MN"], ["Esko", 46.707, -92.363, "MN"], ["Cloquet", 46.722, -92.459, "MN"],
];
function ServiceMap() {
  const W = 640, H = 330;
  const x = (lng) => ((lng + 92.53) / 0.56) * W;
  const y = (lat) => ((46.875 - lat) / 0.21) * H;
  // simplified western tip of Lake Superior (the "head of the lakes")
  const shore = [[-92.115, 46.875], [-92.07, 46.83], [-92.085, 46.80], [-92.098, 46.772], [-92.08, 46.745],
    [-92.04, 46.72], [-92.0, 46.705], [-91.97, 46.70]];
  const lake = `M${shore.map(([a, b]) => `${x(a).toFixed(1)} ${y(b).toFixed(1)}`).join(" L")} L${W} ${y(46.70)} L${W} 0 Z`;
  return (
    <div style={{ position: "relative", borderRadius: 24, overflow: "hidden", border: `1px solid ${L.line}`,
      background: `radial-gradient(120% 90% at 20% 30%, ${L.panel2}, ${L.bg2})` }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
        aria-label="Service area: Duluth, Superior, Hermantown, Proctor, Esko and Cloquet">
        <defs>
          <pattern id="lpGrid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="rgba(170,195,230,.06)" strokeWidth="1" />
          </pattern>
          <linearGradient id="lpLake" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#12243A" /><stop offset="1" stopColor="#0B1728" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#lpGrid)" />
        <path d={lake} fill="url(#lpLake)" stroke={L.steel} strokeOpacity=".5" strokeWidth="1.5" />
        <text className="lp-lake" x={W - 20} y={34} textAnchor="end" fill={L.steel} opacity=".75" style={{ font: `500 11px ${MONO}`, letterSpacing: ".18em" }}>LAKE SUPERIOR</text>
        {/* coverage halo */}
        <ellipse cx={x(-92.25)} cy={y(46.755)} rx={W * 0.36} ry={H * 0.33} fill={L.amber} opacity=".06" />
        <ellipse cx={x(-92.25)} cy={y(46.755)} rx={W * 0.36} ry={H * 0.33} fill="none" stroke={L.amber} strokeOpacity=".35" strokeDasharray="3 7" />
        {TOWNS.map(([n, lat, lng, st, hq]) => (
          <g key={n} transform={`translate(${x(lng)},${y(lat)})`}>
            <g className="lp-town">
              <circle r={hq ? 14 : 10} fill={L.amber} opacity=".16" className={hq ? "lp-ping" : undefined} />
              <circle r={hq ? 5.5 : 4} fill={L.amber} />
              <text x={["Superior", "Hermantown"].includes(n) ? -10 : 10} y={n === "Superior" ? 20 : -10} textAnchor={["Superior", "Hermantown"].includes(n) ? "end" : "start"}
                fill={L.ice} style={{ font: `800 ${hq ? 22 : 17}px ${DISPLAY}`, textTransform: "uppercase" }}>{n}
                <tspan className="lp-st" fill={L.dim} dx="6" style={{ font: `500 10px ${MONO}` }}>{st}</tspan></text>
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------- Aerial Lift Bridge (final band art) ----------
function LiftBridge() {
  const braces = (bx, w, y0, y1, n) => Array.from({ length: n }, (_, k) => {
    const a = y0 + k * ((y1 - y0) / n), b = a + (y1 - y0) / n;
    return <path key={`${bx}-${k}`} d={`M${bx} ${a} L${bx + w} ${b} M${bx + w} ${a} L${bx} ${b}`} />;
  });
  return (
    <svg aria-hidden viewBox="120 96 960 390" preserveAspectRatio="xMidYMax meet"
      style={{ display: "block", width: "100%", maxWidth: 760, height: "auto", margin: "0 auto", pointerEvents: "none" }}>
      <g stroke={L.steel} strokeWidth="2" fill="none" opacity=".42">
        <path d="M120 470 L1080 470" strokeWidth="2.6" />
        <rect x="300" y="120" width="86" height="350" />{braces(300, 86, 130, 460, 7)}
        <rect x="814" y="120" width="86" height="350" />{braces(814, 86, 130, 460, 7)}
        <path d="M300 120 L900 120" strokeWidth="2.6" /><path d="M300 150 L900 150" />{braces(300, 600, 120, 150, 12)}
        <path d="M386 250 L814 250" strokeWidth="3" /><path d="M386 276 L814 276" />{braces(386, 428, 250, 276, 10)}
        {[430, 520, 600, 680, 770].map((bx) => <path key={bx} d={`M${bx} 150 L${bx} 250`} strokeWidth="1.4" />)}
      </g>
      {[[343, 118], [857, 118], [343, 250], [857, 250], [600, 122]].map(([cx, cy], k) => (
        <circle key={k} cx={cx} cy={cy} r="4" fill={L.amber} className="lp-strobe" style={{ animationDelay: `${k * .4}s` }} />
      ))}
    </svg>
  );
}

// ============================================================
export default function Landing({ onStart, onLegal }) {
  const goDrive = () => { if (typeof window !== "undefined") window.location.href = "/drive.html"; };
  const [faqOpen, setFaqOpen] = useState(0);

  // FAQ copy matches the JSON-LD in index.html (rich results) — keep them in sync.
  const FAQ = [
    ["Do I need a contract or subscription?", "No. DRIFT is pay-per-storm — you're only charged when a plow actually clears your driveway. No contracts, no monthly fees, no commitment."],
    ["How much does it cost to plow a driveway in Duluth?", "You name your price. For a typical Duluth driveway we suggest an offer of about $30–$50 based on its size, plus a $10 call-out fee that goes to your driver and a $5 DRIFT booking fee. Offer more for a faster pickup mid-storm. You're only charged when it's done."],
    ["How fast can someone come plow?", "Book whenever you need it. Your offer goes out to local drivers right away, and once one accepts you can watch them head over live. Arrival depends on who's out and how busy the storm is — raising your offer helps during big storms."],
    ["What areas do you serve?", "Duluth, Hermantown, Cloquet, Esko, Proctor, and Superior, Wisconsin — the greater Twin Ports and Northland."],
    ["Who does the plowing?", "Independent local plow operators who use DRIFT to find jobs. They're not DRIFT employees — DRIFT is the app that connects you, handles booking and payment, and gives you live tracking and photos."],
  ];

  const STEPS = [
    ["pin", "Map your driveway", "Outline it on a satellite map once. No measuring, no quotes, no phone tag."],
    ["cash", "Name your price", "When it snows, tap once and offer what the job's worth. We suggest a fair number from your driveway's size."],
    ["pickup", "A local plow rolls out", "A driver nearby accepts and heads over. Watch the truck on the map and message them in the app."],
    ["camera", "Pay when it's done", "Your card is only charged once it's cleared — with before and after photos on your receipt."],
  ];

  return (
    <div style={{ minHeight: "100vh", background: L.bg, color: L.ice, fontFamily: BODY, overflowX: "hidden", WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        html{scroll-behavior:smooth}
        .lp-btn{transition:transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease,background .2s ease}
        .lp-btn:not(.lp-btn-ghost):hover{transform:translateY(-2px);box-shadow:0 12px 34px ${L.amber}55}
        .lp-btn-ghost:hover{background:rgba(255,255,255,.06)!important;transform:translateY(-2px)}
        .lp-btn:active{transform:scale(.97)!important}
        .lp-btn:focus-visible,.lp-link:focus-visible{outline:2px solid ${L.amberHot};outline-offset:3px}
        .lp-link{background:none;border:none;padding:0;cursor:pointer;color:${L.mist};font:500 14px ${BODY};transition:color .15s}
        .lp-link:hover{color:${L.ice}}
        @keyframes lp-fall{to{transform:translate3d(var(--drift),108vh,0)}}
        @keyframes lp-fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @keyframes lp-draw{to{stroke-dashoffset:0}}
        @keyframes lp-truck{0%{transform:translate(0,0)}100%{transform:translate(92px,-52px)}}
        @keyframes lp-rise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
        @keyframes lp-reveal{0%{clip-path:inset(-10% 100% -10% -2%)}78%{clip-path:inset(-10% -2% -10% -2%)}100%{clip-path:inset(-10% -2% -10% -2%)}}
        @keyframes lp-drive{0%{left:-.95em;opacity:1}78%{left:calc(100% - .83em);opacity:1}100%{left:calc(100% + .5em);opacity:0}}
        @keyframes lp-spray{0%{transform:translate(0,0);opacity:.95}100%{transform:translate(var(--sx),var(--sy));opacity:0}}
        @keyframes lp-strobe{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes lp-beacon{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
        @keyframes lp-marquee{to{transform:translateX(-50%)}}
        @keyframes lp-ping{0%{transform:scale(1);opacity:.35}100%{transform:scale(2.8);opacity:0}}
        @keyframes lp-live{0%,100%{box-shadow:0 0 0 0 rgba(255,176,32,.6)}50%{box-shadow:0 0 0 6px rgba(255,176,32,0)}}
        .lp-rise{animation:lp-rise .9s cubic-bezier(.16,1,.3,1) both}
        .lp-snowword{color:transparent;-webkit-background-clip:text;background-clip:text;
          background:radial-gradient(circle at 30% 40%,rgba(255,255,255,.95) .9px,transparent 1.4px) 0 0/7px 7px,
            radial-gradient(circle at 70% 70%,rgba(255,255,255,.7) .7px,transparent 1.2px) 3px 2px/9px 9px,
            linear-gradient(180deg,#F4F8FC 0%,#C9D6E3 100%);-webkit-background-clip:text;background-clip:text;opacity:.9}
        .lp-clean{clip-path:inset(-10% -2% -10% -2%);animation:lp-reveal 2.3s cubic-bezier(.45,.05,.4,1) .5s both}
        .lp-truck{left:calc(100% + .5em);opacity:0;animation:lp-drive 2.3s cubic-bezier(.45,.05,.4,1) .5s both}
        .lp-strobe{animation:lp-strobe 1.1s ease-in-out infinite}
        .lp-beacon{animation:lp-beacon 2.6s ease-in-out infinite}
        .lp-marquee{animation:lp-marquee 38s linear infinite}
        .lp-ping{transform-box:fill-box;transform-origin:center;animation:lp-ping 2.4s ease-out infinite}
        .lp-live{animation:lp-live 2s ease-in-out infinite}
        .lp-mk{display:flex;align-items:center;gap:8px;pointer-events:none}
        .lp-mk-dot{position:relative;width:12px;height:12px;border-radius:50%;background:${L.amber};box-shadow:0 0 0 4px ${L.amber}33,0 0 18px ${L.amber}88}
        .lp-mk-hq .lp-mk-dot{width:16px;height:16px}
        .lp-mk-hq .lp-mk-dot::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid ${L.amber};animation:lp-ping 2.4s ease-out infinite}
        .lp-mk-lbl{font:800 19px/1 ${DISPLAY};text-transform:uppercase;color:${L.ice};text-shadow:0 1px 8px rgba(0,0,0,.9),0 0 2px #000;white-space:nowrap}
        .lp-mk-hq .lp-mk-lbl{font-size:26px}
        .lp-mk-lbl em{font:500 10px ${MONO};font-style:normal;color:${L.mist};margin-left:6px;letter-spacing:.08em}
        .lp-map .mapboxgl-ctrl-attrib{background:rgba(10,14,21,.7)!important}
        .lp-map .mapboxgl-ctrl-attrib a{color:${L.dim}!important}
        @media(max-width:640px){.lp-mk-lbl{font-size:15px}.lp-mk-hq .lp-mk-lbl{font-size:20px}.lp-mk-lbl em{display:none}}
        .lp-step{transition:transform .3s cubic-bezier(.2,.8,.2,1),border-color .3s}
        .lp-step:hover{transform:translateY(-6px);border-color:${L.amber}66!important}
        .lp-svc{transition:transform .3s cubic-bezier(.2,.8,.2,1),background .3s}
        .lp-svc:hover{transform:translateY(-4px);background:${L.panel2}!important}
        @media(prefers-reduced-motion:reduce){
          *{animation:none!important;transition:none!important}
          .lp-truck,.lp-snow{display:none!important}
          .lp-clean{clip-path:none!important}
        }
        @media(max-width:900px){
          .lp-hero{grid-template-columns:1fr!important;padding-top:44px!important;gap:56px!important}
          .lp-driver{grid-template-columns:1fr!important}
          .lp-money{grid-template-columns:1fr!important}
        }
        @media(max-width:640px){
          .lp-section{padding:76px 20px!important}
          .lp-steps{grid-template-columns:1fr!important}
          .lp-svcs{grid-template-columns:1fr 1fr!important}
          .lp-svc-hero{grid-column:1 / -1!important}
          .lp-nav-links{display:none!important}
          .lp-ctas>button{width:100%}
          .lp-svcs{grid-template-columns:1fr!important}
          .lp-svc{min-height:170px!important}
          .lp-step-h{margin-top:44px!important}
          .lp-pill{font-size:10px;letter-spacing:.03em}
          .lp-town{transform:scale(1.8)}
          .lp-st{display:none}
          .lp-lake{font-size:20px!important}
        }
      `}</style>

      {/* ============ NAV ============ */}
      <nav style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(6,8,12,.72)", backdropFilter: "saturate(160%) blur(18px)",
        WebkitBackdropFilter: "saturate(160%) blur(18px)", borderBottom: `1px solid ${L.line}` }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "12px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <a href="#top" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <span style={{ position: "relative", width: 30, height: 30, borderRadius: 8, background: L.amber, color: L.onAmber, display: "grid", placeItems: "center" }}>
              <EmojiIcon e="snowflake" s={17} strokeWidth={2.2} />
            </span>
            <span style={{ font: `900 26px/1 ${DISPLAY}`, letterSpacing: ".06em", color: L.ice }}>DRIFT</span>
          </a>
          <div className="lp-nav-links" style={{ display: "flex", gap: 26 }}>
            <a className="lp-link" href="#how" style={{ textDecoration: "none" }}>How it works</a>
            <a className="lp-link" href="#pricing" style={{ textDecoration: "none" }}>Pricing</a>
            <a className="lp-link" href="#area" style={{ textDecoration: "none" }}>Service area</a>
            <button className="lp-link" onClick={goDrive}>Drive with us</button>
          </div>
          <Btn onClick={onStart} style={{ padding: "10px 18px", fontSize: 14 }}>Get started</Btn>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header id="top" style={{ position: "relative", overflow: "hidden",
        background: `radial-gradient(70% 60% at 85% 20%, ${L.amber}14, transparent 60%), radial-gradient(90% 80% at 0% 100%, #0E1A2B, transparent 70%), ${L.bg}` }}>
        <Snow count={46} />
        <Snow count={16} near />
        {/* ground: fresh snow line */}
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90,
          background: `linear-gradient(180deg, transparent, ${L.bg} 85%)`, zIndex: 1 }} />
        <div className="lp-hero" style={{ position: "relative", zIndex: 2, maxWidth: 1120, margin: "0 auto", padding: "72px 22px 96px",
          display: "grid", gridTemplateColumns: "1.25fr .75fr", gap: 40, alignItems: "center" }}>
          <div>
            <div className="lp-rise" style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "7px 14px", borderRadius: 999,
              border: `1px solid ${L.line}`, background: "rgba(16,21,30,.6)" }}>
              <span className="lp-strobe" style={{ width: 7, height: 7, borderRadius: "50%", background: L.amber }} />
              <Mono style={{ color: L.mist }}><span className="lp-pill">Duluth · Superior · Hermantown · Cloquet</span></Mono>
            </div>
            <PlowedHeadline />
            <p className="lp-rise" style={{ animationDelay: "1.2s", font: `400 clamp(17px,1.8vw,20px)/1.55 ${BODY}`, color: L.mist, maxWidth: 520, margin: "0 0 34px" }}>
              On-demand snow removal from local plow operators. Map your property once, name your price every storm,
              track the truck live — and pay only when it's done. <span style={{ color: L.ice }}>No contracts. Ever.</span>
            </p>
            <div className="lp-rise lp-ctas" style={{ animationDelay: "1.35s", display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Btn big onClick={onStart}>Get my driveway plowed <span aria-hidden>→</span></Btn>
              <Btn big ghost onClick={goDrive}><EmojiIcon e="plowtruck" s={18} color={L.amber} /> I have a plow</Btn>
            </div>
            <ForecastStrip />
          </div>
          <div className="lp-rise" style={{ animationDelay: ".3s" }}><PhoneDemo /></div>
        </div>
      </header>

      {/* ============ MARQUEE ============ */}
      <div style={{ position: "relative", zIndex: 3, padding: "10px 0 0" }}><Marquee /></div>

      {/* ============ HOW IT WORKS ============ */}
      <Section id="how" kicker="How it works" title={<>Flurry to <span style={{ color: L.amber }}>cleared</span> in four taps.</>}
        lead="Set your place up once. After that, every storm is one tap away.">
        <div className="lp-steps" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, position: "relative" }}>
          {STEPS.map(([ic, t, d], k) => (
            <div key={t} className="lp-step" style={{ position: "relative", background: L.panel, border: `1px solid ${L.line}`, borderRadius: 22,
              padding: "26px 22px 28px", overflow: "hidden" }}>
              <div aria-hidden style={{ position: "absolute", right: -6, top: -18, font: `900 128px/1 ${DISPLAY}`, color: "transparent",
                WebkitTextStroke: `1.5px ${k === 0 ? L.amber : L.lineHard}`, opacity: k === 0 ? .55 : 1 }}>{String(k + 1).padStart(2, "0")}</div>
              <div style={{ position: "relative", width: 46, height: 46, borderRadius: 14, background: `${L.amber}16`, border: `1px solid ${L.amber}40`,
                display: "grid", placeItems: "center" }}><EmojiIcon e={ic} s={23} color={L.amber} /></div>
              <h3 className="lp-step-h" style={{ position: "relative", font: `800 28px/1 ${DISPLAY}`, textTransform: "uppercase", margin: "74px 0 10px", color: L.ice }}>{t}</h3>
              <p style={{ position: "relative", margin: 0, color: L.mist, font: `400 15px/1.55 ${BODY}` }}>{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ============ PRICING / WHERE THE MONEY GOES ============ */}
      <Section id="pricing" kicker="Pricing" title={<>You set the price.<br /><span style={{ color: L.amber }}>Your driver keeps most of it.</span></>}
        style={{ background: `linear-gradient(180deg, ${L.bg}, ${L.bg2} 30%, ${L.bg2} 70%, ${L.bg})` }}>
        <div className="lp-money" style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 22, alignItems: "stretch" }}>
          {/* receipt */}
          <div style={{ background: L.snow, color: "#10141B", borderRadius: 22, padding: "30px 28px 26px", position: "relative",
            boxShadow: "0 30px 70px rgba(0,0,0,.45)", transform: "rotate(-1deg)" }}>
            <Mono style={{ color: "#6B7686" }}>Example · 2-car driveway</Mono>
            <div style={{ font: `900 44px/1 ${DISPLAY}`, textTransform: "uppercase", margin: "10px 0 18px" }}>Your receipt</div>
            {[["Your offer", "$38"], ["Driver call-out fee", "$10"], ["DRIFT booking fee", "$5"]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px dashed #C9D2DD",
                font: `500 16px ${BODY}` }}><span>{l}</span><span style={{ font: `500 16px ${MONO}` }}>{v}</span></div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "16px 0 4px" }}>
              <span style={{ font: `600 17px ${BODY}` }}>Total</span><span style={{ font: `900 46px/1 ${DISPLAY}` }}>$53</span>
            </div>
            <div style={{ font: `500 13px/1.5 ${BODY}`, color: "#4B5563", marginTop: 8 }}>
              Charged only after the job is done. No surge fees, no subscriptions, nothing hidden.</div>
            {/* torn edge */}
            <svg aria-hidden viewBox="0 0 200 10" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: -9, width: "100%", height: 10 }}>
              <path d={`M0 0 ${Array.from({ length: 20 }, (_, i) => `L${i * 10 + 5} 9 L${i * 10 + 10} 0`).join(" ")} Z`} fill={L.snow} />
            </svg>
          </div>
          {/* split */}
          <div style={{ background: L.panel, border: `1px solid ${L.line}`, borderRadius: 22, padding: "30px 28px", display: "flex", flexDirection: "column" }}>
            <Mono style={{ color: L.dim }}>Where your $53 goes</Mono>
            <div style={{ display: "flex", height: 64, borderRadius: 14, overflow: "hidden", margin: "18px 0 22px", border: `1px solid ${L.line}` }}>
              <div style={{ flex: 40, background: `linear-gradient(90deg, ${L.amber}, ${L.amberHot})`, display: "flex", alignItems: "center", padding: "0 16px" }}>
                <span style={{ font: `900 30px ${DISPLAY}`, color: L.onAmber }}>$40</span></div>
              <div style={{ flex: 13, background: "#2A3446", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ font: `800 20px ${DISPLAY}`, color: L.mist }}>$13</span></div>
            </div>
            <div style={{ display: "grid", gap: 16, flex: 1 }}>
              <div style={{ display: "flex", gap: 14 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: L.amber, marginTop: 5, flexShrink: 0 }} />
                <div><div style={{ font: `600 16px ${BODY}`, color: L.ice }}>Your driver · $40</div>
                  <div style={{ font: `400 14px/1.5 ${BODY}`, color: L.mist, marginTop: 2 }}>80% of your offer plus the full $10 call-out fee. And every dollar you tip.</div></div>
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: "#4A5A74", marginTop: 5, flexShrink: 0 }} />
                <div><div style={{ font: `600 16px ${BODY}`, color: L.ice }}>DRIFT · $13</div>
                  <div style={{ font: `400 14px/1.5 ${BODY}`, color: L.mist, marginTop: 2 }}>The $5 booking fee plus 20% of the offer. Covers card processing, the app, and support.</div></div>
              </div>
            </div>
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${L.line}`, font: `400 14px/1.5 ${BODY}`, color: L.mist }}>
              Big storm and in a hurry? <span style={{ color: L.ice }}>Offer more</span> — higher offers get picked up first.</div>
          </div>
        </div>
      </Section>

      {/* ============ SERVICES ============ */}
      <Section kicker="Services" title="Built for the whole storm." lead="Plowing comes first — with backup for everything else a Duluth winter throws at you.">
        <div className="lp-svcs" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 14 }}>
          {[
            ["plowtruck", "Driveway plowing", "Cleared edge to edge, exactly how you mapped it.", true],
            ["broom", "Sidewalks", "Walks and steps, before the city's 24-hour deadline."],
            ["car", "Car dig-outs", "Freed from the berm the city plow left behind."],
            ["battery", "Jump-starts", "Dead battery at -20°? Someone nearby can help."],
          ].map(([ic, t, d, hero]) => (
            <div key={t} className={`lp-svc${hero ? " lp-svc-hero" : ""}`} style={{ position: "relative", overflow: "hidden", borderRadius: 22, padding: hero ? "30px 28px" : "26px 22px",
              background: hero ? `linear-gradient(150deg, ${L.amber}22, ${L.panel} 55%)` : L.panel, border: `1px solid ${hero ? L.amber + "55" : L.line}`,
              minHeight: 230, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <EmojiIcon e={ic} s={hero ? 40 : 30} color={hero ? L.amber : L.ice} />
              <div>
                <div style={{ font: `800 ${hero ? 36 : 26}px/1 ${DISPLAY}`, textTransform: "uppercase", color: L.ice }}>{t}</div>
                <div style={{ font: `400 14px/1.5 ${BODY}`, color: L.mist, marginTop: 8 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ============ DRIVERS ============ */}
      <section className="lp-section" style={{ padding: "40px 22px 112px" }}>
        <div className="lp-driver" style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 0,
          borderRadius: 28, overflow: "hidden", border: `1px solid ${L.amber}44`, background: L.panel }}>
          <div style={{ padding: "54px 44px", position: "relative" }}>
            {/* hazard stripe */}
            <div aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8,
              background: `repeating-linear-gradient(-45deg, ${L.amber} 0 10px, #111 10px 20px)` }} />
            <Mono style={{ color: L.amber }}>For drivers</Mono>
            <h2 style={{ font: `900 clamp(44px,6vw,76px)/.88 ${DISPLAY}`, textTransform: "uppercase", margin: "14px 0 18px" }}>
              Got a plow?<br /><span style={{ color: L.amber }}>Get paid for it.</span></h2>
            <p style={{ font: `400 17px/1.55 ${BODY}`, color: L.mist, maxWidth: 440, margin: "0 0 30px" }}>
              Already clearing your own drive? Take jobs from your neighbors when it snows. Go online when you want, pick the offers you like, get paid through Stripe.</p>
            <Btn big onClick={goDrive}>Start driving <span aria-hidden>→</span></Btn>
          </div>
          <div style={{ background: L.bg2, borderLeft: `1px solid ${L.line}`, padding: "44px 36px", display: "grid", gap: 14, alignContent: "center" }}>
            {[["80%", "of every offer you accept"], ["+$10", "call-out fee on every job"], ["100%", "of your tips"], ["$0", "to sign up · you're your own boss"]].map(([big, small]) => (
              <div key={small} style={{ display: "flex", alignItems: "baseline", gap: 16, paddingBottom: 14, borderBottom: `1px solid ${L.line}` }}>
                <span style={{ font: `900 52px/1 ${DISPLAY}`, color: L.amber, minWidth: 118 }}>{big}</span>
                <span style={{ font: `500 16px/1.35 ${BODY}`, color: L.ice }}>{small}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ SERVICE AREA ============ */}
      <Section id="area" kicker="Service area" title="Head of the Lakes." lead="On-demand snow removal across the Twin Ports and the towns around them."
        style={{ paddingTop: 40 }}>
        <MapboxServiceArea />
      </Section>

      {/* ============ FAQ ============ */}
      <Section kicker="FAQ" title="Questions, answered." style={{ paddingTop: 40 }}>
        <div style={{ maxWidth: 820, borderTop: `1px solid ${L.lineHard}` }}>
          {FAQ.map(([q, a], k) => {
            const open = faqOpen === k;
            return (
              <div key={k} style={{ borderBottom: `1px solid ${L.lineHard}` }}>
                <button onClick={() => setFaqOpen(open ? -1 : k)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", gap: 18,
                  background: "none", border: "none", cursor: "pointer", padding: "24px 0", textAlign: "left", color: L.ice }}>
                  <Mono style={{ color: open ? L.amber : L.dim, flexShrink: 0 }}>{String(k + 1).padStart(2, "0")}</Mono>
                  <span style={{ flex: 1, font: `600 clamp(17px,2vw,20px)/1.3 ${BODY}` }}>{q}</span>
                  <span aria-hidden style={{ width: 34, height: 34, borderRadius: "50%", border: `1px solid ${open ? L.amber : L.lineHard}`, flexShrink: 0,
                    display: "grid", placeItems: "center", color: open ? L.amber : L.mist, fontSize: 20, fontWeight: 300,
                    transform: open ? "rotate(45deg)" : "none", transition: "transform .25s, border-color .25s" }}>+</span>
                </button>
                {open && <div style={{ padding: "0 52px 26px 50px", font: `400 16px/1.6 ${BODY}`, color: L.mist, animation: "lp-fadeUp .3s ease" }}>{a}</div>}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ============ FINAL CTA ============ */}
      <section style={{ padding: "20px 22px 96px" }}>
        <div style={{ position: "relative", overflow: "hidden", maxWidth: 1120, margin: "0 auto", borderRadius: 30, minHeight: 460,
          background: `radial-gradient(60% 70% at 50% 0%, ${L.amber}1F, transparent 70%), linear-gradient(180deg, #0B1220, #06080C)`,
          border: `1px solid ${L.line}`, textAlign: "center", padding: "80px 24px 0" }}>
          <Snow count={36} />
          <div style={{ position: "relative", zIndex: 2, maxWidth: 720, margin: "0 auto" }}>
            <Mono style={{ color: L.amber }}>Duluth, MN</Mono>
            <h2 style={{ font: `900 clamp(52px,9vw,112px)/.86 ${DISPLAY}`, textTransform: "uppercase", margin: "14px 0 18px" }}>
              Snow's coming.<br /><span style={{ color: L.amber }}>Beat the rush.</span></h2>
            <p style={{ color: L.mist, font: `400 18px/1.55 ${BODY}`, margin: "0 auto 32px", maxWidth: 480 }}>
              Set up your property in two minutes. It's free until you book your first plow.</p>
            <Btn big onClick={onStart}>Get started <span aria-hidden>→</span></Btn>
          </div>
          <div style={{ position: "relative", zIndex: 1, marginTop: 56 }}><LiftBridge /></div>
          <div aria-hidden style={{ height: 34, background: "#0B1728", borderTop: `1px solid ${L.steel}55`, margin: "0 -24px" }} />
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ borderTop: `1px solid ${L.line}`, padding: "40px 22px 48px" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 28, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ maxWidth: 360 }}>
            <div style={{ font: `900 30px/1 ${DISPLAY}`, letterSpacing: ".06em" }}>DRIFT</div>
            <p style={{ font: `400 13px/1.55 ${BODY}`, color: L.dim, margin: "10px 0 0" }}>
              The app that connects you with independent local plow operators. Duluth, MN ·{" "}
              <a href="mailto:support@driftplowing.com" style={{ color: L.mist }}>support@driftplowing.com</a></p>
          </div>
          <div style={{ display: "flex", gap: "12px 26px", flexWrap: "wrap" }}>
            <button className="lp-link" onClick={onStart}>Get a plow</button>
            <button className="lp-link" onClick={goDrive}>Drive with DRIFT</button>
            {[["customerTerms", "Terms"], ["customerRelease", "Release & Waiver"], ["driverAgreement", "Driver Agreement"]].map(([id, label]) => (
              <button key={id} className="lp-link" onClick={() => onLegal && onLegal(id)}>{label}</button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
