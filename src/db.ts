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
    settings    TEXT,                       -- JSON object: thank_you, closes_at, max_responses
    owner_id    TEXT,                       -- account that owns the form; null means the operator ("owner")
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
  // The newest response (by rowid) the creator has been shown, per form. Powers "new since last check".
  // Accounts on a hosted Relay. The operator (RELAY_OWNER_KEY) is the implicit account "owner".
  `CREATE TABLE IF NOT EXISTS accounts (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    email      TEXT,
    key_hash   TEXT NOT NULL UNIQUE,        -- sha256 of the account key; the key itself is shown once
    plan       TEXT NOT NULL DEFAULT 'free',
    created_at INTEGER NOT NULL
  )`,
  // OAuth for MCP connectors: registered apps, and their codes and tokens (stored as SHA-256 hashes only).
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    id            TEXT PRIMARY KEY,
    name          TEXT,
    redirect_uris TEXT NOT NULL,            -- JSON array
    secret_hash   TEXT,                     -- null for public clients (PKCE only)
    created_at    INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_grants (
    hash       TEXT PRIMARY KEY,           -- sha256 of the code or token
    kind       TEXT NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
    client_id  TEXT NOT NULL,
    data       TEXT NOT NULL,              -- JSON: redirect_uri + PKCE challenge for codes; owner-key fingerprint for tokens
    expires_at INTEGER NOT NULL            -- unix seconds
  )`,
  `CREATE TABLE IF NOT EXISTS form_reads (
    form_id  TEXT PRIMARY KEY REFERENCES forms(id) ON DELETE CASCADE,
    last_seq INTEGER NOT NULL
  )`,
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
  settings: string | null;
  owner_id: string | null;
  status: "open" | "closed";
  created_at: number;
}

export interface FormListRow {
  id: string;
  title: string;
  status: "open" | "closed";
  settings: string | null;
  created_at: number;
  response_count: number;
  new_count: number;
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
  const init = () =>
    (ready ??= (async () => {
      await db.batch(SCHEMA, "write");
      // Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves old tables as they
      // were, so add what is missing. Two cold starts may race; "duplicate column" means it is done.
      const cols = (await db.execute("PRAGMA table_info(forms)")).rows.map((r) => String(r.name));
      if (!cols.includes("owner_id")) {
        await db.execute("ALTER TABLE forms ADD COLUMN owner_id TEXT").catch((e: Error) => {
          if (!/duplicate column/i.test(e.message)) throw e;
        });
      }
      if (!cols.includes("settings")) {
        await db.execute("ALTER TABLE forms ADD COLUMN settings TEXT").catch((e: Error) => {
          if (!/duplicate column/i.test(e.message)) throw e;
        });
      }
    })());

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
      run(`INSERT INTO forms (id, title, description, fields, settings, owner_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`, [
        row.id,
        row.title,
        row.description,
        row.fields,
        row.settings,
        row.owner_id,
        row.created_at,
      ]),

    getForm: (id: string) =>
      one<FormRow>(`SELECT id, title, description, fields, settings, owner_id, status, created_at FROM forms WHERE id = ?`, [id]),

    listForms: (owner: string) =>
      all<FormListRow>(
        `SELECT f.id, f.title, f.status, f.settings, f.created_at,
                (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS response_count,
                (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id
                    AND r.rowid > COALESCE((SELECT last_seq FROM form_reads WHERE form_id = f.id), 0)) AS new_count
           FROM forms f
          WHERE COALESCE(f.owner_id, 'owner') = ?
          ORDER BY f.created_at DESC, f.rowid DESC`,
        [owner],
      ),

    /** Responses an account's forms received since a moment (unix seconds), for the monthly limit. */
    responsesSince: async (owner: string, since: number) =>
      Number(
        (
          await one<{ n: number }>(
            `SELECT COUNT(*) AS n FROM responses r JOIN forms f ON f.id = r.form_id
              WHERE COALESCE(f.owner_id, 'owner') = ? AND r.submitted_at >= ?`,
            [owner, since],
          )
        )?.n ?? 0,
      ),

    insertAccount: (row: { id: string; name: string | null; email: string | null; key_hash: string; created_at: number }) =>
      run(`INSERT INTO accounts (id, name, email, key_hash, plan, created_at) VALUES (?, ?, ?, ?, 'free', ?)`, [
        row.id,
        row.name,
        row.email,
        row.key_hash,
        row.created_at,
      ]),

    accountByKeyHash: (hash: string) =>
      one<{ id: string; name: string | null; email: string | null; plan: string }>(`SELECT id, name, email, plan FROM accounts WHERE key_hash = ?`, [hash]),

    accountByEmail: (email: string) =>
      one<{ id: string }>(`SELECT id FROM accounts WHERE lower(email) = lower(?)`, [email]),

    accountById: (id: string) =>
      one<{ id: string; name: string | null; email: string | null; plan: string; key_hash: string }>(`SELECT id, name, email, plan, key_hash FROM accounts WHERE id = ?`, [id]),

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

    // Oldest first, for exports.
    allResponses: (formId: string) =>
      all<ResponseRow>(`SELECT rowid AS seq, id, answers, submitted_at FROM responses WHERE form_id = ? ORDER BY rowid ASC`, [formId]),

    allAnswers: async (formId: string) =>
      (await all<{ answers: string }>(`SELECT answers FROM responses WHERE form_id = ? ORDER BY rowid DESC`, [formId])).map(
        (r) => r.answers,
      ),

    updateForm: (row: Pick<FormRow, "id" | "title" | "description" | "fields" | "settings">) =>
      run(`UPDATE forms SET title = ?, description = ?, fields = ?, settings = ? WHERE id = ?`, [
        row.title,
        row.description,
        row.fields,
        row.settings,
        row.id,
      ]),

    lastSeen: async (formId: string) =>
      Number((await one<{ last_seq: number }>(`SELECT last_seq FROM form_reads WHERE form_id = ?`, [formId]))?.last_seq ?? 0),

    /** Record that the creator has seen responses up to `seq`. Never moves backwards. */
    markSeen: (formId: string, seq: number) =>
      run(
        `INSERT INTO form_reads (form_id, last_seq) VALUES (?, ?)
           ON CONFLICT(form_id) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)`,
        [formId, seq],
      ),

    // Oldest first, so a page of new responses can be marked seen without skipping any.
    responsesAfter: (formId: string, after: number, limit: number) =>
      all<ResponseRow>(
        `SELECT rowid AS seq, id, answers, submitted_at FROM responses
          WHERE form_id = ? AND rowid > ? ORDER BY rowid ASC LIMIT ?`,
        [formId, after, limit],
      ),

    countAfter: async (formId: string, after: number) =>
      Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM responses WHERE form_id = ? AND rowid > ?`, [formId, after]))?.n ?? 0),

    insertOAuthClient: (row: { id: string; name: string | null; redirect_uris: string; secret_hash: string | null; created_at: number }) =>
      run(`INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)`, [
        row.id,
        row.name,
        row.redirect_uris,
        row.secret_hash,
        row.created_at,
      ]),

    getOAuthClient: (id: string) =>
      one<{ id: string; name: string | null; redirect_uris: string; secret_hash: string | null }>(
        `SELECT id, name, redirect_uris, secret_hash FROM oauth_clients WHERE id = ?`,
        [id],
      ),

    /** Store a code or token by hash, clearing out expired ones while we're here. */
    insertGrant: async (hash: string, kind: "code" | "access" | "refresh", clientId: string, data: string, expiresAt: number, now: number) => {
      await run(`DELETE FROM oauth_grants WHERE expires_at < ?`, [now]);
      return run(`INSERT INTO oauth_grants (hash, kind, client_id, data, expires_at) VALUES (?, ?, ?, ?, ?)`, [hash, kind, clientId, data, expiresAt]);
    },

    /** Remove and return a grant in one statement, so a code or refresh token can be used only once. */
    takeGrant: (hash: string, kind: "code" | "refresh") =>
      one<{ client_id: string; data: string; expires_at: number }>(
        `DELETE FROM oauth_grants WHERE hash = ? AND kind = ? RETURNING client_id, data, expires_at`,
        [hash, kind],
      ),

    getGrant: (hash: string, kind: "access") =>
      one<{ client_id: string; data: string; expires_at: number }>(`SELECT client_id, data, expires_at FROM oauth_grants WHERE hash = ? AND kind = ?`, [hash, kind]),

    revokeGrant: (hash: string) => run(`DELETE FROM oauth_grants WHERE hash = ?`, [hash]),

    closeForm: (id: string) => run(`UPDATE forms SET status = 'closed' WHERE id = ?`, [id]),

    deleteForm: async (id: string) => {
      await init();
      const [, responses, forms] = await db.batch(
        [
          { sql: `DELETE FROM form_reads WHERE form_id = ?`, args: [id] },
          { sql: `DELETE FROM responses WHERE form_id = ?`, args: [id] },
          { sql: `DELETE FROM forms WHERE id = ?`, args: [id] },
        ],
        "write",
      );
      return { responses: responses!.rowsAffected, forms: forms!.rowsAffected };
    },
  };
}
