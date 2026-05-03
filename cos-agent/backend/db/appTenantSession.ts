import postgres from "postgres";

/** Sql-Handle oder Transaction-Handle (postgres.js). */
type PgSql = postgres.Sql | postgres.TransactionSql;

/**
 * Setzt die Session-Variable für Row Level Security auf `app.*`-Tabellen.
 * In einer Transaction aufrufen; `is_local = true` → Wert gilt nur bis Transaction-Ende
 * (entspricht SQL `SET LOCAL`).
 *
 * Beispiel (postgres.js):
 * ```ts
 * await sql.begin(async (tx) => {
 *   await setAppTenantSession(tx, tenantId);
 *   await tx`SELECT * FROM app.tasks WHERE project_id = ${pid}`;
 * });
 * ```
 */
export async function setAppTenantSession(
  sql: PgSql,
  tenantId: string,
  isLocal = true,
): Promise<void> {
  await sql`
    SELECT set_config('app.current_tenant_id', ${tenantId}, ${isLocal})
  `;
}

/** Für lesenden Zugriff auf `app.wiki_pages` mit `tenant_id IS NULL` (Plattform-Wiki). */
export async function setAppAllowPlatformWiki(
  sql: PgSql,
  allow: boolean,
  isLocal = true,
): Promise<void> {
  await sql`
    SELECT set_config('app.allow_platform_wiki', ${allow ? "true" : "false"}, ${isLocal})
  `;
}
