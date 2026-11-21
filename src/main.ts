/* Local / self-hosted entry point: a long-running Node server.
   On Vercel, src/index.ts is used instead. */
import { serve } from "@hono/node-server";
import { loadConfig, loadDotEnv } from "./config.js";
import { createApp } from "./create-app.js";
import { openDb } from "./db.js";
import { createRelay } from "./service.js";

loadDotEnv();
const config = loadConfig();
const db = openDb(config.dbUrl, config.dbAuthToken);
const relay = createRelay(db, config.baseUrl, { hosted: config.hosted, monthlyResponses: config.monthlyResponses, contactEmail: config.contactEmail });

try {
  await relay.ready();
} catch (err) {
  console.error(`Could not open the database at ${config.dbUrl}:`, (err as Error).message);
  process.exit(1);
}

const app = createApp(relay, config);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Relay listening on http://localhost:${info.port}`);
  console.log(`Public links use ${config.baseUrl}`);
  console.log(`Database: ${config.dbUrl.startsWith("libsql:") ? "Turso (" + new URL(config.dbUrl).host + ")" : config.dbUrl}`);
  if (!config.ownerKey) console.warn("RELAY_OWNER_KEY is not set — the creator API and /mcp are disabled.");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use — another Relay (or npm run dev) is probably running.`);
    console.error(`Stop it, or start on another port, e.g. PORT=8788 npm start`);
  } else {
    console.error(err);
  }
  db.close();
  process.exit(1);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
