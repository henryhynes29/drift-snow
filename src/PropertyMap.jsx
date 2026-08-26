// ============================================================
// Mapbox map components for DRIFT
//   • MapPropertyDesigner — search address, draw plow/push zones on
//     satellite, auto-measure square footage (drives pricing).
//   • LiveMap — read-only satellite map with markers + route line,
//     used everywhere the old stylized map used to be.
//
// Needs a Mapbox public token in env var VITE_MAPBOX_TOKEN.
// ============================================================
import React, { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import area from "@turf/area";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
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

// color polygons by their user-set `mode` property
const byMode = ["case", ["==", ["get", "user_mode"], "push"], C.push, C.plow];
const drawStyles = [
  { id: "df-fill", type: "fill", filter: ["all", ["==", "$type", "Polygon"]],
    paint: { "fill-color": byMode, "fill-opacity": 0.32 } },
  { id: "df-stroke", type: "line", filter: ["all", ["==", "$type", "Polygon"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": byMode, "line-width": 2.5 } },
  { id: "df-vhalo", type: "circle", filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
    paint: { "circle-radius": 6, "circle-color": "#ffffff" } },
  { id: "df-vertex", type: "circle", filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
    paint: { "circle-radius": 4, "circle-color": byMode } },
  { id: "df-midpoint", type: "circle", filter: ["all", ["==", "meta", "midpoint"], ["==", "$type", "Point"]],
    paint: { "circle-radius": 3, "circle-color": C.amber } },
];

// Static Images URL of an outline — used for thumbnails / driver view.
export function staticMapUrl(features, center, w = 320, h = 190) {
  if (!TOKEN) return null;
  const base = "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static";
  if (features && features.length) {
    const styled = {
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature", geometry: f.geometry,
        properties: {
          fill: f.properties?.mode === "push" ? C.push : C.plow, "fill-opacity": 0.35,
          stroke: f.properties?.mode === "push" ? C.push : C.plow, "stroke-width": 2,
        },
      })),
    };
    const overlay = "geojson(" + encodeURIComponent(JSON.stringify(styled)) + ")";
    return `${base}/${overlay}/auto/${w}x${h}@2x?padding=30&access_token=${TOKEN}`;
  }
  if (center) return `${base}/${center.lng},${center.lat},17,0/${w}x${h}@2x?access_token=${TOKEN}`;
  return null;
}

// ---- shared marker element -------------------------------------------------
function makeMarkerEl(mk) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:grid;place-items:center;pointer-events:none;";
  if (mk.pulse) {
    const ring = document.createElement("div");
    ring.style.cssText =
      `position:absolute;width:${(mk.size || 22) + 14}px;height:${(mk.size || 22) + 14}px;border-radius:50%;` +
      `border:2px solid ${mk.ring || C.amber};opacity:.7;`;
    wrap.appendChild(ring);
  }
  const chip = document.createElement("div");
  chip.textContent = mk.emoji || "📍";
  chip.style.cssText =
    `font-size:${mk.size || 22}px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));`;
  wrap.appendChild(chip);
  return wrap;
}

