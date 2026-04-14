import type { LlmToolDefinition } from "../tools/types.ts";
import type {
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
} from "./llmTypes.ts";
import { LlmClientError } from "./llmTypes.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TIMEOUT_MS = 60_000;
/** Anthropic 529 = overload; 503/502 = gateway; 429 = rate limit — kurz warten und erneut versuchen. */
const RETRYABLE_HTTP = new Set([529, 503, 502, 429]);
const MAX_ANTHROPIC_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 32_000;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
  }
  | {
    type: "tool_result";
    tool_use_id: string;
    content: string;
  };

type AnthropicApiMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponentielles Backoff mit kleinem Jitter (vermeidet Thundering Herd). */
function backoffMsAfterFailure(attemptIndex: number): number {
  const exp = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** Math.min(attemptIndex, 5),
  );
  const jitter = Math.floor(Math.random() * 400);
  return exp + jitter;
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    try {
      const p = JSON.parse(input) as unknown;
      if (p !== null && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      /* leer */
    }
  }
  return {};
}

function toAnthropicTools(
  tools: LlmToolDefinition[],
): Record<string, unknown>[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/**
 * Baut Anthropic-`messages` aus unserem Verlauf.
 * `role: "tool"` → User-Turn mit `tool_result`.
 * Assistant mit `tool_calls` + folgende N User-Strings (AgentService) →
 * ein User-Turn mit N `tool_result`-Blöcken (Reihenfolge wie `tool_calls`).
 */
function toAnthropicMessages(
  messages: LlmMessage[],
): AnthropicApiMessage[] {
  const out: AnthropicApiMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i]!;

    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: m.content,
          },
        ],
      });
      i++;
      continue;
    }

    if (m.role === "assistant" && m.tool_calls?.length) {
      const blocks: AnthropicContentBlock[] = [];
      const text = m.content.trim();
      if (text.length > 0) {
        blocks.push({ type: "text", text: m.content });
      }
      for (const tc of m.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: normalizeToolInput(tc.input),
        });
      }
      out.push({ role: "assistant", content: blocks });
      i++;

      const n = m.tool_calls.length;
      const toolResults: AnthropicContentBlock[] = [];
      for (let j = 0; j < n; j++) {
        const next = messages[i];
        if (
          !next || next.role !== "user" || typeof next.content !== "string"
        ) {
          break;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: m.tool_calls[j]!.id,
          content: next.content,
        });
        i++;
      }
      if (toolResults.length > 0) {
        out.push({ role: "user", content: toolResults });
      }
      continue;
    }

    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
      i++;
      continue;
    }

    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      i++;
      continue;
    }

    i++;
  }

  return out;
}

function parseAnthropicResponse(json: unknown): LlmResponse {
  if (json === null || typeof json !== "object") {
    throw new LlmClientError(0, "Anthropic-Antwort: kein JSON-Objekt");
  }
  const o = json as Record<string, unknown>;
  const usage = o.usage as Record<string, unknown> | undefined;
  const input_tokens = Number(usage?.input_tokens ?? 0);
  const output_tokens = Number(usage?.output_tokens ?? 0);
  const stop_reason = typeof o.stop_reason === "string"
    ? o.stop_reason
    : "unknown";

  const rawContent = o.content;
  if (!Array.isArray(rawContent)) {
    throw new LlmClientError(0, "Anthropic-Antwort: content fehlt oder ungültig");
  }

  const textParts: string[] = [];
  const tool_calls: LlmToolCall[] = [];

  for (const block of rawContent) {
    if (block === null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
    } else if (b.type === "tool_use") {
      const id = typeof b.id === "string" ? b.id : "";
      const name = typeof b.name === "string" ? b.name : "";
      tool_calls.push({
        id,
        name,
        input: b.input ?? {},
      });
    }
  }

  const content = textParts.join("");

  return {
    content,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
    input_tokens: Number.isFinite(input_tokens) ? input_tokens : 0,
    output_tokens: Number.isFinite(output_tokens) ? output_tokens : 0,
    stop_reason,
  };
}

export class AnthropicClient implements LlmClient {
  constructor(private readonly apiKey: string) {}

  async chat(req: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: 4096,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
    };

    if (req.tools?.length) {
      body.tools = toAnthropicTools(req.tools);
      body.tool_choice = { type: "auto" };
    }

    const fetchOnce = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        return await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let res = await fetchOnce();
    let retryIdx = 0;
    while (!res.ok && RETRYABLE_HTTP.has(res.status) && retryIdx < MAX_ANTHROPIC_ATTEMPTS - 1) {
      const wait = backoffMsAfterFailure(retryIdx);
      await sleep(wait);
      retryIdx++;
      res = await fetchOnce();
    }

    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 529
        ? " (Anthropic meldet Überlast — bitte in ein paar Sekunden erneut versuchen.)"
        : res.status === 429
        ? " (Rate-Limit — kurz warten und erneut versuchen.)"
        : "";
      throw new LlmClientError(
        res.status,
        `Anthropic /v1/messages fehlgeschlagen: HTTP ${res.status}${hint}`,
        text.slice(0, 500),
      );
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new LlmClientError(
        res.status,
        "Anthropic-Antwort: JSON konnte nicht geparst werden",
        text.slice(0, 500),
      );
    }

    return parseAnthropicResponse(json);
  }
}
