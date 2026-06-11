import { useState } from "react";
import {
  type FirmInsightCategory,
  useFirmInsights,
  useSuppressInsight,
  useDeleteInsight,
} from "../../hooks/useBrain.ts";

const CATEGORY_LABELS: Record<FirmInsightCategory, string> = {
  person: "Person",
  company: "Unternehmen",
  project: "Projekt",
  decision: "Entscheidung",
  pattern: "Muster",
  relationship: "Beziehung",
};

const CATEGORY_COLORS: Record<FirmInsightCategory, string> = {
  person: "#0ea5e9",
  company: "#10b981",
  project: "#6366f1",
  decision: "#f59e0b",
  pattern: "#8b5cf6",
  relationship: "#ec4899",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function FirmBrainPage() {
  const q = useFirmInsights();
  const suppressMut = useSuppressInsight();
  const deleteMut = useDeleteInsight();

  const [categoryFilter, setCategoryFilter] = useState<FirmInsightCategory | "">("");
  const [showSuppressed, setShowSuppressed] = useState(false);

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
          {q.error instanceof Error ? q.error.message : "Fehler beim Laden"}
        </p>
      </div>
    );
  }

  const allInsights = q.data ?? [];
  const insights = allInsights.filter((i) => {
    if (!showSuppressed && i.admin_suppressed) return false;
    if (categoryFilter && i.category !== categoryFilter) return false;
    return true;
  });

  const suppressedCount = allInsights.filter((i) => i.admin_suppressed).length;

  async function handleSuppress(id: string, suppress: boolean) {
    await suppressMut.mutateAsync({ id, suppress });
  }

  async function handleDelete(id: string) {
    if (!confirm("Insight wirklich löschen?")) return;
    await deleteMut.mutateAsync(id);
  }

  return (
    <div className="co-admin-page">
      <h2 className="co-admin-h2">Firm Brain</h2>
      <p className="co-admin-lead">
        Automatisch aus allen Projekt-Chats extrahiertes Firmenwissen. Supprimierte Insights
        werden nicht in den Chat-Kontext injiziert.
      </p>

      <div
        style={{
          display: "flex",
          gap: "0.65rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as FirmInsightCategory | "")}
          style={{
            padding: "0.4rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "var(--text)",
          }}
        >
          <option value="">Alle Kategorien</option>
          {(Object.keys(CATEGORY_LABELS) as FirmInsightCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            fontSize: "0.88rem",
            color: "var(--muted)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showSuppressed}
            onChange={(e) => setShowSuppressed(e.target.checked)}
          />
          Supprimierte anzeigen ({suppressedCount})
        </label>
        <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--muted)" }}>
          {insights.length} Insights
        </span>
      </div>

      {insights.length === 0 ? (
        <div
          style={{
            padding: "2.5rem 1.5rem",
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: 10,
            color: "var(--muted)",
          }}
        >
          {allInsights.length === 0
            ? "Noch keine Firm Brain Insights. Sie werden nach Chats automatisch extrahiert."
            : "Keine Insights für diesen Filter."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {insights.map((insight) => (
            <div
              key={insight.id}
              style={{
                padding: "0.85rem 1rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: insight.admin_suppressed
                  ? "var(--bg)"
                  : "var(--surface)",
                borderLeft: `4px solid ${CATEGORY_COLORS[insight.category]}`,
                opacity: insight.admin_suppressed ? 0.65 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  marginBottom: "0.45rem",
                }}
              >
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      color: CATEGORY_COLORS[insight.category],
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {CATEGORY_LABELS[insight.category]}
                  </span>
                  {insight.admin_suppressed && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: 4,
                        background: "rgba(239,68,68,0.12)",
                        color: "var(--danger)",
                        border: "1px solid rgba(239,68,68,0.25)",
                      }}
                    >
                      supprimiert
                    </span>
                  )}
                  {insight.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: 4,
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        color: "var(--muted)",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => void handleSuppress(insight.id, !insight.admin_suppressed)}
                    disabled={suppressMut.isPending}
                    style={{
                      padding: "0.2rem 0.55rem",
                      fontSize: "0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      background: "var(--surface)",
                      cursor: "pointer",
                    }}
                  >
                    {insight.admin_suppressed ? "Aktivieren" : "Supprimieren"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(insight.id)}
                    disabled={deleteMut.isPending}
                    style={{
                      padding: "0.2rem 0.55rem",
                      fontSize: "0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      background: "var(--surface)",
                      color: "var(--danger)",
                      cursor: "pointer",
                    }}
                  >
                    Löschen
                  </button>
                </div>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.9rem",
                  color: "var(--text)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {insight.content}
              </p>
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                  display: "flex",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <span>{formatDate(insight.created_at)}</span>
                {insight.source_project_name && (
                  <span>Projekt: {insight.source_project_name}</span>
                )}
                <span>
                  Konfidenz: {Math.round((insight.confidence ?? 0.8) * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
