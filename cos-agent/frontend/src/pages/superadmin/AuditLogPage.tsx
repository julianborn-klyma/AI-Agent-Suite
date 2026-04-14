import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../../lib/api.ts";

type AuditRow = {
  id: string;
  action: string;
  user_id: string | null;
  tenant_id: string | null;
  ip_address: string | null;
  success: boolean;
  created_at: string;
};

type TenantOpt = { id: string; name: string; slug: string };

export function AuditLogPage() {
  const [tenantId, setTenantId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const tenantsQ = useQuery({
    queryKey: ["superadmin", "tenants"],
    queryFn: () => api.get<TenantOpt[]>("/api/superadmin/tenants"),
  });

  const tenantNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tenantsQ.data ?? []) {
      m.set(t.id, `${t.name} (${t.slug})`);
    }
    return m;
  }, [tenantsQ.data]);

  const auditQ = useQuery({
    queryKey: ["superadmin", "audit-global", tenantId, action, from, to],
    queryFn: () => {
      const p = new URLSearchParams();
      if (tenantId.trim()) p.set("tenant_id", tenantId.trim());
      if (action.trim()) p.set("action", action.trim());
      if (from.trim()) p.set("from", from.trim());
      if (to.trim()) p.set("to", to.trim());
      p.set("limit", "100");
      return api.get<AuditRow[]>(`/api/superadmin/audit-log?${p.toString()}`);
    },
  });

  return (
    <div>
      <h1 style={{ marginTop: 0, fontSize: "1.35rem" }}>Audit Log</h1>
      <p style={{ opacity: 0.8, fontSize: "0.9rem", maxWidth: 640 }}>
        Alle Mandanten — filterbar nach Tenant, Aktion und Zeitraum.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1.25rem",
          alignItems: "flex-end",
        }}
      >
        <label>
          <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>Tenant</span>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            style={{ display: "block", marginTop: "0.2rem", padding: "0.4rem", minWidth: 200 }}
          >
            <option value="">Alle</option>
            {(tenantsQ.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.slug}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>Aktion</span>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="z. B. tenant.update"
            style={{ display: "block", marginTop: "0.2rem", padding: "0.4rem" }}
          />
        </label>
        <label>
          <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>Von</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ display: "block", marginTop: "0.2rem", padding: "0.4rem" }}
          />
        </label>
        <label>
          <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>Bis</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ display: "block", marginTop: "0.2rem", padding: "0.4rem" }}
          />
        </label>
      </div>

      {auditQ.isError && (
        <p style={{ color: "#f87171" }}>
          {auditQ.error instanceof Error ? auditQ.error.message : "Fehler"}
        </p>
      )}

      <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <th style={{ padding: "0.5rem 0.65rem" }}>Zeitpunkt</th>
              <th style={{ padding: "0.5rem 0.65rem" }}>Tenant</th>
              <th style={{ padding: "0.5rem 0.65rem" }}>User</th>
              <th style={{ padding: "0.5rem 0.65rem" }}>Aktion</th>
              <th style={{ padding: "0.5rem 0.65rem" }}>IP</th>
              <th style={{ padding: "0.5rem 0.65rem" }}>Erfolg</th>
            </tr>
          </thead>
          <tbody>
            {(auditQ.data ?? []).map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={{ padding: "0.45rem 0.65rem" }}>{r.created_at}</td>
                <td style={{ padding: "0.45rem 0.65rem" }}>
                  {r.tenant_id
                    ? (tenantNameById.get(r.tenant_id) ?? r.tenant_id)
                    : "—"}
                </td>
                <td style={{ padding: "0.45rem 0.65rem" }}>{r.user_id ?? "—"}</td>
                <td style={{ padding: "0.45rem 0.65rem" }}>{r.action}</td>
                <td style={{ padding: "0.45rem 0.65rem" }}>{r.ip_address ?? "—"}</td>
                <td style={{ padding: "0.45rem 0.65rem" }}>
                  {r.success ? (
                    <span style={{ color: "#4ade80" }}>ja</span>
                  ) : (
                    <span style={{ color: "#f87171" }}>nein</span>
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
