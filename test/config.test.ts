import { describe, expect, it } from "vitest";
import { assertDurableDb, loadConfig } from "../src/config.js";

describe("config", () => {
  it("defaults to a local SQLite file", () => {
    const c = loadConfig({});
    expect(c.dbUrl).toBe("file:./data/relay.db");
    expect(c.baseUrl).toBe("http://localhost:8787");
    expect(c.trustProxy).toBe(false);
  });

  it("keeps the old RELAY_DB_PATH working", () => {
    expect(loadConfig({ RELAY_DB_PATH: "/data/relay.db" }).dbUrl).toBe("file:/data/relay.db");
  });

  it("reads Turso's integration variables, with RELAY_* taking precedence", () => {
    const c = loadConfig({ TURSO_DATABASE_URL: "libsql://a.turso.io", TURSO_AUTH_TOKEN: "t1" });
    expect(c.dbUrl).toBe("libsql://a.turso.io");
    expect(c.dbAuthToken).toBe("t1");
    expect(loadConfig({ TURSO_DATABASE_URL: "libsql://a", RELAY_DB_URL: "libsql://b" }).dbUrl).toBe("libsql://b");
  });

  it("on Vercel, uses the production domain and trusts the proxy", () => {
    const c = loadConfig({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "relay-forms.vercel.app" });
    expect(c.baseUrl).toBe("https://relay-forms.vercel.app");
    expect(c.trustProxy).toBe(true);
    expect(loadConfig({ VERCEL: "1", RELAY_BASE_URL: "https://forms.example.com/" }).baseUrl).toBe("https://forms.example.com");
  });

  it("refuses a file database on Vercel, where it would be lost", () => {
    expect(() => assertDurableDb(loadConfig({ VERCEL: "1" }))).toThrow(/Turso/);
    expect(() => assertDurableDb(loadConfig({ VERCEL: "1", TURSO_DATABASE_URL: "libsql://a.turso.io" }))).not.toThrow();
    expect(() => assertDurableDb(loadConfig({}))).not.toThrow();
  });
});
