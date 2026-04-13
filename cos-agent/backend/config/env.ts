import { load } from "@std/dotenv";

const MIN_SECRET_LEN = 32;
const MIN_ANTHROPIC_KEY_LEN = 20;

export type AppEnv = {
  port: number;
  databaseUrl: string;
  serviceToken: string;
  jwtSecret: string;
  corsOrigins: string[];
  /** Anthropic API Key (Messages API). */
  anthropicApiKey: string;
  /** Google OAuth (optional bis Route aufgerufen wird). */
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  /** Basis-URL des Frontends (OAuth-Redirect zurück). */
  frontendUrl: string;
  /** Optional: E-Mail-Versand für Daily Briefing (`/api/send`). */
  emailServiceUrl: string | null;
  emailServiceToken: string | null;
};

let cached: AppEnv | null = null;

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    throw new Error("CORS_ORIGINS muss gesetzt sein (kommagetrennt, kein *).");
  }
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.some((o) => o === "*")) {
    throw new Error("CORS_ORIGINS darf kein Wildcard (*) enthalten.");
  }
  return list;
}

export async function loadEnv(): Promise<AppEnv> {
  if (cached) return cached;
  await load({ export: true });

  const port = Number(Deno.env.get("PORT") ?? "8787");
  const databaseUrl = Deno.env.get("DATABASE_URL");
  const serviceToken = Deno.env.get("SERVICE_TOKEN");
  const jwtSecret = Deno.env.get("JWT_SECRET");
  const corsRaw = Deno.env.get("CORS_ORIGINS");
  const anthropicApiKeyRaw = Deno.env.get("ANTHROPIC_API_KEY");
  const emailServiceUrlRaw = Deno.env.get("EMAIL_SERVICE_URL")?.trim() ?? null;
  const emailServiceTokenRaw = Deno.env.get("EMAIL_SERVICE_TOKEN")?.trim() ??
    null;

  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL ist Pflicht.");
  }
  if (!serviceToken || serviceToken.length < MIN_SECRET_LEN) {
    throw new Error(
      `SERVICE_TOKEN ist Pflicht und muss mindestens ${MIN_SECRET_LEN} Zeichen haben.`,
    );
  }
  if (!jwtSecret || jwtSecret.length < MIN_SECRET_LEN) {
    throw new Error(
      `JWT_SECRET ist Pflicht und muss mindestens ${MIN_SECRET_LEN} Zeichen haben.`,
    );
  }

  const anthropicApiKey = anthropicApiKeyRaw?.trim() ?? "";
  if (anthropicApiKey.length < MIN_ANTHROPIC_KEY_LEN) {
    throw new Error(
      `ANTHROPIC_API_KEY ist Pflicht und muss mindestens ${MIN_ANTHROPIC_KEY_LEN} Zeichen haben.`,
    );
  }

  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim() ?? "";
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim() ?? "";
  const googleRedirectUri =
    Deno.env.get("GOOGLE_REDIRECT_URI")?.trim() ??
    "http://localhost:8090/api/auth/google/callback";
  const frontendUrl =
    Deno.env.get("FRONTEND_URL")?.trim() ?? "http://localhost:5174";

  let emailServiceUrl: string | null = null;
  if (emailServiceUrlRaw) {
    try {
      const u = new URL(emailServiceUrlRaw);
      if (u.protocol === "http:" || u.protocol === "https:") {
        emailServiceUrl = emailServiceUrlRaw.replace(/\/+$/, "");
      }
    } catch {
      /* ungültig → null */
    }
  }

  cached = {
    port,
    databaseUrl,
    serviceToken,
    jwtSecret,
    corsOrigins: parseOrigins(corsRaw),
    anthropicApiKey,
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    frontendUrl,
    emailServiceUrl,
    emailServiceToken: emailServiceTokenRaw,
  };
  return cached;
}

/** Für Tests: explizite Env setzen ohne .env-Datei. */
export function resetEnvCacheForTests(): void {
  cached = null;
}

/**
 * Lazy: nur bei Ausführung des Gmail-Tools — nicht bei `loadEnv()`.
 * Nutzt dieselben OAuth-Credentials wie „Verbindungen“ (`GOOGLE_*`).
 * Optional noch `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` als Fallback (Legacy).
 */
export function requireGmailOAuthForTool(): {
  clientId: string;
  clientSecret: string;
} {
  const googleId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim() ?? "";
  const googleSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim() ?? "";
  if (googleId && googleSecret) {
    return { clientId: googleId, clientSecret: googleSecret };
  }
  const legacyId = Deno.env.get("GMAIL_CLIENT_ID")?.trim() ?? "";
  const legacySecret = Deno.env.get("GMAIL_CLIENT_SECRET")?.trim() ?? "";
  if (legacyId && legacySecret) {
    return { clientId: legacyId, clientSecret: legacySecret };
  }
  throw new Error(
    "GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET sind für Gmail-Tools erforderlich (OAuth-Client wie unter Verbindungen).",
  );
}
