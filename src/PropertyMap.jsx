// ============================================================
// MapPropertyDesigner — real satellite property outliner (Mapbox)
// ------------------------------------------------------------
// Search an address -> map flies to the house on satellite -> draw
// PLOW and PUSH zones -> we measure the real square footage of the
// plow area (turf) and hand it back so pricing is automatic.
//
// Needs a Mapbox public token in the env var VITE_MAPBOX_TOKEN.
// (Vercel: Project Settings -> Environment Variables. Local: a .env file.)
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

// brand tokens (kept small + in sync with App.jsx)
const C = {
  plow: "#3DCBFF", push: "#6EEE9B", amber: "#FFB020", amberSoft: "#FFC759",
  ice: "#F2F7FC", mist: "#A3BAD1", mistDim: "#6B819A",
  night: "#08121F", night2: "#0E1E31", slate: "#152A42", line: "#24435F", danger: "#FF6B6B",
};
const FB = "'Inter',system-ui,sans-serif";
const FD = "'Oswald','Arial Narrow',sans-serif";

const SQM_TO_SQFT = 10.7639;
const DULUTH = { lng: -92.0905, lat: 46.79, zoom: 14 };

// Draw layer styling — color each polygon by its user-set `mode` property.
// (mapbox-gl-draw with userProperties:true exposes user props as `user_*`.)
const byMode = ["case", ["==", ["get", "user_mode"], "push"], C.push, C.plow];
const drawStyles = [
  { id: "df-fill", type: "fill", filter: ["all", ["==", "$type", "Polygon"]],
    paint: { "fill-color": byMode, "fill-opacity": 0.3 } },
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

// Build a Mapbox Static Images URL of the outline, for thumbnails elsewhere.
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

function TokenMissing() {
  return (
    <div style={{ padding: 20, borderRadius: 14, background: C.night2, border: `1px solid ${C.danger}55`,
      color: C.mist, font: `500 13px/1.6 ${FB}` }}>
      <div style={{ font: `700 15px ${FB}`, color: C.ice, marginBottom: 8 }}>🗺️ Map needs a Mapbox token</div>
      Add your free Mapbox public token as the environment variable{" "}
      <code style={{ background: C.slate, padding: "2px 6px", borderRadius: 6, color: C.amber }}>VITE_MAPBOX_TOKEN</code>{" "}
      in Vercel (Project → Settings → Environment Variables), then redeploy. Locally, put it in a{" "}
      <code style={{ background: C.slate, padding: "2px 6px", borderRadius: 6, color: C.amber }}>.env</code> file.
    </div>
  );
}

export default function MapPropertyDesigner({ existing, onDone, onQuote, saveLabel = "Save property" }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const modeRef = useRef("plow");
  const centerRef = useRef(existing?.center || null);

  const [mode, setMode] = useState("plow");
  const [sqft, setSqft] = useState(existing?.sqft || 0);
  const [pushCount, setPushCount] = useState(0);
  const [address, setAddress] = useState(existing?.address || "");
  const [located, setLocated] = useState(!!existing?.center);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  const recompute = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const fc = draw.getAll();
    let plowM2 = 0, pushes = 0;
    fc.features.forEach((f) => {
      const m = f.properties?.user_mode || f.properties?.mode;
      if (m === "push") pushes += 1;
      else plowM2 += area(f);
    });
    setSqft(Math.round(plowM2 * SQM_TO_SQFT));
    setPushCount(pushes);
  }, []);

  useEffect(() => {
    if (!TOKEN || mapRef.current || !mapEl.current) return;

    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: existing?.center ? [existing.center.lng, existing.center.lat] : [DULUTH.lng, DULUTH.lat],
      zoom: existing?.center ? 19 : DULUTH.zoom,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      styles: drawStyles,
      userProperties: true,
    });
    drawRef.current = draw;
    map.addControl(draw, "top-right");

    const geocoder = new MapboxGeocoder({
      accessToken: TOKEN, mapboxgl, marker: false, countries: "us",
      types: "address", placeholder: "Search your address…", collapsed: false,
    });
    map.addControl(geocoder, "top-left");
    geocoder.on("result", (e) => {
      const c = e.result.center;
      centerRef.current = { lng: c[0], lat: c[1] };
      setAddress(e.result.place_name);
      setLocated(true);
      map.flyTo({ center: c, zoom: 19.2, speed: 1.4 });
    });

    const onCreate = (e) => {
      const id = e.features?.[0]?.id;
      if (id) draw.setFeatureProperty(id, "mode", modeRef.current);
      recompute();
    };
    map.on("draw.create", onCreate);
    map.on("draw.update", recompute);
    map.on("draw.delete", recompute);

    map.on("load", () => {
      if (existing?.features?.length) {
        existing.features.forEach((f) => {
          const [fid] = draw.add(f);
          if (fid && f.properties?.mode) draw.setFeatureProperty(fid, "mode", f.properties.mode);
        });
        recompute();
      }
    });

    return () => { map.remove(); mapRef.current = null; drawRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const price = onQuote ? onQuote(sqft) : null;

  const done = () => {
    const draw = drawRef.current;
    const fc = draw ? draw.getAll() : { features: [] };
    const features = fc.features.map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: { mode: f.properties?.user_mode || f.properties?.mode || "plow" },
    }));
    const center = centerRef.current;
    onDone({
      address,
      center,
      features,
      sqft,
      mapImg: staticMapUrl(features, center),
    });
  };

  if (!TOKEN) return <TokenMissing />;

  const hasPlow = sqft > 0;

  return (
    <div>
      {/* mode toggle + legend */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {[["plow", "🚜 Plow here", C.plow], ["push", "❄️ Push snow here", C.push]].map(([id, label, col]) => {
          const on = mode === id;
          return (
            <button key={id} onClick={() => setMode(id)} style={{ flex: 1, cursor: "pointer", padding: "11px 8px",
              borderRadius: 12, background: on ? col + "22" : C.slate, border: `1.5px solid ${on ? col : C.line}`,
              color: on ? col : C.mist, font: `700 12px ${FB}`, transition: "all .15s" }}>{label}</button>
          );
        })}
      </div>

      <div style={{ font: `500 11px ${FB}`, color: C.mist, marginBottom: 8, minHeight: 16 }}>
        {!located ? "1. Search your address above the map." :
          `2. Tap the ▱ tool (top-right), click each corner of the ${mode === "plow" ? "area to plow" : "spot to push snow"}, then click the first point to close it.`}
      </div>

      {/* the map */}
      <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: `1px solid ${C.line}` }}>
        <div ref={mapEl} style={{ width: "100%", height: 360 }} />

        {/* live price / size chip */}
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2, background: "rgba(10,22,38,.86)",
          backdropFilter: "blur(6px)", border: `1px solid ${hasPlow ? C.amber : C.line}`, borderRadius: 12,
          padding: "8px 12px", textAlign: "right" }}>
          <div style={{ font: `700 22px ${FD}`, color: hasPlow ? C.amber : C.mistDim, lineHeight: 1 }}>
            {hasPlow && price != null ? `$${price}` : "—"}</div>
          <div style={{ font: `600 10px ${FB}`, color: C.mist, marginTop: 3 }}>
            {hasPlow ? `${sqft.toLocaleString()} sq ft measured` : "outline to price"}</div>
        </div>
      </div>

      {/* status chips */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ font: `700 10px ${FB}`, letterSpacing: ".06em", textTransform: "uppercase", color: C.plow,
          background: C.plow + "1C", padding: "5px 10px", borderRadius: 20, border: `1px solid ${C.plow}2E` }}>
          {hasPlow ? `${sqft.toLocaleString()} sq ft to plow` : "no plow area yet"}</span>
        <span style={{ font: `700 10px ${FB}`, letterSpacing: ".06em", textTransform: "uppercase", color: C.push,
          background: C.push + "1C", padding: "5px 10px", borderRadius: 20, border: `1px solid ${C.push}2E` }}>
          {pushCount} push zone{pushCount !== 1 ? "s" : ""}</span>
      </div>

      {/* save */}
      <button onClick={done} disabled={!hasPlow} style={{ width: "100%", marginTop: 14, minHeight: 48,
        borderRadius: 14, border: "none", cursor: hasPlow ? "pointer" : "not-allowed",
        background: hasPlow ? `linear-gradient(180deg, ${C.amberSoft}, ${C.amber})` : C.slate,
        color: hasPlow ? "#231603" : C.mistDim, font: `700 16px ${FB}`,
        boxShadow: hasPlow ? "0 6px 20px rgba(255,176,32,.28)" : "none", transition: "all .2s" }}>
        {hasPlow ? (price != null ? `${saveLabel} · $${price} per plow` : saveLabel) : "Outline a plow area first"}
      </button>
    </div>
  );
}
