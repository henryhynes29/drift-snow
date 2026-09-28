// DRIFT — marketing homepage. Colors, type and depth come from the shared theme
// (./theme.js), which swaps values in place for light/dark — so every C / E read
// below happens at render time, never in a module-level constant.
import React, { useState, useEffect, useRef, useMemo } from "react";
import EmojiIcon from "./Icon.jsx";
import { C, E, FD, FB } from "./theme.js";

// Fixed dark backdrop for art that only reads on a dark sky (final CTA band).
// Deliberately NOT a theme token: it stays dark in light mode on purpose.
const ART_BG = "#141418";
const ART_TEXT = "#F5F5F7";
const ART_TEXT_DIM = "#A1A1AA";
const ART_LINE = "#2A2A30";

// ---------- little building blocks ----------
const Btn = ({ children, onClick, ghost, big, style }) => (
  <button onClick={onClick} style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer",
    font: `600 ${big ? 17 : 15}px ${FB}`, letterSpacing: "-.01em", borderRadius: 12,
    padding: big ? "15px 26px" : "11px 18px",
    background: ghost ? "transparent" : C.amber,
    color: ghost ? C.ice : C.onAmber,
    border: ghost ? `1px solid ${C.line}` : "1px solid transparent",
    WebkitTapHighlightColor: "transparent",
    whiteSpace: "nowrap", transition: "transform .15s ease, opacity .15s ease", ...style,
  }}
    onMouseDown={e => (e.currentTarget.style.transform = "scale(.97)")}
    onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>
    {children}
  </button>
);

