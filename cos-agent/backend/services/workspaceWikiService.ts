import type postgres from "postgres";

type Tx = postgres.TransactionSql;
type JsonValue = postgres.JSONValue;

export type WikiPageRow = {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  body_md: string;
  frontmatter_json: Record<string, unknown>;
  scope_tenant: "tenant";
  scope_audience: "user" | "team" | "company" | "platform";
  owner_user_id: string | null;
  status: "draft" | "approved" | "deprecated";
  version: number;
  created_at: string;
  updated_at: string;
};

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(s);
}

/** URL-freundlicher Slug: nur Kleinbuchstaben, Ziffern, Bindestriche. */
export function normalizeWikiSlug(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
  if (s.length < 1 || s.length > 200) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return null;
  return s;
}

function parseFrontmatter(raw: unknown):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { ok: true, value: raw as Record<string, unknown> };
  }
  return { ok: false, error: "frontmatter_json muss ein Objekt sein" };
}

const AUDIENCES = new Set(["user", "team", "company", "platform"]);
const STATUSES = new Set(["draft", "approved", "deprecated"]);

export async function listWikiPages(
  tx: Tx,
  filters: { status: string | null },
): Promise<WikiPageRow[]> {
  const st = filters.status && STATUSES.has(filters.status)
    ? filters.status
    : null;
  const rows = await tx`
    SELECT
      id::text,
      tenant_id::text,
      slug,
      title,
      body_md,
      frontmatter_json,
      scope_tenant,
      scope_audience,
      owner_user_id::text,
      status,
      version,
      created_at,
      updated_at
    FROM app.wiki_pages
    WHERE tenant_id IS NOT NULL
      AND (${st}::text IS NULL OR status = ${st})
    ORDER BY slug ASC
    LIMIT 500
  ` as {
    id: string;
    tenant_id: string;
    slug: string;
    title: string;
    body_md: string;
    frontmatter_json: Record<string, unknown>;
    scope_tenant: "tenant";
    scope_audience: WikiPageRow["scope_audience"];
    owner_user_id: string | null;
    status: WikiPageRow["status"];
    version: number;
    created_at: Date;
    updated_at: Date;
  }[];
  return rows.map((r) => ({
    ...r,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }));
}

export type WikiOutgoingLinkRow = {
  to_slug: string;
  to_page_id: string | null;
  target_title: string | null;
  resolved: boolean;
};

export type WikiBacklinkRow = {
  from_page_id: string;
  from_slug: string;
  from_title: string;
};

