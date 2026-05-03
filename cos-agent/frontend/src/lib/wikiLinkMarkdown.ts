/** Ersetzt `[[slug]]` durch Markdown-Links (intern) oder Kennzeichnung fehlender Seiten. */
export function wikiBodyMarkdownWithWikiLinks(
  bodyMd: string,
  outgoing: { to_slug: string; to_page_id: string | null }[],
): string {
  const resolved = new Set(
    outgoing
      .filter((o) => o.to_page_id !== null)
      .map((o) => o.to_slug.toLowerCase()),
  );
  return bodyMd.replace(
    /\[\[([a-z0-9][a-z0-9-]{0,199})\]\]/gi,
    (_full, raw: string) => {
      const s = raw.toLowerCase();
      if (resolved.has(s)) {
        return `[${raw}](/workspace/wiki/${encodeURIComponent(s)})`;
      }
      return `\`${raw}\` *(Seite fehlt)*`;
    },
  );
}
