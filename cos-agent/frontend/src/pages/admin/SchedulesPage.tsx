import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

type ScheduleRow = {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  cron_expression: string;
  delivery_channel: string;
  delivery_target: string;
  is_active: boolean;
  last_run: string | null;
  last_run_status: string | null;
};

export function SchedulesPage() {
  const q = useQuery({
    queryKey: ["admin", "schedules"],
    queryFn: () => api.get<ScheduleRow[]>("/api/admin/schedules"),
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
      <h2 className="co-admin-h2">Schedules</h2>
      <p className="co-admin-lead">Geplante Jobs und letzte Ausführung.</p>
      <div className="co-table-wrap">
        <table className="co-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Cron</th>
              <th>Kanal</th>
              <th>Aktiv</th>
              <th>last_run</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.user_name}
                  <div className="co-muted" style={{ fontSize: "0.8rem", marginTop: "0.15rem" }}>
                    {s.user_email}
                  </div>
                </td>
                <td>
                  <code style={{ fontSize: "0.8rem" }}>{s.cron_expression}</code>
                </td>
                <td>{s.delivery_channel}</td>
                <td>
                  <span className={s.is_active ? "co-badge co-badge--success" : "co-badge"}>
                    {s.is_active ? "ja" : "nein"}
                  </span>
                </td>
                <td>
                  {s.last_run ?? "—"}
                  {s.last_run_status && (
                    <span className="co-muted" style={{ fontSize: "0.8rem" }}>
                      {" "}
                      ({s.last_run_status})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
