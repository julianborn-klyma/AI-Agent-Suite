#!/usr/bin/env -S deno run -A
/**
 * Legt feste Playwright-E2E-User in der DB an (idempotent).
 * Nutzt DATABASE_URL_TEST oder DATABASE_URL.
 *
 *   deno run -A scripts/playwright_seed.ts
 */
import { load } from "@std/dotenv";
import postgres from "postgres";
import { runMigrations } from "../db/migrate.ts";
import { PasswordService } from "../services/passwordService.ts";

await load({ export: true });

const url = Deno.env.get("DATABASE_URL_TEST")?.trim() ??
  Deno.env.get("DATABASE_URL")?.trim();
if (!url) {
  console.error("DATABASE_URL_TEST oder DATABASE_URL muss gesetzt sein.");
  Deno.exit(1);
}

await runMigrations(url);

const ADMIN_EMAIL = Deno.env.get("E2E_ADMIN_EMAIL")?.trim() ?? "e2e-admin@test.local";
const SUPERADMIN_EMAIL =
  Deno.env.get("E2E_SUPERADMIN_EMAIL")?.trim() ?? "e2e-superadmin@test.local";
const USER_EMAIL = Deno.env.get("E2E_USER_EMAIL")?.trim() ?? "e2e-user@test.local";
const E2E_PASSWORD = Deno.env.get("E2E_USER_PASSWORD")?.trim() ??
  "Playwright-E2E-2026!";

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
    VALUES (gen_random_uuid(), ${SUPERADMIN_EMAIL}, 'Playwright SuperAdmin', 'superadmin', true)
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
  const hash = await new PasswordService().hashPassword(E2E_PASSWORD);
  await sql`
    UPDATE cos_users
    SET
      password_hash = ${hash},
      onboarding_completed = true,
      onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
    WHERE email IN (${ADMIN_EMAIL}, ${USER_EMAIL}, ${SUPERADMIN_EMAIL})
  `;
  console.log(
    `playwright_seed: OK — ${ADMIN_EMAIL}, ${SUPERADMIN_EMAIL}, ${USER_EMAIL} (Passwort für E2E gesetzt)`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
