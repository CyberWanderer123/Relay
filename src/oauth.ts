import crypto from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireAccount, type AuthEnv } from "./routes/api.js";
import { OPERATOR } from "./service.js";
import { clientIp, FORM_ACTION_HEADER, keyMatches, RateLimiter, type Deps } from "./routes/deps.js";
import { cleanText } from "./schema.js";
import type { Relay } from "./service.js";
import { accountKeyPage, authorizePage, oauthErrorPage } from "./views/pages.js";

/* OAuth 2.1 for MCP connectors (the MCP authorization spec): Relay is both the protected
   resource (/mcp) and its own authorization server.

   - Discovery: /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server.
   - Apps register themselves (dynamic client registration, RFC 7591).
   - The owner approves an app once on /oauth/authorize by typing the owner key. Relay has a
     single owner, so the key is the login.
   - Authorization code + PKCE (S256 only), short-lived access tokens, rotating refresh tokens.
   - Codes and tokens are stored only as SHA-256 hashes. Every token carries a fingerprint of
     the owner key it was issued under, so changing RELAY_OWNER_KEY revokes them all. */

export const ACCESS_TTL = 60 * 60; // 1 hour
export const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 days
export const CODE_TTL = 10 * 60; // 10 minutes
export const SCOPE = "relay";

const now = () => Math.floor(Date.now() / 1000);
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = (prefix: string) => prefix + crypto.randomBytes(32).toString("base64url");
export const keyFingerprint = (ownerKey: string) => sha256(`relay-owner-key:${ownerKey}`).slice(0, 32);
export const resourceUrl = (baseUrl: string) => `${baseUrl}/mcp`;
export const protectedResourceMetadataUrl = (baseUrl: string) => `${baseUrl}/.well-known/oauth-protected-resource/mcp`;

/** https anywhere, or http only on this machine (for local MCP clients). No fragments. */
export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Fingerprint of an account's current key. Tokens carry it, so a changed key (the operator's
 * RELAY_OWNER_KEY, or an account key) cuts off every token issued under the old one.
 */
async function currentFingerprint(relay: Relay, ownerKey: string | undefined, account: string): Promise<string | null> {
  if (account === OPERATOR) return ownerKey ? keyFingerprint(ownerKey) : null;
  const hash = await relay.accountKeyHash(account);
  return hash ? keyFingerprint(hash) : null;
}

/** The account a key belongs to: the operator's owner key, or (hosted mode) an account key. */
async function accountForKey(relay: Relay, ownerKey: string | undefined, key: string): Promise<string | null> {
  if (ownerKey && keyMatches(key, ownerKey)) return OPERATOR;
  if (relay.hosted) return (await relay.accountForKey(key))?.id ?? null;
  return null;
}

/** The account a live access token acts for, or null. */
export async function accessTokenAccount(relay: Relay, ownerKey: string | undefined, token: string): Promise<string | null> {
  if (!ownerKey || !token.startsWith("rly_at_")) return null;
  const grant = await relay.oauthStore.getGrant(sha256(token), "access");
  if (!grant || Number(grant.expires_at) <= now()) return null;
  const d = JSON.parse(grant.data) as { acc?: string; kf?: string };
  const account = d.acc ?? OPERATOR;
  return d.kf && d.kf === (await currentFingerprint(relay, ownerKey, account)) ? account : null;
}

/**
 * Guard for /mcp: an OAuth access token, or a key (Bearer, bare header or ?key=) for
 * connectors set up before OAuth. A 401 points clients at the metadata so they can start OAuth.
 */
