import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, API_URL } from "../../lib/api.ts";
import { getToken } from "../../lib/auth.ts";
import { useOnboarding } from "../../hooks/useOnboarding.ts";

type ConnectionsStatus = {
  google: boolean;
  notion: boolean;
  slack: boolean;
};

function stepFromNext(
  next: "profile" | "connections" | "chat" | "done",
): number {
  if (next === "profile") return 1;
  if (next === "connections") return 2;
  if (next === "chat") return 3;
  return 4;
}

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "1.25rem",
  maxWidth: 560,
  margin: "0 auto",
};

export function OnboardingFlow() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { status, isLoading, saveProfile, completeOnboarding, skipStep } =
    useOnboarding();

  const [step, setStep] = useState(1);
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [priorities, setPriorities] = useState("");
  const [communicationStyle, setCommunicationStyle] = useState("");
  const [workStyle, setWorkStyle] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    setStep((prev) => Math.max(prev, stepFromNext(status.next_step)));
  }, [status]);

  const connectionsQ = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.get<ConnectionsStatus>("/api/connections"),
  });

  const notionM = useMutation({
    mutationFn: (token: string) =>
      api.put<{ connected: boolean }>("/api/connections/notion", { token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["connections"] }),
  });

  const [notionToken, setNotionToken] = useState("");

  const conn = connectionsQ.data;

  const progress = useMemo(
    () =>
      [
        { n: 1, label: "Profil" },
        { n: 2, label: "Verbindungen" },
        { n: 3, label: "Erster Chat" },
        { n: 4, label: "Fertig" },
      ] as const,
    [],
  );

  function connectGoogle() {
    const t = getToken();
    if (!t) return;
    const base = API_URL || "";
    window.location.href = `${base}/api/auth/google?token=${encodeURIComponent(t)}`;
  }

  function connectSlack() {
    const t = getToken();
    if (!t) return;
    const base = API_URL || "";
    window.location.href = `${base}/api/auth/slack?token=${encodeURIComponent(t)}`;
  }

  async function goProfileNext() {
    setProfileError(null);
    const r = role.trim();
    if (r.length < 3) {
      setProfileError("Bitte gib deine Rolle an (mindestens 3 Zeichen).");
      return;
    }
    await saveProfile({
      role: r,
      team: team.trim() || undefined,
      priorities: priorities.trim() || undefined,
      communication_style: communicationStyle.trim() || undefined,
      work_style: workStyle.trim() || undefined,
    });
    setStep(2);
  }

  if (isLoading || !status) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
        Laden…
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem 1rem 3rem", maxWidth: 720, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "0.35rem",
          flexWrap: "wrap",
          marginBottom: "1.75rem",
          fontSize: "0.85rem",
          color: "var(--muted)",
        }}
      >
        {progress.map((p, i) => (
          <span key={p.n} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span
              style={{
                fontWeight: step >= p.n ? 700 : 500,
                color: step >= p.n ? "var(--text)" : "var(--muted)",
              }}
            >
              {p.n === 1 ? "①" : p.n === 2 ? "②" : p.n === 3 ? "③" : "④"} {p.label}
            </span>
            {i < progress.length - 1 && <span aria-hidden>→</span>}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div style={card}>
          <h1 className="co-font-display" style={{ marginTop: 0, fontSize: "1.35rem" }}>
            👋 Willkommen bei deinem Chief of Staff!
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Damit ich dich wirklich kennenlernen kann, erzähl mir kurz von dir.
          </p>
          {profileError && (
            <p style={{ color: "var(--danger)", fontSize: "0.9rem" }}>{profileError}</p>
          )}
          <label className="co-field-label" htmlFor="ob-role">
            Deine Rolle
          </label>
          <input
            id="ob-role"
            className="co-input"
            placeholder="z.B. CEO, Projektleiter, Entwickler…"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <label className="co-field-label" htmlFor="ob-team">
            Dein Team (optional)
          </label>
          <input
            id="ob-team"
            className="co-input"
            placeholder="z.B. Max (CTO), Lisa (Sales)…"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <label className="co-field-label" htmlFor="ob-prio">
            Aktuelle Prioritäten (optional)
          </label>
          <textarea
            id="ob-prio"
            className="co-textarea"
            placeholder="Was sind deine Top-3-Ziele gerade?"
            value={priorities}
            onChange={(e) => setPriorities(e.target.value)}
            rows={3}
            style={{ marginBottom: "1rem" }}
          />
          <label className="co-field-label" htmlFor="ob-comm">
            Kommunikationsstil (optional)
          </label>
          <input
            id="ob-comm"
            className="co-input"
            placeholder="Direkt und kurz / Ausführlich / …"
            value={communicationStyle}
            onChange={(e) => setCommunicationStyle(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <label className="co-field-label" htmlFor="ob-work">
            Arbeitsstil (optional)
          </label>
          <input
            id="ob-work"
            className="co-input"
            placeholder="z.B. Deep Work morgens, viele Meetings…"
            value={workStyle}
            onChange={(e) => setWorkStyle(e.target.value)}
            style={{ marginBottom: "1.25rem" }}
          />
          <div style={{ textAlign: "right" }}>
            <button type="button" className="co-btn co-btn--primary" onClick={() => void goProfileNext()}>
              Weiter →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={card}>
          <h1 className="co-font-display" style={{ marginTop: 0, fontSize: "1.35rem" }}>
            🔌 Verbinde deine Tools
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Je mehr Tools verbunden sind, desto besser kann ich dir helfen.
          </p>

          <div style={{ ...card, marginBottom: "0.75rem", padding: "1rem" }}>
            <div className="co-card-title">🔵 Google (Gmail + Drive + Calendar)</div>
            <p style={{ fontSize: "0.9rem", color: "var(--muted)", margin: "0.35rem 0 0.75rem" }}>
              E-Mails, Dokumente und Termine
            </p>
            {conn?.google
              ? (
                <span className="co-badge co-badge--success">Verbunden</span>
              )
              : (
                <button type="button" className="co-btn co-btn--primary" onClick={connectGoogle}>
                  Verbinden
                </button>
              )}
          </div>

          <div style={{ ...card, marginBottom: "0.75rem", padding: "1rem" }}>
            <div className="co-card-title">⬛ Notion</div>
            <p style={{ fontSize: "0.9rem", color: "var(--muted)", margin: "0.35rem 0 0.75rem" }}>
              Tasks und Workspace
            </p>
            {conn?.notion
              ? <span className="co-badge co-badge--success">Verbunden</span>
              : (
                <>
                  <input
                    className="co-input"
                    placeholder="secret_…"
                    value={notionToken}
                    onChange={(e) => setNotionToken(e.target.value)}
                    style={{ marginBottom: "0.5rem" }}
                  />
                  <button
                    type="button"
                    className="co-btn co-btn--primary"
                    disabled={notionM.isPending}
                    onClick={() => {
                      const t = notionToken.trim();
                      if (t.startsWith("secret_")) notionM.mutate(t);
                    }}
                  >
                    Speichern
                  </button>
                </>
              )}
          </div>

          <div style={{ ...card, marginBottom: "1rem", padding: "1rem" }}>
            <div className="co-card-title">💬 Slack</div>
            <p style={{ fontSize: "0.9rem", color: "var(--muted)", margin: "0.35rem 0 0.75rem" }}>
              Nachrichten und Kontext
            </p>
            {conn?.slack
              ? <span className="co-badge co-badge--success">Verbunden</span>
              : (
                <button type="button" className="co-btn co-btn--primary" onClick={connectSlack}>
                  Verbinden
                </button>
              )}
          </div>

          <p style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
            Du kannst Tools auch später unter Einstellungen verbinden.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.5rem",
              marginTop: "1rem",
            }}
          >
            <button
              type="button"
              className="co-btn co-btn--ghost"
              onClick={() => void skipStep("connections").then(() => setStep(3))}
            >
              Überspringen
            </button>
            <button type="button" className="co-btn co-btn--primary" onClick={() => setStep(3)}>
              Weiter →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={card}>
          <h1 className="co-font-display" style={{ marginTop: 0, fontSize: "1.35rem" }}>
            💬 Sag Hallo!
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Stell mir eine erste Frage oder gib mir eine Aufgabe. Ich lerne mit jeder Interaktion.
          </p>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Vorschläge:</p>
          {[
            "Was sind meine Aufgaben für heute?",
            "Zeig mir meine wichtigsten E-Mails",
            "Stell dich vor und erkläre was du kannst",
          ].map((s) => (
            <button
              key={s}
              type="button"
              className="co-btn co-btn--ghost"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                marginBottom: "0.5rem",
                whiteSpace: "normal",
                height: "auto",
                padding: "0.65rem 0.85rem",
              }}
              onClick={() => navigate("/chat", { state: { chatDraft: s } })}
            >
              {s}
            </button>
          ))}
          <label className="co-field-label" htmlFor="ob-chat" style={{ marginTop: "1rem" }}>
            Oder eigene Frage
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              id="ob-chat"
              className="co-input"
              style={{ flex: "1 1 200px" }}
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
            />
            <button
              type="button"
              className="co-btn co-btn--primary"
              onClick={() => {
                const t = chatDraft.trim();
                if (t) navigate("/chat", { state: { chatDraft: t } });
              }}
            >
              Senden
            </button>
          </div>
          <div style={{ marginTop: "1.25rem" }}>
            <button
              type="button"
              className="co-btn co-btn--ghost"
              onClick={() => void skipStep("chat").then(() => setStep(4))}
            >
              Überspringen
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div style={card}>
          <h1 className="co-font-display" style={{ marginTop: 0, fontSize: "1.35rem" }}>
            ✅ Alles bereit!
          </h1>
          <p style={{ color: "var(--muted)" }}>
            Dein Chief of Staff ist einsatzbereit.
          </p>
          <p style={{ fontWeight: 600 }}>Was als nächstes:</p>
          <ul style={{ color: "var(--muted)", lineHeight: 1.6 }}>
            <li>💬 Chat — Stell Fragen, gib Aufgaben</li>
            <li>📋 Tasks — Reiche komplexe Jobs ein</li>
            <li>📄 Dokumente — Lade Businessplan hoch</li>
            <li>⚙️ Verbindungen — Mehr Tools verbinden</li>
          </ul>
          <p style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            Der Agent lernt mit jeder Interaktion mehr über dich und wird mit der Zeit besser.
          </p>
          <div style={{ marginTop: "1.25rem" }}>
            <button
              type="button"
              className="co-btn co-btn--primary"
              onClick={() =>
                void completeOnboarding().then(() => {
                  void qc.invalidateQueries({ queryKey: ["onboarding", "status"] });
                  navigate("/chat");
                })}
            >
              Zum Chat →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
