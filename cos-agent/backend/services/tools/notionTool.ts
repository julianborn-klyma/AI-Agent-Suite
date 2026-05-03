import type { DatabaseClient } from "../../db/databaseClient.ts";
import { getCredential } from "./credentialHelper.ts";
import type { Tool, ToolResult } from "./types.ts";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const MISSING_TOKEN =
  "Notion nicht verbunden. Bitte notion_token im Kontext hinterlegen.";

export type NotionAction =
  | { action: "list_tasks"; database_id: string }
  | {
    action: "add_task";
    database_id: string;
    title: string;
    priority: "high" | "medium" | "low";
    project?: string;
    deadline?: string;
  }
  | { action: "update_task"; page_id: string; status: string }
  | { action: "get_today_tasks"; database_id: string };

function notionApiError(status: number): ToolResult {
  return {
    success: false,
    error: `Notion API Fehler: ${status}`,
  };
}

async function notionFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  const res = await fetch(`${NOTION_API}/${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  try {
    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, status: res.status };
  }
}

function todayIsoBerlin(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

function titleFromProperties(props: Record<string, unknown>): string | undefined {
  const name = props["Name"] as { title?: { plain_text?: string }[] } | undefined;
  if (!name?.title?.length) return undefined;
  return name.title.map((t) => t.plain_text ?? "").join("");
}

function statusFromProperties(props: Record<string, unknown>): string | undefined {
  const st = props["Status"] as { status?: { name?: string } } | undefined;
  return st?.status?.name;
}

function slimQueryResults(data: unknown): unknown {
  if (data === null || typeof data !== "object") return data;
  const o = data as { results?: unknown[] };
  const results = o.results ?? [];
  return {
    pages: results.map((raw) => {
      if (raw === null || typeof raw !== "object") return raw;
      const p = raw as Record<string, unknown>;
      const props = (p.properties ?? {}) as Record<string, unknown>;
      return {
        id: p.id,
        url: p.url,
        title: titleFromProperties(props),
        status: statusFromProperties(props),
      };
    }),
  };
}

function slimPage(data: unknown): unknown {
  if (data === null || typeof data !== "object") return data;
  const p = data as Record<string, unknown>;
  const props = (p.properties ?? {}) as Record<string, unknown>;
  return {
    id: p.id,
    url: p.url,
    title: titleFromProperties(props),
    status: statusFromProperties(props),
  };
}

function parseParams(raw: unknown): NotionAction | { error: string } {
  let p = raw;
  if (typeof p === "string") {
    try {
      p = JSON.parse(p);
    } catch {
      return { error: "Ungültiges JSON." };
    }
  }
  if (p === null || typeof p !== "object") {
    return { error: "Parameter müssen ein Objekt sein." };
  }
  const o = p as Record<string, unknown>;
  const action = o.action;
  if (action === "list_tasks") {
    if (typeof o.database_id !== "string" || !o.database_id) {
      return { error: "database_id fehlt." };
    }
    return { action: "list_tasks", database_id: o.database_id };
  }
  if (action === "add_task") {
    if (typeof o.database_id !== "string" || !o.database_id) {
      return { error: "database_id fehlt." };
    }
    if (typeof o.title !== "string" || !o.title) {
      return { error: "title fehlt." };
    }
    const pr = o.priority;
    if (pr !== "high" && pr !== "medium" && pr !== "low") {
      return { error: "priority ungültig." };
    }
    return {
      action: "add_task",
      database_id: o.database_id,
      title: o.title,
      priority: pr,
      project: typeof o.project === "string" ? o.project : undefined,
      deadline: typeof o.deadline === "string" ? o.deadline : undefined,
    };
  }
  if (action === "update_task") {
    if (typeof o.page_id !== "string" || !o.page_id) {
      return { error: "page_id fehlt." };
    }
    if (typeof o.status !== "string") {
      return { error: "status fehlt." };
    }
    return { action: "update_task", page_id: o.page_id, status: o.status };
  }
  if (action === "get_today_tasks") {
    if (typeof o.database_id !== "string" || !o.database_id) {
      return { error: "database_id fehlt." };
    }
    return { action: "get_today_tasks", database_id: o.database_id };
  }
  return { error: `Unbekannte action: ${String(action)}` };
}

async function runAction(
  token: string,
  action: NotionAction,
  now: Date,
): Promise<ToolResult> {
  switch (action.action) {
    case "list_tasks": {
      const body = {
        page_size: 100,
        filter: {
          property: "Status",
          status: { does_not_equal: "Done" },
        },
      };
      const r = await notionFetch(
        token,
        `databases/${action.database_id}/query`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (!r.ok) return notionApiError(r.status);
      return { success: true, data: slimQueryResults(r.data) };
    }
    case "get_today_tasks": {
      const day = todayIsoBerlin(now);
      const body = {
        page_size: 100,
        filter: {
          or: [
            { property: "Deadline", date: { equals: day } },
            { property: "Priority", select: { equals: "high" } },
          ],
        },
      };
      const r = await notionFetch(
        token,
        `databases/${action.database_id}/query`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (!r.ok) return notionApiError(r.status);
      return { success: true, data: slimQueryResults(r.data) };
    }
    case "add_task": {
      const properties: Record<string, unknown> = {
        Name: {
          title: [{ type: "text", text: { content: action.title } }],
        },
        Priority: { select: { name: action.priority } },
      };
      if (action.project) {
        properties.Project = {
          rich_text: [{ type: "text", text: { content: action.project } }],
        };
      }
      if (action.deadline) {
        properties.Deadline = { date: { start: action.deadline } };
      }
      const r = await notionFetch(token, "pages", {
        method: "POST",
        body: JSON.stringify({
          parent: { database_id: action.database_id },
          properties,
        }),
      });
      if (!r.ok) return notionApiError(r.status);
      return { success: true, data: slimPage(r.data) };
    }
    case "update_task": {
      const r = await notionFetch(token, `pages/${action.page_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          properties: {
            Status: { status: { name: action.status } },
          },
        }),
      });
      if (!r.ok) return notionApiError(r.status);
      return { success: true, data: slimPage(r.data) };
    }
  }
}

export const notionTool: Tool = {
  definition: {
    name: "notion",
    description:
      "Notion-Aufgaben (DB): listen (ohne Done), heute/hoch, anlegen, Status setzen. Properties: Name, Status, Priority, Project, Deadline.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_tasks", "add_task", "update_task", "get_today_tasks"],
        },
        database_id: { type: "string" },
        page_id: { type: "string" },
        title: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        project: { type: "string" },
        deadline: { type: "string" },
        status: { type: "string" },
      },
      required: ["action"],
    },
  },

  async execute(
    params: unknown,
    userId: string,
    db: DatabaseClient,
    _ctx?: unknown,
  ): Promise<ToolResult> {
    const token = await getCredential(db, userId, "notion_token");
    if (!token) {
      return { success: false, error: MISSING_TOKEN };
    }
    const parsed = parseParams(params);
    if ("error" in parsed) {
      return { success: false, error: parsed.error };
    }
    return await runAction(token, parsed, new Date());
  },
};
