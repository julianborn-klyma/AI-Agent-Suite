import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ChatComposer } from "../components/chat/ChatComposer.tsx";
import { ChatMessageList } from "../components/chat/ChatMessageList.tsx";
import { ChatSidebar } from "../components/chat/ChatSidebar.tsx";
import { PromptEngineerPanel } from "../components/PromptEngineerPanel.tsx";
import { useAuth } from "../hooks/useAuth.ts";
import { useBrainProjects } from "../hooks/useBrain.ts";
import { useChat } from "../hooks/useChat.ts";
import {
  type ChatModelKey,
  readStoredModel,
  resolvePreferredModel,
} from "../lib/chatModels.ts";

const DAILY_CHECKIN_PROMPT = `## Tages-Check-in

Kurz in eigenen Worten:
- Was steht heute an, was du mir mitteilen willst?
- Welche Entscheidung oder Priorität ist neu?
- Gibt es etwas, das ich mir für dein persönliches Wiki merken soll?

(Dann **Senden** — Learnings werden wie im normalen Chat extrahiert.)`;

export function ChatPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const {
    sessions,
    sessionsLoading,
    currentSessionId,
    messages,
    isLoading,
    isBusy,
    phaseLabel,
    isSendError,
    sendErrorDetail,
    sendMessage,
    startNewSession,
    selectSession,
    deleteSession,
    activeProjectId,
    setActiveProjectId,
  } = useChat();

  const [input, setInput] = useState("");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [pePanelKey, setPePanelKey] = useState(0);
  const [complexityHigh, setComplexityHigh] = useState(false);
  const [preferredModel, setPreferredModel] = useState<ChatModelKey>(
    readStoredModel() ?? "sonnet",
  );
  const [now, setNow] = useState(() => new Date());
  const projectsQ = useBrainProjects();

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const st = location.state as
      | { taskQueueDraft?: string; chatDraft?: string }
      | null;
    const draft = (typeof st?.chatDraft === "string" && st.chatDraft.trim()
      ? st.chatDraft
      : st?.taskQueueDraft) ?? "";
    if (typeof draft === "string" && draft.trim()) {
      setInput(draft);
    }
  }, [location.state]);

  useEffect(() => {
    if (searchParams.get("daily_checkin") !== "1") return;
    setInput((prev) => (prev.trim() ? prev : DAILY_CHECKIN_PROMPT));
  }, [searchParams]);

  const showEmptyWelcome =
    currentSessionId === null && messages.length === 0;

  const suggestions = [
    "Was sind meine Aufgaben für heute?",
    "Zeig mir meine wichtigsten Emails",
    "Briefing für heute",
  ];

  const timeLabel = now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  async function handleSend() {
    const t = input.trim();
    if (!t || isBusy) return;
    setInput("");
    const model = preferredModel || resolvePreferredModel(undefined);
    await sendMessage(t, {
      complexityHigh,
      projectId: activeProjectId,
      model,
    });
  }

  return (
    <div
      data-testid="chat-page"
      style={{
        display: "flex",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      <ChatSidebar
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        currentSessionId={currentSessionId}
        projects={projectsQ.data ?? []}
        selectedProjectId={activeProjectId}
        onSelectProject={setActiveProjectId}
        onStartNewSession={startNewSession}
        onSelectSession={(id) => void selectSession(id)}
        onDeleteSession={(id) => void deleteSession(id)}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <header
          style={{
            flexShrink: 0,
            padding: "0.65rem 1rem",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "1rem",
          }}
        >
          <span
            className="co-font-display"
            style={{ fontWeight: 700, fontSize: "1.05rem" }}
          >
            Chief of Staff
          </span>
          <time
            dateTime={now.toISOString()}
            style={{
              color: "var(--muted)",
              fontSize: "0.9rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {timeLabel}
          </time>
        </header>

        <ChatMessageList
          messages={messages}
          isLoading={isLoading}
          phaseLabel={phaseLabel}
          showEmptyWelcome={showEmptyWelcome}
          userName={user?.name ?? "…"}
          isBusy={isBusy}
          suggestions={suggestions}
          onSuggestion={(s) => void sendMessage(s, { model: preferredModel })}
        />

        <ChatComposer
          input={input}
          onInputChange={setInput}
          onSend={() => void handleSend()}
          isBusy={isBusy}
          isSendError={isSendError}
          sendErrorDetail={sendErrorDetail}
          preferredModel={preferredModel}
          onModelChange={setPreferredModel}
          onComplexityChange={setComplexityHigh}
          complexityHigh={complexityHigh}
          onOpenPromptEngineer={() => {
            setPePanelKey((k) => k + 1);
            setPromptModalOpen(true);
          }}
        />
      </div>

      {promptModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPromptModalOpen(false);
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "var(--surface)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: "1rem",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <PromptEngineerPanel
              key={pePanelKey}
              compact
              initialText={input}
              taskType="research"
              onApply={(optimized) => {
                setInput(optimized);
                setPromptModalOpen(false);
              }}
              onCancel={() => setPromptModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
