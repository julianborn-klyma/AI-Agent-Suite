import { assertEquals } from "@std/assert";
import { parseAnthropicResponse } from "./anthropicClient.ts";

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
