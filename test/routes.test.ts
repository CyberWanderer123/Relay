import { describe, expect, it } from "vitest";
import { MAX_PREFILL_URL } from "../src/routes/claude.js";
import { auth, countResponses, firstAnswers, form, sampleForm, setup } from "./helpers.js";

async function withForm(overrides = {}, def: object = sampleForm) {
  const ctx = setup(overrides);
  const res = await ctx.app.request("/api/forms", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(def),
  });
  const created = (await res.json()) as { id: string; share_message: string; links: { fill: string; claude: string } };
  return { ...ctx, id: created.id, created, status: res.status };
}

describe("creator API", () => {
  it("returns 401 without the key and with a wrong key", async () => {
    const { app } = setup();
    expect((await app.request("/api/forms")).status).toBe(401);
    expect((await app.request("/api/forms", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("returns 503 when no owner key is configured", async () => {
    const { app } = setup({ ownerKey: undefined });
    expect((await app.request("/api/forms", { headers: auth })).status).toBe(503);
  });

  it("creates a form with links and a WhatsApp share message", async () => {
    const { created, status, id } = await withForm();
    expect(status).toBe(201);
    expect(id).toMatch(/^[a-z0-9]{14}$/);
    expect(created.links.fill).toBe(`https://relay.test/f/${id}`);
    expect(created.share_message).toContain(`Form: https://relay.test/f/${id}`);
    expect(created.share_message).not.toContain("/c/");
  });

  it("rejects invalid definitions with details", async () => {
    const { status, created } = await withForm({}, { title: "T", fields: [] });
    expect(status).toBe(422);
    expect((created as unknown as { details: string[] }).details.length).toBeGreaterThan(0);
  });

  it("lists, pages, summarizes and closes", async () => {
    const { app, id } = await withForm();
    for (let i = 0; i < 5; i++) {
      const res = await app.request(`/f/${id}/submit`, form({ q1: i < 3 ? "Great" : "Poor", q3: String(i * 2), q2: ["Intro", "Lab"] }));
      expect(res.status).toBe(303);
    }

    const list = (await (await app.request("/api/forms", { headers: auth })).json()) as { forms: { response_count: number }[] };
    expect(list.forms[0]!.response_count).toBe(5);

    const p1 = (await (await app.request(`/api/forms/${id}/responses?limit=2`, { headers: auth })).json()) as {
      responses: { answers: { q3: number } }[];
      next_cursor: string;
    };
    expect(p1.responses.map((r) => r.answers.q3)).toEqual([8, 6]);
    const p3 = (await (
      await app.request(`/api/forms/${id}/responses?limit=2&cursor=${p1.next_cursor}`, { headers: auth })
    ).json()) as { responses: { answers: { q3: number } }[]; next_cursor: string };
    expect(p3.responses.map((r) => r.answers.q3)).toEqual([4, 2]);

    const s = (await (await app.request(`/api/forms/${id}/summary`, { headers: auth })).json()) as {
      total_responses: number;
      questions: Record<string, unknown>[];
    };
    expect(s.total_responses).toBe(5);
    expect(s.questions[0]).toMatchObject({ counts: { Great: 3, Okay: 0, Poor: 2 }, answered: 5 });
    expect(s.questions[1]).toMatchObject({ counts: { Intro: 5, Lab: 5, Panel: 0 } });
    expect(s.questions[2]).toMatchObject({ min: 0, max: 8, mean: 4, median: 4 });

    const closed = await (await app.request(`/api/forms/${id}/close`, { method: "POST", headers: auth })).json();
    expect(closed).toMatchObject({ status: "closed", final_response_count: 5 });
    expect((await app.request(`/f/${id}`)).status).toBe(410);
    expect((await app.request(`/f/${id}/clean`)).status).toBe(410);
    expect((await app.request(`/a/${id}`)).status).toBe(410);
    expect((await app.request(`/f/${id}/review?q1=Great`)).status).toBe(410);
    expect((await app.request(`/c/${id}`)).status).toBe(410);
    expect((await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "1" }))).status).toBe(410);
  });

  it("deletes a form and its responses", async () => {
    const { app, id, db } = await withForm();
    await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "1" }));
    const res = await app.request(`/api/forms/${id}`, { method: "DELETE", headers: auth });
    expect(await res.json()).toMatchObject({ deleted: true, responses_deleted: 1 });
    expect(await countResponses(db)).toBe(0);
    expect((await app.request(`/f/${id}`)).status).toBe(404);
  });
});

