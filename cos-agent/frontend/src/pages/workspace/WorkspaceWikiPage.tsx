import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { WikiMarkdownPreview } from "../../components/WikiMarkdownPreview.tsx";
import type { WorkspaceWikiPage as WikiPageRow } from "../../hooks/useWorkspaceWiki.ts";
import {
  useCreateWorkspaceWikiPage,
  useDeleteWorkspaceWikiPage,
  usePatchWorkspaceWikiPage,
  useWorkspaceWikiPages,
} from "../../hooks/useWorkspaceWiki.ts";
import { isLoggedIn } from "../../lib/auth.ts";
import { normalizeWikiSlug, wikiSlugHint } from "../../lib/wikiSlug.ts";

const WIKI_STATUSES = ["draft", "approved", "deprecated"] as const;

export function WorkspaceWikiPage() {
  const logged = isLoggedIn();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const pagesQ = useWorkspaceWikiPages(
    logged,
    statusFilter || null,
  );
  const createPage = useCreateWorkspaceWikiPage();
  const patchPage = usePatchWorkspaceWikiPage();
  const deletePage = useDeleteWorkspaceWikiPage();

  const [createOpen, setCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newStatus, setNewStatus] = useState<string>("draft");
  const [previewCreate, setPreviewCreate] = useState(false);
  const [previewEdit, setPreviewEdit] = useState(false);

  const [editPage, setEditPage] = useState<WikiPageRow | null>(null);
  const [editSlug, setEditSlug] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editStatus, setEditStatus] = useState<string>("draft");

  function openCreate() {
    createPage.reset();
    setNewSlug("");
    setNewTitle("");
    setNewBody("");
    setNewStatus("draft");
    setPreviewCreate(false);
    setCreateOpen(true);
  }

  function openEdit(p: WikiPageRow) {
    patchPage.reset();
    deletePage.reset();
    setEditPage(p);
    setEditSlug(p.slug);
    setEditTitle(p.title);
    setEditBody(p.body_md);
    setEditStatus(p.status);
    setPreviewEdit(false);
  }

  const pages = pagesQ.data ?? [];
  const newSlugOk = normalizeWikiSlug(newSlug) !== null;
  const newSlugHint = wikiSlugHint(newSlug);
  const editSlugOk = normalizeWikiSlug(editSlug) !== null;
  const editSlugHint = wikiSlugHint(editSlug);

  return (
    <div
      data-testid="wiki-root"
      style={{ padding: "1.25rem", maxWidth: 1100, margin: "0 auto" }}
    >
      <h1 className="co-font-display" style={{ fontSize: "1.35rem", marginBottom: "0.35rem" }}>
        Wiki
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.25rem", fontSize: "0.9rem" }}>
        Seiten im Tenant (<code>app.wiki_pages</code>). Verweise im Text mit{" "}
        <code>[[slug]]</code> werden als Links synchronisiert, sobald die Zielseite existiert.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          data-testid="wiki-open-create-modal"
          onClick={openCreate}
          style={btnStyle}
        >
          Neue Seite
        </button>
        <label style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--muted)" }}>
          Status{" "}
          <select
            data-testid="wiki-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">Alle</option>
            {WIKI_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pagesQ.isError && (
        <div style={{ color: "crimson", marginBottom: "1rem" }}>
          {pagesQ.error?.message ?? "Fehler beim Laden"}
        </div>
      )}

      {pagesQ.isPending && <div style={{ color: "var(--muted)" }}>Laden…</div>}

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table
          data-testid="wiki-table"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}
        >
          <thead>
            <tr style={{ background: "var(--sidebar)", textAlign: "left" }}>
              <th style={thStyle}>Slug</th>
              <th style={thStyle}>Titel</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Version</th>
              <th style={thStyle}>Aktualisiert</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr
                key={p.id}
                data-testid={`wiki-row-${p.slug}`}
                style={{
                  borderTop: "1px solid var(--border)",
                  cursor: "pointer",
                }}
                onClick={() => openEdit(p)}
              >
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <Link
                    to={`/workspace/wiki/${encodeURIComponent(p.slug)}`}
                    data-testid={`wiki-slug-read-link-${p.slug}`}
                    style={{ color: "var(--link)", textDecoration: "none" }}
                  >
                    <code>{p.slug}</code>
                  </Link>
                </td>
                <td style={tdStyle}>{p.title}</td>
                <td style={tdStyle}>{p.status}</td>
                <td style={tdStyle}>{p.version}</td>
                <td style={tdStyle}>
                  {new Date(p.updated_at).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </td>
              </tr>
            ))}
            {!pagesQ.isPending && pages.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, color: "var(--muted)" }}>
                  Noch keine Wiki-Seiten.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <Modal
          title="Neue Wiki-Seite"
          wide
          onClose={() => {
            createPage.reset();
            setCreateOpen(false);
          }}
        >
          <label style={labelStyle}>
            Slug (a-z, 0-9, Bindestriche)
            <input
              data-testid="wiki-new-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              style={{
                ...inputStyle,
                borderColor: newSlug.trim() && !newSlugOk ? "crimson" : undefined,
              }}
              autoComplete="off"
            />
            {newSlugHint && (
              <span
                data-testid="wiki-new-slug-hint"
                style={{ display: "block", marginTop: "0.35rem", color: "crimson", fontSize: "0.8rem" }}
              >
                {newSlugHint}
              </span>
            )}
          </label>
          <label style={labelStyle}>
            Titel
            <input
              data-testid="wiki-new-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Inhalt (Markdown)
            <textarea
              data-testid="wiki-new-body"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              rows={6}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </label>
          <label
            style={{
              ...labelStyle,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              data-testid="wiki-new-preview-toggle"
              checked={previewCreate}
              onChange={(e) => setPreviewCreate(e.target.checked)}
            />
            Vorschau
          </label>
          {previewCreate && <WikiMarkdownPreview markdown={newBody} />}
          <label style={labelStyle}>
            Status{" "}
            <select
              data-testid="wiki-new-status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              style={selectStyle}
            >
              {WIKI_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {createPage.isError && (
            <div data-testid="wiki-create-error" style={{ color: "crimson", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
              {createPage.error.message}
            </div>
          )}
          <button
            type="button"
            data-testid="wiki-new-submit"
            disabled={
              createPage.isPending || !newTitle.trim() || !newSlugOk
            }
            onClick={async () => {
              await createPage.mutateAsync({
                slug: newSlug.trim(),
                title: newTitle.trim(),
                body_md: newBody,
                status: newStatus,
              });
              setCreateOpen(false);
            }}
            style={{ ...btnStyle, marginTop: "0.75rem" }}
          >
            Anlegen
          </button>
        </Modal>
      )}

      {editPage && (
        <Modal
          title="Wiki-Seite bearbeiten"
          wide
          onClose={() => {
            patchPage.reset();
            deletePage.reset();
            setEditPage(null);
          }}
        >
          <label style={labelStyle}>
            Slug
            <input
              data-testid="wiki-edit-slug"
              value={editSlug}
              onChange={(e) => setEditSlug(e.target.value)}
              style={{
                ...inputStyle,
                borderColor: editSlug.trim() && !editSlugOk ? "crimson" : undefined,
              }}
            />
            {editSlugHint && (
              <span style={{ display: "block", marginTop: "0.35rem", color: "crimson", fontSize: "0.8rem" }}>
                {editSlugHint}
              </span>
            )}
          </label>
          <label style={labelStyle}>
            Titel
            <input
              data-testid="wiki-edit-title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Inhalt
            <textarea
              data-testid="wiki-edit-body"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={6}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </label>
          <label
            style={{
              ...labelStyle,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              data-testid="wiki-edit-preview-toggle"
              checked={previewEdit}
              onChange={(e) => setPreviewEdit(e.target.checked)}
            />
            Vorschau
          </label>
          {previewEdit && <WikiMarkdownPreview markdown={editBody} />}
          <label style={labelStyle}>
            Status{" "}
            <select
              data-testid="wiki-edit-status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              style={selectStyle}
            >
              {WIKI_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {(patchPage.isError || deletePage.isError) && (
            <div data-testid="wiki-edit-error" style={{ color: "crimson", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
              {patchPage.error?.message ?? deletePage.error?.message}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              type="button"
              data-testid="wiki-edit-save"
              disabled={
                patchPage.isPending || !editTitle.trim() || !editSlugOk
              }
              onClick={async () => {
                await patchPage.mutateAsync({
                  id: editPage.id,
                  patch: {
                    slug: editSlug.trim(),
                    title: editTitle.trim(),
                    body_md: editBody,
                    status: editStatus,
                  },
                });
                setEditPage(null);
              }}
              style={btnStyle}
            >
              Speichern
            </button>
            <button
              type="button"
              data-testid="wiki-edit-approve"
              disabled={patchPage.isPending || editStatus === "approved"}
              onClick={async () => {
                await patchPage.mutateAsync({
                  id: editPage.id,
                  patch: { status: "approved" },
                });
                setEditPage(null);
              }}
              style={btnStyle}
            >
              Freigeben
            </button>
            <button
              type="button"
              data-testid="wiki-edit-delete"
              disabled={deletePage.isPending}
              onClick={async () => {
                if (!confirm("Seite wirklich löschen?")) return;
                await deletePage.mutateAsync(editPage.id);
                setEditPage(null);
              }}
              style={{ ...btnStyle, borderColor: "crimson", color: "crimson" }}
            >
              Löschen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      role="presentation"
      onClick={props.onClose}
    >
      <div
        role="dialog"
        style={{
          background: "var(--surface)",
          borderRadius: 10,
          padding: "1.25rem",
          minWidth: 320,
          maxWidth: props.wide ? "min(720px, 96vw)" : "min(560px, 92vw)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>{props.title}</h2>
        {props.children}
        <button type="button" onClick={props.onClose} style={{ ...btnStyle, marginTop: "0.5rem" }}>
          Schließen
        </button>
      </div>
    </div>
  );
}

const btnStyle: CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  cursor: "pointer",
};

const selectStyle: CSSProperties = {
  marginLeft: "0.35rem",
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
};

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: "0.25rem",
  padding: "0.45rem 0.55rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "0.65rem",
  fontSize: "0.85rem",
};

const thStyle: CSSProperties = {
  padding: "0.5rem 0.65rem",
  fontWeight: 600,
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--muted)",
};

const tdStyle: CSSProperties = {
  padding: "0.55rem 0.65rem",
  verticalAlign: "top",
};
