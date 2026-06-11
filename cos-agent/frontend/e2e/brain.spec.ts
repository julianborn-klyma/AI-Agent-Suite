import { expect, test } from "@playwright/test";

const PROJECT_ID = "aaaabbbb-cccc-4ddd-8eee-ffffaaaabbbb";
const ENTRY_ID = "11111111-2222-4333-8444-555566667777";
const MEMBER_USER_ID = "bbbbcccc-dddd-4eee-8fff-000011112222";

function mockUser(page: Parameters<typeof test>[1] extends (args: { page: infer P }) => unknown ? P : never, isAdmin = false) {
  return page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "e2e-user-id",
        name: "E2E User",
        email: "e2e@test.local",
        role: isAdmin ? "admin" : "member",
      }),
    });
  });
}

async function setupAuth(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cos_token", "e2e-mock-token");
  });
}

// ── BrainPage ─────────────────────────────────────────────────────────────────

test.describe("Brain Page (/brain)", () => {
  test("zeigt Projektliste mit Karten", async ({ page }) => {
    await setupAuth(page);

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "member",
        }),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: PROJECT_ID,
            name: "Betriebsleiter Projekt",
            description: "Produktionssteuerung",
            color: "#6366f1",
            is_active: true,
            member_role: "owner",
            member_count: 5,
            entry_count: 12,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: "22222222-3333-4444-5555-666677778888",
            name: "Strategie 2025",
            description: null,
            color: "#10b981",
            is_active: true,
            member_role: "member",
            member_count: 3,
            entry_count: 4,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/brain");

    await expect(page.getByText("Brain & Projekte")).toBeVisible();
    await expect(page.getByText("Betriebsleiter Projekt")).toBeVisible();
    await expect(page.getByText("Strategie 2025")).toBeVisible();
    await expect(page.getByText("Owner")).toBeVisible();
    await expect(page.getByText("5 Mitglieder")).toBeVisible();
    await expect(page.getByText("12 Einträge")).toBeVisible();
  });

  test("zeigt Leer-Zustand wenn keine Projekte", async ({ page }) => {
    await setupAuth(page);

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "member",
        }),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
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

    await page.goto("/brain");

    await expect(page.getByText("Noch keine Projekte")).toBeVisible();
  });

  test("öffnet und schließt 'Neues Projekt' Modal", async ({ page }) => {
    await setupAuth(page);

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "member",
        }),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
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

    await page.goto("/brain");
    await page.getByRole("button", { name: "+ Neues Projekt" }).click();
    await expect(page.getByText("Neues Projekt")).toBeVisible();
    await expect(page.getByPlaceholder("z.B. Betriebsleiter Projekt")).toBeVisible();

    // Schließen per Abbrechen
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByPlaceholder("z.B. Betriebsleiter Projekt")).not.toBeVisible();
  });
});

// ── BrainProjectPage ──────────────────────────────────────────────────────────