/** Tenant-Seite per Slug (normalisiert wie bei create). */
export async function getWikiPageBySlug(
  tx: Tx,
  slugInput: string,
): Promise<WikiPageRow | null> {
  const slug = normalizeWikiSlug(slugInput.trim());
  if (!slug) return null;
  const rows = await tx`
    SELECT
      id::text,
      tenant_id::text,
      slug,
      title,
      body_md,
      frontmatter_json,
      scope_tenant,
      scope_audience,
      owner_user_id::text,
      status,
      version,
      created_at,
      updated_at
    FROM app.wiki_pages
    WHERE tenant_id IS NOT NULL
      AND lower(slug) = ${slug}
    LIMIT 1
  ` as {
    id: string;
    tenant_id: string;
    slug: string;
    title: string;
    body_md: string;
    frontmatter_json: Record<string, unknown>;
    scope_tenant: "tenant";
    scope_audience: WikiPageRow["scope_audience"];
    owner_user_id: string | null;
    status: WikiPageRow["status"];
    version: number;
    created_at: Date;
    updated_at: Date;
  }[];
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function listWikiOutgoingLinks(
  tx: Tx,
  fromPageId: string,
): Promise<WikiOutgoingLinkRow[]> {
  if (!isUuid(fromPageId)) return [];
  const rows = await tx`
    SELECT
      l.to_slug,
      l.to_page_id::text,
      p.title AS target_title
    FROM app.wiki_links l
    LEFT JOIN app.wiki_pages p ON p.id = l.to_page_id
    WHERE l.from_page_id = ${fromPageId}::uuid
    ORDER BY l.to_slug ASC
  ` as {
    to_slug: string;
    to_page_id: string | null;
    target_title: string | null;
  }[];
  return rows.map((r) => ({
    to_slug: r.to_slug,
    to_page_id: r.to_page_id,
    target_title: r.target_title,
    resolved: r.to_page_id !== null,
  }));
}

export async function listWikiBacklinks(
  tx: Tx,
  toPageId: string,
): Promise<WikiBacklinkRow[]> {
  if (!isUuid(toPageId)) return [];
  const rows = await tx`
    SELECT
      l.from_page_id::text,
      fp.slug AS from_slug,
      fp.title AS from_title
    FROM app.wiki_links l
    INNER JOIN app.wiki_pages fp ON fp.id = l.from_page_id
    WHERE l.to_page_id = ${toPageId}::uuid
    ORDER BY fp.slug ASC
  ` as {
    from_page_id: string;
    from_slug: string;
    from_title: string;
  }[];
  return rows;
}

export async function getWikiPage(tx: Tx, pageId: string): Promise<WikiPageRow | null> {
  if (!isUuid(pageId)) return null;
  const rows = await tx`
    SELECT
      id::text,
      tenant_id::text,
      slug,
      title,
      body_md,
      frontmatter_json,
      scope_tenant,
      scope_audience,
      owner_user_id::text,
      status,
      version,
      created_at,
      updated_at
    FROM app.wiki_pages
    WHERE id = ${pageId}::uuid
      AND tenant_id IS NOT NULL
    LIMIT 1
  ` as {
    id: string;
    tenant_id: string;
    slug: string;
    title: string;
    body_md: string;
    frontmatter_json: Record<string, unknown>;
    scope_tenant: "tenant";
    scope_audience: WikiPageRow["scope_audience"];
    owner_user_id: string | null;
    status: WikiPageRow["status"];
    version: number;
    created_at: Date;
    updated_at: Date;
  }[];
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/** Extrahiert `[[ziel-slug]]` und schreibt `app.wiki_links` (Tenant-Seiten). */
export async function syncWikiLinksFromBody(
  tx: Tx,
  tenantId: string,
  fromPageId: string,
  bodyMd: string,
): Promise<void> {
  await tx`DELETE FROM app.wiki_links WHERE from_page_id = ${fromPageId}::uuid`;
  const re = /\[\[([a-z0-9][a-z0-9-]{0,199})\]\]/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyMd)) !== null) {
    const toSlug = m[1]!.toLowerCase();
    if (seen.has(toSlug)) continue;
    seen.add(toSlug);
    const target = await tx`
      SELECT id::text FROM app.wiki_pages
      WHERE tenant_id = ${tenantId}::uuid AND lower(slug) = ${toSlug}
      LIMIT 1
    ` as { id: string }[];
    const toPageId = target[0]?.id ?? null;
    if (toPageId) {
      await tx`
        INSERT INTO app.wiki_links (tenant_id, from_page_id, to_slug, to_page_id)
        VALUES (${tenantId}::uuid, ${fromPageId}::uuid, ${toSlug}, ${toPageId}::uuid)
      `;
    } else {
      await tx`
        INSERT INTO app.wiki_links (tenant_id, from_page_id, to_slug, to_page_id)
        VALUES (${tenantId}::uuid, ${fromPageId}::uuid, ${toSlug}, NULL)
      `;
    }
  }
}

