import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";
import {
  addTeamMember,
  createProject,
  createTeam,
  createWorkTask,
  deleteWorkTask,
  getWorkTask,
  listProjects,
  listTeamMembers,
  listTeams,
  listTenantUsers,
  listWorkTasks,
  patchProject,
  patchTeam,
  patchWorkTask,
  removeTeamMember,
  withWorkspaceTx,
} from "../services/workspaceService.ts";
import { dispatchWorkspaceWiki } from "./workspace_wiki.ts";

export async function dispatchWorkspace(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  pathname: string,
): Promise<Response> {
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const wikiRes = await dispatchWorkspaceWiki(req, env, deps, pathname, userId);
  if (wikiRes) return wikiRes;

  const mMembersDel = pathname.match(
    /^\/api\/workspace\/teams\/([^/]+)\/members\/([^/]+)$/,
  );
  if (mMembersDel && req.method === "DELETE") {
    const teamId = mMembersDel[1]!;
    const memberId = mMembersDel[2]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      await removeTeamMember(tx, teamId, memberId);
      return { ok: true as const };
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  const mMembersGet = pathname.match(/^\/api\/workspace\/teams\/([^/]+)\/members$/);
  if (mMembersGet && req.method === "GET") {
    const teamId = mMembersGet[1]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await listTeamMembers(tx, teamId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  const mMembersPost = pathname.match(
    /^\/api\/workspace\/teams\/([^/]+)\/members$/,
  );
  if (mMembersPost && req.method === "POST") {
    const teamId = mMembersPost[1]!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const uid = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await addTeamMember(tx, tenantId, teamId, uid);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if ("error" in r.value) {
      return jsonResponse({ error: r.value.error }, { status: 400 });
    }
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/users" && req.method === "GET") {
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await listTenantUsers(tx, tenantId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/teams" && req.method === "GET") {
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await listTeams(tx);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/teams" && req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonResponse({ error: "name fehlt" }, { status: 400 });
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await createTeam(tx, tenantId, name);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value, { status: 201 });
  }

  const mTeamPatch = pathname.match(/^\/api\/workspace\/teams\/([^/]+)$/);
  if (mTeamPatch && req.method === "PATCH") {
    const teamId = mTeamPatch[1]!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonResponse({ error: "name fehlt" }, { status: 400 });
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await patchTeam(tx, teamId, name);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (!r.value) return jsonResponse({ error: "Team nicht gefunden" }, { status: 404 });
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/projects" && req.method === "GET") {
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await listProjects(tx);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/projects" && req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonResponse({ error: "name fehlt" }, { status: 400 });
    const description = typeof body.description === "string"
      ? body.description
      : body.description === null
      ? null
      : null;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await createProject(tx, tenantId, name, description);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value, { status: 201 });
  }

  const mProjPatch = pathname.match(/^\/api\/workspace\/projects\/([^/]+)$/);
  if (mProjPatch && req.method === "PATCH") {
    const projectId = mProjPatch[1]!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const patch: { name?: string; description?: string | null } = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (body.description === null || typeof body.description === "string") {
      patch.description = body.description as string | null;
    }
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await patchProject(tx, projectId, patch);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (!r.value) return jsonResponse({ error: "Projekt nicht gefunden" }, { status: 404 });
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/work-tasks" && req.method === "GET") {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("project_id");
    const status = url.searchParams.get("status");
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await listWorkTasks(tx, {
        project_id: projectId,
        status,
      });
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/work-tasks" && req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const project_id = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const title = typeof body.title === "string" ? body.title : "";
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await createWorkTask(tx, tenantId, userId, {
        project_id,
        title,
        description: typeof body.description === "string" ? body.description : undefined,
        status: typeof body.status === "string" ? body.status : undefined,
        priority: typeof body.priority === "string" ? body.priority : undefined,
        due_at: typeof body.due_at === "string" || body.due_at === null
          ? (body.due_at as string | null)
          : undefined,
        assignee_user_ids: Array.isArray(body.assignee_user_ids)
          ? body.assignee_user_ids.filter((x): x is string => typeof x === "string")
          : undefined,
        team_ids: Array.isArray(body.team_ids)
          ? body.team_ids.filter((x): x is string => typeof x === "string")
          : undefined,
      });
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if ("error" in r.value) {
      return jsonResponse({ error: r.value.error }, { status: 400 });
    }
    return jsonResponse(r.value, { status: 201 });
  }

  const mTaskOne = pathname.match(/^\/api\/workspace\/work-tasks\/([^/]+)$/);
  if (mTaskOne && req.method === "GET") {
    const taskId = mTaskOne[1]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await getWorkTask(tx, taskId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (!r.value) return jsonResponse({ error: "Task nicht gefunden" }, { status: 404 });
    return jsonResponse(r.value);
  }

  if (mTaskOne && req.method === "PATCH") {
    const taskId = mTaskOne[1]!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const patch: {
      title?: string;
      description?: string | null;
      status?: string;
      priority?: string;
      due_at?: string | null;
      project_id?: string;
      assignee_user_ids?: string[] | null;
      team_ids?: string[] | null;
    } = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (body.description === null || typeof body.description === "string") {
      patch.description = body.description as string | null;
    }
    if (typeof body.status === "string") patch.status = body.status;
    if (typeof body.priority === "string") patch.priority = body.priority;
    if (body.due_at === null || typeof body.due_at === "string") {
      patch.due_at = body.due_at as string | null;
    }
    if (typeof body.project_id === "string") patch.project_id = body.project_id;
    if (Array.isArray(body.assignee_user_ids)) {
      patch.assignee_user_ids = body.assignee_user_ids.filter((x): x is string =>
        typeof x === "string"
      );
    }
    if (Array.isArray(body.team_ids)) {
      patch.team_ids = body.team_ids.filter((x): x is string => typeof x === "string");
    }

    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await patchWorkTask(tx, tenantId, taskId, patch);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (r.value === null) {
      return jsonResponse({ error: "Task nicht gefunden" }, { status: 404 });
    }
    if ("error" in r.value) {
      return jsonResponse({ error: r.value.error }, { status: 400 });
    }
    return jsonResponse(r.value);
  }

  if (mTaskOne && req.method === "DELETE") {
    const taskId = mTaskOne[1]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await deleteWorkTask(tx, tenantId, taskId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (!r.value) {
      return jsonResponse({ error: "Task nicht gefunden" }, { status: 404 });
    }
    return jsonResponse({ deleted: true });
  }

  return new Response("Not Found", { status: 404 });
}
