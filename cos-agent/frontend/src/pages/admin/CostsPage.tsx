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
      <h3 style={{ marginTop: 0 }}>Kosten</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
        Zeitraum: {from} — {to} (UTC)
      </p>
      <p style={{ fontSize: "0.9rem" }}>
        Summen: {q.data?.totals.total_calls} Calls,{" "}
        {q.data?.totals.cost_usd.toFixed(4)} USD
      </p>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.85rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          marginTop: "0.75rem",
        }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "0.45rem" }}>User</th>
            <th style={{ padding: "0.45rem" }}>Calls</th>
            <th style={{ padding: "0.45rem" }}>Tokens in/out</th>
            <th style={{ padding: "0.45rem" }}>USD</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.by_user.map((r) => (
            <tr key={r.user_id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "0.45rem" }}>
                {r.user_name ?? r.user_id}
                <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                  {r.user_email ?? ""}
                </div>
              </td>
              <td style={{ padding: "0.45rem" }}>{r.total_calls}</td>
              <td style={{ padding: "0.45rem" }}>
                {r.input_tokens} / {r.output_tokens}
              </td>
              <td style={{ padding: "0.45rem" }}>{r.cost_usd.toFixed(6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
