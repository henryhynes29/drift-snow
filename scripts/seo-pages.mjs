// Builds DRIFT's search pages (city, service and guide pages) as fast static HTML,
// plus robots.txt and sitemap.xml. Output goes in /public, so Vite copies it into
// the site as-is. Edit the content in scripts/seo-content.mjs, then run:
//
//   node scripts/seo-pages.mjs
//
// Every price on these pages comes from src/lib/estimate.js (same math as the app).
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES as BASE_PAGES, SITE, UPDATED } from "./seo-content.mjs";
import { LEARN_PAGES } from "./seo-learn.mjs";
const PAGES = [...BASE_PAGES, ...LEARN_PAGES];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const url = (slug) => `${SITE}/${slug ? slug + "/" : ""}`;
const APP = "/?go=book"; // opens the app straight to booking

const ICON = {
  snow: '<path d="M12 2v20M4.9 6l14.2 12M4.9 18L19.1 6M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  truck: '<path d="M3 7h10v9H3zM13 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const svg = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const CSS = `
:root{--bg:#06080C;--bg2:#0B0F16;--panel:#10151E;--panel2:#151B26;--line:rgba(170,195,230,.13);--lineHard:rgba(170,195,230,.22);
--ice:#EEF3F8;--mist:#9BA7B7;--dim:#8693A6;--amber:#FFB020;--amberHot:#FFD166;--onAmber:#1A1204;--steel:#7FA7D6;--good:#3DDC84;
--fd:"Big Shoulders Display",Impact,"Arial Narrow Bold","Arial Narrow",sans-serif;--fb:"Instrument Sans",-apple-system,BlinkMacSystemFont,system-ui,"Segoe UI",sans-serif;--fm:"IBM Plex Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ice);font-family:var(--fb);-webkit-font-smoothing:antialiased;line-height:1.55}
a{color:inherit}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
.mono{font-family:var(--fm);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mist)}
nav{position:sticky;top:0;z-index:10;background:rgba(6,8,12,.82);backdrop-filter:saturate(160%) blur(18px);-webkit-backdrop-filter:saturate(160%) blur(18px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;justify-content:space-between;height:60px;gap:16px}
.logo{display:flex;align-items:center;gap:10px;font-family:var(--fd);font-weight:900;font-size:24px;letter-spacing:.05em;text-decoration:none}
.mark{width:32px;height:32px;border-radius:9px;background:var(--amber);color:var(--onAmber);display:grid;place-items:center}
.navlinks{display:flex;gap:22px}.navlinks a{color:var(--mist);text-decoration:none;font-weight:500;font-size:14.5px}.navlinks a:hover{color:var(--ice)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:54px;padding:0 26px;border-radius:999px;background:var(--amber);color:var(--onAmber);
font-weight:700;font-size:16.5px;text-decoration:none;border:1.5px solid transparent;transition:transform .15s,box-shadow .2s}
.btn:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(255,176,32,.3)}.btn.sm{min-height:42px;padding:0 18px;font-size:14.5px}
.ghost{background:transparent;color:var(--ice);border-color:var(--lineHard)}.ghost:hover{box-shadow:none;background:rgba(255,255,255,.05)}
.crumbs{font-size:13px;color:var(--dim);padding-top:22px}.crumbs a{color:var(--mist);text-decoration:none}.crumbs a:hover{color:var(--ice)}
.hero{position:relative;overflow:hidden;padding:20px 0 54px;background:radial-gradient(60% 70% at 88% 0%,rgba(255,176,32,.14),transparent 60%),radial-gradient(80% 80% at 0% 100%,#0E1A2B,transparent 70%)}
.snow{position:absolute;inset:0;pointer-events:none;opacity:.32;background:radial-gradient(circle at 30% 40%,#fff 1.1px,transparent 1.7px) 0 0/29px 31px,radial-gradient(circle at 70% 70%,rgba(255,255,255,.75) .8px,transparent 1.3px) 11px 7px/43px 37px;
-webkit-mask-image:linear-gradient(180deg,#000,transparent 90%);mask-image:linear-gradient(180deg,#000,transparent 90%);animation:fall 16s linear infinite}
@keyframes fall{to{background-position:0 186px,11px 192px}}@media (prefers-reduced-motion:reduce){.snow{animation:none}}
h1{font-family:var(--fd);font-weight:900;text-transform:uppercase;font-size:clamp(48px,8.6vw,92px);line-height:.9;letter-spacing:.005em;margin:18px 0 18px;max-width:860px}
h1 em,h2 em{font-style:normal;color:var(--amber)}
.lead{font-size:clamp(17px,2.1vw,19.5px);color:var(--mist);max-width:640px;margin:0 0 24px}
.ctas{display:flex;gap:10px;flex-wrap:wrap}
.ticks{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:22px;color:var(--ice);font-size:14.5px}.ticks span{display:inline-flex;align-items:center;gap:7px}.ticks svg{color:var(--good)}
section{padding:52px 0}
h2{font-family:var(--fd);font-weight:900;text-transform:uppercase;font-size:clamp(34px,5.4vw,54px);line-height:.95;margin:10px 0 14px}
h3{font-size:18px;margin:0 0 6px}
.sub{color:var(--mist);font-size:17px;max-width:640px;margin:0 0 26px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:22px}
.prices{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.price{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px}
.price .k{font-weight:600;font-size:15px}.price .h{font-size:13px;color:var(--mist);margin-top:2px}
.price .v{font-family:var(--fd);font-weight:900;font-size:38px;line-height:1;margin-top:14px;color:var(--ice)}
.price.hot{border-color:rgba(255,176,32,.5);background:linear-gradient(160deg,rgba(255,176,32,.12),var(--panel) 60%)}.price.hot .v{color:var(--amber)}
.fine{font-size:13.5px;color:var(--dim);margin-top:14px;max-width:760px}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.step{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px}
.step .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:rgba(255,176,32,.12);color:var(--amber);margin-bottom:14px}
.step p{margin:0;color:var(--mist);font-size:14.5px}
.local{display:grid;grid-template-columns:1.25fr .75fr;gap:18px;align-items:start}
.prose p{color:#C9D3DE;font-size:16.5px;margin:0 0 16px}.prose p b{color:var(--ice)}.prose ul{color:#C9D3DE;font-size:16px;padding-left:20px;margin:0 0 16px}.prose li{margin:6px 0}
.prose h3{font-size:20px;margin:26px 0 8px}
.prose a,details a{color:var(--amber);font-weight:600;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.side{position:sticky;top:80px}
.facts{display:grid;gap:10px}
.fact{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
.fact b{display:block;font-family:var(--fd);font-weight:900;font-size:32px;line-height:1;color:var(--amber)}
.fact span{font-size:14px;color:var(--mist)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;padding:8px 13px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font-size:14px;color:var(--ice);text-decoration:none}
a.chip:hover{border-color:var(--amber)}
.svcs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.svc{display:block;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;text-decoration:none;transition:border-color .2s,transform .2s}
.svc:hover{border-color:rgba(255,176,32,.5);transform:translateY(-3px)}
.svc .t{font-family:var(--fd);font-weight:800;font-size:24px;text-transform:uppercase;line-height:1}
.svc .d{font-size:14px;color:var(--mist);margin-top:8px}.svc .p{font-size:13.5px;color:var(--amber);font-weight:600;margin-top:10px}
details{border-bottom:1px solid var(--lineHard)}details:first-of-type{border-top:1px solid var(--lineHard)}
summary{cursor:pointer;list-style:none;padding:20px 40px 20px 0;font-weight:600;font-size:18px;position:relative}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";position:absolute;right:4px;top:50%;transform:translateY(-50%);font-size:24px;font-weight:300;color:var(--mist);transition:transform .2s}
details[open] summary:after{transform:translateY(-50%) rotate(45deg);color:var(--amber)}
details p{margin:0 0 20px;color:var(--mist);font-size:16px;max-width:760px}
.final{text-align:center;padding:64px 0 80px;background:radial-gradient(50% 70% at 50% 100%,rgba(255,176,32,.14),transparent 70%)}
.final .sub{margin:0 auto 24px}
footer{border-top:1px solid var(--line);padding:34px 0 calc(34px + env(safe-area-inset-bottom));color:var(--dim);font-size:13.5px}
.fgrid{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:24px}
footer .fh{font-family:var(--fm);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mist);font-weight:500;margin:0 0 10px}
footer a{display:block;color:var(--mist);text-decoration:none;margin:6px 0}footer a:hover{color:var(--ice)}
.sources{font-size:13px;color:var(--dim)}.sources a{color:var(--mist)}
.updated{font-size:13px;color:var(--dim);margin-top:14px}
.article .prose h2{font-size:clamp(28px,4vw,40px);margin:38px 0 12px;scroll-margin-top:80px}.article .prose h2:first-child{margin-top:0}
.article .prose h3{font-size:19px;margin:22px 0 8px}.article .prose p,.article .prose li{font-size:17px;line-height:1.65}
.article .prose table{width:100%;border-collapse:collapse;margin:8px 0 20px;font-size:15px}.article .prose th,.article .prose td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);color:#C9D3DE}.article .prose th{color:var(--ice);font-weight:600}
.callout{border-left:3px solid var(--amber);background:var(--panel);border-radius:0 14px 14px 0;padding:14px 18px;margin:18px 0}.callout p{margin:0!important}
.toc{margin:0;padding:0;list-style:none;color:var(--mist)}.toc li{margin:7px 0;font-size:14.5px}.toc a{color:var(--ice);text-decoration:none}.toc a:hover{color:var(--amber)}
@media (max-width:860px){.prices,.svcs{grid-template-columns:1fr 1fr}.steps{grid-template-columns:1fr 1fr}.local{grid-template-columns:1fr}.side{position:static}.fgrid{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.navlinks{display:none}.btn{width:100%}.ctas .btn{width:100%}.steps{grid-template-columns:1fr}h1{font-size:clamp(44px,13vw,64px)}}
`;

const isDriver = (p) => p.audience === "driver";
const DRIVE = "/drive.html";
const by = (all, kind) => all.filter((p) => p.kind === kind);
const toc = (html) => [...html.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)].map((m) => [m[1], m[2]]);
const words = (html) => html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
const card = (p) => `<a class="svc" href="/${p.slug}/"><div class="mono" style="color:var(--amber);font-size:11px">${esc(p.cat || (p.kind === "guide" ? "Local rules" : p.kind === "faq" ? "FAQ" : "Guide"))}</div><div class="t" style="font-size:24px;margin-top:10px">${esc(p.short)}</div><div class="d">${esc(p.cardText || p.description)}</div></a>`;

function jsonLd(page, crumbs, all) {
  const ld = [{
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: crumbs.map(([name, href], i) => ({ "@type": "ListItem", position: i + 1, name, item: href ? SITE + href : url(page.slug) })),
  }];
  if (["guide", "article"].includes(page.kind)) ld.push({
    "@context": "https://schema.org", "@type": "Article", headline: page.h1Plain || page.title, description: page.description,
    datePublished: UPDATED.iso, dateModified: UPDATED.iso, author: { "@type": "Organization", name: "DRIFT", url: SITE + "/" },
    publisher: { "@type": "Organization", name: "DRIFT", logo: { "@type": "ImageObject", url: SITE + "/icon-512.png" } },
    mainEntityOfPage: url(page.slug), image: SITE + "/og-image.png", inLanguage: "en-US",
    ...(page.body ? { wordCount: words(page.body) } : {}),
  });
  else if (page.kind === "hub") ld.push({
    "@context": "https://schema.org", "@type": "CollectionPage", name: page.h1Plain, description: page.description, url: url(page.slug),
    hasPart: all.filter((p) => ["article", "guide"].includes(p.kind)).map((p) => ({ "@type": "Article", headline: p.h1Plain, url: url(p.slug) })),
  });
  else if (page.kind === "jobs") {
    ld.push({ "@context": "https://schema.org", "@type": "WebPage", name: page.h1Plain, description: page.description, url: url(page.slug) });
    // Google for Jobs: lists the page in job search ("snow plow jobs duluth").
    // Independent-contractor work, so employmentType is CONTRACTOR. Pay varies per job, so no salary claim.
    if (page.jobPosting) ld.push({
      "@context": "https://schema.org", "@type": "JobPosting",
      title: page.jobPosting.title, description: page.jobPosting.description,
      datePosted: page.jobPosting.datePosted, validThrough: page.jobPosting.validThrough,
      employmentType: "CONTRACTOR", directApply: true, url: url(page.slug),
      hiringOrganization: { "@type": "Organization", name: "DRIFT", sameAs: SITE + "/", logo: SITE + "/icon-512.png" },
      jobLocation: page.jobPosting.towns.map(([town, region]) => ({ "@type": "Place", address: { "@type": "PostalAddress", addressLocality: town, addressRegion: region, addressCountry: "US" } })),
    });
  }
  else if (page.kind !== "faq") ld.push({
    "@context": "https://schema.org", "@type": "Service", name: page.serviceName || page.h1Plain, serviceType: page.serviceType || "Snow removal",
    description: page.description, url: url(page.slug),
    provider: { "@type": "Organization", name: "DRIFT", url: SITE + "/", logo: SITE + "/icon-512.png" },
    areaServed: (page.areaServed || [["Duluth", "MN"]]).map(([name, region]) => ({ "@type": region === "hood" ? "Place" : "City", name, ...(region === "hood" ? { containedInPlace: { "@type": "City", name: "Duluth" } } : { containedInPlace: { "@type": "State", name: region === "WI" ? "Wisconsin" : "Minnesota" } }) })),
    ...(page.priceFrom ? { offers: { "@type": "Offer", priceCurrency: "USD", price: String(page.priceFrom), description: "Suggested starting total, including fees. Customers set their own price." } } : {}),
  });
  const faqs = page.kind === "faq" ? page.sections.flatMap((x) => x.qs) : page.faq || [];
  if (faqs.length) ld.push({
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/<[^>]+>/g, "") } })),
  });
  return ld;
}

function head(page, ld) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${url(page.slug)}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<meta name="theme-color" content="#06080C" />
<link rel="icon" type="image/png" href="/favicon-64.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:type" content="${["guide", "article"].includes(page.kind) ? "article" : "website"}" />
<meta property="og:site_name" content="DRIFT" />
<meta property="og:locale" content="en_US" />
<meta property="og:title" content="${esc(page.ogTitle || page.title)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:url" content="${url(page.slug)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
${["guide", "article"].includes(page.kind) ? `<meta property="article:modified_time" content="${UPDATED.iso}" />\n` : ""}<meta name="geo.region" content="${page.geoRegion || "US-MN"}" />
<meta name="geo.placename" content="${esc(page.place || "Duluth")}" />
<link rel="preload" href="/fonts/big-shoulders-display-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/instrument-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/fonts/fonts.css" />
<style>${CSS.replace(/\n/g, "")}</style>
${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join("\n")}
</head>
<body>
<nav><div class="wrap">
  <a class="logo" href="/"><span class="mark"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">${ICON.snow}</svg></span>DRIFT</a>
  <div class="navlinks"><a href="/#how">How it works</a><a href="/snow-plowing-cost-duluth/">Prices</a><a href="/faq/">FAQ</a><a href="/learn/">Learn</a><a href="/drive.html">Drive with us</a></div>
  ${isDriver(page) ? `<a class="btn sm" href="${DRIVE}">Start driving</a>` : `<a class="btn sm" href="${APP}">Get a plow</a>`}
</div></nav>`;
}

function hero(page, crumbs) {
  const driver = isDriver(page), longform = ["guide", "article"].includes(page.kind);
  const ctaHref = driver ? DRIVE : APP;
  const ticks = driver
    ? ["80% of every offer + $10 call-out", "You pick the jobs", "Paid through Stripe", "Free to join"]
    : ["No contracts", "Pay only when it's done", "Track your plow live", "Before &amp; after photos"];
  return `<header class="hero"><div class="snow"></div><div class="wrap" style="position:relative">
  <div class="crumbs">${crumbs.map(([n, h]) => (h ? `<a href="${h}">${esc(n)}</a>` : `<span>${esc(n)}</span>`)).join(" &nbsp;/&nbsp; ")}</div>
  <h1>${page.h1}</h1>
  <p class="lead">${page.lead}</p>
  ${page.kind === "faq" || page.kind === "hub" ? "" : `<div class="ctas"><a class="btn" href="${ctaHref}">${esc(page.cta || (driver ? "Start driving" : "Map my driveway"))} ${svg("arrow", 18)}</a>${page.prices ? `<a class="btn ghost" href="#prices">See prices</a>` : ""}</div>
  <div class="ticks">${ticks.map((t) => `<span>${svg("check", 17)}${t}</span>`).join("")}</div>`}
  ${longform ? `<div class="updated">Updated ${UPDATED.label}${page.body ? ` · ${Math.max(2, Math.round(words(page.body) / 230))} min read` : ""}</div>` : ""}
</div></header>`;
}

function pricesSection(page) {
  return page.prices ? `<section id="prices"><div class="wrap">
  <div class="mono">${esc(page.pricesKicker || "Prices")}</div>
  <h2>${page.pricesTitle || "What it costs"}</h2>
  <p class="sub">${page.pricesLead || "Typical recommended prices per storm, including the $10 driver call-out and $5 booking fee. Your exact price comes from mapping your driveway, and you can always offer more or less."}</p>
  <div class="prices">${page.prices.map((p, i) => `<div class="price${i === 1 ? " hot" : ""}"><div class="k">${esc(p.label)}</div><div class="h">${esc(p.hint)}</div><div class="v">${esc(p.text)}</div></div>`).join("")}</div>
  <p class="fine">${page.pricesFine || "Your recommended price comes from the outline you draw on a satellite map of your property. Steep driveways and deep snow (4\"+) cost a bit more. You're charged only after the job is done."}</p>
</div></section>` : "";
}

const stepsSection = () => `<section><div class="wrap">
  <div class="mono">How it works</div>
  <h2>Booked in a minute</h2>
  <div class="steps">
    <div class="step"><div class="ic">${svg("pin", 21)}</div><h3>Map it once</h3><p>Outline your driveway, walks and where snow goes on a satellite map.</p></div>
    <div class="step"><div class="ic">${svg("cash", 21)}</div><h3>Get your price</h3><p>We recommend a fair price from the size, slope and snow. Offer what the job is worth to you.</p></div>
    <div class="step"><div class="ic">${svg("truck", 21)}</div><h3>A local plow rolls out</h3><p>An independent driver nearby accepts. Watch the truck on the map and message them.</p></div>
    <div class="step"><div class="ic">${svg("camera", 21)}</div><h3>Pay when it's done</h3><p>Your card is charged only after the job, with before and after photos.</p></div>
  </div>
</div></section>`;

function localSection(page, all) {
  const hoodLinks = Object.fromEntries(by(all, "hood").map((h) => [h.short, h.slug]));
  return `<section><div class="wrap local">
  <div class="prose">
    <div class="mono">${esc(page.localKicker || "Local know-how")}</div>
    <h2>${page.localTitle}</h2>
    ${page.local}
  </div>
  <aside class="side">
    ${page.facts?.length ? `<div class="facts">${page.facts.map(([b, s]) => `<div class="fact"><b>${esc(b)}</b><span>${s}</span></div>`).join("")}</div>` : ""}
    ${page.areas?.length ? `<div class="card" style="margin-top:10px"><div class="mono" style="margin-bottom:10px">${esc(page.areasLabel || "Neighborhoods we cover")}</div><div class="chips">${page.areas.map((a) => hoodLinks[a] ? `<a class="chip" href="/${hoodLinks[a]}/">${esc(a)} →</a>` : `<span class="chip">${esc(a)}</span>`).join("")}</div></div>` : ""}
  </aside>
</div></section>`;
}

function articleSection(page) {
  const t = toc(page.body);
  return `<section><div class="wrap local article">
  <div class="prose">${page.body}</div>
  <aside class="side">
    ${t.length > 2 ? `<div class="card"><div class="mono" style="margin-bottom:10px">In this guide</div><ul class="toc">${t.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join("")}</ul></div>` : ""}
    ${page.facts?.length ? `<div class="facts" style="margin-top:10px">${page.facts.map(([b, s]) => `<div class="fact"><b>${esc(b)}</b><span>${s}</span></div>`).join("")}</div>` : ""}
    <div class="card" style="margin-top:10px">${isDriver(page)
      ? `<div style="font-weight:700;font-size:17px">Have a plow?</div><p style="color:var(--mist);font-size:14.5px;margin:6px 0 14px">See open jobs and what they pay before you sign anything.</p><a class="btn sm" style="width:100%" href="${DRIVE}">Drive with DRIFT</a>`
      : `<div style="font-weight:700;font-size:17px">Need a plow?</div><p style="color:var(--mist);font-size:14.5px;margin:6px 0 14px">Map your driveway once and book every storm in a tap. No contract.</p><a class="btn sm" style="width:100%" href="${APP}">Map my driveway</a>`}</div>
  </aside>
</div></section>`;
}

function servicesSection(page, all) {
  const services = by(all, "service");
  return `<section><div class="wrap">
  <div class="mono">Services</div>
  <h2>Everything a storm throws at you</h2>
  <div class="svcs">
    ${[{ slug: "snow-plowing-duluth-mn", t: "Driveway plowing", d: "Cleared edge to edge, exactly how you outlined it.", p: "Priced from your map" }, ...services.map((s) => ({ slug: s.slug, t: s.cardTitle, d: s.cardText, p: s.cardPrice }))]
      .map((s) => `<a class="svc" href="/${s.slug}/"><div class="t">${esc(s.t)}</div><div class="d">${esc(s.d)}</div>${s.p ? `<div class="p">${esc(s.p)}</div>` : ""}</a>`).join("")}
  </div>
</div></section>`;
}

const faqSection = (page) => page.faq?.length ? `<section><div class="wrap">
  <div class="mono">FAQ</div>
  <h2>Questions people ask</h2>
  <div style="max-width:820px">${page.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join("")}</div>
  <p style="margin-top:18px"><a class="chip" href="/faq/">See all questions →</a></p>
</div></section>` : "";

function faqHub(page) {
  return `<section style="padding-top:28px"><div class="wrap">
  <div class="chips" style="margin-bottom:34px">${page.sections.map((x) => `<a class="chip" href="#${x.id}">${esc(x.title)}</a>`).join("")}</div>
  ${page.sections.map((x) => `<div id="${x.id}" style="max-width:860px;margin-bottom:46px;scroll-margin-top:80px">
    <div class="mono">${esc(x.kicker || "FAQ")}</div><h2>${esc(x.title)}</h2>
    ${x.qs.map(([q, a], i) => `<details id="${x.id}-${i + 1}"><summary>${esc(q)}</summary><p>${a}</p></details>`).join("")}
  </div>`).join("")}
</div></section>`;
}

function hubSection(page, all) {
  return `<section style="padding-top:28px"><div class="wrap">
  ${page.groups.map((g) => {
    const items = all.filter((p) => g.match(p));
    return `<div style="margin-bottom:46px"><div class="mono">${esc(g.kicker)}</div><h2>${esc(g.title)}</h2><p class="sub">${g.lead}</p><div class="svcs">${items.map(card).join("")}</div></div>`;
  }).join("")}
</div></section>`;
}

function relatedSection(page, all) {
  const rel = (page.related || []).map((slug) => all.find((p) => p.slug === slug)).filter(Boolean);
  return rel.length ? `<section style="padding-top:10px"><div class="wrap">
  <div class="mono">Keep reading</div><h2>Related</h2>
  <div class="svcs">${rel.map(card).join("")}</div>
</div></section>` : "";
}

function nearSection(page, all) {
  const cities = by(all, "city");
  return `<section style="padding-top:20px"><div class="wrap">
  <div class="mono" style="margin-bottom:12px">Snow removal near you</div>
  <div class="chips">${cities.map((c) => `<a class="chip" href="/${c.slug}/">${esc(c.short)}</a>`).join("")}</div>
  ${page.sources?.length ? `<p class="sources" style="margin-top:22px">Sources: ${page.sources.map(([n, h]) => `<a href="${h}" rel="nofollow noopener" target="_blank">${esc(n)}</a>`).join(" · ")}. Rules and prices can change, so check the source for the latest.</p>` : ""}
</div></section>`;
}

function finalSection(page) {
  if (isDriver(page)) return `<section class="final"><div class="wrap">
  <div class="mono">Duluth · Superior · Hermantown</div>
  <h2>Your plow. <em>Your call.</em></h2>
  <p class="sub">See open jobs and what they pay before any paperwork. Set up when you're ready.</p>
  <a class="btn" href="${DRIVE}">Start driving ${svg("arrow", 18)}</a>
</div></section>`;
  return `<section class="final"><div class="wrap">
  <div class="mono">${esc(page.place || "Duluth")}${page.geoRegion === "US-WI" ? ", WI" : ", MN"}</div>
  <h2>Snow's coming. <em>Beat the rush.</em></h2>
  <p class="sub">Map your driveway in two minutes and get your recommended price. It's free until you book your first plow.</p>
  <a class="btn" href="${APP}">Map my driveway ${svg("arrow", 18)}</a>
</div></section>`;
}

function footer(all) {
  const cities = by(all, "city"), services = by(all, "service"), learn = all.filter((p) => ["guide", "article"].includes(p.kind));
  return `<footer><div class="wrap">
  <div class="fgrid">
    <div><div style="font-family:var(--fd);font-weight:900;font-size:28px;letter-spacing:.05em;color:var(--ice)">DRIFT</div>
      <p style="margin:8px 0 0;max-width:300px">The app that connects you with independent local plow operators in the Twin Ports. <a href="mailto:support@driftplowing.com" style="display:inline;text-decoration:underline">support@driftplowing.com</a></p>
      <p style="margin:14px 0 0"><a href="/faq/" style="display:inline;margin-right:14px">FAQ</a><a href="/learn/" style="display:inline">Learning center</a></p></div>
    <div><p class="fh">Areas</p>${cities.map((c) => `<a href="/${c.slug}/">${esc(c.short)}</a>`).join("")}</div>
    <div><p class="fh">Services</p><a href="/snow-plowing-duluth-mn/">Driveway plowing</a>${services.map((s) => `<a href="/${s.slug}/">${esc(s.cardTitle)}</a>`).join("")}<a href="/plow-jobs-duluth-mn/">Plow jobs</a><a href="/drive.html">Drive with DRIFT</a></div>
    <div><p class="fh">Learn</p>${learn.slice(0, 9).map((g) => `<a href="/${g.slug}/">${esc(g.short)}</a>`).join("")}<a href="/learn/">All guides →</a></div>
  </div>
</div></footer>
</body>
</html>
`;
}

function layout(page, all) {
  const crumbs = page.crumbs || [["Home", "/"], [page.short || page.h1Plain, null]];
  const parts = [head(page, jsonLd(page, crumbs, all)), hero(page, crumbs)];
  if (page.kind === "faq") parts.push(faqHub(page));
  else if (page.kind === "hub") parts.push(hubSection(page, all));
  else if (page.kind === "article" || page.kind === "jobs") parts.push(articleSection(page), faqSection(page), relatedSection(page, all));
  else {
    parts.push(pricesSection(page));
    if (page.kind !== "guide") parts.push(stepsSection());
    parts.push(localSection(page, all));
    if (page.kind !== "guide") parts.push(servicesSection(page, all));
    parts.push(faqSection(page), relatedSection(page, all));
  }
  parts.push(nearSection(page, all), finalSection(page), footer(all));
  return parts.join("\n\n");
}

for (const page of PAGES) {
  const file = join(PUB, page.slug, "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, layout(page, PAGES));
}

// 404 page (Vercel serves /404.html for any unknown URL). Not indexed, but every link works.
{
  const nf = { kind: "notfound", slug: "", short: "Page not found", title: "Page Not Found | DRIFT",
    description: "That page doesn't exist. Find snow plowing in Duluth, prices, the FAQ or plow jobs.",
    h1: "That page <em>got plowed.</em>", h1Plain: "Page not found",
    lead: "The link you followed doesn't go anywhere. Here are the pages most people are looking for." };
  const picks = [
    ["snow-plowing-duluth-mn", "Duluth", "Snow plowing in Duluth"], ["snow-plowing-cost-duluth", "Prices", "What plowing costs"],
    ["faq", "FAQ", "Every question, answered"], ["learn", "Learn", "Guides and local rules"],
    ["sidewalk-snow-removal-duluth", "Service", "Sidewalk clearing"], ["car-dig-out-duluth", "Service", "Car dig-outs"],
    ["jump-start-duluth", "Service", "Jump-starts"], ["plow-jobs-duluth-mn", "Drivers", "Plow jobs in Duluth"],
  ];
  const grid = `<section><div class="wrap"><div class="svcs">${picks.map(([slug, k, t]) => {
    const pg = PAGES.find((x) => x.slug === slug);
    return `<a class="svc" href="/${slug}/"><div class="mono" style="color:var(--amber);font-size:11px">${k}</div><div class="t" style="font-size:24px;margin-top:10px">${t}</div><div class="d">${esc(pg?.cardText || pg?.description || "")}</div></a>`;
  }).join("")}</div></div></section>`;
  const html = [head(nf, []), hero(nf, [["Home", "/"], ["Page not found", null]]), grid, footer(PAGES)].join("\n\n")
    .replace(/<link rel="canonical"[^>]*>\n/, "")
    .replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex, follow" />')
    .replace(/<meta property="og:url"[^>]*>\n/, "");
  writeFileSync(join(PUB, "404.html"), html);
}

// llms.txt: a plain summary for AI search tools (ChatGPT, Perplexity, Claude). No user counts, ever.
{
  const line = (p) => `- [${p.h1Plain || p.short}](${url(p.slug)}): ${p.description}`;
  const grp = (k) => PAGES.filter((p) => k.includes(p.kind));
  writeFileSync(join(PUB, "llms.txt"), `# DRIFT

> DRIFT is an on-demand snow plowing app for homes in the Twin Ports: Duluth, Hermantown, Proctor, Cloquet and Esko in Minnesota, and Superior, Wisconsin. Homeowners map their driveway on a satellite view, get a recommended price, name their offer, track a local plow live and pay per storm. No seasonal contract.

Key facts:
- Services: residential driveway plowing, sidewalk snow clearing, car dig-outs and jump-starts. DRIFT does not offer salting, roof snow removal, or commercial lots.
- Pricing: the customer's price comes from mapping their driveway. They pay their offer plus a $10 call-out fee (goes to the driver) and a $5 booking fee. The card is held, then charged only when the job is done.
- Drivers are independent local plow operators, not DRIFT employees. They keep 80% of the offer, the full $10 call-out and 100% of tips, and are paid through Stripe.
- Customers can book now or schedule a day and 2-hour window up to 6 days ahead.
- Website: ${SITE}/ · Support: support@driftplowing.com

## Service areas
${grp(["city", "hood"]).map(line).join("\n")}

## Services
${grp(["service"]).map(line).join("\n")}

## Guides and local rules
${grp(["guide", "article"]).map(line).join("\n")}

## Help
${grp(["faq", "hub"]).map(line).join("\n")}

## For plow operators
${grp(["jobs"]).map(line).join("\n")}
- [Drive with DRIFT](${SITE}/drive.html): Sign up to plow, see open jobs and pay first.
`);
}

// robots + sitemap
writeFileSync(join(PUB, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);
const urls = [
  { loc: `${SITE}/`, pri: "1.0" },
  ...PAGES.map((p) => ({ loc: url(p.slug), pri: p.kind === "city" ? (p.slug.includes("duluth") ? "0.9" : "0.8") : ["service", "faq", "hub", "jobs"].includes(p.kind) ? "0.7" : "0.6" })),
  { loc: `${SITE}/drive.html`, pri: "0.6" },
];
writeFileSync(join(PUB, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${UPDATED.iso}</lastmod><priority>${u.pri}</priority></url>`).join("\n")}
</urlset>
`);
// vercel.json: long cache for the self-hosted fonts. (No redirects needed: every link
// uses the trailing-slash URL and each page has a canonical tag.)
const vpath = join(ROOT, "vercel.json");
const vercel = JSON.parse(readFileSync(vpath, "utf8"));
delete vercel.redirects;
vercel.headers = (vercel.headers || []).filter((h) => h.source !== "/fonts/(.*)");
vercel.headers.push({ source: "/fonts/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] });
writeFileSync(vpath, JSON.stringify(vercel, null, 2) + "\n");
console.log(`Wrote ${PAGES.length} pages + 404.html + llms.txt + robots.txt + sitemap.xml + vercel.json`);
