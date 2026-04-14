import { assertEquals } from "@std/assert";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import { ValidatorAgent } from "./validator.ts";
import type { AgentContext, SubAgentResult } from "./types.ts";

class FakeLlmClient implements LlmClient {
  constructor(private readonly response: LlmResponse) {}
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return this.response;
  }
}

function baseContext(): AgentContext {
  return {
    userId: "u1",
    systemPrompt: "sys",
    userContexts: [{ key: "communication_style", value: "duzt dich" }],
    userProfile: { id: "u1", name: "Julian", email: "j@x", role: "member" },
    learnings: [],
    connectedTools: ["notion", "gmail"],
    recentHistory: [],
  };
}

Deno.test("Validator — korrekte Antwort → approved true, issues leer", async () => {
  const content = JSON.stringify({
    approved: true,
    issues: [],
    needsRetry: false,
  });
  const v = new ValidatorAgent(
    new FakeLlmClient({
      content,
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }),
  );
  const r = await v.validate({
    originalMessage: "Hallo",
    proposedResponse: "Hallo zurück.",
    results: [],
    context: baseContext(),
  });
  assertEquals(r.approved, true);
  assertEquals(r.issues.length, 0);
  assertEquals(r.needsRetry, false);
});

Deno.test("Validator — Halluzination → approved false, type hallucination", async () => {
  const content = JSON.stringify({
    approved: false,
    issues: [
      {
        type: "hallucination",
        severity: "high",
        detail: "Task X wurde nicht in den Ergebnissen genannt.",
      },
    ],
    needsRetry: true,
    retryFeedback: "Nur verifizierte Tasks nennen.",
  });
  const v = new ValidatorAgent(
    new FakeLlmClient({
      content,
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }),
  );
  const r = await v.validate({
    originalMessage: "Welche Tasks?",
    proposedResponse: "Du hast Task „Phantom“ offen.",
    results: [
      { agentType: "notion", success: true, data: { pages: [] } },
    ] as SubAgentResult[],
    context: baseContext(),
  });
  assertEquals(r.approved, false);
  assertEquals(r.issues[0]?.type, "hallucination");
});

Deno.test("Validator — irrelevante Antwort → needsRetry true", async () => {
  const content = JSON.stringify({
    approved: false,
    issues: [
      { type: "irrelevant", severity: "high", detail: "Beantwortet nicht die Frage." },
    ],
    needsRetry: true,
    retryFeedback: "Auf die Kernfrage eingehen.",
  });
  const v = new ValidatorAgent(
    new FakeLlmClient({
      content,
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }),
  );
  const r = await v.validate({
    originalMessage: "Wie viele Mails?",
    proposedResponse: "Das Wetter wird schön.",
    results: [],
    context: baseContext(),
  });
  assertEquals(r.needsRetry, true);
});

Deno.test("Validator — falscher Ton → issue wrong_tone", async () => {
  const content = JSON.stringify({
    approved: false,
    issues: [
      {
        type: "wrong_tone",
        severity: "medium",
        detail: "Zu formell für per-du Nutzer.",
      },
    ],
    needsRetry: false,
  });
  const v = new ValidatorAgent(
    new FakeLlmClient({
      content,
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }),
  );
  const r = await v.validate({
    originalMessage: "Hi",
    proposedResponse: "Sehr geehrter Herr Dr. Schmidt, ...",
    results: [],
    context: baseContext(),
  });
  assertEquals(r.issues.some((i) => i.type === "wrong_tone"), true);
});
