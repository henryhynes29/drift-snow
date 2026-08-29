// DRIFT — marketing homepage. Self-contained (own tokens) so it stays independent
// of the app shell. Rich, image-forward, with an interactive phone demo and FAQ.
import React, { useState, useEffect, useRef } from "react";

const C = {
  night: "#08121F", night2: "#0E1E31", slate: "#152A42", slate2: "#1B334E", line: "#24435F",
  ice: "#F5F9FD", mist: "#BCCEE0", mistDim: "#93A8C0",
  amber: "#FFB020", amberSoft: "#FFC759", push: "#6EEE9B", plow: "#3DCBFF", violet: "#9B8CFF",
};
const FD = "'Oswald','Arial Narrow',sans-serif";
const FB = "'Inter',system-ui,sans-serif";

// ---------- little building blocks ----------
const Btn = ({ children, onClick, ghost, big, style }) => (
  <button onClick={onClick} style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer",
    font: `800 ${big ? 17 : 15}px ${FB}`, letterSpacing: "-.01em", borderRadius: 14,
    padding: big ? "16px 28px" : "12px 20px",
    background: ghost ? "transparent" : `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})`,
    color: ghost ? C.ice : "#231603", border: ghost ? `1px solid ${C.line}` : "none",
    boxShadow: ghost ? "none" : "0 10px 30px rgba(255,176,32,.28)", WebkitTapHighlightColor: "transparent",
    whiteSpace: "nowrap", transition: "transform .15s ease", ...style,
  }}
    onMouseDown={e => (e.currentTarget.style.transform = "scale(.97)")}
    onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>
    {children}
  </button>
);

// line-style trust icons (stroke SVG)
const Icon = ({ path, filled, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);
const ICONS = {
  noContract: <><path d="M4 4h10l4 4v12H4z" /><path d="M14 4v4h4" /><path d="m8 12 8 6M16 12l-8 6" /></>,
  lock: <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  shield: <><path d="M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6z" /><path d="m9 12 2 2 4-4" /></>,
  camera: <><path d="M3 8h4l1.5-2h7L17 8h4v11H3z" /><circle cx="12" cy="13" r="3.2" /></>,
  pin: <><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="9" r="2.4" /></>,
  bolt: <><path d="M13 3 5 13h5l-1 8 8-11h-5z" /></>,
};

// ---------- falling snow (CSS, lightweight) ----------
function Snow() {
  const flakes = Array.from({ length: 34 });
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1 }}>
      {flakes.map((_, i) => {
        const size = 2 + Math.random() * 4;
        const left = Math.random() * 100;
        const dur = 7 + Math.random() * 10;
        const delay = -Math.random() * 16;
        return <span key={i} style={{
          position: "absolute", top: "-20px", left: `${left}%`, width: size, height: size, borderRadius: "50%",
          background: "rgba(230,242,255,.85)", opacity: 0.15 + Math.random() * 0.5,
          animation: `snowfall ${dur}s linear ${delay}s infinite`,
          filter: "blur(.3px)",
        }} />;
      })}
    </div>
  );
}

// ---------- Duluth Aerial Lift Bridge (illustrated silhouette) ----------
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
    <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "78%", zIndex: 1, pointerEvents: "none", opacity: .9 }}>
      <svg viewBox="0 0 1200 520" preserveAspectRatio="xMidYMax slice" style={{ width: "100%", height: "100%" }}>
        {/* lake water */}
        <rect x="0" y="470" width="1200" height="60" fill="#0a1726" />
        {/* silhouette group */}
        <g stroke="#2c4a68" strokeWidth="2.4" fill="none" opacity=".85">
          {/* roadway / approaches */}
          <path d="M0 470 L1200 470" strokeWidth="3" stroke="#33557a" />
          {/* left tower */}
          <rect x="300" y="120" width="86" height="350" stroke="#33557a" />
          {braces(300, 86, 130, 460, 7)}
          {/* right tower */}
          <rect x="814" y="120" width="86" height="350" stroke="#33557a" />
          {braces(814, 86, 130, 460, 7)}
          {/* top fixed truss across the towers */}
          <path d="M300 120 L900 120" strokeWidth="3" stroke="#33557a" />
          <path d="M300 150 L900 150" />
          {braces(300, 600, 120, 150, 20)}
          {/* raised lift span (deck held up between towers) */}
          <path d="M386 250 L814 250" strokeWidth="4" stroke="#3a5f86" />
          <path d="M386 276 L814 276" />
          {braces(386, 428, 250, 276, 16)}
          {/* suspension verticals from top truss to lift span */}
          {[430, 520, 600, 680, 770].map(x => <path key={x} d={`M${x} 150 L${x} 250`} strokeWidth="1.6" />)}
          {/* tower tops / sheaves */}
          <rect x="296" y="104" width="94" height="18" fill="#33557a" stroke="none" opacity=".6" />
          <rect x="810" y="104" width="94" height="18" fill="#33557a" stroke="none" opacity=".6" />
        </g>
        {/* warm amber nav / structure lights */}
        {[[343, 118], [857, 118], [343, 250], [857, 250], [600, 122]].map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r="3.4" fill="#FFB020" opacity=".9" />
        ))}
      </svg>
    </div>
  );
}

