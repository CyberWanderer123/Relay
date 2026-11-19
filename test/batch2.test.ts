import { describe, expect, it } from "vitest";
import { renderChatPrompt, renderClean } from "../src/clean.js";
import { RelayError } from "../src/errors.js";
import { normalizeForm, parseOrigin, validateAnswers } from "../src/schema.js";
import type { StoredForm } from "../src/service.js";
import { contrast, themeCss } from "../src/views/theme.js";
import { auth, form, setup } from "./helpers.js";

const teamForm = {
  title: "Team survey",
  fields: [
    { id: "has_team", type: "single_choice", label: "Do you have a team?", required: true, options: ["Yes", "No"] },
    { id: "team_size", type: "number", label: "How many people?", required: true, show_if: { field: "has_team", any_of: ["yes"] } },
    { id: "notes", type: "short_text", label: "Anything else?" },
  ],
};

async function create(app: ReturnType<typeof setup>["app"], def: object) {
  const res = await app.request("/api/forms", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(def) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; links: { embed_code?: string } };
}

describe("conditional questions", () => {
  it("only point at earlier choice questions and their real options", () => {
    const bad = (fields: object[]) => () => normalizeForm({ title: "T", fields });
    expect(bad([{ id: "a", type: "short_text", label: "A", show_if: { field: "b", any_of: ["Yes"] } }, { id: "b", type: "single_choice", label: "B", options: ["Yes", "No"] }])).toThrow(RelayError);
    expect(bad([{ id: "a", type: "short_text", label: "A" }, { id: "b", type: "short_text", label: "B", show_if: { field: "a", any_of: ["x"] } }])).toThrow(RelayError);
    expect(bad([{ id: "a", type: "single_choice", label: "A", options: ["Yes", "No"] }, { id: "b", type: "short_text", label: "B", show_if: { field: "a", any_of: ["Maybe"] } }])).toThrow(RelayError);
    expect(normalizeForm(teamForm).fields[1]!.show_if).toEqual({ field: "has_team", any_of: ["Yes"] });
  });

  it("are required only when they apply, and ignored when they don't", () => {
    const fields = normalizeForm(teamForm).fields;
    expect(validateAnswers(fields, { has_team: "No" })).toEqual({ ok: true, answers: { has_team: "No" } });
    expect(validateAnswers(fields, { has_team: "No", team_size: "12" })).toEqual({ ok: true, answers: { has_team: "No" } });
    const yes = validateAnswers(fields, { has_team: "Yes" });
    expect(yes.ok).toBe(false);
    if (!yes.ok) expect(yes.errors.team_size).toBe("This question needs an answer.");
    expect(validateAnswers(fields, { has_team: "Yes", team_size: "4" })).toEqual({ ok: true, answers: { has_team: "Yes", team_size: 4 } });
  });

  it("tell the web form, the review page and assistants when they apply", async () => {
    const { app } = setup();
    const { id } = await create(app, teamForm);
    const page = await (await app.request(`/f/${id}`)).text();
    expect(page).toContain('data-show-field="has_team" data-show-any="[&quot;Yes&quot;]"');
    expect(page).toContain("Only if “Do you have a team?” is Yes");
    expect(page).toContain("data-relay-form");

    const review = await (await app.request(`/f/${id}/review?has_team=No&notes=hi`)).text();
    expect(review).not.toContain("How many people?");
    expect(review).toContain("Anything else?");

    const stored = { id, ...normalizeForm(teamForm), status: "open", created_at: 0 } as StoredForm;
    const links = { fill: "https://relay.test/f/x", claude: "", clean: "", review: "https://relay.test/f/x/review" };
    expect(renderClean(stored, links)).toContain("team_size | number | required | How many people? | only if has_team is Yes");
    expect(renderChatPrompt(stored, links)).toContain("Only ask this if my answer to 1 was Yes; otherwise skip it.");
  });

  it("can't lose the option a condition depends on", async () => {
    const { app } = setup();
    const { id } = await create(app, teamForm);
    const fields = [{ ...teamForm.fields[0], options: ["No", "Not yet"] }, teamForm.fields[1], teamForm.fields[2]];
    const res = await app.request(`/api/forms/${id}`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Team survey", fields }) });
    expect(res.status).toBe(422);
  });
});

describe("branding", () => {
  it("keeps a pale brand colour readable", () => {
    const css = themeCss({ brand: { accent: "#FFD400" } });
    const primary = /--primary: (#[0-9a-f]{6});/.exec(css)![1]!;
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    expect(contrast(rgb(primary), [0xf7, 0xf7, 0xf5])).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain("--accent: #ffd400;");
    expect(themeCss({})).toBe("");
  });

  it("serves the theme and shows the logo on the form", async () => {
    const { app } = setup();
    const { id } = await create(app, { title: "Branded", fields: [{ type: "short_text", label: "A" }], brand: { accent: "#0f766e", logo_url: "https://example.com/logo.svg" } });
    const html = await (await app.request(`/f/${id}`)).text();
    expect(html).toMatch(new RegExp(`<link rel="stylesheet" href="/f/${id}/theme.css\\?v=[0-9a-f]{10}">`));
    expect(html).toContain('<img src="https://example.com/logo.svg" alt="Branded"');
    const theme = await app.request(`/f/${id}/theme.css`);
    expect(theme.headers.get("content-type")).toContain("text/css");
    expect(await theme.text()).toContain("--accent: #0f766e;");
    expect(() => normalizeForm({ title: "T", fields: [{ type: "short_text", label: "A" }], brand: { logo_url: "http://example.com/x.png" } })).toThrow(RelayError);
    expect(() => normalizeForm({ title: "T", fields: [{ type: "short_text", label: "A" }], brand: { accent: "teal" } })).toThrow(RelayError);
  });
});

describe("embedding", () => {
  it("accepts only real https sites", () => {
    expect(parseOrigin("https://example.com/contact")).toBe("https://example.com");
    expect(parseOrigin("https://*.example.com")).toBe("https://*.example.com");
    expect(parseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(parseOrigin("*")).toBeUndefined();
    expect(parseOrigin("http://example.com")).toBeUndefined();
  });

  it("refuses framing unless the form lists the site", async () => {
    const { app } = setup();
    const plain = await create(app, { title: "Plain", fields: [{ type: "short_text", label: "A" }] });
    const res = await app.request(`/f/${plain.id}`);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(plain.links.embed_code).toBeUndefined();
  });

  it("lets listed sites embed the form, with a simpler embedded view", async () => {
    const { app } = setup();
    const { id, links } = await create(app, { title: "Contact", fields: [{ id: "name", type: "short_text", label: "Name" }], embed_origins: ["https://example.com", "https://*.example.org"] });
    expect(links.embed_code).toBe(`<iframe src="https://relay.test/f/${id}?embed=1" title="Contact" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`);

    const res = await app.request(`/f/${id}?embed=1`);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors https://example.com https://*.example.org");
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("x-relay-frame-ancestors")).toBeNull();
    const html = await res.text();
    expect(html).not.toContain('class="topbar"');
    expect(html).toContain(`action="/f/${id}/submit?embed=1"`);
    expect(html).toMatch(/href="\/c\/[a-z0-9]{14}\/claude" rel="noreferrer" target="_blank"/);

    const submit = await app.request(`/f/${id}/submit?embed=1`, form({ name: "Asha" }));
    expect(submit.headers.get("location")).toBe(`/f/${id}/thanks?embed=1`);
    const thanks = await app.request(`/f/${id}/thanks?embed=1`);
    expect(thanks.headers.get("content-security-policy")).toContain("frame-ancestors https://example.com");

    // Everything else stays unframeable.
    expect((await app.request("/")).headers.get("x-frame-options")).toBe("DENY");
    expect((await app.request(`/api/forms/${id}`, { headers: auth })).headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
