import crypto from "node:crypto";
import { ASSISTANTS } from "./assistants.js";
import { reviewLinkTemplate } from "./clean.js";
import { exportFilename, responsesCsv } from "./export.js";
import { makeQueries, type DB } from "./db.js";
import { notFound, RelayError } from "./errors.js";
import {
  cleanText,
  isChoice,
  isNumeric,
  LIMITS,
  normalizeForm,
  RANGES,
  validateAnswers,
  type Answers,
  type Field,
  type FormSettings,
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
  settings: FormSettings;
  /** Effective status: a form past its deadline or at its response limit counts as closed. */
  status: "open" | "closed";
  /** "paused": a free hosted account reached its monthly response limit. */
  closed_reason?: "closed" | "deadline" | "full" | "paused";
  created_at: number;
  /** The account that owns the form; "owner" is the operator (RELAY_OWNER_KEY). */
  owner: string;
}

/** The operator's account id. Single-owner Relays have only this account. */
export const OPERATOR = "owner";

const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

/** Hosted mode: open sign-ups and a monthly response limit for free accounts. Off for self-hosted Relays. */
export interface HostingOptions {
  hosted?: boolean;
  monthlyResponses?: number;
  contactEmail?: string;
}

/** Start of the current calendar month (UTC) and of the next, in unix seconds. */
export function monthWindow(at = new Date()): { start: number; next: number } {
  const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1) / 1000;
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1) / 1000;
  return { start, next };
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

