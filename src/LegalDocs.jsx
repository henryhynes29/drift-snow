// ============================================================
// DRIFT — legal UI: full-screen document reader + clickwrap consent blocks.
// Content lives in src/legal.js. Colors/type from src/theme.js so it follows
// light/dark like the rest of the app.
//
// Why it's built this way (enforceability):
//  • Clickwrap, not browsewrap — an unchecked box the person must tick, next to
//    links to the full text, before the action (Berman v. Freedom Financial).
//  • The release and indemnity are separate, titled, and shown in bold caps so a
//    court can't call them buried (Wisconsin: Atkins / Brooten).
//  • The release names DRIFT's own ORDINARY negligence explicitly (Minnesota:
//    Justice v. Marvel) and carves out gross negligence (Minn. Stat. § 604.055).
//  • Every acceptance records the version + timestamp.
// ============================================================
import React, { useState } from "react";
import { C, FD, FB, E } from "./theme.js";
import Icon from "./Icon.jsx";
import { DOCS, LEGAL_VERSION, LEGAL_UPDATED, CUSTOMER_KEY_POINTS, DRIVER_ACKS, EMAIL } from "./legal.js";

// ---------- a record of what was agreed (store it; it's your proof) ----------
export function makeAcceptance(role, docIds) {
  return {
    role, docs: docIds, version: LEGAL_VERSION, at: new Date().toISOString(),
    ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 180) : "",
  };
}
export function hasCurrentAcceptance(rec) { return !!rec && rec.version === LEGAL_VERSION; }

// ---------- full-screen reader ----------
export function LegalReader({ docId, onClose }) {
  const doc = DOCS[docId];
  if (!doc) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={doc.title}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: C.night, display: "flex", justifyContent: "center",
        animation: "fadeIn .18s ease" }}>
      <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "calc(14px + env(safe-area-inset-top)) 18px 12px",
          borderBottom: `1px solid ${C.line}`, background: C.glass, backdropFilter: "blur(20px)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `600 16px ${FB}`, color: C.ice }}>{doc.title}</div>
            <div style={{ font: `400 12px ${FB}`, color: C.mistDim, marginTop: 1 }}>Last updated {LEGAL_UPDATED}</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer", background: C.slate,
              color: C.ice, display: "grid", placeItems: "center" }}><Icon e="close" s={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px calc(40px + env(safe-area-inset-bottom))" }}>
          <p style={{ font: `600 14.5px/1.55 ${FB}`, color: C.ice, margin: "0 0 18px" }}>{doc.intro}</p>
          {doc.sections.map((s) => (
            <section key={s.h} style={{ marginBottom: 18, ...(s.loud ? { background: C.slate, border: `1px solid ${C.line}`,
              borderLeft: `3px solid ${C.amber}`, borderRadius: 12, padding: "12px 14px" } : null) }}>
              <h3 style={{ font: `700 15px/1.3 ${FD}`, color: C.ice, margin: "0 0 8px" }}>{s.h}</h3>
              {s.p.map((t, i) => (
                <p key={i} style={{ font: `${s.loud ? 600 : 400} 14px/1.6 ${FB}`, color: s.loud ? C.ice : C.mist, margin: "0 0 8px" }}>{t}</p>
              ))}
            </section>
          ))}
          <p style={{ font: `400 12px/1.5 ${FB}`, color: C.mistDim, marginTop: 24 }}>
            Version {LEGAL_VERSION}. Questions about these terms: {EMAIL}</p>
        </div>
      </div>
    </div>
  );
}

// ---------- small pieces ----------
function DocLink({ id, onOpen, children }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(id); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
      font: "inherit", color: C.plow, textDecoration: "underline", textUnderlineOffset: 2 }}>{children}</button>
  );
}
function Check({ on }) {
  return (
    <span aria-hidden style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: "grid", placeItems: "center",
      background: on ? C.push : "transparent", border: `2px solid ${on ? C.push : C.mistDim}`, color: C.onPush,
      transition: "all .15s" }}>{on ? <Icon e="check" s={13} strokeWidth={2.6} /> : null}</span>
  );
}
function AgreeButton({ disabled, onClick, children, tone }) {
  const bg = tone === "push" ? C.push : C.amber;
  const fg = tone === "push" ? C.onPush : C.onAmber;
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ width: "100%", minHeight: 52, borderRadius: 14, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? C.line : bg, color: disabled ? C.mistDim : fg, font: `700 16px ${FB}`,
        letterSpacing: "-.01em", WebkitTapHighlightColor: "transparent" }}>{children}</button>
  );
}

