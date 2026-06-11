import { expect, test } from "@playwright/test";

test.describe("Settings Shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cos_token", "e2e-mock-token");
    });

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "admin",
          tenant_ui_show_tenant_wiki: false,
        }),
      });
    });

    await page.route("**/api/connections", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          google: false,
          notion: false,
          slack: false,
        }),
      });
    });
  });

  test("Zahnrad führt zu Settings-Tabs ohne alte Text-Nav", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("rail-settings").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByTestId("settings-tabs")).toBeVisible();
    await expect(page.getByTestId("icon-rail")).toBeVisible();
    await expect(page.getByText("Konto & Dienste")).toHaveCount(0);
  });

  test("Anzeige-Tab nur für Admins", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: "Anzeige" })).toBeVisible();
    await page.getByRole("link", { name: "Anzeige" }).click();
    await expect(page.getByTestId("tenant-wiki-toggle")).toBeVisible();
  });
});
