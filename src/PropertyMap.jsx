// ============================================================
// Mapbox map components for DRIFT
//   - MapPropertyDesigner: outline the driveway on satellite. After the
//     address search we place a starting outline for a typical driveway,
//     so most customers just confirm it. Plain-language steps, a confirm
//     step, and a drop-a-hazard tool. Built for non-technical customers.
//   - LiveMap: read-only satellite map with markers + route line.
// Needs VITE_MAPBOX_TOKEN.
// ============================================================
import React, { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import area from "@turf/area";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";
import { C, FD, FB } from "./theme.js";
import Icon from "./Icon.jsx";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
if (TOKEN) mapboxgl.accessToken = TOKEN;
export const MAP_ENABLED = !!TOKEN;

const SQM_TO_SQFT = 10.7639;
const STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const DULUTH = { lng: -92.0905, lat: 46.79 };

// Marker colors are fixed (they sit on satellite imagery, not on the app theme).
const TRUCK_FILL = "#FFB020";
const TRUCK_INK = "#1A1204";
const HAZARD_FILL = "#FF453A";
const MARKER_SHADOW = "0 2px 6px rgba(0,0,0,.35)";

// Starting outline: a typical single-car driveway, 12 ft wide x 40 ft long.
const START_W_FT = 12;
const START_L_FT = 40;

const closeRing = (coords) => {
  if (coords.length < 3) return coords;
  const a = coords[0], b = coords[coords.length - 1];
  return (a[0] === b[0] && a[1] === b[1]) ? coords : [...coords, a];
};
const polyFeature = (coords, props) => ({
  type: "Feature", properties: props || {},
  geometry: { type: "Polygon", coordinates: [closeRing(coords)] },
});
const ringToCoords = (ring) => {
  const c = ring.slice();
  if (c.length > 1) { const a = c[0], b = c[c.length - 1]; if (a[0] === b[0] && a[1] === b[1]) c.pop(); }
  return c;
};

// Rectangle of widthFt x lengthFt centered on [lng, lat], long side north-south.
function rectAround(lng, lat, widthFt, lengthFt) {
  const dLat = (lengthFt / 2) / 364000;
  const dLng = (widthFt / 2) / (364000 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dLng, lat + dLat],
    [lng + dLng, lat + dLat],
    [lng + dLng, lat - dLat],
    [lng - dLng, lat - dLat],
  ];
}

