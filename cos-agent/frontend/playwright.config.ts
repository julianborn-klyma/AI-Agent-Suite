import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const cosAgentRoot = resolve(frontendRoot, "..");

loadDotenv({ path: resolve(cosAgentRoot, ".env") });
loadDotenv({ path: resolve(cosAgentRoot, "backend", ".env") });

/**
 * Vite-Port: Standard 5175; bei Port-Konflikt z. B. `PLAYWRIGHT_DEV_PORT=5177` setzen.
 * `PLAYWRIGHT_BASE_URL` überschreibt die komplette Basis-URL (muss zum webServer-Port passen).
 */
const devPort = process.env.PLAYWRIGHT_DEV_PORT?.trim() || "5175";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ?? `http://localhost:${devPort}`;
/** Backend-Basis für Health-Checks / `page.request` (nicht für `import.meta.env` im Vite-WebServer). */
const backendBaseUrl = (process.env.VITE_API_URL ?? "http://localhost:8090")
  .replace(/\/+$/, "");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    /**
     * Ohne XFF ist die Client-IP oft `unknown` → alle lokalen Logins teilen einen
     * loginRateLimiter-Bucket (10/15 min). TEST-NET-Adresse trennt Playwright vom Alltag.
     */
    extraHTTPHeaders: {
      "X-Forwarded-For": process.env.PLAYWRIGHT_E2E_IP?.trim() || "203.0.113.87",
    },
  },
  expect: {
    timeout: 15_000,
  },
  timeout: 60_000,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev -- --host localhost --port ${devPort} --strictPort`,
    url: baseURL,
    /** Nur in CI immer frisch starten; lokal bei Bedarf PW_REUSE_SERVER=1 setzen. */
    reuseExistingServer: process.env.CI ? false : process.env.PW_REUSE_SERVER === "1",
    timeout: 120_000,
    env: {
      ...process.env,
      /**
       * Leere `VITE_API_URL`: Browser nutzt `/api…` auf dem Playwright-Port → Vite-Proxy
       * (`vite.config.ts` → `VITE_DEV_API_PROXY_TARGET`) → kein CORS bei wechselndem Port.
       */
      VITE_API_URL: "",
      VITE_DEV_API_PROXY_TARGET: backendBaseUrl,
    },
  },
});