test.describe("Brain Projekt-Detail (/brain/:id)", () => {
  async function setupProjectMocks(page: import("@playwright/test").Page, role = "owner") {
    await setupAuth(page);

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "member",
        }),
      });
    });

    await page.route(`**/api/brain/projects/${PROJECT_ID}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: PROJECT_ID,
          name: "E2E Projekt",
          description: "Test-Beschreibung",
          color: "#6366f1",
          is_active: true,
          member_role: role,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    });

    await page.route(`**/api/brain/projects/${PROJECT_ID}/entries`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: ENTRY_ID,
            project_id: PROJECT_ID,
            type: "fact",
            content: "Hans ist PM seit 2019.",
            source: "manuell",
            tags: ["person"],
            confidence: 1.0,
            expires_at: null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            creator_name: "E2E User",
          },
          {
            id: "entry-2",
            project_id: PROJECT_ID,
            type: "decision",
            content: "Wartungsintervall auf 6 Wochen reduziert.",
            source: "Hans Meier",
            tags: [],
            confidence: 1.0,
            expires_at: null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.route(`**/api/brain/projects/${PROJECT_ID}/members`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "mem-1",
            project_id: PROJECT_ID,
            user_id: "e2e-user-id",
            role: role,
            invited_by: null,
            created_at: new Date().toISOString(),
            user_name: "E2E User",
            user_email: "e2e@test.local",
          },
          {
            id: "mem-2",
            project_id: PROJECT_ID,
            user_id: MEMBER_USER_ID,
            role: "member",
            invited_by: "e2e-user-id",
            created_at: new Date().toISOString(),
            user_name: "Anna Schmidt",
            user_email: "anna@test.local",
          },
        ]),
      });
    });

    await page.route(`**/api/brain/projects/${PROJECT_ID}/conflicts`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
  }

  test("zeigt Wissen-Tab mit Einträgen", async ({ page }) => {
    await setupProjectMocks(page, "owner");
    await page.goto(`/brain/${PROJECT_ID}`);

    await expect(page.getByText("E2E Projekt")).toBeVisible();
    await expect(page.getByText("Hans ist PM seit 2019.")).toBeVisible();
    await expect(page.getByText("Wartungsintervall auf 6 Wochen reduziert.")).toBeVisible();
    // Typ-Badges
    await expect(page.getByText("Fakt")).toBeVisible();
    await expect(page.getByText("Entscheidung")).toBeVisible();
  });

  test("owner sieht '+ Eintrag' Button", async ({ page }) => {
    await setupProjectMocks(page, "owner");
    await page.goto(`/brain/${PROJECT_ID}`);

    await expect(page.getByRole("button", { name: "+ Eintrag" })).toBeVisible();
  });

  test("member sieht keinen '+ Eintrag' Button", async ({ page }) => {
    await setupProjectMocks(page, "member");
    await page.goto(`/brain/${PROJECT_ID}`);

    await expect(page.getByText("Hans ist PM seit 2019.")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Eintrag" })).not.toBeVisible();
  });

  test("knowledge_owner sieht '+ Eintrag' Button", async ({ page }) => {
    await setupProjectMocks(page, "knowledge_owner");
    await page.goto(`/brain/${PROJECT_ID}`);

    await expect(page.getByRole("button", { name: "+ Eintrag" })).toBeVisible();
  });

  test("Tab-Wechsel zu Team zeigt Mitglieder-Liste", async ({ page }) => {
    await setupProjectMocks(page, "owner");
    await page.goto(`/brain/${PROJECT_ID}`);

    await page.getByRole("button", { name: "Team" }).click();
    await expect(page.getByText("Anna Schmidt")).toBeVisible();
    await expect(page.getByText("anna@test.local")).toBeVisible();
    // Owner sieht Rolle-Buttons
    await expect(page.getByRole("button", { name: "Rolle" }).first()).toBeVisible();
  });

  test("owner sieht '+ Person einladen' Button im Team-Tab", async ({ page }) => {
    await setupProjectMocks(page, "owner");
    await page.goto(`/brain/${PROJECT_ID}`);

    await page.getByRole("button", { name: "Team" }).click();
    await expect(page.getByRole("button", { name: "+ Person einladen" })).toBeVisible();
  });

  test("member sieht keinen '+ Person einladen' Button", async ({ page }) => {
    await setupProjectMocks(page, "member");
    await page.goto(`/brain/${PROJECT_ID}`);

    await page.getByRole("button", { name: "Team" }).click();
    await expect(page.getByRole("button", { name: "+ Person einladen" })).not.toBeVisible();
  });

  test("Typ-Filter reduziert angezeigte Einträge", async ({ page }) => {
    await setupProjectMocks(page, "owner");
    await page.goto(`/brain/${PROJECT_ID}`);

    // Alle Einträge sichtbar
    await expect(page.getByText("Hans ist PM seit 2019.")).toBeVisible();
    await expect(page.getByText("Wartungsintervall auf 6 Wochen reduziert.")).toBeVisible();

    // Nach "Entscheidung" filtern
    await page.selectOption("select", "decision");
    await expect(page.getByText("Wartungsintervall auf 6 Wochen reduziert.")).toBeVisible();
    await expect(page.getByText("Hans ist PM seit 2019.")).not.toBeVisible();
  });

  test("Eintrag-Formular öffnet und schließt sich", async ({ page }) => {
    await setupProjectMocks(page, "owner");
    await page.goto(`/brain/${PROJECT_ID}`);

    await page.getByRole("button", { name: "+ Eintrag" }).click();
    await expect(page.getByPlaceholder("Beschreibe den Fakt, die Entscheidung, den Prozess…")).toBeVisible();

    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByPlaceholder("Beschreibe den Fakt, die Entscheidung, den Prozess…")).not.toBeVisible();
  });

  test("zeigt Konflikt-Warning wenn offene Konflikte vorhanden", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "member",
        }),
      });
    });
    await page.route(`**/api/brain/projects/${PROJECT_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: PROJECT_ID,
          name: "E2E Projekt",
          description: null,
          color: "#6366f1",
          is_active: true,
          member_role: "owner",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    });
    await page.route(`**/api/brain/projects/${PROJECT_ID}/entries`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route(`**/api/brain/projects/${PROJECT_ID}/members`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route(`**/api/brain/projects/${PROJECT_ID}/conflicts`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "conflict-1",
            project_id: PROJECT_ID,
            entry_a_id: "entry-a",
            entry_b_id: "entry-b",
            conflict_description: "Widersprüchliche Angaben zu Wartungsintervall",
            resolved: false,
            resolved_by: null,
            resolved_at: null,
            created_at: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto(`/brain/${PROJECT_ID}`);

    await expect(page.getByText("1 offene")).toBeVisible();
    await expect(page.getByText("Widersprüchliche Angaben zu Wartungsintervall")).toBeVisible();
  });
});

