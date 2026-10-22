// DRIFT owner dashboard — open with  ?admin=1  (also ?ops=1).
// Only accounts whose email is in the OWNER_EMAILS Vercel variable can load
// any data; the server checks every request.
import React, { Suspense, lazy, useEffect, useState } from "react";
import { C, FD, FB, FM } from "./theme.js";
import Icon from "./Icon.jsx";
import { authedFetch } from "./lib/payments.js";
const LiveMap = lazy(() => import("./PropertyMap.jsx").then((m) => ({ default: m.LiveMap })));

async function api(action, body) {
  const res = await authedFetch(`/api/admin?action=${action}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {});
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const date = (d) => (d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

const card = () => ({ background: C.slate, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 });
const th = () => ({ textAlign: "left", font: `600 12px ${FB}`, color: C.mistDim, padding: "10px 12px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" });
const td = () => ({ font: `400 14px ${FB}`, color: C.ice, padding: "11px 12px", borderBottom: `1px solid ${C.lineSoft}`, whiteSpace: "nowrap" });
const btn = (kind) => ({ font: `600 13px ${FB}`, padding: "8px 12px", borderRadius: 10, cursor: "pointer",
  border: `1px solid ${kind === "danger" ? C.danger + "88" : C.line}`, background: kind === "good" ? C.push : kind === "amber" ? C.amber : C.night2,
  color: kind === "good" ? C.onPush : kind === "amber" ? C.onAmber : kind === "danger" ? C.danger : C.ice });

function Chip({ children, tone }) {
  const col = { good: C.push, warn: C.amber, bad: C.danger, info: C.plow }[tone] || C.mist;
  return <span style={{ display: "inline-block", font: `600 12px ${FB}`, color: col, background: col + "1F", borderRadius: 999, padding: "3px 9px" }}>{children}</span>;
}
const docTone = (s) => (s === "approved" ? "good" : s === "pending" ? "warn" : s === "rejected" ? "bad" : undefined);
const statusTone = (s) => ({ completed: "good", captured: "good", paid: "good", authorized: "info", requested: "warn", accepted: "info", enroute: "info",
  plowing: "info", owed: "warn", pending: "warn", failed: "bad", disputed: "bad", cancelled: undefined, expired: undefined }[s]);

function Tile({ label, value, sub, tone }) {
  const col = { good: C.push, amber: C.amber, info: C.plow }[tone] || C.ice;
  return (
    <div style={card()}>
      <div style={{ font: `500 13px ${FB}`, color: C.mist }}>{label}</div>
      <div style={{ font: `700 28px/1.1 ${FD}`, letterSpacing: "-.02em", color: col, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ font: `400 12.5px ${FB}`, color: C.mistDim, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// Forecast + a manual "send snow alert" button. The daily check (3pm) sends one
// automatically when 2"+ is expected in the next 24 hours.
function SnowAlerts() {
  const [f, setF] = useState(null);
  const [who, setWho] = useState("customers");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("snow-forecast").then(setF).catch((e) => setF({ error: e.message })); }, []);
  const send = async () => {
    if (!title.trim()) { setMsg("Add a title first."); return; }
    if (!window.confirm(`Send this alert to ${who === "all" ? "everyone" : who}?`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api("snow-alert", { title: title.trim(), body: body.trim(), audience: who });
      setMsg(`Sent to ${r.customers} customer phone${r.customers === 1 ? "" : "s"} and ${r.drivers} driver phone${r.drivers === 1 ? "" : "s"}.`);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  const inp = { width: "100%", boxSizing: "border-box", background: C.night2, border: `1px solid ${C.line}`, borderRadius: 10,
    padding: "10px 12px", color: C.ice, font: `400 14px ${FB}`, outline: "none" };
  return (
    <section>
      <h2 style={{ font: `700 20px ${FD}`, margin: "0 0 12px", color: C.ice }}>Snow alerts</h2>
      <div style={{ ...card(), display: "grid", gap: 12 }}>
        <div style={{ font: `400 14px ${FB}`, color: C.ice }}>
          {!f ? "Checking the forecast…" : f.error ? `Forecast unavailable (${f.error})`
            : <>Duluth forecast (National Weather Service): <b>{f.next12}"</b> next 12 hrs · <b>{f.next24}"</b> next 24 hrs · <b>{f.next36}"</b> next 36 hrs</>}
          <div style={{ color: C.mistDim, fontSize: 12.5, marginTop: 4 }}>An alert goes out automatically around 3pm when 2"+ is expected in the next 24 hours (once a day, max).</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["customers", "Customers"], ["drivers", "Drivers"], ["all", "Everyone"]].map(([k, l]) => (
            <button key={k} onClick={() => setWho(k)} style={{ ...btn(), background: who === k ? C.amber : C.night2, color: who === k ? C.onAmber : C.ice }}>{l}</button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder={`Title, e.g. Snow's coming · 4–6" tonight`} style={inp} />
        <input value={body} onChange={(e) => setBody(e.target.value.slice(0, 160))} placeholder="Message, e.g. Book now to get in line before the rush." style={inp} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={send} disabled={busy} style={btn("amber")}>{busy ? "Sending…" : "Send alert"}</button>
          {msg && <span style={{ font: `500 13px ${FB}`, color: C.mist }}>{msg}</span>}
        </div>
      </div>
    </section>
  );
}

