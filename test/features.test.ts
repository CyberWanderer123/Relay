import { afterEach, describe, expect, it, vi } from "vitest";
import { responsesCsv, signedExportUrl } from "../src/export.js";
import { RelayError } from "../src/errors.js";
import { normalizeForm, validateAnswers } from "../src/schema.js";
import { sendResponseWebhook } from "../src/webhook.js";
import { auth, form, KEY, setup } from "./helpers.js";

const newTypes = normalizeForm({
  title: "New types",
  fields: [
    { id: "day", type: "date", label: "Which day?" },
    { id: "stars", type: "rating", label: "Rate us" },
    { id: "nps", type: "scale", label: "Recommend us?", low_label: "Not likely", high_label: "Very likely" },
    { id: "site", type: "url", label: "Your site" },
    { id: "tel", type: "phone", label: "Phone" },
  ],
}).fields;

const check = (raw: Record<string, string>) => validateAnswers(newTypes, raw);

describe("new question types", () => {
  it("accepts good answers and stores numbers as numbers", () => {
    const r = check({ day: "2026-12-31", stars: "4", nps: "10", site: "maynaa.com", tel: "+91 98765 43210" });
    expect(r).toEqual({ ok: true, answers: { day: "2026-12-31", stars: 4, nps: 10, site: "https://maynaa.com", tel: "+91 98765 43210" } });
  });

  it("rejects impossible dates, out-of-range numbers, unsafe links and junk phones", () => {
    const r = check({ day: "2026-02-30", stars: "6", nps: "11", site: "javascript:alert(1)", tel: "call me" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["day", "nps", "site", "stars", "tel"]);
    expect(check({ stars: "0" }).ok).toBe(false);
    expect(check({ nps: "0" }).ok).toBe(true);
    expect(check({ site: "not a url" }).ok).toBe(false);
  });

  it("only lets scale questions have end labels", () => {
    expect(() => normalizeForm({ title: "T", fields: [{ type: "rating", label: "R", low_label: "Bad" }] })).toThrow(RelayError);
  });
});

describe("form settings", () => {
  it("validates thank-you buttons and deadlines", () => {
    const bad = (extra: object) => () => normalizeForm({ title: "T", fields: [{ type: "short_text", label: "A" }], ...extra });
    expect(bad({ thank_you: { button_url: "https://cal.com/me" } })).toThrow(RelayError);
    expect(bad({ thank_you: { button_label: "Book", button_url: "ftp://x.y" } })).toThrow(RelayError);
    expect(bad({ closes_at: "2026-12-05T18:00:00" })).toThrow(RelayError);
    const ok = normalizeForm({
      title: "T",
      fields: [{ type: "short_text", label: "A" }],
      thank_you: { message: "Thanks!", button_label: "Book your call", button_url: "cal.com/me" },
      closes_at: "2026-12-05T18:00:00+05:30",
      max_responses: 20,
    });
    expect(ok.settings).toEqual({
      thank_you: { message: "Thanks!", button_label: "Book your call", button_url: "https://cal.com/me" },
      closes_at: "2026-12-05T12:30:00.000Z",
      max_responses: 20,
    });
  });
});

async function makeForm(app: ReturnType<typeof setup>["app"], def: object) {
  const res = await app.request("/api/forms", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(def) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("pages for the new features", () => {
  it("renders rating and scale as tappable numbers with end labels", async () => {
    const { app } = setup();
    const id = await makeForm(app, { title: "T", fields: newTypes });
    const html = await (await app.request(`/f/${id}`)).text();
    expect(html.match(/name="stars" value="\d"/g)).toHaveLength(5);
    expect(html.match(/name="nps" value="\d+"/g)).toHaveLength(11);
    expect(html).toContain("Very likely");
    expect(html).toContain('type="date"');
    expect(html).toContain('type="tel"');
  });

  it("shows the custom thank-you message and next-step button", async () => {
    const { app } = setup();
    const id = await makeForm(app, {
      title: "Audit intake",
      fields: [{ id: "name", type: "short_text", label: "Name", required: true }],
      thank_you: { message: "Thanks! Pick a time for your audit call.", button_label: "Book your call", button_url: "https://cal.com/relay" },
    });
    const submit = await app.request(`/f/${id}/submit`, form({ name: "Asha" }));
    expect(submit.headers.get("location")).toBe(`/f/${id}/thanks`);
    const html = await (await app.request(`/f/${id}/thanks`)).text();
    expect(html).toContain("Thanks! Pick a time for your audit call.");
    expect(html).toContain('href="https://cal.com/relay"');
    expect(html).toContain("Book your call");
  });

  it("closes a form after its deadline", async () => {
    const { app } = setup();
    const id = await makeForm(app, { title: "Past", fields: [{ type: "short_text", label: "A" }], closes_at: "2020-01-01T00:00:00Z" });
    const res = await app.request(`/f/${id}`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain("stopped accepting responses on 1 January 2020, 00:00 UTC");
    expect((await app.request(`/f/${id}/submit`, form({ q1: "hi" }))).status).toBe(410);
    const list = (await (await app.request("/api/forms", { headers: auth })).json()) as { forms: { status: string }[] };
    expect(list.forms[0]!.status).toBe("closed");
  });

  it("shows spots left and closes when the limit is reached", async () => {
    const { app } = setup();
    const id = await makeForm(app, { title: "Workshop", fields: [{ id: "name", type: "short_text", label: "Name" }], max_responses: 2 });
    expect(await (await app.request(`/f/${id}`)).text()).toContain("2 spots left");
    await app.request(`/f/${id}/submit`, form({ name: "A" }));
    expect(await (await app.request(`/f/${id}`)).text()).toContain("1 spot left");
    const last = await app.request(`/f/${id}/submit`, form({ name: "B" }));
    expect(last.status).toBe(303);
    expect((await app.request(`/f/${id}/thanks`)).status).toBe(200);
    const full = await app.request(`/f/${id}`);
    expect(full.status).toBe(410);
    expect(await full.text()).toContain("All spots are taken.");
  });
});

describe("CSV export", () => {
  it("exports with the key, and by signed link only until it expires", async () => {
    const { app, config } = setup();
    const id = await makeForm(app, { title: "Workshop feedback", fields: [{ id: "q1", type: "short_text", label: "Comment" }] });
    await app.request(`/f/${id}/submit`, form({ q1: "=HYPERLINK(\"http://evil\")" }));

    const direct = await app.request(`/api/forms/${id}/responses.csv`, { headers: auth });
    expect(direct.headers.get("content-type")).toContain("text/csv");
    expect(direct.headers.get("content-disposition")).toMatch(/attachment; filename="relay-workshop-feedback-\d{4}-\d{2}-\d{2}\.csv"/);
    const csv = await direct.text();
    expect(csv).toContain("Submitted at (UTC),Response ID,Comment");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect((await app.request(`/api/forms/${id}/responses.csv`)).status).toBe(401);

    const link = (await (await app.request(`/api/forms/${id}/export-link`, { method: "POST", headers: auth })).json()) as { url: string; response_count: number };
    expect(link.response_count).toBe(1);
    const path = link.url.replace(config.baseUrl, "");
    expect((await app.request(path)).status).toBe(200);
    expect((await app.request(path.replace(/sig=.{4}/, "sig=AAAA"))).status).toBe(403);
    const expired = signedExportUrl(config.baseUrl, KEY, id, Math.floor(Date.now() / 1000) - 3600).url.replace(config.baseUrl, "");
    expect((await app.request(expired)).status).toBe(403);
  });

  it("keeps answers to removed questions in their own column", () => {
    const csv = responsesCsv([{ id: "a", type: "short_text", label: "A", required: false }], [
      { id: "r1", submitted_at: "2026-01-01T00:00:00.000Z", answers: { a: "x", old: "kept" } },
    ]);
    expect(csv).toContain("A,old (removed question)");
    expect(csv).toContain("x,kept");
  });
});

describe("webhook", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts each new response, signed when a secret is set", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("ok");
    });
    const { app } = setup({ webhookUrl: "https://hooks.example/relay", webhookSecret: "s3cret" });
    const id = await makeForm(app, { title: "Hooked", fields: [{ id: "name", type: "short_text", label: "Name" }] });
    await app.request(`/f/${id}/submit`, form({ name: "Asha" }));

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ event: "response.created", form: { id, title: "Hooked" }, response: { answers: { name: "Asha" } } });
    const { createHmac } = await import("node:crypto");
    const expected = `sha256=${createHmac("sha256", "s3cret").update(String(calls[0]!.init.body)).digest("hex")}`;
    expect((calls[0]!.init.headers as Record<string, string>)["x-relay-signature"]).toBe(expected);
  });

  it("never breaks a submission when the receiver fails", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const f = normalizeForm({ title: "T", fields: [{ type: "short_text", label: "A" }] });
    await expect(
      sendResponseWebhook({ webhookUrl: "https://hooks.example/x" }, { id: "abc", ...f, status: "open", created_at: 0 }, { id: "r", submitted_at: "", answers: {} }, failing),
    ).resolves.toBeUndefined();
  });
});
