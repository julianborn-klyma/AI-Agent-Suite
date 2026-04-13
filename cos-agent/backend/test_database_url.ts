/**
 * Postgres für E2E: `DATABASE_URL_TEST`, sonst `DATABASE_URL`, sonst Docker-Compose aus dem Repo
 * (Host-Port 5433, DB `cos_agent_test` — siehe `docker-compose.yml` + `db/docker-init`).
 */
export function resolveTestDatabaseUrl(): string {
  const a = Deno.env.get("DATABASE_URL_TEST")?.trim();
  if (a) return a;
  const b = Deno.env.get("DATABASE_URL")?.trim();
  if (b) return b;
  return "postgres://postgres:postgres@127.0.0.1:5433/cos_agent_test";
}
