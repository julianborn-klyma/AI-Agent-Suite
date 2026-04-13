import { expect, test } from "@playwright/test";
import { E2E_ADMIN_EMAIL, loginAs } from "./fixtures/auth.ts";

test.describe("Admin Agent-Configs", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_ADMIN_EMAIL);
  });

  test("Configs-Seite lädt mit Überschrift", async ({ page }) => {
    await page.goto("/admin/configs");
    await expect(page.getByTestId("configs-page-title")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Inline bearbeiten/i)).toBeVisible();
  });

  test("Inline: Anzeigename ändern und Speicher-Hinweis", async ({ page }) => {
    await page.goto("/admin/configs");
    const card = page.locator("[data-testid^=\"config-editor-\"]").first();
    await expect(card).toBeVisible({ timeout: 20_000 });

    const nameInput = card.getByLabel(/Anzeigename/);
    await nameInput.clear();
    await nameInput.fill("E2E Config Name");
    await nameInput.blur();

    await expect(card.getByText(/Gespeichert|Speichern/i)).toBeVisible({
      timeout: 25_000,
    });
  });
});
