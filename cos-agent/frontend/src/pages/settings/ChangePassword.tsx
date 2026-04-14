import type { FormEvent } from "react";
import { useState } from "react";
import { api, ApiError } from "../../lib/api.ts";

function strengthScore(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (/[A-ZÄÖÜ]/.test(pw)) s += 1;
  if (/[0-9]/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw)) s += 1;
  if (pw.length >= 12) s += 1;
  const labels = ["Sehr schwach", "Schwach", "Mittel", "Gut", "Sehr gut"];
  const label = labels[Math.min(s, labels.length - 1)] ?? "Mittel";
  return { score: s, label };
}

export function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  const { score, label } = strengthScore(next);
  const barPct = Math.min(100, (score / 5) * 100);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors([]);
    setOk(false);
    if (next !== confirm) {
      setError("Passwörter stimmen nicht überein.");
      return;
    }
    setPending(true);
    try {
      await api.post<{ changed: boolean }>("/api/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      setOk(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const j = JSON.parse(err.message) as {
            error?: string;
            errors?: string[];
          };
          if (Array.isArray(j.errors) && j.errors.length) {
            setErrors(j.errors);
          }
          setError(j.error ?? err.message);
        } catch {
          setError(err.message || "Fehler");
        }
      } else {
        setError("Fehler");
      }
    } finally {
      setPending(false);
    }
  }

  const barColor =
    score <= 1 ? "var(--danger)" : score <= 2 ? "#c9a227" : "var(--accent)";

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "1rem" }}>
      <h1
        className="co-font-display"
        style={{ fontSize: "1.35rem", marginBottom: "0.5rem" }}
      >
        Passwort ändern
      </h1>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        Mindestens 8 Zeichen, 1 Großbuchstabe, 1 Zahl, 1 Sonderzeichen.
      </p>
      <form onSubmit={onSubmit}>
        <label
          htmlFor="cp-current"
          style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.35rem" }}
        >
          Aktuelles Passwort
        </label>
        <input
          id="cp-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
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
          htmlFor="cp-next"
          style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.35rem" }}
        >
          Neues Passwort
        </label>
        <input
          id="cp-next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          style={{
            width: "100%",
            padding: "0.55rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            marginBottom: "0.35rem",
          }}
        />
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          Stärke:{" "}
          <span
            style={{
              display: "inline-block",
              width: 120,
              height: 8,
              background: "var(--surface-2)",
              borderRadius: 4,
              verticalAlign: "middle",
              marginLeft: 6,
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${barPct}%`,
                background: barColor,
                borderRadius: 4,
              }}
            />
          </span>{" "}
          {label}
        </div>
        <label
          htmlFor="cp-confirm"
          style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.35rem" }}
        >
          Passwort bestätigen
        </label>
        <input
          id="cp-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          style={{
            width: "100%",
            padding: "0.55rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            marginBottom: "0.75rem",
          }}
        />
        {error && (
          <p style={{ color: "var(--danger)", fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
            {error}
          </p>
        )}
        {errors.length > 0 && (
          <ul style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {ok && (
          <p style={{ color: "var(--accent)", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>
            Passwort wurde geändert.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: "0.55rem 1.2rem",
            border: "none",
            borderRadius: "var(--radius-md)",
            background: pending ? "var(--muted)" : "var(--accent)",
            color: "var(--accent-foreground)",
            fontWeight: 600,
          }}
        >
          {pending ? "…" : "Passwort ändern"}
        </button>
      </form>
    </div>
  );
}
