import { assertEquals, assertRejects } from "@std/assert";
import { PasswordService } from "./passwordService.ts";
import { hashPassword as legacyHash } from "./passwordCrypto.ts";

Deno.test("PasswordService — hashPassword liefert bcrypt-Hash ($2b$)", async () => {
  const s = new PasswordService();
  const h = await s.hashPassword("Str0ng!Passwort");
  assertEquals(/^\$2[aby]\$/.test(h), true);
});

Deno.test("PasswordService — verifyPassword true bei korrekt", async () => {
  const s = new PasswordService();
  const h = await s.hashPassword("K0rrekt!Lang");
  assertEquals(await s.verifyPassword("K0rrekt!Lang", h), true);
});

Deno.test("PasswordService — verifyPassword false bei falsch", async () => {
  const s = new PasswordService();
  const h = await s.hashPassword("Richt1g!xx");
  assertEquals(await s.verifyPassword("falsch", h), false);
});

Deno.test("PasswordService — verifyPassword false bei leerem Hash", async () => {
  const s = new PasswordService();
  assertEquals(await s.verifyPassword("x", ""), false);
  assertEquals(await s.verifyPassword("x", "   "), false);
});

Deno.test("PasswordService — validatePasswordStrength ok", () => {
  const s = new PasswordService();
  const r = s.validatePasswordStrength("Gut8!abc");
  assertEquals(r.valid, true);
  assertEquals(r.errors.length, 0);
});

Deno.test("PasswordService — validatePasswordStrength Fehler", () => {
  const s = new PasswordService();
  const r = s.validatePasswordStrength("kurz");
  assertEquals(r.valid, false);
  assertEquals(r.errors.length > 0, true);
});

Deno.test("PasswordService — hashPassword unter 8 Zeichen wirft", async () => {
  const s = new PasswordService();
  await assertRejects(() => s.hashPassword("Kurz1!"));
});

Deno.test("PasswordService — generateTemporaryPassword 16 Zeichen hex", () => {
  const s = new PasswordService();
  const t = s.generateTemporaryPassword();
  assertEquals(t.length, 16);
  assertEquals(/^[0-9a-f]+$/.test(t), true);
});

Deno.test("PasswordService — Legacy PBKDF2-Hash weiterhin verifizierbar", async () => {
  const s = new PasswordService();
  const h = await legacyHash("legacy-secret-ok");
  assertEquals(await s.verifyPassword("legacy-secret-ok", h), true);
});