export function requireMcpAuth({ relay, config }: Deps): MiddlewareHandler<AuthEnv> {
  const challenge = `Bearer resource_metadata="${protectedResourceMetadataUrl(relay.baseUrl)}", scope="${SCOPE}"`;
  const keyGuard = requireAccount({ relay, config }, true, challenge);
  return async (c, next) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1]?.trim();
    if (bearer?.startsWith("rly_at_")) {
      const account = await accessTokenAccount(relay, config.ownerKey, bearer);
      if (account) {
        c.set("account", account);
        return next();
      }
      console.warn(`auth rejected: ${c.req.method} ${c.req.path} — expired or revoked access token`);
      c.header("WWW-Authenticate", `${challenge}, error="invalid_token"`);
      return c.json({ error: "invalid_token", error_description: "The access token is expired or revoked. Sign in again." }, 401);
    }
    return keyGuard(c, next);
  };
}

type AuthParams = Partial<Record<"client_id" | "redirect_uri" | "response_type" | "state" | "code_challenge" | "code_challenge_method" | "scope" | "resource", string>>;

type CheckedRequest =
  | { kind: "fatal"; message: string }
  | { kind: "redirect-error"; redirect: string; error: string; description: string; state?: string }
  | { kind: "ok"; client: { id: string; name: string | null }; redirect: string; params: AuthParams };

const pick = (src: Record<string, unknown>): AuthParams => {
  const out: AuthParams = {};
  for (const k of ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope", "resource"] as const) {
    const v = src[k];
    if (typeof v === "string" && v.length <= 2048) out[k] = v;
  }
  return out;
};

/**
 * Validate an authorization request. Until the client and its redirect URI are known to be
 * genuine, errors are shown on Relay's own page — never sent to an unverified address.
 */
