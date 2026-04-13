import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../lib/api.ts";

type ConfigRow = {
  id: number;
  name: string;
  system_prompt: string;
  tools_enabled: string[];
  is_template: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

const KNOWN_TOOLS = ["notion", "gmail"] as const;

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const j = JSON.parse(e.message) as { error?: string };
      if (typeof j.error === "string") return j.error;
    } catch {
      /* ignore */
    }
    return e.message || `HTTP ${e.status}`;
  }
  if (e instanceof Error) return e.message;
  return "Unbekannter Fehler";
}

function ConfigEditor({ row }: { row: ConfigRow }) {
  const qc = useQueryClient();
  const [name, setName] = useState(row.name);
  const [prompt, setPrompt] = useState(row.system_prompt);
  const [tools, setTools] = useState<string[]>(() => [...row.tools_enabled]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statusDetail, setStatusDetail] = useState("");

  useEffect(() => {
    setName(row.name);
    setPrompt(row.system_prompt);
    setTools([...row.tools_enabled]);
  }, [row.id, row.updated_at, row.name, row.system_prompt, row.tools_enabled]);

  const patchMut = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      return await api.patch<ConfigRow>(`/api/admin/configs/${row.id}`, body);
    },
    onMutate: () => {
      setStatus("saving");
      setStatusDetail("");
    },
    onSuccess: (data) => {
      setStatus("saved");
      setStatusDetail(fmtWhen(typeof data.updated_at === "string" ? data.updated_at : String(data.updated_at)));
      qc.setQueryData(["admin", "configs"], (prev: ConfigRow[] | undefined) => {
        if (!prev) return [data];
        return prev.map((c) => (c.id === data.id ? data : c));
      });
      window.setTimeout(() => setStatus("idle"), 2000);
    },
    onError: (e) => {
      setStatus("error");
      setStatusDetail(errMsg(e));
    },
  });

  const savePatch = useCallback(
    (body: Record<string, unknown>) => {
      void patchMut.mutateAsync(body);
    },
    [patchMut],
  );

  useEffect(() => {
    if (prompt === row.system_prompt) return;
    const t = window.setTimeout(() => {
      savePatch({ system_prompt: prompt });
    }, 900);
    return () => window.clearTimeout(t);
  }, [prompt, row.system_prompt, savePatch]);

  const saveNameIfDirty = () => {
    const t = name.trim();
    if (!t) {
      setName(row.name);
      return;
    }
    if (t !== row.name) savePatch({ name: t });
  };

  const toggleTool = (tool: string) => {
    setTools((prev) => {
      const next = prev.includes(tool)
        ? prev.filter((x) => x !== tool)
        : [...prev, tool];
      savePatch({ tools_enabled: next });
      return next;
    });
  };

  const knownSet = new Set<string>(KNOWN_TOOLS);
  const extraTools = tools.filter((t) => !knownSet.has(t));

  return (
    <article className="co-card" data-testid={`config-editor-${row.id}`}>
      <div className="co-card-head">
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.05rem", letterSpacing: "-0.02em" }}>
            {row.name}
            <span className="co-muted" style={{ fontWeight: 400, marginLeft: "0.35rem" }}>
              #{row.id}
            </span>
          </div>
          <div style={{ marginTop: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            <span className={row.is_template ? "co-badge co-badge--accent" : "co-badge"}>
              {row.is_template ? "Template" : "User-Config"}
            </span>
            {!row.is_template && row.user_id && (
              <span className="co-badge">User {row.user_id.slice(0, 8)}…</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label className="co-field-label" htmlFor={`cfg-name-${row.id}`}>
          Anzeigename / agent_key
        </label>
        <input
          id={`cfg-name-${row.id}`}
          className="co-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveNameIfDirty}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label className="co-field-label" htmlFor={`cfg-prompt-${row.id}`}>
          System-Prompt
        </label>
        <textarea
          id={`cfg-prompt-${row.id}`}
          className="co-textarea"
          style={{ minHeight: 200 }}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          spellCheck={false}
        />
        <div className="co-muted" style={{ marginTop: "0.35rem", fontSize: "0.78rem" }}>
          {prompt.length.toLocaleString("de-DE")} Zeichen — speichert automatisch nach kurzer Pause
        </div>
      </div>

      <div>
        <span className="co-field-label" style={{ display: "inline", marginRight: "0.5rem" }}>
          Tools
        </span>
        <div className="co-chip-row" style={{ marginTop: "0.45rem" }}>
          {KNOWN_TOOLS.map((t) => (
            <button
              key={t}
              type="button"
              className={tools.includes(t) ? "co-chip co-chip--on" : "co-chip"}
              onClick={() => toggleTool(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {extraTools.length > 0 && (
          <p className="co-muted" style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
            Weitere aus der DB: {extraTools.join(", ")} — per API erweiterbar
          </p>
        )}
      </div>

      <div
        className={
          status === "error" ? "co-status-line co-status-line--error" : status === "saved"
            ? "co-status-line co-status-line--ok"
            : "co-status-line"
        }
      >
        {status === "saving" && "Speichern…"}
        {status === "saved" && `Gespeichert · ${statusDetail}`}
        {status === "error" && statusDetail}
        {status === "idle" && "\u00a0"}
      </div>
    </article>
  );
}

export function ConfigsPage() {
  const q = useQuery({
    queryKey: ["admin", "configs"],
    queryFn: () => api.get<ConfigRow[]>("/api/admin/configs"),
  });

  if (q.isPending) {
    return (
      <div className="co-admin-page">
        <p className="co-muted">Laden…</p>
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="co-admin-page">
        <p style={{ color: "var(--danger)" }}>{q.error instanceof Error ? q.error.message : "Fehler"}</p>
      </div>
    );
  }

  return (
    <div className="co-admin-page">
      <h2 className="co-admin-h2" data-testid="configs-page-title">
        Agent-Configs
      </h2>
      <p className="co-admin-lead">
        Inline bearbeiten: Name per <kbd style={{ fontSize: "0.8em" }}>Enter</kbd> oder Fokuswechsel,
        System-Prompt automatisch nach Tippenpause, Tools per Klick.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {q.data?.map((c) => (
          <ConfigEditor key={c.id} row={c} />
        ))}
      </div>
    </div>
  );
}
