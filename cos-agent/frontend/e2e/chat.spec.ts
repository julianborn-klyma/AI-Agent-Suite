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
        }),
      });
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
