import type { DatabaseClient } from "./databaseClient.ts";

/** Minimale Auth-/Audit-Stubs für `implements DatabaseClient` in Unit-Tests. */
export const testAuthDbStubMethods = {
  async countLoginAttemptsByIpSince(
    _ip: string,
    _sinceMinutes: number,
  ): Promise<number> {
    return 0;
  },
  async insertLoginAttempt(_params: {
    email: string;
    ipAddress: string;
    success: boolean;
    userAgent: string | null;
  }): Promise<void> {},
  async incrementFailedLogin(_userId: string): Promise<{
    attempts: number;
    locked_until: Date | null;
  }> {
    return { attempts: 0, locked_until: null };
  },
  async recordSuccessfulLogin(_userId: string, _ip: string): Promise<void> {},
  async updateUserPasswordHash(_userId: string, _hash: string): Promise<void> {},
  async insertAuditLog(_params: {
    action: string;
    userId?: string | null;
    tenantId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    success?: boolean;
  }): Promise<void> {},
  async listAuditLog(
    _params: Parameters<DatabaseClient["listAuditLog"]>[0],
  ): Promise<Awaited<ReturnType<DatabaseClient["listAuditLog"]>>> {
    return [];
  },
  async findUserWithPasswordById(
    _userId: string,
  ): Promise<
    Awaited<ReturnType<DatabaseClient["findUserWithPasswordById"]>>
  > {
    return null;
  },

  async getTenant(_id: string): Promise<Awaited<ReturnType<DatabaseClient["getTenant"]>>> {
    return null;
  },
  async getTenantBySlug(
    _slug: string,
  ): Promise<Awaited<ReturnType<DatabaseClient["getTenantBySlug"]>>> {
    return null;
  },
  async listTenants(): Promise<Awaited<ReturnType<DatabaseClient["listTenants"]>>> {
    return [];
  },
  async insertTenant(
    _params: Parameters<DatabaseClient["insertTenant"]>[0],
  ): Promise<Awaited<ReturnType<DatabaseClient["insertTenant"]>>> {
    throw new Error("insertTenant nicht im Test-Stub");
  },
  async updateTenant(
    _id: string,
    _params: Parameters<DatabaseClient["updateTenant"]>[1],
  ): Promise<Awaited<ReturnType<DatabaseClient["updateTenant"]>>> {
    throw new Error("updateTenant nicht im Test-Stub");
  },
  async updateTenantCredentials(
    _id: string,
    _credentials: Parameters<DatabaseClient["updateTenantCredentials"]>[1],
  ): Promise<void> {},
  async getTenantForUser(
    _userId: string,
  ): Promise<Awaited<ReturnType<DatabaseClient["getTenantForUser"]>>> {
    return null;
  },

  async setOnboardingCompleted(_userId: string): Promise<void> {},
  async getUserOnboardingSnapshot(
    _userId: string,
  ): Promise<Awaited<ReturnType<DatabaseClient["getUserOnboardingSnapshot"]>>> {
    return null;
  },
} satisfies Pick<
  DatabaseClient,
  | "countLoginAttemptsByIpSince"
  | "insertLoginAttempt"
  | "incrementFailedLogin"
  | "recordSuccessfulLogin"
  | "updateUserPasswordHash"
  | "insertAuditLog"
  | "listAuditLog"
  | "findUserWithPasswordById"
  | "getTenant"
  | "getTenantBySlug"
  | "listTenants"
  | "insertTenant"
  | "updateTenant"
  | "updateTenantCredentials"
  | "getTenantForUser"
  | "setOnboardingCompleted"
  | "getUserOnboardingSnapshot"
>;
