import { Hono } from "hono";
import { signedExportUrl, verifyExportSignature } from "../export.js";
import { FORM_ID_RE } from "../service.js";
import type { Deps } from "./deps.js";

/**
 * GET /x/:id.csv?exp=…&sig=… — download a form's responses with a short-lived signed link.
 * The link comes from POST /api/forms/:id/export-link or the export_responses MCP tool.
 * Query strings are never logged, and the signature only works for this form until it expires.
 */
export function exportRoutes({ relay, config }: Deps) {
  const r = new Hono();
  r.get("/x/:file", async (c) => {
    const file = c.req.param("file");
    const id = file.endsWith(".csv") ? file.slice(0, -4) : "";
    const denied = () => c.text("This download link is invalid or has expired. Ask for a new one.", 403);
    if (!config.ownerKey || !FORM_ID_RE.test(id)) return denied();
    if (!verifyExportSignature(config.ownerKey, id, c.req.query("exp"), c.req.query("sig"))) return denied();
    const out = await relay.exportResponses(id);
    return csvResponse(out.csv, out.filename);
  });
  return r;
}

export const csvResponse = (csv: string, filename: string) =>
  new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });

/** A signed download link, or a clear error when no owner key is configured. */
export function makeExportLink(baseUrl: string, ownerKey: string | undefined, formId: string) {
  if (!ownerKey) throw new Error("Exports need RELAY_OWNER_KEY to be set.");
  return signedExportUrl(baseUrl, ownerKey, formId);
}
