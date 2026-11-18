import { Hono } from "hono";
import { closedPage, notFoundPage, reviewPage } from "../views/pages.js";
import { toRaw, type Deps } from "./deps.js";

/**
 * GET /f/:id/review — shows the answers carried in the link's parameters.
 * A GET never saves anything; only the Submit button (a POST) does.
 */
export function reviewRoutes({ relay }: Deps) {
  const r = new Hono();
  r.get("/f/:id/review", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.html(notFoundPage(relay.host), 404);
    if (form.status === "closed") return c.html(closedPage(relay.host, form), 410);

    const query = toRaw(c.req.queries());
    const known = new Set(form.fields.map((f) => f.id));
    const ignored = Object.keys(query).filter((k) => !known.has(k));
    const raw = Object.fromEntries(Object.entries(query).filter(([k]) => known.has(k)));

    const result = relay.validate(form, raw);
    // Show the values exactly as they will be saved, when they are valid.
    const values: Record<string, string[]> = result.ok
      ? Object.fromEntries(
          Object.entries(result.answers).map(([k, v]) => [k, Array.isArray(v) ? v : [String(v)]]),
        )
      : raw;

    const editParams = new URLSearchParams();
    for (const [k, list] of Object.entries(values)) for (const v of list) editParams.append(k, v);
    const qs = editParams.toString();

    return c.html(
      reviewPage({
        form,
        host: relay.host,
        values,
        errors: result.ok ? {} : result.errors,
        ignored,
        editHref: `/f/${form.id}${qs ? `?${qs}` : ""}`,
      }),
    );
  });
  return r;
}
