import { expect, test } from "@playwright/test";
import { E2E_SUPERADMIN_EMAIL, loginAs } from "./fixtures/auth.ts";

test.describe("Super Admin Tenants", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_SUPERADMIN_EMAIL);
  });

  test("Tenants-Übersicht erreichbar", async ({ page }) => {
    await page.goto("/superadmin/tenants");
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible({
      timeout: 25_000,
    });
  });
});