// ---------- problems drivers/customers reported on jobs (hidden when there are none) ----------
const ISSUE_LABEL = { blocked: "Something in the way", no_access: "Can't get to the property", damage: "Damage", unsafe: "Unsafe conditions", other: "Other problem" };
function Issues() {
  const [rows, setRows] = useState(null);
  const load = () => api("issues").then((d) => setRows(d.issues)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (!rows || !rows.length) return null;
  const resolve = async (id) => { await api("resolve-issue", { id }); load(); };
  return (
    <section>
      <h2 style={{ font: `700 20px ${FD}`, margin: "0 0 12px", color: C.amber }}>Needs a look · {rows.length}</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ ...card(), borderColor: r.kind === "damage" || r.kind === "unsafe" ? C.danger + "88" : C.amber + "66", display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ font: `600 15px ${FB}`, color: C.ice }}>{ISSUE_LABEL[r.kind] || r.kind}</span>
                {r.released && <Chip tone="warn">Job given back</Chip>}
                <span style={{ font: `400 13px ${FB}`, color: C.mistDim }}>{date(r.created_at)}</span>
              </div>
              {r.note && <div style={{ font: `400 14px/1.45 ${FB}`, color: C.ice, marginTop: 6 }}>“{r.note}”</div>}
              <div style={{ font: `400 13px/1.5 ${FB}`, color: C.mist, marginTop: 6 }}>
                {r.address || "No address"} · reported by {r.byDriver ? "driver" : "customer"} {r.reporter?.name || ""}<br />
                Customer: {r.customer?.name || "—"}{r.customer?.phone ? ` · ${r.customer.phone}` : ""}
                {r.driver ? <> · Driver: {r.driver.name}{r.driver.phone ? ` · ${r.driver.phone}` : ""}</> : null}
              </div>
            </div>
            <button onClick={() => resolve(r.id)} style={{ ...btn(), alignSelf: "center" }}>Mark handled</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Overview() {
  const [d, setD] = useState(null);
  const [range, setRange] = useState("last30");
  const [err, setErr] = useState(null);
  useEffect(() => { api("summary").then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <p style={{ color: C.danger, font: `500 14px ${FB}` }}>{err}</p>;
  if (!d) return <p style={{ color: C.mist }}>Loading…</p>;
  const m = d.money[range];
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 12 };
  return (
    <div style={{ display: "grid", gap: 22 }}>
      <Issues />
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ font: `700 20px ${FD}`, margin: 0, color: C.ice }}>Money</h2>
          <div style={{ display: "flex", gap: 6 }}>
            {[["last7", "7 days"], ["last30", "30 days"], ["allTime", "All time"]].map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} style={{ ...btn(), background: range === k ? C.amber : C.night2, color: range === k ? C.onAmber : C.ice }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={grid}>
          <Tile label="Customers paid" value={money(m.gross)} sub={`${m.jobs} charged job${m.jobs === 1 ? "" : "s"} · + ${money(m.tips)} tips`} />
          <Tile label="Paid to drivers" value={money(m.driverPay)} sub="80% of offers + call-out fees (tips go to drivers too)" tone="info" />
          <Tile label="DRIFT revenue" value={money(m.driftRevenue)} sub="$5 fee + 20% of each offer" tone="amber" />
          <Tile label="Stripe fees (est.)" value={money(m.stripeFeesEst)} sub="2.9% + 30¢ per charge — exact in Stripe" />
          <Tile label="Profit (est.)" value={money(m.profitEst)} sub="DRIFT revenue minus Stripe fees" tone="good" />
          {d.stripeBalance && <Tile label={`Stripe balance${d.stripeBalance.livemode ? "" : " (test mode)"}`} value={money(d.stripeBalance.available)}
            sub={`${money(d.stripeBalance.pending)} pending`} />}
        </div>
      </section>
      <Trends />
      <section>
        <h2 style={{ font: `700 20px ${FD}`, margin: "0 0 12px", color: C.ice }}>People</h2>
        <div style={grid}>
          <Tile label="Customers" value={d.people.customers} />
          <Tile label="Drivers" value={d.people.drivers} sub={`${d.people.driversOnline} online now · ${d.people.driversPayoutsReady} with payouts set up`} />
          <Tile label="New sign-ups (7 days)" value={d.people.newLast7} />
          <Tile label="Suspended drivers" value={d.people.driversSuspended} />
        </div>
      </section>
      <section>
        <h2 style={{ font: `700 20px ${FD}`, margin: "0 0 12px", color: C.ice }}>Jobs</h2>
        <div style={grid}>
          <Tile label="All jobs" value={d.jobs.total} sub={`${d.jobs.last7} in the last 7 days`} />
          <Tile label="Open right now" value={d.jobs.open} tone="info" />
          <Tile label="Completed" value={d.jobs.completed} tone="good" />
          <Tile label="Cancelled / expired" value={d.jobs.cancelled} />
          <Tile label="Owed to drivers" value={money(d.jobs.owedToDrivers)} sub="Waiting on driver payout setup" tone="amber" />
          <Tile label="Problems" value={d.jobs.failedPayments + d.jobs.disputes + (d.jobs.openIssues || 0)} sub={`${d.jobs.openIssues || 0} reported on jobs · ${d.jobs.failedPayments} failed charges · ${d.jobs.disputes} disputes`} tone={d.jobs.openIssues ? "amber" : undefined} />
        </div>
      </section>
      <SnowAlerts />
    </div>
  );
}

// ---------- trend charts: one bar per day, hover/tap a bar for its value ----------
function DayBars({ title, days, field, fmt = (v) => v, color = C.amber }) {
  const [hover, setHover] = useState(null);
  const vals = days.map((d) => d[field] || 0);
  const total = vals.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...vals);
  const W = 100 / days.length;
  const H = 120;
  const label = (k) => new Date(k + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const h = hover != null ? days[hover] : null;
  return (
    <div style={card()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ font: `500 13px ${FB}`, color: C.mist }}>{title}</div>
        <div style={{ font: `500 12px ${FM}`, color: C.mistDim }}>{h ? label(h.day) : `last ${days.length} days`}</div>
      </div>
      <div style={{ font: `700 26px/1.1 ${FD}`, color: C.ice, marginTop: 6 }}>{h ? fmt(h[field] || 0) : fmt(total)}</div>
      <div style={{ position: "relative", height: H, marginTop: 10 }} onMouseLeave={() => setHover(null)}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, borderTop: `1px dashed ${C.lineSoft}` }} />
        <div style={{ position: "absolute", right: 0, top: -2, transform: "translateY(-100%)", font: `500 11px ${FM}`, color: C.mistDim }}>{fmt(max)}</div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderTop: `1px solid ${C.line}` }} />
        {days.map((d, i) => {
          const v = d[field] || 0;
          return (
            <div key={d.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(hover === i ? null : i)} title={`${label(d.day)}: ${fmt(v)}`}
              style={{ position: "absolute", left: `${i * W}%`, width: `${W}%`, top: 0, bottom: 0, cursor: "default" }}>
              <div style={{ position: "absolute", left: 1, right: 1, bottom: 0, height: v ? Math.max(3, (v / max) * H) : 0,
                background: color, opacity: hover == null || hover === i ? 1 : .45, borderRadius: "4px 4px 0 0", transition: "opacity .15s" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", font: `500 11px ${FM}`, color: C.mistDim, marginTop: 6 }}>
        <span>{label(days[0].day)}</span><span>Today</span></div>
    </div>
  );
}

function Trends() {
  const [d, setD] = useState(null);
  const [n, setN] = useState(30);
  const [err, setErr] = useState(null);
  useEffect(() => { setD(null); api("trends", { days: n }).then(setD).catch((e) => setErr(e.message)); }, [n]);
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ font: `700 20px ${FD}`, margin: 0, color: C.ice }}>Over time</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {[[14, "14 days"], [30, "30 days"], [90, "90 days"]].map(([k, l]) => (
            <button key={k} onClick={() => setN(k)} style={{ ...btn(), background: n === k ? C.amber : C.night2, color: n === k ? C.onAmber : C.ice }}>{l}</button>
          ))}
        </div>
      </div>
      {err ? <p style={{ color: C.danger, font: `500 14px ${FB}` }}>{err}</p> : !d ? <p style={{ color: C.mist }}>Loading…</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          <DayBars title="Customer sign-ups" days={d.days} field="customers" />
          <DayBars title="Driver sign-ups" days={d.days} field="drivers" color={C.plow} />
          <DayBars title="Jobs completed" days={d.days} field="completed" color={C.push} />
          <DayBars title="Customers paid (incl. tips)" days={d.days} field="gross" fmt={money} />
        </div>
      )}
    </section>
  );
}

