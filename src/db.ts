import fs from "node:fs";
import path from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client";

/* SQLite via libSQL. The same code talks to:
   - Turso in production (libsql://… with an auth token) — works on Vercel, which has no lasting disk
   - a local file in development (file:./data/relay.db)
   - memory in tests (:memory:)                                               */

export type DB = Client;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forms (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    fields      TEXT NOT NULL,              -- JSON array of field objects
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at  INTEGER NOT NULL            -- unix seconds
  )`,
  `CREATE TABLE IF NOT EXISTS responses (
    id           TEXT PRIMARY KEY,
    form_id      TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    answers      TEXT NOT NULL,             -- JSON object keyed by field id
    submitted_at INTEGER NOT NULL           -- unix seconds
  )`,
  `CREATE INDEX IF NOT EXISTS responses_by_form ON responses (form_id)`,
];

export function openDb(url: string, authToken?: string): DB {
  if (url.startsWith("file:")) {
    const file = url.slice("file:".length);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return createClient({ url, authToken: authToken || undefined });
}

export interface FormRow {
  id: string;
  title: string;
  description: string | null;
  fields: string;
  status: "open" | "closed";
  created_at: number;
}

export interface FormListRow {
  id: string;
  title: string;
  status: "open" | "closed";
  created_at: number;
  response_count: number;
}

export interface ResponseRow {
  seq: number;
  id: string;
  answers: string;
  submitted_at: number;
}

export function makeQueries(db: DB) {
  // Create the tables once, lazily, before the first query on this client.
  let ready: Promise<unknown> | undefined;
  const init = () => (ready ??= db.batch(SCHEMA, "write"));

  async function all<T>(sql: string, args: InArgs = []): Promise<T[]> {
    await init();
    return (await db.execute({ sql, args })).rows as unknown as T[];
  }
  async function one<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
    return (await all<T>(sql, args))[0];
  }
  async function run(sql: string, args: InArgs = []): Promise<number> {
    await init();
    return (await db.execute({ sql, args })).rowsAffected;
  }

  return {
    init,

    insertForm: (row: Omit<FormRow, "status">) =>
      run(`INSERT INTO forms (id, title, description, fields, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`, [
        row.id,
        row.title,
        row.description,
        row.fields,
        row.created_at,
      ]),

    getForm: (id: string) =>
      one<FormRow>(`SELECT id, title, description, fields, status, created_at FROM forms WHERE id = ?`, [id]),

    listForms: () =>
      all<FormListRow>(
        `SELECT f.id, f.title, f.status, f.created_at,
                (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS response_count
           FROM forms f
          ORDER BY f.created_at DESC, f.rowid DESC`,
      ),

    stats: async (formId: string) =>
      (await one<{ n: number; first: number | null; last: number | null }>(
        `SELECT COUNT(*) AS n, MIN(submitted_at) AS first, MAX(submitted_at) AS last FROM responses WHERE form_id = ?`,
        [formId],
      ))!,

    insertResponse: (id: string, formId: string, answers: string, at: number) =>
      run(`INSERT INTO responses (id, form_id, answers, submitted_at) VALUES (?, ?, ?, ?)`, [id, formId, answers, at]),

    // Newest first. The cursor is the rowid of the last item on the previous page.
    pageResponses: (formId: string, before: number, limit: number) =>
      all<ResponseRow>(
        `SELECT rowid AS seq, id, answers, submitted_at FROM responses
          WHERE form_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?`,
        [formId, before, limit],
      ),

    allAnswers: async (formId: string) =>
      (await all<{ answers: string }>(`SELECT answers FROM responses WHERE form_id = ? ORDER BY rowid DESC`, [formId])).map(
        (r) => r.answers,
      ),

    closeForm: (id: string) => run(`UPDATE forms SET status = 'closed' WHERE id = ?`, [id]),

    deleteForm: async (id: string) => {
      await init();
      const [responses, forms] = await db.batch(
        [
          { sql: `DELETE FROM responses WHERE form_id = ?`, args: [id] },
          { sql: `DELETE FROM forms WHERE id = ?`, args: [id] },
        ],
        "write",
      );
      return { responses: responses!.rowsAffected, forms: forms!.rowsAffected };
    },
  };
}
