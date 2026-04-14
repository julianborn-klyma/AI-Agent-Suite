import type { DatabaseClient } from "../db/databaseClient.ts";
import type { TenantService } from "./tenantService.ts";
import type { AuditService } from "./auditService.ts";
import { AUDIT_ACTIONS } from "./auditService.ts";

export type OnboardingNextStep = "profile" | "connections" | "chat" | "done";

export type OnboardingStatus = {
  completed: boolean;
  /** ISO-8601, für Client (OnboardingGuard: Account-Alter). */
  user_created_at: string;
  steps: {
    profile: boolean;
    connections: {
      google: boolean;
      notion: boolean;
      slack: boolean;
    };
    first_task: boolean;
    first_chat: boolean;
  };
  next_step: OnboardingNextStep;
};

function ctxTrue(m: Map<string, string>, key: string): boolean {
  return m.get(key)?.trim().toLowerCase() === "true";
}

export class OnboardingService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly _tenantService: TenantService,
    private readonly audit: AuditService,
  ) {}

  async getStatus(userId: string): Promise<OnboardingStatus> {
    void this._tenantService;
    const snap = await this.db.getUserOnboardingSnapshot(userId);
    if (!snap) {
      return {
        completed: false,
        user_created_at: new Date(0).toISOString(),
        steps: {
          profile: false,
          connections: { google: false, notion: false, slack: false },
          first_task: false,
          first_chat: false,
        },
        next_step: "profile",
      };
    }

    const rows = await this.db.listUserContexts(userId);
    const m = new Map(rows.map((r) => [r.key, r.value]));

    const roleOk = (m.get("role")?.trim().length ?? 0) >= 3;
    const nameOk = snap.name.trim().length >= 2;
    const profile = roleOk && nameOk;

    const connections = {
      google: ctxTrue(m, "google_connected"),
      notion: ctxTrue(m, "notion_connected"),
      slack: ctxTrue(m, "slack_connected"),
    };
    const anyConn = connections.google || connections.notion || connections.slack;
    const skipConn = m.get("onboarding_skip_connections")?.trim() === "true";

    const first_task = snap.task_count >= 1;
    const first_chat = snap.conversation_count >= 1;
    const skipChat = m.get("onboarding_skip_chat")?.trim() === "true";

    const completed = snap.onboarding_completed === true;

    let next_step: OnboardingNextStep = "done";
    if (completed) {
      next_step = "done";
    } else if (!profile) {
      next_step = "profile";
    } else if (!anyConn && !skipConn) {
      next_step = "connections";
    } else if (!first_chat && !skipChat) {
      next_step = "chat";
    } else {
      next_step = "done";
    }

    return {
      completed,
      user_created_at: snap.created_at.toISOString(),
      steps: {
        profile,
        connections,
        first_task,
        first_chat,
      },
      next_step,
    };
  }

  async completeOnboarding(userId: string, req?: Request): Promise<void> {
    await this.db.setOnboardingCompleted(userId);
    const snap = await this.db.getUserOnboardingSnapshot(userId);
    await this.audit.log({
      action: AUDIT_ACTIONS.USER_ONBOARDING_COMPLETED,
      userId,
      tenantId: snap?.tenant_id ?? undefined,
      resourceType: "user",
      resourceId: userId,
      req,
    });
  }

  async skipStep(
    userId: string,
    step: "connections" | "chat",
  ): Promise<void> {
    if (step === "connections") {
      await this.db.upsertUserContext({
        userId,
        key: "onboarding_skip_connections",
        value: "true",
      });
    } else {
      await this.db.upsertUserContext({
        userId,
        key: "onboarding_skip_chat",
        value: "true",
      });
    }
  }
}
