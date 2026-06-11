import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import {
  type ChatModelKey,
  type ChatModelsResponse,
  resolvePreferredModel,
  storeModel,
} from "../../lib/chatModels.ts";
import { AgentStructureInfoModal } from "../AgentStructureInfoModal.tsx";

type ChatComposerProps = {
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  isBusy: boolean;
  isSendError: boolean;
  sendErrorDetail: string;
  preferredModel: ChatModelKey;
  onModelChange: (key: ChatModelKey) => void;
  onComplexityChange: (high: boolean) => void;
  onOpenPromptEngineer: () => void;
  complexityHigh: boolean;
};

export function ChatComposer({
  input,
  onInputChange,
  onSend,
  isBusy,
  isSendError,
  sendErrorDetail,
  preferredModel,
  onModelChange,
  onComplexityChange,
  onOpenPromptEngineer,
  complexityHigh,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);

  const modelsQ = useQuery({
    queryKey: ["chat-models"],
    queryFn: () => api.get<ChatModelsResponse>("/api/chat/models"),
    staleTime: 300_000,
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineH = 22;
    const maxH = lineH * 5;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, [input]);

  useEffect(() => {
    const t = input.trim();
    if (!t) {
      onComplexityChange(false);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const r = await api.post<{ complexity: string }>(
          "/api/prompt-engineer/classify",
          { message: t },
        );
        onComplexityChange(r.complexity === "high");
      } catch {
        onComplexityChange(false);
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [input, onComplexityChange]);

  const models = modelsQ.data?.models ?? [];
  const activeModel = resolvePreferredModel(modelsQ.data);
  const displayModel = preferredModel || activeModel;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div
      style={{
        flexShrink: 0,
        padding: "0.65rem 1rem",
        borderTop: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.45rem",
        }}
      >
        <select
          data-testid="chat-model-select"
          value={displayModel}
          onChange={(e) => {
            const key = e.target.value as ChatModelKey;
            storeModel(key);
            onModelChange(key);
          }}
          disabled={isBusy}
          title="Antwortmodell (Sub-Agenten können ein günstigeres Modell nutzen)"
          style={{
            padding: "0.3rem 0.45rem",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            fontSize: "0.78rem",
            color: "var(--text)",
            maxWidth: 180,
          }}
        >
          {models.length === 0 ? (
            <option value="sonnet">Claude Sonnet 4</option>
          ) : (
            models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          data-testid="agent-structure-info-button"
          aria-label="Info: Agenten-Struktur"
          title="Agenten-Struktur"
          onClick={() => setAgentInfoOpen(true)}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            cursor: "pointer",
            color: "var(--muted)",
            fontWeight: 700,
            fontSize: "0.82rem",
          }}
        >
          i
        </button>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
          Sub-Agenten können ein günstigeres Modell nutzen
        </span>
      </div>

      {complexityHigh && (
        <button
          type="button"
          onClick={onOpenPromptEngineer}
          style={{
            display: "block",
            marginBottom: "0.35rem",
            padding: "0.25rem 0.5rem",
            fontSize: "0.72rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--muted)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          ✨ Komplex — Prompt optimieren empfohlen
        </button>
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          rows={1}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Nachricht… (Enter senden, Shift+Enter Zeilenumbruch)"
          disabled={isBusy}
          style={{
            flex: 1,
            minHeight: 40,
            maxHeight: 110,
            resize: "none",
            padding: "0.5rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            lineHeight: 1.4,
          }}
        />
        <button
          type="button"
          title="Prompt optimieren"
          onClick={onOpenPromptEngineer}
          disabled={isBusy}
          style={{
            padding: "0.55rem 0.65rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface)",
            alignSelf: "flex-end",
            cursor: isBusy ? "not-allowed" : "pointer",
            fontSize: "1rem",
          }}
        >
          ✨
        </button>
        <button
          data-testid="chat-send"
          type="button"
          disabled={isBusy || !input.trim()}
          onClick={onSend}
          style={{
            padding: "0.55rem 1rem",
            border: "none",
            borderRadius: 8,
            background:
              isBusy || !input.trim() ? "var(--muted)" : "var(--co-btn-primary-bg)",
            color:
              isBusy || !input.trim()
                ? "var(--surface)"
                : "var(--co-btn-primary-fg)",
            fontWeight: 600,
            alignSelf: "flex-end",
          }}
        >
          Senden
        </button>
      </div>

      {isSendError && (
        <div style={{ margin: "0.45rem 0 0" }}>
          <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.85rem" }}>
            Senden fehlgeschlagen. Bitte erneut versuchen.
          </p>
          {sendErrorDetail ? (
            <pre
              style={{
                margin: "0.35rem 0 0",
                padding: "0.45rem 0.5rem",
                fontSize: "0.75rem",
                color: "var(--text)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 120,
                overflow: "auto",
              }}
            >
              {sendErrorDetail}
            </pre>
          ) : null}
        </div>
      )}

      <AgentStructureInfoModal
        open={agentInfoOpen}
        onClose={() => setAgentInfoOpen(false)}
      />
    </div>
  );
}
