#!/usr/bin/env -S deno run -A
/**
 * Legt einen User mit Passwort an oder aktualisiert Passwort/Rolle (E-Mail unique).
 *
 *   cd backend && deno run -A scripts/upsert_password_user.ts <email> <passwort> [name] [role]
 *
 * role: admin | member | superadmin (Default: admin)
 */
import { load } from "@std/dotenv";
import postgres from "postgres";
import { PasswordService } from "../services/passwordService.ts";

await load({ export: true });

const url = Deno.env.get("DATABASE_URL")?.trim();
if (!url) {
  console.error("DATABASE_URL fehlt (aus backend/.env oder Umgebung).");
  Deno.exit(1);
}

const email = (Deno.args[0] ?? "").trim();
const password = Deno.args[1] ?? "";
const name = (Deno.args[2] ?? email.split("@")[0] ?? "User").trim() || "User";
const role = (Deno.args[3] ?? "admin").trim() || "admin";

if (!email || !password) {
  console.error(
    "Usage: deno run -A scripts/upsert_password_user.ts <email> <password> [name] [role]",
  );
  Deno.exit(1);
}

const hash = await new PasswordService().hashPassword(password);
const sql = postgres(url, { max: 1 });
try {
  await sql`
    INSERT INTO cos_users (
      email, name, role, is_active, password_hash,
      onboarding_completed, onboarding_completed_at
    )
    VALUES (
      ${email}, ${name}, ${role}, true, ${hash},
      true, NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      password_hash = EXCLUDED.password_hash,
      is_active = true,
      onboarding_completed = true,
      onboarding_completed_at = COALESCE(cos_users.onboarding_completed_at, NOW()),
      updated_at = NOW()
  `;
  console.log(`OK — ${email} (${role}), Onboarding abgeschlossen.`);
} finally {
  await sql.end({ timeout: 5 });
}
