import { Hono } from "hono";
import { renderChatPrompt } from "../clean.js";
import { claudePage, closedPage, notFoundPage } from "../views/pages.js";
import type { Deps } from "./deps.js";

/**
 * Longest claude.ai/new?q= link Relay hands out. Most forms fit well within it; a very long
 * form gets the copy-and-paste page instead, so the link is never cut off.
 */
export const MAX_PREFILL_URL = 8000;

/** The short message for the copy-and-paste fallback. Claude fetches /a/:id when the person sends it. */
export function claudePrompt(cleanUrl: string): string {
  return `Help me fill in this form: ${cleanUrl} Ask me the questions, then give me the review link.`;
}

/**
 * GET /c/:id — one click into a new Claude chat with the whole form in the message.
 *
 * The questions travel inside the message rather than as a link to fetch: claude.ai will not
 * fetch a link that arrived in a prefilled message. The person sees the message and sends it.
 */
export function claudeRoutes({ relay }: Deps) {
  const r = new Hono();
  r.get("/c/:id", async (c) => {
    const form = await relay.findForm(c.req.param("id"));
    if (!form) return c.html(notFoundPage(relay.host), 404);
    if (form.status === "closed") return c.html(closedPage(relay.host, form), 410);
    const links = relay.links(form.id);
    const url = `https://claude.ai/new?q=${encodeURIComponent(renderChatPrompt(form, links))}`;
    if (url.length <= MAX_PREFILL_URL) return c.redirect(url, 302);
    return c.html(claudePage({ host: relay.host, form, message: claudePrompt(links.clean), fillUrl: `/f/${form.id}` }));
  });
  return r;
}