// ---------- interactive phone demo ----------
const DEMO = [
  { key: "map", tag: "1 · Map it", title: "Outline your driveway" },
  { key: "price", tag: "2 · Price", title: "See an honest price" },
  { key: "track", tag: "3 · Track", title: "Watch your plow arrive" },
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

  const Screen = () => {
    if (DEMO[i].key === "map") return <DemoMap />;
    if (DEMO[i].key === "price") return <DemoPrice />;
    return <DemoTrack />;
  };

  return (
    <div style={{ position: "relative", width: 300, maxWidth: "84vw", margin: "0 auto" }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* glow */}
      <div aria-hidden style={{ position: "absolute", inset: -30, borderRadius: 60,
        background: `radial-gradient(circle at 50% 40%, ${C.amber}33, transparent 60%)`, filter: "blur(24px)", zIndex: 0 }} />
      {/* device */}
      <div style={{ position: "relative", zIndex: 1, borderRadius: 44, padding: 12,
        background: "linear-gradient(160deg,#1c2c40,#0a1522)", border: `1px solid ${C.line}`,
        boxShadow: "0 40px 90px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06)" }}>
        <div style={{ borderRadius: 34, overflow: "hidden", background: C.night, aspectRatio: "9/18.5", position: "relative" }}>
          {/* notch */}
          <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 90, height: 20,
            background: "#060d16", borderRadius: 12, zIndex: 5 }} />
          {/* status bar */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 18px 0", font: `700 10px ${FB}`, color: C.mist }}>
            <span>9:41</span><span>❄ 7"</span>
          </div>
          {/* screen content */}
          <div key={i} style={{ padding: "14px 14px 16px", animation: "fadeUp .5s ease" }}>
            <div style={{ font: `700 10px ${FB}`, letterSpacing: ".14em", textTransform: "uppercase", color: C.amber }}>{DEMO[i].tag}</div>
            <div style={{ font: `700 19px/1.05 ${FD}`, color: C.ice, margin: "4px 0 12px" }}>{DEMO[i].title}</div>
            <Screen />
          </div>
          {/* progress dots */}
          <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", gap: 6, justifyContent: "center" }}>
            {DEMO.map((d, k) => (
              <button key={d.key} onClick={() => setI(k)} aria-label={d.title} style={{
                width: k === i ? 20 : 7, height: 7, borderRadius: 6, border: "none", cursor: "pointer",
                background: k === i ? C.amber : C.line, transition: "all .3s" }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", font: `500 11px ${FB}`, color: C.mistDim, marginTop: 12 }}>
        {paused ? "▍▍ paused — hover off to play" : "▶ live demo · tap the dots"}
      </div>
    </div>
  );
}

// mini satellite map with an animated driveway outline
function DemoMap() {
  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: "1.3", border: `1px solid ${C.line}` }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#2b3a2c,#38472f 45%,#28331f)" }} />
        {/* house + roof */}
        <svg viewBox="0 0 130 100" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <rect x="52" y="24" width="34" height="20" rx="1" fill="#5a4634" />
          <rect x="30" y="46" width="70" height="40" fill="#3a3f34" opacity=".6" />
          {/* driveway outline being "drawn" */}
          <polygon points="40,52 62,52 62,84 40,84" fill={`${C.amber}22`} stroke={C.amber} strokeWidth="2"
            strokeDasharray="200" strokeDashoffset="200" style={{ animation: "draw 2.2s ease forwards" }} />
          <circle cx="40" cy="52" r="3" fill={C.amber} /><circle cx="62" cy="52" r="3" fill={C.amber} />
          <circle cx="62" cy="84" r="3" fill={C.amber} /><circle cx="40" cy="84" r="3" fill={C.amber} />
        </svg>
        <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(8,18,31,.82)", borderRadius: 8,
          padding: "5px 9px", font: `700 10px ${FB}`, color: C.ice }}>📐 620 sq ft outlined</div>
      </div>
      <div style={{ font: `500 11px ${FB}`, color: C.mist, marginTop: 10 }}>Tap the corners of your drive — no measuring, no phone calls.</div>
    </div>
  );
}

