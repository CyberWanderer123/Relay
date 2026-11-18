import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { closedPage, errorPage, formPage, notFoundPage, rateLimitedPage, thanksPage } from "../views/pages.js";
import { clientIp, RateLimiter, toRaw, type Deps } from "./deps.js";

/** GET /f/:id (the web form), POST /f/:id/submit (the one place answers are saved), GET /f/:id/thanks. */
export function formRoutes({ relay, config }: Deps) {
  const r = new Hono();
  const limiter = new RateLimiter(config.submitPerMinute);
  const host = relay.host;

  r.get("/f/:id", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.html(notFoundPage(host), 404);
    if (form.status === "closed") return c.html(closedPage(host, form), 410);
    // Known field ids in the query prefill the form (used by "Edit in the web form").
    const query = toRaw(c.req.queries());
    const values = Object.fromEntries(form.fields.filter((f) => query[f.id]).map((f) => [f.id, query[f.id]!]));
    return c.html(formPage({ form, links: relay.links(form.id), host, values, errors: {} }));
  });

  r.post(
    "/f/:id/submit",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.html(errorPage(host, "That's too much text.", "The answers are larger than this form accepts. Shorten them and try again."), 413),
    }),
    async (c) => {
      const form = await relay.findForm(c.req.param("id"));
      if (!form) return c.html(notFoundPage(host), 404);
      if (form.status === "closed") return c.html(closedPage(host, form), 410);

      if (!limiter.take(clientIp(c, config.trustProxy))) return c.html(rateLimitedPage(host), 429);

      const body = await c.req.parseBody({ all: true });
      // Honeypot: bots fill every field. Pretend it worked and save nothing.
      if (typeof body._hp === "string" && body._hp.trim() !== "") return c.redirect(`/f/${form.id}/thanks`, 303);

      const raw = toRaw(body);
      const result = await relay.submit(form.id, raw);
      if (!result.ok) {
        return c.html(formPage({ form, links: relay.links(form.id), host, values: raw, errors: result.errors }), 422);
      }
      return c.redirect(`/f/${form.id}/thanks`, 303);
    },
  );

  r.get("/f/:id/thanks", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.html(notFoundPage(host), 404);
    return c.html(thanksPage(host, form));
  });

  return r;
}
