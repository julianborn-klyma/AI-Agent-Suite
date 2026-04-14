import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import type { TaskQueueRow } from "../db/databaseClient.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";

const PRIORITIES = new Set(["urgent", "high", "medium", "low"]);

function parseLimit(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return fallback;
  return n;
}

function taskToJson(t: TaskQueueRow) {
  return {
    id: t.id,
    user_id: t.user_id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    document_ids: t.document_ids,
    context: t.context,
    result: t.result,
    result_notion_page_id: t.result_notion_page_id,
    result_draft_id: t.result_draft_id,
    error_message: t.error_message,
    started_at: t.started_at?.toISOString() ?? null,
    completed_at: t.completed_at?.toISOString() ?? null,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

export async function handleTasksPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return jsonResponse({ error: "title fehlt oder ist leer" }, { status: 400 });
  }
  if (title.length > 200) {
    return jsonResponse({ error: "title zu lang (max. 200 Zeichen)" }, { status: 400 });
  }

  const description = typeof body.description === "string"
    ? body.description.trim()
    : "";
  if (!description) {
    return jsonResponse(
      { error: "description fehlt oder ist leer" },
      { status: 400 },
    );
  }
  if (description.length > 5000) {
    return jsonResponse(
      { error: "description zu lang (max. 5000 Zeichen)" },
      { status: 400 },
    );
  }

  const pr = typeof body.priority === "string" ? body.priority.trim() : "medium";
  if (!PRIORITIES.has(pr)) {
    return jsonResponse({ error: "priority ungültig" }, { status: 400 });
  }

  let document_ids: string[] | undefined;
  if (body.document_ids !== undefined && body.document_ids !== null) {
    if (!Array.isArray(body.document_ids)) {
      return jsonResponse({ error: "document_ids muss ein Array sein" }, {
        status: 400,
      });
    }
    document_ids = [];
    for (const x of body.document_ids) {
      if (typeof x !== "string" || !x.trim()) {
        return jsonResponse({ error: "document_ids enthält ungültige Einträge" }, {
          status: 400,
        });
      }
      const id = x.trim();
      const doc = await deps.db.getDocument(id, userId);
      if (!doc) {
        return jsonResponse(
          { error: "Dokument nicht gefunden oder keine Berechtigung" },
          { status: 403 },
        );
      }
      document_ids.push(id);
    }
  }

  const context = typeof body.context === "string" ? body.context : undefined;

  const task = await deps.db.insertTask(userId, {
    title,
    description,
    priority: pr,
    document_ids,
    context,
  });
  return jsonResponse(taskToJson(task), { status: 201 });
}

export async function handleTasksList(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const st = url.searchParams.get("status")?.trim() || undefined;
  if (st && !["pending", "running", "completed", "failed", "cancelled"].includes(st)) {
    return jsonResponse({ error: "status ungültig" }, { status: 400 });
  }
  const limit = parseLimit(url.searchParams.get("limit"), 20);

  const rows = await deps.db.getTasks(userId, { status: st, limit });
  return jsonResponse(rows.map(taskToJson));
}

export async function handleTaskGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const task = await deps.db.getTask(id, userId);
  if (!task) return new Response("Not Found", { status: 404 });
  return jsonResponse(taskToJson(task));
}

export async function handleTaskDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const r = await deps.db.cancelTask(id, userId);
  if (r.ok) return jsonResponse({ cancelled: true });
  if (r.reason === "not_found") return new Response("Not Found", { status: 404 });
  return jsonResponse(
    { error: "Task kann nicht abgebrochen werden" },
    { status: 409 },
  );
}
