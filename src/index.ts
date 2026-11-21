/* Vercel entry point. Vercel detects a default-exported Hono app in src/index.ts
   and runs it as a function — no server to start. For local use, see src/main.ts. */
import { assertDurableDb, loadConfig } from "./config.js";
import { createApp } from "./create-app.js";
import { openDb } from "./db.js";
import { createRelay } from "./service.js";

const config = loadConfig();
assertDurableDb(config);

const relay = createRelay(openDb(config.dbUrl, config.dbAuthToken), config.baseUrl, { hosted: config.hosted, monthlyResponses: config.monthlyResponses, contactEmail: config.contactEmail });
const app = createApp(relay, config);

export default app;
