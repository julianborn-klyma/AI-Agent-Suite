import { expect, test } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL?.trim() ?? "e2e-user@test.local";
const password = process.env.E2E_USER_PASSWORD?.trim() ?? "Playwright-E2E-2026!";

test.describe("Workspace Tasks", () => {
  test("Projekt und internen Task anlegen", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 45_000 });

    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-root")).toBeVisible({ timeout: 15_000 });

    const uniq = `E2E-${Date.now()}`;
    const projectName = `Proj ${uniq}`;
    const taskTitle = `Task ${uniq}`;

    await page.getByTestId("workspace-open-project-modal").click();
    await page.getByTestId("workspace-new-project-name").fill(projectName);
    await page.getByTestId("workspace-new-project-submit").click();

    await page.getByTestId("workspace-open-task-modal").click();
    await page.getByTestId("workspace-new-task-title").fill(taskTitle);
    const projSelect = page.getByTestId("workspace-new-task-project");
    await expect(projSelect.locator("option", { hasText: uniq })).toHaveCount(1, {
      timeout: 15_000,
    });
    await projSelect.selectOption({ label: projectName });
    await page.getByTestId("workspace-new-task-submit").click();

    const tableLink = page.getByTestId("workspace-task-table").getByRole("link", {
      name: taskTitle,
    });
    await expect(tableLink).toBeVisible({ timeout: 15_000 });

    await page.goto("/chat");
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("chat-input").fill("Liste interne Work-Tasks bitte.");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("chat-tool-pill-workspace")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(taskTitle, { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-root")).toBeVisible({ timeout: 15_000 });
    const tableLinkAgain = page.getByTestId("workspace-task-table").getByRole("link", {
      name: taskTitle,
    });
    await expect(tableLinkAgain).toBeVisible({ timeout: 15_000 });
    const taskHref = await tableLinkAgain.getAttribute("href");
    const taskId = taskHref!.split("/").pop()!;

    await page.getByTestId("workspace-view-board").click();
    await expect(page.getByTestId("workspace-task-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("workspace-board-col-open")).toContainText(taskTitle);
    await page.getByTestId(`workspace-board-status-${taskId}`).selectOption("in_progress");
    await expect(page.getByTestId("workspace-board-col-in_progress")).toContainText(taskTitle, {
      timeout: 15_000,
    });

    await page.getByTestId("workspace-view-list").click();
    await expect(page.getByTestId("workspace-task-table")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId("workspace-task-table").locator("tr", {
        has: page.getByRole("link", { name: taskTitle }),
      }),
    ).toContainText("in_progress", { timeout: 15_000 });

    await page.getByRole("link", { name: taskTitle }).click();
    await expect(page.getByTestId("workspace-task-detail-delete")).toBeVisible({
      timeout: 15_000,
    });
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("workspace-task-detail-delete").click();
    await expect(page).toHaveURL(/\/workspace$/, { timeout: 15_000 });
    await expect(page.getByRole("link", { name: taskTitle })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
