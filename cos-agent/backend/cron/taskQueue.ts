import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";

let busy = false;

/**
 * Alle 30s: einen pending Task holen und verarbeiten.
 * Bei Erfolg sofort nächsten Versuch (Schleife), bis Queue leer.
 * Nur ein Lauf gleichzeitig (`busy`); DB nutzt FOR UPDATE SKIP LOCKED.
 */
export function startTaskQueueCron(
  deps: AppDependencies,
  _env: AppEnv,
): void {
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      while (true) {
        const r = await deps.taskQueueService.processNextTask();
        if (!r.processed && r.reason === "queue_empty") break;
        if (!r.processed) break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          component: "task-queue-cron",
          event: "tick_failed",
          message: msg,
        }),
      );
    } finally {
      busy = false;
    }
  };

  setInterval(() => {
    void tick();
  }, 30_000);
  setTimeout(() => void tick(), 3_000);
}
