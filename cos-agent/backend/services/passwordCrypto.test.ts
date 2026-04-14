import { assertEquals } from "@std/assert";
import { hashPassword, verifyPassword } from "./passwordCrypto.ts";

Deno.test({
  name: "passwordCrypto — verifyPassword akzeptiert eigenen Hash",
  async fn() {
    const h = await hashPassword("mein-sicheres-passwort");
    assertEquals(await verifyPassword("mein-sicheres-passwort", h), true);
    assertEquals(await verifyPassword("falsch", h), false);
  },
});

Deno.test({
  name: "passwordCrypto — leerer Speicher oder Müll → false",
  async fn() {
    assertEquals(await verifyPassword("x", null), false);
    assertEquals(await verifyPassword("x", ""), false);
    assertEquals(await verifyPassword("x", "plaintext"), false);
  },
});
