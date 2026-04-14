import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../../lib/api.ts";

type CredentialsConfigured = {
  slack: boolean;
  google: boolean;
  notion: boolean;
};

type TenantDetail = {
  id: string;
  name: string;
  slug: string;
  slack_client_id: string | null;
  google_client_id: string | null;
  notion_client_id: string | null;
  plan: string;
  is_active: boolean;
  admin_email: string | null;
  created_at: string;
  updated_at: string;
  user_count: number;
  credentials_configured: CredentialsConfigured;
};

type TenantUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  user_id: string | null;
  tenant_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: unknown;
  ip_address: string | null;
  success: boolean;
  created_at: string;
};

const tabBtn = (active: boolean): CSSProperties => ({
  padding: "0.45rem 0.85rem",
  borderRadius: 8,
  border: active ? "1px solid rgba(125,211,252,0.5)" : "1px solid transparent",
  background: active ? "rgba(125,211,252,0.12)" : "transparent",
  color: active ? "#e0f2fe" : "rgba(255,255,255,0.7)",
  cursor: "pointer",
  fontWeight: active ? 600 : 400,
});

function OauthCard({
  title,
  emoji,
  configured,
  guideTitle,
  guideBody,
  clientId,
  setClientId,
  clientSecret,
  setClientSecret,
  onSave,
  onDelete,
  saving,
}: {
  title: string;
  emoji: string;
  configured: boolean;
  guideTitle: string;
  guideBody: ReactNode;
  clientId: string;
  setClientId: (v: string) => void;
  clientSecret: string;
  setClientSecret: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: "1rem 1.15rem",
        marginBottom: "1rem",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>
          {emoji} {title}
        </div>
        <span
          style={{
            fontSize: "0.82rem",
            color: configured ? "#4ade80" : "#94a3b8",
          }}
        >
          {configured ? "✓ Konfiguriert" : "✗ Nicht konfiguriert"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          marginTop: "0.65rem",
          background: "transparent",
          border: "none",
          color: "#7dd3fc",
          cursor: "pointer",
          padding: 0,
          fontSize: "0.9rem",
        }}
      >
        {open ? "▼" : "▶"} 📋 Anleitung anzeigen
      </button>
      {open && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.85rem",
            borderRadius: 8,
            background: "rgba(0,0,0,0.25)",
            fontSize: "0.88rem",
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{guideTitle}</div>
          {guideBody}
        </div>
      )}
      <label style={{ display: "block", marginTop: "1rem", fontSize: "0.82rem" }}>
        Client ID
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            marginTop: "0.25rem",
            padding: "0.45rem",
            borderRadius: 6,
          }}
        />
      </label>
      <label style={{ display: "block", marginTop: "0.75rem", fontSize: "0.82rem" }}>
        Client Secret
        <input
          type="password"
          autoComplete="new-password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Aktuellen Wert überschreiben"
          style={{
            display: "block",
            width: "100%",
            marginTop: "0.25rem",
            padding: "0.45rem",
            borderRadius: 6,
          }}
        />
      </label>
      <p style={{ fontSize: "0.78rem", opacity: 0.75, marginTop: "0.35rem" }}>
        Aktueller Wert verborgen — neu eingeben zum Überschreiben
      </p>
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onDelete}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: 6,
            border: "1px solid rgba(248,113,113,0.45)",
            background: "transparent",
            color: "#fca5a5",
            cursor: "pointer",
          }}
        >
          Credentials löschen
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: 6,
            border: "none",
            background: "#2563eb",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "oauth" | "users" | "audit">("overview");

  const tq = useQuery({
    queryKey: ["superadmin", "tenant", id],
    queryFn: () => api.get<TenantDetail>(`/api/superadmin/tenants/${id}`),
    enabled: Boolean(id),
  });

  const [name, setName] = useState("");
  const [plan, setPlan] = useState("starter");
  const [adminEmail, setAdminEmail] = useState("");
  const [active, setActive] = useState(true);
  const [ovErr, setOvErr] = useState<string | null>(null);

  const tenant = tq.data;

  useEffect(() => {
    if (!tenant) return;
    setName(tenant.name);
    setPlan(tenant.plan);
    setAdminEmail(tenant.admin_email ?? "");
    setActive(tenant.is_active);
  }, [tenant?.id, tenant?.updated_at]);

  const patchM = useMutation({
    mutationFn: () =>
      api.patch<TenantDetail>(`/api/superadmin/tenants/${id}`, {
        name,
        plan,
        admin_email: adminEmail.trim() || null,
        is_active: active,
      }),
    onSuccess: async () => {
      setOvErr(null);
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenant", id] });
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenants"] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        try {
          const j = JSON.parse(e.message) as { error?: string };
          setOvErr(j.error ?? e.message);
        } catch {
          setOvErr(e.message);
        }
      } else setOvErr("Speichern fehlgeschlagen");
    },
  });

  const [gId, setGId] = useState("");
  const [gSec, setGSec] = useState("");
  const [sId, setSId] = useState("");
  const [sSec, setSSec] = useState("");
  const [nId, setNId] = useState("");
  const [nSec, setNSec] = useState("");
  const [oauthErr, setOauthErr] = useState<string | null>(null);

  const saveCred = useMutation({
    mutationFn: async (p: {
      path: string;
      body: { client_id: string; client_secret: string };
    }) => {
      await api.put(p.path, p.body);
    },
    onSuccess: async () => {
      setOauthErr(null);
      setGSec("");
      setSSec("");
      setNSec("");
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenant", id] });
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenants"] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        try {
          const j = JSON.parse(e.message) as { error?: string; hint?: string };
          setOauthErr([j.error, j.hint].filter(Boolean).join("\n"));
        } catch {
          setOauthErr(e.message);
        }
      } else setOauthErr("Fehler");
    },
  });

  const delCred = useMutation({
    mutationFn: (path: string) => api.delete(path),
    onSuccess: async () => {
      setOauthErr(null);
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenant", id] });
      await qc.invalidateQueries({ queryKey: ["superadmin", "tenants"] });
    },
    onError: (e: unknown) => {
      setOauthErr(e instanceof Error ? e.message : "Fehler");
    },
  });

  const usersQ = useQuery({
    queryKey: ["superadmin", "tenant-users", id],
    queryFn: () =>
      api.get<TenantUserRow[]>(`/api/superadmin/tenants/${id}/users`),
    enabled: Boolean(id) && tab === "users",
  });

  const [userModal, setUserModal] = useState(false);
  const [ue, setUe] = useState("");
  const [un, setUn] = useState("");
  const [ur, setUr] = useState("member");
  const [userErr, setUserErr] = useState<string | null>(null);
  const [pwModal, setPwModal] = useState<{ password: string } | null>(null);

  const createUserM = useMutation({
    mutationFn: () =>
      api.post<{ user: TenantUserRow; temporary_password: string }>(
        `/api/superadmin/tenants/${id}/users`,
        { email: ue, name: un, role: ur },
      ),
    onSuccess: (data) => {
      setUserErr(null);
      setUserModal(false);
      setUe("");
      setUn("");
      setUr("member");
      setPwModal({ password: data.temporary_password });
      void qc.invalidateQueries({ queryKey: ["superadmin", "tenant-users", id] });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        try {
          const j = JSON.parse(e.message) as { error?: string };
          setUserErr(j.error ?? e.message);
        } catch {
          setUserErr(e.message);
        }
      } else setUserErr("Fehler");
    },
  });

  const [auditAction, setAuditAction] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");

  const auditQ = useQuery({
    queryKey: ["superadmin", "tenant-audit", id, auditAction, auditFrom, auditTo],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("tenant_id", id!);
      if (auditAction.trim()) p.set("action", auditAction.trim());
      if (auditFrom.trim()) p.set("from", auditFrom.trim());
      if (auditTo.trim()) p.set("to", auditTo.trim());
      p.set("limit", "100");
      return api.get<AuditRow[]>(`/api/superadmin/audit-log?${p.toString()}`);
    },
    enabled: Boolean(id) && tab === "audit",
  });

  if (!id) {
    return <p>Fehlende Tenant-ID</p>;
  }

  if (tq.isError) {
    return (
      <p style={{ color: "#f87171" }}>
        {tq.error instanceof Error ? tq.error.message : "Fehler"}
      </p>
    );
  }

  if (!tenant) {
    return <p style={{ opacity: 0.8 }}>Laden…</p>;
  }

  return (
    <div>
      <Link to="/superadmin/tenants" style={{ color: "#7dd3fc", fontSize: "0.9rem" }}>
        ← Tenants
      </Link>
      <header style={{ marginTop: "0.75rem", marginBottom: "1.25rem" }}>
        <h1 style={{ margin: "0 0 0.35rem", fontSize: "1.35rem" }}>{tenant.name}</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ opacity: 0.85 }}>{tenant.slug}</span>
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.2rem 0.5rem",
              borderRadius: 6,
              background: "rgba(125,211,252,0.15)",
              color: "#bae6fd",
            }}
          >
            {tenant.plan}
          </span>
          <span style={{ fontSize: "0.85rem", color: tenant.is_active ? "#4ade80" : "#94a3b8" }}>
            {tenant.is_active ? "aktiv" : "inaktiv"}
          </span>
          <span style={{ fontSize: "0.82rem", opacity: 0.7 }}>
            {tenant.user_count} User
          </span>
        </div>
      </header>

      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <button type="button" style={tabBtn(tab === "overview")} onClick={() => setTab("overview")}>
          Übersicht
        </button>
        <button type="button" style={tabBtn(tab === "oauth")} onClick={() => setTab("oauth")}>
          OAuth Credentials
        </button>
        <button type="button" style={tabBtn(tab === "users")} onClick={() => setTab("users")}>
          User
        </button>
        <button type="button" style={tabBtn(tab === "audit")} onClick={() => setTab("audit")}>
          Audit Log
        </button>
      </div>

      {tab === "overview" && (
        <div style={{ maxWidth: 480 }}>
          {ovErr && <p style={{ color: "#fca5a5" }}>{ovErr}</p>}
          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.45rem" }}
            />
          </label>
          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            Plan
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.45rem" }}
            >
              <option value="starter">starter</option>
              <option value="pro">pro</option>
              <option value="enterprise">enterprise</option>
            </select>
          </label>
          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            Admin Email
            <input
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.45rem" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Aktiv
          </label>
          <button
            type="button"
            disabled={patchM.isPending}
            onClick={() => patchM.mutate()}
            style={{
              padding: "0.45rem 1rem",
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Speichern
          </button>
        </div>
      )}

      {tab === "oauth" && (
        <div>
          {oauthErr && (
            <pre
              style={{
                color: "#fca5a5",
                whiteSpace: "pre-wrap",
                fontSize: "0.85rem",
                marginBottom: "1rem",
              }}
            >
              {oauthErr}
            </pre>
          )}
          <OauthCard
            emoji="🔵"
            title="Google OAuth"
            configured={tenant.credentials_configured.google}
            guideTitle="📋 Google OAuth einrichten"
            guideBody={
              <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
                <li>console.cloud.google.com aufrufen</li>
                <li>Projekt auswählen oder neu erstellen</li>
                <li>APIs &amp; Dienste → Anmeldedaten</li>
                <li>+ Anmeldedaten erstellen → OAuth-Client-ID</li>
                <li>Anwendungstyp: Webanwendung</li>
                <li>
                  Autorisierte Weiterleitungs-URIs:{" "}
                  <code>https://[ihre-domain]/api/auth/google/callback</code>
                </li>
                <li>Erstellen → Client-ID + Secret kopieren</li>
              </ol>
            }
            clientId={gId || tenant.google_client_id || ""}
            setClientId={setGId}
            clientSecret={gSec}
            setClientSecret={setGSec}
            saving={saveCred.isPending}
            onSave={() => {
              const cid = (gId || tenant.google_client_id || "").trim();
              saveCred.mutate({
                path: `/api/superadmin/tenants/${id}/credentials/google`,
                body: { client_id: cid, client_secret: gSec },
              });
            }}
            onDelete={() => {
              if (confirm("Google-Credentials löschen?")) {
                delCred.mutate(`/api/superadmin/tenants/${id}/credentials/google`);
              }
            }}
          />
          <OauthCard
            emoji="💬"
            title="Slack OAuth"
            configured={tenant.credentials_configured.slack}
            guideTitle="📋 Slack OAuth App einrichten"
            guideBody={
              <>
                <ol style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem" }}>
                  <li>api.slack.com/apps aufrufen</li>
                  <li>&quot;Create New App&quot; → &quot;From scratch&quot;</li>
                  <li>App Name + Workspace auswählen</li>
                  <li>
                    OAuth &amp; Permissions → Redirect URLs:{" "}
                    <code>https://[ihre-domain]/api/auth/slack/callback</code>
                  </li>
                  <li>User Token Scopes: channels:history, groups:history, im:history, users:read, search:read</li>
                  <li>Basic Information → App Credentials → Client ID + Secret</li>
                </ol>
                <p style={{ margin: 0 }}>
                  ⚠️ Wichtig: User Token Scopes (nicht Bot). Jeder User verbindet seinen eigenen Account.
                </p>
              </>
            }
            clientId={sId || tenant.slack_client_id || ""}
            setClientId={setSId}
            clientSecret={sSec}
            setClientSecret={setSSec}
            saving={saveCred.isPending}
            onSave={() => {
              const cid = (sId || tenant.slack_client_id || "").trim();
              saveCred.mutate({
                path: `/api/superadmin/tenants/${id}/credentials/slack`,
                body: { client_id: cid, client_secret: sSec },
              });
            }}
            onDelete={() => {
              if (confirm("Slack-Credentials löschen?")) {
                delCred.mutate(`/api/superadmin/tenants/${id}/credentials/slack`);
              }
            }}
          />
          <OauthCard
            emoji="⬛"
            title="Notion Integration"
            configured={tenant.credentials_configured.notion}
            guideTitle="📋 Notion Integration"
            guideBody={
              <>
                <p>
                  ℹ️ Notion nutzt Internal Integration Tokens. Jeder User trägt seinen eigenen Token unter
                  Einstellungen → Verbindungen ein.
                </p>
                <p>
                  Diese Felder nur ausfüllen wenn ihr eine öffentliche Notion OAuth Integration plant
                  (fortgeschritten, normalerweise nicht nötig).
                </p>
                <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  <li>notion.so/my-integrations aufrufen</li>
                  <li>&quot;+ New integration&quot; → OAuth-Integration</li>
                  <li>Client ID + Secret kopieren</li>
                </ol>
              </>
            }
            clientId={nId || tenant.notion_client_id || ""}
            setClientId={setNId}
            clientSecret={nSec}
            setClientSecret={setNSec}
            saving={saveCred.isPending}
            onSave={() => {
              const cid = (nId || tenant.notion_client_id || "").trim();
              saveCred.mutate({
                path: `/api/superadmin/tenants/${id}/credentials/notion`,
                body: { client_id: cid, client_secret: nSec },
              });
            }}
            onDelete={() => {
              if (confirm("Notion-Credentials löschen?")) {
                delCred.mutate(`/api/superadmin/tenants/${id}/credentials/notion`);
              }
            }}
          />
        </div>
      )}

      {tab === "users" && (
        <div>
          <div style={{ marginBottom: "0.75rem" }}>
            <button
              type="button"
              onClick={() => {
                setUserErr(null);
                setUserModal(true);
              }}
              style={{
                padding: "0.4rem 0.85rem",
                borderRadius: 8,
                background: "#2563eb",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              + User hinzufügen
            </button>
          </div>
          <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.5rem 0.65rem" }}>Email</th>
                  <th style={{ padding: "0.5rem 0.65rem" }}>Name</th>
                  <th style={{ padding: "0.5rem 0.65rem" }}>Rolle</th>
                  <th style={{ padding: "0.5rem 0.65rem" }}>Status</th>
                  <th style={{ padding: "0.5rem 0.65rem" }}>Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {(usersQ.data ?? []).map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "0.45rem 0.65rem" }}>{u.email}</td>
                    <td style={{ padding: "0.45rem 0.65rem" }}>{u.name}</td>
                    <td style={{ padding: "0.45rem 0.65rem" }}>{u.role}</td>
                    <td style={{ padding: "0.45rem 0.65rem" }}>
                      {u.is_active ? "aktiv" : "inaktiv"}
                    </td>
                    <td style={{ padding: "0.45rem 0.65rem", fontSize: "0.82rem", opacity: 0.85 }}>
                      {u.created_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {userModal && (
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
              onMouseDown={(ev) => {
                if (ev.target === ev.currentTarget) setUserModal(false);
              }}
              role="presentation"
            >
              <div
                style={{
                  background: "#1e1e2f",
                  padding: "1.25rem",
                  borderRadius: 12,
                  width: "min(400px, 92vw)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <h3 style={{ marginTop: 0 }}>User anlegen</h3>
                {userErr && <p style={{ color: "#fca5a5" }}>{userErr}</p>}
                <label style={{ display: "block", marginBottom: "0.65rem" }}>
                  Email
                  <input
                    value={ue}
                    onChange={(e) => setUe(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.4rem" }}
                  />
                </label>
                <label style={{ display: "block", marginBottom: "0.65rem" }}>
                  Name
                  <input
                    value={un}
                    onChange={(e) => setUn(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.4rem" }}
                  />
                </label>
                <label style={{ display: "block", marginBottom: "0.85rem" }}>
                  Rolle
                  <select
                    value={ur}
                    onChange={(e) => setUr(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.4rem" }}
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setUserModal(false)}>Abbrechen</button>
                  <button
                    type="button"
                    disabled={createUserM.isPending}
                    onClick={() => createUserM.mutate()}
                  >
                    Anlegen
                  </button>
                </div>
              </div>
            </div>
          )}

          {pwModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 60,
              }}
              role="presentation"
              onMouseDown={(ev) => {
                if (ev.target === ev.currentTarget) setPwModal(null);
              }}
            >
              <div
                style={{
                  background: "#1e1e2f",
                  padding: "1.5rem",
                  borderRadius: 12,
                  maxWidth: 440,
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <h3 style={{ marginTop: 0 }}>✓ User angelegt</h3>
                <p style={{ fontSize: "0.9rem" }}>Temporäres Passwort (einmalig sichtbar):</p>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <code
                    style={{
                      flex: 1,
                      padding: "0.5rem",
                      background: "rgba(0,0,0,0.35)",
                      borderRadius: 6,
                      wordBreak: "break-all",
                    }}
                  >
                    {pwModal.password}
                  </code>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(pwModal.password)}
                  >
                    Kopieren
                  </button>
                </div>
                <p style={{ fontSize: "0.82rem", opacity: 0.85, marginTop: "0.75rem" }}>
                  ⚠️ Dieses Passwort wird nur einmal angezeigt. Bitte teile es sicher mit dem User.
                  Der User muss es beim ersten Login ändern.
                </p>
                <button
                  type="button"
                  style={{ marginTop: "1rem" }}
                  onClick={() => setPwModal(null)}
                >
                  Schließen
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "audit" && (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.65rem", marginBottom: "1rem" }}>
            <label>
              Aktion
              <input
                value={auditAction}
                onChange={(e) => setAuditAction(e.target.value)}
                placeholder="z. B. tenant.update"
                style={{ display: "block", marginTop: "0.2rem", padding: "0.35rem" }}
              />
            </label>
            <label>
              Von (ISO)
              <input
                value={auditFrom}
                onChange={(e) => setAuditFrom(e.target.value)}
                style={{ display: "block", marginTop: "0.2rem", padding: "0.35rem" }}
              />
            </label>
            <label>
              Bis (ISO)
              <input
                value={auditTo}
                onChange={(e) => setAuditTo(e.target.value)}
                style={{ display: "block", marginTop: "0.2rem", padding: "0.35rem" }}
              />
            </label>
          </div>
          <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "0.45rem 0.55rem" }}>Zeitpunkt</th>
                  <th style={{ padding: "0.45rem 0.55rem" }}>Aktion</th>
                  <th style={{ padding: "0.45rem 0.55rem" }}>User</th>
                  <th style={{ padding: "0.45rem 0.55rem" }}>IP</th>
                  <th style={{ padding: "0.45rem 0.55rem" }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {(auditQ.data ?? []).map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "0.4rem 0.55rem" }}>{r.created_at}</td>
                    <td style={{ padding: "0.4rem 0.55rem" }}>{r.action}</td>
                    <td style={{ padding: "0.4rem 0.55rem" }}>{r.user_id ?? "—"}</td>
                    <td style={{ padding: "0.4rem 0.55rem" }}>{r.ip_address ?? "—"}</td>
                    <td style={{ padding: "0.4rem 0.55rem", maxWidth: 280, wordBreak: "break-word" }}>
                      {typeof r.metadata === "object" && r.metadata !== null
                        ? JSON.stringify(r.metadata)
                        : String(r.metadata ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