// ============================================================
// LiveMap — read-only satellite map w/ markers + optional route
// ============================================================
export function LiveMap({ center, markers = [], route, height = 220, interactive = true }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const markerObjs = useRef([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!TOKEN || !el.current || mapRef.current) return;
    const c = center || DULUTH;
    const m = new mapboxgl.Map({
      container: el.current, style: STYLE, center: [c.lng, c.lat],
      zoom: center ? 16.2 : 12, interactive, attributionControl: false,
      dragRotate: false, pitchWithRotate: false,
    });
    mapRef.current = m;
    m.on("load", () => {
      m.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } } });
      m.addLayer({ id: "route", type: "line", source: "route",
        layout: { "line-cap": "round" }, paint: { "line-color": C.amber, "line-width": 3, "line-dasharray": [1.5, 1.2] } });
      setLoaded(true);
    });
    return () => { m.remove(); mapRef.current = null; markerObjs.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the map centered as the target moves
  useEffect(() => {
    const m = mapRef.current;
    if (m && center) m.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center?.lng, center?.lat]);

  // markers (update in place when the count matches, else rebuild)
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (markerObjs.current.length !== markers.length) {
      markerObjs.current.forEach((o) => o.remove());
      markerObjs.current = markers.map((mk) =>
        new mapboxgl.Marker({ element: makeMarkerEl(mk) }).setLngLat([mk.lng, mk.lat]).addTo(m));
    } else {
      markers.forEach((mk, i) => markerObjs.current[i].setLngLat([mk.lng, mk.lat]));
    }
  }, [markers]);

  // route line
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !loaded) return;
    const src = m.getSource("route");
    if (src) src.setData({ type: "Feature", geometry: { type: "LineString", coordinates: route || [] } });
  }, [route, loaded]);

  if (!TOKEN) {
    return (
      <div style={{ width: "100%", height, borderRadius: 16, border: `1px solid ${C.line}`,
        background: `radial-gradient(120% 90% at 50% -10%, #12253C 0%, ${C.night} 70%)`,
        display: "grid", placeItems: "center", font: `600 12px ${FB}`, color: C.mistDim }}>
        map preview
      </div>
    );
  }
  return <div ref={el} style={{ width: "100%", height, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}` }} />;
}

// ============================================================
// Token-missing helper
// ============================================================
function TokenMissing() {
  return (
    <div style={{ padding: 20, borderRadius: 14, background: C.night2, border: `1px solid ${C.danger}55`,
      color: C.mist, font: `500 13px/1.6 ${FB}` }}>
      <div style={{ font: `700 15px ${FB}`, color: C.ice, marginBottom: 8 }}>🗺️ Map needs a Mapbox token</div>
      Add your free Mapbox public token as{" "}
      <code style={{ background: C.slate, padding: "2px 6px", borderRadius: 6, color: C.amber }}>VITE_MAPBOX_TOKEN</code>{" "}
      in Vercel → Settings → Environment Variables, then redeploy.
    </div>
  );
}

// ============================================================
// MapPropertyDesigner — redesigned outliner
// ============================================================
export default function MapPropertyDesigner({ existing, onDone, onQuote, saveLabel = "Save property" }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const modeRef = useRef("plow");
  const idsRef = useRef([]);            // stack of feature ids in draw order
  const centerRef = useRef(existing?.center || null);

  const [drawing, setDrawing] = useState(false);
  const [activeMode, setActiveMode] = useState(null); // which mode is currently being drawn
  const [sqft, setSqft] = useState(existing?.sqft || 0);
  const [plowCount, setPlowCount] = useState(0);
  const [pushCount, setPushCount] = useState(0);
  const [address, setAddress] = useState(existing?.address || "");
  const [located, setLocated] = useState(!!existing?.center);

  const recompute = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const fc = draw.getAll();
    let m2 = 0, plows = 0, pushes = 0;
    fc.features.forEach((f) => {
      const mode = f.properties?.user_mode || f.properties?.mode;
      if (mode === "push") pushes += 1;
      else { plows += 1; m2 += area(f); }
    });
    setSqft(Math.round(m2 * SQM_TO_SQFT));
    setPlowCount(plows);
    setPushCount(pushes);
  }, []);

  useEffect(() => {
    if (!TOKEN || mapRef.current || !el.current) return;
    const c = existing?.center || DULUTH;
    const map = new mapboxgl.Map({
      container: el.current, style: STYLE, center: [c.lng, c.lat],
      zoom: existing?.center ? 19 : 13.5, attributionControl: false, dragRotate: false, pitchWithRotate: false,
    });
    mapRef.current = map;

    const draw = new MapboxDraw({ displayControlsDefault: false, styles: drawStyles, userProperties: true });
    drawRef.current = draw;
    map.addControl(draw);

    const geocoder = new MapboxGeocoder({
      accessToken: TOKEN, mapboxgl, marker: false, countries: "us", types: "address",
      placeholder: "Search your address…",
    });
    map.addControl(geocoder, "top-left");
    geocoder.on("result", (e) => {
      const g = e.result.center;
      centerRef.current = { lng: g[0], lat: g[1] };
      setAddress(e.result.place_name);
      setLocated(true);
      map.flyTo({ center: g, zoom: 19.3, speed: 1.5 });
    });

    map.on("draw.create", (e) => {
      const id = e.features?.[0]?.id;
      if (id) { draw.setFeatureProperty(id, "mode", modeRef.current); idsRef.current.push(id); }
      recompute();
    });
    map.on("draw.delete", recompute);
    map.on("draw.modechange", (e) => {
      const drawingNow = e.mode === "draw_polygon";
      setDrawing(drawingNow);
      if (!drawingNow) setActiveMode(null);
    });

    map.on("load", () => {
      if (existing?.features?.length) {
        existing.features.forEach((f) => {
          const ids = draw.add(f);
          const fid = Array.isArray(ids) ? ids[0] : ids;
          if (fid) { draw.setFeatureProperty(fid, "mode", f.properties?.mode || "plow"); idsRef.current.push(fid); }
        });
        recompute();
      }
    });

    return () => { map.remove(); mapRef.current = null; drawRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDraw = (mode) => {
    if (!located) return;
    modeRef.current = mode;
    setActiveMode(mode);
    drawRef.current?.changeMode("draw_polygon");
  };
  const cancelDraw = () => { drawRef.current?.changeMode("simple_select"); recompute(); };
  const undoLast = () => {
    const id = idsRef.current.pop();
    if (id) drawRef.current?.delete(id);
    recompute();
  };
  const clearAll = () => { drawRef.current?.deleteAll(); idsRef.current = []; recompute(); };

  const price = onQuote ? onQuote(sqft) : null;
  const hasPlow = sqft > 0;
  const hasAny = plowCount + pushCount > 0;

  const done = () => {
    const draw = drawRef.current;
    const fc = draw ? draw.getAll() : { features: [] };
    const features = fc.features.map((f) => ({
      type: "Feature", geometry: f.geometry,
      properties: { mode: f.properties?.user_mode || f.properties?.mode || "plow" },
    }));
    onDone({ address, center: centerRef.current, features, sqft, mapImg: staticMapUrl(features, centerRef.current) });
  };

  if (!TOKEN) return <TokenMissing />;

  const bigBtn = (bg, fg, border) => ({
    flex: 1, minHeight: 50, borderRadius: 13, cursor: "pointer", border: border || "none",
    background: bg, color: fg, font: `700 14px ${FB}`, display: "flex", alignItems: "center",
    justifyContent: "center", gap: 8, WebkitTapHighlightColor: "transparent",
  });

  return (
    <div>
      {/* the map (only control on it is the address search, top-left) */}
      <div ref={el} style={{ width: "100%", height: 380, borderRadius: 14, overflow: "hidden", border: `1px solid ${C.line}` }} />

      {/* clear one-line guidance */}
      <div style={{ marginTop: 10, font: `600 12px ${FB}`, color: drawing ? C.amber : C.mist, minHeight: 18 }}>
        {!located ? "① Search your address in the box on the map."
          : drawing ? `Drawing ${activeMode === "push" ? "a push zone" : "a plow area"} — tap each corner, then tap the first dot to finish.`
          : hasAny ? "Add another area, or save below."
          : "② Tap “Add plow area”, then outline it on the map."}
      </div>

      {/* draw controls (below the map — nothing overlaps) */}
      {drawing ? (
        <div style={{ marginTop: 10 }}>
          <button onClick={cancelDraw} style={bigBtn(C.slate, C.ice, `1px solid ${C.line}`)}>✕ Cancel this shape</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => startDraw("plow")} disabled={!located}
              style={bigBtn(located ? C.plow + "22" : C.slate, located ? C.plow : C.mistDim, `1.5px solid ${located ? C.plow : C.line}`)}>
              🚜 Add plow area</button>
            <button onClick={() => startDraw("push")} disabled={!located}
              style={bigBtn(located ? C.push + "22" : C.slate, located ? C.push : C.mistDim, `1.5px solid ${located ? C.push : C.line}`)}>
              ❄️ Add push area</button>
          </div>
          {hasAny && (
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={undoLast} style={{ ...bigBtn(C.slate, C.mist, `1px solid ${C.line}`), minHeight: 40, font: `600 13px ${FB}` }}>↶ Undo last</button>
              <button onClick={clearAll} style={{ ...bigBtn(C.slate, C.danger, `1px solid ${C.danger}44`), minHeight: 40, font: `600 13px ${FB}` }}>Clear all</button>
            </div>
          )}
        </>
      )}

      {/* measurement + price readout (own row, never overlapping the map) */}
      <div style={{ marginTop: 12, background: C.night2, border: `1px solid ${hasPlow ? C.amber : C.line}`,
        borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ font: `500 11px ${FB}`, color: C.mist, marginBottom: 3 }}>
            {plowCount} plow · {pushCount} push {hasPlow ? `· ${sqft.toLocaleString()} sq ft measured` : ""}</div>
          <div style={{ font: `700 15px ${FB}`, color: C.ice }}>{hasPlow ? "Your price per plow" : "Outline a plow area to price it"}</div>
        </div>
        <div style={{ font: `700 30px ${FD}`, color: hasPlow ? C.amber : C.mistDim, lineHeight: 1 }}>
          {hasPlow && price != null ? `$${price}` : "—"}</div>
      </div>

      <button onClick={done} disabled={!hasPlow} style={{ ...bigBtn(
        hasPlow ? `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})` : C.slate,
        hasPlow ? "#231603" : C.mistDim), width: "100%", marginTop: 12, minHeight: 52, font: `700 16px ${FB}`,
        boxShadow: hasPlow ? "0 6px 20px rgba(255,176,32,.28)" : "none" }}>
        {hasPlow ? (price != null ? `${saveLabel} · $${price} per plow` : saveLabel) : "Outline a plow area first"}
      </button>
    </div>
  );
}
