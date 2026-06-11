import { assertEquals } from "@std/assert";
import {
  AnthropicClient,
  parseAnthropicResponse,
  parseRetryAfterMs,
} from "./anthropicClient.ts";
import { resetLlmRequestGateForTests } from "./llmRequestGate.ts";

Deno.test("parseAnthropicResponse — server_tool_use und web_search ignorieren, Text mergen", () => {
  const r = parseAnthropicResponse({
    usage: { input_tokens: 10, output_tokens: 20 },
    stop_reason: "end_turn",
    content: [
      { type: "text", text: "Hallo " },
      { type: "server_tool_use", id: "x", name: "web_search" },
      { type: "web_search_tool_result", tool_use_id: "x", content: [] },
      { type: "text", text: "Welt." },
    ],
  });
  assertEquals(r.content, "Hallo Welt.");
  assertEquals(r.input_tokens, 10);
  assertEquals(r.output_tokens, 20);
});

Deno.test("parseRetryAfterMs — Sekunden und Datum", () => {
  const sec = parseRetryAfterMs(
    new Response(null, { status: 429, headers: { "Retry-After": "12" } }),
  );
  assertEquals(sec, 12_000);

  const future = new Date(Date.now() + 5_000).toUTCString();
  const dateMs = parseRetryAfterMs(
    new Response(null, { status: 429, headers: { "Retry-After": future } }),
  );
  assertEquals(dateMs !== null && dateMs >= 500 && dateMs <= 120_000, true);
});

Deno.test("AnthropicClient — 429 wird mit Retry-After automatisch wiederholt", async () => {
  resetLlmRequestGateForTests();
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = () => {
    calls++;
    if (calls < 2) {
      return Promise.resolve(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Antwort OK" }],
          usage: { input_tokens: 1, output_tokens: 2 },
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };
  try {
    const client = new AnthropicClient("test-key");
    const r = await client.chat({
      model: "claude-sonnet-4-20250514",
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      metadata: { user_id: "u", source: "test" },
    });
    assertEquals(r.content, "Antwort OK");
    assertEquals(calls, 2);
  } finally {
    globalThis.fetch = orig;
    resetLlmRequestGateForTests();
  }
});