function Row({ l, v, strong }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0" }}>
    <span style={{ font: `${strong ? 700 : 500} ${strong ? 13 : 12}px ${FB}`, color: strong ? C.ice : C.mist }}>{l}</span>
    <span style={{ font: `700 ${strong ? 16 : 12}px ${strong ? FD : FB}`, color: strong ? C.amber : C.ice }}>{v}</span>
  </div>;
}
function DemoPrice() {
  return (
    <div>
      <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13 }}>
        <div style={{ font: `800 30px ${FD}`, color: C.amber, lineHeight: 1 }}>$55</div>
        <div style={{ font: `500 10px ${FB}`, color: C.mist, margin: "3px 0 10px" }}>per plow · 620 sq ft</div>
        <div style={{ height: 1, background: C.line, margin: "0 0 8px" }} />
        <Row l="Driveway base" v="$33" />
        <Row l="620 sq ft × $0.035" v="$22" />
        <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
        <Row l="You pay" v="$55" strong />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, font: `600 10px ${FB}`, color: C.push }}>
          <span>✓</span> No contracts · no hidden fees
        </div>
      </div>
      <div style={{ marginTop: 10, background: `linear-gradient(180deg,${C.amberSoft},${C.amber})`, color: "#231603",
        borderRadius: 11, padding: "11px 0", textAlign: "center", font: `800 13px ${FB}` }}>Clear now · $55</div>
    </div>
  );
}
function DemoTrack() {
  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", aspectRatio: "1.4", border: `1px solid ${C.line}`, background: "#0c1a2b" }}>
        <svg viewBox="0 0 130 90" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <path d="M12 74 Q 50 60 66 40 T 112 20" fill="none" stroke={`${C.plow}`} strokeWidth="2.4" strokeDasharray="4 4" opacity=".7" />
          <circle cx="112" cy="20" r="5" fill={C.amber} />
          <g style={{ animation: "truck 4s ease-in-out infinite" }}>
            <text x="10" y="78" fontSize="15">🛻</text>
          </g>
        </svg>
        <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(8,18,31,.82)", borderRadius: 8,
          padding: "5px 9px", font: `700 10px ${FB}`, color: C.push }}>● 6 min away</div>
      </div>
      {/* stepper */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, position: "relative" }}>
        <div style={{ position: "absolute", top: 9, left: 10, right: 10, height: 2, background: C.line }} />
        <div style={{ position: "absolute", top: 9, left: 10, width: "55%", height: 2, background: C.amber }} />
        {["Sent", "Accepted", "En route", "Done"].map((s, k) => (
          <div key={s} style={{ position: "relative", zIndex: 1, textAlign: "center", width: 48 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", margin: "0 auto",
              background: k <= 2 ? C.amber : C.night2, border: `2px solid ${k <= 2 ? C.amber : C.line}`,
              color: "#231603", font: `800 9px ${FB}`, display: "grid", placeItems: "center" }}>{k <= 2 ? "✓" : ""}</div>
            <div style={{ font: `600 8px ${FB}`, color: k <= 2 ? C.ice : C.mistDim, marginTop: 4 }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- sections ----------
export default function Landing({ onStart }) {
  const goDrive = () => { if (typeof window !== "undefined") window.location.href = "/drive.html"; };
  const [faqOpen, setFaqOpen] = useState(0);

  const FAQ = [
    ["Do I need a contract or subscription?", "No. DRIFT is pay-per-storm — you're only charged when a plow actually clears your driveway. No contracts, no monthly fees, no commitment."],
    ["How much does it cost to plow a driveway in Duluth?", "A typical residential driveway runs about $30–$60 depending on size. You see the exact price up front — a base rate plus a small per-square-foot charge — before you ever book. No hidden fees."],
    ["How fast can someone come plow?", "During a storm you can book on demand and watch your driver head over live, usually within the hour. You can also set an auto-plow trigger so it happens automatically once snow hits a depth you choose."],
    ["What areas do you serve?", "Duluth, Hermantown, Cloquet, Esko, Proctor, and Superior, Wisconsin — the greater Twin Ports and Northland."],
    ["Are the drivers insured?", "Yes. Every driver is verified and carries commercial coverage before they can take a job, and you get before-and-after photos on every plow."],
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB, overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap');
        html{scroll-behavior:smooth}
        @keyframes snowfall{to{transform:translateY(105vh)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes draw{to{stroke-dashoffset:0}}
        @keyframes truck{0%{transform:translate(0,0)}100%{transform:translate(92px,-52px)}}
        @keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        @keyframes aurora{0%,100%{transform:translateX(-6%) skewX(-6deg)}50%{transform:translateX(6%) skewX(6deg)}}
        .rise{animation:rise .8s cubic-bezier(.22,1,.36,1) both}
        @media(prefers-reduced-motion:reduce){*{animation:none!important}}
      `}</style>

      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(8,18,31,.82)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${C.line}66` }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "13px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(150deg,${C.amberSoft},${C.amber})`, color: "#231603", display: "grid", placeItems: "center", fontWeight: 800 }}>❄</div>
            <div style={{ font: `800 22px ${FD}`, letterSpacing: ".06em" }}>DRIFT</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={goDrive} style={{ background: "none", border: `1px solid ${C.line}`, color: C.mist, font: `700 12px ${FB}`, borderRadius: 10, padding: "9px 13px", cursor: "pointer", whiteSpace: "nowrap" }} className="nav-drive">Drive with us</button>
            <Btn onClick={onStart} style={{ padding: "10px 16px" }}>Get started</Btn>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header style={{ position: "relative", overflow: "hidden" }}>
        {/* aurora + glow background */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          <div style={{ position: "absolute", top: -120, left: "50%", transform: "translateX(-50%)", width: 900, height: 420,
            background: `radial-gradient(ellipse at center, ${C.push}22, transparent 60%), radial-gradient(ellipse at 30% 40%, ${C.plow}22, transparent 55%), radial-gradient(ellipse at 70% 50%, ${C.violet}1c, transparent 55%)`,
            filter: "blur(40px)", animation: "aurora 14s ease-in-out infinite" }} />
          <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 120%, ${C.amber}18, transparent 55%)` }} />
        </div>
        <LiftBridge />
        <Snow />
        <div style={{ position: "relative", zIndex: 3, maxWidth: 1080, margin: "0 auto", padding: "56px 22px 40px",
          display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 40, alignItems: "center" }} className="hero-grid">
          <div className="rise">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.slate, border: `1px solid ${C.line}`,
              borderRadius: 22, padding: "7px 13px", font: `700 12px ${FB}`, color: C.push }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.push, boxShadow: `0 0 8px ${C.push}` }} /> Live in Duluth &amp; the Northland
            </div>
            <h1 style={{ font: `800 clamp(42px,6.4vw,72px)/1 ${FD}`, letterSpacing: ".01em", margin: "18px 0 16px" }}>
              Your driveway,<br /><span style={{ color: C.amber }}>plowed on demand.</span>
            </h1>
            <p style={{ font: `400 clamp(16px,2.1vw,20px)/1.5 ${FB}`, color: C.mist, maxWidth: 480, margin: "0 0 26px" }}>
              No contracts. Map your property, see an honest price, and track your plow live — pay only when it actually snows.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Btn big onClick={onStart}>Get my driveway plowed →</Btn>
              <Btn big ghost onClick={goDrive}>I have a plow — earn</Btn>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 24, font: `600 13px ${FB}`, color: C.mist }}>
              <span>❄ Pay per storm</span><span>📍 Local drivers</span><span>📸 Photo proof</span>
            </div>
          </div>
          <div className="rise" style={{ animationDelay: ".15s" }}><PhoneDemo /></div>
        </div>
      </header>

      {/* TRUST BAR */}
      <section style={{ borderTop: `1px solid ${C.line}66`, borderBottom: `1px solid ${C.line}66`, background: C.night2 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 22px", display: "flex", gap: 26, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            [ICONS.noContract, "No contracts", C.push],
            [ICONS.lock, "Secure card payments", C.plow],
            [ICONS.shield, "Insured drivers", C.amber],
            [ICONS.camera, "Before & after photos", C.violet],
            [ICONS.pin, "Duluth-local crews", C.push],
          ].map(([p, label, col], k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 9, color: C.mist }}>
              <span style={{ color: col, display: "grid", placeItems: "center" }}><Icon path={p} /></span>
              <span style={{ font: `700 13px ${FB}`, color: C.ice }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <Section title="From flurry to cleared in four taps" lead="Set it up once. Then it's automatic — or one tap away.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}>
          {[
            ["📍", "Map your driveway", "Outline it on a satellite map — no measuring."],
            ["❄️", "Set your snow trigger", "Auto-book at the depth you choose, or tap on demand."],
            ["🛻", "A local plow rolls out", "Accepts, heads over, and you track them live."],
            ["📸", "Pay only when plowed", "One honest price, with before & after photos."],
          ].map(([ic, t, d], k) => (
            <div key={t} style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22, position: "relative" }}>
              <div style={{ position: "absolute", top: 16, right: 18, font: `800 30px ${FD}`, color: C.line }}>{k + 1}</div>
              <div style={{ fontSize: 30 }}>{ic}</div>
              <h3 style={{ font: `700 16px ${FB}`, margin: "12px 0 6px" }}>{t}</h3>
              <p style={{ margin: 0, color: C.mist, font: `400 14px/1.5 ${FB}` }}>{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* SERVICES */}
      <Section title="Built for the whole storm" lead="Plowing leads the way — with backup for everything else winter drops on you.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          {[
            ["🚜", "Driveway plowing", "Cleared to the apron", true],
            ["🧹", "Sidewalk clearing", "Ordinance-compliant"],
            ["🧂", "Salting & ice-melt", "Stop the re-freeze"],
            ["🚗", "Car dig-outs", "Freed from the berm"],
            ["🔋", "Roadside jump-start", "Dead battery help"],
            ["🏢", "Commercial lots", "Businesses & multi-bay"],
          ].map(([ic, t, d, hero]) => (
            <div key={t} style={{ background: hero ? `linear-gradient(140deg,${C.amber}1c,${C.night2})` : C.slate,
              border: `1px solid ${hero ? C.amber + "66" : C.line}`, borderRadius: 14, padding: 18, position: "relative" }}>
              {hero && <span style={{ position: "absolute", top: 12, right: 12, font: `800 8px ${FB}`, letterSpacing: ".08em", color: C.push }}>MOST BOOKED</span>}
              <div style={{ fontSize: 24 }}>{ic}</div>
              <div style={{ font: `700 14px ${FB}`, marginTop: 8 }}>{t}</div>
              <div style={{ font: `400 12px ${FB}`, color: C.mist, marginTop: 3 }}>{d}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* WHY */}
      <Section>
        <div style={{ background: `linear-gradient(120deg,${C.amber}10,${C.night2})`, border: `1px solid ${C.amber}44`, borderRadius: 22, padding: "30px 24px" }}>
          <h2 style={{ font: `700 clamp(26px,4vw,34px)/1.1 ${FD}`, textAlign: "center", margin: "0 0 4px" }}>Why neighbors pick DRIFT</h2>
          <p style={{ textAlign: "center", color: C.mist, margin: "0 auto 24px", maxWidth: 520 }}>Honest, local, and built so you never think about snow again.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
            {[
              ["No contracts, ever", "Pay per storm. No snow, no charge — nothing to cancel."],
              ["Prices you can see", "Full breakdown before you book. No surge you can't explain."],
              ["Watch your driver", "Live map tracking and in-app messaging, start to finish."],
              ["Proof it's done", "Before & after photos on every single job."],
              ["Real local drivers", "Folks from around Duluth — not a faceless call center."],
              ["Set it & forget it", "Auto-book at your snow depth and wake up to a clear drive."],
            ].map(([t, d]) => (
              <div key={t} style={{ display: "flex", gap: 11 }}>
                <span style={{ color: C.push, flexShrink: 0, marginTop: 1 }}><Icon path={ICONS.shield} size={18} /></span>
                <div><div style={{ font: `700 14px ${FB}` }}>{t}</div>
                  <div style={{ font: `400 13px/1.45 ${FB}`, color: C.mist, marginTop: 2 }}>{d}</div></div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* SERVICE AREA */}
      <Section title="Serving the Twin Ports" lead="On-demand snow removal across Duluth and the surrounding Northland.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {["Duluth, MN", "Hermantown, MN", "Cloquet, MN", "Esko, MN", "Proctor, MN", "Superior, WI"].map(t => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 7, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 15px", font: `600 13px ${FB}`, color: C.ice }}>
              <span style={{ color: C.amber }}><Icon path={ICONS.pin} size={16} /></span>{t}
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ (matches JSON-LD in index.html for rich results) */}
      <Section title="Questions, answered" lead="The stuff Duluth homeowners ask us most.">
        <div style={{ maxWidth: 700, margin: "0 auto", display: "grid", gap: 10 }}>
          {FAQ.map(([q, a], k) => {
            const open = faqOpen === k;
            return (
              <div key={k} style={{ background: C.night2, border: `1px solid ${open ? C.amber + "77" : C.line}`, borderRadius: 14, overflow: "hidden" }}>
                <button onClick={() => setFaqOpen(open ? -1 : k)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  background: "none", border: "none", cursor: "pointer", padding: "16px 18px", textAlign: "left", color: C.ice, font: `700 15px ${FB}` }}>
                  <span>{q}</span>
                  <span style={{ color: C.amber, fontSize: 20, transform: open ? "rotate(45deg)" : "none", transition: "transform .2s", flexShrink: 0 }}>+</span>
                </button>
                {open && <div style={{ padding: "0 18px 16px", font: `400 14px/1.55 ${FB}`, color: C.mist, animation: "fadeUp .25s ease" }}>{a}</div>}
              </div>
            );
          })}
        </div>
      </Section>

      {/* FINAL CTA */}
      <section style={{ position: "relative", overflow: "hidden", textAlign: "center", padding: "60px 22px 66px" }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 0%, ${C.amber}1e, transparent 60%)` }} />
        <Snow />
        <div style={{ position: "relative", zIndex: 2, maxWidth: 640, margin: "0 auto" }}>
          <h2 style={{ font: `800 clamp(30px,5.5vw,48px)/1.05 ${FD}`, margin: "0 0 12px" }}>Snow's coming. Beat the rush.</h2>
          <p style={{ color: C.mist, font: `400 17px ${FB}`, margin: "0 0 26px" }}>Set up your property in two minutes — free until you book your first plow.</p>
          <Btn big onClick={onStart}>Get started →</Btn>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: `1px solid ${C.line}`, padding: "28px 22px", textAlign: "center", color: C.mistDim, font: `500 13px ${FB}` }}>
        <div style={{ marginBottom: 8 }}>
          <button onClick={onStart} style={{ background: "none", border: "none", color: C.mist, cursor: "pointer", font: `600 13px ${FB}`, marginRight: 16 }}>Get a plow</button>
          <button onClick={goDrive} style={{ background: "none", border: "none", color: C.mist, cursor: "pointer", font: `600 13px ${FB}` }}>Drive with DRIFT</button>
        </div>
        DRIFT · On-demand snow removal · Duluth, MN &amp; the Northland
      </footer>

      <style>{`
        @media(max-width:820px){.hero-grid{grid-template-columns:1fr!important;text-align:center}.hero-grid p{margin-left:auto;margin-right:auto}}
        @media(max-width:430px){.nav-drive{display:none}}
      `}</style>
    </div>
  );
}

function Section({ title, lead, children }) {
  return (
    <section style={{ padding: "48px 22px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {title && <h2 style={{ font: `700 clamp(26px,4vw,36px)/1.1 ${FD}`, textAlign: "center", margin: "0 0 8px" }}>{title}</h2>}
        {lead && <p style={{ textAlign: "center", color: C.mist, maxWidth: 560, margin: "0 auto 30px", font: `400 16px ${FB}` }}>{lead}</p>}
        {children}
      </div>
    </section>
  );
}
