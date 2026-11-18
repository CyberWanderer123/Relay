import { Hono } from "hono";
import { closedPage, notFoundPage } from "../views/pages.js";
import type { Deps } from "./deps.js";

/** The short message a new Claude chat opens with. Kept well under ~300 characters. */
export function claudePrompt(cleanUrl: string): string {
  return `Help me fill in this form: ${cleanUrl} Ask me the questions, then give me the review link.`;
}

/** GET /c/:id — redirect to a new Claude chat with the message already written. */
export function claudeRoutes({ relay }: Deps) {
  const r = new Hono();
  r.get("/c/:id", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.html(notFoundPage(relay.host), 404);
    if (form.status === "closed") return c.html(closedPage(relay.host, form), 410);
    const q = encodeURIComponent(claudePrompt(relay.links(form.id).clean));
    return c.redirect(`https://claude.ai/new?q=${q}`, 302);
  });
  return r;
}
