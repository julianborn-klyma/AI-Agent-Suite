import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../lib/api.ts";

type CredentialsConfigured = {
  slack: boolean;
  google: boolean;
  notion: boolean;
};

type TenantListRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  user_count: number;
  credentials_configured: CredentialsConfigured;
};

function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "tenant";
}

function CredIcons({ c }: { c: CredentialsConfigured }) {
  return (
    <span style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
      <span
        title="Google"
        style={{ color: c.google ? "#22c55e" : "rgba(148,163,184,0.5)" }}
      >
        🔵 G
      </span>
      <span
        title="Slack"
        style={{ color: c.slack ? "#22c55e" : "rgba(148,163,184,0.5)" }}
      >
        💬 S
      </span>
      <span
        title="Notion"
        style={{ color: c.notion ? "#22c55e" : "rgba(148,163,184,0.5)" }}
      >
        ⬛ N
      </span>
    </span>
  );
}

export function TenantsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["superadmin", "tenants"],
    queryFn: () => api.get<TenantListRow[]>("/api/superadmin/tenants"),
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [plan, setPlan] = useState("starter");
  const [adminEmail, setAdminEmail] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: () =>
      api.post<unknown>("/api/superadmin/tenants", {
        name,
        slug,
        plan,
        admin_email: adminEmail.trim() || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenants"] });
      setModalOpen(false);
      setName("");
      setSlug("");
      setSlugManual(false);
      setPlan("starter");
      setAdminEmail("");
      setFormErr(null);
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        try {
          const j = JSON.parse(e.message) as { error?: string };
          setFormErr(j.error ?? e.message);
        } catch {
          setFormErr(e.message);
        }
      } else setFormErr("Fehler beim Anlegen");
    },
  });

  const deactivateM = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/api/superadmin/tenants/${id}`, { is_active: false }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenants"] });
    },
  });

  function openModal() {
    setFormErr(null);
    setSlugManual(false);
    setModalOpen(true);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.25rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Tenants</h1>
        <button
          type="button"
          onClick={openModal}
          style={{
            padding: "0.45rem 0.9rem",
            borderRadius: 8,
            border: "none",
            background: "linear-gradient(135deg, #ff6b35, #c9184a)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Neuer Tenant
        </button>
      </div>

      {q.isError && (
        <p style={{ color: "#f87171" }}>
          {q.error instanceof Error ? q.error.message : "Laden fehlgeschlagen"}
        </p>
      )}

      <div
        style={{
          overflowX: "auto",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <th style={{ padding: "0.65rem 0.75rem" }}>Name</th>
              <th style={{ padding: "0.65rem 0.75rem" }}>Slug</th>
              <th style={{ padding: "0.65rem 0.75rem" }}>Plan</th>
              <th style={{ padding: "0.65rem 0.75rem" }}>User</th>
              <th style={{ padding: "0.65rem 0.75rem" }}>Credentials</th>
              <th style={{ padding: "0.65rem 0.75rem" }}>Status</th>
              <th style={{ padding: "0.65rem 0.75rem" }}>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((t) => (
              <tr
                key={t.id}
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <td style={{ padding: "0.55rem 0.75rem" }}>{t.name}</td>
                <td style={{ padding: "0.55rem 0.75rem", opacity: 0.85 }}>
                  {t.slug}
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{t.plan}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>{t.user_count}</td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  <CredIcons c={t.credentials_configured} />
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  {t.is_active ? (
                    <span style={{ color: "#4ade80" }}>aktiv</span>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>inaktiv</span>
                  )}
                </td>
                <td style={{ padding: "0.55rem 0.75rem" }}>
                  <Link
                    to={`/superadmin/tenants/${t.id}`}
                    style={{ color: "#7dd3fc", marginRight: "0.75rem" }}
                  >
                    Detail
                  </Link>
                  {t.is_active && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Tenant „${t.name}“ deaktivieren?`)) {
                          deactivateM.mutate(t.id);
                        }
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(248,113,113,0.5)",
                        color: "#fca5a5",
                        borderRadius: 6,
                        padding: "0.2rem 0.5rem",
                        cursor: "pointer",
                        fontSize: "0.82rem",
                      }}
                    >
                      Deaktivieren
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) setModalOpen(false);
          }}
        >
          <div
            style={{
              background: "#1e1e2f",
              color: "#eee",
              padding: "1.5rem",
              borderRadius: 12,
              width: "min(420px, 92vw)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Neuer Tenant</h2>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Name</div>
              <input
                value={name}
                onChange={(e) => {
                  const v = e.target.value;
                  setName(v);
                  if (!slugManual) setSlug(slugify(v));
                }}
                style={{ width: "100%", padding: "0.45rem", borderRadius: 6 }}
              />
            </label>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Slug</div>
              <input
                value={slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setSlug(e.target.value);
                }}
                style={{ width: "100%", padding: "0.45rem", borderRadius: 6 }}
              />
            </label>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Plan</div>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                style={{ width: "100%", padding: "0.45rem", borderRadius: 6 }}
              >
                <option value="starter">starter</option>
                <option value="pro">pro</option>
                <option value="enterprise">enterprise</option>
              </select>
            </label>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                Admin Email
              </div>
              <input
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                type="email"
                style={{ width: "100%", padding: "0.45rem", borderRadius: 6 }}
              />
            </label>
            {formErr && (
              <p style={{ color: "#fca5a5", fontSize: "0.88rem" }}>{formErr}</p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ padding: "0.4rem 0.75rem", borderRadius: 6 }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={createM.isPending}
                onClick={() => createM.mutate()}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: 6,
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Anlegen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
