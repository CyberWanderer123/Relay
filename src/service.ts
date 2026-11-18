import crypto from "node:crypto";
import { reviewLinkTemplate } from "./clean.js";
import { makeQueries, type DB } from "./db.js";
import { notFound, RelayError } from "./errors.js";
import {
  cleanText,
  isChoice,
  LIMITS,
  normalizeForm,
  validateAnswers,
  type Answers,
  type Field,
  type RawAnswers,
} from "./schema.js";

/* The service layer. The HTTP API, the web pages and the MCP tools all call
   these functions; none of them talks to the database directly. */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Lowercase alphanumeric id with no modulo bias (14 chars ≈ 72 bits). */
export function randomId(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.randomBytes(length * 2)) {
      if (b < 252) out += ALPHABET[b % 36];
      if (out.length === length) break;
    }
  }
  return out;
}

export const FORM_ID_RE = /^[a-z0-9]{14}$/;

export type Channel = "whatsapp" | "email";
export interface ShareOptions {
  channel?: Channel;
  /** Opening line written by the creator, e.g. "Hi! Please share your feedback on the workshop." */
  intro?: string;
}

export interface StoredForm {
  id: string;
  title: string;
  description: string | null;
  fields: Field[];
  status: "open" | "closed";
  created_at: number;
}

export interface FormLinks {
  fill: string;
  claude: string;
  clean: string;
  review: string;
}

