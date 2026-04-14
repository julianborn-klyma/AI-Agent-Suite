/**
 * Passwort-Hashing mit PBKDF2-SHA256 (Web Crypto), ohne zusätzliche Dependencies.
 * Format: pbkdf2_sha256$<iterations>$<hex_salt_32byte>$<hex_key_32byte>
 */
const ITERATIONS = 310_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = "pbkdf2_sha256";

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const enc = new TextEncoder().encode(plain);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_BITS,
  );
  return `${PREFIX}$${ITERATIONS}$${toHex(salt.buffer)}$${toHex(bits)}`;
}

export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored?.trim()) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    return false;
  }
  const iter = Number(parts[1]);
  const saltHex = parts[2];
  const keyHex = parts[3];
  if (!Number.isFinite(iter) || iter < 100_000 || !saltHex || !keyHex) {
    return false;
  }
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromHex(saltHex);
    expected = fromHex(keyHex);
  } catch {
    return false;
  }
  const enc = new TextEncoder().encode(plain);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: iter,
      hash: "SHA-256",
    },
    keyMaterial,
    expected.byteLength * 8,
  );
  const out = new Uint8Array(bits);
  if (out.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < out.length; i++) {
    diff |= out[i]! ^ expected[i]!;
  }
  return diff === 0;
}
