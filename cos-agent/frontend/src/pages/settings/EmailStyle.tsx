import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useState } from "react";
import { ApiError, api } from "../../lib/api.ts";

type StyleLearningApi = {
  id: string;
  category: string;
  content: string;
  source: string;
  last_confirmed: string;
} | null;

type EmailStyleGetResponse = {
  style: StyleLearningApi;
  last_updated: string | null;
};

type EmailStyleLearningResponse = {
  learned: boolean;
  emails_analyzed: number;
  reason?: string;
};

type StyledDraftResponse = {
  success: boolean;
  draft_id?: string;
  preview: string;
  style_used: boolean;
  recipient_type: string;
};

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "1.1rem",
  marginBottom: "0.85rem",
  maxWidth: 560,
};

function parseErr(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Fehler";
}

function parseStyleLines(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const m = /^([^:]+):\s*(.+)$/.exec(line.trim());
    if (m) out[m[1]!.trim()] = m[2]!.trim();
  }
  return out;
}

function formatRelativeDe(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "heute";
  if (days === 1) return "vor 1 Tag";
  return `vor ${days} Tagen`;
}

export function EmailStylePage() {
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [draftMessageId, setDraftMessageId] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftContext, setDraftContext] = useState("");
  const [draftResult, setDraftResult] = useState<StyledDraftResponse | null>(null);

  const styleQ = useQuery({
    queryKey: ["email-style"],
    queryFn: () => api.get<EmailStyleGetResponse>("/api/email-style"),
  });

  const learnM = useMutation({
    mutationFn: () => api.post<EmailStyleLearningResponse>("/api/email-style/learn", {}),
    onSuccess: (data) => {
      if (data.learned) {
        setBanner(`${data.emails_analyzed} Emails analysiert — Stil gespeichert.`);
      } else {
        setBanner(data.reason ?? "Stil konnte nicht gelernt werden.");
      }
      void queryClient.invalidateQueries({ queryKey: ["email-style"] });
    },
    onError: (e) => setBanner(parseErr(e)),
  });

  const draftM = useMutation({
    mutationFn: () =>
      api.post<StyledDraftResponse>("/api/email-style/draft", {
        message_id: draftMessageId.trim(),
        from: draftFrom,
        subject: draftSubject,
        body: draftBody,
        ...(draftContext.trim() ? { context: draftContext.trim() } : {}),
      }),
    onSuccess: (data) => {
      setDraftResult(data);
      setBanner(null);
    },
    onError: (e) => {
      setDraftResult(null);
      setBanner(parseErr(e));
    },
  });

  const style = styleQ.data?.style ?? null;
  const lines = style ? parseStyleLines(style.content) : {};
  const emailsAnalyzedHint = learnM.data?.emails_analyzed;

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 className="co-font-display" style={{ marginTop: 0 }} data-testid="email-style-title">
        ✍️ Mein Email-Schreibstil
      </h2>
      <p style={{ color: "var(--muted)", marginTop: "-0.25rem" }}>
        Der Agent lernt deinen Stil aus deinen gesendeten Emails und schreibt Entwürfe, die klingen als hättest du sie selbst geschrieben.
      </p>

      {banner && (
        <div
          style={{
            ...card,
            borderColor: "var(--accent)",
            color: "var(--text)",
            marginTop: "1rem",
          }}
        >
          {banner}
        </div>
      )}

      <div style={{ ...card, marginTop: "1.25rem" }}>
        <div style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          Letztes Update: {formatRelativeDe(styleQ.data?.last_updated ?? null)}
        </div>
        <div style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
          Emails analysiert:{" "}
          {typeof emailsAnalyzedHint === "number" ? emailsAnalyzedHint : "—"}
        </div>
        <button
          type="button"
          className="co-btn co-btn-primary"
          disabled={learnM.isPending}
          onClick={() => {
            setBanner(null);
            learnM.mutate();
          }}
        >
          {learnM.isPending ? "…" : "Jetzt aktualisieren"}
        </button>
      </div>

      {style && (
        <div style={{ ...card, marginTop: "1rem" }}>
          <div className="co-card-title" style={{ marginBottom: "0.75rem" }}>
            Dein erkannter Stil
          </div>
          <dl style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.5 }}>
            <dt style={{ color: "var(--muted)" }}>Anrede</dt>
            <dd style={{ margin: "0 0 0.5rem" }}>{lines["Anrede"] ?? "—"}</dd>
            <dt style={{ color: "var(--muted)" }}>Abschluss</dt>
            <dd style={{ margin: "0 0 0.5rem" }}>{lines["Abschluss"] ?? "—"}</dd>
            <dt style={{ color: "var(--muted)" }}>Länge</dt>
            <dd style={{ margin: "0 0 0.5rem" }}>{lines["Typische Länge"] ?? "—"}</dd>
            <dt style={{ color: "var(--muted)" }}>Ton</dt>
            <dd style={{ margin: "0 0 0.5rem" }}>{lines["Ton"] ?? "—"}</dd>
            <dt style={{ color: "var(--muted)" }}>Smalltalk</dt>
            <dd style={{ margin: "0 0 0.5rem" }}>{lines["Smalltalk"] ?? "—"}</dd>
            <dt style={{ color: "var(--muted)" }}>Bei Kollegen</dt>
            <dd style={{ margin: "0 0 0.5rem" }}>{lines["Bei Kollegen"] ?? "—"}</dd>
            <dt style={{ color: "var(--muted)" }}>Bei Kunden</dt>
            <dd style={{ margin: "0 0 0.5rem" }}>{lines["Bei Kunden"] ?? "—"}</dd>
            {lines["Beispiele"] && (
              <>
                <dt style={{ color: "var(--muted)", marginTop: "0.35rem" }}>
                  Typische Beispiel-Sätze
                </dt>
                <dd style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>
                  {lines["Beispiele"]!.split("|").map((s) => (
                    <div key={s} style={{ fontStyle: "italic", marginBottom: "0.25rem" }}>
                      &quot;{s.trim()}&quot;
                    </div>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      <div style={{ ...card, marginTop: "1rem" }}>
        <div className="co-card-title" style={{ marginBottom: "0.75rem" }}>
          Draft testen
        </div>
        <label className="co-label" style={{ display: "block", marginBottom: "0.35rem" }}>
          Gmail Message-ID
        </label>
        <input
          className="co-input"
          style={{ width: "100%", marginBottom: "0.65rem" }}
          value={draftMessageId}
          onChange={(e) => setDraftMessageId(e.target.value)}
          placeholder="z. B. aus der Gmail-URL (hex)"
        />
        <label className="co-label" style={{ display: "block", marginBottom: "0.35rem" }}>
          Von
        </label>
        <input
          className="co-input"
          style={{ width: "100%", marginBottom: "0.65rem" }}
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          placeholder="max.mustermann@firma.de"
        />
        <label className="co-label" style={{ display: "block", marginBottom: "0.35rem" }}>
          Betreff
        </label>
        <input
          className="co-input"
          style={{ width: "100%", marginBottom: "0.65rem" }}
          value={draftSubject}
          onChange={(e) => setDraftSubject(e.target.value)}
          placeholder="Re: Angebot Q2"
        />
        <label className="co-label" style={{ display: "block", marginBottom: "0.35rem" }}>
          Text
        </label>
        <textarea
          className="co-input"
          style={{ width: "100%", minHeight: 88, marginBottom: "0.65rem" }}
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          placeholder="Hallo Julian, …"
        />
        <label className="co-label" style={{ display: "block", marginBottom: "0.35rem" }}>
          Kontext (optional)
        </label>
        <textarea
          className="co-input"
          style={{ width: "100%", minHeight: 56, marginBottom: "0.85rem" }}
          value={draftContext}
          onChange={(e) => setDraftContext(e.target.value)}
          placeholder="Was soll die Antwort sagen?"
        />
        <button
          type="button"
          className="co-btn co-btn-primary"
          disabled={draftM.isPending}
          onClick={() => {
            setDraftResult(null);
            draftM.mutate();
          }}
        >
          {draftM.isPending ? "…" : "Draft erstellen →"}
        </button>
      </div>

      {draftResult && (
        <div style={{ ...card, marginTop: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            {draftResult.success ? "✓ Draft in Gmail gespeichert" : "Draft fehlgeschlagen"}
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
            Vorschau
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: "0.9rem",
            }}
          >
            {draftResult.preview}
          </pre>
          <div style={{ marginTop: "0.65rem", fontSize: "0.9rem" }}>
            Stil verwendet: {draftResult.style_used ? "✓" : "—"}
          </div>
          <div style={{ fontSize: "0.9rem" }}>
            Empfänger-Typ:{" "}
            {draftResult.recipient_type === "colleague"
              ? "Kollege"
              : draftResult.recipient_type === "customer"
              ? "Kunde"
              : "Unbekannt"}
          </div>
        </div>
      )}
    </div>
  );
}
