import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { KEY, setup } from "./helpers.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const verifier = crypto.randomBytes(40).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

type App = ReturnType<typeof setup>["app"];

async function register(app: App, body: object = { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }) {
  const res = await app.request("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, json: (await res.json()) as { client_id: string; client_secret?: string } };
}

const authorizeQuery = (clientId: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: "https://relay.test/mcp", ...extra });

async function approve(app: App, clientId: string, key = KEY, decision = "allow") {
  const form = authorizeQuery(clientId);
  form.set("owner_key", key);
  form.set("decision", decision);
  return app.request("/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
}

const token = (app: App, body: Record<string, string>) =>
  app.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });

async function signIn(app: App) {
  const { json } = await register(app);
  const redirect = new URL((await approve(app, json.client_id)).headers.get("location")!);
  const code = redirect.searchParams.get("code")!;
  const res = await token(app, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: json.client_id });
  return { clientId: json.client_id, code, tokens: (await res.json()) as { access_token: string; refresh_token: string; expires_in: number } };
}

const listTools = (app: App, auth?: string) =>
  app.request("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(auth && { Authorization: auth }) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

describe("OAuth discovery", () => {
  it("points an unauthenticated /mcp request at the metadata", async () => {
    const { app } = setup();
    const res = await listTools(app);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="https://relay.test/.well-known/oauth-protected-resource/mcp"');
  });

  it("publishes resource and authorization server metadata", async () => {
    const { app } = setup();
    const prm = (await (await app.request("/.well-known/oauth-protected-resource/mcp")).json()) as { resource: string; authorization_servers: string[] };
    expect(prm).toMatchObject({ resource: "https://relay.test/mcp", authorization_servers: ["https://relay.test"] });
    const asm = (await (await app.request("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(asm).toMatchObject({
      issuer: "https://relay.test",
      authorization_endpoint: "https://relay.test/oauth/authorize",
      token_endpoint: "https://relay.test/oauth/token",
      registration_endpoint: "https://relay.test/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  });
});

describe("OAuth sign-in", () => {
  it("runs the full flow and the access token works on /mcp", async () => {
    const { app } = setup();
    const { tokens } = await signIn(app);
    expect(tokens.access_token).toMatch(/^rly_at_/);
    expect(tokens.expires_in).toBe(3600);
    const res = await listTools(app, `Bearer ${tokens.access_token}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(8);
  });

  it("shows the app and its return address on the approval page, and allows the redirect in form-action", async () => {
    const { app } = setup();
    const { json } = await register(app);
    const page = await app.request(`/oauth/authorize?${authorizeQuery(json.client_id)}`);
    const html = await page.text();
    expect(html).toContain("Allow <em>Claude</em> to use your Relay?");
    expect(html).toContain("claude.ai");
    expect(page.headers.get("content-security-policy")).toContain("form-action 'self' https://claude.ai");
    expect(page.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a wrong owner key and lets the owner deny", async () => {
    const { app } = setup();
    const { json } = await register(app);
    const wrong = await approve(app, json.client_id, "not-the-key");
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("match this Relay&#39;s owner key");
    const denied = new URL((await approve(app, json.client_id, "", "deny")).headers.get("location")!);
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.get("state")).toBe("xyz");
  });

  it("never redirects to an address the app didn't register", async () => {
    const { app } = setup();
    const { json } = await register(app);
    const res = await app.request(`/oauth/authorize?${authorizeQuery(json.client_id, { redirect_uri: "https://evil.example/cb" })}`);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    const unknown = await app.request(`/oauth/authorize?${authorizeQuery("rly_client_nope")}`);
    expect(unknown.status).toBe(400);
  });

  it("requires PKCE S256", async () => {
    const { app } = setup();
    const { json } = await register(app);
    const res = await app.request(`/oauth/authorize?${authorizeQuery(json.client_id, { code_challenge_method: "plain" })}`);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });

  it("rejects a wrong verifier, and a code used twice", async () => {
    const { app } = setup();
    const { json } = await register(app);
    const code = new URL((await approve(app, json.client_id)).headers.get("location")!).searchParams.get("code")!;
    const bad = await token(app, { grant_type: "authorization_code", code, code_verifier: "x".repeat(50), redirect_uri: REDIRECT, client_id: json.client_id });
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_grant");
    // The failed attempt consumed the code: it cannot be retried, even with the right verifier.
    const again = await token(app, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: json.client_id });
    expect(again.status).toBe(400);
  });

  it("rotates refresh tokens", async () => {
    const { app } = setup();
    const { clientId, tokens } = await signIn(app);
    const res = await token(app, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    const next = (await res.json()) as { access_token: string; refresh_token: string };
    expect(next.access_token).not.toBe(tokens.access_token);
    expect((await listTools(app, `Bearer ${next.access_token}`)).status).toBe(200);
    const reuse = await token(app, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    expect(reuse.status).toBe(400);
  });

  it("checks the secret of confidential clients", async () => {
    const { app } = setup();
    const { json } = await register(app, { client_name: "Other", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_post" });
    expect(json.client_secret).toMatch(/^rly_secret_/);
    const code = new URL((await approve(app, json.client_id)).headers.get("location")!).searchParams.get("code")!;
    const noSecret = await token(app, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: json.client_id });
    expect(noSecret.status).toBe(401);
  });

  it("revokes tokens, and changing the owner key cuts every token off", async () => {
    const { app, relay, db, config } = setup();
    const { tokens } = await signIn(app);
    await app.request("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tokens.access_token }) });
    expect((await listTools(app, `Bearer ${tokens.access_token}`)).status).toBe(401);

    const second = await signIn(app);
    const { createApp } = await import("../src/create-app.js");
    const rotated = createApp(relay, { ...config, ownerKey: "a-brand-new-owner-key-123" });
    expect((await listTools(rotated, `Bearer ${second.tokens.access_token}`)).status).toBe(401);
    void db;
  });

  it("refuses redirect addresses that aren't https (except localhost)", async () => {
    const { app } = setup();
    const { res } = await register(app, { redirect_uris: ["http://evil.example/cb"], token_endpoint_auth_method: "none" });
    expect(res.status).toBe(400);
    const local = await register(app, { redirect_uris: ["http://localhost:3000/cb"], token_endpoint_auth_method: "none" });
    expect(local.res.status).toBe(201);
  });

  it("keeps owner-key connectors working", async () => {
    const { app } = setup();
    expect((await listTools(app, `Bearer ${KEY}`)).status).toBe(200);
  });
});
