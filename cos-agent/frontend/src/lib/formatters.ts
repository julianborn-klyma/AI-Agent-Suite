/** USD für Dashboard-Karten und Tabellen. */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.00";
  if (usd === 0) return "$0.00";
  const abs = Math.abs(usd);
  if (abs > 0 && abs < 0.01) return "< $0.01";
  if (abs < 1) {
    const s = usd < 0 ? "-" : "";
    return `${s}$${abs.toFixed(2)}`;
  }
  if (abs < 1000) {
    const s = usd < 0 ? "-" : "";
    return `${s}$${abs.toFixed(2)}`;
  }
  const s = usd < 0 ? "-" : "";
  const parts = abs.toFixed(2).split(".");
  const intPart = parts[0]!;
  const dec = parts[1]!;
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${s}$${withCommas}.${dec}`;
}

/** Token-Zahlen kompakt (k / M). */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) return "0";
  const abs = Math.abs(count);
  const sign = count < 0 ? "-" : "";
  if (abs < 1000) return `${sign}${Math.round(abs)}`;
  if (abs < 1_000_000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
}

/**
 * Anzeige-Name für LLM-Modell-IDs.
 * Unbekannte IDs: Segment nach dem letzten "-".
 */
export function formatModelName(modelId: string): string {
  try {
    const raw = typeof modelId === "string" ? modelId.trim() : "";
    if (!raw) return "—";
    const m = raw.toLowerCase();
    if (m.includes("haiku")) return "Haiku";
    if (m.includes("sonnet")) {
      if (m.includes("20250514") || m.includes("sonnet-4-")) return "Sonnet 4.5";
      return "Sonnet";
    }
    if (m.includes("opus")) {
      if (m.includes("20250514") || m.includes("opus-4-")) return "Opus 4";
      return "Opus";
    }
    const i = raw.lastIndexOf("-");
    return i >= 0 ? raw.slice(i + 1) : raw;
  } catch {
    return "—";
  }
}

export function getModelColor(modelId: string): string {
  const m = (modelId ?? "").toLowerCase();
  if (m.includes("haiku")) return "#22c55e";
  if (m.includes("sonnet")) return "#3b82f6";
  if (m.includes("opus")) return "#f97316";
  return "#6b7280";
}
