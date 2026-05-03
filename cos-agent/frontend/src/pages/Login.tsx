import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { API_URL, ApiError } from "../lib/api.ts";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login, setToken } from "../lib/auth.ts";

const LOGIN_ERRORS: Record<string, string> = {
  google_not_configured: "Google-Anmeldung ist auf dem Server nicht konfiguriert.",
  google_login_denied: "Google-Anmeldung abgebrochen oder abgelehnt.",
  google_login_state: "Sitzung abgelaufen. Bitte erneut mit Google anmelden.",
  google_email_unverified: "Google-Konto ohne bestätigte E-Mail.",
  no_account: "Kein Benutzer mit dieser Google-E-Mail. Bitte Administrator kontaktieren.",
  google_login_failed: "Google-Anmeldung fehlgeschlagen.",
};

export function LoginPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retryRemaining, setRetryRemaining] = useState<number | null>(null);

  /** Gleiche Basis wie `apiFetch` (Dev: leer → `/api…` über Proxy; Prod: `VITE_API_URL` oder Fallback). */
  const googleLoginHref = `${API_URL}/api/auth/google/login`;

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) {
      setError(LOGIN_ERRORS[err] ?? "Anmeldung fehlgeschlagen.");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (retryRemaining === null || retryRemaining <= 0) return;
    const t = setInterval(() => {
      setRetryRemaining((s) => (s === null || s <= 1 ? null : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [retryRemaining]);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return;
    const p = new URLSearchParams(raw);
    const t = p.get("cos_token");
    if (t) {
      setToken(t);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      nav("/chat", { replace: true });
    }
  }, [nav]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRetryRemaining(null);
    setPending(true);
    try {
      await login(email.trim(), password);
      nav("/chat", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        try {
          const j = JSON.parse(err.message) as {
            error?: string;
            retry_after?: number;
          };
          const sec = typeof j.retry_after === "number" ? j.retry_after : 900;
          setRetryRemaining(sec);
          setError(j.error ?? "Zu viele Versuche.");
        } catch {
          setError("Zu viele Versuche. Bitte später erneut.");
          setRetryRemaining(900);
        }
      } else if (err instanceof ApiError) {
        try {
          const j = JSON.parse(err.message) as {
            error?: string;
            code?: string;
          };
          if (j.code === "PASSWORD_REQUIRED") {
            setError(
              `${j.error ?? ""} Bitte kontaktiere deinen Administrator für ein initiales Passwort.`,
            );
          } else {
            setError(j.error ?? (err.message || "Anmeldung fehlgeschlagen"));
          }
        } catch {
          setError(err.message || "Anmeldung fehlgeschlagen");
        }
      } else {
        setError("Anmeldung fehlgeschlagen");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "var(--bg)",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "1.75rem",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h1
          className="co-font-display"
          style={{ margin: "0 0 0.25rem", fontSize: "1.35rem" }}
        >
          Anmelden
        </h1>
        <p style={{ margin: "0 0 1.25rem", color: "var(--muted)", fontSize: "0.9rem" }}>
          E-Mail und Passwort, oder mit Google (E-Mail muss in cos_users existieren und bei Google
          verifiziert sein).
        </p>
        <label
          htmlFor="login-email-field"
          style={{
            display: "block",
            marginBottom: "0.35rem",
            fontSize: "0.85rem",
            fontWeight: 500,
          }}
        >
          E-Mail
        </label>
        <input
          id="login-email-field"
          type="email"
          autoComplete="username"
          data-testid="login-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            width: "100%",
            padding: "0.55rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            marginBottom: "0.85rem",
          }}
        />
        <label
          htmlFor="login-password-field"
          style={{
            display: "block",
            marginBottom: "0.35rem",
            fontSize: "0.85rem",
            fontWeight: 500,
          }}
        >
          Passwort
        </label>
        <input
          id="login-password-field"
          type="password"
          autoComplete="current-password"
          data-testid="login-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: "0.55rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            marginBottom: "1rem",
          }}
        />
        {error && (
          <p
            style={{
              color: "var(--danger)",
              fontSize: "0.9rem",
              margin: "0 0 1rem",
            }}
          >
            {error}
            {retryRemaining !== null && retryRemaining > 0 && (
              <span style={{ display: "block", marginTop: "0.35rem" }}>
                Bitte in {retryRemaining}s erneut versuchen.
              </span>
            )}
          </p>
        )}
        <button
          type="submit"
          data-testid="login-submit"
          disabled={pending}
          style={{
            width: "100%",
            padding: "0.6rem",
            border: "none",
            borderRadius: "var(--radius-md)",
            background: pending ? "var(--muted)" : "var(--accent)",
            color: pending ? "var(--surface)" : "var(--accent-foreground)",
            fontWeight: 600,
            marginBottom: "0.75rem",
          }}
        >
          {pending ? "…" : "Anmelden"}
        </button>
        <a
          href={googleLoginHref}
          data-testid="login-google"
          style={{
            display: "block",
            width: "100%",
            textAlign: "center",
            padding: "0.55rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: "0.9rem",
            textDecoration: "none",
          }}
        >
          Mit Google anmelden
        </a>
      </form>
    </div>
  );
}
