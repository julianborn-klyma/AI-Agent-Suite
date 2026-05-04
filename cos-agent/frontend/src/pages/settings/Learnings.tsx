import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useState } from "react";
import { ApiError, api } from "../../lib/api.ts";

type LearningRow = {
  id: string;
  category: string;
  content: string;
  source: string;
  confidence: number;
  confirmed_by_user: boolean;
  times_confirmed: number;
};

const TABS: { key: string; label: string; category?: string }[] = [
  { key: "all", label: "Alle" },
  { key: "decision_pattern", label: "Entscheidungen", category: "decision_pattern" },
  { key: "priority", label: "Prioritäten", category: "priority" },
  { key: "relationship", label: "Beziehungen", category: "relationship" },
  { key: "project", label: "Projekte", category: "project" },
  { key: "financial", label: "Finanzen", category: "financial" },
  { key: "commitment", label: "Commitments", category: "commitment" },
];

const CATEGORY_LABEL: Record<string, string> = {
  decision_pattern: "Entscheidungsmuster",
  priority: "Prioritäten",
  relationship: "Beziehungen",
  project: "Projekte",
  financial: "Finanzen",
  commitment: "Commitments",
  preference: "Präferenzen",
};

const cardBase: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "1.1rem",
  marginBottom: "0.85rem",
};

function labelForCategory(cat: string): string {
  return CATEGORY_LABEL[cat] ?? cat;
}

function parseErr(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Fehler";
}

export function SettingsLearningsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]!);
  const [banner, setBanner] = useState<string | null>(null);

  const learningsQ = useQuery({
    queryKey: ["learnings", tab.key],
    queryFn: () => {
      const q = tab.category
        ? `?category=${encodeURIComponent(tab.category)}&limit=100`
        : "?limit=100";
      return api.get<LearningRow[]>(`/api/learnings${q}`);
    },
  });

  const confirmM = useMutation({
    mutationFn: (id: string) => api.patch(`/api/learnings/${id}/confirm`, {}),
    onSuccess: () => {
      setBanner("Als bestätigt gespeichert.");
      void queryClient.invalidateQueries({ queryKey: ["learnings"] });
    },
    onError: (e) => setBanner(parseErr(e)),
  });

  const deactivateM = useMutation({
    mutationFn: (id: string) => api.patch(`/api/learnings/${id}/deactivate`, {}),
    onSuccess: () => {
      setBanner("Learning deaktiviert.");
      void queryClient.invalidateQueries({ queryKey: ["learnings"] });
    },
    onError: (e) => setBanner(parseErr(e)),
  });

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 className="co-font-display" style={{ marginTop: 0 }}>
        Was weiß der Agent über mich?
      </h2>
      <p style={{ color: "var(--muted)", marginTop: "-0.25rem" }}>
        Bestätigte Learnings fließen stärker in Antworten ein. Unsichere bleiben vorsichtig
        nutzbar.
      </p>

      {banner && (
        <p style={{ margin: "0.75rem 0", fontSize: "0.9rem", color: "var(--muted)" }}>
          {banner}
        </p>
      )}

      <div
        role="tablist"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          margin: "1rem 0",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab.key === t.key}
            onClick={() => {
              setTab(t);
              setBanner(null);
            }}
            style={{
              padding: "0.35rem 0.65rem",
              borderRadius: "var(--radius-md)",
              border: tab.key === t.key
                ? "1px solid hsl(var(--ds-color-focus))"
                : "1px solid var(--border)",
              background: tab.key === t.key
                ? "hsl(var(--ds-status-info-bg))"
                : "var(--surface)",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {learningsQ.isPending && (
        <p style={{ color: "var(--muted)" }}>Laden…</p>
      )}
      {learningsQ.error && (
        <p style={{ color: "var(--danger)" }}>
          {learningsQ.error instanceof Error
            ? learningsQ.error.message
            : "Fehler"}
        </p>
      )}

      {learningsQ.data?.map((L) => {
        const dim = L.confidence < 0.7;
        const borderColor = L.confirmed_by_user
          ? "var(--success-border, #2d7a4a)"
          : "var(--border)";
        const cardStyle: CSSProperties = {
          ...cardBase,
          opacity: dim ? 0.72 : 1,
          borderColor,
          borderWidth: L.confirmed_by_user ? 2 : 1,
        };
        return (
          <article key={L.id} style={cardStyle}>
            <div style={{ fontSize: "0.8rem", color: "var(--link)", marginBottom: "0.35rem" }}>
              {labelForCategory(L.category)}
            </div>
            <p style={{ margin: 0, lineHeight: 1.45 }}>{L.content}</p>
            <p style={{ margin: "0.65rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
              Quelle: {L.source} · {L.times_confirmed}x bestätigt ·{" "}
              {Math.round(L.confidence * 100)}%
            </p>
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                disabled={L.confirmed_by_user || confirmM.isPending}
                onClick={() => confirmM.mutate(L.id)}
                style={{
                  padding: "0.35rem 0.65rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  cursor: confirmM.isPending ? "wait" : "pointer",
                }}
              >
                ✓ Bestätigen
              </button>
              <button
                type="button"
                disabled={deactivateM.isPending}
                onClick={() => deactivateM.mutate(L.id)}
                style={{
                  padding: "0.35rem 0.65rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--danger-border)",
                  color: "var(--danger)",
                  background: "transparent",
                  cursor: deactivateM.isPending ? "wait" : "pointer",
                }}
              >
                ✗ Löschen
              </button>
            </div>
          </article>
        );
      })}

      {learningsQ.data && learningsQ.data.length === 0 && !learningsQ.isPending && (
        <p style={{ color: "var(--muted)" }}>Keine Learnings in dieser Kategorie.</p>
      )}
    </div>
  );
}
