import { Hono } from "hono";
import { renderClean, renderClosedClean } from "../clean.js";
import type { Deps } from "./deps.js";

/** GET /f/:id/clean — the plain-text form for assistants. */
export function cleanRoutes({ relay }: Deps) {
  const r = new Hono();
  r.get("/f/:id/clean", async (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("X-Robots-Tag", "noindex");
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.body("Form not found. Tell the person the link does not work.\n", 404);
    if (form.status === "closed") return c.body(renderClosedClean(), 410);
    return c.body(renderClean(form, relay.links(form.id)));
  });
  return r;
}
