import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { RelayError } from "../errors.js";
import type { ShareOptions } from "../service.js";
import { keyMatches, type Deps } from "./deps.js";

/** Bearer-key guard shared by /api and /mcp. `allowQueryKey` permits ?key= for connectors that cannot set headers. */
export function requireOwnerKey(ownerKey: string | undefined, allowQueryKey = false): MiddlewareHandler {
  return async (c, next) => {
    if (!ownerKey) return c.json({ error: "The creator API is disabled. Set RELAY_OWNER_KEY to enable it." }, 503);
    const header = c.req.header("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    const presented = bearer ?? (allowQueryKey ? c.req.query("key") : undefined);
    if (!presented || !keyMatches(presented, ownerKey)) {
      c.header("WWW-Authenticate", 'Bearer realm="relay"');
      return c.json({ error: "Unauthorized. Send the owner key as 'Authorization: Bearer <key>'." }, 401);
    }
    await next();
  };
}

function shareOptions(q: (k: string) => string | undefined): ShareOptions {
  const channel = q("channel");
  return { channel: channel === "email" ? "email" : "whatsapp", intro: q("intro") || undefined };
}

/** The creator API. Every route needs the owner key. */
export function apiRoutes({ relay, config }: Deps) {
  const r = new Hono();
  r.use("/api/*", requireOwnerKey(config.ownerKey));
  r.use("/api/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "Request body too large." }, 413) }));

  r.post("/api/forms", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      throw new RelayError(400, "Send the form as a JSON body.");
    }
    const { channel, intro, ...definition } = body;
    const share = shareOptions((k) => (k === "channel" ? (channel as string) : (intro as string)));
    return c.json(await relay.createForm(definition, share), 201);
  });

  r.get("/api/forms", async (c) => c.json(await relay.listForms()));

  r.get("/api/forms/:id", async (c) => c.json(await relay.getForm(c.req.param("id"), shareOptions((k) => c.req.query(k)))));

  r.get("/api/forms/:id/responses", async (c) => {
    const limit = c.req.query("limit");
    return c.json(
      await relay.getResponses(c.req.param("id"), {
        limit: limit ? Number(limit) : undefined,
        cursor: c.req.query("cursor") ?? null,
      }),
    );
  });

  r.get("/api/forms/:id/summary", async (c) => c.json(await relay.summarize(c.req.param("id"))));

  r.post("/api/forms/:id/close", async (c) => c.json(await relay.closeForm(c.req.param("id"))));

  // Permanent deletion of a form and its responses — for the host's data duties.
  // Deliberately not exposed as an MCP tool.
  r.delete("/api/forms/:id", async (c) => c.json(await relay.deleteForm(c.req.param("id"))));

  return r;
}
