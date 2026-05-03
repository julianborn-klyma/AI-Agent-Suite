import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";

const boxStyle: CSSProperties = {
  marginTop: "0.5rem",
  padding: "0.65rem 0.75rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  maxHeight: 220,
  overflow: "auto",
  fontSize: "0.88rem",
  lineHeight: 1.45,
};

export function WikiMarkdownPreview(props: { markdown: string }) {
  if (!props.markdown.trim()) {
    return (
      <div style={{ ...boxStyle, color: "var(--muted)" }}>
        (Kein Inhalt für die Vorschau)
      </div>
    );
  }
  return (
    <div data-testid="wiki-md-preview" style={boxStyle} className="chat-md wiki-md-preview">
      <ReactMarkdown>{props.markdown}</ReactMarkdown>
    </div>
  );
}
