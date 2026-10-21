// Light-weight Mapbox settings shared by the app and landing page — no mapbox-gl
// import here, so pages that only need these don't download the 1.6 MB map library.
import { C } from "./theme.js";

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
export const MAP_ENABLED = !!MAPBOX_TOKEN;
const TOKEN = MAPBOX_TOKEN;
const HAZARD_FILL = "#FF453A";

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
        if (f.properties?.mode === "hazard") {
          return { type: "Feature", geometry: f.geometry, properties: f.geometry?.type === "LineString"
            ? { stroke: HAZARD_FILL, "stroke-width": 4 }
            : { fill: HAZARD_FILL, "fill-opacity": 0.3, stroke: HAZARD_FILL, "stroke-width": 2 } };
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


// A property's hazards have been marked (or confirmed none) — stored on its plow outlines.
export const hazardsChecked = (p) => !!p && (!!p.hazardsChecked || (p.features || []).some((f) => f.properties?.hazardsChecked));

// Plain list of what the customer marked, for drivers: ["Curb / edge", "Well cap", ...]
export const hazardLabels = (p) => (p?.features || [])
  .filter((f) => f.properties?.mode === "hazard" || (f.geometry?.type === "Point" && f.properties?.mode !== "push"))
  .map((f) => f.properties?.label || "Hazard");
