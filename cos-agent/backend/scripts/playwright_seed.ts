#!/usr/bin/env -S deno run -A
/**
 * Legt feste Playwright-E2E-User in der DB an (idempotent).
 * Nutzt DATABASE_URL_TEST oder DATABASE_URL.
 *
 *   deno run -A scripts/playwright_seed.ts
 */
import { load } from "@std/dotenv";
import postgres from "postgres";

await load({ export: true });

const url = Deno.env.get("DATABASE_URL_TEST")?.trim() ??
  Deno.env.get("DATABASE_URL")?.trim();
if (!url) {
  console.error("DATABASE_URL_TEST oder DATABASE_URL muss gesetzt sein.");
  Deno.exit(1);
}

const ADMIN_EMAIL = Deno.env.get("E2E_ADMIN_EMAIL")?.trim() ?? "e2e-admin@test.local";
const USER_EMAIL = Deno.env.get("E2E_USER_EMAIL")?.trim() ?? "e2e-user@test.local";

const sql = postgres(url, { max: 1 });
try {
  await sql`
    INSERT INTO cos_users (id, email, name, role, is_active)
    VALUES (gen_random_uuid(), ${ADMIN_EMAIL}, 'Playwright Admin', 'admin', true)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active
  `;
  await sql`
    INSERT INTO cos_users (id, email, name, role, is_active)
    VALUES (gen_random_uuid(), ${USER_EMAIL}, 'Playwright User', 'member', true)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active
  `;
  console.log(`playwright_seed: OK — ${ADMIN_EMAIL}, ${USER_EMAIL}`);
} finally {
  await sql.end({ timeout: 5 });
}
