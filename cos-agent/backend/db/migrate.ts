import { load } from "@std/dotenv";
import { dirname, fromFileUrl, join } from "@std/path";
import postgres from "postgres";

type Sql = postgres.Sql;
type TransactionSql = postgres.TransactionSql;
type PgClient = Sql;

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function ensureMigrationsTable(sql: PgClient): Promise<void> {
  await sql.unsafe(MIGRATIONS_TABLE.trim());
}

async function isMigrationApplied(sql: PgClient, name: string): Promise<boolean> {
  const rows = await sql`
    SELECT name FROM schema_migrations WHERE name = ${name}
  ` as { name: string }[];
  return rows.length > 0;
}

async function markMigrationApplied(
  sql: Sql | TransactionSql,
  name: string,
): Promise<void> {
  await sql`
    INSERT INTO schema_migrations (name) VALUES (${name})
  `;
}

/**
 * Führt jede `.sql`-Datei in `migrations/` höchstens einmal aus (Eintrag in `schema_migrations`).
 * Bereits angewendete Dateien werden übersprungen — wiederholte Aufrufe sind damit idempotent.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const here = dirname(fromFileUrl(import.meta.url));
  const migrationsDir = join(here, "migrations");

  const files: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      files.push(entry.name);
    }
  }
  files.sort();

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await ensureMigrationsTable(sql);

    for (const name of files) {
      const applied = await isMigrationApplied(sql, name);
      if (applied) {
        console.log(`Migration übersprungen (bereits angewendet): ${name}`);
        continue;
      }

      const path = join(migrationsDir, name);
      const body = (await Deno.readTextFile(path)).trim();
      if (!body) {
        console.warn(`Migration leer: ${name}`);
        await markMigrationApplied(sql, name);
        continue;
      }

      console.log(`Migration: ${name}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await markMigrationApplied(tx, name);
      });
    }
    console.log("Migrationen abgeschlossen.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  await load({ export: true });
  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt.");
    Deno.exit(1);
  }
  await runMigrations(databaseUrl);
}
