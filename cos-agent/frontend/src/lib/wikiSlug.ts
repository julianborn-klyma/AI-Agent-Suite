/**
 * Gleiche Regeln wie `normalizeWikiSlug` im Backend (`workspaceWikiService.ts`).
 */
export function normalizeWikiSlug(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
  if (s.length < 1 || s.length > 200) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return null;
  return s;
}

/** Kurzer Hinweis, wenn der Slug (noch) nicht dem Backend-Format entspricht. */
export function wikiSlugHint(raw: string): string | null {
  if (!raw.trim()) return null;
  if (normalizeWikiSlug(raw) !== null) return null;
  return "Ungültig: nur Kleinbuchstaben a–z, Ziffern und einzelne Bindestriche (z. B. meine-seite-2), max. 200 Zeichen.";
}
