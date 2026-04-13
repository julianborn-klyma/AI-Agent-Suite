import { Link } from "react-router-dom";

export function SettingsIndexPage() {
  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Einstellungen</h2>
      <p style={{ color: "var(--muted)", marginTop: "-0.25rem" }}>
        Persönliche Anbindungen an externe Dienste.
      </p>
      <Link
        to="/settings/connections"
        style={{
          display: "block",
          marginTop: "1.25rem",
          padding: "1rem 1.15rem",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text)",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Verbindungen
        <div
          style={{
            marginTop: "0.35rem",
            fontWeight: 400,
            fontSize: "0.88rem",
            color: "var(--muted)",
          }}
        >
          Google (Gmail &amp; Drive) und Notion-Token (<code>secret_…</code>)
        </div>
      </Link>
    </div>
  );
}
