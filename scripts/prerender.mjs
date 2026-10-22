// After `vite build`: render the homepage (src/Landing.jsx) to static HTML and put
// it inside <div id="root"> in dist/index.html. React then hydrates it in the
// browser. If anything fails, the site still works (React just renders normally).
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".ssr");
const DIST = resolve(ROOT, process.env.PRERENDER_DIST || "dist");
try {
  await build({
    root: ROOT, logLevel: "warn", configFile: false, plugins: [react()],
    ssr: { noExternal: [/@fontsource/] },
    build: { ssr: "src/prerender-entry.jsx", outDir: OUT, emptyOutDir: true, rollupOptions: { output: { format: "esm", entryFileNames: "entry.mjs" } } },
  });
  const { render } = await import(pathToFileURL(join(OUT, "entry.mjs")).href);
  const html = render();
  const file = join(DIST, "index.html");
  const page = readFileSync(file, "utf8");
  if (!page.includes("<!--app-html-->")) throw new Error("marker <!--app-html--> not found in index.html");
  writeFileSync(file, page.replace("<!--app-html-->", html));
  console.log(`prerender: homepage rendered (${Math.round(html.length / 1024)} KB of HTML)`);
} catch (e) {
  console.warn("prerender skipped:", e.message);
} finally {
  rmSync(OUT, { recursive: true, force: true });
}
