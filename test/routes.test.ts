import { describe, expect, it } from "vitest";
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
    expect(created.share_message).toContain(`Quick form: https://relay.test/f/${id}`);
    expect(created.share_message).toContain(`Or fill it with Claude: https://relay.test/c/${id}`);
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

describe("Claude redirect", () => {
  it("redirects to a new Claude chat with a short prefilled message", async () => {
    const { app, id } = await withForm();
    const res = await app.request(`/c/${id}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("https://claude.ai");
    const q = loc.searchParams.get("q")!;
    expect(q).toContain(`https://relay.test/a/${id}`);
    expect(q.length).toBeLessThan(300);
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
