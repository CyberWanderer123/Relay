import crypto from "node:crypto";
import type { Config } from "./config.js";
import type { Answers } from "./schema.js";
import type { StoredForm } from "./service.js";

/* One outgoing event: a POST to RELAY_WEBHOOK_URL for each new response, so Zapier, n8n, Slack
   or the creator's own code can react without polling. A failing or slow receiver never blocks
   or breaks a submission: the call times out after 3 seconds and errors are only logged. */

export interface ResponseCreatedEvent {
  event: "response.created";
  form: { id: string; title: string };
  response: { id: string; submitted_at: string; answers: Answers };
  fields: { id: string; label: string; type: string }[];
}

export async function sendResponseWebhook(
  config: Pick<Config, "webhookUrl" | "webhookSecret">,
  form: StoredForm,
  response: { id: string; submitted_at: string; answers: Answers },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!config.webhookUrl) return;
  const payload: ResponseCreatedEvent = {
    event: "response.created",
    form: { id: form.id, title: form.title },
    response,
    fields: form.fields.map((f) => ({ id: f.id, label: f.label, type: f.type })),
  };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Relay-Webhook/1",
    "x-relay-event": payload.event,
  };
  if (config.webhookSecret) {
    headers["x-relay-signature"] = `sha256=${crypto.createHmac("sha256", config.webhookSecret).update(body).digest("hex")}`;
  }
  try {
    const res = await fetchImpl(config.webhookUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(3000), redirect: "manual" });
    if (!res.ok) console.warn(`webhook: receiver answered HTTP ${res.status}`);
  } catch (err) {
    console.warn(`webhook: delivery failed (${(err as Error).name})`);
  }
}
