import { jsonResponse } from "../routes/json.ts";
import { extractIpFromRequest } from "./requestIp.ts";

export type RateLimitMiddleware = (req: Request) => Response | null;

type Bucket = { count: number; resetAt: number };

let lastCleanup = 0;
const CLEANUP_MS = 5 * 60 * 1000;

function cleanupStore(store: Map<string, Bucket>, now: number): void {
  if (now - lastCleanup < CLEANUP_MS) return;
  lastCleanup = now;
  for (const [k, v] of store) {
    if (v.resetAt <= now) store.delete(k);
  }
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyFn: (req: Request) => string;
}): RateLimitMiddleware {
  const store = new Map<string, Bucket>();
  return (req: Request): Response | null => {
    const now = Date.now();
    cleanupStore(store, now);
    const key = options.keyFn(req);
    let b = store.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + options.windowMs };
      store.set(key, b);
    }
    b.count += 1;
    if (b.count > options.maxRequests) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((b.resetAt - now) / 1000),
      );
      return jsonResponse(
        {
          error: "Zu viele Anfragen. Bitte später erneut versuchen.",
          retry_after: retryAfterSec,
        },
        { status: 429 },
      );
    }
    return null;
  };
}

export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyFn: (req) => extractIpFromRequest(req),
});

export const superAdminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyFn: (req) => extractIpFromRequest(req),
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 100,
  keyFn: (req) => extractIpFromRequest(req),
});
