import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.ts";
import {
  formatCost,
  formatModelName,
  formatTokens,
  getModelColor,
} from "../../lib/formatters.ts";

type CostUserRow = {
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  total_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

type CostModelRow = {
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

type CostsResponse = {
  by_user: CostUserRow[];
  by_model: CostModelRow[];
  totals: {
    total_calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
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

function startOfWeekMonday(ref: Date): Date {
  const d = startOfLocalDay(new Date(ref));
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function startOfMonth(ref: Date): Date {
  return startOfLocalDay(new Date(ref.getFullYear(), ref.getMonth(), 1));
}

function initialMonthRange(): { fromYmd: string; toYmd: string } {
  const now = new Date();
  return {
    fromYmd: formatLocalYmd(startOfMonth(now)),
    toYmd: formatLocalYmd(now),
  };
}

type UserSortKey = "cost" | "calls" | "input" | "output" | "name";

export function CostsPage() {
  const [{ fromYmd, toYmd }, setRange] = useState(initialMonthRange);
  const [draftFrom, setDraftFrom] = useState(fromYmd);
  const [draftTo, setDraftTo] = useState(toYmd);
  const [userSort, setUserSort] = useState<{
    key: UserSortKey;
    dir: "asc" | "desc";
  }>({ key: "cost", dir: "desc" });

  const applyRange = useCallback(() => {
    setRange({ fromYmd: draftFrom, toYmd: draftTo });
  }, [draftFrom, draftTo]);

  const fromDate = parseYmd(fromYmd);
  const toDate = parseYmd(toYmd);
  const queryFromIso = fromDate ? startOfLocalDay(fromDate).toISOString() : "";
  const queryToIso = toDate ? endOfLocalDay(toDate).toISOString() : "";

  const q = useQuery({
    queryKey: ["admin", "costs", queryFromIso, queryToIso],
    enabled: Boolean(queryFromIso && queryToIso),
    queryFn: () =>
      api.get<CostsResponse>(
        `/api/admin/costs?from=${encodeURIComponent(queryFromIso)}&to=${encodeURIComponent(queryToIso)}`,
      ),
  });

  const totalCost = q.data?.totals.cost_usd ?? 0;

  const sortedUsers = useMemo(() => {
    const rows = [...(q.data?.by_user ?? [])];
    const dir = userSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (userSort.key) {
        case "calls":
          return (a.total_calls - b.total_calls) * dir;
        case "input":
          return (a.input_tokens - b.input_tokens) * dir;
        case "output":
          return (a.output_tokens - b.output_tokens) * dir;
        case "name": {
          const an = (a.user_name ?? a.user_email ?? a.user_id).toLowerCase();
          const bn = (b.user_name ?? b.user_email ?? b.user_id).toLowerCase();
          return an.localeCompare(bn, "de") * dir;
        }
        case "cost":
        default:
          return (a.cost_usd - b.cost_usd) * dir;
      }
    });
    return rows;
  }, [q.data?.by_user, userSort]);

  const toggleSort = (key: UserSortKey) => {
    setUserSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  };

  const sortIndicator = (key: UserSortKey) =>
    userSort.key === key ? (userSort.dir === "desc" ? " ▼" : " ▲") : "";

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

  return (
    <div className="co-admin-page">
      <h2 className="co-admin-h2">Kosten</h2>
      <p className="co-admin-lead">
        LLM-Nutzung und Kosten für deinen Mandanten (Zeitraum lokal, Anfrage als ISO-UTC).
      </p>

      <section className="co-card" style={{ marginBottom: "1.25rem" }}>
        <div className="co-card-head" style={{ marginBottom: "0.65rem" }}>
          <span className="co-badge">Zeitraum</span>
        </div>
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
            <label className="co-field-label" htmlFor="cost-from">
              Von
            </label>
            <input
              id="cost-from"
              className="co-input"
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              style={{ width: "auto", minWidth: "11rem" }}
            />
          </div>
          <div>
            <label className="co-field-label" htmlFor="cost-to">
              Bis
            </label>
            <input
              id="cost-to"
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
            const firstPrev = startOfMonth(lastPrev);
            const f = formatLocalYmd(startOfLocalDay(firstPrev));
            const t = formatLocalYmd(endOfLocalDay(lastPrev));
            setDraftFrom(f);
            setDraftTo(t);
            setRange({ fromYmd: f, toYmd: t });
          })}
        </div>
      </section>

      {q.isPending && <p className="co-muted">Laden…</p>}
      {q.error && (
        <p style={{ color: "var(--danger)" }}>
          {q.error instanceof Error ? q.error.message : "Fehler"}
        </p>
      )}

      {q.data && (
        <>
          <h3 className="co-admin-h2" style={{ fontSize: "1.05rem", marginBottom: "0.65rem" }}>
            Übersicht
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1.5rem",
            }}
          >
            {[
              { label: "Gesamt-Calls", value: String(q.data.totals.total_calls) },
              { label: "Input-Tokens", value: formatTokens(q.data.totals.input_tokens) },
              { label: "Output-Tokens", value: formatTokens(q.data.totals.output_tokens) },
              { label: "Gesamt-Kosten", value: formatCost(q.data.totals.cost_usd) },
            ].map((c) => (
              <div
                key={c.label}
                className="co-card"
                style={{ marginBottom: 0, padding: "1rem" }}
              >
                <div className="co-field-label" style={{ marginBottom: "0.35rem" }}>
                  {c.label}
                </div>
                <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>

          <h3 className="co-admin-h2" style={{ fontSize: "1.05rem", marginBottom: "0.65rem" }}>
            Kosten nach Modell
          </h3>
          <div className="co-card" style={{ marginBottom: "1.5rem" }}>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {(q.data.by_model ?? []).map((row) => {
                const pct = totalCost > 0
                  ? Math.round((row.cost_usd / totalCost) * 1000) / 10
                  : 0;
                const barPct = totalCost > 0 ? (row.cost_usd / totalCost) * 100 : 0;
                const color = getModelColor(row.model);
                return (
                  <li
                    key={row.model}
                    style={{
                      marginBottom: "0.85rem",
                      display: "grid",
                      gap: "0.35rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                        fontSize: "0.9rem",
                      }}
                    >
                      <strong>{formatModelName(row.model)}</strong>
                      <span className="co-muted">
                        {row.calls} Calls · {formatCost(row.cost_usd)} · ({pct}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 6,
                        background: "var(--surface-2)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, barPct)}%`,
                          height: "100%",
                          background: color,
                          borderRadius: 6,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            {(q.data.by_model ?? []).length === 0 && (
              <p className="co-muted" style={{ margin: 0 }}>
                Keine Aufrufe im Zeitraum.
              </p>
            )}
          </div>

          <h3 className="co-admin-h2" style={{ fontSize: "1.05rem", marginBottom: "0.65rem" }}>
            Kosten nach User
          </h3>
          <div className="co-table-wrap">
            <table className="co-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="co-btn co-btn--ghost"
                      style={{ fontSize: "0.75rem", padding: "0.15rem 0.35rem" }}
                      onClick={() => toggleSort("name")}
                    >
                      User{sortIndicator("name")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="co-btn co-btn--ghost"
                      style={{ fontSize: "0.75rem", padding: "0.15rem 0.35rem" }}
                      onClick={() => toggleSort("calls")}
                    >
                      Calls{sortIndicator("calls")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="co-btn co-btn--ghost"
                      style={{ fontSize: "0.75rem", padding: "0.15rem 0.35rem" }}
                      onClick={() => toggleSort("input")}
                    >
                      Input{sortIndicator("input")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="co-btn co-btn--ghost"
                      style={{ fontSize: "0.75rem", padding: "0.15rem 0.35rem" }}
                      onClick={() => toggleSort("output")}
                    >
                      Output{sortIndicator("output")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="co-btn co-btn--ghost"
                      style={{ fontSize: "0.75rem", padding: "0.15rem 0.35rem" }}
                      onClick={() => toggleSort("cost")}
                    >
                      Kosten{sortIndicator("cost")}
                    </button>
                  </th>
                  <th>% Anteil</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((r) => {
                  const pct = totalCost > 0
                    ? Math.round((r.cost_usd / totalCost) * 1000) / 10
                    : 0;
                  return (
                    <tr key={r.user_id}>
                      <td>
                        <Link
                          to={`/admin/users/${r.user_id}`}
                          style={{ fontWeight: 600, color: "var(--link)" }}
                        >
                          {r.user_name ?? r.user_id}
                        </Link>
                        <div
                          className="co-muted"
                          style={{ fontSize: "0.8rem", marginTop: "0.15rem" }}
                        >
                          {r.user_email ?? ""}
                        </div>
                      </td>
                      <td>{r.total_calls}</td>
                      <td>{formatTokens(r.input_tokens)}</td>
                      <td>{formatTokens(r.output_tokens)}</td>
                      <td>{formatCost(r.cost_usd)}</td>
                      <td>{pct}%</td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: 700 }}>
                  <td>Summe</td>
                  <td>{q.data.totals.total_calls}</td>
                  <td>{formatTokens(q.data.totals.input_tokens)}</td>
                  <td>{formatTokens(q.data.totals.output_tokens)}</td>
                  <td>{formatCost(q.data.totals.cost_usd)}</td>
                  <td>{totalCost > 0 ? "100%" : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