export async function createWikiPage(
  tx: Tx,
  tenantId: string,
  userId: string,
  body: {
    slug: string;
    title: string;
    body_md?: string;
    scope_audience?: string;
    frontmatter_json?: unknown;
    status?: string;
  },
): Promise<WikiPageRow | { error: string; code?: "slug_taken" }> {
  const slug = normalizeWikiSlug(body.slug);
  if (!slug) return { error: "slug ungültig (nur a-z, 0-9, Bindestriche)" };
  const title = body.title.trim();
  if (!title || title.length > 500) return { error: "title fehlt oder zu lang" };
  const bodyMd = typeof body.body_md === "string" ? body.body_md : "";
  const fm = parseFrontmatter(body.frontmatter_json);
  if (!fm.ok) return { error: fm.error };
  const fmObj = fm.value;
  const audience = body.scope_audience && AUDIENCES.has(body.scope_audience)
    ? body.scope_audience as WikiPageRow["scope_audience"]
    : "company";
  const status = body.status && STATUSES.has(body.status)
    ? body.status as WikiPageRow["status"]
    : "draft";
  const ownerUserId = audience === "user" ? userId : null;

  try {
    const rows = await tx`
      INSERT INTO app.wiki_pages (
        tenant_id,
        slug,
        title,
        body_md,
        frontmatter_json,
        scope_tenant,
        scope_audience,
        owner_user_id,
        status
      )
      VALUES (
        ${tenantId}::uuid,
        ${slug},
        ${title},
        ${bodyMd},
        ${tx.json(fmObj as JsonValue)}::jsonb,
        'tenant',
        ${audience},
        ${ownerUserId},
        ${status}
      )
      RETURNING id::text
    ` as { id: string }[];
    const id = rows[0]!.id;
    await syncWikiLinksFromBody(tx, tenantId, id, bodyMd);
    return await getWikiPage(tx, id) as WikiPageRow;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { error: "Slug bereits vergeben", code: "slug_taken" };
    }
    throw e;
  }
}

export async function patchWikiPage(
  tx: Tx,
  tenantId: string,
  pageId: string,
  editorUserId: string,
  patch: {
    slug?: string;
    title?: string;
    body_md?: string;
    frontmatter_json?: unknown;
    scope_audience?: string;
    status?: string;
  },
): Promise<WikiPageRow | { error: string; code?: "slug_taken" } | null> {
  if (!isUuid(pageId)) return null;
  const cur = await getWikiPage(tx, pageId);
  if (!cur) return null;

  let slug = cur.slug;
  if (patch.slug !== undefined) {
    const n = normalizeWikiSlug(patch.slug);
    if (!n) return { error: "slug ungültig" };
    slug = n;
  }
  const title = patch.title !== undefined ? patch.title.trim() : cur.title;
  if (!title || title.length > 500) return { error: "title ungültig" };
  const bodyMd = patch.body_md !== undefined ? patch.body_md : cur.body_md;

  let frontmatter = cur.frontmatter_json;
  if (patch.frontmatter_json !== undefined) {
    const fm = parseFrontmatter(patch.frontmatter_json);
    if (!fm.ok) return { error: fm.error };
    frontmatter = fm.value;
  }

  let audience = cur.scope_audience;
  if (patch.scope_audience !== undefined && AUDIENCES.has(patch.scope_audience)) {
    audience = patch.scope_audience as WikiPageRow["scope_audience"];
  }

  let status = cur.status;
  if (patch.status !== undefined && STATUSES.has(patch.status)) {
    status = patch.status as WikiPageRow["status"];
  }

  let ownerUserId: string | null = cur.owner_user_id;
  if (audience === "user") {
    ownerUserId = cur.owner_user_id ?? editorUserId;
  } else {
    ownerUserId = null;
  }

  try {
    await tx`
      UPDATE app.wiki_pages
      SET
        slug = ${slug},
        title = ${title},
        body_md = ${bodyMd},
        frontmatter_json = ${tx.json(frontmatter as JsonValue)}::jsonb,
        scope_audience = ${audience},
        owner_user_id = ${ownerUserId},
        status = ${status},
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${pageId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;
    await syncWikiLinksFromBody(tx, tenantId, pageId, bodyMd);
    return await getWikiPage(tx, pageId) as WikiPageRow;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { error: "Slug bereits vergeben", code: "slug_taken" };
    }
    throw e;
  }
}

export async function deleteWikiPage(
  tx: Tx,
  tenantId: string,
  pageId: string,
): Promise<boolean> {
  if (!isUuid(pageId)) return false;
  const rows = await tx`
    DELETE FROM app.wiki_pages
    WHERE id = ${pageId}::uuid
      AND tenant_id = ${tenantId}::uuid
    RETURNING id
  ` as { id: string }[];
  return rows.length > 0;
}
