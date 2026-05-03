import { expect, test } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL?.trim() ?? "e2e-user@test.local";
const password = process.env.E2E_USER_PASSWORD?.trim() ?? "Playwright-E2E-2026!";

test.describe("Wiki Leseseite", () => {
  test("Slug-Link, Markdown mit internem Link, Backlink bei Selbstverweis", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 45_000 });

    await page.goto("/workspace/wiki");
    await expect(page.getByTestId("wiki-root")).toBeVisible({ timeout: 15_000 });

    const slug = `e2e-read-${Date.now()}`;
    const title = `Read ${slug}`;

    await page.getByTestId("wiki-open-create-modal").click();
    await page.getByTestId("wiki-new-slug").fill(slug);
    await page.getByTestId("wiki-new-title").fill(title);
    await page.getByTestId("wiki-new-body").fill(`Einleitung\n\n[[${slug}]]`);
    await page.getByTestId("wiki-new-submit").click();

    await expect(page.getByTestId(`wiki-slug-read-link-${slug}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`wiki-slug-read-link-${slug}`).click();

    await expect(page.getByTestId("wiki-read-root")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("wiki-read-title")).toContainText(title);
    await expect(page.getByTestId("wiki-read-body")).toContainText("Einleitung", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("wiki-read-outgoing")).toContainText(slug);
    await expect(page.getByTestId(`wiki-read-backlink-${slug}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("wiki-read-back-overview").click();
    await expect(page.getByTestId("wiki-root")).toBeVisible({ timeout: 15_000 });
  });
});
