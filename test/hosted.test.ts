import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth, form, setup } from "./helpers.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const verifier = crypto.randomBytes(40).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const hosted = () => setup({ hosted: true, monthlyResponses: 2, contactEmail: "hello@example.com" });
type App = ReturnType<typeof setup>["app"];

const json = (body: unknown, key?: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(key && { Authorization: `Bearer ${key}` }) },
  body: JSON.stringify(body),
});
const makeForm = async (app: App, key: string, title = "Feedback") => {
  const res = await app.request("/api/forms", json({ title, fields: [{ id: "q1", type: "short_text", label: "Comment" }] }, key));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};

describe("hosted sign-up through the connector", () => {
  it("creates an account on the Allow page, shows its key once, and connects", async () => {
    const { app } = hosted();
    const reg = (await (await app.request("/oauth/register", json({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }))).json()) as { client_id: string };
    const params = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1" });

    const allow = await (await app.request(`/oauth/authorize?${params}`)).text();
    expect(allow).toContain("Create a free account");
    expect(allow).toContain("2 responses a month");

    const signup = await app.request("/oauth/signup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(params), name: "Asha", email: "asha@example.com" }) });
    const page = await signup.text();
    const key = /<code class="keybox">(rly_key_[A-Za-z0-9_-]+)<\/code>/.exec(page)![1]!;
    expect(signup.headers.get("content-security-policy")).toContain("form-action 'self' https://claude.ai");

    const approve = new URLSearchParams({ ...Object.fromEntries(params), owner_key: key, decision: "allow", saved: "yes" });
    const redirect = new URL((await app.request("/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: approve })).headers.get("location")!);
    const code = redirect.searchParams.get("code")!;
    const tok = (await (await app.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.client_id }) })).json()) as { access_token: string };

    // The connection acts for the new account: a form it creates belongs to that account only.
    const mcp = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${tok.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_form", arguments: { title: "Asha's poll", fields: [{ type: "short_text", label: "Q" }] } } }),
    });
    expect(mcp.status).toBe(200);
    const mine = (await (await app.request("/api/forms", { headers: { Authorization: `Bearer ${key}` } })).json()) as { forms: { title: string }[] };
    expect(mine.forms.map((f) => f.title)).toEqual(["Asha's poll"]);
    const operators = (await (await app.request("/api/forms", { headers: auth })).json()) as { forms: unknown[] };
    expect(operators.forms).toHaveLength(0);
  });
});

describe("accounts are isolated", () => {
  it("can't see or change each other's forms", async () => {
    const { app, relay } = hosted();
    const a = await relay.createAccount({ name: "A" });
    const b = await relay.createAccount({ name: "B" });
    const formA = await makeForm(app, a.key);
    const operatorForm = await makeForm(app, auth.Authorization.slice(7), "Operator form");

    for (const id of [formA, operatorForm]) {
      const res = await app.request(`/api/forms/${id}`, { headers: { Authorization: `Bearer ${b.key}` } });
      expect(res.status).toBe(404);
    }
    expect((await app.request(`/api/forms/${formA}/close`, { method: "POST", headers: { Authorization: `Bearer ${b.key}` } })).status).toBe(404);
    expect((await app.request(`/api/forms/${formA}`, { headers: { Authorization: `Bearer ${a.key}` } })).status).toBe(200);
    // Respondents still reach any form by its link.
    expect((await app.request(`/f/${formA}`)).status).toBe(200);
  });
});

describe("free monthly limit", () => {
  it("pauses an account's forms at the limit and tells the creator", async () => {
    const { app, relay } = hosted();
    const a = await relay.createAccount({});
    const id = await makeForm(app, a.key);
    expect((await app.request(`/f/${id}/submit`, form({ q1: "one" }))).status).toBe(303);
    expect((await app.request(`/f/${id}/submit`, form({ q1: "two" }))).status).toBe(303);

    const paused = await app.request(`/f/${id}`);
    expect(paused.status).toBe(410);
    expect(await paused.text()).toContain("Not taking responses right now.");
    expect((await app.request(`/f/${id}/submit`, form({ q1: "three" }))).status).toBe(410);

    const list = (await (await app.request("/api/forms", { headers: { Authorization: `Bearer ${a.key}` } })).json()) as { usage: { paused: boolean; notice: string; limit: number } };
    expect(list.usage).toMatchObject({ paused: true, limit: 2 });
    expect(list.usage.notice).toContain("hello@example.com");
    expect(list.usage.notice).toContain("run your own Relay");
  });

  it("never limits the operator", async () => {
    const { app } = hosted();
    const id = await makeForm(app, auth.Authorization.slice(7));
    for (const q1 of ["1", "2", "3"]) expect((await app.request(`/f/${id}/submit`, form({ q1 }))).status).toBe(303);
    const list = (await (await app.request("/api/forms", { headers: auth })).json()) as { usage: { limit: number | null } };
    expect(list.usage.limit).toBeNull();
  });
});

describe("hosted webhook safeguard", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("only sends the operator's responses to the operator's webhook", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response("ok");
    });
    const { app, relay } = setup({ hosted: true, webhookUrl: "https://hooks.example/relay" });
    const a = await relay.createAccount({});
    const accountForm = await makeForm(app, a.key);
    const operatorForm = await makeForm(app, auth.Authorization.slice(7));
    await app.request(`/f/${accountForm}/submit`, form({ q1: "private" }));
    await app.request(`/f/${operatorForm}/submit`, form({ q1: "mine" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("mine");
  });
});

describe("self-hosted Relays", () => {
  it("offer no sign-ups and reject account keys", async () => {
    const { app, relay } = setup();
    const res = await app.request("/oauth/signup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
    expect(res.status).toBe(404);
    const stray = await relay.createAccount({});
    expect((await app.request("/api/forms", { headers: { Authorization: `Bearer ${stray.key}` } })).status).toBe(401);
    expect(await (await app.request("/")).text()).not.toContain("Use Relay right here");
  });

  it("home page on a hosted Relay leads with the free option", async () => {
    const html = await (await hosted().app.request("/")).text();
    expect(html).toContain("Use Relay right here");
    expect(html).toContain("https://relay.test/mcp");
    expect(html).toContain("mailto:hello@example.com");
  });
});

describe("sign-up requires an email, one account per email", () => {
  it("refuses a missing email and a reused one", async () => {
    const { app } = hosted();
    const reg = (await (await app.request("/oauth/register", json({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }))).json()) as { client_id: string };
    const params = { response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s" };
    const signup = (extra: Record<string, string>) =>
      app.request("/oauth/signup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, ...extra }) });

    const none = await signup({ name: "No email" });
    expect(none.status).toBe(401);
    expect(await none.text()).toContain("Enter a valid email address");

    expect((await signup({ email: "same@example.com" })).status).toBe(200);
    const again = await signup({ email: "SAME@example.com" });
    expect(again.status).toBe(401);
    const text = await again.text();
    expect(text).toContain("An account already uses SAME@example.com");
    expect(text).toContain("hello@example.com");
  });
});
