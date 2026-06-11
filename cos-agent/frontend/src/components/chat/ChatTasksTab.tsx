import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.ts";

type ScheduleRow = {
  job_type: string;
  cron_expression: string;
  is_active: boolean;
  display_name: string | null;
};

type ConnectionsStatus = {
  google: boolean;
  slack: boolean;
  drive_folder_id?: string;
};

function depOk(jobType: string, c: ConnectionsStatus | undefined): boolean {
  if (!c) return false;
  if (jobType === "email_categorization") return c.google;
  if (jobType === "slack_digest") return c.slack;
  if (jobType === "drive_sync") {
    return c.google && Boolean(c.drive_folder_id?.trim());
  }
  return true;
}

export function ChatTasksTab() {
  const queryClient = useQueryClient();
  const schedulesQ = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.get<ScheduleRow[]>("/api/schedules"),
  });
  const connQ = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.get<ConnectionsStatus>("/api/connections"),
  });

  const toggleM = useMutation({
    mutationFn: async (p: { jobType: string; is_active: boolean }) => {
      await api.patch(`/api/schedules/${p.jobType}/toggle`, {
        is_active: p.is_active,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
  });

  if (schedulesQ.isPending) {
    return <p style={{ padding: "0.5rem", color: "var(--muted)", fontSize: "0.85rem" }}>Laden…</p>;
  }

  const rows = schedulesQ.data ?? [];
  const c = connQ.data;

  return (
    <div data-testid="chat-sidebar-tasks" style={{ padding: "0.35rem 0.25rem" }}>
      {rows.map((s) => {
        const canToggle = depOk(s.job_type, c) && !toggleM.isPending;
        const title = s.display_name ?? s.job_type;
        return (
          <div
            key={s.job_type}
            style={{
              padding: "0.45rem 0.5rem",
              marginBottom: 4,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              fontSize: "0.8rem",
            }}
          >
            <div style={{ fontWeight: 600 }}>{title}</div>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                marginTop: "0.35rem",
                cursor: canToggle ? "pointer" : "not-allowed",
                opacity: canToggle ? 1 : 0.55,
              }}
            >
              <input
                type="checkbox"
                checked={s.is_active}
                disabled={!canToggle}
                onChange={(e) =>
                  toggleM.mutate({ jobType: s.job_type, is_active: e.target.checked })}
              />
              Aktiv
            </label>
          </div>
        );
      })}
      <Link
        to="/settings/schedules"
        style={{
          display: "block",
          marginTop: "0.5rem",
          fontSize: "0.78rem",
          color: "var(--link)",
          padding: "0.25rem 0.5rem",
        }}
      >
        Neuen Job anlegen →
      </Link>
    </div>
  );
}
