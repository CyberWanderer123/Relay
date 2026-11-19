import crypto from "node:crypto";
import type { Answers, Field } from "./schema.js";

/* CSV export of a form's responses, and short-lived signed links to download it.
   A signed link lets the creator's agent hand over a download without the owner key ever
   appearing in a URL: the link is HMAC-signed with the owner key and expires. */

export const EXPORT_LINK_TTL_SECONDS = 15 * 60;

const sign = (ownerKey: string, formId: string, exp: number) =>
  crypto.createHmac("sha256", ownerKey).update(`export:${formId}:${exp}`).digest("base64url");

/** A download link for one form's CSV, valid for 15 minutes. */
export function signedExportUrl(baseUrl: string, ownerKey: string, formId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const exp = nowSeconds + EXPORT_LINK_TTL_SECONDS;
  return {
    url: `${baseUrl}/x/${formId}.csv?exp=${exp}&sig=${sign(ownerKey, formId, exp)}`,
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

/** True when the signature matches and the link has not expired. */
export function verifyExportSignature(ownerKey: string, formId: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  const expires = Number(exp);
  const now = Math.floor(Date.now() / 1000);
  if (expires < now || expires > now + EXPORT_LINK_TTL_SECONDS + 60) return false;
  const expected = Buffer.from(sign(ownerKey, formId, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** One CSV cell. Text that a spreadsheet would run as a formula is prefixed with an apostrophe. */
function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  let s = Array.isArray(value) ? value.join("; ") : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Responses as CSV (UTF-8 with a byte-order mark, so Excel reads accents correctly).
 * One column per current question, then one per question that was removed but still has answers.
 */
export function responsesCsv(fields: Field[], rows: { id: string; submitted_at: string | null; answers: Answers }[]): string {
  const current = new Set(fields.map((f) => f.id));
  const removed = [...new Set(rows.flatMap((r) => Object.keys(r.answers)).filter((k) => !current.has(k)))];
  const header = ["Submitted at (UTC)", "Response ID", ...fields.map((f) => f.label), ...removed.map((id) => `${id} (removed question)`)];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([r.submitted_at ?? "", r.id, ...fields.map((f) => r.answers[f.id]), ...removed.map((id) => r.answers[id])].map(cell).join(","));
  }
  return String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";
}

/** "relay-workshop-feedback-2026-11-19.csv" */
export function exportFilename(title: string, now = new Date()): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "form";
  return `relay-${slug}-${now.toISOString().slice(0, 10)}.csv`;
}
