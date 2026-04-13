import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../../lib/api.ts";

type ContextRow = { key: string; value: string; updated_at: string };

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const j = JSON.parse(e.message) as { error?: string };
      if (typeof j.error === "string") return j.error;
    } catch {
      /* ignore */
    }
    return e.message || `HTTP ${e.status}`;
  }
  if (e instanceof Error) return e.message;
  return "Unbekannter Fehler";
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [rows, setRows] = useState<ContextRow[]>([]);
  const [baseline, setBaseline] = useState<string>("");

  const q = useQuery({
    queryKey: ["admin", "user", id, "context"],
    queryFn: () => api.get<ContextRow[]>(`/api/admin/users/${id}/context`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!q.data) return;
    setRows(q.data.map((r) => ({ ...r })));
    setBaseline(JSON.stringify(q.data.map((r) => ({ key: r.key, value: r.value }))));
  }, [q.data]);

  const dirty = JSON.stringify(rows.map((r) => ({ key: r.key, value: r.value }))) !== baseline;

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = rows
        .filter((r) => r.key.trim())
        .map((r) => ({ key: r.key.trim(), value: r.value }));
      return await api.put<{ updated: boolean }>(
        `/api/admin/users/${id}/context`,
        payload,
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "user", id, "context"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (key: string) => {
      await api.delete(`/api/admin/users/${id}/context/${encodeURIComponent(key)}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "user", id, "context"] });
    },
  });

  const updateRow = useCallback((index: number, field: "key" | "value", v: string) => {
    setRows((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (cur) next[index] = { ...cur, [field]: v };
      return next;
    });
  }, []);

  const addRow = () => {
    setRows((prev) => [...prev, { key: "", value: "", updated_at: "" }]);
  };

  const removeRowLocal = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  if (!id) return <p className="co-muted">Keine User-ID.</p>;
  if (q.isPending) {
    return (
      <div className="co-admin-page">
        <p className="co-muted">Laden…</p>
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="co-admin-page">
        <p style={{ color: "var(--danger)" }}>
          {q.error instanceof Error ? q.error.message : "Fehler"}
        </p>
      </div>
    );
  }

  return (
    <div className="co-admin-page">
      <Link to="/admin/users" className="co-muted" style={{ fontSize: "0.88rem" }}>
        ← Zurück zu Users
      </Link>
      <h2 className="co-admin-h2" style={{ marginTop: "0.75rem" }}>
        User-Kontext
      </h2>
      <p className="co-admin-lead">
        Schlüssel/Werte für Agent &amp; Tools. Speichern sendet die gesamte Liste (PUT).
      </p>
      <p className="co-muted" style={{ marginBottom: "1rem" }}>
        User-ID: <code>{id}</code>
      </p>

      <div className="co-card" style={{ marginBottom: "1rem" }}>
        {rows.length === 0 && (
          <p className="co-muted" style={{ margin: 0 }}>
            Keine Einträge — „Zeile hinzufügen“ nutzen.
          </p>
        )}
        {rows.map((row, i) => (
          <div
            key={row.key.trim() ? row.key : `draft-${i}`}
            className="co-context-grid"
            style={{
              marginBottom: i < rows.length - 1 ? "0.85rem" : 0,
              paddingBottom: i < rows.length - 1 ? "0.85rem" : 0,
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <div>
              <label className="co-field-label" htmlFor={`ctx-k-${i}`}>Key</label>
              <input
                id={`ctx-k-${i}`}
                className="co-input"
                value={row.key}
                onChange={(e) => updateRow(i, "key", e.target.value)}
                placeholder="z. B. notion_database_id"
              />
            </div>
            <div>
              <label className="co-field-label" htmlFor={`ctx-v-${i}`}>Wert</label>
              <textarea
                id={`ctx-v-${i}`}
                className="co-textarea"
                style={{ minHeight: 72 }}
                value={row.value}
                onChange={(e) => updateRow(i, "value", e.target.value)}
                spellCheck={false}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", paddingTop: "1.35rem" }}>
              {row.key.trim() !== "" && (
                <button
                  type="button"
                  className="co-btn co-btn--danger"
                  style={{ fontSize: "0.78rem", padding: "0.35rem 0.5rem" }}
                  onClick={() => {
                    if (confirm(`Kontext „${row.key}“ in der DB löschen?`)) {
                      void deleteMut.mutateAsync(row.key);
                    }
                  }}
                >
                  Löschen
                </button>
              )}
              {row.key.trim() === "" && (
                <button
                  type="button"
                  className="co-btn co-btn--ghost"
                  style={{ fontSize: "0.78rem", padding: "0.35rem 0.5rem" }}
                  onClick={() => removeRowLocal(i)}
                >
                  Entfernen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <button type="button" className="co-btn co-btn--ghost" onClick={addRow}>
          + Zeile hinzufügen
        </button>
        <button
          type="button"
          className="co-btn co-btn--primary"
          disabled={!dirty || saveMut.isPending}
          onClick={() => void saveMut.mutateAsync()}
        >
          {saveMut.isPending ? "Speichern…" : "Änderungen speichern"}
        </button>
        {saveMut.isError && (
          <span className="co-status-line co-status-line--error" style={{ margin: 0 }}>
            {errMsg(saveMut.error)}
          </span>
        )}
        {saveMut.isSuccess && !dirty && (
          <span className="co-status-line co-status-line--ok" style={{ margin: 0 }}>
            Gespeichert.
          </span>
        )}
      </div>
    </div>
  );
}
