import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requireOwnerKey } from "../routes/api.js";
import type { Deps } from "../routes/deps.js";
import { localBackend } from "./backend.js";
import { createMcpServer } from "./tools.js";

/**
 * Remote MCP endpoint at /mcp (Streamable HTTP, stateless, JSON responses).
 * Auth: the owner key as a Bearer header, or ?key= for connector UIs that can
 * only take a URL. Query strings are never logged.
 *
 * Only POST is served. Relay keeps no sessions and never pushes messages, so a
 * GET (open an event stream) or DELETE (end a session) has nothing to do. The
 * MCP spec lets a server answer those with 405, and clients carry on without a
 * stream — whereas an open stream would hang a serverless function until timeout.
 */
export function mcpRoutes({ relay, config }: Deps) {
  const r = new Hono();
  const backend = localBackend(relay, config.ownerKey);

  const notAllowed = () =>
    new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Relay's MCP endpoint is stateless; use POST." }, id: null }),
      { status: 405, headers: { Allow: "POST", "Content-Type": "application/json" } },
    );
  r.get("/mcp", notAllowed);
  r.delete("/mcp", notAllowed);

  r.post(
    "/mcp",
    requireOwnerKey(config.ownerKey, true),
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "Request body too large." }, 413) }),
    async (c) => {
      const server = createMcpServer(backend);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    },
  );

  return r;
}