async function checkAuthRequest(relay: Relay, p: AuthParams): Promise<CheckedRequest> {
  if (!p.client_id) return { kind: "fatal", message: "The request is missing the app's client_id." };
  const client = await relay.oauthStore.getClient(p.client_id);
  if (!client) return { kind: "fatal", message: "This app isn't registered with this Relay. Remove the connector and add it again." };
  const uris = JSON.parse(client.redirect_uris) as string[];
  const redirect = p.redirect_uri ?? (uris.length === 1 ? uris[0] : undefined);
  if (!redirect || !uris.includes(redirect)) return { kind: "fatal", message: "The app's return address doesn't match the one it registered, so Relay stopped here." };

  const fail = (error: string, description: string): CheckedRequest => ({ kind: "redirect-error", redirect, error, description, state: p.state });
  if (p.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (p.code_challenge_method !== "S256" || !p.code_challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  if (p.resource && p.resource !== resourceUrl(relay.baseUrl) && p.resource !== relay.baseUrl) {
    return fail("invalid_target", "This server only issues tokens for its own /mcp endpoint.");
  }
  return { kind: "ok", client: { id: client.id, name: client.name }, redirect, params: { ...p, redirect_uri: redirect } };
}

const withParams = (redirect: string, params: Record<string, string | undefined>) => {
  const u = new URL(redirect);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
};

const tokenError = (c: Context, status: 400 | 401, error: string, description: string) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
};

export function oauthRoutes({ relay, config }: Deps) {
  const r = new Hono();
  const base = relay.baseUrl;
  const keyAttempts = new RateLimiter(10, 10 * 60_000);
  const registrations = new RateLimiter(20, 60 * 60_000);
  const signups = new RateLimiter(5, 60 * 60_000);

  // Discovery documents and the endpoints apps call directly may be fetched cross-origin.
  r.use("/.well-known/*", cors);
  r.use("/oauth/register", cors);
  r.use("/oauth/token", cors);
  r.use("/oauth/revoke", cors);

  const resourceMetadata = (c: Context) =>
    c.json({
      resource: resourceUrl(base),
      authorization_servers: [base],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Relay",
      resource_documentation: `${base}/`,
    });
  r.get("/.well-known/oauth-protected-resource", resourceMetadata);
  r.get("/.well-known/oauth-protected-resource/mcp", resourceMetadata);

  const serverMetadata = (c: Context) =>
    c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${base}/`,
    });
  r.get("/.well-known/oauth-authorization-server", serverMetadata);
  r.get("/.well-known/oauth-authorization-server/mcp", serverMetadata);

  // Dynamic client registration. Registering grants nothing: every app still needs the owner's approval.
  r.post("/oauth/register", bodyLimit({ maxSize: 16 * 1024, onError: (c) => tokenError(c, 400, "invalid_client_metadata", "Request too large.") }), async (c) => {
    if (!config.ownerKey) return c.json({ error: "temporarily_unavailable", error_description: "Set RELAY_OWNER_KEY to enable connectors." }, 503);
    if (!registrations.take(clientIp(c, config.trustProxy))) return c.json({ error: "slow_down", error_description: "Too many registrations. Try again later." }, 429);
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return tokenError(c, 400, "invalid_client_metadata", "Send the registration as JSON.");
    }
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every((u) => typeof u === "string" && validRedirectUri(u))) {
      return tokenError(c, 400, "invalid_redirect_uri", "redirect_uris must be 1–10 https addresses (or http on localhost).");
    }
    const grants = body.grant_types;
    if (grants !== undefined && (!Array.isArray(grants) || !grants.every((g) => g === "authorization_code" || g === "refresh_token"))) {
      return tokenError(c, 400, "invalid_client_metadata", "Only authorization_code and refresh_token grants are supported.");
    }
    const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "client_secret_basic";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
      return tokenError(c, 400, "invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
    }
    const name = typeof body.client_name === "string" ? cleanText(body.client_name).slice(0, 100) || null : null;
    const id = randomToken("rly_client_").slice(0, 40);
    const secret = method === "none" ? null : randomToken("rly_secret_");
    const issuedAt = now();
    await relay.oauthStore.insertClient({ id, name, redirect_uris: JSON.stringify(uris), secret_hash: secret ? sha256(secret) : null, created_at: issuedAt });
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        client_id: id,
        client_id_issued_at: issuedAt,
        ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
        client_name: name ?? undefined,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: method,
        scope: SCOPE,
      },
      201,
    );
  });

  // The owner's approval page.
  const showApproval = (c: Context, checked: Extract<CheckedRequest, { kind: "ok" }>, error?: string, status: 200 | 401 = 200) => {
    // The form posts to Relay, which then redirects to the app: allow that origin in form-action.
    c.header(FORM_ACTION_HEADER, new URL(checked.redirect).origin);
    c.header("Cache-Control", "no-store");
    return c.html(
      authorizePage({
        host: relay.host,
        clientName: checked.client.name,
        redirectHost: new URL(checked.redirect).host,
        params: checked.params,
        error,
        hosted: relay.hosted ? { monthlyResponses: config.monthlyResponses } : undefined,
      }),
      status,
    );
  };

  r.get("/oauth/authorize", async (c) => {
    if (!config.ownerKey) return c.html(oauthErrorPage(relay.host, "Set RELAY_OWNER_KEY on the server to enable connectors."), 503);
    const checked = await checkAuthRequest(relay, pick(c.req.query()));
    if (checked.kind === "fatal") return c.html(oauthErrorPage(relay.host, checked.message), 400);
    if (checked.kind === "redirect-error") return c.redirect(withParams(checked.redirect, { error: checked.error, error_description: checked.description, state: checked.state, iss: base }), 302);
    return showApproval(c, checked);
  });

  r.post("/oauth/authorize", bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.html(oauthErrorPage(relay.host, "Request too large."), 413) }), async (c) => {
    if (!config.ownerKey) return c.html(oauthErrorPage(relay.host, "Set RELAY_OWNER_KEY on the server to enable connectors."), 503);
    const body = await c.req.parseBody();
    const checked = await checkAuthRequest(relay, pick(body));
    if (checked.kind === "fatal") return c.html(oauthErrorPage(relay.host, checked.message), 400);
    if (checked.kind === "redirect-error") return c.redirect(withParams(checked.redirect, { error: checked.error, error_description: checked.description, state: checked.state, iss: base }), 302);
    const state = checked.params.state;

    if (body.decision === "deny") {
      return c.redirect(withParams(checked.redirect, { error: "access_denied", error_description: "The owner declined.", state, iss: base }), 302);
    }
    if (!keyAttempts.take(clientIp(c, config.trustProxy))) {
      return showApproval(c, checked, "Too many attempts. Wait ten minutes and try again.", 401);
    }
    const key = typeof body.owner_key === "string" ? body.owner_key.trim() : "";
    const account = key ? await accountForKey(relay, config.ownerKey, key) : null;
    if (!account) {
      console.warn("oauth: key did not match on the approval page");
      return showApproval(
        c,
        checked,
        relay.hosted
          ? "That key doesn't match an account here. Use the account key you saved when you signed up, or create a free account below."
          : "That key doesn't match this Relay's owner key. Use the RELAY_OWNER_KEY from this deployment's settings (on Vercel: Settings → Environment Variables), not the example key on the home page.",
        401,
      );
    }

    const code = randomToken("rly_code_");
    await relay.oauthStore.insertGrant(
      sha256(code),
      "code",
      checked.client.id,
      JSON.stringify({ ru: checked.redirect, cc: checked.params.code_challenge, res: resourceUrl(base), acc: account }),
      now() + CODE_TTL,
      now(),
    );
    return c.redirect(withParams(checked.redirect, { code, state, iss: base }), 302);
  });

  // Hosted Relay: create a free account from the approval page, show its key once, then continue.
  r.post("/oauth/signup", bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.html(oauthErrorPage(relay.host, "Request too large."), 413) }), async (c) => {
    if (!relay.hosted || !config.ownerKey) return c.html(oauthErrorPage(relay.host, "This Relay doesn't offer sign-ups. Its owner connects with the owner key."), 404);
    const body = await c.req.parseBody();
    const checked = await checkAuthRequest(relay, pick(body));
    if (checked.kind === "fatal") return c.html(oauthErrorPage(relay.host, checked.message), 400);
    if (checked.kind === "redirect-error") return c.redirect(withParams(checked.redirect, { error: checked.error, error_description: checked.description, state: checked.state, iss: base }), 302);
    if (!signups.take(clientIp(c, config.trustProxy))) return showApproval(c, checked, "Too many new accounts from your network. Try again in an hour.", 401);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showApproval(c, checked, "Enter a valid email address to create an account.", 401);
    if (await relay.emailTaken(email)) {
      const lost = relay.contactEmail ? `, or email ${relay.contactEmail} if you've lost it` : "";
      return showApproval(c, checked, `An account already uses ${email}. Sign in below with its account key${lost}.`, 401);
    }
    const account = await relay.createAccount({ name: typeof body.name === "string" ? body.name : undefined, email: email || undefined });
    // The key page posts to /oauth/authorize, which then redirects to the app.
    c.header(FORM_ACTION_HEADER, new URL(checked.redirect).origin);
    c.header("Cache-Control", "no-store");
    return c.html(accountKeyPage({ host: relay.host, clientName: checked.client.name, key: account.key, params: checked.params }));
  });

  // Token endpoint: exchange a code (with its PKCE verifier) or a refresh token for tokens.
  r.post("/oauth/token", bodyLimit({ maxSize: 16 * 1024, onError: (c) => tokenError(c, 400, "invalid_request", "Request too large.") }), async (c) => {
    if (!config.ownerKey) return c.json({ error: "temporarily_unavailable" }, 503);
    const body = await readBody(c);
    const client = await authenticateClient(c, relay, body);
    if (!client) return tokenError(c, 401, "invalid_client", "Unknown app, or wrong client secret.");

    const issue = async (account: string) => {
      const kf = await currentFingerprint(relay, config.ownerKey, account);
      if (!kf) return tokenError(c, 400, "invalid_grant", "This account no longer exists. Sign in again.");
      const access = randomToken("rly_at_");
      const refresh = randomToken("rly_rt_");
      const data = JSON.stringify({ acc: account, kf, res: resourceUrl(base) });
      await relay.oauthStore.insertGrant(sha256(access), "access", client.id, data, now() + ACCESS_TTL, now());
      await relay.oauthStore.insertGrant(sha256(refresh), "refresh", client.id, data, now() + REFRESH_TTL, now());
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      return c.json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: SCOPE });
    };

    if (body.grant_type === "authorization_code") {
      const { code, code_verifier, redirect_uri, resource } = body;
      if (!code || !code_verifier) return tokenError(c, 400, "invalid_request", "code and code_verifier are required.");
      const grant = await relay.oauthStore.takeGrant(sha256(code), "code");
      if (!grant || grant.client_id !== client.id || Number(grant.expires_at) <= now()) {
        return tokenError(c, 400, "invalid_grant", "The code is invalid, expired or already used.");
      }
      const d = JSON.parse(grant.data) as { ru: string; cc: string; res: string; acc?: string };
      if (redirect_uri !== d.ru) return tokenError(c, 400, "invalid_grant", "redirect_uri doesn't match the authorization request.");
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(code_verifier) || crypto.createHash("sha256").update(code_verifier).digest("base64url") !== d.cc) {
        return tokenError(c, 400, "invalid_grant", "The PKCE code_verifier doesn't match.");
      }
      if (resource && resource !== d.res && resource !== base) return tokenError(c, 400, "invalid_target", "Tokens are only issued for this server's /mcp endpoint.");
      return issue(d.acc ?? OPERATOR);
    }

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) return tokenError(c, 400, "invalid_request", "refresh_token is required.");
      // Refresh tokens rotate: the old one is consumed whether or not the new pair is issued.
      const grant = await relay.oauthStore.takeGrant(sha256(body.refresh_token), "refresh");
      const d = grant ? (JSON.parse(grant.data) as { acc?: string; kf?: string }) : undefined;
      const account = d?.acc ?? OPERATOR;
      if (
        !grant ||
        grant.client_id !== client.id ||
        Number(grant.expires_at) <= now() ||
        d?.kf !== (await currentFingerprint(relay, config.ownerKey, account))
      ) {
        return tokenError(c, 400, "invalid_grant", "The refresh token is invalid, expired or revoked. Sign in again.");
      }
      return issue(account);
    }

    return tokenError(c, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  });

  // Token revocation (RFC 7009): always 200, whether or not the token existed.
  r.post("/oauth/revoke", async (c) => {
    const body = await readBody(c);
    if (body.token) await relay.oauthStore.revokeGrant(sha256(body.token));
    return c.body(null, 200);
  });

  return r;
}

