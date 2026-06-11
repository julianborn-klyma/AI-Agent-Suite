import { expect, test } from "@playwright/test";

test.describe("Tenant-Wiki Preference", () => {
  test("Wiki-Tab sichtbar wenn tenant_ui_show_tenant_wiki true", async ({ page }) => {
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
          role: "member",
          tenant_ui_show_tenant_wiki: true,
        }),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.route("**/api/workspace/wiki/pages*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/knowledge");
    await expect(page.getByTestId("knowledge-tab-wiki")).toBeVisible();
    await page.getByTestId("knowledge-tab-wiki").click();
    await expect(page.getByTestId("wiki-root")).toBeVisible();
  });

  test("Wiki aus → /workspace/wiki leitet nach /chat", async ({ page }) => {
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
          role: "member",
          tenant_ui_show_tenant_wiki: false,
        }),
      });
    });

    await page.goto("/workspace/wiki");
    await expect(page).toHaveURL(/\/chat$/);
  });
});
