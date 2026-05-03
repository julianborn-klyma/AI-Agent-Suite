import { assertEquals } from "@std/assert";
import type { AppEnv } from "../config/env.ts";
import { corsHeaders, isLocalLoopbackBrowserOrigin } from "./cors.ts";

function stubEnv(
  over: Partial<Pick<AppEnv, "corsOrigins" | "corsAllowLocalhost">> = {},
): AppEnv {
  return {
    port: 8090,
    databaseUrl: "postgres://localhost/x",
    serviceToken: "test-service-token-32-chars-minimum!!",
    jwtSecret: "test-jwt-secret-32-chars-minimum!!!!",
    corsOrigins: ["http://localhost:5173"],
    corsAllowLocalhost: false,
    anthropicApiKey: "sk-ant-test-dummy-key-20chars",
    googleClientId: "",
    googleClientSecret: "",
    googleRedirectUri: "",
    googleLoginRedirectUri: "",
    frontendUrl: "http://localhost:5174",
    emailServiceUrl: null,
    emailServiceToken: null,
    slackClientId: "",
    slackClientSecret: "",
    slackRedirectUri: "",
    ...over,
  };
}

Deno.test("isLocalLoopbackBrowserOrigin — localhost / 127.0.0.1 / ::1 mit Port", () => {
  assertEquals(isLocalLoopbackBrowserOrigin("http://localhost:4173"), true);
  assertEquals(isLocalLoopbackBrowserOrigin("http://127.0.0.1:5174"), true);
  assertEquals(isLocalLoopbackBrowserOrigin("http://[::1]:9999"), true);
  assertEquals(isLocalLoopbackBrowserOrigin("https://localhost:3000"), true);
  assertEquals(isLocalLoopbackBrowserOrigin("http://evil.example:80"), false);
  assertEquals(isLocalLoopbackBrowserOrigin("not-a-url"), false);
});

Deno.test("corsHeaders — nur CORS_ORIGINS wenn corsAllowLocalhost false", () => {
  const env = stubEnv({ corsOrigins: ["http://localhost:5173"] });
  const ok = new Request("http://x", {
    headers: { Origin: "http://localhost:5173" },
  });
  assertEquals(corsHeaders(ok, env)?.["Access-Control-Allow-Origin"], "http://localhost:5173");
  const bad = new Request("http://x", {
    headers: { Origin: "http://localhost:4173" },
  });
  assertEquals(corsHeaders(bad, env), null);
});

Deno.test("corsHeaders — localhost:4173 erlaubt wenn corsAllowLocalhost true", () => {
  const env = stubEnv({
    corsOrigins: ["http://localhost:5173"],
    corsAllowLocalhost: true,
  });
  const r = new Request("http://x", {
    headers: { Origin: "http://localhost:4173" },
  });
  assertEquals(corsHeaders(r, env)?.["Access-Control-Allow-Origin"], "http://localhost:4173");
});
