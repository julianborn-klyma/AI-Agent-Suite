import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, login } from "../lib/auth.ts";

export function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email.trim());
      nav("/chat", { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (() => {
              try {
                const j = JSON.parse(err.message) as { error?: string };
                return j.error ?? err.message;
              } catch {
                return err.message || "Anmeldung fehlgeschlagen";
              }
            })()
          : "Anmeldung fehlgeschlagen";
      setError(msg);
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
          MVP: nur E-Mail (aktiver User in cos_users).
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
          }}
        >
          {pending ? "…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
