import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api, API_URL } from "../../lib/api.ts";
import { getToken } from "../../lib/auth.ts";

type ConnectionsStatus = {
  google: boolean;
  notion: boolean;
  slack: boolean;
  notionWorkspaceUser?: string;
  drive_folder_id?: string;
  notion_database_id?: string;
};

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
  borderRadius: "var(--radius-lg)",
  padding: "1.25rem",
  marginBottom: "1rem",
  maxWidth: 520,
};

export function ConnectionsPanel() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [banner, setBanner] = useState<
    { type: "success" | "error"; text: string } | null
  >(null);
  const [notionToken, setNotionToken] = useState("");
  const [notionDbId, setNotionDbId] = useState("");
  const [driveFolderId, setDriveFolderId] = useState("");

  const connectionsQ = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.get<ConnectionsStatus>("/api/connections"),
  });

  useEffect(() => {
    const d = connectionsQ.data;
    if (!d) return;
    setDriveFolderId(d.drive_folder_id ?? "");
    setNotionDbId(d.notion_database_id ?? "");
  }, [connectionsQ.data]);

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
    if (connected === "slack") {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
      setBanner({
        type: "success",
        text: "Slack erfolgreich verbunden",
      });
    }
    if (err === "google_failed") {
      setBanner({
        type: "error",
        text: "Google Verbindung fehlgeschlagen. Bitte erneut versuchen.",
      });
    }
    if (err === "slack_failed") {
      setBanner({
        type: "error",
        text: "Slack Verbindung fehlgeschlagen. Bitte erneut versuchen.",
      });
    }

    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, queryClient]);

  const disconnectM = useMutation({
    mutationFn: (provider: "google" | "notion" | "slack") =>
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

  const driveFolderM = useMutation({
    mutationFn: (folder_id: string) =>
      api.put<{ saved: boolean }>("/api/connections/drive-folder", { folder_id }),
    onSuccess: () => {
      setBanner({ type: "success", text: "Drive-Ordner-ID gespeichert" });
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const notionDbM = useMutation({
    mutationFn: (database_id: string) =>
      api.put<{ saved: boolean }>("/api/connections/notion-database", { database_id }),
    onSuccess: () => {
      setBanner({ type: "success", text: "Notion-Datenbank-ID gespeichert" });
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  function connectGoogle() {
    const t = getToken();
    if (!t) {
      setBanner({ type: "error", text: "Nicht angemeldet." });
      return;
    }
    const base = API_URL || "";
    window.location.href = `${base}/api/auth/google?token=${encodeURIComponent(t)}`;
  }

  function connectSlack() {
    const t = getToken();
    if (!t) {
      setBanner({ type: "error", text: "Nicht angemeldet." });
      return;
    }
    const base = API_URL || "";
    window.location.href = `${base}/api/auth/slack?token=${encodeURIComponent(t)}`;
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

  function saveDriveFolder() {
    const id = driveFolderId.trim();
    if (!id) {
      setBanner({ type: "error", text: "Ordner-ID darf nicht leer sein." });
      return;
    }
    setBanner(null);
    driveFolderM.mutate(id);
  }

  function saveNotionDb() {
    const id = notionDbId.trim();
    if (!id) {
      setBanner({ type: "error", text: "Datenbank-ID darf nicht leer sein." });
      return;
    }
    setBanner(null);
    notionDbM.mutate(id);
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
      {banner && (
        <div
          role="status"
          className={`co-banner ${banner.type === "success" ? "co-banner--success" : "co-banner--error"}`}
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
            <div className="co-card-title">Google (Gmail + Drive + Kalender)</div>
            <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
              Zugriff auf E-Mails, Dokumente und Termine — für Briefings, Drive-Sync und
              Kalender.
            </p>
            {s.google && (
              <div className="co-connected-pill" style={{ marginTop: "0.65rem" }}>
                <span className="co-connected-pill-dot" />
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
                  border: "1px solid var(--danger-border)",
                  background: "transparent",
                  borderRadius: "var(--radius-md)",
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
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: "var(--co-btn-primary-bg)",
                  color: "var(--co-btn-primary-fg)",
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
        <div className="co-card-title">Notion</div>
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
          Voller Workspace-Zugriff via Internal Token. Datenbank-ID für Task-Tracking
          optional.
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
            <div className="co-connected-pill">
              <span className="co-connected-pill-dot" />
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
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
            }}
          />
          <button
            type="button"
            onClick={saveNotion}
            disabled={notionM.isPending || !notionToken.trim()}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "var(--co-btn-primary-bg)",
              color: "var(--co-btn-primary-fg)",
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

        <div style={{ marginTop: "1rem" }}>
          <label
            htmlFor="notion-db"
            style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.35rem" }}
          >
            Notion-Datenbank-ID (Tasks)
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="notion-db"
              type="text"
              autoComplete="off"
              placeholder="xxx…"
              value={notionDbId}
              onChange={(e) => setNotionDbId(e.target.value)}
              style={{
                flex: "1 1 200px",
                minWidth: 0,
                padding: "0.45rem 0.6rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.85rem",
              }}
            />
            <button
              type="button"
              onClick={saveNotionDb}
              disabled={notionDbM.isPending || !notionDbId.trim()}
              style={{
                padding: "0.45rem 0.85rem",
                borderRadius: "var(--radius-md)",
                border: "none",
                background: "var(--co-btn-primary-bg)",
                color: "var(--co-btn-primary-fg)",
                fontWeight: 600,
                cursor: notionDbM.isPending ? "wait" : "pointer",
                opacity: notionDbM.isPending || !notionDbId.trim() ? 0.65 : 1,
              }}
            >
              {notionDbM.isPending ? "…" : "Speichern"}
            </button>
          </div>
        </div>

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
                border: "1px solid var(--danger-border)",
                background: "transparent",
                borderRadius: "var(--radius-md)",
                cursor: disconnectM.isPending ? "wait" : "pointer",
              }}
            >
              Trennen
            </button>
          </div>
        )}
      </div>

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
            <div className="co-card-title">Slack</div>
            <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
              Liest Nachrichten in deinem Namen (OAuth). Für Digest-Jobs unter{" "}
              <Link to="/settings/schedules" style={{ color: "var(--link)" }}>
                Jobs &amp; Automation
              </Link>
              .
            </p>
            {s.slack && (
              <div className="co-connected-pill" style={{ marginTop: "0.65rem" }}>
                <span className="co-connected-pill-dot" />
                Verbunden
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>
            {s.slack ? (
              <button
                type="button"
                onClick={() => disconnectM.mutate("slack")}
                disabled={disconnectM.isPending}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.35rem 0.6rem",
                  color: "var(--danger)",
                  border: "1px solid var(--danger-border)",
                  background: "transparent",
                  borderRadius: "var(--radius-md)",
                  cursor: disconnectM.isPending ? "wait" : "pointer",
                }}
              >
                Trennen
              </button>
            ) : (
              <button
                type="button"
                onClick={connectSlack}
                style={{
                  padding: "0.45rem 0.85rem",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: "var(--co-btn-primary-bg)",
                  color: "var(--co-btn-primary-fg)",
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
        <div className="co-card-title">Google Drive Ordner</div>
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
          Ordner-ID für automatischen Drive-Sync (siehe Jobs). Benötigt verbundenes Google.
        </p>
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
            id="drive-folder"
            type="text"
            autoComplete="off"
            placeholder="Ordner-ID aus der Drive-URL"
            value={driveFolderId}
            onChange={(e) => setDriveFolderId(e.target.value)}
            style={{
              flex: "1 1 220px",
              minWidth: 0,
              padding: "0.45rem 0.6rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
            }}
          />
          <button
            type="button"
            onClick={saveDriveFolder}
            disabled={driveFolderM.isPending || !driveFolderId.trim()}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: "var(--co-btn-primary-bg)",
              color: "var(--co-btn-primary-fg)",
              fontWeight: 600,
              cursor: driveFolderM.isPending ? "wait" : "pointer",
              opacity: driveFolderM.isPending || !driveFolderId.trim() ? 0.65 : 1,
            }}
          >
            {driveFolderM.isPending ? "…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ConnectionsPage = ConnectionsPanel;
