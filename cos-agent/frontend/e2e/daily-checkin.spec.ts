import { expect, test } from "@playwright/test";
import { E2E_USER_EMAIL, loginAs } from "./fixtures/auth.ts";

test.describe("Daily Check-in", () => {
  /** Keine Wiederholungen: sonst mehrfaches Login → IP-Rate-Limit (`auth.ts` 10/15 min). */
  test.describe.configure({ retries: 0 });

  test("Deep-Link füllt Tages-Check-in; Reflection-API persistiert", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginAs(page, E2E_USER_EMAIL);

    await page.goto("/chat?daily_checkin=1");
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("chat-input")).toHaveValue(/Tages-Check-in/);

    const token = await page.evaluate(() => localStorage.getItem("cos_token"));
    expect(token).toBeTruthy();
    const apiURL = (process.env.VITE_API_URL ?? "http://localhost:8090").replace(
      /\/+$/,
      "",
    );
    const note = `E2E Daily Reflection ${Date.now()} — Wiki-Signale testen.`;
    const res = await page.request.post(`${apiURL}/api/reflection/daily`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: { note },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { ok?: boolean; learnings_saved?: number };
    expect(body.ok).toBe(true);
    expect(typeof body.learnings_saved).toBe("number");
  });
});
