import crypto from "node:crypto";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Config } from "../config.js";
import type { Relay } from "../service.js";

export interface Deps {
  relay: Relay;
  config: Config;
}

/** Constant-time comparison of a presented secret against the owner key. */
export function keyMatches(presented: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(presented).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Fixed-window counter per key. In memory, which is right for one instance. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  take(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }
}

/** Turn query parameters or a parsed form body into raw answers, dropping internal keys. */
export function toRaw(input: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith("_")) continue;
    const list = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
    if (list.length) out[k] = list;
  }
  return out;
}

/** Set by a form route to the sites allowed to embed that response; the security middleware turns it into frame-ancestors. */
export const FRAME_ANCESTORS_HEADER = "x-relay-frame-ancestors";
