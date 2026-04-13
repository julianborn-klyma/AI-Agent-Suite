import { expect, test } from "@playwright/test";
import { E2E_ADMIN_EMAIL, loginAs } from "./fixtures/auth.ts";

test.describe("Admin Users", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_ADMIN_EMAIL);
  });

  test("Users-Übersicht mit Karten", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".co-user-card").first()).toBeVisible();
  });
});
