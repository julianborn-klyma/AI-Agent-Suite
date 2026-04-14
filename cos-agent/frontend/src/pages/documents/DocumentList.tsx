import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.ts";

type DocumentRow = {
  id: string;
  name: string;
  document_type: string;
  summary: string | null;
  processed: boolean;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  business_plan: "Businessplan",
  meeting_summary: "Meeting-Protokoll",
  financial_report: "Finanzbericht",
  other: "Sonstiges",
};

function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t;
}

export function DocumentListPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("other");
  const [customName, setCustomName] = useState("");

  const q = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.get<DocumentRow[]>("/api/documents"),
  });

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setUploadError("Bitte eine Datei wählen.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("document_type", documentType);
      if (customName.trim()) fd.set("name", customName.trim());
      await api.postForm<unknown>("/api/documents", fd);
      await qc.invalidateQueries({ queryKey: ["documents"] });
      setModalOpen(false);
      setFile(null);
      setCustomName("");
      setDocumentType("other");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!window.confirm(`Dokument „${name}“ wirklich löschen?`)) return;
    await api.delete(`/api/documents/${encodeURIComponent(id)}`);
    await qc.invalidateQueries({ queryKey: ["documents"] });
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <h1 className="co-font-display" style={{ fontSize: "1.35rem", margin: 0 }}>
          Dokumente
        </h1>
        <button
          type="button"
          onClick={() => {
            setModalOpen(true);
            setUploadError(null);
          }}
          style={{
            padding: "0.45rem 0.9rem",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--accent)",
            color: "var(--accent-foreground)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Hochladen
        </button>
      </div>

      {q.isLoading && <p style={{ color: "var(--muted)" }}>Lade Dokumente…</p>}
      {q.isError && (
        <p style={{ color: "var(--danger, #c00)" }}>
          {q.error instanceof Error ? q.error.message : "Fehler beim Laden."}
        </p>
      )}

      {q.data && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "auto",
            background: "var(--surface)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "0.6rem 0.75rem" }}>Name</th>
                <th style={{ padding: "0.6rem 0.75rem" }}>Typ</th>
                <th style={{ padding: "0.6rem 0.75rem" }}>Status</th>
                <th style={{ padding: "0.6rem 0.75rem" }}>Datum</th>
                <th style={{ padding: "0.6rem 0.75rem", width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <Link
                      to={`/documents/${d.id}`}
                      style={{ color: "var(--accent)", fontWeight: 500 }}
                    >
                      {d.name}
                    </Link>
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>{typeLabel(d.document_type)}</td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    {d.processed ? "Verarbeitet" : "Ausstehend"}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "var(--muted)" }}>
                    {new Date(d.created_at).toLocaleString("de-DE", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <button
                      type="button"
                      onClick={() => void onDelete(d.id, d.name)}
                      style={{
                        fontSize: "0.8rem",
                        padding: "0.25rem 0.5rem",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data.length === 0 && (
            <p style={{ padding: "1rem", color: "var(--muted)", margin: 0 }}>
              Noch keine Dokumente. Nutze „Hochladen“, um zu starten.
            </p>
          )}
        </div>
      )}

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "1rem",
          }}
          onClick={() => !uploading && setModalOpen(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: 10,
              padding: "1.25rem",
              maxWidth: 440,
              width: "100%",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="co-font-display" style={{ marginTop: 0, fontSize: "1.1rem" }}>
              Dokument hochladen
            </h2>
            <form onSubmit={(e) => void onUpload(e)}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                Datei (PDF, DOCX, Text — max. 10 MB)
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) setFile(f);
                }}
                style={{
                  border: "2px dashed var(--border)",
                  borderRadius: 8,
                  padding: "1rem",
                  marginBottom: "0.5rem",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  color: "var(--muted)",
                }}
              >
                Datei hierher ziehen oder unten wählen
              </div>
              <input
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={uploading}
                style={{ marginBottom: "0.75rem", width: "100%" }}
              />
              <label style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.85rem" }}>
                Dokumenttyp
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                disabled={uploading}
                style={{
                  width: "100%",
                  marginBottom: "0.75rem",
                  padding: "0.35rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                }}
              >
                <option value="business_plan">Businessplan</option>
                <option value="meeting_summary">Meeting-Protokoll</option>
                <option value="financial_report">Finanzbericht</option>
                <option value="other">Sonstiges</option>
              </select>
              <label style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.85rem" }}>
                Anzeigename (optional)
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Standard: Dateiname"
                disabled={uploading}
                style={{
                  width: "100%",
                  marginBottom: "0.75rem",
                  padding: "0.4rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                }}
              />
              {uploadError && (
                <p style={{ color: "var(--danger, #c00)", fontSize: "0.85rem" }}>{uploadError}</p>
              )}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setModalOpen(false)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                    fontWeight: 600,
                    cursor: uploading ? "wait" : "pointer",
                  }}
                >
                  {uploading ? "Dokument wird verarbeitet…" : "Hochladen"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
