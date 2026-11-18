import { Hono } from "hono";
import { renderClean, renderClosedClean } from "../clean.js";
import type { Deps } from "./deps.js";

/**
 * GET /a/:id — the plain-text form for assistants ("a" for assistant).
 * /f/:id/clean serves the same text for links already shared. /a/ is the advertised path
 * because an earlier robots.txt disallowed /f/, and fetchers can cache robots.txt for a day.
 */
export function cleanRoutes({ relay }: Deps) {
  const r = new Hono();
  for (const path of ["/a/:id", "/f/:id/clean"] as const) {
    r.get(path, async (c) => {
      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("X-Robots-Tag", "noindex");
      const form = await relay.findForm(c.req.param("id"));
      if (!form) return c.body("Form not found. Tell the person the link does not work.\n", 404);
      if (form.status === "closed") return c.body(renderClosedClean(), 410);
      return c.body(renderClean(form, relay.links(form.id)));
    });
  }
  return r;
}
