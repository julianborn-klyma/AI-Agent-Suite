import type { DatabaseClient } from "../../db/databaseClient.ts";

const GCM_IV_LENGTH = 12;

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY muss genau 64 Hex-Zeichen (32 Bytes) sein.");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function u8ToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return btoa(s);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

let cachedKey: CryptoKey | null = null;
let cachedKeyHex: string | null = null;

async function getAesKey(): Promise<CryptoKey> {
  const hex = Deno.env.get("ENCRYPTION_KEY")?.trim();
  if (!hex) {
    throw new Error("ENCRYPTION_KEY fehlt (64 Hex-Zeichen für AES-256-GCM).");
  }
  if (cachedKey && cachedKeyHex === hex) return cachedKey;
  const keyBytes = hexToBytes(hex);
  const keyBuffer = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;
  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  cachedKeyHex = hex;
  return cachedKey;
}

/** Liest einen Kontextwert; `null` wenn der Key fehlt (kein Fehler). */
export async function getCredential(
  db: DatabaseClient,
  userId: string,
  key: string,
): Promise<string | null> {
  const rows = await db.listUserContexts(userId);
  const row = rows.find((r) => r.key === key);
  const v = row?.value?.trim();
  return v || null;
}

/** AES-256-GCM; Ausgabe Base64(iv || ciphertext). */
export async function encrypt(plain: string): Promise<string> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH));
  const enc = new TextEncoder().encode(plain);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc),
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return u8ToB64(combined);
}

export async function decrypt(encrypted: string): Promise<string> {
  const key = await getAesKey();
  const combined = b64ToU8(encrypted.trim());
  if (combined.length < GCM_IV_LENGTH + 16) {
    throw new Error("Ungültiges verschlüsseltes Token-Format.");
  }
  const iv = combined.slice(0, GCM_IV_LENGTH);
  const ct = combined.slice(GCM_IV_LENGTH);
  const dec = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct,
  );
  return new TextDecoder().decode(dec);
}
