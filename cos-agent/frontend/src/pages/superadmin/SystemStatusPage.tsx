import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";
import {
  formatCost,
  formatModelName,
  formatTokens,
  getModelColor,
} from "../../lib/formatters.ts";

type StatusPayload = {
  total_tenants: number;
  active_tenants: number;
  total_users: number;
  llm_costs_30d: {
    total_usd: number;
    by_model: {
      model: string;
      calls: number;
      cost_usd: number;
      input_tokens?: number;
      output_tokens?: number;
    }[];
  };
};

type SuperCostsPayload = {
  by_tenant: {
    tenant_id: string;
    tenant_name: string;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }[];
  by_model: {
    model: string;
    calls: number;
    input_tokens?: number;
    output_tokens?: number;
    cost_usd: number;
  }[];
  totals: { calls: number; cost_usd: number };
};

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) {
    return null;
  }
  return dt;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function startOfMonth(ref: Date): Date {
  return startOfLocalDay(new Date(ref.getFullYear(), ref.getMonth(), 1));
}

function startOfWeekMonday(ref: Date): Date {
  const d = startOfLocalDay(new Date(ref));
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function initialMonthRange(): { fromYmd: string; toYmd: string } {
  const now = new Date();
  return {
    fromYmd: formatLocalYmd(startOfMonth(now)),
    toYmd: formatLocalYmd(now),
  };
}

export function SystemStatusPage() {
  const [{ fromYmd, toYmd }, setRange] = useState(initialMonthRange);
  const [draftFrom, setDraftFrom] = useState(fromYmd);
  const [draftTo, setDraftTo] = useState(toYmd);

  const applyRange = useCallback(() => {
    setRange({ fromYmd: draftFrom, toYmd: draftTo });
  }, [draftFrom, draftTo]);

  const fromDate = parseYmd(fromYmd);
  const toDate = parseYmd(toYmd);
  const queryFromIso = fromDate ? startOfLocalDay(fromDate).toISOString() : "";
  const queryToIso = toDate ? endOfLocalDay(toDate).toISOString() : "";

  const q = useQuery({
    queryKey: ["superadmin", "status"],
    queryFn: () => api.get<StatusPayload>("/api/superadmin/status"),
  });

  const costsQ = useQuery({
    queryKey: ["superadmin", "costs", queryFromIso, queryToIso],
    enabled: Boolean(queryFromIso && queryToIso),
    queryFn: () =>
      api.get<SuperCostsPayload>(
        `/api/superadmin/costs?from=${encodeURIComponent(queryFromIso)}&to=${encodeURIComponent(queryToIso)}`,
      ),
  });

  const data = q.data;
  const costPayload = costsQ.data;
  const byModelStatus = data?.llm_costs_30d.by_model ?? [];
  const byModelRange = costPayload?.by_model ?? [];
  const byTenant = costPayload?.by_tenant ?? [];
  const tenantTotalUsd = costPayload?.totals.cost_usd ?? 0;
  const maxTenantCost = Math.max(...byTenant.map((t) => t.cost_usd), 0.0001);

  const shortcut = (label: string, fn: () => void) => (
    <button
      type="button"
      className="co-btn co-btn--ghost"
      style={{ fontSize: "0.8rem", padding: "0.35rem 0.65rem" }}
      onClick={fn}
    >
      {label}
    </button>
  );

  const statusMaxCost = useMemo(
    () => Math.max(...byModelStatus.map((b) => b.cost_usd), 0.0001),
    [byModelStatus],
  );

  return (
    <div>
      <h1 style={{ marginTop: 0, fontSize: "1.35rem" }}>System Status</h1>
      {q.isError && (
        <p style={{ color: "#f87171" }}>
          {q.error instanceof Error ? q.error.message : "Fehler"}
        </p>
      )}
      {!data && !q.isError && <p style={{ opacity: 0.8 }}>Laden…</p>}
      {data && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "0.85rem",
              marginBottom: "1.75rem",
            }}
          >
            {[
              { label: "Aktive Tenants", value: data.active_tenants },
              { label: "Gesamt Tenants", value: data.total_tenants },
              { label: "Gesamt User", value: data.total_users },
              {
                label: "Kosten 30 Tage (USD)",
                value: formatCost(data.llm_costs_30d.total_usd),
              },
            ].map((c) => (
              <div
                key={c.label}
                style={{
                  padding: "1rem",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <div style={{ fontSize: "0.75rem", opacity: 0.75, marginBottom: "0.35rem" }}>
                  {c.label}
                </div>
                <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>

          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.75rem" }}>
            Modell-Aufschlüsselung (letzte 30 Tage, Status-API)
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.25rem" }}>
            {byModelStatus.map((b) => (
              <li key={b.model} style={{ marginBottom: "0.35rem" }}>
                <strong>{formatModelName(b.model)}</strong>: {b.calls} Calls —{" "}
                {formatCost(b.cost_usd)}
              </li>
            ))}
            {byModelStatus.length === 0 && (
              <li style={{ opacity: 0.75 }}>Keine LLM-Aufrufe im Zeitraum.</li>
            )}
          </ul>

          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>
            Kosten nach Modell (relativ, 30 Tage)
          </h2>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "0.65rem",
              height: 140,
              padding: "0.5rem 0",
              marginBottom: "1.75rem",
            }}
          >
            {byModelStatus.map((b) => {
              const h = Math.round((b.cost_usd / statusMaxCost) * 100);
              const color = getModelColor(b.model);
              return (
                <div
                  key={b.model}
                  style={{
                    flex: 1,
                    minWidth: 36,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.35rem",
                  }}
                  title={`${b.model}: ${formatCost(b.cost_usd)}`}
                >
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 48,
                      height: `${Math.max(h, 4)}%`,
                      background: `linear-gradient(180deg, ${color}aa, ${color})`,
                      borderRadius: "6px 6px 0 0",
                      minHeight: 4,
                    }}
                  />
                  <span style={{ fontSize: "0.65rem", opacity: 0.8, textAlign: "center" }}>
                    {formatModelName(b.model)}
                  </span>
                </div>
              );
            })}
          </div>

          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.65rem" }}>
            Kosten nach Mandant (Superadmin)
          </h2>
          <p style={{ opacity: 0.8, fontSize: "0.88rem", marginTop: 0 }}>
            Zeitraum für Mandanten- und Modell-Summen (GET /api/superadmin/costs).
          </p>

          <div
            className="co-card"
            style={{
              marginBottom: "1rem",
              background: "rgba(255,255,255,0.04)",
              borderColor: "rgba(255,255,255,0.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                alignItems: "flex-end",
                marginBottom: "0.75rem",
              }}
            >
              <div>
                <label className="co-field-label" htmlFor="sa-cost-from">
                  Von
                </label>
                <input
                  id="sa-cost-from"
                  className="co-input"
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  style={{ width: "auto", minWidth: "11rem" }}
                />
              </div>
              <div>
                <label className="co-field-label" htmlFor="sa-cost-to">
                  Bis
                </label>
                <input
                  id="sa-cost-to"
                  className="co-input"
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  style={{ width: "auto", minWidth: "11rem" }}
                />
              </div>
              <button type="button" className="co-btn co-btn--primary" onClick={applyRange}>
                Laden
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {shortcut("Heute", () => {
                const t = new Date();
                const y = formatLocalYmd(t);
                setDraftFrom(y);
                setDraftTo(y);
                setRange({ fromYmd: y, toYmd: y });
              })}
              {shortcut("Diese Woche", () => {
                const now = new Date();
                const a = startOfWeekMonday(now);
                const b = endOfLocalDay(now);
                const f = formatLocalYmd(a);
                const t = formatLocalYmd(b);
                setDraftFrom(f);
                setDraftTo(t);
                setRange({ fromYmd: f, toYmd: t });
              })}
              {shortcut("Dieser Monat", () => {
                const now = new Date();
                const a = startOfMonth(now);
                const b = endOfLocalDay(now);
                const f = formatLocalYmd(a);
                const t = formatLocalYmd(b);
                setDraftFrom(f);
                setDraftTo(t);
                setRange({ fromYmd: f, toYmd: t });
              })}
              {shortcut("Letzter Monat", () => {
                const now = new Date();
                const firstThis = startOfMonth(now);
                const lastPrev = new Date(firstThis);
                lastPrev.setDate(0);
                const firstPrev = startOfLocalDay(
                  new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1),
                );
                const f = formatLocalYmd(firstPrev);
                const t = formatLocalYmd(endOfLocalDay(lastPrev));
                setDraftFrom(f);
                setDraftTo(t);
                setRange({ fromYmd: f, toYmd: t });
              })}
            </div>
          </div>

          {costsQ.isPending && <p style={{ opacity: 0.75 }}>Kosten laden…</p>}
          {costsQ.isError && (
            <p style={{ color: "#f87171" }}>
              {costsQ.error instanceof Error ? costsQ.error.message : "Fehler"}
            </p>
          )}

          {costPayload && (
            <>
              <div className="co-table-wrap" style={{ marginBottom: "1.25rem" }}>
                <table className="co-table">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Calls</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Kosten</th>
                      <th>Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byTenant.map((row) => {
                      const pct = tenantTotalUsd > 0
                        ? Math.round((row.cost_usd / tenantTotalUsd) * 1000) / 10
                        : 0;
                      const w = Math.round((row.cost_usd / maxTenantCost) * 100);
                      return (
                        <tr key={row.tenant_id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{row.tenant_name}</div>
                            <div
                              style={{
                                marginTop: 6,
                                height: 8,
                                borderRadius: 4,
                                background: "rgba(255,255,255,0.08)",
                                overflow: "hidden",
                                maxWidth: 220,
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.min(100, w)}%`,
                                  height: "100%",
                                  background: "linear-gradient(90deg, #38bdf8, #2563eb)",
                                }}
                              />
                            </div>
                          </td>
                          <td>{row.calls}</td>
                          <td>{formatTokens(row.input_tokens)}</td>
                          <td>{formatTokens(row.output_tokens)}</td>
                          <td>{formatCost(row.cost_usd)}</td>
                          <td>{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {byTenant.length === 0 && (
                  <p style={{ opacity: 0.75, padding: "0.5rem 0" }}>Keine Kosten im Zeitraum.</p>
                )}
              </div>

              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
                Modell-Aufschlüsselung (gewählter Zeitraum, global)
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {byModelRange.map((b) => {
                  const pct = tenantTotalUsd > 0
                    ? Math.round((b.cost_usd / tenantTotalUsd) * 1000) / 10
                    : 0;
                  const barPct = tenantTotalUsd > 0 ? (b.cost_usd / tenantTotalUsd) * 100 : 0;
                  const color = getModelColor(b.model);
                  return (
                    <li
                      key={b.model}
                      style={{ marginBottom: "0.65rem", display: "grid", gap: "0.25rem" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                          fontSize: "0.88rem",
                        }}
                      >
                        <strong>{formatModelName(b.model)}</strong>
                        <span style={{ opacity: 0.85 }}>
                          {b.calls} Calls · {formatCost(b.cost_usd)} · ({pct}%)
                        </span>
                      </div>
                      <div
                        style={{
                          height: 8,
                          borderRadius: 4,
                          background: "rgba(255,255,255,0.08)",
                          overflow: "hidden",
                          maxWidth: 360,
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, barPct)}%`,
                            height: "100%",
                            background: color,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {byModelRange.length === 0 && (
                <p style={{ opacity: 0.75 }}>Keine Aufrufe im Zeitraum.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
