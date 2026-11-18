import { Hono } from "hono";
import type { Config } from "./config.js";
import { RelayError } from "./errors.js";
import { mcpRoutes } from "./mcp/http.js";
import { apiRoutes } from "./routes/api.js";
import { claudeRoutes } from "./routes/claude.js";
import { cleanRoutes } from "./routes/clean.js";
import type { Deps } from "./routes/deps.js";
import { formRoutes } from "./routes/form.js";
import { reviewRoutes } from "./routes/review.js";
import type { Relay } from "./service.js";
import { errorPage, homePage, notFoundPage } from "./views/pages.js";
import { CSS, FAVICON_SVG } from "./views/styles.js";

const CSP = [
  "default-src 'none'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

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
    c.header("Content-Security-Policy", CSP);
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    if (config.baseUrl.startsWith("https://")) c.header("Strict-Transport-Security", "max-age=31536000");
    if (c.req.path.startsWith("/f/") || c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  });

  app.get("/", (c) => c.html(homePage({ host: relay.host, baseUrl: relay.baseUrl })));
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/assets/relay.css", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(CSS, 200, { "Content-Type": "text/css; charset=utf-8" });
  });
  app.get("/favicon.svg", (c) => c.body(FAVICON_SVG, 200, { "Content-Type": "image/svg+xml" }));
  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /f/\nDisallow: /c/\nDisallow: /api/\n"));

  app.route("/", formRoutes(deps));
  app.route("/", cleanRoutes(deps));
  app.route("/", reviewRoutes(deps));
  app.route("/", claudeRoutes(deps));
  app.route("/", apiRoutes(deps));
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
