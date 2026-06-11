import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";
import { BrainPage } from "./BrainPage.tsx";
import { WorkspaceWikiPage } from "./workspace/WorkspaceWikiPage.tsx";

export function KnowledgeHubPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const showWiki = user?.tenant_ui_show_tenant_wiki === true;
  const tab = params.get("tab") ?? "projects";

  if (tab === "wiki" && !showWiki) {
    return <Navigate to="/knowledge" replace />;
  }

  return (
    <div
      className="co-scroll-pane"
      style={{ padding: "var(--layout-main-padding)" }}
      data-testid="knowledge-hub"
    >
      <div
        style={{
          display: "flex",
          gap: "0.35rem",
          marginBottom: "1rem",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "0.65rem",
        }}
        role="tablist"
        aria-label="Wissens-Hub"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "projects"}
          data-testid="knowledge-tab-projects"
          onClick={() => setParams({ tab: "projects" })}
          style={{
            padding: "0.45rem 0.85rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            cursor: "pointer",
            fontWeight: tab === "projects" ? 600 : 500,
            background: tab === "projects" ? "var(--accent-soft)" : "transparent",
            color: tab === "projects" ? "var(--ink)" : "var(--muted)",
          }}
        >
          Projekte
        </button>
        {showWiki && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "wiki"}
            data-testid="knowledge-tab-wiki"
            onClick={() => setParams({ tab: "wiki" })}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "var(--radius-sm)",
              border: "none",
              cursor: "pointer",
              fontWeight: tab === "wiki" ? 600 : 500,
              background: tab === "wiki" ? "var(--accent-soft)" : "transparent",
              color: tab === "wiki" ? "var(--ink)" : "var(--muted)",
            }}
          >
            Handbuch (Wiki)
          </button>
        )}
      </div>
      {tab === "wiki" && showWiki ? <WorkspaceWikiPage embedded /> : <BrainPage embedded />}
    </div>
  );
}
