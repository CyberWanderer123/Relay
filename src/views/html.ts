/* A tiny escaping template tag. Every interpolated value is HTML-escaped
   unless it is already a Safe fragment produced by `h`. Arrays are joined. */

export class Safe {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export const esc = (s: string) => s.replace(/[&<>"'`]/g, (c) => ESCAPES[c]!);

function render(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(String(v));
}

export function h(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1]!;
  return new Safe(out);
}

/** Mark trusted, service-authored markup (never user text) as safe. */
export const trusted = (s: string) => new Safe(s);
