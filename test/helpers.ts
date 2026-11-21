import { createApp } from "../src/create-app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createRelay } from "../src/service.js";

export const KEY = "test-owner-key-0123456789";

export function setup(overrides: Partial<ReturnType<typeof loadConfig>> = {}) {
  const config = {
    ...loadConfig({ RELAY_BASE_URL: "https://relay.test", RELAY_OWNER_KEY: KEY, RELAY_LOG: "0" }),
    dbUrl: ":memory:",
    ...overrides,
  };
  const db = openDb(":memory:");
  const relay = createRelay(db, config.baseUrl, { hosted: config.hosted, monthlyResponses: config.monthlyResponses, contactEmail: config.contactEmail });
  const app = createApp(relay, config);
  return { app, relay, db, config };
}

export const auth = { Authorization: `Bearer ${KEY}` };

export const sampleForm = {
  title: "Workshop feedback",
  description: "Five quick questions.",
  fields: [
    { id: "q1", type: "single_choice", label: "How was the workshop?", required: true, options: ["Great", "Okay", "Poor"] },
    { id: "q2", type: "multi_choice", label: "Useful sessions?", options: ["Intro", "Lab", "Panel"] },
    { id: "q3", type: "number", label: "Score 0–10", required: true },
    { id: "q4", type: "long_text", label: "What should we improve?" },
    { id: "q5", type: "email", label: "Email" },
  ],
} as const;

export function form(body: Record<string, string | string[]>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return { method: "POST", body: p, headers: { "Content-Type": "application/x-www-form-urlencoded" } };
}

/** Number of saved responses, read straight from the database. */
export async function countResponses(db: ReturnType<typeof openDb>): Promise<number> {
  return Number((await db.execute("SELECT COUNT(*) AS n FROM responses")).rows[0]!.n);
}

/** Answers of the first saved response, read straight from the database. */
export async function firstAnswers(db: ReturnType<typeof openDb>): Promise<unknown> {
  return JSON.parse(String((await db.execute("SELECT answers FROM responses")).rows[0]!.answers));
}
