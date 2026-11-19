import { z } from "zod";
import { RelayError } from "./errors.js";

/* ------------------------------------------------------------------ */
/* Field model                                                         */
/* ------------------------------------------------------------------ */

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "number",
  "email",
  "date",
  "rating",
  "scale",
  "url",
  "phone",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const isChoice = (t: FieldType) => t === "single_choice" || t === "multi_choice";
/** Types whose answers are stored as numbers. */
export const isNumeric = (t: FieldType) => t === "number" || t === "rating" || t === "scale";

/** Fixed ranges: a rating is 1–5 stars, a scale is 0–10 (which also covers NPS). */
export const RANGES = { rating: { min: 1, max: 5 }, scale: { min: 0, max: 10 } } as const;

export const LIMITS = {
  maxFields: 50,
  maxLabel: 300,
  maxOptions: 50,
  maxOption: 200,
  maxTitle: 200,
  maxDescription: 2000,
  maxIntro: 300,
  /** Longest accepted answer per field type, in characters. */
  answer: {
    short_text: 500,
    long_text: 5000,
    single_choice: 200,
    multi_choice: 200,
    number: 40,
    email: 254,
    date: 10,
    rating: 1,
    scale: 2,
    url: 2000,
    phone: 30,
  } satisfies Record<FieldType, number>,
  maxScaleLabel: 60,
} as const;

export const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[];
  /** scale only: words under the ends of the 0–10 scale, e.g. "Not likely" and "Very likely". */
  low_label?: string;
  high_label?: string;
  /** Ask this question only when an earlier choice question was answered with one of these options. */
  show_if?: { field: string; any_of: string[] };
}

/** Per-form options beyond the questions. Stored as JSON; every key is optional. */
export interface FormSettings {
  /** Shown after someone submits. The button is a next step, e.g. booking a call. */
  thank_you?: { message?: string; button_label?: string; button_url?: string };
  /** ISO 8601 instant. The form stops accepting responses from then on. */
  closes_at?: string;
  /** The form stops accepting responses once it has this many. */
  max_responses?: number;
  /** Look of the form: an accent colour (#RRGGBB) and a logo shown at the top. */
  brand?: { accent?: string; logo_url?: string };
  /** Sites allowed to show this form in an <iframe>, as https origins. Empty means no embedding. */
  embed_origins?: string[];
}

export interface FormDefinition {
  title: string;
  description: string | null;
  fields: Field[];
  settings: FormSettings;
}

/* ------------------------------------------------------------------ */
/* Untrusted-text hygiene                                              */
/* ------------------------------------------------------------------ */

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const CONTROL_SINGLE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const CONTROL_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

