import { expect, test } from "@playwright/test";

const PROJECT_ID = "aaaabbbb-cccc-4ddd-8eee-ffffaaaabbbb";

test.describe("Knowledge Hub", () => {
  test("Icon Projekte → Brain ohne Wiki-Tab (Default-Pref aus)", async ({ page }) => {
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

    await page.route("**/api/brain/projects", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: PROJECT_ID,
            name: "Test Projekt",
            description: "Beschreibung",
            color: "#6366f1",
            role: "owner",
          },
        ]),
      });
    });

    await page.goto("/chat");
    await page.getByTestId("rail-knowledge").click();
    await expect(page).toHaveURL(/\/knowledge/);
    await expect(page.getByTestId("knowledge-hub")).toBeVisible();
    await expect(page.getByTestId("knowledge-tab-projects")).toBeVisible();
    await expect(page.getByTestId("knowledge-tab-wiki")).toHaveCount(0);
    await expect(page.getByTestId("brain-page")).toBeVisible();
    await expect(page.getByText("Test Projekt")).toBeVisible();
  });

  test("/brain leitet nach /knowledge weiter", async ({ page }) => {
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

    await page.route("**/api/brain/projects", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/brain");
    await expect(page).toHaveURL(/\/knowledge/);
  });
});
