import { assertEquals } from "@std/assert";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import type { AgentContext } from "../agents/types.ts";
import { MODEL_IDS } from "../agents/modelSelector.ts";
import { PromptEngineerService } from "./promptEngineerService.ts";

function ctx(): AgentContext {
  return {
    userId: "u1",
    systemPrompt: "s",
    userContexts: [{ key: "industry", value: "SaaS" }],
    userProfile: { id: "u1", name: "A", email: "a@b", role: "founder" },
    learnings: [],
    connectedTools: ["notion", "web_search"],
    recentHistory: [],
  };
}

class QueuedLlm implements LlmClient {
  lastRequests: LlmRequest[] = [];
  constructor(private readonly queue: LlmResponse[]) {}
  private i = 0;
  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.lastRequests.push(req);
    return this.queue[this.i++] ?? {
      content: "",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "end_turn",
    };
  }
}

Deno.test("PromptEngineerService — buildSearchQueries: 3 Strings", async () => {
  const llm = new QueuedLlm([
    {
      content: '["a","b","c"]',
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    },
  ]);
  const svc = new PromptEngineerService(llm);
  const q = await svc.buildSearchQueries({
    rawRequest: "Förderungen 2026",
    userContext: ctx(),
    numQueries: 3,
  });
  assertEquals(q, ["a", "b", "c"]);
  assertEquals(llm.lastRequests[0]?.model, MODEL_IDS.haiku);
});

Deno.test("PromptEngineerService — classifyComplexity businessplan → high", () => {
  const svc = new PromptEngineerService(
    { async chat(): Promise<LlmResponse> {
      throw new Error("no");
    } } as LlmClient,
  );
  assertEquals(
    svc.classifyComplexity("Bitte analysiere den Businessplan"),
    "high",
  );
});

Deno.test("PromptEngineerService — classifyComplexity kurze Liste-Frage → low", () => {
  const svc = new PromptEngineerService(
    { async chat(): Promise<LlmResponse> {
      throw new Error("no");
    } } as LlmClient,
  );
  assertEquals(svc.classifyComplexity("zeig meine tasks"), "low");
});

Deno.test("PromptEngineerService — classifyComplexity Grüße → low", () => {
  const svc = new PromptEngineerService(
    { async chat(): Promise<LlmResponse> {
      throw new Error("no");
    } } as LlmClient,
  );
  assertEquals(svc.classifyComplexity("Hi"), "low");
  assertEquals(svc.classifyComplexity("Danke!"), "low");
});

Deno.test("PromptEngineerService — isTrivialSmalltalkMessage streng", () => {
  const svc = new PromptEngineerService(
    { async chat(): Promise<LlmResponse> {
      throw new Error("no");
    } } as LlmClient,
  );
  assertEquals(svc.isTrivialSmalltalkMessage("Hi"), true);
  assertEquals(svc.isTrivialSmalltalkMessage("Was läuft?"), false);
});

Deno.test("PromptEngineerService — optimizeResearchPrompt → recommended_model sonnet", async () => {
  const llm = new QueuedLlm([
    {
      content: '["q1","q2","q3"]',
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    },
  ]);
  const svc = new PromptEngineerService(llm);
  const o = await svc.optimizeResearchPrompt({
    rawRequest: "Marktübersicht",
    userContext: ctx(),
    taskType: "research",
  });
  assertEquals(o.recommended_model, "sonnet");
  assertEquals(o.search_queries.length, 3);
});

Deno.test("PromptEngineerService — ungültiges JSON bei buildSearchQueries → []", async () => {
  const llm = new QueuedLlm([
    {
      content: "not json at all {{{",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    },
  ]);
  const svc = new PromptEngineerService(llm);
  const q = await svc.buildSearchQueries({
    rawRequest: "x",
    userContext: ctx(),
  });
  assertEquals(q, []);
});
