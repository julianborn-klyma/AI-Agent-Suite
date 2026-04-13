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
      <h2 className="co-admin-h2">Users</h2>
      <p className="co-admin-lead">Klick auf eine Karte für Kontext-Keys und Inline-Bearbeitung.</p>
      <div className="co-user-grid">
        {q.data?.map((u) => (
          <Link key={u.id} to={`/admin/users/${u.id}`} className="co-user-card">
            <div className="co-user-card-name">{u.name}</div>
            <div className="co-user-card-meta">{u.email}</div>
            <div className="co-user-card-meta" style={{ marginTop: "0.5rem" }}>
              <span className={u.is_active ? "co-badge co-badge--success" : "co-badge"}>
                {u.is_active ? "Aktiv" : "Inaktiv"}
              </span>
              <span className="co-badge" style={{ marginLeft: "0.35rem" }}>
                {u.role}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