describe("public form", () => {
  it("serves the form with security headers", async () => {
    const { app, id } = await withForm();
    const res = await app.request(`/f/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await res.text();
    expect(html).toContain('action="/f/' + id + '/submit"');
    expect(html).toContain('name="_hp"');
  });

  it("re-renders with errors and keeps values on invalid submit", async () => {
    const { app, id, db } = await withForm();
    const res = await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "lots", q4: "keep me" }));
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Enter a number.");
    expect(html).toContain("keep me");
    expect(await countResponses(db)).toBe(0);
  });

  it("silently drops honeypot submissions", async () => {
    const { app, id, db } = await withForm();
    const res = await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "1", _hp: "http://spam" }));
    expect(res.status).toBe(303);
    expect(await countResponses(db)).toBe(0);
  });

  it("rejects unknown field ids on submit", async () => {
    const { app, id } = await withForm();
    const res = await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "1", evil: "x" }));
    expect(res.status).toBe(422);
  });

  it("rejects oversized bodies", async () => {
    const { app, id } = await withForm();
    const res = await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "1", q4: "x".repeat(40 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("rate-limits submissions per IP", async () => {
    const { app, id } = await withForm({ submitPerMinute: 3, trustProxy: true });
    const send = (ip: string) =>
      app.request(`/f/${id}/submit`, { ...form({ q1: "Great", q3: "1" }), headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": ip } });
    for (let i = 0; i < 3; i++) expect((await send("1.1.1.1")).status).toBe(303);
    expect((await send("1.1.1.1")).status).toBe(429);
    expect((await send("2.2.2.2")).status).toBe(303);
  });

  it("returns 404 for unknown and malformed ids", async () => {
    const { app } = setup();
    expect((await app.request("/f/doesnotexist00")).status).toBe(404);
    expect((await app.request("/f/../../etc")).status).toBe(404);
  });
});

describe("escaping", () => {
  const evil = '<script>alert("x")</script><img src=x onerror=alert(1)>';
  it("renders creator and respondent text as plain text", async () => {
    const { app, id } = await withForm({}, {
      title: evil,
      description: evil,
      fields: [
        { id: "a", type: "single_choice", label: evil, required: true, options: [evil, "ok"] },
        { id: "b", type: "long_text", label: "Note" },
      ],
    });
    for (const path of [`/f/${id}`, `/f/${id}/review?a=ok&b=${encodeURIComponent(evil)}`]) {
      const html = await (await app.request(path)).text();
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;");
    }
    // Invalid submit echoes the answer back — still escaped.
    const res = await app.request(`/f/${id}/submit`, form({ a: "nope", b: evil }));
    const html = await res.text();
    expect(html).not.toContain("<img src=x");
  });
});

describe("review link", () => {
  it("never saves on GET", async () => {
    const { app, id, db } = await withForm();
    const res = await app.request(`/f/${id}/review?q1=Great&q3=5`);
    expect(res.status).toBe(200);
    expect(await countResponses(db)).toBe(0);
  });

  it("shows the destination host and a submit form with the cleaned values", async () => {
    const { app, id } = await withForm();
    const html = await (await app.request(`/f/${id}/review?q1=great&q2=Lab&q2=Intro&q3=1%2C000`)).text();
    expect(html).toContain("relay.test");
    expect(html).toContain('name="q1" value="Great"');
    expect(html).toContain('name="q3" value="1000"');
    expect(html.indexOf('name="q2" value="Intro"')).toBeLessThan(html.indexOf('name="q2" value="Lab"'));
  });

  it("flags missing required parameters and offers the web form instead of Submit", async () => {
    const { app, id } = await withForm();
    const html = await (await app.request(`/f/${id}/review?q1=Great`)).text();
    expect(html).toContain("This question needs an answer.");
    expect(html).not.toContain("Submit these answers");
    expect(html).toContain(`href="/f/${id}?q1=Great"`);
  });

  it("ignores extra parameters but tells the person", async () => {
    const { app, id } = await withForm();
    const html = await (await app.request(`/f/${id}/review?q1=Great&q3=2&utm_source=chat`)).text();
    expect(html).toContain("utm_source");
    expect(html).toContain("Submit these answers");
    expect(html).not.toContain('name="utm_source"');
  });

  it("rejects repeated parameters for single-value questions", async () => {
    const { app, id } = await withForm();
    const html = await (await app.request(`/f/${id}/review?q1=Great&q1=Poor&q3=2`)).text();
    expect(html).toContain("Give one answer only.");
  });

  it("handles very long text", async () => {
    const { app, id } = await withForm();
    const html = await (await app.request(`/f/${id}/review?q1=Great&q3=2&q4=${"y".repeat(6000)}`)).text();
    expect(html).toContain("Keep this under 5,000 characters.");
  });

  it("saves via the review page's POST", async () => {
    const { app, id, db } = await withForm();
    const res = await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "1000", q2: ["Intro", "Lab"] }));
    expect(res.status).toBe(303);
    expect(await firstAnswers(db)).toEqual({ q1: "Great", q2: ["Intro", "Lab"], q3: 1000 });
  });
});

describe("Fill with Claude link", () => {
  it("opens a new Claude chat with the whole form in the message", async () => {
    const { app, id } = await withForm();
    const res = await app.request(`/c/${id}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://claude.ai/new");
    const q = loc.searchParams.get("q")!;
    expect(q).toContain(`https://relay.test/f/${id}/review?q1=<answer 1>`);
    expect(q).toContain("How was the workshop?");
    expect(res.headers.get("location")!.length).toBeLessThanOrEqual(MAX_PREFILL_URL);
  });

  it("falls back to a copy-and-paste page when the form is too long for a link", async () => {
    const options = Array.from({ length: 50 }, (_, i) => `A fairly long answer option number ${i + 1} for this question`);
    const fields = Array.from({ length: 6 }, (_, i) => ({ id: `q${i + 1}`, type: "single_choice", label: `Question ${i + 1}`, options }));
    const { app, id } = await withForm({}, { title: "Long", fields });
    const page = await app.request(`/c/${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    const message = /<textarea[^>]*id="relay-message"[^>]*>([^<]*)<\/textarea>/.exec(html)![1]!;
    expect(message).toContain(`https://relay.test/a/${id}`);
    expect(html).toContain('href="https://claude.ai/new"');
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    const src = /<script src="([^"]+)" defer><\/script>/.exec(html)![1]!;
    expect((await app.request(src)).status).toBe(200);
  });

  it("opens ChatGPT the same way, and rejects unknown assistants", async () => {
    const { app, id } = await withForm();
    const res = await app.request(`/c/${id}/chatgpt`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://chatgpt.com/");
    expect(loc.searchParams.get("q")).toContain("How was the workshop?");
    expect((await app.request(`/c/${id}/claude`)).headers.get("location")).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
    expect((await app.request(`/c/${id}/evilbot`)).status).toBe(404);
  });

  it("pages outside the form flow run no scripts", async () => {
    const res = await setup().app.request("/");
    expect(res.headers.get("content-security-policy")).not.toContain("script-src");
    expect(await res.text()).not.toContain("<script");
  });
});

describe("robots.txt", () => {
  it("lets Claude's fetcher read form pages, which stay noindex", async () => {
    const { app } = setup();
    const txt = await (await app.request("/robots.txt")).text();
    expect(txt).not.toMatch(/Disallow:\s*\/f\//);
    expect(txt).toMatch(/Disallow:\s*\/api\//);
  });
});

describe("assistant text page", () => {
  it("serves the same text at /a/:id and the older /f/:id/clean", async () => {
    const { app, relay } = setup();
    const { id } = await relay.createForm(sampleForm);
    const a = await app.request(`/a/${id}`);
    const old = await app.request(`/f/${id}/clean`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toContain("text/plain");
    expect(await a.text()).toBe(await old.text());
    expect((await app.request("/a/zzzzzzzzzzzzzz")).status).toBe(404);
  });
});

describe("review link template", () => {
  it("is returned with the form, and a link built from it fills the review page", async () => {
    const { app, id, created } = await withForm();
    const template = (created as unknown as { links: { review_template: string } }).links.review_template;
    expect(template).toBe(`https://relay.test/f/${id}/review?q1=<answer>&q2=<option>&q2=<another option>&q3=<answer>&q4=<answer>&q5=<answer>`);
    const filled = template
      .replace("q1=<answer>", "q1=Great")
      .replace("q2=<option>", "q2=Intro")
      .replace("q2=<another option>", "q2=Lab")
      .replace("q3=<answer>", "q3=7")
      .replace(/&q[45]=<answer>/g, "");
    const page = await (await app.request(new URL(filled).pathname + new URL(filled).search)).text();
    expect(page).toContain("Great");
    expect(page).toContain("Lab");
    expect(page).toContain(">7<");
  });
});

describe("one link, any assistant", () => {
  it("form page offers Claude, ChatGPT and a copyable message for any other assistant", async () => {
    const { app, id } = await withForm();
    const res = await app.request(`/f/${id}`);
    const html = await res.text();
    expect(html).toContain(`href="/c/${id}/claude"`);
    expect(html).toContain(`href="/c/${id}/chatgpt"`);
    expect(html).toContain("Other assistant");
    expect(/<textarea[^>]*id="relay-message"[^>]*>([^<]*)<\/textarea>/.exec(html)![1]).toContain("How was the workshop?");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("tells agents where the plain-text version is", async () => {
    const { app, id } = await withForm();
    const html = await (await app.request(`/f/${id}`)).text();
    expect(html).toContain(`<link rel="alternate" type="text/plain" href="https://relay.test/a/${id}"`);
    expect(html).toContain(`For AI assistants: a plain-text version of this form`);
  });

  it("serves the agent version on the form link to clients that ask for text", async () => {
    const { app, id } = await withForm();
    for (const accept of ["text/plain", "text/markdown", "text/markdown, text/html;q=0.5"]) {
      const res = await app.request(`/f/${id}`, { headers: { Accept: accept } });
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toMatch(/^RELAY FORM · agent-forms\/1 · spec: https:\/\/relay\.test\/spec/);
      expect(res.headers.get("vary")).toContain("Accept");
    }
    const browser = await app.request(`/f/${id}`, { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
    expect(browser.headers.get("content-type")).toContain("text/html");
  });
});

describe("agent-forms spec", () => {
  it("is served at /spec and matches docs/agent-forms.md", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync(new URL("../docs/agent-forms.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const res = await setup().app.request("/spec");
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toBe(doc);
  });
});

describe("editing a form", () => {
  const put = (app: Awaited<ReturnType<typeof withForm>>["app"], id: string, body: unknown) =>
    app.request(`/api/forms/${id}`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("rewords, adds and removes questions, keeping the link and old answers", async () => {
    const { app, id } = await withForm();
    await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "8", q4: "More labs" }));
    const res = await put(app, id, {
      title: "Workshop feedback",
      fields: [
        { id: "q1", type: "single_choice", label: "How was it overall?", required: true, options: ["Great", "Okay", "Poor", "Amazing"] },
        { id: "q3", type: "number", label: "Score 0–10", required: true },
        { type: "short_text", label: "Your role" },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changes: string[]; fields: { id: string }[] };
    expect(body.changes).toContain('Edited "How was it overall?" (q1): wording, options.');
    expect(body.changes).toContain('Removed "What should we improve?" (q4). Its 1 past answer is kept in get_responses.');
    // The new question must not reuse q2, q4 or q5: those ids belonged to removed questions.
    expect(body.fields.map((f) => f.id)).toEqual(["q1", "q3", "q6"]);
    expect(await (await app.request(`/f/${id}`)).text()).toContain("How was it overall?");
    const responses = (await (await app.request(`/api/forms/${id}/responses`, { headers: auth })).json()) as { responses: { answers: Record<string, unknown> }[] };
    expect(responses.responses[0]!.answers.q4).toBe("More labs");
  });

  it("refuses a type change once people have answered, and saves nothing", async () => {
    const { app, id } = await withForm();
    await app.request(`/f/${id}/submit`, form({ q1: "Great", q3: "8" }));
    const res = await put(app, id, { title: "Changed", fields: [{ id: "q3", type: "short_text", label: "Score" }] });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { details: string[] };
    expect(body.details[0]).toContain("can't change the type from number to short_text");
    expect(await (await app.request(`/f/${id}`)).text()).toContain("Workshop feedback");
  });

  it("allows a type change before anyone has answered", async () => {
    const { app, id } = await withForm();
    const res = await put(app, id, { title: "Workshop feedback", fields: [{ id: "q3", type: "short_text", label: "Score" }] });
    expect(res.status).toBe(200);
  });
});

describe("new since last check", () => {
  it("counts unseen responses per form and clears them once read", async () => {
    const { app, id } = await withForm();
    const list = async () => ((await (await app.request("/api/forms", { headers: auth })).json()) as { forms: { new_responses: number }[] }).forms[0]!.new_responses;
    expect(await list()).toBe(0);
    for (const q1 of ["Great", "Okay", "Poor"]) await app.request(`/f/${id}/submit`, form({ q1, q3: "5" }));
    expect(await list()).toBe(3);

    const page = (await (await app.request(`/api/forms/${id}/responses?only_new=1&limit=2`, { headers: auth })).json()) as { responses: { answers: { q1: string } }[]; remaining_new: number };
    expect(page.responses.map((r) => r.answers.q1)).toEqual(["Great", "Okay"]);
    expect(page.remaining_new).toBe(1);
    expect(await list()).toBe(1);

    await app.request(`/api/forms/${id}/responses`, { headers: auth });
    expect(await list()).toBe(0);
  });
});

describe("home page setup guide", () => {
  const keyOf = (html: string) => /<code class="keybox">([A-Za-z0-9_-]{32})<\/code>/.exec(html)?.[1];

  it("offers a fresh owner key on every visit and is never cached", async () => {
    const { app } = setup();
    const first = await app.request("/");
    const a = keyOf(await first.text());
    const b = keyOf(await (await app.request("/")).text());
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect(first.headers.get("cache-control")).toBe("no-store");
  });

  it("links to a one-click Vercel deploy that asks for the right settings", async () => {
    const html = await (await setup().app.request("/")).text();
    const href = /href="(https:\/\/vercel\.com\/new\/clone\?[^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&");
    const u = new URL(href);
    expect(u.searchParams.get("repository-url")).toBe("https://github.com/CyberWanderer123/Relay");
    expect(u.searchParams.get("env")).toBe("RELAY_OWNER_KEY,TURSO_DATABASE_URL,TURSO_AUTH_TOKEN");
  });

  it("says whether this Relay is set up, and shows its connector address", async () => {
    const owned = await (await setup().app.request("/")).text();
    expect(owned).toContain("belongs to its owner");
    expect(owned).toContain("https://relay.test/mcp");
    const fresh = await (await setup({ ownerKey: undefined }).app.request("/")).text();
    expect(fresh).toContain("set up yet.");
    expect(fresh).not.toContain("belongs to its owner");
  });
});

describe("example key on a set-up Relay", () => {
  it("is tucked away and labelled as not this Relay's key", async () => {
    const owned = await (await setup().app.request("/")).text();
    expect(owned).toMatch(/<details class="keygen"><summary>Setting up a new Relay\? Generate a key for it<\/summary>\s*<code class="keybox">/);
    expect(owned).toContain("won't work here");
    const fresh = await (await setup({ ownerKey: undefined }).app.request("/")).text();
    expect(fresh).not.toContain('class="keygen"');
  });
});