// Small "x" for close / cancel buttons.
function XMark({ s = 14 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ---- Static Images URL of an outline (thumbnails + driver view) ----
export function staticMapUrl(features, center, w = 320, h = 190) {
  if (!TOKEN) return null;
  const base = "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static";
  if (features && features.length) {
    const styled = {
      type: "FeatureCollection",
      features: features.map((f) => {
        if (f.geometry?.type === "Point") {
          return { type: "Feature", geometry: f.geometry, properties: { "marker-color": HAZARD_FILL, "marker-symbol": "danger", "marker-size": "small" } };
        }
        const isPush = f.properties?.mode === "push";
        return { type: "Feature", geometry: f.geometry, properties: {
          fill: isPush ? C.push : C.plow, "fill-opacity": 0.35, stroke: isPush ? C.push : C.plow, "stroke-width": 2 } };
      }),
    };
    const overlay = "geojson(" + encodeURIComponent(JSON.stringify(styled)) + ")";
    return `${base}/${overlay}/auto/${w}x${h}@2x?padding=30&access_token=${TOKEN}`;
  }
  if (center) return `${base}/${center.lng},${center.lat},17,0/${w}x${h}@2x?access_token=${TOKEN}`;
  return null;
}

// ---- DOM marker helpers (SVG only, never text glyphs) ----
function circleEl(d, fill, glyphSvg) {
  const circle = document.createElement("div");
  circle.style.cssText =
    `width:${d}px;height:${d}px;border-radius:50%;background:${fill};border:2px solid #fff;` +
    `box-sizing:border-box;display:grid;place-items:center;box-shadow:${MARKER_SHADOW};`;
  circle.innerHTML = glyphSvg;
  return circle;
}

// LiveMap marker. mk: { lng, lat, kind?: "truck", size?, pulse?, ring? }
function makeMarkerEl(mk) {
  const isTruck = mk.kind === "truck";
  const base = isTruck ? 30 : 28;
  const d = mk.size ? Math.max(16, Math.round((mk.size * base) / 28)) : base;
  const fill = isTruck ? TRUCK_FILL : C.plow;

  const wrap = document.createElement("div");
  wrap.style.cssText = `width:${d}px;height:${d}px;display:grid;place-items:center;pointer-events:none;`;

  if (mk.pulse) {
    const r = d + 14;
    const ring = document.createElement("div");
    ring.style.cssText =
      `position:absolute;left:50%;top:50%;width:${r}px;height:${r}px;margin:-${r / 2}px 0 0 -${r / 2}px;` +
      `border-radius:50%;border:2px solid ${mk.ring || fill};opacity:.7;box-sizing:border-box;`;
    wrap.appendChild(ring);
  }

  const g = Math.round(d * (isTruck ? 0.62 : 0.5));
  const glyph = isTruck
    ? `<svg width="${g}" height="${g}" viewBox="-1 1 24 24" fill="none" stroke="${TRUCK_INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M3 7h9v8H3zM12 10h4l3 3v2h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/></svg>`
    : `<svg width="${g}" height="${g}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.5" fill="#fff"/></svg>`;
  wrap.appendChild(circleEl(d, fill, glyph));
  return wrap;
}

function makeHazardEl() {
  const glyph =
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round">` +
    `<path d="M12 5.5v8"/><circle cx="12" cy="18.5" r="1.4" fill="#fff" stroke="none"/></svg>`;
  return circleEl(26, HAZARD_FILL, glyph);
}

// ============================================================
// LiveMap — read-only satellite map w/ markers + optional route
// ============================================================
export function LiveMap({ center, markers = [], route, height = 220, interactive = true }) {
  const el = useRef(null), mapRef = useRef(null), markerObjs = useRef([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!TOKEN || !el.current || mapRef.current) return;
    const c = center || DULUTH;
    const m = new mapboxgl.Map({ container: el.current, style: STYLE, center: [c.lng, c.lat],
      zoom: center ? 16.2 : 12, interactive, attributionControl: false, dragRotate: false, pitchWithRotate: false });
    mapRef.current = m;
    m.on("load", () => {
      m.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } } });
      m.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round" },
        paint: { "line-color": C.amber, "line-width": 3, "line-dasharray": [1.5, 1.2] } });
      setLoaded(true);
    });
    return () => { m.remove(); mapRef.current = null; markerObjs.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const m = mapRef.current; if (m && center) m.easeTo({ center: [center.lng, center.lat], duration: 600 }); }, [center?.lng, center?.lat]);
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    if (markerObjs.current.length !== markers.length) {
      markerObjs.current.forEach((o) => o.remove());
      markerObjs.current = markers.map((mk) => new mapboxgl.Marker({ element: makeMarkerEl(mk) }).setLngLat([mk.lng, mk.lat]).addTo(m));
    } else { markers.forEach((mk, i) => markerObjs.current[i].setLngLat([mk.lng, mk.lat])); }
  }, [markers]);
  useEffect(() => {
    const m = mapRef.current; if (!m || !loaded) return;
    const src = m.getSource("route"); if (src) src.setData({ type: "Feature", geometry: { type: "LineString", coordinates: route || [] } });
  }, [route, loaded]);
  if (!TOKEN) {
    const grid = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M28 0H0V28" fill="none" stroke="${C.mapGrid}" stroke-width="1"/></svg>`);
    return <div style={{ width: "100%", height, borderRadius: 16, border: `1px solid ${C.line}`,
      backgroundColor: C.mapBg, backgroundImage: `url("data:image/svg+xml,${grid}")`, backgroundSize: "28px 28px",
      display: "grid", placeItems: "center", font: `500 13px ${FB}`, color: C.mistDim }}>Map preview</div>;
  }
  return <div ref={el} style={{ width: "100%", height, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}` }} />;
}

function TokenMissing() {
  return (
    <div style={{ padding: "18px 20px", borderRadius: 14, background: C.slate, border: `1px solid ${C.line}`, color: C.mist, font: `400 13px/1.55 ${FB}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, font: `600 15px ${FB}`, color: C.ice, marginBottom: 6 }}>
        <Icon e="map" s={18} color={C.mist} /> Map needs a Mapbox token
      </div>
      Add <code style={{ background: C.night2, border: `1px solid ${C.lineSoft}`, padding: "1px 6px", borderRadius: 6, color: C.ice, fontSize: 12 }}>VITE_MAPBOX_TOKEN</code> in
      Vercel &gt; Settings &gt; Environment Variables, then redeploy.
    </div>
  );
}

