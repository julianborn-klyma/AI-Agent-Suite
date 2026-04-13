import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const cosAgentRoot = resolve(frontendRoot, "..");

loadDotenv({ path: resolve(cosAgentRoot, ".env") });
loadDotenv({ path: resolve(cosAgentRoot, "backend", ".env") });

/**
 * Eigener Port 5175: vermeidet Konflikt mit `npm run dev` auf 5174 + reuseExistingServer,
 * das sonst ein altes Bundle ohne aktuelle Test-IDs laden kann.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5175";
const apiURL = process.env.VITE_API_URL ?? "http://localhost:8090";

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
    /* API-Checks in globalSetup / Tests */
    extraHTTPHeaders: {},
  },
  expect: {
    timeout: 15_000,
  },
  timeout: 60_000,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --host localhost --port 5175 --strictPort",
    url: baseURL,
    /** Nur in CI immer frisch starten; lokal bei Bedarf PW_REUSE_SERVER=1 setzen. */
    reuseExistingServer: process.env.CI ? false : process.env.PW_REUSE_SERVER === "1",
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_API_URL: apiURL,
    },
  },
});
