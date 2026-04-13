import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../lib/api.ts";

type CostRow = {
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  total_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

type CostsResponse = {
  by_user: CostRow[];
  totals: {
    total_calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function CostsPage() {
  const { from, to } = useMemo(() => {
    const toD = new Date();
    const fromD = new Date(toD);
    fromD.setUTCDate(fromD.getUTCDate() - 30);
    return { from: isoDate(fromD), to: isoDate(toD) };
  }, []);

  const q = useQuery({
    queryKey: ["admin", "costs", from, to],
    queryFn: () =>
      api.get<CostsResponse>(
        `/api/admin/costs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to + "T23:59:59.999Z")}`,
      ),
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
      <h2 className="co-admin-h2">Kosten</h2>
      <p className="co-admin-lead">
        Zeitraum: {from} — {to} (UTC)
      </p>
      <p style={{ fontSize: "0.92rem", marginBottom: "1rem" }}>
        Summen: <strong>{q.data?.totals.total_calls}</strong> Calls,{" "}
        <strong>{q.data?.totals.cost_usd.toFixed(4)}</strong> USD
      </p>
      <div className="co-table-wrap">
        <table className="co-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Calls</th>
              <th>Tokens in/out</th>
              <th>USD</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.by_user.map((r) => (
              <tr key={r.user_id}>
                <td>
                  {r.user_name ?? r.user_id}
                  <div className="co-muted" style={{ fontSize: "0.8rem", marginTop: "0.15rem" }}>
                    {r.user_email ?? ""}
                  </div>
                </td>
                <td>{r.total_calls}</td>
                <td>
                  {r.input_tokens} / {r.output_tokens}
                </td>
                <td>{r.cost_usd.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
