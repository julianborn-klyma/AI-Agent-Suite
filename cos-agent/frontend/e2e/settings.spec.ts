import { expect, test } from "@playwright/test";
import { E2E_USER_EMAIL, loginAs } from "./fixtures/auth.ts";

test.describe("Einstellungen / Verbindungen", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USER_EMAIL);
  });

  test("Navigation: Verbindungen-Seite erreichbar", async ({ page }) => {
    await page.goto("/settings/connections");
    await expect(page.getByTestId("connections-title")).toBeVisible();
    await expect(page.getByText("Google (Gmail + Drive)")).toBeVisible();
    await expect(page.getByText(/Notion/i).first()).toBeVisible();
  });

  test("Übersicht Einstellungen → Link zu Verbindungen", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    await page.getByRole("link", { name: /Verbindungen/ }).click();
    await expect(page).toHaveURL(/\/settings\/connections/);
    await expect(page.getByTestId("connections-title")).toBeVisible();
  });
});
