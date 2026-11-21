import { RelayError } from "../errors.js";
import { makeExportLink } from "../routes/export.js";
import { OPERATOR, type Relay, type ShareOptions } from "../service.js";

/* The MCP tools add no logic of their own: they call one of these backends,
   which are both thin doors onto the same creator API. */

type Result<K extends keyof Relay> = Relay[K] extends (...args: never[]) => infer R ? Promise<Awaited<R>> : never;
export interface Backend {
  createForm(input: unknown, share: ShareOptions): Result<"createForm">;
  listForms(): Result<"listForms">;
  getForm(id: string, share: ShareOptions): Result<"getForm">;
  updateForm(id: string, input: unknown): Result<"updateForm">;
  getResponses(id: string, opts: { limit?: number; cursor?: string; onlyNew?: boolean }): Result<"getResponses">;
  summarize(id: string): Result<"summarize">;
  closeForm(id: string): Result<"closeForm">;
  exportLink(id: string): Promise<{ url: string; expires_at: string; filename: string; response_count: number }>;
}

/** Calls the service in-process — used by /mcp and by stdio when it owns the database. */
/** `owner` is the account the tools act for: the operator by default, or a hosted account. */
export function localBackend(relay: Relay, ownerKey?: string, owner: string = OPERATOR): Backend {
  return {
    createForm: (input, share) => relay.createForm(input, share, owner),
    listForms: () => relay.listForms(owner),
    getForm: (id, share) => relay.getForm(id, share, owner),
    updateForm: (id, input) => relay.updateForm(id, input, owner),
    getResponses: (id, opts) => relay.getResponses(id, opts, owner),
    summarize: (id) => relay.summarize(id, owner),
    closeForm: (id) => relay.closeForm(id, owner),
    exportLink: async (id) => {
      const out = await relay.exportResponses(id, owner);
      return { ...makeExportLink(relay.baseUrl, ownerKey, id), filename: out.filename, response_count: out.count };
    },
  };
}

/** Calls a hosted Relay over HTTPS with the owner key — the "small local MCP program" fallback. */
export function httpBackend(baseUrl: string, ownerKey: string): Backend {
  const root = baseUrl.replace(/\/+$/, "");

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${ownerKey}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
    if (!res.ok) {
      throw new RelayError(
        (res.status as RelayError["status"]) ?? 500,
        data.error ?? `Relay returned HTTP ${res.status}.`,
        data.details,
      );
    }
    return data as T;
  }

  const qs = (params: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const enc = encodeURIComponent;

  return {
    createForm: (input, share) => call("POST", "/api/forms", { ...(input as object), ...share }),
    listForms: () => call("GET", "/api/forms"),
    getForm: (id, share) => call("GET", `/api/forms/${enc(id)}${qs({ channel: share.channel, intro: share.intro })}`),
    updateForm: (id, input) => call("PUT", `/api/forms/${enc(id)}`, input),
    getResponses: (id, { limit, cursor, onlyNew }) =>
      call("GET", `/api/forms/${enc(id)}/responses${qs({ limit, cursor, only_new: onlyNew ? 1 : undefined })}`),
    summarize: (id) => call("GET", `/api/forms/${enc(id)}/summary`),
    closeForm: (id) => call("POST", `/api/forms/${enc(id)}/close`),
    exportLink: (id) => call("POST", `/api/forms/${enc(id)}/export-link`),
  };
}
