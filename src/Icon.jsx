import React from "react";

// DRIFT icon set — monoline, SF-Symbols / Lucide style. One component renders a
// real SVG for a given emoji glyph (or name), so no emoji ever paints to screen.
// Usage: <Icon e="🚜" s={18} />  ·  <Icon e={jt.icon} />  ·  <Icon e="check" color={C.push} />
// stroke = currentColor, so it inherits text color unless `color` is passed.

const P = {
  // vehicles / plowing
  truck: <><path d="M3 7h9v8H3zM12 10h4l3 3v2h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/></>,
  pickup: <><path d="M2 8h8v7H2zM10 11h5l4 4h-9z"/><circle cx="6" cy="17.5" r="1.7"/><circle cx="16.5" cy="17.5" r="1.7"/></>,
  car: <><path d="M4 15V11l2-4h9l2.5 4v4"/><path d="M3 15h18"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/></>,
  plowtruck: <><path d="M6 16v-6h6l2.5 3.5H19V16"/><circle cx="9" cy="17.6" r="1.7"/><circle cx="16.5" cy="17.6" r="1.7"/><path d="M6 16.5l-3.2-1 4-7 2.2 1.1"/></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></>,
  battery: <><rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3"/><path d="M9 10l-2 4h3l-2 4" strokeWidth="1.4"/></>,
  broom: <><path d="M14 3l4 4-7 7-4-4z"/><path d="M7 10l-3.5 8 8-3.5"/></>,
  skid: <><rect x="3" y="10" width="12" height="6" rx="1.5"/><path d="M15 12h3l2 2v2h-5"/><circle cx="7" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></>,
  roadkit: <><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2M12 12v3"/></>,
  cone: <><path d="M10 3h4l4 17H6zM7 15h10M8.5 10h7"/></>,

  // weather
  snowflake: <><path d="M12 2v20M4 6l16 12M20 6L4 18M12 7l3-2M12 7l-3-2M12 17l3 2M12 17l-3-2"/></>,
  snow: <><path d="M7 14a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.3 3.3 0 0 1 17.5 14z"/><path d="M8 18v1M12 17.5v1.5M16 18v1"/></>,
  cloudsun: <><circle cx="8" cy="8" r="3"/><path d="M8 1v2M3 8H1M13.5 3.5l-1.3 1.3M2.7 13.3L4 12"/><path d="M10 19a3.5 3.5 0 0 1 .4-7 4.5 4.5 0 0 1 8.6 1.5A2.8 2.8 0 0 1 18.5 19z"/></>,
  mountain: <><path d="M3 19l6-11 4 7 2-3 6 7z"/></>,

  // money / commerce
  cash: <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/></>,
  bank: <><path d="M3 9l9-5 9 5M4 9v9M20 9v9M8 12v4M12 12v4M16 12v4M3 20h18"/></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 9.5h20M6 15h4"/></>,
  gift: <><rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M12 9v11M3.5 13.5h17M12 9S9 3 6.5 5.5 12 9 12 9zM12 9s3-6 5.5-3.5S12 9 12 9z"/></>,
  ticket: <><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" strokeDasharray="1.5 2"/></>,

  // people / trust
  user: <><circle cx="12" cy="8" r="3.6"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></>,
  handshake: <><path d="M8 11l3-3 3 3 3-2 3 3-4.5 4.5L12 13l-2 2-4-4 2-2z"/></>,
  shield: <><path d="M12 3l8 3.5V12c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6.5z"/></>,
  id: <><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8" cy="11" r="2.2"/><path d="M5 16a3 3 0 0 1 6 0M14 9.5h5M14 13h5"/></>,
  lifebuoy: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5 5l4.5 4.5M14.5 14.5L19 19M19 5l-4.5 4.5M9.5 14.5L5 19"/></>,

  // ui / status
  check: <><path d="M4.5 12.5l5 5 10-11"/></>,
  close: <><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></>,
  chevronright: <><path d="M9 6l6 6-6 6"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></>,
  auto: <><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/></>,
  checkfill: <><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5 5.5-6" stroke="#0B0B0C" strokeWidth="2.2"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  minus: <><path d="M5 12h14"/></>,
  chevrondown: <><path d="M6 9l6 6 6-6"/></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></>,
  pin: <><path d="M12 21s6.5-5.6 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/></>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>,
  timer: <><circle cx="12" cy="13" r="8"/><path d="M12 13V8.5M9 2h6"/></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5M4 16h16"/><path d="M10 19a2 2 0 0 0 4 0"/></>,
  chat: <><path d="M4 5h16v11H9l-4 3.5V16H4z"/><path d="M8 9h8M8 12h5"/></>,
  camera: <><rect x="3" y="7" width="18" height="13" rx="2.4"/><path d="M8.5 7l1.3-2.3h4.4L15.5 7"/><circle cx="12" cy="13.5" r="3.2"/></>,
  phone: <><path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V19a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 5 4z"/></>,
  mobile: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 5.5h3"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="M4 7l8 6 8-6"/></>,
  share: <><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8"/></>,
  download: <><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 19h14"/></>,
  send: <><path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M21 3l-9 9"/></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></>,
  map: <><path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13M15 6.5v13"/></>,
  receipt: <><path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z"/><path d="M9 8h6M9 12h6"/></>,
  signal: <><path d="M4 20v-3M9 20v-6M14 20v-9M19 20v-13"/></>,
  nosignal: <><path d="M4 20v-2M9 20v-4M14 20v-6"/><path d="M17 6l4 4M21 6l-4 4"/></>,
  bolt: <><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></>,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2.4"/><path d="M4 9.5h16M8 3v4M16 3v4"/></>,
  link: <><path d="M9 15l6-6M8 12l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 12l2-2a3.5 3.5 0 0 0-5-5l-2 2"/></>,
  doc: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 15h5"/></>,
  hourglass: <><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/></>,
  repeat: <><path d="M4 9a6 6 0 0 1 10-3l2 2M20 15a6 6 0 0 1-10 3l-2-2"/><path d="M16 4v4h-4M8 20v-4h4"/></>,
  undo: <><path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-3"/></>,
  star: <><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></>,
  heart: <><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></>,
  home: <><path d="M4 11l8-7 8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/></>,
  flag: <><path d="M6 21V4M6 4h11l-2 3.5L17 11H6"/></>,
  play: <><path d="M8 5l11 7-11 7z"/></>,
  pause: <><path d="M9 5v14M15 5v14"/></>,
  skipnext: <><path d="M6 5l9 7-9 7zM18 5v14"/></>,
  wave: <><path d="M6 12V7a1.5 1.5 0 0 1 3 0M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 11V6.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6 7a6 6 0 0 1-6-6v-1l1.5-1.5A1.5 1.5 0 0 1 6 12"/></>,
  warning: <><path d="M12 3l9.5 16H2.5z"/><path d="M12 9.5v4.5M12 17.2v.1"/></>,
  sos: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5h-2v2h2v2h-2M14.5 9.5h2v5h-2z"/></>,
};

