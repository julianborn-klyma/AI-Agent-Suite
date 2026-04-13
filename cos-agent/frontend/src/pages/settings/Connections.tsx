import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../../lib/api.ts";
import { getToken } from "../../lib/auth.ts";

type ConnectionsStatus = {
  google: boolean;
  notion: boolean;
  notionWorkspaceUser?: string;
};

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8090").replace(
  /\/+$/,
  "",
);

function parseErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const j = JSON.parse(err.message) as { error?: string };
      if (typeof j.error === "string") return j.error;
    } catch {
      /* ignore */
    }
    return err.message || `Fehler (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return "Unbekannter Fehler";
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "1.25rem",
  marginBottom: "1rem",
  maxWidth: 520,
};

export function ConnectionsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [banner, setBanner] = useState<
    { type: "success" | "error"; text: string } | null
  >(null);
  const [notionToken, setNotionToken] = useState("");

  const connectionsQ = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.get<ConnectionsStatus>("/api/connections"),
  });

  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");
    if (!connected && !err) return;

    if (connected === "google") {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
      setBanner({
        type: "success",
        text: "Google erfolgreich verbunden",
      });
    }
    if (err === "google_failed") {
      setBanner({
        type: "error",
        text: "Google Verbindung fehlgeschlagen. Bitte erneut versuchen.",
      });
    }

    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, queryClient]);

  const disconnectM = useMutation({
    mutationFn: (provider: "google" | "notion") =>
      api.delete<{ disconnected: boolean }>(`/api/connections/${provider}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const notionM = useMutation({
    mutationFn: (token: string) =>
      api.put<{ connected: boolean }>("/api/connections/notion", { token }),
    onSuccess: () => {
      setNotionToken("");
      setBanner({ type: "success", text: "Notion erfolgreich verbunden" });
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  function connectGoogle() {
    const t = getToken();
    if (!t) {
      setBanner({ type: "error", text: "Nicht angemeldet." });
      return;
    }
    window.location.href = `${API_BASE}/api/auth/google?token=${encodeURIComponent(t)}`;
  }

  function saveNotion() {
    const t = notionToken.trim();
    if (!t.startsWith("secret_")) {
      setBanner({
        type: "error",
        text: "Notion Internal Integration Token muss mit secret_ beginnen.",
      });
      return;
    }
    setBanner(null);
    notionM.mutate(t);
  }

  if (connectionsQ.isPending) {
    return <p style={{ color: "var(--muted)" }}>Laden…</p>;
  }
  if (connectionsQ.error) {
    return (
      <p style={{ color: "var(--danger)" }}>
        {parseErrorMessage(connectionsQ.error)}
      </p>
    );
  }

  const s = connectionsQ.data!;

  return (
    <div>
      <nav style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        <Link to="/settings" style={{ color: "var(--muted)" }}>
          Einstellungen
        </Link>
        <span style={{ color: "var(--muted)" }}> / </span>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Verbindungen</span>
      </nav>
      <h2 style={{ marginTop: 0 }} data-testid="connections-title">
        Verbindungen
      </h2>
      <p style={{ color: "var(--muted)", marginTop: "-0.25rem" }}>
        Verknüpfe externe Dienste für den Agenten. Notion: Internal-Token von{" "}
        <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
          my-integrations
        </a>{" "}
        unten einfügen und speichern.
      </p>

      {banner && (
        <div
          role="status"
          style={{
            marginBottom: "1rem",
            padding: "0.65rem 0.85rem",
            borderRadius: 8,
            fontSize: "0.9rem",
            background:
              banner.type === "success"
                ? "rgba(22, 163, 74, 0.12)"
                : "rgba(185, 28, 28, 0.1)",
            color: banner.type === "success" ? "#166534" : "var(--danger)",
            border: `1px solid ${
              banner.type === "success"
                ? "rgba(22, 163, 74, 0.35)"
                : "rgba(185, 28, 28, 0.25)"
            }`,
          }}
        >
          {banner.text}
        </div>
      )}

      {notionM.isError && (
        <p style={{ color: "var(--danger)", fontSize: "0.9rem" }}>
          {parseErrorMessage(notionM.error)}
        </p>
      )}

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
              Google (Gmail + Drive)
            </div>
            <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
              Zugriff auf E-Mails und Dokumente. Gmail-Triage, Drive-Dokumente lesen.
            </p>
            {s.google && (
              <div
                style={{
                  marginTop: "0.65rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.9rem",
                  color: "#166534",
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#22c55e",
                    display: "inline-block",
                  }}
                />
                Verbunden
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>
            {s.google ? (
              <button
                type="button"
                onClick={() => disconnectM.mutate("google")}
                disabled={disconnectM.isPending}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.35rem 0.6rem",
                  color: "var(--danger)",
                  border: "1px solid rgba(185, 28, 28, 0.35)",
                  background: "transparent",
                  borderRadius: 6,
                  cursor: disconnectM.isPending ? "wait" : "pointer",
                }}
              >
                Trennen
              </button>
            ) : (
              <button
                type="button"
                onClick={connectGoogle}
                style={{
                  padding: "0.45rem 0.85rem",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Verbinden
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Notion</div>
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
          Tasks und gesamter Workspace-Inhalt. Voller Zugriff via Internal Token.
        </p>
        {s.notion && (
          <div
            style={{
              marginTop: "0.65rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.9rem",
                color: "#166534",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#22c55e",
                  display: "inline-block",
                }}
              />
              Verbunden
              {s.notionWorkspaceUser && (
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  ({s.notionWorkspaceUser})
                </span>
              )}
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: "1rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            alignItems: "center",
          }}
        >
          <input
            id="notion-token"
            type="password"
            autoComplete="off"
            aria-label="Notion Internal Integration Token"
            placeholder="secret_…"
            value={notionToken}
            onChange={(e) => setNotionToken(e.target.value)}
            style={{
              flex: "1 1 200px",
              minWidth: 0,
              padding: "0.45rem 0.6rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.85rem",
            }}
          />
          <button
            type="button"
            onClick={saveNotion}
            disabled={notionM.isPending || !notionToken.trim()}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              cursor: notionM.isPending ? "wait" : "pointer",
              opacity: notionM.isPending || !notionToken.trim() ? 0.65 : 1,
            }}
          >
            {notionM.isPending ? "Prüfen…" : "Speichern"}
          </button>
        </div>
        <p style={{ margin: "0.65rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
          ℹ️{" "}
          <a
            href="https://www.notion.so/my-integrations"
            target="_blank"
            rel="noreferrer"
          >
            notion.so/my-integrations
          </a>
        </p>
        {s.notion && (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              onClick={() => disconnectM.mutate("notion")}
              disabled={disconnectM.isPending}
              style={{
                fontSize: "0.8rem",
                padding: "0.35rem 0.6rem",
                color: "var(--danger)",
                border: "1px solid rgba(185, 28, 28, 0.35)",
                background: "transparent",
                borderRadius: 6,
                cursor: disconnectM.isPending ? "wait" : "pointer",
              }}
            >
              Trennen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
