import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { jsonResponse } from "./json.ts";
import {
  createWikiPage,
  deleteWikiPage,
  getWikiPage,
  getWikiPageBySlug,
  listWikiBacklinks,
  listWikiOutgoingLinks,
  listWikiPages,
  patchWikiPage,
} from "../services/workspaceWikiService.ts";
import { withWorkspaceTx } from "../services/workspaceService.ts";

export async function dispatchWorkspaceWiki(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  pathname: string,
  userId: string,
): Promise<Response | null> {
  void env;

  const mBySlugGet = pathname.match(/^\/api\/workspace\/wiki-pages\/by-slug\/(.+)$/);
  if (mBySlugGet && req.method === "GET") {
    const raw = decodeURIComponent(mBySlugGet[1]!.replace(/\/+$/, ""));
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await getWikiPageBySlug(tx, raw);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (!r.value) return jsonResponse({ error: "Seite nicht gefunden" }, { status: 404 });
    return jsonResponse(r.value);
  }

  const mOutgoing = pathname.match(
    /^\/api\/workspace\/wiki-pages\/([0-9a-fA-F-]{36})\/outgoing-links$/,
  );
  if (mOutgoing && req.method === "GET") {
    const pageId = mOutgoing[1]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await listWikiOutgoingLinks(tx, pageId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  const mBacklinks = pathname.match(
    /^\/api\/workspace\/wiki-pages\/([0-9a-fA-F-]{36})\/backlinks$/,
  );
  if (mBacklinks && req.method === "GET") {
    const pageId = mBacklinks[1]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await listWikiBacklinks(tx, pageId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  const mOne = pathname.match(/^\/api\/workspace\/wiki-pages\/([^/]+)$/);
  if (mOne && req.method === "GET") {
    const pageId = mOne[1]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await getWikiPage(tx, pageId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (!r.value) return jsonResponse({ error: "Seite nicht gefunden" }, { status: 404 });
    return jsonResponse(r.value);
  }

  if (mOne && req.method === "PATCH") {
    const pageId = mOne[1]!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await patchWikiPage(tx, tenantId, pageId, userId, {
        slug: typeof body.slug === "string" ? body.slug : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        body_md: typeof body.body_md === "string" ? body.body_md : undefined,
        frontmatter_json: body.frontmatter_json,
        scope_audience: typeof body.scope_audience === "string"
          ? body.scope_audience
          : undefined,
        status: typeof body.status === "string" ? body.status : undefined,
      });
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (r.value === null) {
      return jsonResponse({ error: "Seite nicht gefunden" }, { status: 404 });
    }
    if ("error" in r.value) {
      const st = r.value.code === "slug_taken" ? 409 : 400;
      return jsonResponse({ error: r.value.error }, { status: st });
    }
    return jsonResponse(r.value);
  }

  if (mOne && req.method === "DELETE") {
    const pageId = mOne[1]!;
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await deleteWikiPage(tx, tenantId, pageId);
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if (!r.value) return jsonResponse({ error: "Seite nicht gefunden" }, { status: 404 });
    return jsonResponse({ deleted: true });
  }

  if (pathname === "/api/workspace/wiki-pages" && req.method === "GET") {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const r = await withWorkspaceTx(deps.sql, userId, async (tx) => {
      return await listWikiPages(tx, { status });
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    return jsonResponse(r.value);
  }

  if (pathname === "/api/workspace/wiki-pages" && req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
    }
    const slug = typeof body.slug === "string" ? body.slug : "";
    const title = typeof body.title === "string" ? body.title : "";
    const r = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
      return await createWikiPage(tx, tenantId, userId, {
        slug,
        title,
        body_md: typeof body.body_md === "string" ? body.body_md : undefined,
        scope_audience: typeof body.scope_audience === "string"
          ? body.scope_audience
          : undefined,
        frontmatter_json: body.frontmatter_json,
        status: typeof body.status === "string" ? body.status : undefined,
      });
    });
    if (!r.ok) return jsonResponse({ error: r.message }, { status: r.status });
    if ("error" in r.value) {
      const st = r.value.code === "slug_taken" ? 409 : 400;
      return jsonResponse({ error: r.value.error }, { status: st });
    }
    return jsonResponse(r.value, { status: 201 });
  }

  return null;
}
