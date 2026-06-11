import { expect, test } from "@playwright/test";

test.describe("Chat Sidebar Tabs", () => {
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
          role: "member",
          tenant_ui_show_tenant_wiki: false,
        }),
      });
    });

    await page.route("**/api/chat/sessions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            session_id: "11111111-1111-4111-8111-111111111111",
            preview: "Projekt-Chat Test",
            last_activity: new Date().toISOString(),
            message_count: 2,
            project_id: "aaaabbbb-cccc-4ddd-8eee-ffffaaaabbbb",
            project_name: "Alpha Projekt",
          },
        ]),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "aaaabbbb-cccc-4ddd-8eee-ffffaaaabbbb",
            name: "Alpha Projekt",
            description: null,
            color: "#6366f1",
            role: "owner",
          },
        ]),
      });
    });

    await page.route("**/api/schedules", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "daily_briefing",
            cron_expression: "0 7 * * 1-5",
            is_active: true,
            display_name: "Daily Briefing",
          },
        ]),
      });
    });

    await page.route("**/api/connections", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ google: true, slack: false }),
      });
    });
  });

  test("Tabs Chat, Projekte und Tasks sind sichtbar", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByTestId("chat-sidebar-tab-chat")).toBeVisible();
    await expect(page.getByTestId("chat-sidebar-tab-projects")).toBeVisible();
    await expect(page.getByTestId("chat-sidebar-tab-tasks")).toBeVisible();
  });

  test("Session zeigt Projekt-Badge", async ({ page }) => {
    await page.goto("/chat");
    await expect(
      page.getByTestId("session-project-badge-11111111-1111-4111-8111-111111111111"),
    ).toContainText("Alpha Projekt");
  });

  test("Tasks-Tab zeigt Scheduled Jobs", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("chat-sidebar-tab-tasks").click();
    await expect(page.getByTestId("chat-sidebar-tasks")).toBeVisible();
    await expect(page.getByText("Daily Briefing")).toBeVisible();
  });
});