export function createRelay(db: DB, baseUrl: string, hosting: HostingOptions = {}) {
  const q = makeQueries(db);
  const host = new URL(baseUrl).host;
  const monthlyLimit = hosting.monthlyResponses ?? 250;

  /** Usage against the free monthly limit. Unlimited for the operator, paid plans and self-hosted Relays. */
  async function usage(owner: string) {
    const { start, next } = monthWindow();
    const used = await q.responsesSince(owner, start);
    let limited = false;
    if (hosting.hosted && owner !== OPERATOR) {
      const account = await q.accountById(owner);
      limited = !account || account.plan === "free";
    }
    const limit = limited ? monthlyLimit : null;
    const paused = limit !== null && used >= limit;
    const contact = hosting.contactEmail ? ` or email ${hosting.contactEmail} for more` : "";
    const notice = paused
      ? `This account reached its free limit of ${limit} responses this month, so its forms are paused until ${iso(next)!.slice(0, 10)}. To keep collecting, run your own Relay (free, no limits: ${baseUrl}/#start)${contact}.`
      : limit !== null && used >= Math.floor(limit * 0.8)
        ? `This account has used ${used} of its ${limit} free responses this month. At ${limit}, forms pause until ${iso(next)!.slice(0, 10)}.`
        : undefined;
    return { responses_this_month: used, limit, resets_at: iso(next), paused, ...(notice && { notice }) };
  }

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
    const settings = (row.settings ? JSON.parse(row.settings) : {}) as FormSettings;
    let closed_reason: StoredForm["closed_reason"];
    if (row.status === "closed") closed_reason = "closed";
    else if (settings.closes_at && Date.parse(settings.closes_at) <= Date.now()) closed_reason = "deadline";
    else if (settings.max_responses && Number((await q.stats(row.id)).n) >= settings.max_responses) closed_reason = "full";
    const owner = row.owner_id ?? OPERATOR;
    if (!closed_reason && hosting.hosted && owner !== OPERATOR && (await usage(owner)).paused) closed_reason = "paused";
    return {
      owner,
      id: row.id,
      title: row.title,
      description: row.description,
      status: closed_reason ? "closed" : "open",
      ...(closed_reason && { closed_reason }),
      created_at: Number(row.created_at),
      fields: JSON.parse(row.fields) as Field[],
      settings,
    };
  }

  /** "open" or "closed", counting a passed deadline or a reached limit as closed. */
  function effectiveStatus(status: "open" | "closed", settingsJson: string | null, responses: number): "open" | "closed" {
    if (status === "closed") return "closed";
    const s = (settingsJson ? JSON.parse(settingsJson) : {}) as FormSettings;
    if (s.closes_at && Date.parse(s.closes_at) <= Date.now()) return "closed";
    if (s.max_responses && responses >= s.max_responses) return "closed";
    return "open";
  }

  /** How many more responses a form with a limit can take, or null without one. */
  async function spotsLeft(form: StoredForm): Promise<number | null> {
    if (!form.settings.max_responses) return null;
    return Math.max(0, form.settings.max_responses - Number((await q.stats(form.id)).n));
  }

  /** Plain-language summary of a form's settings changes, for update_form. */
  function settingsChanges(before: FormSettings, after: FormSettings): string[] {
    const out: string[] = [];
    if (JSON.stringify(before.thank_you ?? {}) !== JSON.stringify(after.thank_you ?? {})) {
      out.push(after.thank_you ? "Changed the thank-you page." : "Removed the custom thank-you page.");
    }
    if (before.closes_at !== after.closes_at) {
      out.push(after.closes_at ? `Set the form to close at ${after.closes_at}.` : "Removed the deadline.");
    }
    if (before.max_responses !== after.max_responses) {
      out.push(after.max_responses ? `Limited the form to ${after.max_responses} responses.` : "Removed the response limit.");
    }
    return out;
  }

  /** A form the given account may manage. Other accounts' forms look exactly like missing ones. */
  async function requireForm(id: string, owner?: string): Promise<StoredForm> {
    const form = await findForm(id);
    if (!form || (owner !== undefined && form.owner !== owner)) throw notFound();
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
        "You can also answer in Claude, ChatGPT or another assistant from that page.",
        "",
        "Thank you!",
      ].join("\n");
    }
    return [
      intro || `Hi! Could you fill in “${form.title}”? It only takes a minute.`,
      `Form: ${l.fill}`,
      "(You can also answer it in Claude or ChatGPT from that page.)",
    ].join("\n");
  }

  /** Links returned to the creator's agent. The share message carries only `fill`. */
  const creatorLinks = (form: StoredForm) => ({
    fill: links(form.id).fill,
    assistants: Object.fromEntries(Object.keys(ASSISTANTS).map((k) => [k, `${baseUrl}/c/${form.id}/${k}`])),
    review_template: reviewLinkTemplate(form, links(form.id)),
    // Ready-to-paste HTML for the sites the form allows; the iframe works only on those sites.
    ...(form.settings.embed_origins?.length && {
      embed_code: `<iframe src="${baseUrl}/f/${form.id}?embed=1" title="${form.title.replace(/["<>&]/g, "")}" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`,
    }),
  });

  return {
    baseUrl,
    host,
    links,
    findForm,
    spotsLeft,
    requireForm,
    shareMessage,
    usage,
    hosted: Boolean(hosting.hosted),
    contactEmail: hosting.contactEmail,

    /** Create a free account. Returns its key once; only a hash is stored. */
    async createAccount(input: { name?: string; email?: string }) {
      const id = `acct_${randomId(16)}`;
      const key = `rly_key_${crypto.randomBytes(32).toString("base64url")}`;
      const name = input.name ? cleanText(input.name).slice(0, 80) || null : null;
      const email = input.email ? cleanText(input.email).slice(0, 254) || null : null;
      await q.insertAccount({ id, name, email, key_hash: hashKey(key), created_at: now() });
      return { id, key, name };
    },

    /** The account an account key belongs to, or null. */
    async accountForKey(key: string) {
      if (!key.startsWith("rly_key_")) return null;
      return (await q.accountByKeyHash(hashKey(key))) ?? null;
    },

    /** Current key hash of an account, so OAuth tokens die when an account's key changes. */
    accountKeyHash: async (id: string) => (await q.accountById(id))?.key_hash ?? null,

    /** Create the tables if needed. Queries do this lazily; call it to fail fast at startup. */
    ready: () => q.init(),
    /** OAuth storage for the MCP connector sign-in (src/oauth.ts). */
    oauthStore: {
      insertClient: q.insertOAuthClient,
      getClient: q.getOAuthClient,
      insertGrant: q.insertGrant,
      takeGrant: q.takeGrant,
      getGrant: q.getGrant,
      revokeGrant: q.revokeGrant,
    },

    async createForm(input: unknown, share: ShareOptions = {}, owner: string = OPERATOR) {
      const def = normalizeForm(input);
      const form: StoredForm = { id: randomId(14), ...def, status: "open", created_at: now(), owner };
      await q.insertForm({
        id: form.id,
        title: form.title,
        description: form.description,
        fields: JSON.stringify(form.fields),
        settings: Object.keys(form.settings).length ? JSON.stringify(form.settings) : null,
        owner_id: owner,
        created_at: form.created_at,
      });
      return {
        id: form.id,
        title: form.title,
        status: form.status,
        question_count: form.fields.length,
        links: creatorLinks(form),
        share_message: shareMessage(form, share),
        usage: await usage(owner),
      };
    },

    async listForms(owner: string = OPERATOR) {
      return {
        usage: await usage(owner),
        forms: (await q.listForms(owner)).map((f) => ({
          id: f.id,
          title: f.title,
          status: effectiveStatus(f.status, f.settings, Number(f.response_count)),
          response_count: Number(f.response_count),
          new_responses: Number(f.new_count),
          created_at: iso(Number(f.created_at)),
        })),
      };
    },

    async getForm(id: string, share: ShareOptions = {}, owner: string = OPERATOR) {
      const form = await requireForm(id, owner);
      const s = await q.stats(id);
      return {
        id: form.id,
        title: form.title,
        description: form.description,
        status: form.status,
        ...(form.closed_reason && { closed_reason: form.closed_reason }),
        created_at: iso(form.created_at),
        response_count: Number(s.n),
        ...(form.settings.max_responses && { spots_left: Math.max(0, form.settings.max_responses - Number(s.n)) }),
        new_responses: await q.countAfter(id, await q.lastSeen(id)),
        fields: form.fields,
        settings: form.settings,
        links: creatorLinks(form),
        share_message: shareMessage(form, share),
        usage: await usage(owner),
      };
    },

    /**
     * Read responses. By default newest first, a page at a time. With `onlyNew`, only responses
     * the creator has not been shown yet, oldest first. Either way, what is returned counts as seen.
     */
    async getResponses(id: string, opts: { limit?: number; cursor?: string | null; onlyNew?: boolean } = {}, owner: string = OPERATOR) {
      const form = await requireForm(id, owner);
      const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 50);
      const shape = (r: { id: string; submitted_at: number; answers: string }) => ({
        id: r.id,
        submitted_at: iso(Number(r.submitted_at)),
        answers: JSON.parse(r.answers) as Answers,
      });

      if (opts.onlyNew) {
        const rows = await q.responsesAfter(id, await q.lastSeen(id), limit);
        if (rows.length) await q.markSeen(id, Number(rows[rows.length - 1]!.seq));
        const remaining = rows.length ? await q.countAfter(id, Number(rows[rows.length - 1]!.seq)) : 0;
        return {
          form_id: form.id,
          title: form.title,
          total: Number((await q.stats(id)).n),
          order: "oldest first (new responses only)",
          responses: rows.map(shape),
          remaining_new: remaining,
          next_cursor: null,
        };
      }

      let before = Number.MAX_SAFE_INTEGER;
      if (opts.cursor) {
        if (!/^\d{1,15}$/.test(opts.cursor)) throw new RelayError(400, "The cursor is not valid.");
        before = Number(opts.cursor);
      }
      const rows = await q.pageResponses(id, before, limit + 1);
      const page = rows.slice(0, limit);
      if (page.length) await q.markSeen(id, Number(page[0]!.seq));
      return {
        form_id: form.id,
        title: form.title,
        total: Number((await q.stats(id)).n),
        order: "newest first",
        responses: page.map(shape),
        next_cursor: rows.length > limit ? String(page[page.length - 1]!.seq) : null,
      };
    },

    async summarize(id: string, owner: string = OPERATOR) {
      const form = await requireForm(id, owner);
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
        if (isNumeric(f.type)) {
          const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
          const round = (n: number) => Math.round(n * 100) / 100;
          const stats = nums.length
            ? (() => {
                const mid = Math.floor(nums.length / 2);
                const median = nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
                return { min: nums[0]!, max: nums[nums.length - 1]!, mean: round(nums.reduce((a, b) => a + b, 0) / nums.length), median: round(median) };
              })()
            : { min: null, max: null, mean: null, median: null };
          if (f.type === "number") return { ...base, ...stats };
          // rating and scale: also how many picked each value.
          const { min, max } = RANGES[f.type];
          const counts: Record<string, number> = {};
          for (let k = min; k <= max; k++) counts[k] = nums.filter((n) => n === k).length;
          if (f.type === "rating" || !nums.length) return { ...base, ...stats, counts };
          // Net Promoter Score: % scoring 9–10 minus % scoring 0–6.
          const nps = Math.round(((nums.filter((n) => n >= 9).length - nums.filter((n) => n <= 6).length) / nums.length) * 100);
          return { ...base, ...stats, counts, nps };
        }
        if (f.type === "date") {
          const dates = values.map(String).sort();
          return { ...base, earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null, samples: values.slice(0, 10).map(String) };
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

    /**
     * Replace a form's title, description and questions. Existing questions keep their ids, so their
     * answers stay attached. Once a form has answers, changes that would make them misleading are
     * refused: changing a question's type, or removing an option someone chose.
     */
    async updateForm(id: string, input: unknown, owner: string = OPERATOR) {
      const form = await requireForm(id, owner);
      const def = normalizeForm(input, { reservedIds: form.fields.map((f) => f.id) });
      const answers = (await q.allAnswers(id)).map((a) => JSON.parse(a) as Answers);
      const before = new Map(form.fields.map((f) => [f.id, f]));
      const after = new Map(def.fields.map((f) => [f.id, f]));
      const answeredWith = (fieldId: string) => answers.filter((a) => a[fieldId] !== undefined);

      const problems: string[] = [];
      const changes: string[] = [];
      for (const f of def.fields) {
        const old = before.get(f.id);
        if (!old) {
          changes.push(`Added "${f.label}" (${f.id}).`);
          continue;
        }
        const answered = answeredWith(f.id);
        if (old.type !== f.type) {
          if (answered.length) {
            problems.push(`${f.id} ("${old.label}"): can't change the type from ${old.type} to ${f.type}, because ${answered.length} response${answered.length === 1 ? "" : "s"} answered it as ${old.type}. Add a new question instead.`);
          } else changes.push(`Changed the type of "${f.label}" (${f.id}) from ${old.type} to ${f.type}.`);
          continue;
        }
        if (isChoice(old.type)) {
          const kept = new Set((f.options ?? []).map((o) => o.toLowerCase()));
          for (const o of old.options ?? []) {
            if (kept.has(o.toLowerCase())) continue;
            const chose = answered.filter((a) => [a[f.id]].flat().map(String).some((v) => v.toLowerCase() === o.toLowerCase())).length;
            if (chose) problems.push(`${f.id} ("${old.label}"): can't remove the option "${o}", because ${chose} response${chose === 1 ? "" : "s"} chose it.`);
          }
        }
        const edits = [
          old.label !== f.label && "wording",
          old.required !== f.required && (f.required ? "now required" : "now optional"),
          isChoice(f.type) && (old.options ?? []).join(";") !== (f.options ?? []).join(";") && "options",
          (old.low_label !== f.low_label || old.high_label !== f.high_label) && "scale labels",
          JSON.stringify(old.show_if ?? null) !== JSON.stringify(f.show_if ?? null) && "condition",
        ].filter(Boolean);
        if (edits.length) changes.push(`Edited "${f.label}" (${f.id}): ${edits.join(", ")}.`);
      }
      for (const old of form.fields) {
        if (after.has(old.id)) continue;
        const n = answeredWith(old.id).length;
        changes.push(`Removed "${old.label}" (${old.id})${n ? `. Its ${n} past answer${n === 1 ? " is" : "s are"} kept in get_responses` : ""}.`);
      }
      if (def.title !== form.title) changes.push(`Renamed the form to "${def.title}".`);
      if ((def.description ?? "") !== (form.description ?? "")) changes.push("Changed the description.");
      changes.push(...settingsChanges(form.settings, def.settings));

      if (problems.length) throw new RelayError(409, "This change would make existing answers misleading, so nothing was saved.", problems);
      if (changes.length) {
        await q.updateForm({
          id,
          title: def.title,
          description: def.description,
          fields: JSON.stringify(def.fields),
          settings: Object.keys(def.settings).length ? JSON.stringify(def.settings) : null,
        });
      }
      const updated = (await findForm(id))!;
      return {
        id,
        title: updated.title,
        status: updated.status,
        question_count: updated.fields.length,
        changes: changes.length ? changes : ["Nothing changed."],
        fields: updated.fields,
        settings: updated.settings,
        links: creatorLinks(updated),
      };
    },

    /** Every response as CSV, oldest first. Without an owner (a signed download link), the signature is the permission. */
    async exportResponses(id: string, owner?: string) {
      const form = await requireForm(id, owner);
      const rows = (await q.allResponses(id)).map((r) => ({
        id: r.id,
        submitted_at: iso(Number(r.submitted_at)),
        answers: JSON.parse(r.answers) as Answers,
      }));
      return { filename: exportFilename(form.title), count: rows.length, csv: responsesCsv(form.fields, rows) };
    },

    async closeForm(id: string, owner: string = OPERATOR) {
      const form = await requireForm(id, owner);
      await q.closeForm(id);
      return {
        id,
        title: form.title,
        status: "closed" as const,
        was_already_closed: form.status === "closed",
        final_response_count: Number((await q.stats(id)).n),
      };
    },

    /** Permanently removes a form and its responses. Not exposed as an MCP tool. */
    async deleteForm(id: string, owner?: string) {
      await requireForm(id, owner);
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
      const submittedAt = now();
      await q.insertResponse(responseId, id, JSON.stringify(result.answers), submittedAt);
      return { ok: true as const, response_id: responseId, form, answers: result.answers, submitted_at: iso(submittedAt)! };
    },
  };
}

export type Relay = ReturnType<typeof createRelay>;