// line-style trust icons (stroke SVG, inherit currentColor)
const Icon = ({ path, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);
const ICONS = {
  noContract: <><path d="M4 4h10l4 4v12H4z" /><path d="M14 4v4h4" /><path d="m8 12 8 6M16 12l-8 6" /></>,
  lock: <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  camera: <><path d="M3 8h4l1.5-2h7L17 8h4v11H3z" /><circle cx="12" cy="13" r="3.2" /></>,
  pin: <><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="9" r="2.4" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
};

// ---------- falling snow (CSS, lightweight) ----------
// Flake positions are memoized so a re-render (theme switch, FAQ toggle) doesn't reshuffle them.
function Snow({ color, count = 34, max = 0.5 }) {
  const flakes = useMemo(() => Array.from({ length: count }, () => ({
    size: 2 + Math.random() * 3.5,
    left: Math.random() * 100,
    dur: 8 + Math.random() * 10,
    delay: -Math.random() * 16,
    op: 0.12 + Math.random() * (max - 0.12),
  })), [count, max]);
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1 }}>
      {flakes.map((f, i) => (
        <span key={i} style={{
          position: "absolute", top: "-20px", left: `${f.left}%`, width: f.size, height: f.size, borderRadius: "50%",
          background: color || C.mistDim, opacity: f.op,
          animation: `snowfall ${f.dur}s linear ${f.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ---------- Duluth Aerial Lift Bridge (hairline line drawing, theme-aware) ----------
function LiftBridge() {
  const braces = (x, w, y0, y1, n) => {
    const step = (y1 - y0) / n, out = [];
    for (let k = 0; k < n; k++) {
      const a = y0 + k * step, b = a + step;
      out.push(<path key={`${x}-${k}`} d={`M${x} ${a} L${x + w} ${b} M${x + w} ${a} L${x} ${b}`} />);
    }
    return out;
  };
  return (
    <div aria-hidden className="hero-bridge" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "78%", zIndex: 1, pointerEvents: "none" }}>
      <svg viewBox="0 0 1200 520" preserveAspectRatio="xMidYMax slice" style={{ width: "100%", height: "100%" }}>
        {/* lake water */}
        <rect x="0" y="470" width="1200" height="60" fill={C.night2} />
        <g stroke={C.mistDim} strokeWidth="2" fill="none" opacity=".26">
          {/* roadway / approaches */}
          <path d="M0 470 L1200 470" strokeWidth="2.6" />
          {/* towers */}
          <rect x="300" y="120" width="86" height="350" />
          {braces(300, 86, 130, 460, 7)}
          <rect x="814" y="120" width="86" height="350" />
          {braces(814, 86, 130, 460, 7)}
          {/* top fixed truss */}
          <path d="M300 120 L900 120" strokeWidth="2.6" />
          <path d="M300 150 L900 150" />
          {braces(300, 600, 120, 150, 20)}
          {/* raised lift span */}
          <path d="M386 250 L814 250" strokeWidth="3" />
          <path d="M386 276 L814 276" />
          {braces(386, 428, 250, 276, 16)}
          {[430, 520, 600, 680, 770].map(x => <path key={x} d={`M${x} 150 L${x} 250`} strokeWidth="1.4" />)}
          <rect x="296" y="104" width="94" height="18" fill={C.mistDim} stroke="none" />
          <rect x="810" y="104" width="94" height="18" fill={C.mistDim} stroke="none" />
        </g>
        {/* structure lights */}
        {[[343, 118], [857, 118], [343, 250], [857, 250], [600, 122]].map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r="3" fill={C.amber} opacity=".7" />
        ))}
      </svg>
    </div>
  );
}

// ---------- interactive phone demo ----------
const DEMO = [
  { key: "map", tag: "Step 1 · Map it", title: "Outline your driveway" },
  { key: "price", tag: "Step 2 · Price", title: "Name your price" },
  { key: "track", tag: "Step 3 · Track", title: "Watch your plow arrive" },
];

function PhoneDemo() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (paused) return;
    timer.current = setTimeout(() => setI(v => (v + 1) % DEMO.length), 4200);
    return () => clearTimeout(timer.current);
  }, [i, paused]);

  const key = DEMO[i].key;

  return (
    <div style={{ position: "relative", width: 300, maxWidth: "84vw", margin: "0 auto" }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* device */}
      <div style={{ position: "relative", borderRadius: 44, padding: 11,
        background: C.slate, border: `1px solid ${C.line}`, boxShadow: E.high }}>
        <div style={{ borderRadius: 34, overflow: "hidden", background: C.night, aspectRatio: "9/18.5", position: "relative",
          border: `1px solid ${C.lineSoft}` }}>
          {/* dynamic island — black on real hardware in both modes */}
          <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 88, height: 22,
            background: "#000", borderRadius: 12, zIndex: 5 }} />
          {/* status bar */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 20px 0", font: `600 10px ${FB}`, color: C.ice }}>
            <span>9:41</span><span style={{ color: C.mist }}><EmojiIcon e="snowflake" s={10} /> 7"</span>
          </div>
          {/* screen content */}
          <div key={i} style={{ padding: "18px 14px 16px", animation: "fadeUp .5s ease" }}>
            <div style={{ font: `600 11px ${FB}`, color: C.amber }}>{DEMO[i].tag}</div>
            <div style={{ font: `700 19px/1.15 ${FD}`, letterSpacing: "-0.02em", color: C.ice, margin: "4px 0 14px" }}>{DEMO[i].title}</div>
            {key === "map" ? <DemoMap /> : key === "price" ? <DemoPrice /> : <DemoTrack />}
          </div>
          {/* progress dots */}
          <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", gap: 6, justifyContent: "center" }}>
            {DEMO.map((d, k) => (
              <button key={d.key} onClick={() => setI(k)} aria-label={d.title} style={{
                width: k === i ? 20 : 7, height: 7, borderRadius: 6, border: "none", cursor: "pointer", padding: 0,
                background: k === i ? C.amber : C.line, transition: "all .3s" }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", font: `500 12px ${FB}`, color: C.mistDim, marginTop: 14 }}>
        {paused ? "Paused" : "Tap the dots to switch screens"}
      </div>
    </div>
  );
}

// mini satellite map with an animated driveway outline
function DemoMap() {
  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: "1.3", border: `1px solid ${C.line}` }}>
        {/* satellite imagery reads the same in either mode */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#2b3a2c,#38472f 45%,#28331f)" }} />
        <svg viewBox="0 0 130 100" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <rect x="52" y="24" width="34" height="20" rx="1" fill="#5a4634" />
          <rect x="30" y="46" width="70" height="40" fill="#3a3f34" opacity=".6" />
          <polygon points="40,52 62,52 62,84 40,84" fill={`${C.amber}22`} stroke={C.amber} strokeWidth="2"
            strokeDasharray="200" strokeDashoffset="200" style={{ animation: "draw 2.2s ease forwards" }} />
          <circle cx="40" cy="52" r="3" fill={C.amber} /><circle cx="62" cy="52" r="3" fill={C.amber} />
          <circle cx="62" cy="84" r="3" fill={C.amber} /><circle cx="40" cy="84" r="3" fill={C.amber} />
        </svg>
        <div style={{ position: "absolute", bottom: 8, left: 8, background: C.glassStrong, borderRadius: 8,
          padding: "5px 9px", font: `600 10px ${FB}`, color: C.ice }}>620 sq ft outlined</div>
      </div>
      <div style={{ font: `400 11px/1.45 ${FB}`, color: C.mist, marginTop: 10 }}>Tap the corners of your drive. No measuring, no phone calls.</div>
    </div>
  );
}

function Row({ l, v, strong }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0" }}>
    <span style={{ font: `${strong ? 600 : 400} ${strong ? 13 : 12}px ${FB}`, color: strong ? C.ice : C.mist }}>{l}</span>
    <span style={{ font: `${strong ? 700 : 500} ${strong ? 16 : 12}px ${strong ? FD : FB}`, color: C.ice }}>{v}</span>
  </div>;
}
function DemoPrice() {
  // Mirrors the app: the customer names the offer; DRIFT only suggests (620 sq ft driveway).
  const tiers = [["Standard", 42], ["Recommended", 48], ["Priority", 57]];
  return (
    <div>
      <div style={{ font: `600 12px ${FB}`, color: C.ice, marginBottom: 7 }}>What will you offer?</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5 }}>
        {tiers.map(([l, v], i) => (
          <div key={l} style={{ borderRadius: 9, padding: "7px 6px", background: i === 1 ? C.amber + "18" : C.slate,
            border: `1.5px solid ${i === 1 ? C.amber : C.line}` }}>
            <div style={{ font: `600 8.5px ${FB}`, color: i === 1 ? C.amber : C.mist }}>{l}</div>
            <div style={{ font: `700 15px ${FD}`, color: C.ice, marginTop: 1 }}>${v}</div>
          </div>
        ))}
      </div>
      <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginTop: 8 }}>
        <Row l="Your offer" v="$48" />
        <Row l="Driver call-out" v="$10" />
        <Row l="DRIFT fee" v="$5" />
        <div style={{ height: 1, background: C.line, margin: "7px 0" }} />
        <Row l="Total" v="$63" strong />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, font: `500 10px ${FB}`, color: C.push }}>
          <EmojiIcon e="check" s={10} /> You set the price · charged when done
        </div>
      </div>
      <div style={{ marginTop: 8, background: C.amber, color: C.onAmber,
        borderRadius: 11, padding: "10px 0", textAlign: "center", font: `600 13px ${FB}` }}>Send offer · $63</div>
    </div>
  );
}
function DemoTrack() {
  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: "1.4", border: `1px solid ${C.line}`, background: C.mapBg }}>
        <svg viewBox="0 0 130 90" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {[18, 40, 62, 84, 106].map(x => <path key={`v${x}`} d={`M${x} 0 V90`} stroke={C.mapGrid} strokeWidth="1" />)}
          {[15, 38, 61, 84].map(y => <path key={`h${y}`} d={`M0 ${y} H130`} stroke={C.mapGrid} strokeWidth="1" />)}
          <path d="M12 74 Q 50 60 66 40 T 112 20" fill="none" stroke={C.plow} strokeWidth="2.4" strokeDasharray="4 4" opacity=".8" />
          <circle cx="112" cy="20" r="5" fill={C.amber} />
          <g style={{ animation: "truck 4s ease-in-out infinite" }}>
            <g transform="translate(4,64)"><EmojiIcon e="pickup" s={18} color={C.ice} /></g>
          </g>
        </svg>
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 5,
          background: C.glassStrong, borderRadius: 8, padding: "5px 9px", font: `600 10px ${FB}`, color: C.ice }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.push }} /> 6 min away
        </div>
      </div>
      {/* stepper */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, position: "relative" }}>
        <div style={{ position: "absolute", top: 9, left: 10, right: 10, height: 2, background: C.line }} />
        <div style={{ position: "absolute", top: 9, left: 10, width: "55%", height: 2, background: C.amber }} />
        {["Sent", "Accepted", "En route", "Done"].map((s, k) => (
          <div key={s} style={{ position: "relative", zIndex: 1, textAlign: "center", width: 48 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", margin: "0 auto",
              background: k <= 2 ? C.amber : C.night2, border: `2px solid ${k <= 2 ? C.amber : C.line}`,
              color: C.onAmber, display: "grid", placeItems: "center" }}>{k <= 2 ? <EmojiIcon e="check" s={9} strokeWidth={2.4} /> : null}</div>
            <div style={{ font: `500 8px ${FB}`, color: k <= 2 ? C.ice : C.mistDim, marginTop: 4 }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- sections ----------
export default function Landing({ onStart, onLegal }) {
  const goDrive = () => { if (typeof window !== "undefined") window.location.href = "/drive.html"; };
  const [faqOpen, setFaqOpen] = useState(0);

  // FAQ copy matches the JSON-LD in index.html (rich results) — keep them in sync.
  const FAQ = [
    ["Do I need a contract or subscription?", "No. DRIFT is pay-per-storm — you're only charged when a plow actually clears your driveway. No contracts, no monthly fees, no commitment."],
    ["How much does it cost to plow a driveway in Duluth?", "You name your price. For a typical Duluth driveway we suggest an offer of about $30–$50 based on its size, plus a $10 call-out fee that goes to your driver and a $5 DRIFT booking fee. Offer more for a faster pickup mid-storm. You're only charged when it's done."],
    ["How fast can someone come plow?", "During a storm you can book on demand and watch your driver head over live, usually within the hour. You can also set an auto-plow trigger so it happens automatically once snow hits a depth you choose."],
    ["What areas do you serve?", "Duluth, Hermantown, Cloquet, Esko, Proctor, and Superior, Wisconsin — the greater Twin Ports and Northland."],
    ["Who does the plowing?", "Independent local plow operators who use DRIFT to find jobs. They're not DRIFT employees — DRIFT is the app that connects you, handles booking and payment, and gives you live tracking and photos."],
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB, overflowX: "hidden",
      WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        html{scroll-behavior:smooth}
        @keyframes snowfall{to{transform:translateY(105vh)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes draw{to{stroke-dashoffset:0}}
        @keyframes truck{0%{transform:translate(0,0)}100%{transform:translate(92px,-52px)}}
        @keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
        .rise{animation:rise .8s cubic-bezier(.22,1,.36,1) both}
        @media(prefers-reduced-motion:reduce){*{animation:none!important}}
      `}</style>

      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 30, background: C.glass, backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "12px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: C.amber, color: C.onAmber, display: "grid", placeItems: "center" }}>
              <EmojiIcon e="snowflake" s={17} strokeWidth={2} />
            </div>
            <div style={{ font: `700 19px ${FD}`, letterSpacing: ".04em", color: C.ice }}>DRIFT</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={goDrive} className="nav-drive" style={{ background: "transparent", border: "none", color: C.mist,
              font: `500 14px ${FB}`, padding: "9px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>Drive with us</button>
            <Btn onClick={onStart} style={{ padding: "9px 16px", fontSize: 14 }}>Get started</Btn>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header style={{ position: "relative", overflow: "hidden" }}>
        <LiftBridge />
        <Snow />
        <div style={{ position: "relative", zIndex: 3, maxWidth: 1080, margin: "0 auto", padding: "72px 22px 64px",
          display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 56, alignItems: "center" }} className="hero-grid">
          <div className="rise">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.slate, border: `1px solid ${C.line}`,
              borderRadius: 999, padding: "6px 13px", font: `500 13px ${FB}`, color: C.mist }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.push }} /> Duluth · Superior · Cloquet · Hermantown
            </div>
            <h1 style={{ font: `700 clamp(42px,6.2vw,68px)/1.04 ${FD}`, letterSpacing: "-0.02em", margin: "22px 0 18px", color: C.ice }}>
              Your driveway,<br /><span style={{ color: C.amber }}>plowed on demand.</span>
            </h1>
            <p style={{ font: `400 clamp(17px,2vw,20px)/1.5 ${FB}`, color: C.mist, maxWidth: 480, margin: "0 0 32px" }}>
              No contracts. Map your property, name your price, and track your plow live. Pay only when it actually snows.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} className="hero-ctas">
              <Btn big onClick={onStart}>Get my driveway plowed →</Btn>
              <Btn big ghost onClick={goDrive}>I have a plow — earn</Btn>
            </div>
            <div className="hero-strip" style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 32, font: `500 14px ${FB}`, color: C.mist }}>
              {[["snowflake", "Pay per storm"], ["pin", "Local drivers"], ["camera", "Photo proof"]].map(([ic, t]) => (
                <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <EmojiIcon e={ic} s={15} color={C.mistDim} /> {t}
                </span>
              ))}
            </div>
          </div>
          <div className="rise" style={{ animationDelay: ".15s" }}><PhoneDemo /></div>
        </div>
      </header>

      {/* TRUST BAR */}
      <section style={{ borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: C.slate }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 22px", display: "flex", gap: "16px 36px", flexWrap: "wrap", justifyContent: "center" }}>
          {[
            [ICONS.noContract, "No contracts"],
            [ICONS.lock, "Secure card payments"],
            [ICONS.camera, "Before & after photos"],
            [ICONS.pin, "Local plow operators"],
          ].map(([p, label], k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ color: C.mistDim, display: "grid", placeItems: "center" }}><Icon path={p} size={20} /></span>
              <span style={{ font: `500 14px ${FB}`, color: C.ice }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <Section title="From flurry to cleared in four taps" lead="Set it up once. Then it's automatic, or one tap away.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          {[
            ["pin", "Map your driveway", "Outline it on a satellite map. No measuring."],
            ["snowflake", "Set your snow trigger", "Auto-book at the depth you choose, or tap on demand."],
            ["pickup", "A local plow rolls out", "A driver accepts, heads over, and you track them live."],
            ["camera", "Pay only when plowed", "Charged only when it's done, with before and after photos."],
          ].map(([ic, t, d], k) => (
            <div key={t} style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, padding: "24px 22px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <EmojiIcon e={ic} s={26} color={C.amber} />
                <span style={{ font: `500 13px ${FB}`, color: C.mistDim }}>{k + 1}</span>
              </div>
              <h3 style={{ font: `600 17px ${FB}`, letterSpacing: "-0.01em", margin: "18px 0 6px", color: C.ice }}>{t}</h3>
              <p style={{ margin: 0, color: C.mist, font: `400 14px/1.5 ${FB}` }}>{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* SERVICES */}
      <Section title="Built for the whole storm" lead="Plowing comes first, with backup for everything else winter drops on you.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16 }}>
          {[
            ["plowtruck", "Driveway plowing", "Cleared to the apron", true],
            ["broom", "Sidewalk clearing", "Sidewalks and walkways"],
            ["car", "Car dig-outs", "Freed from the berm"],
            ["battery", "Roadside jump-start", "Dead battery help"],
          ].map(([ic, t, d, hero]) => (
            <div key={t} style={{ background: C.slate, border: `1px solid ${hero ? C.amber : C.line}`, borderRadius: 16, padding: "22px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <EmojiIcon e={ic} s={24} color={hero ? C.amber : C.ice} />
                {hero && <span style={{ font: `500 12px ${FB}`, color: C.amber }}>Most booked</span>}
              </div>
              <div style={{ font: `600 15px ${FB}`, marginTop: 14, color: C.ice }}>{t}</div>
              <div style={{ font: `400 13px ${FB}`, color: C.mist, marginTop: 4 }}>{d}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* WHY */}
      <Section>
        <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 20, padding: "44px 32px" }} className="why-card">
          <h2 style={{ font: `700 clamp(26px,4vw,34px)/1.1 ${FD}`, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 10px", color: C.ice }}>Why neighbors pick DRIFT</h2>
          <p style={{ textAlign: "center", color: C.mist, margin: "0 auto 36px", maxWidth: 520, font: `400 16px/1.5 ${FB}` }}>Honest, local, and built so you never think about snow again.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: "28px 32px" }}>
            {[
              ["No contracts, ever", "Pay per storm. No snow, no charge, nothing to cancel."],
              ["You set the price", "Offer what the job is worth to you — we suggest a fair number from your driveway's size. No hidden fees."],
              ["Watch your driver", "Live map tracking and in-app messaging, start to finish."],
              ["Proof it's done", "Before and after photos on every job."],
              ["Real local drivers", "People from around Duluth, not a faceless call center."],
              ["Set it and forget it", "Auto-book at your snow depth and wake up to a clear drive."],
            ].map(([t, d]) => (
              <div key={t} style={{ display: "flex", gap: 12 }}>
                <span style={{ color: C.push, flexShrink: 0, marginTop: 1 }}><Icon path={ICONS.check} size={18} /></span>
                <div><div style={{ font: `600 15px ${FB}`, color: C.ice }}>{t}</div>
                  <div style={{ font: `400 14px/1.5 ${FB}`, color: C.mist, marginTop: 3 }}>{d}</div></div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* SERVICE AREA */}
      <Section title="Serving the Twin Ports" lead="On-demand snow removal across Duluth, Superior, and the towns around them.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          {["Duluth, MN", "Hermantown, MN", "Cloquet, MN", "Esko, MN", "Proctor, MN", "Superior, WI"].map(t => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 7, background: C.slate, border: `1px solid ${C.line}`,
              borderRadius: 999, padding: "10px 16px", font: `500 14px ${FB}`, color: C.ice }}>
              <span style={{ color: C.mistDim, display: "grid" }}><Icon path={ICONS.pin} size={16} /></span>{t}
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ (matches JSON-LD in index.html for rich results) — one grouped list, hairline rows */}
      <Section title="Questions, answered" lead="What Duluth homeowners ask us most.">
        <div style={{ maxWidth: 720, margin: "0 auto", background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
          {FAQ.map(([q, a], k) => {
            const open = faqOpen === k;
            return (
              <div key={k} style={{ borderTop: k ? `1px solid ${C.line}` : "none" }}>
                <button onClick={() => setFaqOpen(open ? -1 : k)} aria-expanded={open} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
                  background: "none", border: "none", cursor: "pointer", padding: "18px 22px", textAlign: "left", color: C.ice, font: `600 15px ${FB}` }}>
                  <span>{q}</span>
                  <span aria-hidden style={{ color: C.mistDim, fontSize: 22, fontWeight: 300, lineHeight: 1, transform: open ? "rotate(45deg)" : "none", transition: "transform .2s", flexShrink: 0 }}>+</span>
                </button>
                {open && <div style={{ padding: "0 22px 20px", font: `400 15px/1.55 ${FB}`, color: C.mist, animation: "fadeUp .25s ease" }}>{a}</div>}
              </div>
            );
          })}
        </div>
      </Section>

      {/* FINAL CTA — snow art on its own fixed dark band so it reads the same in light mode */}
      <section style={{ padding: "24px 22px 88px" }}>
        <div style={{ position: "relative", overflow: "hidden", maxWidth: 1080, margin: "0 auto", textAlign: "center",
          background: ART_BG, border: `1px solid ${ART_LINE}`, borderRadius: 24, padding: "72px 24px" }}>
          <Snow color={ART_TEXT} max={0.55} />
          <div style={{ position: "relative", zIndex: 2, maxWidth: 600, margin: "0 auto" }}>
            <h2 style={{ font: `700 clamp(30px,5vw,46px)/1.08 ${FD}`, letterSpacing: "-0.02em", margin: "0 0 14px", color: ART_TEXT }}>Snow's coming. Beat the rush.</h2>
            <p style={{ color: ART_TEXT_DIM, font: `400 17px/1.5 ${FB}`, margin: "0 0 32px" }}>Set up your property in two minutes. Free until you book your first plow.</p>
            <Btn big onClick={onStart}>Get started →</Btn>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: `1px solid ${C.line}`, padding: "32px 22px 40px", textAlign: "center", color: C.mistDim, font: `400 13px ${FB}` }}>
        <div style={{ marginBottom: 12, display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={onStart} style={{ background: "none", border: "none", padding: 0, color: C.mist, cursor: "pointer", font: `500 14px ${FB}` }}>Get a plow</button>
          <button onClick={goDrive} style={{ background: "none", border: "none", padding: 0, color: C.mist, cursor: "pointer", font: `500 14px ${FB}` }}>Drive with DRIFT</button>
        </div>
        <div style={{ marginBottom: 12, display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
          {[["customerTerms", "Terms"], ["customerRelease", "Release & Waiver"], ["driverAgreement", "Driver Agreement"]].map(([id, label]) => (
            <button key={id} onClick={() => onLegal && onLegal(id)} style={{ background: "none", border: "none", padding: 0, color: C.mist, cursor: "pointer", font: `500 14px ${FB}` }}>{label}</button>
          ))}
        </div>
        DRIFT · The app that connects you with independent local plow operators · Duluth, MN
      </footer>

      <style>{`
        @media(max-width:820px){.hero-bridge{display:none}}
        @media(max-width:820px){.hero-grid{grid-template-columns:1fr!important;text-align:center;padding-top:52px!important}.hero-grid p{margin-left:auto;margin-right:auto}.hero-ctas,.hero-strip{justify-content:center}}
        @media(max-width:600px){.lp-section{padding:56px 20px!important}}
        @media(max-width:520px){.why-card{padding:36px 20px!important}}
        @media(max-width:430px){.nav-drive{display:none}}
      `}</style>
    </div>
  );
}

function Section({ title, lead, children }) {
  return (
    <section style={{ padding: "80px 22px" }} className="lp-section">
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {title && <h2 style={{ font: `700 clamp(26px,4vw,36px)/1.1 ${FD}`, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 12px", color: C.ice }}>{title}</h2>}
        {lead && <p style={{ textAlign: "center", color: C.mist, maxWidth: 560, margin: "0 auto 40px", font: `400 17px/1.5 ${FB}` }}>{lead}</p>}
        {children}
      </div>
    </section>
  );
}
