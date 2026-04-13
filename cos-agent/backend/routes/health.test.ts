import { assertEquals } from "@std/assert";
import { startTestServer, TEST_SERVICE_TOKEN, baseTestEnv } from "../test_helpers.ts";

Deno.test("E2E GET /health — Service-Token, Black-Box HTTP", async () => {
  const { baseUrl, shutdown } = await startTestServer(baseTestEnv());
  try {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { "X-Service-Token": TEST_SERVICE_TOKEN },
    });
    assertEquals(res.status, 200);
    const json = await res.json() as { status: string };
    assertEquals(json.status, "ok");
  } finally {
    shutdown();
  }
});

Deno.test("E2E GET /health — ohne Token → 401", async () => {
  const { baseUrl, shutdown } = await startTestServer(baseTestEnv());
  try {
    const res = await fetch(`${baseUrl}/health`);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  } finally {
    shutdown();
  }
});
