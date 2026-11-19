#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, loadDotEnv } from "../config.js";
import { openDb } from "../db.js";
import { createRelay } from "../service.js";
import { httpBackend, localBackend, type Backend } from "./backend.js";
import { createMcpServer } from "./tools.js";

/* Local MCP entry point (Claude Desktop and other stdio clients).
   - With RELAY_URL + RELAY_OWNER_KEY: talks to a hosted Relay over HTTPS.
   - Otherwise: opens the database directly (RELAY_DB_URL / TURSO_DATABASE_URL, or the local file).
   stdout belongs to the MCP protocol, so diagnostics go to stderr. */

loadDotEnv();
const config = loadConfig();
const remote = process.env.RELAY_URL?.trim();

let backend: Backend;
if (remote) {
  if (!config.ownerKey) {
    console.error("relay-mcp: RELAY_URL is set but RELAY_OWNER_KEY is missing.");
    process.exit(1);
  }
  backend = httpBackend(remote, config.ownerKey);
  console.error(`relay-mcp: using hosted Relay at ${remote}`);
} else {
  backend = localBackend(createRelay(openDb(config.dbUrl, config.dbAuthToken), config.baseUrl), config.ownerKey);
  console.error(`relay-mcp: using database ${config.dbUrl.split("?")[0]}; links point to ${config.baseUrl}`);
}

await createMcpServer(backend).connect(new StdioServerTransport());
