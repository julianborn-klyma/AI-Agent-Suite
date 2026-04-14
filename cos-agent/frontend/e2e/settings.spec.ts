import { expect, test } from "@playwright/test";
import { E2E_USER_EMAIL, loginAs } from "./fixtures/auth.ts";

test.describe("Einstellungen / Verbindungen", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USER_EMAIL);
  });

  test("Einstellungen: Bereich Verbindungen mit Google und Notion", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    await expect(page.getByTestId("connections-title")).toBeVisible();
    await expect(page.getByText("Google (Gmail + Drive)")).toBeVisible();
    await expect(page.getByText(/Notion/i).first()).toBeVisible();
  });

  test("Legacy-URL /settings/connections leitet nach /settings weiter", async ({ page }) => {
    await page.goto("/settings/connections");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("connections-title")).toBeVisible();
  });

  test("Mein Schreibstil: Seite unter /settings/email-style", async ({ page }) => {
    await page.goto("/settings/email-style");
    await expect(page.getByTestId("email-style-title")).toBeVisible();
    await expect(page.getByRole("button", { name: /Jetzt aktualisieren/ })).toBeVisible();
  });

  test("Agenten-Info: Modal öffnen und schließen", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("agent-structure-info-button").click();
    await expect(page.getByTestId("agent-structure-modal")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agenten-Struktur" })).toBeVisible();
    await page.getByTestId("agent-structure-modal-close").click();
    await expect(page.getByTestId("agent-structure-modal")).toHaveCount(0);
  });
});
