import { useState } from "react";
import { Link } from "react-router-dom";
import {
  type BrainMemberRole,
  BRAIN_PROJECTS_KEY,
  useCreateProject,
  useBrainProjects,
} from "../hooks/useBrain.ts";
import { useQueryClient } from "@tanstack/react-query";

const ROLE_LABEL: Record<BrainMemberRole, string> = {
  owner: "Owner",
  knowledge_owner: "Knowledge Owner",
  member: "Mitglied",
};

const PROJECT_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const createMut = useCreateProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0] ?? "#6366f1");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    try {
      await createMut.mutateAsync({ name: name.trim(), description: description.trim() || undefined, color });
      await qc.invalidateQueries({ queryKey: BRAIN_PROJECTS_KEY });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Erstellen");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(480px, 100%)",
          background: "var(--surface)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          padding: "1.5rem",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3
          style={{ margin: "0 0 1rem", fontSize: "1.05rem", fontWeight: 700 }}
        >
          Neues Projekt
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div style={{ marginBottom: "0.85rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.82rem",
                color: "var(--muted)",
                marginBottom: "0.35rem",
              }}
            >
              Name *
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Betriebsleiter Projekt"
              style={{
                width: "100%",
                padding: "0.5rem 0.65rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "0.85rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.82rem",
                color: "var(--muted)",
                marginBottom: "0.35rem",
              }}
            >
              Beschreibung
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Worum geht es in diesem Projekt?"
              style={{
                width: "100%",
                padding: "0.5rem 0.65rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--text)",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "1.1rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.82rem",
                color: "var(--muted)",
                marginBottom: "0.5rem",
              }}
            >
              Farbe
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: c,
                    border: color === c ? "3px solid var(--ink)" : "2px solid transparent",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
          {error && (
            <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "0.45rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
                cursor: "pointer",
              }}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!name.trim() || createMut.isPending}
              className="co-btn co-btn--primary"
              style={{ padding: "0.45rem 1rem" }}
            >
              {createMut.isPending ? "Erstelle…" : "Erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BrainPage({ embedded = false }: { embedded?: boolean }) {
  const q = useBrainProjects();
  const [showNew, setShowNew] = useState(false);

  if (q.isPending) {
    return (
      <div style={{ padding: embedded ? 0 : "1.5rem" }}>
        <p className="co-muted">Laden…</p>
      </div>
    );
  }

  if (q.error) {
    return (
      <div style={{ padding: embedded ? 0 : "1.5rem" }}>
        <p style={{ color: "var(--danger)" }}>
          {q.error instanceof Error ? q.error.message : "Fehler beim Laden"}
        </p>
      </div>
    );
  }

  const projects = q.data ?? [];

  return (
    <div style={{ padding: embedded ? 0 : "1.5rem 0" }} data-testid="brain-page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.25rem",
        }}
      >
        <div>
          <h1
            className="co-font-display"
            style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700 }}
          >
            Brain & Projekte
          </h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
            Kuratiertes Wissen pro Projekt — für alle Mitglieder im Chat verfügbar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="co-btn co-btn--primary"
          style={{ padding: "0.45rem 1.1rem", flexShrink: 0 }}
        >
          + Neues Projekt
        </button>
      </div>

      {projects.length === 0 ? (
        <div
          style={{
            padding: "2.5rem 1.5rem",
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: 10,
            color: "var(--muted)",
          }}
        >
          <p style={{ margin: "0 0 0.35rem", fontWeight: 600 }}>
            Noch keine Projekte
          </p>
          <p style={{ margin: 0, fontSize: "0.88rem" }}>
            Erstelle dein erstes Projekt um Wissen mit deinem Team zu teilen.
          </p>
        </div>
      ) : (
        <div className="co-user-grid">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/brain/${p.id}`}
              className="co-user-card"
              style={{
                textDecoration: "none",
                borderLeft: `4px solid ${p.color}`,
                display: "block",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                }}
              >
                <div
                  className="co-user-card-name"
                  style={{ fontWeight: 700, fontSize: "0.97rem" }}
                >
                  {p.name}
                </div>
                {p.member_role && (
                  <span
                    className="co-badge"
                    style={{
                      flexShrink: 0,
                      fontSize: "0.7rem",
                      background: p.member_role === "owner" ? "var(--accent-soft)" : undefined,
                    }}
                  >
                    {ROLE_LABEL[p.member_role]}
                  </span>
                )}
              </div>
              {p.description && (
                <div
                  className="co-user-card-meta"
                  style={{ marginTop: "0.35rem", lineHeight: 1.4 }}
                >
                  {p.description}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: "0.65rem",
                  marginTop: "0.65rem",
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                }}
              >
                {p.member_count !== undefined && (
                  <span>{p.member_count} Mitglieder</span>
                )}
                {p.entry_count !== undefined && (
                  <span>{p.entry_count} Einträge</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
