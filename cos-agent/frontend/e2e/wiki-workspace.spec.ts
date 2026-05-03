import { expect, test } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL?.trim() ?? "e2e-user@test.local";
const password = process.env.E2E_USER_PASSWORD?.trim() ?? "Playwright-E2E-2026!";

test.describe("Workspace Wiki", () => {
  test("Slug-Hinweis, Vorschau, anlegen, freigeben, löschen", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 45_000 });

    await page.goto("/workspace/wiki");
    await expect(page.getByTestId("wiki-root")).toBeVisible({ timeout: 15_000 });

    const slug = `e2e-wiki-${Date.now()}`;
    const title = `Wiki E2E ${Date.now()}`;

    await page.getByTestId("wiki-open-create-modal").click();
    await page.getByTestId("wiki-new-slug").fill("ungültiger slug!!!");
    await expect(page.getByTestId("wiki-new-slug-hint")).toBeVisible();
    await expect(page.getByTestId("wiki-new-submit")).toBeDisabled();
    await page.getByTestId("wiki-new-slug").fill(slug);
    await expect(page.getByTestId("wiki-new-slug-hint")).toBeHidden();

    await page.getByTestId("wiki-new-title").fill(title);
    await page.getByTestId("wiki-new-body").fill(`# E2E\n\nHallo [[${slug}]]`);
    await page.getByTestId("wiki-new-preview-toggle").check();
    await expect(page.getByTestId("wiki-md-preview")).toContainText("E2E", {
      timeout: 5000,
    });

    await page.getByTestId("wiki-new-submit").click();

    await expect(page.getByTestId("wiki-table")).toContainText(title, {
      timeout: 15_000,
    });
    const row = page.getByTestId(`wiki-row-${slug}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("draft");

    await row.click();
    await page.getByTestId("wiki-edit-approve").click();
    await expect(row).toContainText("approved", { timeout: 15_000 });

    await page.goto("/chat");
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("chat-input").fill("Was steht im Tenant-Wiki?");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-tool-pill-workspace")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(slug, { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/workspace/wiki");
    await expect(page.getByTestId("wiki-root")).toBeVisible({ timeout: 15_000 });
    await row.click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("wiki-edit-delete").click();
    await expect(page.getByTestId(`wiki-row-${slug}`)).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
