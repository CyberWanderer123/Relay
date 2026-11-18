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
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const isChoice = (t: FieldType) => t === "single_choice" || t === "multi_choice";

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
  } satisfies Record<FieldType, number>,
} as const;

export const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[];
}

export interface FormDefinition {
  title: string;
  description: string | null;
  fields: Field[];
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
      "short_text (one line), long_text (paragraph), single_choice (pick one), multi_choice (pick any), number, email.",
    ),
  label: z.string().min(1).max(LIMITS.maxLabel).describe("The question as the respondent will read it."),
  required: z.boolean().default(false).describe("Whether an answer is required. Defaults to false."),
  options: z
    .array(z.string().min(1).max(LIMITS.maxOption))
    .max(LIMITS.maxOptions)
    .optional()
    .describe("The choices, for single_choice and multi_choice only (2–50, no semicolons)."),
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
});
export type CreateFormInput = z.input<typeof CreateFormInput>;

export function zodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

/** Validate and normalise a creator's form definition. Throws RelayError(422). */
export function normalizeForm(input: unknown): FormDefinition {
  const parsed = CreateFormInput.safeParse(input);
  if (!parsed.success) throw new RelayError(422, "The form definition is not valid.", zodIssues(parsed.error));

  const problems: string[] = [];
  const title = cleanText(parsed.data.title);
  if (!title) problems.push("title: must not be empty.");
  const description = parsed.data.description ? cleanText(parsed.data.description, { multiline: true }) : "";

  const taken = new Set(parsed.data.fields.map((f) => f.id).filter(Boolean));
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
    return field;
  });

  if (problems.length) throw new RelayError(422, "The form definition is not valid.", problems);
  return { title, description: description || null, fields };
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

/** Exact match first, then case-insensitive — assistants sometimes change case. */
function matchOption(options: string[], value: string): string | undefined {
  return options.find((o) => o === value) ?? options.find((o) => o.toLowerCase() === value.toLowerCase());
}
