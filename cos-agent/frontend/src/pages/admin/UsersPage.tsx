import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.ts";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

export function UsersPage() {
  const q = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<AdminUser[]>("/api/admin/users"),
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
      <h3 style={{ marginTop: 0 }}>Users</h3>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.9rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "0.5rem" }}>Name</th>
            <th style={{ padding: "0.5rem" }}>E-Mail</th>
            <th style={{ padding: "0.5rem" }}>Rolle</th>
            <th style={{ padding: "0.5rem" }}>Aktiv</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.map((u) => (
            <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "0.5rem" }}>
                <Link to={`/admin/users/${u.id}`}>{u.name}</Link>
              </td>
              <td style={{ padding: "0.5rem" }}>{u.email}</td>
              <td style={{ padding: "0.5rem" }}>{u.role}</td>
              <td style={{ padding: "0.5rem" }}>{u.is_active ? "ja" : "nein"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
