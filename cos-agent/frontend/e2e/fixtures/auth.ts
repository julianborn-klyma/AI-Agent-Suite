import { expect, type Page } from "@playwright/test";

export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e-user@test.local";
export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@test.local";
export const E2E_SUPERADMIN_EMAIL =
  process.env.E2E_SUPERADMIN_EMAIL ?? "e2e-superadmin@test.local";
/** Muss zu `playwright_seed` (E2E_USER_PASSWORD) passen. */
export const E2E_USER_PASSWORD =
  process.env.E2E_USER_PASSWORD ?? "Playwright-E2E-2026!";

/** Sichtbares Login-Formular (ohne altes Token / Redirect zu /chat). */
async function ensureLoginScreen(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("cos_token");
    } catch {
      /* ignore */
    }
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible({
    timeout: 30_000,
  });
}

function emailLocator(page: Page) {
  return page
    .getByTestId("login-email")
    .or(page.getByLabel("E-Mail"))
    .or(page.locator("#login-email-field"));
}

function submitLocator(page: Page) {
  return page.getByTestId("login-submit").or(page.getByRole("button", { name: /^Anmelden$/ }));
}

function passwordLocator(page: Page) {
  return page.getByTestId("login-password").or(page.getByLabel("Passwort"));
}

export async function loginAs(page: Page, email: string): Promise<void> {
  await ensureLoginScreen(page);
  await expect(emailLocator(page)).toBeVisible({ timeout: 15_000 });
  await emailLocator(page).fill(email);
  await passwordLocator(page).fill(E2E_USER_PASSWORD);
  await submitLocator(page).click();
  await page.waitForURL(/\/chat(\/)?$/, { timeout: 30_000 });
}

export async function openLoginForm(page: Page): Promise<void> {
  await ensureLoginScreen(page);
}
