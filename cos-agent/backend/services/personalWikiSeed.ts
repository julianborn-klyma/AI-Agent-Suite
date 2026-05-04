import type postgres from "postgres";
import {
  createWikiPage,
  getWikiPageBySlug,
} from "./workspaceWikiService.ts";
import { PERSONAL_WIKI_PAGES } from "./personalWikiConstants.ts";

type Tx = postgres.TransactionSql;

/**
 * Legt fehlende persönliche Wiki-Seiten (me-*) an — approved, scope user, Owner = userId.
 * Idempotent per Slug.
 */
export async function ensurePersonalWikiPages(
  tx: Tx,
  tenantId: string,
  userId: string,
): Promise<void> {
  for (const def of PERSONAL_WIKI_PAGES) {
    const existing = await getWikiPageBySlug(tx, def.slug);
    if (existing) continue;
    const r = await createWikiPage(tx, tenantId, userId, {
      slug: def.slug,
      title: def.title,
      body_md: def.initialBody,
      scope_audience: "user",
      status: "approved",
    });
    if (typeof r === "object" && "error" in r) {
      throw new Error(`personal wiki seed: ${def.slug}: ${r.error}`);
    }
  }
}
