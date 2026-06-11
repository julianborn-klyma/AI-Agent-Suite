import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import {
  BrainForbiddenError,
  BrainNotFoundError,
} from "../db/databaseClient.ts";
import type { BrainEntryType } from "../db/databaseClient.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_ENTRY_TYPES = new Set<BrainEntryType>([
  "fact",
  "decision",
  "preference",
  "context",
  "process",
]);

function brainErrResponse(e: unknown): Response | null {
  if (e instanceof BrainForbiddenError) {
    return jsonResponse({ error: e.message || "Forbidden" }, { status: 403 });
  }
  if (e instanceof BrainNotFoundError) {
    return jsonResponse({ error: e.message || "Nicht gefunden" }, { status: 404 });
  }
  return null;
}

async function parseBody(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
  }
}

export async function dispatchBrain(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  pathname: string,
): Promise<Response | null> {
  if (!pathname.startsWith("/api/brain/")) return null;

  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const tenant = await deps.db.getTenantForUser(userId);
  if (!tenant) return jsonResponse({ error: "Tenant nicht gefunden." }, { status: 403 });
  const tenantId = tenant.id;

  try {
    // POST /api/brain/projects
    if (pathname === "/api/brain/projects" && req.method === "POST") {
      const body = await parseBody(req);
      if (body instanceof Response) return body;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return jsonResponse({ error: "name ist Pflicht." }, { status: 400 });
      const project = await deps.brainService.createProject(tenantId, userId, {
        name,
        description: typeof body.description === "string" ? body.description : null,
        color: typeof body.color === "string" ? body.color : undefined,
      });
      return jsonResponse(project, { status: 201 });
    }

    // GET /api/brain/projects
    if (pathname === "/api/brain/projects" && req.method === "GET") {
      const projects = await deps.brainService.getProjectsForUser(userId, tenantId);
      return jsonResponse(projects);
    }

    // /api/brain/entries/:id  (no project prefix)
    const mEntry = pathname.match(/^\/api\/brain\/entries\/([^/]+)$/);
    if (mEntry) {
      const entryId = mEntry[1]!;
      if (req.method === "PATCH") {
        const body = await parseBody(req);
        if (body instanceof Response) return body;
        const entry = await deps.brainService.updateEntry(entryId, userId, {
          content: typeof body.content === "string" ? body.content : undefined,
          source: body.source !== undefined
            ? (typeof body.source === "string" ? body.source : null)
            : undefined,
          confidence: typeof body.confidence === "number" ? body.confidence : undefined,
          tags: Array.isArray(body.tags)
            ? body.tags.filter((t): t is string => typeof t === "string")
            : undefined,
          expires_at: body.expires_at !== undefined
            ? (typeof body.expires_at === "string" ? body.expires_at : null)
            : undefined,
        });
        return jsonResponse(entry);
      }
      if (req.method === "DELETE") {
        await deps.brainService.deleteEntry(entryId, userId);
        return jsonResponse({ deleted: true });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    // /api/brain/conflicts/:id/resolve
    const mConflict = pathname.match(/^\/api\/brain\/conflicts\/([^/]+)\/resolve$/);
    if (mConflict) {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      await deps.brainService.resolveConflict(mConflict[1]!, userId);
      return jsonResponse({ resolved: true });
    }

    // /api/brain/projects/:id/...
    const mProject = pathname.match(/^\/api\/brain\/projects\/([^/]+)(\/.*)?$/);
    if (mProject) {
      const projectId = mProject[1]!;
      if (!UUID_RE.test(projectId)) {
        return jsonResponse({ error: "Ungültige Projekt-ID." }, { status: 400 });
      }
      const subpath = mProject[2] ?? "";

      // /api/brain/projects/:id/members/:uid
      const mMember = subpath.match(/^\/members\/([^/]+)$/);
      if (mMember) {
        const targetUid = mMember[1]!;
        if (req.method === "PATCH") {
          const body = await parseBody(req);
          if (body instanceof Response) return body;
          const role = typeof body.role === "string" ? body.role.trim() : "";
          if (role !== "knowledge_owner" && role !== "member") {
            return jsonResponse(
              { error: 'role muss "knowledge_owner" oder "member" sein.' },
              { status: 400 },
            );
          }
          await deps.brainService.setMemberRole(
            projectId,
            targetUid,
            role as "knowledge_owner" | "member",
            userId,
          );
          return jsonResponse({ updated: true });
        }
        if (req.method === "DELETE") {
          await deps.brainService.removeMember(projectId, targetUid, userId);
          return jsonResponse({ removed: true });
        }
        return new Response("Method Not Allowed", { status: 405 });
      }

      // /api/brain/projects/:id/members
      if (subpath === "/members") {
        if (req.method === "GET") {
          const members = await deps.brainService.getProjectMembers(projectId, userId);
          return jsonResponse(members);
        }
        if (req.method === "POST") {
          const body = await parseBody(req);
          if (body instanceof Response) return body;
          const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
          if (!targetUserId) {
            return jsonResponse({ error: "userId ist Pflicht." }, { status: 400 });
          }
          const role = typeof body.role === "string" ? body.role.trim() : "";
          if (role !== "knowledge_owner" && role !== "member") {
            return jsonResponse(
              { error: 'role muss "knowledge_owner" oder "member" sein.' },
              { status: 400 },
            );
          }
          const member = await deps.brainService.inviteMember(
            projectId,
            targetUserId,
            role as "knowledge_owner" | "member",
            userId,
          );
          return jsonResponse(member, { status: 201 });
        }
        return new Response("Method Not Allowed", { status: 405 });
      }

      // /api/brain/projects/:id/entries
      if (subpath === "/entries") {
        if (req.method === "GET") {
          const url = new URL(req.url);
          const typeParam = url.searchParams.get("type") ?? undefined;
          const type = typeParam && VALID_ENTRY_TYPES.has(typeParam as BrainEntryType)
            ? (typeParam as BrainEntryType)
            : undefined;
          const entries = await deps.brainService.getEntries(projectId, userId, { type });
          return jsonResponse(entries);
        }
        if (req.method === "POST") {
          const body = await parseBody(req);
          if (body instanceof Response) return body;
          const type = typeof body.type === "string" ? body.type.trim() : "";
          if (!type || !VALID_ENTRY_TYPES.has(type as BrainEntryType)) {
            return jsonResponse(
              { error: 'type muss "fact", "decision", "preference", "context" oder "process" sein.' },
              { status: 400 },
            );
          }
          const content = typeof body.content === "string" ? body.content.trim() : "";
          if (!content) {
            return jsonResponse({ error: "content ist Pflicht." }, { status: 400 });
          }
          const result = await deps.brainService.addEntry(projectId, userId, {
            type: type as BrainEntryType,
            content,
            source: typeof body.source === "string" ? body.source : null,
            confidence: typeof body.confidence === "number" ? body.confidence : undefined,
            tags: Array.isArray(body.tags)
              ? body.tags.filter((t): t is string => typeof t === "string")
              : undefined,
            expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
          });
          return jsonResponse(result, { status: 201 });
        }
        return new Response("Method Not Allowed", { status: 405 });
      }

      // /api/brain/projects/:id/conflicts
      if (subpath === "/conflicts" && req.method === "GET") {
        const conflicts = await deps.brainService.getConflicts(projectId, userId);
        return jsonResponse(conflicts);
      }

      // /api/brain/projects/:id  (root)
      if (!subpath) {
        if (req.method === "GET") {
          const project = await deps.brainService.getProjectById(projectId, userId);
          return jsonResponse(project);
        }
        if (req.method === "PATCH") {
          const body = await parseBody(req);
          if (body instanceof Response) return body;
          const project = await deps.brainService.updateProject(projectId, userId, {
            name: typeof body.name === "string" ? body.name : undefined,
            description: body.description !== undefined
              ? (typeof body.description === "string" ? body.description : null)
              : undefined,
            color: typeof body.color === "string" ? body.color : undefined,
          });
          return jsonResponse(project);
        }
        if (req.method === "DELETE") {
          await deps.brainService.deleteProject(projectId, userId);
          return jsonResponse({ deleted: true });
        }
        return new Response("Method Not Allowed", { status: 405 });
      }
    }

    return null;
  } catch (e) {
    const r = brainErrResponse(e);
    if (r) return r;
    throw e;
  }
}
