import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

const linkCard: CSSProperties = {
  display: "block",
  padding: "1rem 1.15rem",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  textDecoration: "none",
  color: "var(--text)",
  marginBottom: "0.75rem",
  maxWidth: 480,
};

export function SettingsPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 className="co-font-display" style={{ marginTop: 0 }}>
        Einstellungen
      </h2>
      <p style={{ color: "var(--muted)", marginTop: "-0.25rem" }}>
        Verknüpfe Dienste, steuere automatische Jobs und verwalte gespeicherte Learnings.
      </p>

      <nav style={{ marginTop: "1.5rem" }} aria-label="Einstellungen">
        <Link to="/settings/connections" style={linkCard}>
          <div className="co-card-title" style={{ marginBottom: "0.25rem" }}>
            Verbindungen
          </div>
          <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
            Google, Notion, Slack, Drive-Ordner
          </span>
        </Link>
        <Link to="/settings/schedules" style={linkCard}>
          <div className="co-card-title" style={{ marginBottom: "0.25rem" }}>
            Jobs &amp; Automation
          </div>
          <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
            Briefing, E-Mail-Triage, Slack-Digest, Drive-Sync, Wochen-Verdichtung
          </span>
        </Link>
        <Link to="/settings/learnings" style={linkCard}>
          <div className="co-card-title" style={{ marginBottom: "0.25rem" }}>
            Was weiß der Agent?
          </div>
          <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
            Learnings bestätigen oder entfernen
          </span>
        </Link>
        <Link to="/settings/email-style" style={linkCard}>
          <div className="co-card-title" style={{ marginBottom: "0.25rem" }}>
            Mein Schreibstil
          </div>
          <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
            Stil aus Gmail lernen und Entwürfe testen
          </span>
        </Link>
      </nav>
    </div>
  );
}