// ── Chat mit Projekt-Selector ─────────────────────────────────────────────────

test.describe("Chat — Projekt-Selector", () => {
  test("zeigt Projekt-Selector wenn Projekte vorhanden", async ({ page }) => {
    await setupAuth(page);

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "member",
        }),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: PROJECT_ID,
            name: "Betriebsleiter Projekt",
            description: null,
            color: "#6366f1",
            is_active: true,
            member_role: "owner",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.route("**/api/chat/sessions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/chat");

    await expect(page.getByText("Projekt-Kontext")).toBeVisible();
    await expect(page.getByRole("option", { name: "Betriebsleiter Projekt" })).toBeVisible();
  });

  test("sendet project_id bei Auswahl eines Projekts", async ({ page }) => {
    await setupAuth(page);

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-user-id",
          name: "E2E User",
          email: "e2e@test.local",
          role: "member",
        }),
      });
    });

    await page.route("**/api/brain/projects", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: PROJECT_ID,
            name: "Betriebsleiter Projekt",
            description: null,
            color: "#6366f1",
            is_active: true,
            member_role: "owner",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.route("**/api/chat/sessions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    let sentProjectId: string | undefined;
    await page.route("**/api/chat", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") {
        await route.fallback();
        return;
      }
      const body = JSON.parse(req.postData() ?? "{}") as { project_id?: string };
      sentProjectId = body.project_id;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          response: "Antwort mit Projekt-Kontext.",
          session_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          tool_calls_made: [],
        }),
      });
    });

    await page.goto("/chat");

    // Projekt auswählen
    await page.selectOption("select", PROJECT_ID);
    // Nachricht senden
    await page.getByTestId("chat-input").fill("Was ist der Status?");
    await page.getByTestId("chat-send").click();

    // Auf Antwort warten
    await expect(page.getByText("Antwort mit Projekt-Kontext.")).toBeVisible({
      timeout: 15_000,
    });

    expect(sentProjectId).toBe(PROJECT_ID);
  });
});
