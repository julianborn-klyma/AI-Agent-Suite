import { assertEquals } from "@std/assert";
import { createRateLimiter } from "./rateLimiter.ts";

Deno.test("createRateLimiter — unter Limit durch", () => {
  const lim = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 5,
    keyFn: () => "k1",
  });
  assertEquals(lim(new Request("http://x/a")), null);
  assertEquals(lim(new Request("http://x/b")), null);
});

Deno.test("createRateLimiter — über Limit → 429", () => {
  const lim = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    keyFn: () => "k2",
  });
  assertEquals(lim(new Request("http://x/")), null);
  assertEquals(lim(new Request("http://x/")), null);
  const r = lim(new Request("http://x/"));
  assertEquals(r?.status, 429);
});

Deno.test("createRateLimiter — nach Ablauf wieder ok", async () => {
  const lim = createRateLimiter({
    windowMs: 30,
    maxRequests: 1,
    keyFn: () => "k3",
  });
  assertEquals(lim(new Request("http://x/")), null);
  assertEquals(lim(new Request("http://x/"))?.status, 429);
  await new Promise((r) => setTimeout(r, 45));
  assertEquals(lim(new Request("http://x/")), null);
});
