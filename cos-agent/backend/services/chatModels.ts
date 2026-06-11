import { MODEL_IDS, type AgentModel } from "../agents/modelSelector.ts";

export const CHAT_MODEL_KEYS = ["haiku", "sonnet", "opus"] as const;
export type ChatModelKey = (typeof CHAT_MODEL_KEYS)[number];

const LABELS: Record<ChatModelKey, string> = {
  haiku: "Claude Haiku 4.5",
  sonnet: "Claude Sonnet 4",
  opus: "Claude Opus 4",
};

export function isChatModelKey(v: string): v is ChatModelKey {
  return (CHAT_MODEL_KEYS as readonly string[]).includes(v);
}

export function resolveChatModelId(key: string | undefined | null): string {
  if (key && isChatModelKey(key)) return MODEL_IDS[key];
  return MODEL_IDS.sonnet;
}

export function listChatModelsPayload(): {
  default: ChatModelKey;
  models: { key: ChatModelKey; label: string; model_id: string }[];
} {
  return {
    default: "sonnet",
    models: CHAT_MODEL_KEYS.map((key) => ({
      key,
      label: LABELS[key],
      model_id: MODEL_IDS[key as AgentModel],
    })),
  };
}

export function parseChatModelKey(
  raw: unknown,
): { ok: true; key: ChatModelKey } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, key: "sonnet" };
  }
  if (typeof raw !== "string" || !isChatModelKey(raw)) {
    return {
      ok: false,
      error:
        `Modell „${String(raw)}“ ist nicht verfügbar. Bitte Haiku, Sonnet oder Opus wählen.`,
    };
  }
  return { ok: true, key: raw };
}
