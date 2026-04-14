import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../lib/api.ts";

type ScheduleRow = {
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

type ConnectionsStatus = {
  google: boolean;
  slack: boolean;
  drive_folder_id?: string;
};

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "1.25rem",
  marginBottom: "1rem",
  maxWidth: 560,
};

const CRON_HINT: Record<string, string> = {
  daily_briefing: "Mo–Fr um 7:00 (Europe/Berlin, Cron)",
  email_categorization: "Mo–Fr um 8:00",
  slack_digest: "Mo–Fr um 18:00",
  drive_sync: "Täglich um 6:00",
  weekly_consolidator: "Sonntag um 18:00",
};

function parseErr(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Fehler";
}

function depBlock(
  jobType: string,
  c: ConnectionsStatus | undefined,
): { ok: boolean; message: string } {
  if (!c) return { ok: false, message: "Lade Verbindungen…" };
  if (jobType === "email_categorization" && !c.google) {
    return { ok: false, message: "Google nicht verbunden." };
  }
  if (jobType === "slack_digest" && !c.slack) {
    return { ok: false, message: "Slack nicht verbunden." };
  }
  if (jobType === "drive_sync") {
    if (!c.google) return { ok: false, message: "Google nicht verbunden." };
    const fid = c.drive_folder_id?.trim() ?? "";
    if (!fid) return { ok: false, message: "Drive-Ordner-ID fehlt." };
  }
  return { ok: true, message: "" };
}

export function SettingsSchedulesPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState<string | null>(null);

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

  async function runNow(jobType: string) {
    setRunBusy(jobType);
    setToast(null);
    try {
      await api.post<{ started: boolean }>(
        `/api/schedules/${jobType}/run-now`,
        {},
      );
      setToast("Job gestartet — läuft im Hintergrund.");
    } catch (e) {
      setToast(parseErr(e));
    } finally {
      setRunBusy(null);
    }
  }

  if (schedulesQ.isPending || connQ.isPending) {
    return <p style={{ color: "var(--muted)" }}>Laden…</p>;
  }
  if (schedulesQ.error) {
    return (
      <p style={{ color: "var(--danger)" }}>
        {schedulesQ.error instanceof Error
          ? schedulesQ.error.message
          : "Fehler"}
      </p>
    );
  }

  const rows = schedulesQ.data ?? [];
  const c = connQ.data;

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 className="co-font-display" style={{ marginTop: 0 }}>
        Jobs &amp; Automation
      </h2>
      <p style={{ color: "var(--muted)", marginTop: "-0.25rem" }}>
        Geplante Aufgaben pro Konto — aktivieren, Lieferweg prüfen, manuell starten.
      </p>

      {toast && (
        <div
          role="status"
          className="co-banner co-banner--success"
          style={{ marginBottom: "1rem" }}
        >
          {toast}
        </div>
      )}

      {rows.map((s) => {
        const dep = depBlock(s.job_type, c);
        const canToggle = dep.ok && !toggleM.isPending;
        const title = s.display_name ?? s.job_type;
        const desc = s.description ?? "";
        const hint = CRON_HINT[s.job_type] ?? s.cron_expression;
        const canRunNow =
          dep.ok &&
          (s.job_type === "daily_briefing" ||
            s.job_type === "email_categorization" ||
            s.job_type === "drive_sync");

        return (
          <div key={s.job_type} style={cardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div className="co-card-title">{title}</div>
                <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
                  {hint}
                </p>
                {desc && (
                  <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>{desc}</p>
                )}
              </div>
            </div>

            <div style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>
              <span style={{ color: "var(--muted)" }}>Lieferung: </span>
              <span>{s.delivery_channel}</span>
              <span style={{ color: "var(--muted)", marginLeft: "0.35rem" }}>
                {s.delivery_target}
              </span>
            </div>

            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              Zuletzt:{" "}
              {s.last_run
                ? `${s.last_run.slice(0, 16).replace("T", " ")}${
                  s.last_run_status ? ` (${s.last_run_status})` : ""
                }`
                : "—"}
            </div>

            {!dep.ok && (
              <p style={{ margin: "0.65rem 0 0", color: "var(--danger)", fontSize: "0.9rem" }}>
                {dep.message}{" "}
                <Link to="/settings/connections" style={{ color: "var(--accent)" }}>
                  Zu Verbindungen
                </Link>
              </p>
            )}

            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              {canRunNow && (
                <button
                  type="button"
                  disabled={runBusy === s.job_type}
                  onClick={() => void runNow(s.job_type)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    cursor: runBusy === s.job_type ? "wait" : "pointer",
                  }}
                >
                  {runBusy === s.job_type ? "…" : "Jetzt starten"}
                </button>
              )}
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.9rem",
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
          </div>
        );
      })}
    </div>
  );
}
