import { expect, test } from "@playwright/test";
import { E2E_USER_EMAIL, loginAs } from "./fixtures/auth.ts";

test.describe("Einstellungen Passwort", () => {
  test("Seite Passwort ändern erreichbar", async ({ page }) => {
    await loginAs(page, E2E_USER_EMAIL);
    await page.goto("/settings/password", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Passwort ändern" }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