/** Token and revoke requests are form-encoded by the spec; accept JSON too. */
async function readBody(c: Context): Promise<Record<string, string | undefined>> {
  const type = c.req.header("content-type") ?? "";
  try {
    const raw = type.includes("application/json") ? ((await c.req.json()) as Record<string, unknown>) : await c.req.parseBody();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]));
  } catch {
    return {};
  }
}

/** Public clients send client_id only (PKCE protects them); confidential ones prove their secret. */
async function authenticateClient(c: Context, relay: Relay, body: Record<string, string | undefined>) {
  let id = body.client_id;
  let secret = body.client_secret;
  const basic = /^Basic\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  if (basic) {
    const [u, p] = Buffer.from(basic, "base64").toString("utf8").split(":");
    id = u ? decodeURIComponent(u) : id;
    secret = p !== undefined ? decodeURIComponent(p) : secret;
  }
  if (!id) return null;
  const client = await relay.oauthStore.getClient(id);
  if (!client) return null;
  if (client.secret_hash) {
    if (!secret) return null;
    const a = Buffer.from(sha256(secret), "hex");
    const b = Buffer.from(client.secret_hash, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  }
  return client;
}

/** CORS for discovery and app-called endpoints: no cookies are involved, so any origin may call. */
const cors: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    });
  }
  await next();
  c.header("Access-Control-Allow-Origin", "*");
};
