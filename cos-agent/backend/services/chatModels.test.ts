import { assertEquals } from "@std/assert";
import {
  isChatModelKey,
  listChatModelsPayload,
  parseChatModelKey,
  resolveChatModelId,
} from "./chatModels.ts";

Deno.test("chatModels — default sonnet", () => {
  const payload = listChatModelsPayload();
  assertEquals(payload.default, "sonnet");
  assertEquals(payload.models.length, 3);
});

Deno.test("chatModels — parse invalid model", () => {
  const r = parseChatModelKey("gemini");
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error.includes("nicht verfügbar"), true);
  }
});

Deno.test("chatModels — resolve ids", () => {
  assertEquals(isChatModelKey("sonnet"), true);
  assertEquals(resolveChatModelId("haiku").includes("haiku"), true);
  assertEquals(resolveChatModelId(null).includes("sonnet"), true);
});
