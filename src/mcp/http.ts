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
 */
export function mcpRoutes({ relay, config }: Deps) {
  const r = new Hono();
  const backend = localBackend(relay);

  r.all(
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
