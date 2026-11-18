import { loadConfig, loadDotEnv } from "../config.js";
import { openDb } from "../db.js";
import { RelayError } from "../errors.js";
import { createRelay } from "../service.js";

/* Permanently deletes a form and all of its responses.
   Usage: npm run forms:delete -- <form-id> --yes */

loadDotEnv();
const [id, flag] = process.argv.slice(2);
if (!id) {
  console.error("Usage: npm run forms:delete -- <form-id> --yes");
  process.exit(1);
}

const config = loadConfig();
const relay = createRelay(openDb(config.dbUrl, config.dbAuthToken), config.baseUrl);

try {
  const form = await relay.getForm(id);
  if (flag !== "--yes") {
    console.log(`This will permanently delete “${form.title}” and its ${form.response_count} response(s).`);
    console.log("Run again with --yes to confirm.");
    process.exit(0);
  }
  const r = await relay.deleteForm(id);
  console.log(`Deleted form ${id} and ${r.responses_deleted} response(s).`);
} catch (err) {
  console.error(err instanceof RelayError ? err.message : err);
  process.exit(1);
}