// map every emoji glyph in the app to a path key
const MAP = {
  "🚜": "plowtruck", "🛻": "pickup", "🚗": "car", "🏢": "building", "🔋": "battery",
  "🧹": "broom", "❄": "snowflake", "❄️": "snowflake", "🌨": "snow", "🌨️": "snow",
  "🌤": "cloudsun", "🌤️": "cloudsun", "⛰": "mountain", "⛰️": "mountain",
  "💵": "cash", "💰": "cash", "💸": "cash", "🏦": "bank", "💳": "card", "🎁": "gift", "🎟": "ticket", "🎟️": "ticket",
  "👤": "user", "🤝": "handshake", "🛡": "shield", "🛡️": "shield", "🪪": "id", "🛟": "lifebuoy",
  "✓": "check", "✅": "checkfill", "➕": "plus", "➖": "minus", "⌄": "chevrondown", "✏": "edit", "✏️": "edit",
  "📍": "pin", "🎯": "target", "⏱": "timer", "⏱️": "timer", "🔔": "bell", "💬": "chat",
  "📷": "camera", "📸": "camera", "📞": "phone", "📱": "mobile", "✉": "mail", "✉️": "mail", "📨": "send",
  "🔒": "lock", "🗺": "map", "🗺️": "map", "🧾": "receipt", "📡": "signal", "📶": "signal", "⚡": "bolt",
  "🗓": "calendar", "🗓️": "calendar", "🔗": "link", "📄": "doc", "⏳": "hourglass",
  "🔁": "repeat", "🔄": "repeat", "↺": "undo", "↶": "undo", "★": "star", "⭐": "star", "🏠": "home",
  "🏁": "flag", "▶": "play", "⏸": "pause", "⏸️": "pause", "⏭": "skipnext", "👋": "wave",
  "⚠": "warning", "⚠️": "warning", "🆘": "sos", "🚧": "cone", "🧂": "snowflake",
};

export default function Icon({ e, name, s = 18, color, style, strokeWidth = 1.8 }) {
  const key = name || MAP[e] || (P[e] ? e : null);
  const paths = key && P[key];
  if (!paths) return null; // never render a raw emoji
  const fillKeys = { star: true, bolt: true, mountain: true, cone: true, send: true, play: true, flag: true, gift: true, snow: true, cloudsun: true };
  const filled = !!fillKeys[key];
  return (
    <svg width={s} height={s} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "middle", color, flexShrink: 0, ...style }}>
      {paths}
    </svg>
  );
}
