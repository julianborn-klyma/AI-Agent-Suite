import type { DatabaseClient } from "../../db/databaseClient.ts";
import { withWorkspaceTx } from "../workspaceService.ts";
import { getWikiPageBySlug, listWikiPages } from "../workspaceWikiService.ts";
import type { Tool, ToolExecuteContext, ToolResult } from "./types.ts";

type WikiParams =
  | { action: "list_approved"; limit?: number }
  | { action: "get_approved_by_slug"; slug: string };

function parseParams(raw: unknown): WikiParams | { error: string } {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { error: "Ungültiges JSON" };
    }
  }
  if (v === null || typeof v !== "object") return { error: "Ungültige Parameter" };
  const o = v as Record<string, unknown>;
  const a = o.action;
  if (a === "list_approved") {
    const limit = typeof o.limit === "number" && Number.isFinite(o.limit)
      ? o.limit
      : undefined;
    return { action: "list_approved", limit };
  }
  if (a === "get_approved_by_slug") {
    const slug = typeof o.slug === "string" ? o.slug.trim() : "";
    if (!slug) return { error: "slug fehlt" };
    return { action: "get_approved_by_slug", slug };
  }
  return { error: "action: list_approved | get_approved_by_slug" };
}

export const workspaceWikiTool: Tool = {
  definition: {
    name: "workspace_wiki",
    description:
      "Liest nur **freigegebene** (status approved) Wiki-Seiten des eigenen Tenants. Keine Bearbeitung.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_approved", "get_approved_by_slug"],
        },
        limit: {
          type: "number",
          description: "Max. 25, nur bei list_approved (Standard 15)",
        },
        slug: { type: "string", description: "Seiten-Slug, nur bei get_approved_by_slug" },
      },
      required: ["action"],
    },
  },

  async execute(
    raw: unknown,
    userId: string,
    _db: DatabaseClient,
    ctx?: ToolExecuteContext,
  ): Promise<ToolResult> {
    const sql = ctx?.sql;
    if (!sql) {
      return {
        success: false,
        error: "workspace_wiki: Postgres nicht verfügbar (Server-Konfiguration).",
      };
    }
    const p = parseParams(raw);
    if ("error" in p) return { success: false, error: p.error };

    const r = await withWorkspaceTx(sql, userId, async (tx) => {
      if (p.action === "list_approved") {
        const limit = Math.min(25, Math.max(1, Math.floor(p.limit ?? 15)));
        const pages = await listWikiPages(tx, { status: "approved" });
        return {
          pages: pages.slice(0, limit).map((x) => ({
            slug: x.slug,
            title: x.title,
            status: x.status,
          })),
        };
      }
      const page = await getWikiPageBySlug(tx, p.slug);
      if (!page || page.status !== "approved") {
        return { found: false as const };
      }
      let body = page.body_md;
      if (body.length > 8000) body = `${body.slice(0, 8000)}\n…(gekürzt)`;
      return {
        found: true as const,
        slug: page.slug,
        title: page.title,
        body_md: body,
        version: page.version,
      };
    });
    if (!r.ok) return { success: false, error: r.message };
    return { success: true, data: r.value };
  },
};
