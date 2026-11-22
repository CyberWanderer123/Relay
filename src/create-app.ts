import crypto from "node:crypto";
import { Hono } from "hono";
import type { Config } from "./config.js";
import { RelayError } from "./errors.js";
import { mcpRoutes } from "./mcp/http.js";
import { apiRoutes } from "./routes/api.js";
import { claudeRoutes } from "./routes/claude.js";
import { cleanRoutes } from "./routes/clean.js";
import { exportRoutes } from "./routes/export.js";
import { FORM_ACTION_HEADER, FRAME_ANCESTORS_HEADER, type Deps } from "./routes/deps.js";
import { oauthRoutes } from "./oauth.js";
import { formRoutes } from "./routes/form.js";
import { reviewRoutes } from "./routes/review.js";
import type { Relay } from "./service.js";
import { errorPage, homePage, notFoundPage, privacyPage, termsPage } from "./views/pages.js";
import { SPEC_MD } from "./spec.js";
import { OG_PNG_BASE64 } from "./views/og-image.js";
import { llmsTxt, OG_IMAGE_PATH, sitemapXml } from "./views/seo.js";
import { PAGE_JS } from "./views/scripts.js";
import { themeCss } from "./views/theme.js";
import { CSS, FAVICON_SVG } from "./views/styles.js";

/**
 * Content-Security-Policy. Images may come from any https host (a form's own logo). Form pages and
 * /c/ fallback pages load one same-origin script; there are no inline scripts anywhere. Framing is
 * refused unless a form lists the sites allowed to embed it.
 */
function csp(o: { script: boolean; frameAncestors?: string; formAction?: string }) {
  return [
    "default-src 'none'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `form-action 'self'${o.formAction ? ` ${o.formAction}` : ""}`,
    "base-uri 'none'",
    `frame-ancestors ${o.frameAncestors ?? "'none'"}`,
    ...(o.script ? ["script-src 'self'"] : []),
  ].join("; ");
}



export function createApp(relay: Relay, config: Config) {
  const deps: Deps = { relay, config };
  const app = new Hono();

  // Request log: method, path and status only. Never query strings — review links carry answers.
  if (config.log) {
    app.use(async (c, next) => {
      const start = Date.now();
      await next();
      console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
    });
  }

  app.use(async (c, next) => {
    await next();
    const frameAncestors = c.res.headers.get(FRAME_ANCESTORS_HEADER) || undefined;
    c.res.headers.delete(FRAME_ANCESTORS_HEADER);
    const formAction = c.res.headers.get(FORM_ACTION_HEADER) || undefined;
    c.res.headers.delete(FORM_ACTION_HEADER);
    c.header("Content-Security-Policy", csp({ script: /^\/(c|f)\//.test(c.req.path), frameAncestors, formAction }));
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    // Old browsers ignore frame-ancestors; X-Frame-Options can't list several sites, so send it only when framing is refused.
    if (!frameAncestors) c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    if (config.baseUrl.startsWith("https://")) c.header("Strict-Transport-Security", "max-age=31536000");
    if (/^\/(f|a|c|api|oauth)\//.test(c.req.path) && !c.req.path.endsWith("/theme.css")) c.header("Cache-Control", "no-store");
  });

  // The home page shows a freshly generated owner key in its setup guide, so it must never be cached.
  app.get("/", (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(
      homePage({
        host: relay.host,
        baseUrl: relay.baseUrl,
        ownerConfigured: Boolean(config.ownerKey),
        suggestedKey: crypto.randomBytes(24).toString("base64url"),
        hosted: config.hosted ? { monthlyResponses: config.monthlyResponses, contactEmail: config.contactEmail } : undefined,
      }),
    );
  });
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/terms", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(termsPage(relay.host, relay.baseUrl, config.contactEmail));
  });
  app.get("/privacy", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(privacyPage(relay.host, relay.baseUrl, config.contactEmail));
  });
  const site = {
    host: relay.host,
    baseUrl: relay.baseUrl,
    hosted: config.hosted ? { monthlyResponses: config.monthlyResponses } : undefined,
  };
  app.get("/sitemap.xml", (c) =>
    c.body(sitemapXml(relay.baseUrl), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" }),
  );
  app.get("/llms.txt", (c) =>
    c.body(llmsTxt(site), 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }),
  );
  const ogPng = Buffer.from(OG_PNG_BASE64, "base64");
  app.get(OG_IMAGE_PATH, (c) => c.body(ogPng, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }));
  // A form's brand colour as CSS variables. A stylesheet, not inline styles, so the CSP stays strict.
  app.get("/f/:id/theme.css", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    const css = form ? themeCss(form.settings) : "";
    return c.body(css, 200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" });
  });
  app.get("/assets/relay.css", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(CSS, 200, { "Content-Type": "text/css; charset=utf-8" });
  });
  app.get("/assets/relay.js", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(PAGE_JS, 200, { "Content-Type": "text/javascript; charset=utf-8" });
  });
  app.get("/spec", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(SPEC_MD, 200, { "Content-Type": "text/markdown; charset=utf-8" });
  });
  app.get("/favicon.svg", (c) => c.body(FAVICON_SVG, 200, { "Content-Type": "image/svg+xml" }));
  // Form pages must stay fetchable: "fill with Claude" has Claude read /a/:id (or the older /f/:id/clean), and Claude's
  // fetcher obeys robots.txt. Search engines are kept out by noindex headers/meta, not by this file.
  app.get("/robots.txt", (c) =>
    c.text(
      "User-agent: *\nAllow: /a/\nAllow: /f/\nDisallow: /c/\nDisallow: /api/\nDisallow: /mcp\nDisallow: /x/\nDisallow: /oauth/\n\n" +
        `Sitemap: ${relay.baseUrl}/sitemap.xml\n`,
    ),
  );

  app.route("/", formRoutes(deps));
  app.route("/", cleanRoutes(deps));
  app.route("/", reviewRoutes(deps));
  app.route("/", claudeRoutes(deps));
  app.route("/", apiRoutes(deps));
  app.route("/", exportRoutes(deps));
  app.route("/", oauthRoutes(deps));
  app.route("/", mcpRoutes(deps));

  app.notFound((c) =>
    c.req.path.startsWith("/api/") ? c.json({ error: "Not found." }, 404) : c.html(notFoundPage(relay.host), 404),
  );

  app.onError((err, c) => {
    const status = err instanceof RelayError ? err.status : 500;
    if (status === 500) console.error(err);
    if (c.req.path.startsWith("/api/")) {
      const e = err instanceof RelayError ? err : new RelayError(500, "Internal error.");
      return c.json({ error: e.message, ...(e.details ? { details: e.details } : {}) }, status);
    }
    return c.html(errorPage(relay.host, "Something went wrong.", "Please try again in a moment."), status);
  });

  return app;
}
