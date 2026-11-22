import { h, trusted, type Safe } from "./html.js";
import crypto from "node:crypto";
import { CSS, FONT_CSS_URL } from "./styles.js";

/** Content hash so a changed stylesheet is never served from cache. */
const CSS_VERSION = crypto.createHash("sha256").update(CSS).digest("hex").slice(0, 10);

export const icons = {
  mark: trusted(
    `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#171923"/><path d="M10.5 20.5 21.5 11.5" stroke="#9295A5" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="21" r="4.25" fill="#7167E8"/><circle cx="22" cy="11" r="4.25" fill="#B7E4D2"/></svg>`,
  ),
  check: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  ),
  lock: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>`,
  ),
  info: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/></svg>`,
  ),
  alert: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 21.5 20h-19L12 3.5z"/><path d="M12 10v4.5M12 17.4v.2"/></svg>`,
  ),
  chat: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20l1-4.4A7.5 7.5 0 1 1 20 12.5z"/></svg>`,
  ),
  form: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/></svg>`,
  ),
  arrow: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  ),
  branch: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 12h4a4 4 0 0 0 4-4V8"/></svg>`,
  ),
  clock: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
  ),
  star: trusted(
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>`,
  ),
  edit: trusted(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>`,
  ),
};

export interface LayoutOptions {
  title: string;
  body: Safe;
  host: string;
  description?: string;
  wide?: boolean;
  /** Respondent pages are private links — keep them out of search engines. */
  noindex?: boolean;
  topbarMeta?: Safe | string;
  /** Same-origin script paths. Only pages whose CSP allows script-src 'self' may pass these. */
  scripts?: string[];
  /** Plain-text version of this page for AI assistants (rel=alternate). */
  alternate?: string;
  /** A form's own look: its theme stylesheet and logo. */
  brand?: { themeHref?: string; logoUrl?: string; logoAlt?: string };
  /** Shown inside another site's iframe: no Relay header or footer. */
  embed?: boolean;
  /** Public pages: canonical URL plus Open Graph / Twitter tags for link previews. */
  social?: { url: string; image: string; imageWidth: number; imageHeight: number; siteName: string };
  /** JSON-LD structured data, already serialised and safe inside <script>. */
  jsonLd?: string;
}

export function layout(o: LayoutOptions): string {
  return h`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${o.title}</title>
${o.description ? h`<meta name="description" content="${o.description}">` : ""}
${o.noindex ? h`<meta name="robots" content="noindex, nofollow">` : ""}
${
  o.social
    ? h`<link rel="canonical" href="${o.social.url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${o.social.siteName}">
<meta property="og:title" content="${o.title}">
${o.description ? h`<meta property="og:description" content="${o.description}">` : ""}
<meta property="og:url" content="${o.social.url}">
<meta property="og:image" content="${o.social.image}">
<meta property="og:image:width" content="${String(o.social.imageWidth)}">
<meta property="og:image:height" content="${String(o.social.imageHeight)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${o.title}">
${o.description ? h`<meta name="twitter:description" content="${o.description}">` : ""}
<meta name="twitter:image" content="${o.social.image}">`
    : ""
}
${o.jsonLd ? h`<script type="application/ld+json">${trusted(o.jsonLd)}</script>` : ""}
<meta name="theme-color" content="#F7F7F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F1016" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${o.alternate ? h`<link rel="alternate" type="text/plain" href="${o.alternate}" title="Plain-text version for AI assistants">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS_URL}">
<link rel="stylesheet" href="/assets/relay.css?v=${CSS_VERSION}">
${o.brand?.themeHref ? h`<link rel="stylesheet" href="${o.brand.themeHref}">` : ""}
${(o.scripts ?? []).map((src) => h`<script src="${src}" defer></script>`)}
</head>
<body${o.embed ? h` class="embedded"` : ""}>
${
  o.embed
    ? ""
    : h`<header class="topbar">
  ${
    o.brand?.logoUrl
      ? h`<span class="brand-logo"><img src="${o.brand.logoUrl}" alt="${o.brand.logoAlt ?? ""}" referrerpolicy="no-referrer"></span>`
      : h`<a class="brand" href="/" aria-label="Relay home">${icons.mark}<span class="brand-name">Relay</span></a>`
  }
  ${o.topbarMeta ? h`<span class="topbar-meta">${o.topbarMeta}</span>` : ""}
</header>`
}
<main class="shell${o.wide ? " wide" : ""}">
${o.body}
</main>
${
  o.embed
    ? h`<footer class="foot embedded-foot"><span>Powered by Relay</span></footer>`
    : h`<footer class="foot">
  <span>${o.brand?.logoUrl ? "Form made with Relay" : "Forms that travel through conversation · Relay"}</span>
  <span class="mono">${o.host}</span>
  <span><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></span>
</footer>`
}
</body>
</html>`.value;
}
