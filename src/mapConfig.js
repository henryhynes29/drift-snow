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