const iso = (unix: number | null) => (unix == null ? null : new Date(unix * 1000).toISOString());
const now = () => Math.floor(Date.now() / 1000);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function createRelay(db: DB, baseUrl: string) {
  const q = makeQueries(db);
  const host = new URL(baseUrl).host;

  const links = (id: string): FormLinks => ({
    fill: `${baseUrl}/f/${id}`,
    claude: `${baseUrl}/c/${id}`,
    clean: `${baseUrl}/a/${id}`,
    review: `${baseUrl}/f/${id}/review`,
  });

  async function findForm(id: string): Promise<StoredForm | null> {
    if (!FORM_ID_RE.test(id)) return null;
    const row = await q.getForm(id);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      created_at: Number(row.created_at),
      fields: JSON.parse(row.fields) as Field[],
    };
  }

  async function requireForm(id: string): Promise<StoredForm> {
    const form = await findForm(id);
    if (!form) throw notFound();
    return form;
  }

  function shareMessage(form: StoredForm, opts: ShareOptions = {}): string {
    const l = links(form.id);
    const intro = opts.intro ? clip(cleanText(opts.intro), LIMITS.maxIntro) : "";
    if (opts.channel === "email") {
      return [
        `Subject: ${form.title}`,
        "",
        "Hi,",
        "",
        intro || `Could you take a couple of minutes to fill in “${form.title}”?`,
        "",
        `Fill it in here: ${l.fill}`,
        `Or fill it in with Claude: ${l.claude}`,
        "",
        "Thank you!",
      ].join("\n");
    }
    return [
      intro || `Hi! Could you fill in “${form.title}”? It only takes a minute.`,
      `Quick form: ${l.fill}`,
      `Or fill it with Claude: ${l.claude}`,
    ].join("\n");
  }

  return {
    baseUrl,
    host,
    links,
    findForm,
    requireForm,
    shareMessage,
    /** Create the tables if needed. Queries do this lazily; call it to fail fast at startup. */
    ready: () => q.init(),

    async createForm(input: unknown, share: ShareOptions = {}) {
      const def = normalizeForm(input);
      const form: StoredForm = { id: randomId(14), ...def, status: "open", created_at: now() };
      await q.insertForm({
        id: form.id,
        title: form.title,
        description: form.description,
        fields: JSON.stringify(form.fields),
        created_at: form.created_at,
      });
      return {
        id: form.id,
        title: form.title,
        status: form.status,
        question_count: form.fields.length,
        links: { fill: links(form.id).fill, claude: links(form.id).claude, review_template: reviewLinkTemplate(form, links(form.id)) },
        share_message: shareMessage(form, share),
      };
    },

    async listForms() {
      return {
        forms: (await q.listForms()).map((f) => ({
          id: f.id,
          title: f.title,
          status: f.status,
          response_count: Number(f.response_count),
          created_at: iso(Number(f.created_at)),
        })),
      };
    },

    async getForm(id: string, share: ShareOptions = {}) {
      const form = await requireForm(id);
      const s = await q.stats(id);
      return {
        id: form.id,
        title: form.title,
        description: form.description,
        status: form.status,
        created_at: iso(form.created_at),
        response_count: Number(s.n),
        fields: form.fields,
        links: { fill: links(id).fill, claude: links(id).claude, review_template: reviewLinkTemplate(form, links(id)) },
        share_message: shareMessage(form, share),
      };
    },

    async getResponses(id: string, opts: { limit?: number; cursor?: string | null } = {}) {
      const form = await requireForm(id);
      const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 50);
      let before = Number.MAX_SAFE_INTEGER;
      if (opts.cursor) {
        if (!/^\d{1,15}$/.test(opts.cursor)) throw new RelayError(400, "The cursor is not valid.");
        before = Number(opts.cursor);
      }
      const rows = await q.pageResponses(id, before, limit + 1);
      const page = rows.slice(0, limit);
      return {
        form_id: form.id,
        title: form.title,
        total: Number((await q.stats(id)).n),
        order: "newest first",
        responses: page.map((r) => ({
          id: r.id,
          submitted_at: iso(Number(r.submitted_at)),
          answers: JSON.parse(r.answers) as Answers,
        })),
        next_cursor: rows.length > limit ? String(page[page.length - 1]!.seq) : null,
      };
    },

    async summarize(id: string) {
      const form = await requireForm(id);
      const s = await q.stats(id);
      const all = (await q.allAnswers(id)).map((a) => JSON.parse(a) as Answers);

      const questions = form.fields.map((f) => {
        const values = all.map((a) => a[f.id]).filter((v) => v !== undefined);
        const base = { id: f.id, label: f.label, type: f.type, answered: values.length };

        if (isChoice(f.type)) {
          const counts: Record<string, number> = Object.fromEntries((f.options ?? []).map((o) => [o, 0]));
          for (const v of values) for (const o of Array.isArray(v) ? v : [String(v)]) if (o in counts) counts[o]!++;
          return { ...base, counts };
        }
        if (f.type === "number") {
          const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
          if (!nums.length) return { ...base, min: null, max: null, mean: null, median: null };
          const mid = Math.floor(nums.length / 2);
          const median = nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
          const round = (n: number) => Math.round(n * 100) / 100;
          return {
            ...base,
            min: nums[0]!,
            max: nums[nums.length - 1]!,
            mean: round(nums.reduce((a, b) => a + b, 0) / nums.length),
            median: round(median),
          };
        }
        // Text and email: a handful of the most recent answers, trimmed.
        return { ...base, samples: values.slice(0, 10).map((v) => clip(String(v), 280)) };
      });

      return {
        form_id: form.id,
        title: form.title,
        status: form.status,
        total_responses: Number(s.n),
        first_response_at: iso(s.first == null ? null : Number(s.first)),
        last_response_at: iso(s.last == null ? null : Number(s.last)),
        questions,
      };
    },

    async closeForm(id: string) {
      const form = await requireForm(id);
      if (form.status === "open") await q.closeForm(id);
      return {
        id,
        title: form.title,
        status: "closed" as const,
        was_already_closed: form.status === "closed",
        final_response_count: Number((await q.stats(id)).n),
      };
    },

    /** Permanently removes a form and its responses. Not exposed as an MCP tool. */
    async deleteForm(id: string) {
      await requireForm(id);
      const r = await q.deleteForm(id);
      return { id, deleted: true, responses_deleted: r.responses };
    },

    validate(form: StoredForm, raw: RawAnswers) {
      return validateAnswers(form.fields, raw);
    },

    async submit(id: string, raw: RawAnswers) {
      const form = await requireForm(id);
      if (form.status === "closed") throw new RelayError(410, "This form is closed.");
      const result = validateAnswers(form.fields, raw);
      if (!result.ok) return result;
      const responseId = randomId(16);
      await q.insertResponse(responseId, id, JSON.stringify(result.answers), now());
      return { ok: true as const, response_id: responseId };
    },
  };
}

export type Relay = ReturnType<typeof createRelay>;
