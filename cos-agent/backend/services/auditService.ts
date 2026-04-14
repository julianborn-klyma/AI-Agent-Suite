import type { DatabaseClient } from "../db/databaseClient.ts";
import { extractIpFromRequest } from "../middleware/requestIp.ts";

export const AUDIT_ACTIONS = {
  USER_LOGIN: "user.login",
  USER_LOGIN_FAILED: "user.login_failed",
  USER_LOGIN_LOCKED: "user.login_locked",
  USER_PASSWORD_CHANGED: "user.password_changed",
  CREDENTIALS_UPDATED: "credentials.update",
  CREDENTIALS_DELETED: "credentials.delete",
  TENANT_CREATED: "tenant.create",
  TENANT_UPDATED: "tenant.update",
  USER_CREATED: "user.create",
  USER_DEACTIVATED: "user.deactivate",
  USER_ONBOARDING_COMPLETED: "user.onboarding_completed",
} as const;

export type AuditEvent = {
  id: string;
  action: string;
  user_id: string | null;
  tenant_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: unknown;
  ip_address: string | null;
  user_agent: string | null;
  success: boolean;
  created_at: Date;
};

export class AuditService {
  constructor(private db: DatabaseClient) {}

  async log(params: {
    action: string;
    userId?: string;
    tenantId?: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
    req?: Request;
  }): Promise<void> {
    let ip = params.ipAddress;
    let ua = params.userAgent;
    if (params.req) {
      ip = ip ?? extractIpFromRequest(params.req);
      ua = ua ?? params.req.headers.get("user-agent") ?? undefined;
    }
    try {
      await this.db.insertAuditLog({
        action: params.action,
        userId: params.userId ?? null,
        tenantId: params.tenantId ?? null,
        resourceType: params.resourceType ?? null,
        resourceId: params.resourceId ?? null,
        metadata: params.metadata ?? null,
        ipAddress: ip ?? null,
        userAgent: ua ?? null,
        success: params.success !== false,
      });
    } catch (e) {
      console.error({
        level: "error",
        event: "audit_log_failed",
        action: params.action,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async getAuditLog(params: {
    tenantId?: string;
    userId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<AuditEvent[]> {
    return await this.db.listAuditLog(params);
  }
}
