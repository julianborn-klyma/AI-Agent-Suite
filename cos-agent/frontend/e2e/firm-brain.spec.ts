import { expect, test } from "@playwright/test";

const INSIGHT_ID = "ccccdddd-eeee-4fff-8000-111122223333";

async function setupAuth(page: import("@playwright/test").Page, isAdmin = false) {
  await page.addInitScript(() => {
    localStorage.setItem("cos_token", "e2e-mock-token");
  });

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-admin-id",
        name: "E2E Admin",
        email: "admin@test.local",
        role: isAdmin ? "admin" : "member",
      }),
    });
  });
}

function sampleInsight(overrides: Record<string, unknown> = {}) {
  return {
    id: INSIGHT_ID,
    tenant_id: "tenant-1",
    source_project_id: "project-1",
    source_project_name: "Betriebsleiter Projekt",
    source_user_id: "user-1",
    source_session_id: "sess-1",
    category: "person",
    content: "Klaus ist Abteilungsleiter und verantwortet Linien 1-3.",
    confidence: 0.85,
    tags: ["person", "produktion"],
    admin_suppressed: false,
    created_at: "2025-05-15T10:00:00.000Z",
    updated_at: "2025-05-15T10:00:00.000Z",
    ...overrides,
  };
}

test.describe("Admin Firm Brain (/admin/firm-brain)", () => {
  test("zeigt Insights-Liste mit Kategorie und Inhalt", async ({ page }) => {
    await setupAuth(page, true);

    await page.route("**/api/admin/firm-brain**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          sampleInsight(),
          sampleInsight({
            id: "insight-2",
            category: "decision",
            content: "Wartungsintervall auf 6 Wochen gesetzt.",
            source_project_name: "Produktion Q2",
            confidence: 0.9,
          }),
        ]),
      });
    });

    await page.goto("/admin/firm-brain");

    await expect(page.getByText("Firm Brain")).toBeVisible();
    await expect(
      page.getByText("Klaus ist Abteilungsleiter und verantwortet Linien 1-3."),
    ).toBeVisible();
    await expect(page.getByText("Wartungsintervall auf 6 Wochen gesetzt.")).toBeVisible();
    // Kategorie-Badges sichtbar
    await expect(page.getByText("Person")).toBeVisible();
    await expect(page.getByText("Entscheidung")).toBeVisible();
    // Supprimieren-Buttons
    await expect(page.getByRole("button", { name: "Supprimieren" }).first()).toBeVisible();
    // "2 Insights" Zähler
    await expect(page.getByText("2 Insights")).toBeVisible();
  });

  test("zeigt Leer-Zustand wenn keine Insights", async ({ page }) => {
    await setupAuth(page, true);

    await page.route("**/api/admin/firm-brain**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/admin/firm-brain");

    await expect(
      page.getByText("Noch keine Firm Brain Insights"),
    ).toBeVisible();
  });

  test("Kategorie-Filter reduziert sichtbare Insights", async ({ page }) => {
    await setupAuth(page, true);

    await page.route("**/api/admin/firm-brain**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          sampleInsight({ category: "person", content: "Person-Insight." }),
          sampleInsight({
            id: "insight-2",
            category: "decision",
            content: "Entscheidungs-Insight.",
          }),
        ]),
      });
    });

    await page.goto("/admin/firm-brain");

    // Beide sichtbar
    await expect(page.getByText("Person-Insight.")).toBeVisible();
    await expect(page.getByText("Entscheidungs-Insight.")).toBeVisible();

    // Nach "Entscheidung" filtern
    await page.selectOption("select", "decision");
    await expect(page.getByText("Entscheidungs-Insight.")).toBeVisible();
    await expect(page.getByText("Person-Insight.")).not.toBeVisible();
  });

  test("Supprimieren-Button sendet PATCH-Request", async ({ page }) => {
    await setupAuth(page, true);

    let patchCalled = false;
    let patchBody: unknown = null;

    await page.route("**/api/admin/firm-brain**", async (route) => {
      const method = route.request().method();

      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([sampleInsight()]),
        });
        return;
      }

      if (method === "PATCH") {
        patchCalled = true;
        patchBody = JSON.parse(route.request().postData() ?? "{}");
        // Antwort: insight now suppressed
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            sampleInsight({ admin_suppressed: true }),
          ),
        });
        return;
      }

      await route.fallback();
    });

    await page.goto("/admin/firm-brain");

    await expect(page.getByText("Klaus ist Abteilungsleiter")).toBeVisible();
    await page.getByRole("button", { name: "Supprimieren" }).first().click();

    expect(patchCalled).toBe(true);
    expect((patchBody as { admin_suppressed: boolean }).admin_suppressed).toBe(true);
  });

  test("supprimierte Insights sind standardmäßig ausgeblendet", async ({ page }) => {
    await setupAuth(page, true);

    await page.route("**/api/admin/firm-brain**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          sampleInsight({ content: "Aktiver Insight." }),
          sampleInsight({
            id: "suppressed-1",
            content: "Supprimierter Insight.",
            admin_suppressed: true,
          }),
        ]),
      });
    });

    await page.goto("/admin/firm-brain");

    await expect(page.getByText("Aktiver Insight.")).toBeVisible();
    await expect(page.getByText("Supprimierter Insight.")).not.toBeVisible();

    // Checkbox aktivieren → supprimierter Insight erscheint
    await page.getByRole("checkbox").check();
    await expect(page.getByText("Supprimierter Insight.")).toBeVisible();
    await expect(page.getByText("supprimiert")).toBeVisible();
  });

  test("Löschen-Button sendet DELETE-Request", async ({ page }) => {
    await setupAuth(page, true);

    let deleteCalled = false;

    await page.route("**/api/admin/firm-brain**", async (route) => {
      const method = route.request().method();

      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([sampleInsight()]),
        });
        return;
      }

      if (method === "DELETE") {
        deleteCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ deleted: true }),
        });
        return;
      }

      await route.fallback();
    });

    // Dialog bestätigen
    page.once("dialog", (dialog) => void dialog.accept());

    await page.goto("/admin/firm-brain");
    await expect(page.getByText("Klaus ist Abteilungsleiter")).toBeVisible();
    await page.getByRole("button", { name: "Löschen" }).first().click();

    expect(deleteCalled).toBe(true);
  });
});
