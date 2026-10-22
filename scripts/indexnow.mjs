// IndexNow: tells Bing (which also feeds DuckDuckGo and ChatGPT search) which pages
// changed, so they get re-crawled in days instead of weeks. Runs at the end of the
// Vercel build, only on production deploys. It can never fail the build.
//
// It only sends pages whose <lastmod> in sitemap.xml is from the last 7 days, so bump
// UPDATED in scripts/seo-content.mjs (and re-run seo-pages.mjs) when content changes.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = "8836874e94e9c4668c7ec43b05abc498"; // public by design: the same key sits at /8836874e94e9c4668c7ec43b05abc498.txt
const HOST = "driftplowing.com";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  if (process.env.VERCEL_ENV !== "production") return console.log("indexnow: skipped (not a production deploy)");
  const xml = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");
  const cutoff = Date.now() - 7 * 864e5;
  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)]
    .filter((m) => Date.parse(m[2]) >= cutoff).map((m) => m[1]);
  if (!urlList.length) return console.log("indexnow: nothing changed in the last 7 days");
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
    signal: AbortSignal.timeout(8000),
  });
  console.log(`indexnow: sent ${urlList.length} URLs, status ${res.status}`);
}
main().catch((e) => console.log("indexnow: skipped (" + e.message + ")"));