// ---------- storm-day map: who's online, which jobs are waiting, what's in progress ----------
const LIVE_STATUS = {
  requested: { label: "Waiting for a driver", color: "#FFB020" },
  scheduled: { label: "Scheduled (next 12h)", color: "#4C9BFF" },
  accepted: { label: "Driver on the way", color: "#3DDC84" },
  enroute: { label: "Driver on the way", color: "#3DDC84" },
  plowing: { label: "Plowing now", color: "#3DDC84" },
};
function LiveBoard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api("live").then((x) => alive && setD(x)).catch((e) => alive && setErr(e.message));
    load(); const iv = setInterval(load, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  if (err) return <p style={{ color: C.danger, font: `500 14px ${FB}` }}>{err}</p>;
  if (!d) return <p style={{ color: C.mist }}>Loading…</p>;
  const fresh = (t) => t && Date.now() - new Date(t).getTime() < 15 * 60e3;
  const markers = [
    ...d.jobs.filter((j) => j.lat != null).map((j) => ({ lat: j.lat, lng: j.lng, label: `$${Math.round(j.price)}`, color: LIVE_STATUS[j.status]?.color })),
    ...d.drivers.filter((x) => x.lat != null && fresh(x.seenAt)).map((x) => ({ lat: x.lat, lng: x.lng, kind: "truck", pulse: x.busy > 0 })),
  ];
  const waiting = d.jobs.filter((j) => j.status === "requested").length;
  const active = d.jobs.filter((j) => ["accepted", "enroute", "plowing"].includes(j.status)).length;
  const sched = d.jobs.filter((j) => j.status === "scheduled").length;
  const online = d.drivers.filter((x) => x.online).length;
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 };
  const legend = [["Waiting", "#FFB020"], ["Scheduled", "#4C9BFF"], ["In progress", "#3DDC84"]];
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={grid}>
        <Tile label="Drivers online" value={online} sub={`${d.drivers.filter((x) => x.busy).length} on a job`} tone="info" />
        <Tile label="Waiting for a driver" value={waiting} tone={waiting ? "amber" : undefined} sub={waiting > online ? "More jobs than drivers — send a driver alert" : undefined} />
        <Tile label="In progress" value={active} tone="good" />
        <Tile label="Scheduled, next 12h" value={sched} />
      </div>
      <div style={card()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {legend.map(([l, c]) => <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `500 13px ${FB}`, color: C.mist }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: c }} />{l}</span>)}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `500 13px ${FB}`, color: C.mist }}><Icon e="truck" s={14} /> Driver</span>
          </div>
          <span style={{ font: `500 12px ${FM}`, color: C.mistDim }}>updates every 20s · {new Date(d.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
        </div>
        <Suspense fallback={<div style={{ height: 420 }} />}><LiveMap height={420} markers={markers} fit={markers.length > 0} /></Suspense>
        {markers.length === 0 && <p style={{ font: `400 13px ${FB}`, color: C.mistDim, margin: "10px 0 0" }}>Nothing on the map right now — no open jobs and no drivers sharing location.</p>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
        <div style={card()}>
          <div style={{ font: `600 15px ${FB}`, marginBottom: 10 }}>Jobs</div>
          {d.jobs.length === 0 ? <p style={{ font: `400 13px ${FB}`, color: C.mistDim, margin: 0 }}>No open jobs.</p> : d.jobs.map((j) => (
            <div key={j.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: `1px solid ${C.lineSoft}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: LIVE_STATUS[j.status]?.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `500 14px ${FB}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.address || "No address"}</div>
                <div style={{ font: `400 12.5px ${FB}`, color: C.mistDim }}>{LIVE_STATUS[j.status]?.label}{j.driver ? ` · ${j.driver}` : ""}{j.scheduledFor ? ` · ${date(j.scheduledFor)}` : ` · booked ${date(j.createdAt)}`}</div>
              </div>
              <div style={{ font: `600 14px ${FM}` }}>{money(j.price)}</div>
            </div>
          ))}
        </div>
        <div style={card()}>
          <div style={{ font: `600 15px ${FB}`, marginBottom: 10 }}>Drivers</div>
          {d.drivers.length === 0 ? <p style={{ font: `400 13px ${FB}`, color: C.mistDim, margin: 0 }}>No drivers online.</p> : d.drivers.map((x) => (
            <div key={x.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: `1px solid ${C.lineSoft}` }}>
              <Icon e="truck" s={16} color={x.online ? C.push : C.mistDim} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `500 14px ${FB}` }}>{x.name || "Driver"}</div>
                <div style={{ font: `400 12.5px ${FB}`, color: C.mistDim }}>{x.online ? "Online" : "Offline"}{x.busy ? ` · ${x.busy} job${x.busy > 1 ? "s" : ""}` : ""}{x.seenAt ? ` · location ${fresh(x.seenAt) ? "live" : date(x.seenAt)}` : " · no location yet"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Table({ cols, rows, onRow }) {
  return (
    <div style={{ ...card(), padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{cols.map((c) => <th key={c[0]} style={th()}>{c[0]}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length} style={{ ...td(), color: C.mist }}>Nothing yet.</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.id || i} onClick={onRow ? () => onRow(r) : undefined} style={{ cursor: onRow ? "pointer" : "default" }}>
              {cols.map((c) => <td key={c[0]} style={td()}>{c[1](r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Drivers() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const load = () => api("drivers").then((d) => setRows(d.drivers)).catch((e) => setRows({ error: e.message }));
  useEffect(() => { load(); }, []);
  if (!rows) return <p style={{ color: C.mist }}>Loading…</p>;
  if (rows.error) return <p style={{ color: C.danger }}>{rows.error}</p>;
  const shown = rows.filter((r) => `${r.name} ${r.email} ${r.phone} ${r.truck}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drivers" style={search()} />
      <Table rows={shown} onRow={(r) => setOpen(r.id)} cols={[
        ["Driver", (r) => <><div style={{ font: `600 14px ${FB}` }}>{r.name || "—"}</div><div style={{ font: `400 12px ${FB}`, color: C.mist }}>{r.email}</div></>],
        ["Phone", (r) => r.phone || "—"],
        ["Truck", (r) => r.truck || "—"],
        ["License", (r) => <Chip tone={docTone(r.license)}>{r.license}</Chip>],
        ["Registration", (r) => <Chip tone={docTone(r.registration)}>{r.registration}</Chip>],
        ["Payouts", (r) => <Chip tone={r.payouts_ready ? "good" : "warn"}>{r.payouts_ready ? "set up" : "not set up"}</Chip>],
        ["Jobs", (r) => r.jobsDone],
        ["Level", (r) => <Chip tone={r.level === "elite" ? "warn" : r.level === "pro" ? "info" : undefined}>{r.level || "rookie"}</Chip>],
        ["Zone", (r) => r.home_radius_mi ? `${r.home_radius_mi} mi` : "any"],
        ["Late cancels", (r) => r.late_cancels ? <Chip tone={r.late_cancels >= 3 ? "bad" : "warn"}>{r.late_cancels}</Chip> : "0"],
        ["Earned", (r) => money(r.earned)],
        ["Status", (r) => r.suspended ? <Chip tone="bad">suspended</Chip> : r.is_online ? <Chip tone="good">online</Chip> : <Chip>offline</Chip>],
        ["Joined", (r) => day(r.created_at)],
      ]} />
      {open && <DriverPanel id={open} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}
const search = () => ({ width: "100%", maxWidth: 360, marginBottom: 12, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12,
  padding: "11px 14px", color: C.ice, font: `500 15px ${FB}`, outline: "none" });

function DriverPanel({ id, onClose }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api("driver", { id }).then(setD).catch((e) => setD({ error: e.message }));
  useEffect(() => { load(); }, [id]);
  const review = async (docId, status) => {
    const note = status === "rejected" ? (window.prompt("Reason (the driver will see this):", "Photo is blurry — please upload a clearer one") || "") : null;
    setBusy(true); try { await api("review-document", { id: docId, status, note }); await load(); } finally { setBusy(false); }
  };
  const suspend = async (v) => { setBusy(true); try { await api("suspend", { id, suspended: v }); await load(); } finally { setBusy(false); } };
  const p = d?.profile;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: C.scrim, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, height: "100%", overflowY: "auto", background: C.night, borderLeft: `1px solid ${C.line}`, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ font: `700 22px ${FD}`, margin: 0, color: C.ice }}>{p?.name || "Driver"}</h2>
          <button onClick={onClose} style={btn()}>Close</button>
        </div>
        {!d ? <p style={{ color: C.mist }}>Loading…</p> : d.error ? <p style={{ color: C.danger }}>{d.error}</p> : <>
          <div style={{ ...card(), marginTop: 16, display: "grid", gap: 6, font: `400 14px ${FB}`, color: C.ice }}>
            <div><b>Email:</b> {p.email}</div><div><b>Phone:</b> {p.phone || "—"}</div>
            <div><b>Truck:</b> {p.truck || "—"}</div><div><b>Equipment:</b> {(p.tools || []).join(", ") || "—"}</div>
            <div><b>Joined:</b> {day(p.created_at)} · <b>Rating:</b> {p.rating ? `${Number(p.rating).toFixed(1)} (${p.ratings_count || 0})` : "no ratings yet"} · <b>Jobs done:</b> {p.jobs_count || 0}</div>
            <div><b>Late cancels:</b> {p.late_cancels || 0}{(p.late_cancels || 0) >= 3 ? " — consider suspending" : ""} <span style={{ color: C.mistDim }}>(scheduled jobs dropped within 3 hrs, or missed check-in)</span></div>
            <div><b>Payouts (Stripe):</b> {!p.stripe_account_id ? "not started" : d.stripeStatus?.ready ? "ready" : `in progress${d.stripeStatus?.due?.length ? ` — needs ${d.stripeStatus.due.join(", ")}` : ""}`}</div>
            <div style={{ marginTop: 8 }}>
              {p.suspended
                ? <button disabled={busy} onClick={() => suspend(false)} style={btn("good")}>Restore driver</button>
                : <button disabled={busy} onClick={() => suspend(true)} style={btn("danger")}>Suspend driver</button>}
              <span style={{ font: `400 12px ${FB}`, color: C.mistDim, marginLeft: 10 }}>Suspended drivers can't see or accept jobs.</span>
            </div>
          </div>

          <h3 style={{ font: `700 16px ${FD}`, color: C.ice, margin: "22px 0 10px" }}>Documents</h3>
          {d.documents.length === 0 && <p style={{ color: C.mist, font: `400 14px ${FB}` }}>No documents uploaded yet.</p>}
          <div style={{ display: "grid", gap: 12 }}>
            {d.documents.map((doc) => (
              <div key={doc.id} style={card()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ font: `600 14px ${FB}`, color: C.ice }}>{doc.kind} · <span style={{ color: C.mist, fontWeight: 400 }}>{date(doc.uploaded_at)}</span></div>
                  <Chip tone={docTone(doc.status)}>{doc.status}</Chip>
                </div>
                {doc.url && (doc.path.endsWith(".pdf")
                  ? <a href={doc.url} target="_blank" rel="noopener" style={{ color: C.plow, font: `600 14px ${FB}`, display: "inline-block", marginTop: 10 }}>Open PDF</a>
                  : <a href={doc.url} target="_blank" rel="noopener"><img src={doc.url} alt={doc.kind} style={{ width: "100%", maxHeight: 320, objectFit: "contain", background: "#000", borderRadius: 10, marginTop: 10 }} /></a>)}
                {doc.note && <p style={{ font: `400 13px ${FB}`, color: C.mist, margin: "8px 0 0" }}>Note: {doc.note}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button disabled={busy} onClick={() => review(doc.id, "approved")} style={btn("good")}>Approve</button>
                  <button disabled={busy} onClick={() => review(doc.id, "rejected")} style={btn("danger")}>Reject</button>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ font: `700 16px ${FD}`, color: C.ice, margin: "22px 0 10px" }}>Signed agreements</h3>
          {d.agreements.length === 0 && <p style={{ color: C.mist, font: `400 14px ${FB}` }}>None recorded.</p>}
          {d.agreements.map((a, i) => (
            <div key={i} style={{ font: `400 13px/1.5 ${FB}`, color: C.ice, padding: "8px 0", borderBottom: `1px solid ${C.lineSoft}` }}>
              <b>{a.role === "driver" ? "Independent Contractor Agreement" : "Customer Terms + Release"}</b> · version {a.version}<br />
              <span style={{ color: C.mist }}>Agreed {date(a.accepted_at)} · recorded {date(a.recorded_at)}</span><br />
              <span style={{ color: C.mistDim, fontSize: 12 }}>{a.user_agent}</span>
            </div>
          ))}

          <h3 style={{ font: `700 16px ${FD}`, color: C.ice, margin: "22px 0 10px" }}>Reviews</h3>
          {(d.reviews || []).length === 0 && <p style={{ color: C.mist, font: `400 14px ${FB}` }}>No reviews yet.</p>}
          {(d.reviews || []).map((r) => (
            <div key={r.id} style={{ font: `400 13px/1.5 ${FB}`, color: C.ice, padding: "8px 0", borderBottom: `1px solid ${C.lineSoft}` }}>
              <b style={{ color: C.amber }}>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</b>
              <span style={{ color: C.mist }}> · {r.rater || "Customer"} · {date(r.created_at)}</span>
              {r.comment && <div style={{ marginTop: 2 }}>{r.comment}</div>}
            </div>
          ))}

          {(d.backouts || []).length > 0 && <>
            <h3 style={{ font: `700 16px ${FD}`, color: C.ice, margin: "22px 0 10px" }}>Dropped scheduled jobs</h3>
            {d.backouts.map((b, i) => (
              <div key={i} style={{ font: `400 13px ${FB}`, color: C.ice, padding: "7px 0", borderBottom: `1px solid ${C.lineSoft}` }}>
                {date(b.created_at)} · {b.reason === "no_checkin" ? "Missed check-in" : "Backed out"} · {b.late ? <Chip tone="bad">late</Chip> : <Chip>free</Chip>}
              </div>
            ))}
          </>}

          <h3 style={{ font: `700 16px ${FD}`, color: C.ice, margin: "22px 0 10px" }}>Jobs</h3>
          <Table rows={d.jobs} cols={[
            ["Date", (j) => date(j.created_at)], ["Address", (j) => j.address || "—"],
            ["Status", (j) => <Chip tone={statusTone(j.status)}>{j.status}</Chip>],
            ["Pay", (j) => money(Number(j.driver_pay) + Number(j.tip || 0))],
            ["Payout", (j) => <Chip tone={statusTone(j.payout_status)}>{j.payout_status}</Chip>],
          ]} />
        </>}
      </div>
    </div>
  );
}

// Where sign-ups come from: each Facebook group / ad / flyer gets its own link.
function Sources() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { api("sources").then((d) => setRows(d.sources)).catch((e) => setRows({ error: e.message })); }, []);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const link = slug ? `https://driftplowing.com/?ref=${slug}` : "";
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ } };
  return (
    <>
      <div style={{ ...card(), marginBottom: 16 }}>
        <div style={{ font: `700 16px ${FD}`, color: C.ice, marginBottom: 4 }}>Make a tracking link</div>
        <p style={{ font: `400 13px/1.5 ${FB}`, color: C.mist, margin: "0 0 10px" }}>Use a different link for each Facebook group, ad or flyer. Everyone who signs up through it shows up below.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hermantown moms group" style={{ ...search(), marginBottom: 0, flex: 1, minWidth: 200 }} />
          <button onClick={copy} disabled={!link} style={btn("good")}>{copied ? "Copied!" : "Copy link"}</button>
        </div>
        {link && <div style={{ font: `500 13px ${FB}`, color: C.plow, marginTop: 10, wordBreak: "break-all" }}>{link}</div>}
      </div>
      {!rows ? <p style={{ color: C.mist }}>Loading…</p> : rows.error ? <p style={{ color: C.danger }}>{rows.error}</p> : (
        <Table rows={rows} cols={[
          ["Source", (r) => <b>{r.source}</b>], ["Sign-ups", (r) => r.signups], ["Last 7 days", (r) => r.last7],
          ["Customers", (r) => r.customers], ["Drivers", (r) => r.drivers],
          ["Booked a plow", (r) => r.bookedCustomers], ["Revenue", (r) => money(r.revenue)],
        ]} />
      )}
    </>
  );
}

function Customers() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => { api("customers").then((d) => setRows(d.customers)).catch((e) => setRows({ error: e.message })); }, []);
  if (!rows) return <p style={{ color: C.mist }}>Loading…</p>;
  if (rows.error) return <p style={{ color: C.danger }}>{rows.error}</p>;
  const shown = rows.filter((r) => `${r.name} ${r.email} ${r.phone}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" style={search()} />
      <Table rows={shown} cols={[
        ["Customer", (r) => <><div style={{ font: `600 14px ${FB}` }}>{r.name || "—"}</div><div style={{ font: `400 12px ${FB}`, color: C.mist }}>{r.email}</div></>],
        ["Phone", (r) => r.phone || "—"], ["Source", (r) => r.ref_source || "—"], ["Jobs", (r) => r.jobs], ["Completed", (r) => r.completed],
        ["Spent", (r) => money(r.spent)], ["Joined", (r) => day(r.created_at)],
      ]} />
    </>
  );
}

function Jobs() {
  const [rows, setRows] = useState(null);
  const [photos, setPhotos] = useState(null);
  useEffect(() => { api("jobs").then((d) => setRows(d.jobs)).catch((e) => setRows({ error: e.message })); }, []);
  const showPhotos = async (j) => { setPhotos({ loading: true }); try { setPhotos(await api("job-photos", { id: j.id })); } catch (e) { setPhotos({ error: e.message }); } };
  if (!rows) return <p style={{ color: C.mist }}>Loading…</p>;
  if (rows.error) return <p style={{ color: C.danger }}>{rows.error}</p>;
  return (
    <>
      <Table rows={rows} cols={[
        ["Date", (j) => date(j.created_at)],
        ["Customer", (j) => j.customer || "—"], ["Driver", (j) => j.driver || "—"],
        ["Address", (j) => j.address || "—"],
        ["Status", (j) => <Chip tone={statusTone(j.status)}>{j.status}</Chip>],
        ["Payment", (j) => <Chip tone={statusTone(j.payment_status)}>{j.payment_status}</Chip>],
        ["Total", (j) => money(j.price)], ["Driver", (j) => money(j.driver_pay)], ["DRIFT", (j) => money(j.platform_fee)],
        ["Tip", (j) => money(j.tip)],
        ["Photos", (j) => j.photoCount ? <button onClick={() => showPhotos(j)} style={btn()}>{j.photoCount} photo{j.photoCount === 1 ? "" : "s"}</button> : "—"],
      ]} />
      {photos && (
        <div onClick={() => setPhotos(null)} style={{ position: "fixed", inset: 0, background: C.scrim, zIndex: 50, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card(), maxWidth: 900, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ font: `700 18px ${FD}`, margin: 0, color: C.ice }}>Before / after</h3>
              <button onClick={() => setPhotos(null)} style={btn()}>Close</button>
            </div>
            {photos.loading ? <p style={{ color: C.mist }}>Loading…</p> : photos.error ? <p style={{ color: C.danger }}>{photos.error}</p> : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                {["before", "after"].map((ph) => (
                  <div key={ph}>
                    <div style={{ font: `600 13px ${FB}`, color: C.mist, marginBottom: 6, textTransform: "capitalize" }}>{ph}</div>
                    {(photos[ph] || []).map((u, i) => u && <img key={i} src={u} alt={ph} style={{ width: "100%", borderRadius: 10, marginBottom: 8 }} />)}
                    {!(photos[ph] || []).length && <p style={{ color: C.mistDim, font: `400 13px ${FB}` }}>None</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminApp({ email, onSignOut }) {
  const [tab, setTab] = useState("overview");
  const [allowed, setAllowed] = useState(null); // null checking · true · false
  useEffect(() => { api("summary").then(() => setAllowed(true)).catch((e) => setAllowed(e.status === 403 ? false : true)); }, []);
  const tabs = [["overview", "Overview"], ["live", "Live map"], ["drivers", "Drivers"], ["customers", "Customers"], ["jobs", "Jobs"], ["sources", "Sources"]];
  return (
    <div style={{ minHeight: "100vh", background: C.night, color: C.ice, fontFamily: FB }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: C.glass, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: C.amber, color: C.onAmber, display: "grid", placeItems: "center" }}><Icon e="snowflake" s={16} /></div>
            <div style={{ font: `700 17px ${FD}`, letterSpacing: ".04em" }}>DRIFT <span style={{ color: C.mist, fontWeight: 500, letterSpacing: 0 }}>Owner</span></div>
          </div>
          <style>{`@media (max-width: 680px) { .adm-nav { order: 3; flex: 1 1 100% !important; } .adm-email { display: none; } }`}</style>
          {allowed && <nav className="adm-nav" style={{ display: "flex", gap: 4, flex: 1, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{ font: `600 14px ${FB}`, padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                background: tab === k ? C.slate2 : "transparent", color: tab === k ? C.ice : C.mist, whiteSpace: "nowrap", flex: "none" }}>{l}</button>
            ))}
          </nav>}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="adm-email" style={{ font: `400 13px ${FB}`, color: C.mistDim }}>{email}</span>
            <button onClick={onSignOut} style={btn()}>Sign out</button>
          </div>
        </div>
      </header>
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 20px 60px" }}>
        {allowed === null && <p style={{ color: C.mist }}>Checking access…</p>}
        {allowed === false && (
          <div style={{ ...card(), maxWidth: 480 }}>
            <h2 style={{ font: `700 20px ${FD}`, margin: "0 0 6px" }}>Owners only</h2>
            <p style={{ font: `400 14px/1.5 ${FB}`, color: C.mist, margin: 0 }}>
              {email} isn't on the owner list. Sign in with the owner account, or add this email to OWNER_EMAILS in Vercel.</p>
          </div>
        )}
        {allowed && tab === "overview" && <Overview />}
        {allowed && tab === "live" && <LiveBoard />}
        {allowed && tab === "drivers" && <Drivers />}
        {allowed && tab === "customers" && <Customers />}
        {allowed && tab === "jobs" && <Jobs />}
        {allowed && tab === "sources" && <Sources />}
      </main>
    </div>
  );
}
