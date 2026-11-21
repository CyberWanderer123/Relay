import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { closedPage, errorPage, formPage, notFoundPage, rateLimitedPage, thanksPage } from "../views/pages.js";
import { renderClean, renderClosedClean } from "../clean.js";
import { sendResponseWebhook } from "../webhook.js";
import { OPERATOR, type StoredForm } from "../service.js";
import { clientIp, FRAME_ANCESTORS_HEADER, RateLimiter, toRaw, type Deps } from "./deps.js";

/** True when the client prefers text/plain or text/markdown to HTML (browsers always list text/html first). */
export function wantsText(accept: string | undefined): boolean {
  if (!accept) return false;
  const types = accept.split(",").map((part) => {
    const [type = "", ...params] = part.trim().toLowerCase().split(";");
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { type: type.trim(), q: qParam ? Number(qParam.slice(2)) || 0 : 1 };
  });
  const best = (match: (t: string) => boolean) => Math.max(0, ...types.filter((t) => match(t.type)).map((t) => t.q));
  const text = best((t) => t === "text/plain" || t === "text/markdown");
  const html = best((t) => t === "text/html" || t === "application/xhtml+xml" || t === "*/*" || t === "text/*");
  return text > 0 && text > html;
}

/** Whether this request is the embedded view (?embed=1); marks the response for forms that allow embedding. */
function embedding(c: Context, form: StoredForm): boolean {
  if (form.settings.embed_origins?.length) c.header(FRAME_ANCESTORS_HEADER, form.settings.embed_origins.join(" "));
  return c.req.query("embed") === "1";
}

/** GET /f/:id (the web form), POST /f/:id/submit (the one place answers are saved), GET /f/:id/thanks. */
export function formRoutes({ relay, config }: Deps) {
  const r = new Hono();
  const limiter = new RateLimiter(config.submitPerMinute);
  const host = relay.host;

  r.get("/f/:id", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.html(notFoundPage(host), 404);
    // Agents that ask for plain text or Markdown get the agent version (same text as /a/:id).
    c.header("Vary", "Accept");
    if (wantsText(c.req.header("accept"))) {
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("X-Robots-Tag", "noindex");
      if (form.status === "closed") return c.body(renderClosedClean(), 410);
      return c.body(renderClean(form, relay.links(form.id)));
    }
    const embed = embedding(c, form);
    if (form.status === "closed") return c.html(closedPage(host, form, embed), 410);
    // Known field ids in the query prefill the form (used by "Edit in the web form").
    const query = toRaw(c.req.queries());
    const values = Object.fromEntries(form.fields.filter((f) => query[f.id]).map((f) => [f.id, query[f.id]!]));
    return c.html(formPage({ form, links: relay.links(form.id), host, values, errors: {}, spotsLeft: await relay.spotsLeft(form), embed }));
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
      const embed = embedding(c, form);
      const thanks = embed ? `/f/${form.id}/thanks?embed=1` : `/f/${form.id}/thanks`;
      if (form.status === "closed") return c.html(closedPage(host, form, embed), 410);

      if (!limiter.take(clientIp(c, config.trustProxy))) return c.html(rateLimitedPage(host), 429);

      const body = await c.req.parseBody({ all: true });
      // Honeypot: bots fill every field. Pretend it worked and save nothing.
      if (typeof body._hp === "string" && body._hp.trim() !== "") return c.redirect(thanks, 303);

      const raw = toRaw(body);
      const result = await relay.submit(form.id, raw);
      if (!result.ok) {
        return c.html(formPage({ form, links: relay.links(form.id), host, values: raw, errors: result.errors, spotsLeft: await relay.spotsLeft(form), embed }), 422);
      }
      // Awaited (with a 3-second cap) because serverless functions may stop once the response is sent.
      // On a hosted Relay the webhook belongs to the operator, so only the operator's forms use it.
      if (!config.hosted || result.form.owner === OPERATOR) {
        await sendResponseWebhook(config, result.form, { id: result.response_id, submitted_at: result.submitted_at, answers: result.answers });
      }
      return c.redirect(thanks, 303);
    },
  );

  r.get("/f/:id/thanks", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.html(notFoundPage(host), 404);
    return c.html(thanksPage(host, form, embedding(c, form)));
  });

  return r;
}
