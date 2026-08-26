// ============================================================
// Mapbox map components for DRIFT
//   • MapPropertyDesigner — tap-to-outline the driveway on satellite,
//     with a plain-language how-to, a Confirm step, and a drop-a-hazard
//     tool. Built to be usable by non-technical / older customers.
//   • LiveMap — read-only satellite map with markers + route line.
// Needs VITE_MAPBOX_TOKEN.
// ============================================================
import React, { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import area from "@turf/area";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
if (TOKEN) mapboxgl.accessToken = TOKEN;
export const MAP_ENABLED = !!TOKEN;

const C = {
  plow: "#3DCBFF", push: "#6EEE9B", amber: "#FFB020", amberSoft: "#FFC759",
  ice: "#F2F7FC", mist: "#A3BAD1", mistDim: "#6B819A",
  night: "#08121F", night2: "#0E1E31", slate: "#152A42", slate2: "#1B334E", line: "#24435F", danger: "#FF6B6B",
};
const FB = "'Inter',system-ui,sans-serif";
const FD = "'Oswald','Arial Narrow',sans-serif";
const SQM_TO_SQFT = 10.7639;
const STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const DULUTH = { lng: -92.0905, lat: 46.79 };

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

// ---- Static Images URL of an outline (thumbnails + driver view) ----
export function staticMapUrl(features, center, w = 320, h = 190) {
  if (!TOKEN) return null;
  const base = "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static";
  if (features && features.length) {
    const styled = {
      type: "FeatureCollection",
      features: features.map((f) => {
        if (f.geometry?.type === "Point") {
          return { type: "Feature", geometry: f.geometry, properties: { "marker-color": "#FF6B6B", "marker-symbol": "danger", "marker-size": "small" } };
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

// ---- shared marker element (LiveMap) ----
function makeMarkerEl(mk) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:grid;place-items:center;pointer-events:none;";
  if (mk.pulse) {
    const ring = document.createElement("div");
    ring.style.cssText = `position:absolute;width:${(mk.size || 22) + 14}px;height:${(mk.size || 22) + 14}px;border-radius:50%;border:2px solid ${mk.ring || C.amber};opacity:.7;`;
    wrap.appendChild(ring);
  }
  const chip = document.createElement("div");
  chip.textContent = mk.emoji || "📍";
  chip.style.cssText = `font-size:${mk.size || 22}px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));`;
  wrap.appendChild(chip);
  return wrap;
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
    return <div style={{ width: "100%", height, borderRadius: 16, border: `1px solid ${C.line}`,
      background: `radial-gradient(120% 90% at 50% -10%, #12253C 0%, ${C.night} 70%)`,
      display: "grid", placeItems: "center", font: `600 12px ${FB}`, color: C.mistDim }}>map preview</div>;
  }
  return <div ref={el} style={{ width: "100%", height, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}` }} />;
}

function TokenMissing() {
  return (
    <div style={{ padding: 20, borderRadius: 14, background: C.night2, border: `1px solid ${C.danger}55`, color: C.mist, font: `500 13px/1.6 ${FB}` }}>
      <div style={{ font: `700 15px ${FB}`, color: C.ice, marginBottom: 8 }}>🗺️ Map needs a Mapbox token</div>
      Add <code style={{ background: C.slate, padding: "2px 6px", borderRadius: 6, color: C.amber }}>VITE_MAPBOX_TOKEN</code> in Vercel → Settings → Environment Variables, then redeploy.
    </div>
  );
}

const HAZARD_TYPES = ["Well", "Flower bed", "Rocks / edging", "Septic cover", "Steps", "Other"];

// ============================================================
// MapPropertyDesigner — tap-to-outline
// ============================================================
export default function MapPropertyDesigner({ existing, onDone, onQuote, saveLabel = "Save property" }) {
  const el = useRef(null), mapRef = useRef(null), modeRef = useRef("idle"), hazMarkers = useRef([]), centerRef = useRef(existing?.center || null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("idle"); // idle | plow | push | hazard
  const [draft, setDraft] = useState([]);    // [[lng,lat],...] current shape
  const [pending, setPending] = useState(null); // { mode, coords } closed, awaiting Confirm
  const [zones, setZones] = useState([]);    // [{ mode, coords }]
  const [hazards, setHazards] = useState([]); // [{ lng, lat, label }]
  const [labelIdx, setLabelIdx] = useState(null); // hazard index awaiting a label
  const [address, setAddress] = useState(existing?.address || "");
  const [located, setLocated] = useState(!!existing?.center);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  // seed from an existing (editing) property
  useEffect(() => {
    if (!existing?.features?.length || zones.length || hazards.length) return;
    const zs = [], hz = [];
    existing.features.forEach((f) => {
      if (f.geometry?.type === "Polygon") zs.push({ mode: f.properties?.mode === "push" ? "push" : "plow", coords: ringToCoords(f.geometry.coordinates[0]) });
      else if (f.geometry?.type === "Point") hz.push({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: f.properties?.label || "" });
    });
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

  // hazard markers (HTML, so the 🚧 renders reliably)
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    hazMarkers.current.forEach((o) => o.remove());
    hazMarkers.current = hazards.map((h) => {
      const d = document.createElement("div");
      d.textContent = "🚧"; d.style.cssText = "font-size:26px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));";
      return new mapboxgl.Marker({ element: d, anchor: "bottom" }).setLngLat([h.lng, h.lat]).addTo(m);
    });
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
  const closeShape = () => { if (draft.length < 3) return; setPending({ mode: mode, coords: draft }); setDraft([]); setMode("idle"); };
  const confirmShape = () => { setZones((z) => [...z, pending]); setPending(null); };
  const redoShape = () => { setPending(null); };
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

  const bigBtn = (bg, fg, border) => ({ flex: 1, minHeight: 54, borderRadius: 13, cursor: "pointer", border: border || "none",
    background: bg, color: fg, font: `700 15px ${FB}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, WebkitTapHighlightColor: "transparent" });

  const instruction =
    !located ? "① Type your address in the box on the map, then pick it from the list."
    : mode === "plow" ? "Tap each corner of the area to plow. Then tap “Close shape”."
    : mode === "push" ? "Tap the spot where snow should be pushed. Then tap “Close shape”."
    : mode === "hazard" ? "Tap the map right on the hazard (like a well or flower bed)."
    : pending ? "Does this look right?"
    : "Tap a button below to start outlining.";

  return (
    <div>
      {/* plain-language how-to — always visible */}
      <div style={{ background: C.night2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px", marginBottom: 12 }}>
        <div style={{ font: `700 13px ${FB}`, color: C.ice, marginBottom: 6 }}>How to map your driveway</div>
        <div style={{ font: `500 12.5px/1.6 ${FB}`, color: C.mist }}>
          1. Search your address above the map.<br />
          2. Tap <b style={{ color: C.plow }}>Outline plow area</b>, then tap each corner of your driveway.<br />
          3. Tap <b style={{ color: C.amber }}>Close shape</b>, then <b style={{ color: C.push }}>Confirm</b>.<br />
          4. Mark anything the driver should avoid with <b style={{ color: C.danger }}>🚧 Mark a hazard</b>.
        </div>
      </div>

      {/* the map */}
      <div ref={el} style={{ width: "100%", height: 380, borderRadius: 14, overflow: "hidden", border: `1.5px solid ${mode !== "idle" ? C.amber : C.line}` }} />

      {/* big live instruction */}
      <div style={{ marginTop: 12, font: `700 14px ${FB}`, color: mode !== "idle" || pending ? C.amber : C.mist, minHeight: 20 }}>{instruction}</div>

      {/* ---- controls: state machine ---- */}
      {/* labeling a just-dropped hazard */}
      {labelIdx !== null ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ font: `600 13px ${FB}`, color: C.ice, marginBottom: 8 }}>What is it?</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {HAZARD_TYPES.map((t) => (
              <button key={t} onClick={() => labelHazard(t)} style={{ cursor: "pointer", padding: "12px 16px", borderRadius: 12,
                background: C.slate, border: `1.5px solid ${C.line}`, color: C.ice, font: `700 14px ${FB}` }}>{t}</button>
            ))}
          </div>
        </div>
      ) : pending ? (
        // confirm the closed shape
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button onClick={confirmShape} style={bigBtn(`linear-gradient(180deg, #8BF5AE, ${C.push})`, "#07240F")}>✓ Confirm this area</button>
          <button onClick={redoShape} style={{ ...bigBtn(C.slate, C.ice, `1px solid ${C.line}`), flex: "0 0 40%" }}>↺ Redo</button>
        </div>
      ) : mode === "plow" || mode === "push" ? (
        // actively drawing
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <button onClick={closeShape} disabled={draft.length < 3}
            style={bigBtn(draft.length >= 3 ? `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})` : C.slate, draft.length >= 3 ? "#231603" : C.mistDim)}>
            {draft.length < 3 ? `Tap ${3 - draft.length} more corner${3 - draft.length > 1 ? "s" : ""}` : "✓ Close shape"}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={undoPoint} disabled={!draft.length} style={{ ...bigBtn(C.slate, C.mist, `1px solid ${C.line}`), minHeight: 46, font: `600 14px ${FB}` }}>↶ Undo last tap</button>
            <button onClick={cancelDraw} style={{ ...bigBtn(C.slate, C.danger, `1px solid ${C.danger}44`), minHeight: 46, font: `600 14px ${FB}` }}>✕ Cancel</button>
          </div>
        </div>
      ) : mode === "hazard" ? (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setMode("idle")} style={bigBtn(C.slate, C.mist, `1px solid ${C.line}`)}>✕ Cancel</button>
        </div>
      ) : (
        // idle — the three main actions
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => start("plow")} disabled={!located}
              style={bigBtn(located ? C.plow + "22" : C.slate, located ? C.plow : C.mistDim, `1.5px solid ${located ? C.plow : C.line}`)}>🚜 Outline plow area</button>
            <button onClick={() => start("push")} disabled={!located}
              style={bigBtn(located ? C.push + "22" : C.slate, located ? C.push : C.mistDim, `1.5px solid ${located ? C.push : C.line}`)}>❄️ Push-to area</button>
          </div>
          <button onClick={() => setMode("hazard")} disabled={!located}
            style={bigBtn(located ? C.danger + "18" : C.slate, located ? C.danger : C.mistDim, `1.5px solid ${located ? C.danger + "77" : C.line}`)}>🚧 Mark a hazard</button>
          {(zones.length > 0) && (
            <button onClick={removeLastZone} style={{ ...bigBtn(C.slate, C.mist, `1px solid ${C.line}`), minHeight: 44, font: `600 13px ${FB}` }}>↶ Remove last outline</button>
          )}
        </div>
      )}

      {/* hazards list + liability note */}
      {hazards.length > 0 && (
        <div style={{ marginTop: 12, background: C.danger + "12", border: `1px solid ${C.danger}44`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ font: `700 12px ${FB}`, color: C.danger, letterSpacing: ".04em", marginBottom: 8 }}>🚧 MARKED HAZARDS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {hazards.map((h, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", font: `600 13px ${FB}`, color: C.ice }}>
                <span>🚧 {h.label || "Hazard"}</span>
                <button onClick={() => removeHazard(i)} style={{ background: "transparent", border: "none", color: C.mist, cursor: "pointer", font: `600 12px ${FB}` }}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 10, font: `500 11.5px/1.5 ${FB}`, color: C.mistDim }}>
        ⚠️ Mark wells, septic covers, flower beds — anything fragile. If it isn't marked, the driver can't know it's there, and damage to unmarked items is not our responsibility.
      </div>

      {/* measurement + price */}
      <div style={{ marginTop: 12, background: C.night2, border: `1px solid ${hasPlow ? C.amber : C.line}`, borderRadius: 14,
        padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginBottom: 3 }}>
            {plowCount} plow · {pushCount} push · {hazards.length} hazard{hazards.length !== 1 ? "s" : ""}{hasPlow ? ` · ${sqft.toLocaleString()} sq ft` : ""}</div>
          <div style={{ font: `700 15px ${FB}`, color: C.ice }}>{hasPlow ? "Your price per plow" : "Outline a plow area to see the price"}</div>
        </div>
        <div style={{ font: `700 30px ${FD}`, color: hasPlow ? C.amber : C.mistDim, lineHeight: 1 }}>{hasPlow && price != null ? `$${price}` : "—"}</div>
      </div>

      <button onClick={done} disabled={!hasPlow || !!pending}
        style={{ ...bigBtn(hasPlow && !pending ? `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})` : C.slate, hasPlow && !pending ? "#231603" : C.mistDim),
          width: "100%", marginTop: 12, minHeight: 54, font: `700 16px ${FB}`, boxShadow: hasPlow && !pending ? "0 6px 20px rgba(255,176,32,.28)" : "none" }}>
        {pending ? "Confirm the area above first" : hasPlow ? (price != null ? `${saveLabel} · $${price} per plow` : saveLabel) : "Outline a plow area first"}
      </button>
    </div>
  );
}
