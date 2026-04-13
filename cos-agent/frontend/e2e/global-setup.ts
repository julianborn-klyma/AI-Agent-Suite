import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(e2eDir, "..");
const cosAgentRoot = resolve(frontendRoot, "..");
const seedScript = resolve(cosAgentRoot, "backend/scripts/playwright_seed.ts");

export default async function globalSetup(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL_TEST?.trim() ?? process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    throw new Error(
      "global-setup: DATABASE_URL_TEST oder DATABASE_URL muss gesetzt sein (z. B. in cos-agent/.env).",
    );
  }

  try {
    execFileSync(
      "deno",
      ["run", "-A", seedScript],
      {
        stdio: "inherit",
        cwd: cosAgentRoot,
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
          DATABASE_URL_TEST: dbUrl,
        },
      },
    );
  } catch {
    throw new Error(
      "Playwright global-setup: Seed fehlgeschlagen. Ist Deno installiert und Postgres erreichbar?",
    );
  }

  const apiURL = process.env.VITE_API_URL?.trim() ?? "http://localhost:8090";
  const serviceToken = process.env.SERVICE_TOKEN?.trim();
  if (!serviceToken) {
    console.warn(
      "[playwright] SERVICE_TOKEN fehlt in .env — Health-Check übersprungen. Backend muss für Login erreichbar sein.",
    );
  }
  if (serviceToken) {
    const res = await fetch(`${apiURL.replace(/\/+$/, "")}/health`, {
      headers: { "X-Service-Token": serviceToken },
    });
    if (!res.ok) {
      throw new Error(
        `Playwright global-setup: Backend ${apiURL} antwortet nicht (${res.status}). Backend starten (z. B. deno task dev).`,
      );
    }
  }
}
