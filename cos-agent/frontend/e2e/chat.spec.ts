import { expect, test } from "@playwright/test";

const MOCK_SESSION_ID = "11111111-1111-4111-8111-111111111111";

test.describe("Chat Visuals", () => {
  test("zeigt Denk-Phase und rendert Assistenzantwort sequentiell", async ({ page }) => {
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
          email: "e2e-user@test.local",
          role: "member",
          tenant_ui_show_tenant_wiki: false,
        }),
      });
    });

    await page.route("**/api/chat/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          default: "sonnet",
          models: [
            { key: "haiku", label: "Claude Haiku 4.5", model_id: "claude-haiku" },
            { key: "sonnet", label: "Claude Sonnet 4", model_id: "claude-sonnet" },
            { key: "opus", label: "Claude Opus 4", model_id: "claude-opus" },
          ],
        }),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.route("**/api/chat/sessions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/chat", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") {
        await route.fallback();
        return;
      }
      await page.waitForTimeout(900);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          response: "Ich plane nächste Schritte und bereite jetzt die Antwort vor.",
          session_id: MOCK_SESSION_ID,
          tool_calls_made: [],
        }),
      });
    });

    await page.goto("/chat");
    await expect(page.getByTestId("chat-model-select")).toBeVisible();
    await expect(page.getByTestId("chat-model-select")).toHaveValue("sonnet");
    await page.getByTestId("chat-input").fill("Was ist heute wichtig?");
    await page.getByTestId("chat-send").click();

    await expect(page.getByTestId("chat-phase-label")).toBeVisible();
    await expect(page.getByTestId("chat-phase-label")).toContainText(/Nachdenken|Plane|Bereite/);
    await expect(page.locator(".chat-loading-dot")).toHaveCount(0);

    await expect(
      page.getByText("Ich plane nächste Schritte und bereite jetzt die Antwort vor."),
    ).toBeVisible({ timeout: 15_000 });
  });
});
