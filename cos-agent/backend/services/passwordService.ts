import bcrypt from "npm:bcryptjs@2.4.3";
import { verifyPassword as verifyLegacyPbkdf2 } from "./passwordCrypto.ts";

export interface PasswordValidation {
  valid: boolean;
  errors: string[];
}

const BCRYPT_PREFIX = /^\$2[aby]\$/;

export class PasswordService {
  private readonly SALT_ROUNDS = 12;

  async hashPassword(plaintext: string): Promise<string> {
    const t = plaintext.trim();
    if (t.length < 8) {
      throw new Error("Passwort muss mindestens 8 Zeichen haben.");
    }
    const forBcrypt = t.length > 72 ? t.slice(0, 72) : t;
    return await bcrypt.hash(forBcrypt, this.SALT_ROUNDS);
  }

  async verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    try {
      if (!hash?.trim()) return false;
      if (BCRYPT_PREFIX.test(hash.trim())) {
        const forBcrypt = plaintext.length > 72 ? plaintext.slice(0, 72) : plaintext;
        return await bcrypt.compare(forBcrypt, hash.trim());
      }
      return await verifyLegacyPbkdf2(plaintext, hash);
    } catch {
      return false;
    }
  }

  validatePasswordStrength(password: string): PasswordValidation {
    const errors: string[] = [];
    if (password.length < 8) {
      errors.push("Mindestens 8 Zeichen");
    }
    if (!/[A-ZÄÖÜ]/.test(password)) {
      errors.push("Mindestens ein Großbuchstabe");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("Mindestens eine Zahl");
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      errors.push("Mindestens ein Sonderzeichen");
    }
    return { valid: errors.length === 0, errors };
  }

  generateTemporaryPassword(): string {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
}
