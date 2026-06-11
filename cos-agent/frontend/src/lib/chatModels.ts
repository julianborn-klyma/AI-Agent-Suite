export const CHAT_MODEL_STORAGE_KEY = "cos_preferred_model";

export type ChatModelKey = "haiku" | "sonnet" | "opus";

export type ChatModelOption = {
  key: ChatModelKey;
  label: string;
  model_id: string;
};

export type ChatModelsResponse = {
  default: ChatModelKey;
  models: ChatModelOption[];
};

export function readStoredModel(): ChatModelKey | null {
  const raw = localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
  if (raw === "haiku" || raw === "sonnet" || raw === "opus") return raw;
  return null;
}

export function storeModel(key: ChatModelKey): void {
  localStorage.setItem(CHAT_MODEL_STORAGE_KEY, key);
}

export function resolvePreferredModel(
  catalog: ChatModelsResponse | undefined,
): ChatModelKey {
  const stored = readStoredModel();
  if (stored && catalog?.models.some((m) => m.key === stored)) return stored;
  return catalog?.default ?? "sonnet";
}