// ---------- CUSTOMER: key points + one required checkbox ----------
export function CustomerConsent({ onAgree, agreeLabel = "Agree and continue", onOpen, blocked, blockedLabel }) {
  const [on, setOn] = useState(false);
  const [reading, setReading] = useState(null);
  const open = onOpen || setReading;
  return (
    <div>
      <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
        {CUSTOMER_KEY_POINTS.map(([ic, t, d], i) => (
          <div key={t} style={{ display: "flex", gap: 12, padding: "12px 14px",
            borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center",
              background: C.night2, color: i === 3 ? C.danger : C.mist }}><Icon e={ic} s={16} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: `600 14px ${FB}`, color: C.ice }}>{t}</div>
              <div style={{ font: `400 13px/1.45 ${FB}`, color: C.mist, marginTop: 2 }}>{d}</div>
            </div>
          </div>
        ))}
      </div>

      <p style={{ font: `400 13.5px/1.5 ${FB}`, color: C.mist, margin: "14px 2px 8px" }}>
        Read the full <DocLink id="customerTerms" onOpen={open}>Terms of Service</DocLink> and{" "}
        <DocLink id="customerRelease" onOpen={open}>Release, Waiver of Liability and Assumption of Risk</DocLink>.</p>
      <div onClick={() => setOn(v => !v)} role="checkbox" aria-checked={on} tabIndex={0}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setOn(v => !v); } }}
        style={{ width: "100%", display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", cursor: "pointer",
          padding: "13px 14px", borderRadius: 14, background: on ? C.push + "12" : "transparent",
          border: `1px solid ${on ? C.push + "66" : C.line}`, WebkitTapHighlightColor: "transparent" }}>
        <Check on={on} />
        <span style={{ font: `500 13.5px/1.5 ${FB}`, color: C.ice }}>
          I've read and agree to the Terms of Service and the Release, Waiver of Liability and Assumption of Risk —
          including the release of claims against DRIFT for its own ordinary negligence, and individual arbitration.
        </span>
      </div>
      <div style={{ height: 12 }} />
      <AgreeButton disabled={!on || blocked} onClick={() => onAgree(makeAcceptance("customer", ["customerTerms", "customerRelease"]))}>
        {blocked ? blockedLabel : on ? agreeLabel : "Check the box to continue"}</AgreeButton>
      {!onOpen && reading && <LegalReader docId={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

// ---------- DRIVER: five specific acknowledgments, each required ----------
export function DriverConsent({ onAgree, agreeLabel = "Agree and continue", onOpen }) {
  const [acks, setAcks] = useState({});
  const [reading, setReading] = useState(null);
  const open = onOpen || setReading;
  const all = DRIVER_ACKS.every(a => acks[a.id]);
  return (
    <div>
      <div style={{ display: "grid", gap: 8 }}>
        {DRIVER_ACKS.map((a) => {
          const on = !!acks[a.id];
          return (
            <button key={a.id} type="button" role="checkbox" aria-checked={on}
              onClick={() => setAcks(s => ({ ...s, [a.id]: !on }))}
              style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", cursor: "pointer",
                padding: "13px 14px", borderRadius: 14, background: on ? C.push + "12" : C.slate,
                border: `1px solid ${on ? C.push + "66" : C.line}`, WebkitTapHighlightColor: "transparent" }}>
              <Check on={on} />
              <span>
                <span style={{ display: "block", font: `600 14px ${FB}`, color: C.ice }}>{a.title}</span>
                <span style={{ display: "block", font: `400 13px/1.45 ${FB}`, color: C.mist, marginTop: 2 }}>{a.text}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ font: `400 13px/1.5 ${FB}`, color: C.mist, margin: "14px 2px" }}>
        These are summaries. The full{" "}
        <DocLink id="driverAgreement" onOpen={open}>Independent Contractor Agreement, Release and Waiver</DocLink>{" "}
        controls — please read it.
      </p>
      <AgreeButton tone="push" disabled={!all} onClick={() => onAgree(makeAcceptance("driver", ["driverAgreement"]))}>
        {all ? agreeLabel : `Check all ${DRIVER_ACKS.length} to continue`}</AgreeButton>
      {!onOpen && reading && <LegalReader docId={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

// ---------- gate sheet: shown before booking / going online if not yet agreed ----------
export function ConsentGate({ role, onAgree, onClose }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Agreement required"
      style={{ position: "fixed", inset: 0, zIndex: 70, background: C.scrim, display: "flex", alignItems: "flex-end",
        justifyContent: "center", animation: "fadeIn .15s ease" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 440, maxHeight: "92vh", overflowY: "auto", background: C.night,
          borderRadius: "22px 22px 0 0", boxShadow: E.sheet, padding: "18px 18px calc(22px + env(safe-area-inset-bottom))",
          animation: "rise .22s ease" }}>
        <div style={{ width: 38, height: 5, borderRadius: 3, background: C.line, margin: "0 auto 14px" }} />
        <div style={{ font: `700 22px/1.15 ${FD}`, letterSpacing: "-.02em", color: C.ice }}>
          {role === "driver" ? "Before you go online" : "Before your first booking"}</div>
        <p style={{ font: `400 14px/1.5 ${FB}`, color: C.mist, margin: "6px 0 16px" }}>
          {role === "driver"
            ? "DRIFT is an app that connects you with customers. You work for yourself — please confirm each point."
            : "DRIFT is an app that connects you with independent local plow operators. Here's what that means."}</p>
        {role === "driver"
          ? <DriverConsent onAgree={onAgree} agreeLabel="Agree and go online" />
          : <CustomerConsent onAgree={onAgree} agreeLabel="Agree and book" />}
      </div>
    </div>
  );
}

// ---------- hub: every document, from Account ----------
export function LegalHub({ onClose, acceptance }) {
  const [reading, setReading] = useState(null);
  const rows = [["customerTerms", "doc"], ["customerRelease", "warning"], ["driverAgreement", "handshake"]];
  return (
    <div role="dialog" aria-modal="true" aria-label="Legal"
      style={{ position: "fixed", inset: 0, zIndex: 75, background: C.night, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 440, padding: "calc(14px + env(safe-area-inset-top)) 20px 30px", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ font: `700 26px ${FD}`, letterSpacing: "-.02em", color: C.ice }}>Legal</div>
          <button onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, borderRadius: "50%", border: "none",
            cursor: "pointer", background: C.slate, color: C.ice, display: "grid", placeItems: "center" }}><Icon e="close" s={16} /></button>
        </div>
        <div style={{ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
          {rows.map(([id, ic], i) => (
            <button key={id} onClick={() => setReading(id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12,
              padding: "14px", background: "none", border: "none", borderTop: i ? `1px solid ${C.lineSoft}` : "none",
              cursor: "pointer", textAlign: "left" }}>
              <span style={{ color: C.mist, display: "flex" }}><Icon e={ic} s={18} /></span>
              <span style={{ flex: 1, font: `600 15px ${FB}`, color: C.ice }}>{DOCS[id].title}</span>
              <span style={{ color: C.mistDim, display: "flex" }}><Icon e="chevronright" s={16} /></span>
            </button>
          ))}
        </div>
        {acceptance && acceptance.length > 0 && (
          <div style={{ marginTop: 16, font: `400 13px/1.6 ${FB}`, color: C.mist }}>
            {acceptance.map((a) => (
              <div key={a.role}>You agreed to the {a.role === "driver" ? "Driver Agreement" : "Customer Terms and Release"} (version {a.version}) on {new Date(a.at).toLocaleString()}.</div>
            ))}
          </div>
        )}
        <p style={{ font: `400 12px/1.5 ${FB}`, color: C.mistDim, marginTop: 16 }}>
          Want to opt out of arbitration or ask about these terms? Email {EMAIL} within 30 days of agreeing.</p>
      </div>
      {reading && <LegalReader docId={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
