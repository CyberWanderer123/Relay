import { Hono, type Context } from "hono";
import { ASSISTANTS, findAssistant, type Assistant } from "../assistants.js";
import { renderChatPrompt } from "../clean.js";
import { assistantPage, closedPage, notFoundPage } from "../views/pages.js";
import type { Deps } from "./deps.js";

/**
 * Longest prefilled new-chat link Relay hands out. Most forms fit well within it; a very long
 * form gets the copy-and-paste page instead, so the link is never cut off.
 */
export const MAX_PREFILL_URL = 8000;

/** The short message for the copy-and-paste fallback. The assistant reads /a/:id when the person sends it. */
export function claudePrompt(cleanUrl: string): string {
  return `Help me fill in this form: ${cleanUrl} Ask me the questions, then give me the review link.`;
}

/**
 * GET /c/:id/:assistant (and /c/:id, which means Claude) — one click into a new chat with the
 * whole form in the message.
 *
 * The questions travel inside the message rather than as a link to fetch: assistants may refuse
 * to fetch a link that arrived in a prefilled message (claude.ai does). The person sees the
 * message and sends it.
 */
export function claudeRoutes({ relay }: Deps) {
  const r = new Hono();

  const open = async (c: Context, assistant: Assistant | undefined) => {
    const form = await relay.findForm(c.req.param("id") ?? "");
    if (!form || !assistant) return c.html(notFoundPage(relay.host), 404);
    if (form.status === "closed") return c.html(closedPage(relay.host, form), 410);
    const links = relay.links(form.id);
    const url = assistant.prefill(encodeURIComponent(renderChatPrompt(form, links)));
    if (url.length <= MAX_PREFILL_URL) return c.redirect(url, 302);
    return c.html(assistantPage({ host: relay.host, form, assistant, message: claudePrompt(links.clean), fillUrl: `/f/${form.id}` }));
  };

  r.get("/c/:id", (c) => open(c, ASSISTANTS.claude));
  r.get("/c/:id/:assistant", (c) => open(c, findAssistant(c.req.param("assistant"))));
  return r;
}
