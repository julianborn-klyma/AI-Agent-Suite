import type { CSSProperties } from "react";
import { useEffect, useId } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

const node: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "0.55rem 0.85rem",
  fontSize: "0.82rem",
  textAlign: "center" as const,
  maxWidth: 280,
  boxShadow: "var(--shadow-sm)",
};

const nodeTitle: CSSProperties = {
  fontWeight: 700,
  fontSize: "0.78rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  color: "var(--muted)",
  marginBottom: "0.2rem",
};

const arrow: CSSProperties = {
  color: "var(--muted)",
  fontSize: "1.1rem",
  lineHeight: 1,
  userSelect: "none" as const,
};

const chipRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.35rem",
  justifyContent: "center",
  marginTop: "0.35rem",
};

const chip: CSSProperties = {
  fontSize: "0.68rem",
  padding: "0.15rem 0.45rem",
  borderRadius: 999,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export function AgentStructureInfoModal({ open, onClose }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgb(8 3 27 / 0.45)",
      }}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="agent-structure-modal"
        style={{
          width: "100%",
          maxWidth: 440,
          maxHeight: "min(90vh, 640px)",
          overflow: "auto",
          background: "var(--bg)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-md)",
          padding: "1.15rem 1.25rem 1rem",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid="agent-structure-modal-close"
          aria-label="Schließen"
          onClick={onClose}
          style={{
            position: "absolute",
            top: "0.65rem",
            right: "0.65rem",
            width: 32,
            height: 32,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            cursor: "pointer",
            fontSize: "1.1rem",
            lineHeight: 1,
            color: "var(--text)",
          }}
        >
          ×
        </button>

        <h2
          id={titleId}
          className="co-font-display"
          style={{ margin: "0 2.25rem 0.5rem 0", fontSize: "1.15rem" }}
        >
          Agenten-Struktur
        </h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.88rem", color: "var(--muted)" }}>
          Vereinfachtes Schema des Chat-Flows im Backend: Der Orchestrator plant Schritte, Spezial-Agenten
          rufen Tools auf, danach werden Ergebnisse zusammengeführt und geprüft.
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.35rem",
            padding: "0.5rem 0",
          }}
        >
          <div style={node}>
            <div style={nodeTitle}>Eingang</div>
            Nutzer-Nachricht &amp; Chat-Verlauf
          </div>
          <div style={arrow}>↓</div>
          <div style={node}>
            <div style={nodeTitle}>Kontext</div>
            Profil, Learnings, verbundene Tools, Dokumente
          </div>
          <div style={arrow}>↓</div>
          <div style={{ ...node, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <div style={{ ...nodeTitle, color: "var(--text)" }}>Orchestrator</div>
            Intent-Analyse → Plan (welche Sub-Agenten, welche Tasks)
          </div>
          <div style={arrow}>↓</div>
          <div style={{ ...node, maxWidth: 360 }}>
            <div style={nodeTitle}>Sub-Agenten (parallel)</div>
            Je nach Plan; nur aktivierte Tools
            <div style={chipRow}>
              <span style={chip}>Gmail</span>
              <span style={chip}>Notion</span>
              <span style={chip}>Slack</span>
              <span style={chip}>Drive</span>
              <span style={chip}>Kalender</span>
              <span style={chip}>CFO</span>
            </div>
          </div>
          <div style={arrow}>↓</div>
          <div style={node}>
            <div style={nodeTitle}>Aggregator</div>
            Antwort aus Tool-Ergebnissen formulieren
          </div>
          <div style={arrow}>↓</div>
          <div style={node}>
            <div style={nodeTitle}>Validator</div>
            Qualität prüfen — bei Bedarf Retry (Schleife)
          </div>
          <div style={arrow}>↓</div>
          <div style={{ ...node, borderColor: "var(--success-border)", background: "var(--success-soft)" }}>
            <div style={{ ...nodeTitle, color: "var(--success)" }}>Antwort</div>
            Nachricht an den Nutzer
          </div>
          <div style={{ ...arrow, marginTop: "0.15rem", fontSize: "0.85rem" }}>⤷</div>
          <div
            style={{
              ...node,
              borderStyle: "dashed",
              opacity: 0.95,
              maxWidth: 320,
            }}
          >
            <div style={nodeTitle}>Learning (async)</div>
            Nach erfolgreicher Antwort: Kandidaten für Learnings extrahieren
          </div>
        </div>

        <p style={{ margin: "1rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          Zusätzliche Dienste (z. B. Email-Stil, Cron-Jobs) laufen außerhalb dieses Chat-Flows über eigene
          API-Endpunkte und Schedules.
        </p>
      </div>
    </div>
  );
}
