import type { CSSProperties } from "react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router-dom";
import {
  useWorkspaceWikiBacklinks,
  useWorkspaceWikiOutgoingLinks,
  useWorkspaceWikiPageBySlug,
} from "../../hooks/useWorkspaceWiki.ts";
import { isLoggedIn } from "../../lib/auth.ts";
import { wikiBodyMarkdownWithWikiLinks } from "../../lib/wikiLinkMarkdown.ts";

const articleStyle: CSSProperties = {
  padding: "1.25rem",
  maxWidth: 800,
  margin: "0 auto",
};

const panelStyle: CSSProperties = {
  marginTop: "1.25rem",
  padding: "0.85rem 1rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  fontSize: "0.9rem",
};

export function WorkspaceWikiReadPage() {
  const { slug: slugParam = "" } = useParams<{ slug: string }>();
  const slug = useMemo(() => {
    try {
      return decodeURIComponent(slugParam);
    } catch {
      return slugParam;
    }
  }, [slugParam]);

  const logged = isLoggedIn();
  const pageQ = useWorkspaceWikiPageBySlug(logged, slug);
  const pageId = pageQ.data?.id ?? "";
  const outQ = useWorkspaceWikiOutgoingLinks(logged && pageQ.isSuccess, pageId);
  const backQ = useWorkspaceWikiBacklinks(logged && pageQ.isSuccess, pageId);

  const mdWithLinks = useMemo(() => {
    if (!pageQ.data || !outQ.data) return "";
    return wikiBodyMarkdownWithWikiLinks(pageQ.data.body_md, outQ.data);
  }, [pageQ.data, outQ.data]);

  if (!slugParam) {
    return <p>Kein Slug.</p>;
  }

  if (pageQ.isPending || (pageQ.isSuccess && outQ.isPending)) {
    return (
      <div data-testid="wiki-read-root" style={articleStyle}>
        <p style={{ color: "var(--muted)" }}>Laden…</p>
      </div>
    );
  }

  if (pageQ.isError) {
    return (
      <div data-testid="wiki-read-root" style={articleStyle}>
        <p style={{ color: "crimson" }}>{pageQ.error?.message ?? "Seite nicht gefunden."}</p>
        <Link to="/workspace/wiki" style={{ color: "var(--link)" }}>
          ← Wiki-Übersicht
        </Link>
      </div>
    );
  }

  const page = pageQ.data;
  if (!page) {
    return (
      <div data-testid="wiki-read-root" style={articleStyle}>
        <p>Seite nicht gefunden.</p>
        <Link to="/workspace/wiki" style={{ color: "var(--link)" }}>
          ← Wiki-Übersicht
        </Link>
      </div>
    );
  }

  return (
    <article data-testid="wiki-read-root" style={articleStyle}>
      <div style={{ marginBottom: "1rem" }}>
        <Link to="/workspace/wiki" data-testid="wiki-read-back-overview" style={{ color: "var(--link)", fontSize: "0.9rem" }}>
          ← Wiki-Übersicht
        </Link>
      </div>
      <h1 className="co-font-display" data-testid="wiki-read-title" style={{ fontSize: "1.4rem", marginBottom: "0.35rem" }}>
        {page.title}
      </h1>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        <code>{page.slug}</code>
        {" · "}
        {page.status}
        {" · v"}
        {page.version}
      </p>

      <div
        data-testid="wiki-read-body"
        className="chat-md wiki-md-preview"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "1rem",
          background: "var(--bg)",
          lineHeight: 1.5,
        }}
      >
        <ReactMarkdown
          components={{
            a: ({ href, children }) =>
              href?.startsWith("/")
                ? <Link to={href}>{children}</Link>
                : <a href={href}>{children}</a>,
          }}
        >
          {mdWithLinks || "_(Leer)_"}
        </ReactMarkdown>
      </div>

      <section data-testid="wiki-read-outgoing" style={panelStyle}>
        <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Ausgehende Verweise</h2>
        {outQ.data?.length === 0 && (
          <p style={{ color: "var(--muted)", margin: 0 }}>Keine [[…]]-Verweise.</p>
        )}
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {(outQ.data ?? []).map((l) => (
            <li key={l.to_slug}>
              {l.resolved && l.to_page_id
                ? (
                  <Link to={`/workspace/wiki/${encodeURIComponent(l.to_slug)}`}>
                    {l.to_slug}
                  </Link>
                )
                : <code>{l.to_slug}</code>}
              {l.resolved ? ` — ${l.target_title ?? ""}` : " — _(Seite fehlt)_"}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="wiki-read-backlinks" style={panelStyle}>
        <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Backlinks</h2>
        {backQ.isPending && <p style={{ color: "var(--muted)", margin: 0 }}>Laden…</p>}
        {!backQ.isPending && (backQ.data?.length === 0) && (
          <p style={{ color: "var(--muted)", margin: 0 }}>Keine anderen Seiten verlinken hierher.</p>
        )}
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {(backQ.data ?? []).map((b) => (
            <li key={b.from_page_id} data-testid={`wiki-read-backlink-${b.from_slug}`}>
              <Link to={`/workspace/wiki/${encodeURIComponent(b.from_slug)}`}>
                {b.from_title}
              </Link>{" "}
              (<code>{b.from_slug}</code>)
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
