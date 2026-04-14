#!/usr/bin/env -S deno run -A
/**
 * Setzt password_hash für einen User (E-Mail).
 *
 *   DATABASE_URL=… deno run -A scripts/set_user_password.ts user@firma.de
 *
 * Passwort per stdin (empfohlen) oder zweites Argument (nur lokal).
 */
import { load } from "@std/dotenv";
import postgres from "postgres";
import { PasswordService } from "../services/passwordService.ts";

await load({ export: true });

const url = Deno.env.get("DATABASE_URL")?.trim();
const email = Deno.args[0]?.trim();
if (!url || !email) {
  console.error("Usage: DATABASE_URL=… deno run -A scripts/set_user_password.ts <email> [password]");
  Deno.exit(1);
}

let plain = Deno.args[1]?.trim() ?? "";
if (!plain) {
  plain = prompt("Neues Passwort:") ?? "";
}
if (!plain || plain.length < 8) {
  console.error("Passwort zu kurz (min. 8 Zeichen).");
  Deno.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  const ps = new PasswordService();
  const strength = ps.validatePasswordStrength(plain);
  if (!strength.valid) {
    console.error(
      "Passwort zu schwach: " + strength.errors.join("; "),
    );
    Deno.exit(1);
  }
  const h = await ps.hashPassword(plain);
  const rows = await sql`
    UPDATE cos_users SET password_hash = ${h}
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(${email}))
    RETURNING id::text
  ` as { id: string }[];
  if (rows.length === 0) {
    console.error("User nicht gefunden.");
    Deno.exit(1);
  }
  console.log(`OK — Passwort für ${email} gesetzt.`);
} finally {
  await sql.end({ timeout: 5 });
}
