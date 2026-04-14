import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

type ScheduleRow = {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  job_type: string;
  cron_expression: string;
  delivery_channel: string;
  delivery_target: string;
  is_active: boolean;
  display_name: string | null;
  description: string | null;
  last_run: string | null;
  last_run_status: string | null;
};

type GroupedUser = {
  user_id: string;
  user_name: string;
  user_email: string;
  jobs: ScheduleRow[];
};

export function SchedulesPage() {
  const q = useQuery({
    queryKey: ["admin", "schedules"],
    queryFn: () => api.get<GroupedUser[]>("/api/admin/schedules"),
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

  const groups = q.data ?? [];

  return (
    <div className="co-admin-page">
      <h2 className="co-admin-h2">Schedules</h2>
      <p className="co-admin-lead">Alle Job-Typen je Benutzer.</p>

      {groups.map((g) => (
        <section
          key={g.user_id}
          style={{
            marginBottom: "2rem",
            borderBottom: "1px solid var(--border)",
            paddingBottom: "1.5rem",
          }}
        >
          <h3 className="co-font-display" style={{ fontSize: "1.05rem", margin: "0 0 0.35rem" }}>
            {g.user_name}
          </h3>
          <p className="co-muted" style={{ margin: "0 0 1rem", fontSize: "0.9rem" }}>
            {g.user_email}
          </p>
          <div className="co-table-wrap">
            <table className="co-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Cron</th>
                  <th>Kanal</th>
                  <th>Aktiv</th>
                  <th>last_run</th>
                </tr>
              </thead>
              <tbody>
                {g.jobs.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {s.display_name ?? s.job_type}
                      </div>
                      <code style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {s.job_type}
                      </code>
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
        </section>
      ))}

      {groups.length === 0 && (
        <p className="co-muted">Keine Schedules.</p>
      )}
    </div>
  );
}
