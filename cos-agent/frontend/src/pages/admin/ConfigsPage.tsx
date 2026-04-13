import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

type ConfigRow = {
  id: number;
  name: string;
  system_prompt: string;
  tools_enabled: string[];
  is_template: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

export function ConfigsPage() {
  const q = useQuery({
    queryKey: ["admin", "configs"],
    queryFn: () => api.get<ConfigRow[]>("/api/admin/configs"),
  });

  if (q.isPending) return <p style={{ color: "var(--muted)" }}>Laden…</p>;
  if (q.error) {
    return (
      <p style={{ color: "var(--danger)" }}>
        {q.error instanceof Error ? q.error.message : "Fehler"}
      </p>
    );
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Agent-Configs</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {q.data?.map((c) => (
          <div
            key={c.id}
            style={{
              padding: "0.75rem",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              #{c.id} — {c.name}{" "}
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                {c.is_template ? "(Template)" : `(User ${c.user_id ?? "—"})`}
              </span>
            </div>
            <pre
              style={{
                margin: "0.5rem 0 0",
                fontSize: "0.75rem",
                overflow: "auto",
                maxHeight: 120,
              }}
            >
              {c.system_prompt.slice(0, 400)}
              {c.system_prompt.length > 400 ? "…" : ""}
            </pre>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Tools: {c.tools_enabled.join(", ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