/** Strip control and bidi-override characters, collapse whitespace. */
export function cleanText(input: string, { multiline = false } = {}): string {
  let s = input.normalize("NFC").replace(INVISIBLE, "");
  if (multiline) {
    s = s
      .replace(/\r\n?/g, "\n")
      .replace(CONTROL_MULTI, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    s = s.replace(CONTROL_SINGLE, " ").replace(/\s+/g, " ");
  }
  return s.trim();
}

/* ------------------------------------------------------------------ */
/* Creation input (shared by the API and the MCP tools)                */
/* ------------------------------------------------------------------ */

export const FieldInput = z.object({
  id: z
    .string()
    .regex(FIELD_ID_RE, "Field ids are short lowercase slugs such as q1 or email.")
    .optional()
    .describe("Optional short stable slug such as q1 or email. Defaults to q1, q2, … by position."),
  type: z
    .enum(FIELD_TYPES)
    .describe(
      "short_text (one line), long_text (paragraph), single_choice (pick one), multi_choice (pick any), number, email, date (a calendar date), rating (1–5 stars), scale (0–10, e.g. 'How likely are you to recommend us?'), url (a web address), phone.",
    ),
  label: z.string().min(1).max(LIMITS.maxLabel).describe("The question as the respondent will read it."),
  required: z.boolean().default(false).describe("Whether an answer is required. Defaults to false."),
  options: z
    .array(z.string().min(1).max(LIMITS.maxOption))
    .max(LIMITS.maxOptions)
    .optional()
    .describe("The choices, for single_choice and multi_choice only (2–50, no semicolons)."),
  low_label: z.string().max(LIMITS.maxScaleLabel).optional().describe("scale only: label for 0, e.g. 'Not at all likely'."),
  high_label: z.string().max(LIMITS.maxScaleLabel).optional().describe("scale only: label for 10, e.g. 'Extremely likely'."),
  show_if: z
    .object({
      field: z.string().regex(FIELD_ID_RE).describe("Id of an EARLIER single_choice or multi_choice question. Give that question an explicit id."),
      any_of: z.array(z.string().min(1).max(LIMITS.maxOption)).min(1).max(LIMITS.maxOptions).describe("Options of that question that make this one appear."),
    })
    .optional()
    .describe("Optional condition: ask this question only if an earlier choice question was answered with one of these options, e.g. { field: 'has_team', any_of: ['Yes'] }."),
});

export const CreateFormInput = z.object({
  title: z.string().min(1).max(LIMITS.maxTitle).describe("Form title shown at the top of the page."),
  description: z
    .string()
    .max(LIMITS.maxDescription)
    .optional()
    .describe("Optional short intro shown under the title."),
  fields: z
    .array(FieldInput)
    .min(1)
    .max(LIMITS.maxFields)
    .describe("The questions, in order. At most 50."),
  thank_you: z
    .object({
      message: z.string().max(1000).optional().describe("Shown after someone submits, e.g. 'Thanks! I'll reply within two days.'"),
      button_label: z.string().max(60).optional().describe("Text for an optional next-step button, e.g. 'Book your call'."),
      button_url: z.string().max(2000).optional().describe("Where the button goes, e.g. a booking page. Needs button_label."),
    })
    .optional()
    .describe("Optional custom thank-you page. Without it, people see a plain 'Thank you'."),
  closes_at: z
    .string()
    .max(40)
    .optional()
    .describe("Optional deadline: an ISO 8601 date-time with a timezone, e.g. 2026-12-05T18:00:00+05:30. The form stops accepting responses then."),
  max_responses: z
    .number()
    .int()
    .min(1)
    .max(100000)
    .optional()
    .describe("Optional limit, e.g. 20 for twenty spots. The form stops accepting responses once it has this many."),
  brand: z
    .object({
      accent: z.string().max(7).optional().describe("Accent colour as #RRGGBB, e.g. #0F766E. Relay adjusts it if text on it would be hard to read."),
      logo_url: z.string().max(2000).optional().describe("https address of a logo image (PNG, SVG or JPG), shown at the top of the form."),
    })
    .optional()
    .describe("Optional branding: the creator's colour and logo."),
  embed_origins: z
    .array(z.string().max(200))
    .max(10)
    .optional()
    .describe("Optional: websites allowed to embed this form in an iframe, e.g. ['https://example.com']. get_form then returns embed_code to paste."),
});
export type CreateFormInput = z.input<typeof CreateFormInput>;

export function zodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

/**
 * Validate and normalise a creator's form definition. Throws RelayError(422).
 * `reservedIds` are never handed out to questions without an id: on an edit they are the form's
 * existing ids, so a new question can never inherit a removed question's answers.
 */
export function normalizeForm(input: unknown, opts: { reservedIds?: Iterable<string> } = {}): FormDefinition {
  const parsed = CreateFormInput.safeParse(input);
  if (!parsed.success) throw new RelayError(422, "The form definition is not valid.", zodIssues(parsed.error));

  const problems: string[] = [];
  const title = cleanText(parsed.data.title);
  if (!title) problems.push("title: must not be empty.");
  const description = parsed.data.description ? cleanText(parsed.data.description, { multiline: true }) : "";

  const taken = new Set([...(opts.reservedIds ?? []), ...parsed.data.fields.map((f) => f.id).filter((id): id is string => Boolean(id))]);
  let next = 1;
  const seen = new Set<string>();

  const fields: Field[] = parsed.data.fields.map((f, i) => {
    const where = `fields.${i}`;
    let id = f.id;
    if (!id) {
      while (taken.has(`q${next}`)) next++;
      id = `q${next}`;
      taken.add(id);
    }
    if (seen.has(id)) problems.push(`${where}.id: "${id}" is used more than once.`);
    seen.add(id);

    const label = cleanText(f.label);
    if (!label) problems.push(`${where}.label: must not be empty.`);

    const field: Field = { id, type: f.type, label, required: f.required ?? false };

    if (isChoice(f.type)) {
      const options = (f.options ?? []).map((o) => cleanText(o)).filter(Boolean);
      if (options.length < 2) problems.push(`${where}.options: ${f.type} needs at least 2 options.`);
      const lower = new Set<string>();
      for (const o of options) {
        if (o.includes(";")) problems.push(`${where}.options: "${o}" must not contain a semicolon.`);
        if (lower.has(o.toLowerCase())) problems.push(`${where}.options: "${o}" is listed twice.`);
        lower.add(o.toLowerCase());
      }
      field.options = options;
    } else if (f.options?.length) {
      problems.push(`${where}.options: only single_choice and multi_choice questions take options.`);
    }
    if (f.type === "scale") {
      const low = f.low_label ? cleanText(f.low_label) : "";
      const high = f.high_label ? cleanText(f.high_label) : "";
      if (low) field.low_label = low;
      if (high) field.high_label = high;
    } else if (f.low_label || f.high_label) {
      problems.push(`${where}: only scale questions take low_label and high_label.`);
    }
    return field;
  });

  // Conditions may only point backwards, at a choice question, using its real options.
  parsed.data.fields.forEach((f, i) => {
    if (!f.show_if) return;
    const where = `fields.${i}.show_if`;
    const target = fields.slice(0, i).find((t) => t.id === f.show_if!.field);
    if (!target) {
      problems.push(`${where}: "${f.show_if.field}" must be the id of an earlier question.`);
      return;
    }
    if (!isChoice(target.type)) {
      problems.push(`${where}: "${target.id}" must be a single_choice or multi_choice question.`);
      return;
    }
    const anyOf: string[] = [];
    for (const v of f.show_if.any_of) {
      const match = matchOption(target.options ?? [], cleanText(v));
      if (match === undefined) problems.push(`${where}.any_of: "${v}" is not an option of "${target.id}".`);
      else if (!anyOf.includes(match)) anyOf.push(match);
    }
    if (anyOf.length) fields[i]!.show_if = { field: target.id, any_of: anyOf };
  });

  const settings: FormSettings = {};
  const ty = parsed.data.thank_you;
  if (ty) {
    const message = ty.message ? cleanText(ty.message, { multiline: true }) : "";
    const label = ty.button_label ? cleanText(ty.button_label) : "";
    const url = ty.button_url ? parseUrl(ty.button_url) : undefined;
    if (ty.button_url && !url) problems.push("thank_you.button_url: must be a web address such as https://cal.com/you.");
    if (url && !label) problems.push("thank_you.button_label: a button needs a label, e.g. 'Book your call'.");
    if (label && !ty.button_url) problems.push("thank_you.button_url: a button needs a button_url.");
    const thankYou = { ...(message && { message }), ...(label && url && { button_label: label, button_url: url }) };
    if (Object.keys(thankYou).length) settings.thank_you = thankYou;
  }
  if (parsed.data.closes_at) {
    const raw = parsed.data.closes_at.trim();
    const at = Date.parse(raw);
    if (!/(z|[+-]\d{2}:?\d{2})$/i.test(raw) || !Number.isFinite(at)) {
      problems.push("closes_at: use an ISO 8601 date-time with a timezone, e.g. 2026-12-05T18:00:00+05:30.");
    } else settings.closes_at = new Date(at).toISOString();
  }
  if (parsed.data.max_responses) settings.max_responses = parsed.data.max_responses;
  if (parsed.data.brand) {
    const brand: NonNullable<FormSettings["brand"]> = {};
    const accent = parsed.data.brand.accent?.trim();
    if (accent) {
      if (/^#?[0-9a-f]{6}$/i.test(accent)) brand.accent = `#${accent.replace("#", "").toUpperCase()}`;
      else problems.push("brand.accent: use a colour like #0F766E.");
    }
    const logo = parsed.data.brand.logo_url?.trim();
    if (logo) {
      const url = parseUrl(logo);
      if (url && url.startsWith("https://")) brand.logo_url = url;
      else problems.push("brand.logo_url: must be an https:// address of an image.");
    }
    if (Object.keys(brand).length) settings.brand = brand;
  }
  if (parsed.data.embed_origins?.length) {
    const origins: string[] = [];
    for (const raw of parsed.data.embed_origins) {
      const origin = parseOrigin(raw);
      if (!origin) problems.push(`embed_origins: "${raw}" must be a site address like https://example.com.`);
      else if (!origins.includes(origin)) origins.push(origin);
    }
    if (origins.length) settings.embed_origins = origins;
  }

  if (problems.length) throw new RelayError(422, "The form definition is not valid.", problems);
  return { title, description: description || null, fields, settings };
}

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

export type RawAnswers = Record<string, string | string[] | undefined>;
export type AnswerValue = string | number | string[];
export type Answers = Record<string, AnswerValue>;

export type AnswerResult =
  | { ok: true; answers: Answers }
  | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

const asList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/**
 * Check raw answers (from a form post or review-link parameters) against a form.
 * Errors are keyed by field id; "_form" holds problems that belong to no field.
 */
export function validateAnswers(fields: Field[], raw: RawAnswers): AnswerResult {
  const errors: Record<string, string> = {};
  const answers: Answers = {};
  const known = new Set(fields.map((f) => f.id));

  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length) {
    errors._form = `Unknown question id${unknown.length > 1 ? "s" : ""}: ${unknown.slice(0, 5).join(", ")}.`;
  }

  for (const f of fields) {
    // A conditional question whose condition isn't met is skipped: never required, answer ignored.
    if (!conditionMet(f, answers)) continue;
    const multiline = f.type === "long_text";
    const values = asList(raw[f.id])
      .map((v) => cleanText(String(v), { multiline }))
      .filter((v) => v.length > 0);

    if (values.length === 0) {
      if (f.required) errors[f.id] = "This question needs an answer.";
      continue;
    }
    if (f.type !== "multi_choice" && values.length > 1) {
      errors[f.id] = "Give one answer only.";
      continue;
    }
    const max = LIMITS.answer[f.type];
    if (values.some((v) => v.length > max)) {
      errors[f.id] = `Keep this under ${max.toLocaleString("en-US")} characters.`;
      continue;
    }
    const v = values[0]!;

    switch (f.type) {
      case "short_text":
      case "long_text":
        answers[f.id] = v;
        break;
      case "email":
        if (!EMAIL_RE.test(v)) errors[f.id] = "Enter an email address like name@example.com.";
        else answers[f.id] = v;
        break;
      case "number": {
        const compact = v.replace(/[\s,_]/g, "");
        const n = Number(compact);
        if (!NUMBER_RE.test(compact) || !Number.isFinite(n)) errors[f.id] = "Enter a number.";
        else answers[f.id] = n;
        break;
      }
      case "rating":
      case "scale": {
        const { min, max } = RANGES[f.type];
        const n = Number(v.replace(/\s|stars?$/gi, ""));
        if (!Number.isInteger(n) || n < min || n > max) errors[f.id] = `Choose a whole number from ${min} to ${max}.`;
        else answers[f.id] = n;
        break;
      }
      case "date": {
        const d = parseDate(v);
        if (!d) errors[f.id] = "Enter a date like 2026-12-31.";
        else answers[f.id] = d;
        break;
      }
      case "url": {
        const u = parseUrl(v);
        if (!u) errors[f.id] = "Enter a web address like example.com.";
        else answers[f.id] = u;
        break;
      }
      case "phone": {
        const digits = v.replace(/\D/g, "");
        if (!/^\+?[\d\s().-]+$/.test(v) || digits.length < 6 || digits.length > 15) errors[f.id] = "Enter a phone number, digits only, with + and the country code if you like.";
        else answers[f.id] = v.replace(/\s+/g, " ");
        break;
      }
      case "single_choice": {
        const match = matchOption(f.options ?? [], v);
        if (match === undefined) errors[f.id] = "Choose one of the listed options.";
        else answers[f.id] = match;
        break;
      }
      case "multi_choice": {
        const picked: string[] = [];
        for (const value of values) {
          const match = matchOption(f.options ?? [], value);
          if (match === undefined) {
            errors[f.id] = `“${value.slice(0, 60)}” is not one of the options.`;
            break;
          }
          if (!picked.includes(match)) picked.push(match);
        }
        if (!errors[f.id]) answers[f.id] = (f.options ?? []).filter((o) => picked.includes(o));
        break;
      }
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

/**
 * Whether a question should be asked, given the answers to the questions before it.
 * Conditions only point backwards, so walking the fields in order settles chains too.
 */
export function conditionMet(f: Field, earlier: Answers): boolean {
  if (!f.show_if) return true;
  const given = earlier[f.show_if.field];
  if (given === undefined) return false;
  const picked = [given].flat().map((v) => String(v).toLowerCase());
  return f.show_if.any_of.some((o) => picked.includes(o.toLowerCase()));
}

/** Ids of the questions that apply, given (valid) answers. */
export function visibleFieldIds(fields: Field[], answers: Answers): Set<string> {
  const out = new Set<string>();
  const seen: Answers = {};
  for (const f of fields) {
    if (!conditionMet(f, seen)) continue;
    out.add(f.id);
    if (answers[f.id] !== undefined) seen[f.id] = answers[f.id]!;
  }
  return out;
}

/** A real calendar date in YYYY-MM-DD form (what <input type=date> sends), or undefined. */
export function parseDate(v: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? m[0] : undefined;
}

/** An http(s) web address. A bare domain such as "example.com" gets https:// added. */
export function parseUrl(v: string): string | undefined {
  const s = v.trim();
  if (/\s/.test(s)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) return undefined;
    return u.href.length <= LIMITS.answer.url ? (s === withScheme ? s : withScheme) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An https origin for frame-ancestors, e.g. "https://example.com" or "https://*.example.com".
 * "localhost" over http is allowed for testing. Paths are dropped; bare "*" is refused.
 */
export function parseOrigin(v: string): string | undefined {
  const s = v.trim().replace(/\/+$/, "");
  const m = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(:\d{1,5})?(\/.*)?$/i.exec(s);
  if (!m) return undefined;
  const [, scheme, wildcard = "", host, port = ""] = m;
  const local = host === "localhost" || host === "127.0.0.1";
  if (scheme!.toLowerCase() === "http" && !local) return undefined;
  if (!local && !host!.includes(".")) return undefined;
  return `${scheme!.toLowerCase()}://${wildcard}${host!.toLowerCase()}${port}`;
}

/** Exact match first, then case-insensitive — assistants sometimes change case. */
function matchOption(options: string[], value: string): string | undefined {
  return options.find((o) => o === value) ?? options.find((o) => o.toLowerCase() === value.toLowerCase());
}
