import { expect, test } from "@playwright/test";
import { E2E_USER_EMAIL, loginAs, openLoginForm } from "./fixtures/auth.ts";

test.describe("Login", () => {
  test("Member: E-Mail → Chat", async ({ page }) => {
    await loginAs(page, E2E_USER_EMAIL);
    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByText("Chief of Staff", { exact: false })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Unbekannte E-Mail → Fehlermeldung", async ({ page }) => {
    await openLoginForm(page);
    await page.getByLabel("E-Mail").fill("definitiv-unbekannt-xyz@test.local");
    await page.getByTestId("login-password").fill("irgendwas");
    await page.getByTestId("login-submit").click();
    await expect(page.getByText(/Email oder Passwort falsch/)).toBeVisible({
      timeout: 10_000,
    });
  });
});
