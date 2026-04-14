import type { DatabaseClient, Tenant } from "../db/databaseClient.ts";
import { decrypt, encrypt } from "./tools/credentialHelper.ts";
import { AUDIT_ACTIONS, type AuditService } from "./auditService.ts";

export interface TenantCredentials {
  slack?: { clientId: string; clientSecret: string };
  google?: { clientId: string; clientSecret: string };
  notion?: { clientId: string; clientSecret: string };
}

export class TenantService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  async getOAuthCredentials(tenantId: string): Promise<TenantCredentials> {
    const t = await this.db.getTenant(tenantId);
    if (!t) return {};
    const out: TenantCredentials = {};
    if (
      t.slack_client_id?.trim() && t.slack_client_secret_enc?.trim()
    ) {
      try {
        out.slack = {
          clientId: t.slack_client_id.trim(),
          clientSecret: await decrypt(t.slack_client_secret_enc.trim()),
        };
      } catch {
        /* ungültiges Secret — Provider weglassen */
      }
    }
    if (
      t.google_client_id?.trim() && t.google_client_secret_enc?.trim()
    ) {
      try {
        out.google = {
          clientId: t.google_client_id.trim(),
          clientSecret: await decrypt(t.google_client_secret_enc.trim()),
        };
      } catch {
        /* ungültiges Secret */
      }
    }
    if (
      t.notion_client_id?.trim() && t.notion_client_secret_enc?.trim()
    ) {
      try {
        out.notion = {
          clientId: t.notion_client_id.trim(),
          clientSecret: await decrypt(t.notion_client_secret_enc.trim()),
        };
      } catch {
        /* ungültiges Secret */
      }
    }
    return out;
  }

  async saveCredentials(
    tenantId: string,
    provider: "slack" | "google" | "notion",
    params: { clientId: string; clientSecret: string },
    auditContext: { userId: string; ipAddress?: string },
  ): Promise<void> {
    const enc = await encrypt(params.clientSecret.trim());
    const cid = params.clientId.trim();
    if (provider === "slack") {
      await this.db.updateTenantCredentials(tenantId, {
        slack_client_id: cid,
        slack_client_secret_enc: enc,
      });
    } else if (provider === "google") {
      await this.db.updateTenantCredentials(tenantId, {
        google_client_id: cid,
        google_client_secret_enc: enc,
      });
    } else {
      await this.db.updateTenantCredentials(tenantId, {
        notion_client_id: cid,
        notion_client_secret_enc: enc,
      });
    }
    await this.audit.log({
      action: AUDIT_ACTIONS.CREDENTIALS_UPDATED,
      userId: auditContext.userId,
      tenantId,
      resourceType: "tenant",
      resourceId: tenantId,
      metadata: { provider },
      ipAddress: auditContext.ipAddress,
      success: true,
    });
  }

  async removeCredentials(
    tenantId: string,
    provider: "slack" | "google" | "notion",
    auditContext: { userId: string; ipAddress?: string },
  ): Promise<void> {
    if (provider === "slack") {
      await this.db.updateTenantCredentials(tenantId, {
        slack_client_id: null,
        slack_client_secret_enc: null,
      });
    } else if (provider === "google") {
      await this.db.updateTenantCredentials(tenantId, {
        google_client_id: null,
        google_client_secret_enc: null,
      });
    } else {
      await this.db.updateTenantCredentials(tenantId, {
        notion_client_id: null,
        notion_client_secret_enc: null,
      });
    }
    await this.audit.log({
      action: AUDIT_ACTIONS.CREDENTIALS_DELETED,
      userId: auditContext.userId,
      tenantId,
      resourceType: "tenant",
      resourceId: tenantId,
      metadata: { provider },
      ipAddress: auditContext.ipAddress,
      success: true,
    });
  }

  isProviderConfigured(tenant: Tenant, provider: string): boolean {
    if (provider === "slack") return Boolean(tenant.slack_client_id?.trim());
    if (provider === "google") return Boolean(tenant.google_client_id?.trim());
    if (provider === "notion") return Boolean(tenant.notion_client_id?.trim());
    return false;
  }

  /** Tenant hat OAuth-Client-ID oder (nur Development) globale ENV-Credentials. */
  googleConnectionAvailable(tenant: Tenant): boolean {
    if (this.isProviderConfigured(tenant, "google")) return true;
    return this.devEnvFallback() &&
      this.hasEnvGoogle();
  }

  slackConnectionAvailable(tenant: Tenant): boolean {
    if (this.isProviderConfigured(tenant, "slack")) return true;
    return this.devEnvFallback() &&
      Boolean(
        this.envSlackClientId()?.trim() && this.envSlackClientSecret()?.trim(),
      );
  }

  private envSlackClientId(): string {
    return Deno.env.get("SLACK_CLIENT_ID")?.trim() ?? "";
  }

  private envSlackClientSecret(): string {
    return Deno.env.get("SLACK_CLIENT_SECRET")?.trim() ?? "";
  }

  private hasEnvGoogle(): boolean {
    return Boolean(
      Deno.env.get("GOOGLE_CLIENT_ID")?.trim() &&
        Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim(),
    );
  }

  private devEnvFallback(): boolean {
    return (Deno.env.get("APP_ENV") ?? "development") === "development";
  }

  async requireTenantForUser(userId: string): Promise<Tenant> {
    const t = await this.db.getTenantForUser(userId);
    if (!t) throw new Error("Kein Tenant für User");
    return t;
  }

  async createTenant(
    params: {
      name: string;
      slug: string;
      plan?: string;
      admin_email?: string;
    },
    auditContext: { userId: string },
  ): Promise<Tenant> {
    const t = await this.db.insertTenant(params);
    await this.audit.log({
      action: AUDIT_ACTIONS.TENANT_CREATED,
      userId: auditContext.userId,
      tenantId: t.id,
      resourceType: "tenant",
      resourceId: t.id,
      metadata: { slug: t.slug, name: t.name },
      success: true,
    });
    return t;
  }
}
