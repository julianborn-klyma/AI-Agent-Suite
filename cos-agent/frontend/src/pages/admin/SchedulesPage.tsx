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
      <h3 style={{ marginTop: 0 }}>Schedules</h3>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.85rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "0.45rem" }}>User</th>
            <th style={{ padding: "0.45rem" }}>Cron</th>
            <th style={{ padding: "0.45rem" }}>Kanal</th>
            <th style={{ padding: "0.45rem" }}>Aktiv</th>
            <th style={{ padding: "0.45rem" }}>last_run</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.map((s) => (
            <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "0.45rem" }}>
                {s.user_name}
                <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                  {s.user_email}
                </div>
              </td>
              <td style={{ padding: "0.45rem" }}>{s.cron_expression}</td>
              <td style={{ padding: "0.45rem" }}>{s.delivery_channel}</td>
              <td style={{ padding: "0.45rem" }}>{s.is_active ? "ja" : "nein"}</td>
              <td style={{ padding: "0.45rem" }}>
                {s.last_run ?? "—"}
                {s.last_run_status && (
                  <span style={{ color: "var(--muted)" }}>
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
  );
}