const HAZARD_TYPES = ["Well", "Flower bed", "Rocks / edging", "Septic cover", "Steps", "Other"];

// ============================================================
// MapPropertyDesigner — starting outline + tap-to-outline
// ============================================================
export default function MapPropertyDesigner({ existing, onDone, onQuote, saveLabel = "Save property" }) {
  const el = useRef(null), mapRef = useRef(null), modeRef = useRef("idle"), hazMarkers = useRef([]), centerRef = useRef(existing?.center || null);
  const zonesRef = useRef([]), pendingRef = useRef(null), autoPlacedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("idle"); // idle | plow | push | hazard
  const [draft, setDraft] = useState([]);    // [[lng,lat],...] current shape
  const [pending, setPending] = useState(null); // { mode, coords } closed, awaiting Confirm
  const [autoPlaced, setAutoPlaced] = useState(false); // pending is our starting outline, not user-drawn
  const [zones, setZones] = useState([]);    // [{ mode, coords }]
  const [hazards, setHazards] = useState([]); // [{ lng, lat, label }]
  const [labelIdx, setLabelIdx] = useState(null); // hazard index awaiting a label
  const [address, setAddress] = useState(existing?.address || "");
  const [located, setLocated] = useState(!!existing?.center);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => { autoPlacedRef.current = autoPlaced; }, [autoPlaced]);

  // seed from an existing (editing) property
  useEffect(() => {
    if (!existing?.features?.length || zones.length || hazards.length) return;
    const zs = [], hz = [];
    existing.features.forEach((f) => {
      if (f.geometry?.type === "Polygon") zs.push({ mode: f.properties?.mode === "push" ? "push" : "plow", coords: ringToCoords(f.geometry.coordinates[0]) });
      else if (f.geometry?.type === "Point") hz.push({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: f.properties?.label || "" });
    });
    zonesRef.current = zs;
    setZones(zs); setHazards(hz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // init map + layers once
  useEffect(() => {
    if (!TOKEN || mapRef.current || !el.current) return;
    const c = existing?.center || DULUTH;
    const map = new mapboxgl.Map({ container: el.current, style: STYLE, center: [c.lng, c.lat],
      zoom: existing?.center ? 19 : 13, attributionControl: false, dragRotate: false, pitchWithRotate: false });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const geocoder = new MapboxGeocoder({ accessToken: TOKEN, mapboxgl, marker: false, countries: "us", types: "address", placeholder: "Type your home address…" });
    map.addControl(geocoder, "top-left");
    geocoder.on("result", (e) => {
      const g = e.result.center; centerRef.current = { lng: g[0], lat: g[1] };
      setAddress(e.result.place_name); setLocated(true);
      map.flyTo({ center: g, zoom: 19.4, speed: 1.5 });

      // Place a starting outline, unless the property already has plow areas
      // or the customer has a hand-drawn shape waiting to be confirmed.
      const hasPlowZone = zonesRef.current.some((z) => z.mode === "plow");
      const userPending = pendingRef.current && !autoPlacedRef.current;
      if (!hasPlowZone && !userPending) {
        setDraft([]); setMode("idle");
        setPending({ mode: "plow", coords: rectAround(g[0], g[1], START_W_FT, START_L_FT) });
        setAutoPlaced(true);
      }
    });

    map.on("click", (e) => {
      const m = modeRef.current;
      const pt = [e.lngLat.lng, e.lngLat.lat];
      if (m === "plow" || m === "push") setDraft((d) => [...d, pt]);
      else if (m === "hazard") {
        setHazards((h) => { setLabelIdx(h.length); return [...h, { lng: pt[0], lat: pt[1], label: "" }]; });
        setMode("idle");
      }
    });

    map.on("load", () => {
      map.addSource("work", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "zone-fill", type: "fill", source: "work", filter: ["==", ["get", "kind"], "zone"],
        paint: { "fill-color": ["case", ["==", ["get", "mode"], "push"], C.push, C.plow], "fill-opacity": 0.32 } });
      map.addLayer({ id: "pending-fill", type: "fill", source: "work", filter: ["==", ["get", "kind"], "pending"],
        paint: { "fill-color": C.amber, "fill-opacity": 0.38 } });
      map.addLayer({ id: "zone-line", type: "line", source: "work", filter: ["in", ["get", "kind"], ["literal", ["zone", "pending"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["case", ["==", ["get", "kind"], "pending"], C.amber, ["case", ["==", ["get", "mode"], "push"], C.push, C.plow]], "line-width": 3 } });
      map.addLayer({ id: "draft-line", type: "line", source: "work", filter: ["==", ["get", "kind"], "draftline"],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": C.amber, "line-width": 3, "line-dasharray": [1.5, 1] } });
      map.addLayer({ id: "verts", type: "circle", source: "work", filter: ["==", ["get", "kind"], "vert"],
        paint: { "circle-radius": 6, "circle-color": C.amber, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      setReady(true);
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sync the geojson (zones, pending, draft) to the map
  useEffect(() => {
    const m = mapRef.current; if (!m || !ready) return;
    const src = m.getSource("work"); if (!src) return;
    const feats = [];
    zones.forEach((z) => feats.push(polyFeature(z.coords, { kind: "zone", mode: z.mode })));
    if (pending) feats.push(polyFeature(pending.coords, { kind: "pending", mode: pending.mode }));
    if (draft.length >= 2) feats.push({ type: "Feature", properties: { kind: "draftline" }, geometry: { type: "LineString", coordinates: draft } });
    draft.forEach((p) => feats.push({ type: "Feature", properties: { kind: "vert" }, geometry: { type: "Point", coordinates: p } }));
    src.setData({ type: "FeatureCollection", features: feats });
  }, [zones, pending, draft, ready]);

  // hazard markers (DOM + inline SVG)
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    hazMarkers.current.forEach((o) => o.remove());
    hazMarkers.current = hazards.map((h) =>
      new mapboxgl.Marker({ element: makeHazardEl(), anchor: "center" }).setLngLat([h.lng, h.lat]).addTo(m));
  }, [hazards]);

  // area / price
  const plowCoords = [...zones.filter((z) => z.mode === "plow").map((z) => z.coords), ...(pending?.mode === "plow" ? [pending.coords] : [])];
  const sqft = Math.round(plowCoords.reduce((s, c) => s + (c.length >= 3 ? area(polyFeature(c)) : 0), 0) * SQM_TO_SQFT);
  const price = onQuote ? onQuote(sqft) : null;
  const hasPlow = sqft > 0;
  const plowCount = zones.filter((z) => z.mode === "plow").length + (pending?.mode === "plow" ? 1 : 0);
  const pushCount = zones.filter((z) => z.mode === "push").length + (pending?.mode === "push" ? 1 : 0);

  // actions
  const start = (m) => { if (!located) return; setDraft([]); setMode(m); };
  const closeShape = () => { if (draft.length < 3) return; setPending({ mode: mode, coords: draft }); setAutoPlaced(false); setDraft([]); setMode("idle"); };
  const confirmShape = () => { setZones((z) => [...z, pending]); setPending(null); setAutoPlaced(false); };
  const redoShape = () => { setPending(null); };
  const redrawStart = () => { setPending(null); setAutoPlaced(false); setDraft([]); setMode("plow"); };
  const cancelDraw = () => { setDraft([]); setMode("idle"); };
  const undoPoint = () => setDraft((d) => d.slice(0, -1));
  const removeLastZone = () => setZones((z) => z.slice(0, -1));
  const labelHazard = (lbl) => { setHazards((h) => h.map((x, i) => (i === labelIdx ? { ...x, label: lbl } : x))); setLabelIdx(null); };
  const removeHazard = (i) => setHazards((h) => h.filter((_, k) => k !== i));

  const done = () => {
    const zs = pending ? [...zones, pending] : zones;
    const features = [
      ...zs.map((z) => polyFeature(z.coords, { mode: z.mode })),
      ...hazards.map((h) => ({ type: "Feature", properties: { mode: "hazard", label: h.label || "Hazard" }, geometry: { type: "Point", coordinates: [h.lng, h.lat] } })),
    ];
    onDone({ address, center: centerRef.current, features, sqft, mapImg: staticMapUrl(features, centerRef.current) });
  };

  if (!TOKEN) return <TokenMissing />;

  // ---- button styles (flat fills, hairlines; read C at render time) ----
  const btn = (extra) => ({ flex: 1, minHeight: 52, borderRadius: 12, cursor: "pointer", border: "1px solid transparent",
    font: `600 15px ${FB}`, letterSpacing: "normal", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "0 14px", WebkitTapHighlightColor: "transparent", ...extra });
  const primary = (extra) => btn({ background: C.amber, color: C.onAmber, ...extra });
  const confirm = (extra) => btn({ background: C.push, color: C.onPush, ...extra });
  const secondary = (extra) => btn({ background: C.slate, color: C.ice, border: `1px solid ${C.line}`, ...extra });
  const dangerOutline = (extra) => btn({ background: "transparent", color: C.danger, border: `1px solid ${C.danger}73`, ...extra });
  const disabledBtn = (extra) => btn({ background: C.slate, color: C.mistDim, border: `1px solid ${C.line}`, cursor: "default", ...extra });
  const small = { minHeight: 44, font: `600 14px ${FB}` };

  const instruction =
    !located ? "Start by typing your address in the box on the map, then pick it from the list."
    : mode === "plow" ? "Tap each corner of your driveway. Then tap “Close shape”."
    : mode === "push" ? "Tap three or more points around where the snow should go. Then tap “Close shape”."
    : mode === "hazard" ? "Tap the map right on the hazard, like a well or flower bed."
    : pending && autoPlaced ? "We placed a starting outline for a typical driveway. If it's close, confirm it — or redraw it to match yours."
    : pending ? "Does this look right?"
    : zones.length ? "Add another area, or save when you're done."
    : "Tap a button below to start.";
  const active = mode !== "idle" || !!pending;

  return (
    <div>
      {/* plain-language how-to — always visible */}
      <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px", marginBottom: 12 }}>
        <div style={{ font: `600 14px ${FB}`, color: C.ice, marginBottom: 6 }}>How to map your driveway</div>
        <div style={{ font: `400 13px/1.6 ${FB}`, color: C.mist }}>
          1. Search your address above the map.<br />
          2. Check the outline we place — confirm it, or redraw it to fit.<br />
          3. Mark where the snow should go and anything the driver should avoid.
        </div>
      </div>

      {/* the map */}
      <div ref={el} style={{ width: "100%", height: 380, borderRadius: 14, overflow: "hidden", border: `1.5px solid ${mode !== "idle" ? C.amber : C.line}` }} />

      {/* big live instruction */}
      <div style={{ marginTop: 12, font: `600 15px/1.45 ${FB}`, color: active ? C.ice : C.mist, minHeight: 20 }}>{instruction}</div>

      {/* ---- controls: state machine ---- */}
      {labelIdx !== null ? (
        // labeling a just-dropped hazard
        <div style={{ marginTop: 10 }}>
          <div style={{ font: `600 13px ${FB}`, color: C.ice, marginBottom: 8 }}>What is it?</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {HAZARD_TYPES.map((t) => (
              <button key={t} onClick={() => labelHazard(t)}
                style={secondary({ flex: "0 0 auto", minHeight: 44, padding: "0 16px", font: `600 14px ${FB}` })}>{t}</button>
            ))}
          </div>
        </div>
      ) : pending && autoPlaced ? (
        // our starting outline — confirm or redraw
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button onClick={confirmShape} style={confirm()}><Icon e="check" s={18} strokeWidth={2.2} /> Looks right</button>
          <button onClick={redrawStart} style={secondary({ flex: "0 0 40%" })}><Icon e="edit" s={17} /> Redraw</button>
        </div>
      ) : pending ? (
        // confirm a customer-drawn shape
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button onClick={confirmShape} style={confirm()}><Icon e="check" s={18} strokeWidth={2.2} /> Confirm this area</button>
          <button onClick={redoShape} style={secondary({ flex: "0 0 40%" })}><Icon e="undo" s={17} /> Redo</button>
        </div>
      ) : mode === "plow" || mode === "push" ? (
        // actively drawing
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {draft.length >= 3 ? (
            <button onClick={closeShape} style={primary()}><Icon e="check" s={18} strokeWidth={2.2} /> Close shape</button>
          ) : (
            <button disabled style={disabledBtn()}>{`Tap ${3 - draft.length} more corner${3 - draft.length > 1 ? "s" : ""}`}</button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={undoPoint} disabled={!draft.length}
              style={draft.length ? secondary(small) : disabledBtn(small)}><Icon e="undo" s={16} /> Undo last tap</button>
            <button onClick={cancelDraw} style={dangerOutline(small)}><XMark s={14} /> Cancel</button>
          </div>
        </div>
      ) : mode === "hazard" ? (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setMode("idle")} style={secondary({ width: "100%" })}><XMark s={14} /> Cancel</button>
        </div>
      ) : (
        // idle — the three main actions
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => start("plow")} disabled={!located} style={located ? secondary() : disabledBtn()}>
              <Icon e="plowtruck" s={18} color={located ? C.plow : undefined} /> Draw driveway
            </button>
            <button onClick={() => start("push")} disabled={!located} style={located ? secondary() : disabledBtn()}>
              <Icon e="pin" s={18} color={located ? C.push : undefined} /> Snow goes here
            </button>
          </div>
          <button onClick={() => setMode("hazard")} disabled={!located} style={located ? secondary() : disabledBtn()}>
            <Icon e="cone" s={16} color={located ? C.danger : undefined} /> Mark a hazard
          </button>
          {zones.length > 0 && (
            <button onClick={removeLastZone} style={secondary({ ...small, color: C.mist })}><Icon e="undo" s={16} /> Remove last outline</button>
          )}
        </div>
      )}

      {/* hazards list */}
      {hazards.length > 0 && (
        <div style={{ marginTop: 12, background: C.slate, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: `600 13px ${FB}`, color: C.ice, marginBottom: 8 }}>
            <Icon e="cone" s={14} color={C.danger} /> Marked hazards
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {hazards.map((h, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 36,
                borderTop: i ? `1px solid ${C.lineSoft}` : "none", font: `500 14px ${FB}`, color: C.ice }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: HAZARD_FILL, flexShrink: 0 }} />
                  {h.label || "Hazard"}
                </span>
                <button onClick={() => removeHazard(i)} style={{ background: "transparent", border: "none", color: C.danger, cursor: "pointer",
                  font: `500 13px ${FB}`, padding: "8px 0 8px 12px" }}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* liability note */}
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start", font: `400 12px/1.5 ${FB}`, color: C.mistDim }}>
        <Icon e="warning" s={14} style={{ marginTop: 2 }} />
        <span>Mark wells, septic covers, flower beds and anything else fragile. If it isn't marked, the driver can't know it's there, and damage to unmarked items is not our responsibility.</span>
      </div>

      {/* measurement + price */}
      <div style={{ marginTop: 12, background: C.night2, border: `1px solid ${hasPlow ? C.amber : C.line}`, borderRadius: 14,
        padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ font: `400 12px ${FB}`, color: C.mist, marginBottom: 3 }}>
            {plowCount} plow · {pushCount} push · {hazards.length} hazard{hazards.length !== 1 ? "s" : ""}{hasPlow ? ` · ${sqft.toLocaleString()} sq ft` : ""}</div>
          <div style={{ font: `600 15px ${FB}`, color: C.ice }}>{hasPlow ? "Your price per plow" : "Outline a plow area to see the price"}</div>
        </div>
        <div style={{ font: `700 30px ${FD}`, color: hasPlow ? C.amber : C.mistDim, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {hasPlow && price != null ? `$${price}` : "—"}
        </div>
      </div>

      <button onClick={done} disabled={!hasPlow || !!pending}
        style={(hasPlow && !pending ? primary : disabledBtn)({ width: "100%", marginTop: 12, minHeight: 54, font: `600 16px ${FB}` })}>
        {pending ? "Confirm the area above first" : hasPlow ? (price != null ? `${saveLabel} · $${price} per plow` : saveLabel) : "Outline a plow area first"}
      </button>
    </div>
  );
}
