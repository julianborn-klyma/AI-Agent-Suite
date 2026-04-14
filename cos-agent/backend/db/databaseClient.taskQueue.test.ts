import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { createPostgresDatabaseClient } from "./databaseClient.ts";
import { runMigrations } from "./migrate.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";

Deno.test({
  name: "cos_task_queue — getNextPendingTask Priorität urgent vor medium vor low",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`tq-${userId.slice(0, 8)}@test.local`}, 'T', 'member', true)
      `;
      const db = createPostgresDatabaseClient(sql);

      await sql`
        INSERT INTO cos_task_queue (user_id, title, description, priority, status, created_at)
        VALUES
          (${userId}::uuid, 'L', 'd', 'low', 'pending', NOW() - INTERVAL '3 minutes'),
          (${userId}::uuid, 'U', 'd', 'urgent', 'pending', NOW() - INTERVAL '2 minutes'),
          (${userId}::uuid, 'M', 'd', 'medium', 'pending', NOW() - INTERVAL '1 minute')
      `;

      const first = await db.getNextPendingTask();
      assertEquals(first?.priority, "urgent");
      assertEquals(first?.title, "U");
      await db.updateTaskStatus(first!.id, "completed", {
        completed_at: new Date(),
        result: "x",
      });

      const second = await db.getNextPendingTask();
      assertEquals(second?.priority, "medium");
      await db.updateTaskStatus(second!.id, "completed", {
        completed_at: new Date(),
        result: "y",
      });

      const third = await db.getNextPendingTask();
      assertEquals(third?.priority, "low");
    } finally {
      await sql`DELETE FROM cos_task_queue WHERE user_id = ${userId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
