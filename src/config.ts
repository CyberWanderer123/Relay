export interface Config {
  port: number;
  /** Public origin used in every link Relay hands out, without a trailing slash. */
  baseUrl: string;
  /** The single creator key. Unset means the creator API and /mcp are disabled. */
  ownerKey?: string;
  /** libSQL URL: libsql://… (Turso), file:./data/relay.db (local) or :memory: (tests). */
  dbUrl: string;
  /** Turso auth token. Not needed for file: or :memory:. */
  dbAuthToken?: string;
  /** Read the client IP from X-Forwarded-For (only behind a proxy you trust, e.g. Vercel). */
  trustProxy: boolean;
  log: boolean;
  submitPerMinute: number;
  /** Running on Vercel (set by the platform). */
  onVercel: boolean;
}

/** Load KEY=value pairs from ./.env if present. Real environment variables win. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file — fine */
  }
}

const flag = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === "" ? fallback : v === "1" || v.toLowerCase() === "true";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  const onVercel = Boolean(env.VERCEL);

  // On Vercel, fall back to the project's production domain if RELAY_BASE_URL is not set.
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  const baseUrl = (
    env.RELAY_BASE_URL || (onVercel && vercelHost ? `https://${vercelHost}` : `http://localhost:${port}`)
  ).replace(/\/+$/, "");

  // TURSO_* are the names Turso's Vercel integration sets; RELAY_* take precedence.
  const dbUrl =
    env.RELAY_DB_URL || env.TURSO_DATABASE_URL || (env.RELAY_DB_PATH ? `file:${env.RELAY_DB_PATH}` : "file:./data/relay.db");

  return {
    port,
    baseUrl,
    ownerKey: env.RELAY_OWNER_KEY?.trim() || undefined,
    dbUrl,
    dbAuthToken: env.RELAY_DB_AUTH_TOKEN || env.TURSO_AUTH_TOKEN || undefined,
    trustProxy: flag(env.RELAY_TRUST_PROXY, onVercel),
    log: env.RELAY_LOG !== "0",
    submitPerMinute: Number(env.RELAY_SUBMIT_PER_MINUTE ?? 10),
    onVercel,
  };
}

/** Vercel has no lasting disk, so a file: database there would silently lose data. */
export function assertDurableDb(config: Config): void {
  if (config.onVercel && !config.dbUrl.startsWith("libsql:") && !config.dbUrl.startsWith("https:")) {
    throw new Error(
      "Relay on Vercel needs a Turso database. Set TURSO_DATABASE_URL (libsql://…) and TURSO_AUTH_TOKEN in the project's environment variables.",
    );
  }
}
