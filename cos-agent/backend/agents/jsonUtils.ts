/**
 * Extrahiert erstes JSON-Objekt aus LLM-Text (optional ```json … ```).
 */
export function parseJsonObject<T = Record<string, unknown>>(
  raw: string,
): T | null {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im.exec(s);
  if (fence) s = fence[1]!.trim();

  const tryParse = (text: string): T | null => {
    try {
      const v = JSON.parse(text) as unknown;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        return v as T;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const direct = tryParse(s);
  if (direct) return direct;

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(s.slice(start, end + 1));
  }
  return null;
}

/** JSON-Array aus LLM-Text (optional ```json … ```). */
export function parseJsonArray(raw: string): unknown[] | null {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im.exec(s);
  if (fence) s = fence[1]!.trim();
  const tryParse = (text: string): unknown[] | null => {
    try {
      const v = JSON.parse(text) as unknown;
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return tryParse(s.slice(start, end + 1));
  }
  return null;
}
