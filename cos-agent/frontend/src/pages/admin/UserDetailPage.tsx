import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api.ts";

type ContextRow = { key: string; value: string; updated_at: string };

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["admin", "user", id, "context"],
    queryFn: () => api.get<ContextRow[]>(`/api/admin/users/${id}/context`),
    enabled: Boolean(id),
  });

  if (!id) return <p>Keine User-ID.</p>;
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
      <h3 style={{ marginTop: 0 }}>User-Kontext</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>ID: {id}</p>
      <ul style={{ paddingLeft: "1.2rem" }}>
        {q.data?.map((row) => (
          <li key={row.key} style={{ marginBottom: "0.35rem" }}>
            <strong>{row.key}</strong>: <code>{row.value}</code>
            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
              {" "}
              ({row.updated_at})
            </span>
          </li>
        ))}
      </ul>
      {q.data?.length === 0 && (
        <p style={{ color: "var(--muted)" }}>Keine Kontext-Einträge.</p>
      )}
    </div>
  );
}
