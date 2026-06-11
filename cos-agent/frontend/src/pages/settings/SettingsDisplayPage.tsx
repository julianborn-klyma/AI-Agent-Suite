import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../../hooks/useAuth.ts";
import { api } from "../../lib/api.ts";

export function SettingsDisplayPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const toggleM = useMutation({
    mutationFn: async (next: boolean) => {
      await api.patch("/api/admin/tenant/ui", { ui_show_tenant_wiki: next });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    },
  });

  if (!isAdmin) {
    return (
      <p style={{ color: "var(--muted)" }}>
        Nur Admins können die Tenant-Anzeige steuern.
      </p>
    );
  }

  const checked = user?.tenant_ui_show_tenant_wiki === true;

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 className="co-card-title" style={{ marginTop: 0 }}>
        Anzeige
      </h3>
      <label
        data-testid="tenant-wiki-toggle"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.65rem",
          padding: "1rem",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--surface)",
          cursor: toggleM.isPending ? "wait" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={toggleM.isPending}
          onChange={(e) => toggleM.mutate(e.target.checked)}
          style={{ marginTop: "0.2rem" }}
        />
        <span>
          <strong>Firmen-Handbuch für alle im Tenant anzeigen</strong>
          <span
            style={{
              display: "block",
              marginTop: "0.25rem",
              color: "var(--muted)",
              fontSize: "0.9rem",
            }}
          >
            Wenn aktiv, sehen alle Nutzer des Tenants den Wiki-Tab im Wissens-Hub.
            Standard ist aus.
          </span>
        </span>
      </label>
      {error ? (
        <p style={{ color: "var(--danger)", marginTop: "0.75rem" }}>{error}</p>
      ) : null}
    </div>
  );
}
