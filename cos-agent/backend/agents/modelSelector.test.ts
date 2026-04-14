import { assertEquals } from "@std/assert";
import {
  estimateCost,
  MODEL_IDS,
  selectModel,
} from "./modelSelector.ts";

Deno.test("selectModel — CFO Agent → Opus", () => {
  assertEquals(
    selectModel({
      taskType: "chat",
      complexity: "medium",
      requiresWebSearch: false,
      isRetry: false,
      agentType: "cfo",
    }),
    MODEL_IDS.opus,
  );
});

Deno.test("selectModel — Learning Agent → Haiku", () => {
  assertEquals(
    selectModel({
      taskType: "chat",
      complexity: "medium",
      requiresWebSearch: false,
      isRetry: false,
      agentType: "learning",
    }),
    MODEL_IDS.haiku,
  );
});

Deno.test("selectModel — Intent Analysis → Haiku", () => {
  assertEquals(
    selectModel({
      taskType: "intent_analysis",
      complexity: "high",
      requiresWebSearch: false,
      isRetry: false,
      agentType: "orchestrator",
    }),
    MODEL_IDS.haiku,
  );
});

Deno.test("selectModel — Retry → Opus unabhängig vom Agent", () => {
  assertEquals(
    selectModel({
      taskType: "intent_analysis",
      complexity: "low",
      requiresWebSearch: false,
      isRetry: true,
      agentType: "learning",
    }),
    MODEL_IDS.opus,
  );
});

Deno.test("selectModel — Standard-Chat (Sonstiges) → Sonnet", () => {
  assertEquals(
    selectModel({
      taskType: "chat",
      complexity: "medium",
      requiresWebSearch: false,
      isRetry: false,
      agentType: "gmail",
    }),
    MODEL_IDS.sonnet,
  );
});

Deno.test("estimateCost — alle drei Modelle plausibel", () => {
  const h = estimateCost(MODEL_IDS.haiku, 1_000_000, 0);
  assertEquals(h, 0.8);
  const s = estimateCost(MODEL_IDS.sonnet, 1_000_000, 1_000_000);
  assertEquals(s, 3.0 + 15.0);
  const o = estimateCost(MODEL_IDS.opus, 0, 1_000_000);
  assertEquals(o, 75.0);
});

Deno.test("MODEL_IDS.haiku exakter API-String", () => {
  assertEquals(MODEL_IDS.haiku, "claude-haiku-4-5-20251001");
});
