// Build-time only: renders the homepage to HTML so search engines (and slow
// phones) get the full page instantly. See scripts/prerender.mjs.
import React from "react";
import { renderToString } from "react-dom/server";
import Landing from "./Landing.jsx";

export function render() {
  return renderToString(<Landing onStart={() => {}} onLegal={() => {}} />);
}
