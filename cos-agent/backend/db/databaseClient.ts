import type { LearningCandidate } from "../agents/types.ts";
import {
  DEFAULT_JOB_CRONS,
  DEFAULT_JOB_DISPLAY,
  SCHEDULE_JOB_TYPES,
} from "../schedules/constants.ts";
import postgres from "postgres";

export type UserContextRow = { key: string; value: string };
export type ConversationMessageRow = { role: string; content: string };

export type AgentConfigRow = {
  system_prompt: string;
  tools_enabled: string[];
};

export type ChatHistoryEntry = {
  role: string;
  content: string;
  created_at: Date;
};

export type ChatSessionSummary = {
  session_id: string;
  /** Erste User-Message, max. 80 Zeichen (bereits gekürzt). */
  preview: string;
  last_activity: Date;
  message_count: number;
};

export type Learning = {
  id: string;
  user_id: string;
  category: string;
  content: string;
  source: string;
  source_ref: string | null;
  confidence: number;
  confirmed_by_user: boolean;
  times_confirmed: number;
  contradicts_id: string | null;
  first_seen: Date;
  last_confirmed: Date;
  is_active: boolean;
  created_at: Date;
};

export type Document = {
  id: string;
  user_id: string;
  name: string;
  document_type: string;
  content_text: string | null;
  summary: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  source: string;
  drive_file_id: string | null;
  processed: boolean;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type DocumentChunk = {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  page_number: number | null;
  section_title: string | null;
  content: string;
  token_count: number | null;
  created_at: Date;
};

export type Schedule = {
  id: string;
  user_id: string;
  job_type: string;
  cron_expression: string;
  delivery_channel: string;
  delivery_target: string;
  is_active: boolean;
  display_name: string | null;
  description: string | null;
  last_run: Date | null;
  last_run_status: string | null;
  created_at: Date;
};

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  slack_client_id: string | null;
  slack_client_secret_enc: string | null;
  google_client_id: string | null;
  google_client_secret_enc: string | null;
  notion_client_id: string | null;
  notion_client_secret_enc: string | null;
  plan: string;
  is_active: boolean;
  admin_email: string | null;
  created_at: string;
  updated_at: string;
}

export type TenantListEntry = Tenant & {
  user_count: number;
  credentials_configured: {
    slack: boolean;
    google: boolean;
    notion: boolean;
  };
};

export class SlugTakenError extends Error {
  readonly code = "SLUG_TAKEN" as const;
  constructor() {
    super("SLUG_TAKEN");
    this.name = "SlugTakenError";
  }
}

/** Zeile `cos_task_queue` (async Agent-Tasks). */
export type TaskQueueRow = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  document_ids: string[] | null;
  context: string | null;
  result: string | null;
  result_notion_page_id: string | null;
  result_draft_id: string | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type GetLearningsOptions = {
  categories?: string[];
  minConfidence?: number;
  limit?: number;
  activeOnly?: boolean;
  /** Nur Einträge mit last_confirmed >= since (z. B. Verdichtung letzte 7 Tage). */
  since?: Date;
};

export class LearningOwnershipError extends Error {
  constructor(message = "Learning nicht gefunden oder keine Berechtigung") {
    super(message);
    this.name = "LearningOwnershipError";
  }
}

/** Von AgentService genutzte DB-Operationen (Vendor-/Driver-agnostisch). */
export interface DatabaseClient {
  findAgentConfigForUser(userId: string): Promise<AgentConfigRow | null>;
  listUserContexts(userId: string): Promise<UserContextRow[]>;
  upsertUserContext(params: {
    userId: string;
    key: string;
    value: string;
  }): Promise<void>;
  listRecentConversationMessages(
    userId: string,
    sessionId: string,
    limit: number,
  ): Promise<ConversationMessageRow[]>;
  insertConversationMessage(params: {
    userId: string;
    sessionId: string;
    role: string;
    content: string;
  }): Promise<void>;
  insertLlmCall(params: {
    userId: string;
    /** `null` z. B. für Briefing ohne Chat-Session. */
    sessionId: string | null;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    latencyMs: number | null;
  }): Promise<void>;

  /** Aktiver User für Briefing; `null` wenn nicht gefunden oder inaktiv. */
  findBriefingUser(userId: string): Promise<{ name: string; email: string } | null>;

  findUserByEmail(
    email: string,
  ): Promise<
    | {
      id: string;
      name: string;
      email: string;
      role: string;
      is_active: boolean;
      password_hash: string | null;
      failed_login_attempts: number;
      locked_until: Date | null;
      last_login_at: Date | null;
      last_login_ip: string | null;
    }
    | null
  >;

  countLoginAttemptsByIpSince(
    ip: string,
    sinceMinutes: number,
  ): Promise<number>;

  insertLoginAttempt(params: {
    email: string;
    ipAddress: string;
    success: boolean;
    userAgent: string | null;
  }): Promise<void>;

  incrementFailedLogin(userId: string): Promise<{
    attempts: number;
    locked_until: Date | null;
  }>;

  recordSuccessfulLogin(userId: string, ip: string): Promise<void>;

  updateUserPasswordHash(userId: string, passwordHash: string): Promise<void>;

  insertAuditLog(params: {
    action: string;
    userId?: string | null;
    tenantId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    success?: boolean;
  }): Promise<void>;

  listAuditLog(params: {
    tenantId?: string;
    userId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<
    {
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
    }[]
  >;

  findUserWithPasswordById(
    userId: string,
  ): Promise<
    | {
      id: string;
      name: string;
      email: string;
      role: string;
      is_active: boolean;
      password_hash: string | null;
    }
    | null
  >;

  findUserProfileById(
    userId: string,
  ): Promise<
    { id: string; name: string; email: string; role: string } | null
  >;

  setOnboardingCompleted(userId: string): Promise<void>;

  getUserOnboardingSnapshot(userId: string): Promise<{
    onboarding_completed: boolean;
    created_at: Date;
    name: string;
    tenant_id: string | null;
    task_count: number;
    conversation_count: number;
  } | null>;

  /** `user_id` der chronologisch ersten Zeile der Session, sonst `null`. */
  getSessionOwnerUserId(sessionId: string): Promise<string | null>;

  listChatHistoryForUser(
    userId: string,
    sessionId: string,
    limit: number,
  ): Promise<ChatHistoryEntry[]>;

  listChatSessionsForUser(userId: string): Promise<ChatSessionSummary[]>;

  deleteChatSessionForUser(
    userId: string,
    sessionId: string,
  ): Promise<number>;

  insertOauthState(params: {
    state: string;
    /** null z. B. für Google-Login ohne bestehende Session */
    userId: string | null;
    provider: string;
  }): Promise<void>;

  consumeOauthState(
    state: string,
  ): Promise<{ userId: string | null; provider: string } | null>;

  deleteUserContextsByKeys(userId: string, keys: string[]): Promise<void>;

  getLearnings(
    userId: string,
    options?: GetLearningsOptions,
  ): Promise<Learning[]>;

  upsertLearning(userId: string, candidate: LearningCandidate): Promise<Learning>;

  upsertLearnings(
    userId: string,
    candidates: LearningCandidate[],
  ): Promise<Learning[]>;

  markLearningConflict(id: string, contradictsId: string): Promise<void>;

  confirmLearning(id: string, userId: string): Promise<void>;

  deactivateLearning(id: string, userId: string): Promise<void>;

  /** Setzt confirmed_by_user für aktive Learnings mit times_confirmed ≥ minTimes. */
  bulkConfirmLearningsByTimesConfirmed(
    userId: string,
    minTimes: number,
  ): Promise<void>;

  insertDocument(
    userId: string,
    doc: {
      name: string;
      document_type: string;
      content_text?: string;
      summary?: string;
      file_size_bytes?: number;
      mime_type?: string;
      source?: string;
      drive_file_id?: string;
    },
  ): Promise<Document>;

  getDocuments(
    userId: string,
    options?: {
      document_type?: string;
      processed?: boolean;
      limit?: number;
      drive_file_id?: string;
    },
  ): Promise<Document[]>;

  getDocument(id: string, userId: string): Promise<Document | null>;

  updateDocumentProcessed(
    id: string,
    userId: string,
    result: { summary: string; content_text?: string },
  ): Promise<void>;

  deleteDocument(id: string, userId: string): Promise<void>;

  insertChunks(
    chunks: Array<{
      document_id: string;
      user_id: string;
      chunk_index: number;
      page_number?: number;
      section_title?: string;
      content: string;
      token_count?: number;
    }>,
  ): Promise<void>;

  searchChunks(params: {
    documentId: string;
    userId: string;
    query: string;
    limit?: number;
  }): Promise<DocumentChunk[]>;

  getChunks(documentId: string, userId: string): Promise<DocumentChunk[]>;

  getUserSchedules(userId: string): Promise<Schedule[]>;

  upsertJobSchedule(
    userId: string,
    params: {
      job_type: string;
      cron_expression: string;
      delivery_channel: string;
      delivery_target: string;
      is_active: boolean;
      display_name?: string;
      description?: string;
    },
  ): Promise<Schedule>;

  toggleJobSchedule(
    userId: string,
    jobType: string,
    isActive: boolean,
  ): Promise<void>;

  initDefaultSchedules(userId: string, deliveryTarget: string): Promise<void>;

  listConversationMessagesForUserSince(
    userId: string,
    since: Date,
    limit: number,
  ): Promise<{ role: string; content: string; created_at: Date }[]>;

  purgeUserContextSummariesOlderThan(
    userId: string,
    keyPrefixes: string[],
    olderThanDays: number,
  ): Promise<void>;

  purgeUserConversationsOlderThan(userId: string, olderThanDays: number): Promise<void>;

  recordScheduleRun(
    userId: string,
    jobType: string,
    status: "success" | "error",
  ): Promise<void>;

  insertTask(
    userId: string,
    params: {
      title: string;
      description: string;
      priority?: string;
      document_ids?: string[];
      context?: string;
    },
  ): Promise<TaskQueueRow>;

  getTasks(
    userId: string,
    options?: { status?: string; limit?: number },
  ): Promise<TaskQueueRow[]>;

  getTask(id: string, userId: string): Promise<TaskQueueRow | null>;

  /** Transaktion: nächsten `pending`-Task sperren und auf `running` setzen. */
  getNextPendingTask(): Promise<TaskQueueRow | null>;

  updateTaskStatus(
    id: string,
    status: string,
    params?: {
      started_at?: Date;
      completed_at?: Date;
      result?: string;
      result_notion_page_id?: string;
      result_draft_id?: string;
      error_message?: string;
    },
  ): Promise<void>;

  cancelTask(
    id: string,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_pending" }>;

  getTenant(id: string): Promise<Tenant | null>;

  getTenantBySlug(slug: string): Promise<Tenant | null>;

  listTenants(): Promise<TenantListEntry[]>;

  insertTenant(params: {
    name: string;
    slug: string;
    plan?: string;
    admin_email?: string;
  }): Promise<Tenant>;

  updateTenant(
    id: string,
    params: {
      name?: string;
      plan?: string;
      is_active?: boolean;
      admin_email?: string | null;
    },
  ): Promise<Tenant>;

  updateTenantCredentials(
    id: string,
    credentials: {
      slack_client_id?: string | null;
      slack_client_secret_enc?: string | null;
      google_client_id?: string | null;
      google_client_secret_enc?: string | null;
      notion_client_id?: string | null;
      notion_client_secret_enc?: string | null;
    },
  ): Promise<void>;

  getTenantForUser(userId: string): Promise<Tenant | null>;
}

type PgSql = ReturnType<typeof postgres>;

function normalizeLearningCandidate(candidate: LearningCandidate): {
  category: string;
  content: string;
  source: string;
  source_ref: string | null;
  confidence: number;
} {
  const categoryRaw = (candidate.category ?? candidate.kind ?? "preference")
    .trim();
  const category = categoryRaw || "preference";
  const content = (candidate.content ?? candidate.summary ?? "").trim();
  const source = (candidate.source ?? "chat").trim() || "chat";
  const source_ref = candidate.source_ref?.trim()
    ? candidate.source_ref.trim()
    : null;
  let confidence = 0.8;
  if (
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence)
  ) {
    confidence = Math.min(1, Math.max(0, candidate.confidence));
  }
  return { category, content, source, source_ref, confidence };
}

type LearningSqlRow = {
  id: string;
  user_id: string;
  category: string;
  content: string;
  source: string;
  source_ref: string | null;
  confidence: number;
  confirmed_by_user: boolean;
  times_confirmed: number;
  contradicts_id: string | null;
  first_seen: Date;
  last_confirmed: Date;
  is_active: boolean;
  created_at: Date;
};

function mapLearningRow(r: LearningSqlRow): Learning {
  return {
    id: r.id,
    user_id: r.user_id,
    category: r.category,
    content: r.content,
    source: r.source,
    source_ref: r.source_ref,
    confidence: Number(r.confidence),
    confirmed_by_user: r.confirmed_by_user,
    times_confirmed: r.times_confirmed,
    contradicts_id: r.contradicts_id,
    first_seen: r.first_seen,
    last_confirmed: r.last_confirmed,
    is_active: r.is_active,
    created_at: r.created_at,
  };
}

type DocumentSqlRow = {
  id: string;
  user_id: string;
  name: string;
  document_type: string;
  content_text: string | null;
  summary: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  source: string;
  drive_file_id: string | null;
  processed: boolean;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapDocumentRow(r: DocumentSqlRow): Document {
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    document_type: r.document_type,
    content_text: r.content_text,
    summary: r.summary,
    file_size_bytes: r.file_size_bytes,
    mime_type: r.mime_type,
    source: r.source,
    drive_file_id: r.drive_file_id,
    processed: r.processed,
    processed_at: r.processed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

type DocumentChunkSqlRow = {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  page_number: number | null;
  section_title: string | null;
  content: string;
  token_count: number | null;
  created_at: Date;
};

function mapChunkRow(r: DocumentChunkSqlRow): DocumentChunk {
  return {
    id: r.id,
    document_id: r.document_id,
    user_id: r.user_id,
    chunk_index: r.chunk_index,
    page_number: r.page_number,
    section_title: r.section_title,
    content: r.content,
    token_count: r.token_count,
    created_at: r.created_at,
  };
}

async function postgresUpsertLearning(
  sql: PgSql,
  userId: string,
  candidate: LearningCandidate,
): Promise<Learning> {
  const n = normalizeLearningCandidate(candidate);
  if (!n.content) {
    throw new Error("Learning content leer");
  }
  const needle = n.content.slice(0, 50).toLowerCase();

  if (needle.length > 0) {
    const hits = await sql`
      SELECT
        id::text AS id,
        user_id::text AS user_id,
        category,
        content,
        source,
        source_ref,
        confidence::float8 AS confidence,
        confirmed_by_user,
        times_confirmed,
        contradicts_id::text AS contradicts_id,
        first_seen,
        last_confirmed,
        is_active,
        created_at
      FROM cos_learnings
      WHERE user_id = ${userId}::uuid
        AND category = ${n.category}
        AND position(${needle} in lower(content)) > 0
      ORDER BY last_confirmed DESC
      LIMIT 1
    ` as LearningSqlRow[];
    const hit = hits[0];
    if (hit) {
      const updated = await sql`
        UPDATE cos_learnings
        SET
          times_confirmed = times_confirmed + 1,
          last_confirmed = NOW(),
          confidence = ${n.confidence}
        WHERE id = ${hit.id}::uuid
        RETURNING
          id::text AS id,
          user_id::text AS user_id,
          category,
          content,
          source,
          source_ref,
          confidence::float8 AS confidence,
          confirmed_by_user,
          times_confirmed,
          contradicts_id::text AS contradicts_id,
          first_seen,
          last_confirmed,
          is_active,
          created_at
      ` as LearningSqlRow[];
      return mapLearningRow(updated[0]!);
    }
  }

  const inserted = await sql`
    INSERT INTO cos_learnings (
      user_id,
      category,
      content,
      source,
      source_ref,
      confidence,
      confirmed_by_user,
      times_confirmed,
      is_active
    )
    VALUES (
      ${userId}::uuid,
      ${n.category},
      ${n.content},
      ${n.source},
      ${n.source_ref},
      ${n.confidence},
      false,
      1,
      true
    )
    RETURNING
      id::text AS id,
      user_id::text AS user_id,
      category,
      content,
      source,
      source_ref,
      confidence::float8 AS confidence,
      confirmed_by_user,
      times_confirmed,
      contradicts_id::text AS contradicts_id,
      first_seen,
      last_confirmed,
      is_active,
      created_at
  ` as LearningSqlRow[];
  return mapLearningRow(inserted[0]!);
}

type TaskQueueSqlRow = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  document_ids: string[] | null;
  context: string | null;
  result: string | null;
  result_notion_page_id: string | null;
  result_draft_id: string | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapTaskQueueRow(r: TaskQueueSqlRow): TaskQueueRow {
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    document_ids: r.document_ids,
    context: r.context,
    result: r.result,
    result_notion_page_id: r.result_notion_page_id,
    result_draft_id: r.result_draft_id,
    error_message: r.error_message,
    started_at: r.started_at,
    completed_at: r.completed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

type TenantSqlRow = {
  id: string;
  name: string;
  slug: string;
  slack_client_id: string | null;
  slack_client_secret_enc: string | null;
  google_client_id: string | null;
  google_client_secret_enc: string | null;
  notion_client_id: string | null;
  notion_client_secret_enc: string | null;
  plan: string;
  is_active: boolean;
  admin_email: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapTenantRow(r: TenantSqlRow): Tenant {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    slack_client_id: r.slack_client_id,
    slack_client_secret_enc: r.slack_client_secret_enc,
    google_client_id: r.google_client_id,
    google_client_secret_enc: r.google_client_secret_enc,
    notion_client_id: r.notion_client_id,
    notion_client_secret_enc: r.notion_client_secret_enc,
    plan: r.plan,
    is_active: r.is_active,
    admin_email: r.admin_email,
    created_at: r.created_at instanceof Date
      ? r.created_at.toISOString()
      : String(r.created_at),
    updated_at: r.updated_at instanceof Date
      ? r.updated_at.toISOString()
      : String(r.updated_at),
  };
}

function isPgUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e &&
    (e as { code: string }).code === "23505";
}

export function createPostgresDatabaseClient(sql: PgSql): DatabaseClient {
  return {
    async findAgentConfigForUser(userId: string): Promise<AgentConfigRow | null> {
      const userRows = await sql`
        SELECT system_prompt, tools_enabled
        FROM agent_configs
        WHERE user_id = ${userId}::uuid
        ORDER BY id DESC
        LIMIT 1
      ` as { system_prompt: string; tools_enabled: string[] }[];
      if (userRows.length > 0) {
        return {
          system_prompt: userRows[0].system_prompt,
          tools_enabled: userRows[0].tools_enabled ?? ["notion"],
        };
      }

      const templateRows = await sql`
        SELECT system_prompt, tools_enabled
        FROM agent_configs
        WHERE is_template = true
        ORDER BY id ASC
        LIMIT 1
      ` as { system_prompt: string; tools_enabled: string[] }[];
      const row = templateRows[0];
      if (!row) return null;
      return {
        system_prompt: row.system_prompt,
        tools_enabled: row.tools_enabled ?? ["notion"],
      };
    },

    async listUserContexts(userId: string): Promise<UserContextRow[]> {
      return await sql`
        SELECT key, value
        FROM cos_user_contexts
        WHERE user_id = ${userId}::uuid
        ORDER BY key ASC
      ` as UserContextRow[];
    },

    async upsertUserContext(params: {
      userId: string;
      key: string;
      value: string;
    }): Promise<void> {
      await sql`
        INSERT INTO cos_user_contexts (user_id, key, value, updated_at)
        VALUES (${params.userId}::uuid, ${params.key}, ${params.value}, NOW())
        ON CONFLICT (user_id, key)
        DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW()
      `;
    },

    async listRecentConversationMessages(
      userId: string,
      sessionId: string,
      limit: number,
    ): Promise<ConversationMessageRow[]> {
      const rows = await sql`
        SELECT role, content
        FROM cos_conversations
        WHERE user_id = ${userId}::uuid AND session_id = ${sessionId}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
      ` as ConversationMessageRow[];
      return rows.slice().reverse();
    },

    async insertConversationMessage(params: {
      userId: string;
      sessionId: string;
      role: string;
      content: string;
    }): Promise<void> {
      await sql`
        INSERT INTO cos_conversations (user_id, session_id, role, content, tool_calls)
        VALUES (
          ${params.userId}::uuid,
          ${params.sessionId}::uuid,
          ${params.role},
          ${params.content},
          NULL
        )
      `;
    },

    async insertLlmCall(params: {
      userId: string;
      sessionId: string | null;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      costUsd: number | null;
      latencyMs: number | null;
    }): Promise<void> {
      await sql`
        INSERT INTO cos_llm_calls (
          user_id,
          session_id,
          model,
          input_tokens,
          output_tokens,
          cost_usd,
          latency_ms
        )
        VALUES (
          ${params.userId}::uuid,
          ${params.sessionId},
          ${params.model},
          ${params.inputTokens},
          ${params.outputTokens},
          ${params.costUsd},
          ${params.latencyMs}
        )
      `;
    },

    async findBriefingUser(
      userId: string,
    ): Promise<{ name: string; email: string } | null> {
      const rows = await sql`
        SELECT name, email
        FROM cos_users
        WHERE id = ${userId}::uuid AND is_active = true
        LIMIT 1
      ` as { name: string; email: string }[];
      return rows[0] ?? null;
    },

    async findUserByEmail(email: string): Promise<
      | {
        id: string;
        name: string;
        email: string;
        role: string;
        is_active: boolean;
        password_hash: string | null;
        failed_login_attempts: number;
        locked_until: Date | null;
        last_login_at: Date | null;
        last_login_ip: string | null;
      }
      | null
    > {
      const rows = await sql`
        SELECT
          id::text,
          name,
          email,
          role,
          is_active,
          password_hash,
          COALESCE(failed_login_attempts, 0)::int AS failed_login_attempts,
          locked_until,
          last_login_at,
          last_login_ip
        FROM cos_users
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(${email}))
        LIMIT 1
      ` as {
        id: string;
        name: string;
        email: string;
        role: string;
        is_active: boolean;
        password_hash: string | null;
        failed_login_attempts: number;
        locked_until: Date | null;
        last_login_at: Date | null;
        last_login_ip: string | null;
      }[];
      return rows[0] ?? null;
    },

    async countLoginAttemptsByIpSince(
      ip: string,
      sinceMinutes: number,
    ): Promise<number> {
      const since = new Date(Date.now() - sinceMinutes * 60_000);
      const rows = await sql`
        SELECT COUNT(*)::int AS c
        FROM cos_login_attempts
        WHERE ip_address = ${ip}
          AND created_at > ${since}
      ` as { c: number }[];
      return rows[0]?.c ?? 0;
    },

    async insertLoginAttempt(params: {
      email: string;
      ipAddress: string;
      success: boolean;
      userAgent: string | null;
    }): Promise<void> {
      await sql`
        INSERT INTO cos_login_attempts (email, ip_address, success, user_agent)
        VALUES (
          ${params.email.trim()},
          ${params.ipAddress},
          ${params.success},
          ${params.userAgent}
        )
      `;
    },

    async incrementFailedLogin(userId: string): Promise<{
      attempts: number;
      locked_until: Date | null;
    }> {
      const rows = await sql`
        UPDATE cos_users SET
          failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
          locked_until = CASE
            WHEN COALESCE(failed_login_attempts, 0) + 1 >= 5
            THEN NOW() + interval '30 minutes'
            ELSE locked_until
          END
        WHERE id = ${userId}::uuid
        RETURNING failed_login_attempts::int AS failed_login_attempts, locked_until
      ` as { failed_login_attempts: number; locked_until: Date | null }[];
      const r = rows[0]!;
      return {
        attempts: r.failed_login_attempts,
        locked_until: r.locked_until,
      };
    },

    async recordSuccessfulLogin(userId: string, ip: string): Promise<void> {
      await sql`
        UPDATE cos_users SET
          failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = NOW(),
          last_login_ip = ${ip}
        WHERE id = ${userId}::uuid
      `;
    },

    async updateUserPasswordHash(
      userId: string,
      passwordHash: string,
    ): Promise<void> {
      await sql`
        UPDATE cos_users SET
          password_hash = ${passwordHash},
          password_changed_at = NOW(),
          failed_login_attempts = 0,
          locked_until = NULL
        WHERE id = ${userId}::uuid
      `;
    },

    async insertAuditLog(params: {
      action: string;
      userId?: string | null;
      tenantId?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
      metadata?: Record<string, unknown> | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      success?: boolean;
    }): Promise<void> {
      const metaJson = JSON.stringify(params.metadata ?? {});
      await sql`
        INSERT INTO cos_audit_log (
          tenant_id,
          user_id,
          action,
          resource_type,
          resource_id,
          metadata,
          ip_address,
          user_agent,
          success
        )
        VALUES (
          ${params.tenantId ?? null}::uuid,
          ${params.userId ?? null}::uuid,
          ${params.action},
          ${params.resourceType ?? null},
          ${params.resourceId ?? null},
          ${metaJson}::jsonb,
          ${params.ipAddress ?? null},
          ${params.userAgent ?? null},
          ${params.success !== false}
        )
      `;
    },

    async listAuditLog(params: {
      tenantId?: string;
      userId?: string;
      action?: string;
      from?: Date;
      to?: Date;
      limit?: number;
    }): Promise<
      {
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
      }[]
    > {
      const lim = Math.min(Math.max(params.limit ?? 100, 1), 500);
      const from = params.from ?? new Date(0);
      const to = params.to ?? new Date("2099-01-01");
      const rows = await sql`
        SELECT
          id::text,
          action,
          user_id::text AS user_id,
          tenant_id::text AS tenant_id,
          resource_type,
          resource_id,
          metadata,
          ip_address,
          user_agent,
          success,
          created_at
        FROM cos_audit_log
        WHERE created_at >= ${from}
          AND created_at <= ${to}
        ORDER BY created_at DESC
        LIMIT ${lim}
      ` as {
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
      }[];
      return rows.filter((r) => {
        if (params.tenantId && r.tenant_id !== params.tenantId) return false;
        if (params.userId && r.user_id !== params.userId) return false;
        if (params.action && r.action !== params.action) return false;
        return true;
      });
    },

    async findUserWithPasswordById(
      userId: string,
    ): Promise<
      | {
        id: string;
        name: string;
        email: string;
        role: string;
        is_active: boolean;
        password_hash: string | null;
      }
      | null
    > {
      const rows = await sql`
        SELECT id::text, name, email, role, is_active, password_hash
        FROM cos_users
        WHERE id = ${userId}::uuid
        LIMIT 1
      ` as {
        id: string;
        name: string;
        email: string;
        role: string;
        is_active: boolean;
        password_hash: string | null;
      }[];
      return rows[0] ?? null;
    },

    async findUserProfileById(
      userId: string,
    ): Promise<
      { id: string; name: string; email: string; role: string } | null
    > {
      const rows = await sql`
        SELECT id::text, name, email, role
        FROM cos_users
        WHERE id = ${userId}::uuid AND is_active = true
        LIMIT 1
      ` as {
        id: string;
        name: string;
        email: string;
        role: string;
      }[];
      return rows[0] ?? null;
    },

    async setOnboardingCompleted(userId: string): Promise<void> {
      await sql`
        UPDATE cos_users
        SET
          onboarding_completed = true,
          onboarding_completed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${userId}::uuid
      `;
    },

    async getUserOnboardingSnapshot(userId: string): Promise<{
      onboarding_completed: boolean;
      created_at: Date;
      name: string;
      tenant_id: string | null;
      task_count: number;
      conversation_count: number;
    } | null> {
      const rows = await sql`
        SELECT
          COALESCE(u.onboarding_completed, false) AS onboarding_completed,
          u.created_at,
          u.name,
          u.tenant_id::text AS tenant_id,
          (
            SELECT COUNT(*)::int
            FROM cos_task_queue t
            WHERE t.user_id = u.id
          ) AS task_count,
          (
            SELECT COUNT(*)::int
            FROM cos_conversations c
            WHERE c.user_id = u.id
          ) AS conversation_count
        FROM cos_users u
        WHERE u.id = ${userId}::uuid AND u.is_active = true
        LIMIT 1
      ` as {
        onboarding_completed: boolean;
        created_at: Date;
        name: string;
        tenant_id: string | null;
        task_count: number;
        conversation_count: number;
      }[];
      return rows[0] ?? null;
    },

    async getSessionOwnerUserId(sessionId: string): Promise<string | null> {
      const rows = await sql`
        SELECT user_id::text AS user_id
        FROM cos_conversations
        WHERE session_id = ${sessionId}::uuid
        ORDER BY created_at ASC
        LIMIT 1
      ` as { user_id: string }[];
      return rows[0]?.user_id ?? null;
    },

    async listChatHistoryForUser(
      userId: string,
      sessionId: string,
      limit: number,
    ): Promise<ChatHistoryEntry[]> {
      return await sql`
        SELECT role, content, created_at
        FROM cos_conversations
        WHERE user_id = ${userId}::uuid AND session_id = ${sessionId}::uuid
        ORDER BY created_at ASC
        LIMIT ${limit}
      ` as ChatHistoryEntry[];
    },

    async listChatSessionsForUser(userId: string): Promise<ChatSessionSummary[]> {
      const rows = await sql`
        WITH sess AS (
          SELECT
            session_id,
            MAX(created_at) AS last_at,
            COUNT(*)::int AS message_count
          FROM cos_conversations
          WHERE user_id = ${userId}::uuid
          GROUP BY session_id
        ),
        first_user AS (
          SELECT DISTINCT ON (session_id)
            session_id,
            content
          FROM cos_conversations
          WHERE user_id = ${userId}::uuid AND role = 'user'
          ORDER BY session_id, created_at ASC
        )
        SELECT
          s.session_id::text,
          COALESCE(LEFT(fu.content, 80), '') AS preview,
          s.last_at AS last_activity,
          s.message_count
        FROM sess s
        LEFT JOIN first_user fu ON fu.session_id = s.session_id
        ORDER BY s.last_at DESC
      ` as {
        session_id: string;
        preview: string;
        last_activity: Date;
        message_count: number;
      }[];
      return rows.map((r) => ({
        session_id: r.session_id,
        preview: r.preview,
        last_activity: r.last_activity,
        message_count: r.message_count,
      }));
    },

    async deleteChatSessionForUser(
      userId: string,
      sessionId: string,
    ): Promise<number> {
      const rows = await sql`
        DELETE FROM cos_conversations
        WHERE user_id = ${userId}::uuid AND session_id = ${sessionId}::uuid
        RETURNING id
      ` as { id: string }[];
      return rows.length;
    },

    async insertOauthState(params: {
      state: string;
      userId: string | null;
      provider: string;
    }): Promise<void> {
      if (params.userId === null) {
        await sql`
          INSERT INTO cos_oauth_states (state, user_id, provider)
          VALUES (${params.state}, NULL, ${params.provider})
        `;
      } else {
        await sql`
          INSERT INTO cos_oauth_states (state, user_id, provider)
          VALUES (${params.state}, ${params.userId}::uuid, ${params.provider})
        `;
      }
    },

    async consumeOauthState(
      state: string,
    ): Promise<{ userId: string | null; provider: string } | null> {
      const rows = await sql`
        DELETE FROM cos_oauth_states
        WHERE state = ${state} AND expires_at > NOW()
        RETURNING user_id::text AS user_id, provider
      ` as { user_id: string | null; provider: string }[];
      const r = rows[0];
      if (!r) return null;
      return { userId: r.user_id, provider: r.provider };
    },

    async deleteUserContextsByKeys(
      userId: string,
      keys: string[],
    ): Promise<void> {
      if (keys.length === 0) return;
      await sql`
        DELETE FROM cos_user_contexts
        WHERE user_id = ${userId}::uuid
          AND key IN ${sql(keys)}
      `;
    },

    async getLearnings(
      userId: string,
      options?: GetLearningsOptions,
    ): Promise<Learning[]> {
      const activeOnly = options?.activeOnly !== false;
      const limit = options?.limit ?? 50;
      const minConfidence = options?.minConfidence;
      const categories = options?.categories;
      const since = options?.since;

      const rows = await sql`
        SELECT
          id::text AS id,
          user_id::text AS user_id,
          category,
          content,
          source,
          source_ref,
          confidence::float8 AS confidence,
          confirmed_by_user,
          times_confirmed,
          contradicts_id::text AS contradicts_id,
          first_seen,
          last_confirmed,
          is_active,
          created_at
        FROM cos_learnings
        WHERE user_id = ${userId}::uuid
        ${activeOnly ? sql`AND is_active = true` : sql``}
        ${
        minConfidence !== undefined
          ? sql`AND confidence >= ${minConfidence}`
          : sql``
      }
        ${since ? sql`AND last_confirmed >= ${since}` : sql``}
        ${
        categories?.length
          ? sql`AND category IN ${sql(categories)}`
          : sql``
      }
        ORDER BY times_confirmed DESC, last_confirmed DESC
        LIMIT ${limit}
      ` as LearningSqlRow[];
      return rows.map((r) => mapLearningRow(r));
    },

    async upsertLearning(
      userId: string,
      candidate: LearningCandidate,
    ): Promise<Learning> {
      return await postgresUpsertLearning(sql, userId, candidate);
    },

    async upsertLearnings(
      userId: string,
      candidates: LearningCandidate[],
    ): Promise<Learning[]> {
      const out: Learning[] = [];
      for (const c of candidates) {
        try {
          out.push(await postgresUpsertLearning(sql, userId, c));
        } catch {
          /* einzelne Kandidaten dürfen fehlschlagen */
        }
      }
      return out;
    },

    async markLearningConflict(
      id: string,
      contradictsId: string,
    ): Promise<void> {
      await sql`
        UPDATE cos_learnings
        SET contradicts_id = ${contradictsId}::uuid
        WHERE id = ${id}::uuid
      `;
    },

    async confirmLearning(id: string, userId: string): Promise<void> {
      const rows = await sql`
        UPDATE cos_learnings
        SET
          confirmed_by_user = true,
          times_confirmed = times_confirmed + 1,
          last_confirmed = NOW()
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        RETURNING id
      ` as { id: string }[];
      if (rows.length === 0) {
        throw new LearningOwnershipError();
      }
    },

    async deactivateLearning(id: string, userId: string): Promise<void> {
      const rows = await sql`
        UPDATE cos_learnings
        SET is_active = false
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        RETURNING id
      ` as { id: string }[];
      if (rows.length === 0) {
        throw new LearningOwnershipError();
      }
    },

    async bulkConfirmLearningsByTimesConfirmed(
      userId: string,
      minTimes: number,
    ): Promise<void> {
      await sql`
        UPDATE cos_learnings
        SET
          confirmed_by_user = true,
          last_confirmed = NOW()
        WHERE user_id = ${userId}::uuid
          AND is_active = true
          AND times_confirmed >= ${minTimes}
      `;
    },

    async insertDocument(
      userId: string,
      doc: {
        name: string;
        document_type: string;
        content_text?: string;
        summary?: string;
        file_size_bytes?: number;
        mime_type?: string;
        source?: string;
        drive_file_id?: string;
      },
    ): Promise<Document> {
      const source = doc.source?.trim() || "upload";
      const rows = await sql`
        INSERT INTO cos_documents (
          user_id,
          name,
          document_type,
          content_text,
          summary,
          file_size_bytes,
          mime_type,
          source,
          drive_file_id,
          processed
        )
        VALUES (
          ${userId}::uuid,
          ${doc.name},
          ${doc.document_type},
          ${doc.content_text ?? null},
          ${doc.summary ?? null},
          ${doc.file_size_bytes ?? null},
          ${doc.mime_type ?? null},
          ${source},
          ${doc.drive_file_id ?? null},
          false
        )
        RETURNING
          id::text AS id,
          user_id::text AS user_id,
          name,
          document_type,
          content_text,
          summary,
          file_size_bytes,
          mime_type,
          source,
          drive_file_id::text AS drive_file_id,
          processed,
          processed_at,
          created_at,
          updated_at
      ` as DocumentSqlRow[];
      return mapDocumentRow(rows[0]!);
    },

    async getDocuments(
      userId: string,
      options?: {
        document_type?: string;
        processed?: boolean;
        limit?: number;
        drive_file_id?: string;
      },
    ): Promise<Document[]> {
      const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
      const dt = options?.document_type?.trim();
      const proc = options?.processed;
      const driveId = options?.drive_file_id?.trim();
      const rows = await sql`
        SELECT
          id::text AS id,
          user_id::text AS user_id,
          name,
          document_type,
          content_text,
          summary,
          file_size_bytes,
          mime_type,
          source,
          drive_file_id::text AS drive_file_id,
          processed,
          processed_at,
          created_at,
          updated_at
        FROM cos_documents
        WHERE user_id = ${userId}::uuid
          ${dt ? sql`AND document_type = ${dt}` : sql``}
          ${
        proc === undefined
          ? sql``
          : proc
          ? sql`AND processed = true`
          : sql`AND processed = false`
      }
          ${driveId ? sql`AND drive_file_id = ${driveId}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      ` as DocumentSqlRow[];
      return rows.map(mapDocumentRow);
    },

    async getDocument(id: string, userId: string): Promise<Document | null> {
      const rows = await sql`
        SELECT
          id::text AS id,
          user_id::text AS user_id,
          name,
          document_type,
          content_text,
          summary,
          file_size_bytes,
          mime_type,
          source,
          drive_file_id::text AS drive_file_id,
          processed,
          processed_at,
          created_at,
          updated_at
        FROM cos_documents
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        LIMIT 1
      ` as DocumentSqlRow[];
      const r = rows[0];
      return r ? mapDocumentRow(r) : null;
    },

    async updateDocumentProcessed(
      id: string,
      userId: string,
      result: { summary: string; content_text?: string },
    ): Promise<void> {
      const rows = await sql`
        UPDATE cos_documents
        SET
          summary = ${result.summary},
          content_text = COALESCE(${result.content_text ?? null}, content_text),
          processed = true,
          processed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        RETURNING id
      ` as { id: string }[];
      if (rows.length === 0) {
        throw new Error("Dokument nicht gefunden oder keine Berechtigung.");
      }
    },

    async deleteDocument(id: string, userId: string): Promise<void> {
      const rows = await sql`
        DELETE FROM cos_documents
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        RETURNING id
      ` as { id: string }[];
      if (rows.length === 0) {
        throw new Error("Dokument nicht gefunden oder keine Berechtigung.");
      }
    },

    async insertChunks(
      chunks: Array<{
        document_id: string;
        user_id: string;
        chunk_index: number;
        page_number?: number;
        section_title?: string;
        content: string;
        token_count?: number;
      }>,
    ): Promise<void> {
      if (chunks.length === 0) return;
      const rows = chunks.map((c) => ({
        document_id: c.document_id,
        user_id: c.user_id,
        chunk_index: c.chunk_index,
        page_number: c.page_number ?? null,
        section_title: c.section_title ?? null,
        content: c.content,
        token_count: c.token_count ?? null,
      }));
      await sql`
        INSERT INTO cos_document_chunks ${sql(rows)}
      `;
    },

    async searchChunks(params: {
      documentId: string;
      userId: string;
      query: string;
      limit?: number;
    }): Promise<DocumentChunk[]> {
      const lim = Math.min(Math.max(params.limit ?? 50, 1), 200);
      const q = params.query.trim();
      if (q === "") {
        const rows = await sql`
          SELECT
            id::text AS id,
            document_id::text AS document_id,
            user_id::text AS user_id,
            chunk_index,
            page_number,
            section_title,
            content,
            token_count,
            created_at
          FROM cos_document_chunks
          WHERE document_id = ${params.documentId}::uuid
            AND user_id = ${params.userId}::uuid
          ORDER BY chunk_index ASC
          LIMIT ${lim}
        ` as DocumentChunkSqlRow[];
        return rows.map(mapChunkRow);
      }
      const rows = await sql`
        SELECT
          id::text AS id,
          document_id::text AS document_id,
          user_id::text AS user_id,
          chunk_index,
          page_number,
          section_title,
          content,
          token_count,
          created_at
        FROM cos_document_chunks
        WHERE document_id = ${params.documentId}::uuid
          AND user_id = ${params.userId}::uuid
          AND position(lower(${q}) in lower(content)) > 0
        ORDER BY chunk_index ASC
        LIMIT ${lim}
      ` as DocumentChunkSqlRow[];
      return rows.map(mapChunkRow);
    },

    async getChunks(
      documentId: string,
      userId: string,
    ): Promise<DocumentChunk[]> {
      const rows = await sql`
        SELECT
          id::text AS id,
          document_id::text AS document_id,
          user_id::text AS user_id,
          chunk_index,
          page_number,
          section_title,
          content,
          token_count,
          created_at
        FROM cos_document_chunks
        WHERE document_id = ${documentId}::uuid
          AND user_id = ${userId}::uuid
        ORDER BY chunk_index ASC
      ` as DocumentChunkSqlRow[];
      return rows.map(mapChunkRow);
    },

    async getUserSchedules(userId: string): Promise<Schedule[]> {
      type R = {
        id: string;
        user_id: string;
        job_type: string;
        cron_expression: string;
        delivery_channel: string;
        delivery_target: string;
        is_active: boolean;
        display_name: string | null;
        description: string | null;
        last_run: Date | null;
        last_run_status: string | null;
        created_at: Date;
      };
      const rows = await sql`
        SELECT
          id::text,
          user_id::text,
          job_type,
          cron_expression,
          delivery_channel,
          delivery_target,
          is_active,
          display_name,
          description,
          last_run,
          last_run_status,
          created_at
        FROM cos_schedules
        WHERE user_id = ${userId}::uuid
        ORDER BY job_type ASC
      ` as R[];
      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        job_type: r.job_type,
        cron_expression: r.cron_expression,
        delivery_channel: r.delivery_channel,
        delivery_target: r.delivery_target,
        is_active: r.is_active,
        display_name: r.display_name,
        description: r.description,
        last_run: r.last_run,
        last_run_status: r.last_run_status,
        created_at: r.created_at,
      }));
    },

    async upsertJobSchedule(
      userId: string,
      params: {
        job_type: string;
        cron_expression: string;
        delivery_channel: string;
        delivery_target: string;
        is_active: boolean;
        display_name?: string;
        description?: string;
      },
    ): Promise<Schedule> {
      const meta =
        (DEFAULT_JOB_DISPLAY as Record<string, { display_name: string; description: string }>)[
          params.job_type
        ] ?? { display_name: params.job_type, description: "" };
      const displayName = params.display_name ?? meta.display_name;
      const description = params.description ?? meta.description;
      const rows = await sql`
        INSERT INTO cos_schedules (
          user_id,
          job_type,
          cron_expression,
          delivery_channel,
          delivery_target,
          is_active,
          display_name,
          description
        )
        VALUES (
          ${userId}::uuid,
          ${params.job_type},
          ${params.cron_expression},
          ${params.delivery_channel},
          ${params.delivery_target},
          ${params.is_active},
          ${displayName},
          ${description}
        )
        ON CONFLICT (user_id, job_type) DO UPDATE SET
          cron_expression = EXCLUDED.cron_expression,
          delivery_channel = EXCLUDED.delivery_channel,
          delivery_target = EXCLUDED.delivery_target,
          is_active = EXCLUDED.is_active,
          display_name = EXCLUDED.display_name,
          description = EXCLUDED.description
        RETURNING
          id::text,
          user_id::text,
          job_type,
          cron_expression,
          delivery_channel,
          delivery_target,
          is_active,
          display_name,
          description,
          last_run,
          last_run_status,
          created_at
      ` as {
        id: string;
        user_id: string;
        job_type: string;
        cron_expression: string;
        delivery_channel: string;
        delivery_target: string;
        is_active: boolean;
        display_name: string | null;
        description: string | null;
        last_run: Date | null;
        last_run_status: string | null;
        created_at: Date;
      }[];
      const r = rows[0]!;
      return {
        id: r.id,
        user_id: r.user_id,
        job_type: r.job_type,
        cron_expression: r.cron_expression,
        delivery_channel: r.delivery_channel,
        delivery_target: r.delivery_target,
        is_active: r.is_active,
        display_name: r.display_name,
        description: r.description,
        last_run: r.last_run,
        last_run_status: r.last_run_status,
        created_at: r.created_at,
      };
    },

    async toggleJobSchedule(
      userId: string,
      jobType: string,
      isActive: boolean,
    ): Promise<void> {
      const rows = await sql`
        UPDATE cos_schedules
        SET is_active = ${isActive}
        WHERE user_id = ${userId}::uuid AND job_type = ${jobType}
        RETURNING id
      ` as { id: string }[];
      if (rows.length === 0) {
        throw new Error("Schedule nicht gefunden.");
      }
    },

    async initDefaultSchedules(
      userId: string,
      deliveryTarget: string,
    ): Promise<void> {
      for (const jobType of SCHEDULE_JOB_TYPES) {
        const cron = DEFAULT_JOB_CRONS[jobType];
        const { display_name, description } = DEFAULT_JOB_DISPLAY[jobType];
        await sql`
          INSERT INTO cos_schedules (
            user_id,
            job_type,
            cron_expression,
            delivery_channel,
            delivery_target,
            is_active,
            display_name,
            description
          )
          VALUES (
            ${userId}::uuid,
            ${jobType},
            ${cron},
            'email',
            ${deliveryTarget},
            false,
            ${display_name},
            ${description}
          )
          ON CONFLICT (user_id, job_type) DO NOTHING
        `;
      }
    },

    async listConversationMessagesForUserSince(
      userId: string,
      since: Date,
      limit: number,
    ): Promise<{ role: string; content: string; created_at: Date }[]> {
      const lim = Math.min(Math.max(limit, 1), 200);
      const rows = await sql`
        SELECT role, content, created_at
        FROM cos_conversations
        WHERE user_id = ${userId}::uuid AND created_at >= ${since}
        ORDER BY created_at ASC
        LIMIT ${lim}
      ` as { role: string; content: string; created_at: Date }[];
      return rows;
    },

    async purgeUserContextSummariesOlderThan(
      userId: string,
      keyPrefixes: string[],
      olderThanDays: number,
    ): Promise<void> {
      if (keyPrefixes.length === 0) return;
      const days = Math.max(1, olderThanDays);
      for (const p of keyPrefixes) {
        const like = p.includes("%") ? p : `${p}%`;
        await sql`
          DELETE FROM cos_user_contexts
          WHERE user_id = ${userId}::uuid
            AND key LIKE ${like}
            AND updated_at < NOW() - (${days}::int * INTERVAL '1 day')
        `;
      }
    },

    async purgeUserConversationsOlderThan(
      userId: string,
      olderThanDays: number,
    ): Promise<void> {
      const days = Math.max(1, olderThanDays);
      await sql`
        DELETE FROM cos_conversations
        WHERE user_id = ${userId}::uuid
          AND created_at < NOW() - (${days}::int * INTERVAL '1 day')
      `;
    },

    async recordScheduleRun(
      userId: string,
      jobType: string,
      status: "success" | "error",
    ): Promise<void> {
      await sql`
        UPDATE cos_schedules
        SET last_run = NOW(), last_run_status = ${status}
        WHERE user_id = ${userId}::uuid AND job_type = ${jobType}
      `;
    },

    async insertTask(
      userId: string,
      params: {
        title: string;
        description: string;
        priority?: string;
        document_ids?: string[];
        context?: string;
      },
    ): Promise<TaskQueueRow> {
      const priority = params.priority ?? "medium";
      const docIds = (params.document_ids ?? []).filter(Boolean);
      const rows = docIds.length === 0
        ? await sql`
        INSERT INTO cos_task_queue (
          user_id,
          title,
          description,
          priority,
          document_ids,
          context
        )
        VALUES (
          ${userId}::uuid,
          ${params.title},
          ${params.description},
          ${priority},
          NULL,
          ${params.context ?? null}
        )
        RETURNING
          id::text,
          user_id::text,
          title,
          description,
          priority,
          status,
          document_ids,
          context,
          result,
          result_notion_page_id,
          result_draft_id,
          error_message,
          started_at,
          completed_at,
          created_at,
          updated_at
      ` as TaskQueueSqlRow[]
        : await sql`
        INSERT INTO cos_task_queue (
          user_id,
          title,
          description,
          priority,
          document_ids,
          context
        )
        VALUES (
          ${userId}::uuid,
          ${params.title},
          ${params.description},
          ${priority},
          ${sql.array(docIds)}::uuid[],
          ${params.context ?? null}
        )
        RETURNING
          id::text,
          user_id::text,
          title,
          description,
          priority,
          status,
          document_ids,
          context,
          result,
          result_notion_page_id,
          result_draft_id,
          error_message,
          started_at,
          completed_at,
          created_at,
          updated_at
      ` as TaskQueueSqlRow[];
      return mapTaskQueueRow(rows[0]!);
    },

    async getTasks(
      userId: string,
      options?: { status?: string; limit?: number },
    ): Promise<TaskQueueRow[]> {
      const lim = Math.min(Math.max(options?.limit ?? 20, 1), 100);
      const st = options?.status?.trim();
      const rows = st
        ? await sql`
          SELECT
            id::text,
            user_id::text,
            title,
            description,
            priority,
            status,
            document_ids,
            context,
            result,
            result_notion_page_id,
            result_draft_id,
            error_message,
            started_at,
            completed_at,
            created_at,
            updated_at
          FROM cos_task_queue
          WHERE user_id = ${userId}::uuid AND status = ${st}
          ORDER BY
            CASE priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END ASC,
            created_at DESC
          LIMIT ${lim}
        ` as TaskQueueSqlRow[]
        : await sql`
          SELECT
            id::text,
            user_id::text,
            title,
            description,
            priority,
            status,
            document_ids,
            context,
            result,
            result_notion_page_id,
            result_draft_id,
            error_message,
            started_at,
            completed_at,
            created_at,
            updated_at
          FROM cos_task_queue
          WHERE user_id = ${userId}::uuid
          ORDER BY
            CASE status
              WHEN 'pending' THEN 1
              WHEN 'running' THEN 2
              WHEN 'failed' THEN 3
              WHEN 'completed' THEN 4
              WHEN 'cancelled' THEN 5
              ELSE 6
            END ASC,
            CASE priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END ASC,
            created_at DESC
          LIMIT ${lim}
        ` as TaskQueueSqlRow[];
      return rows.map(mapTaskQueueRow);
    },

    async getTask(id: string, userId: string): Promise<TaskQueueRow | null> {
      const rows = await sql`
        SELECT
          id::text,
          user_id::text,
          title,
          description,
          priority,
          status,
          document_ids,
          context,
          result,
          result_notion_page_id,
          result_draft_id,
          error_message,
          started_at,
          completed_at,
          created_at,
          updated_at
        FROM cos_task_queue
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        LIMIT 1
      ` as TaskQueueSqlRow[];
      return rows[0] ? mapTaskQueueRow(rows[0]) : null;
    },

    async getNextPendingTask(): Promise<TaskQueueRow | null> {
      return await sql.begin(async (tx) => {
        const picked = await tx`
          SELECT id
          FROM cos_task_queue
          WHERE status = 'pending'
          ORDER BY
            CASE priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END ASC,
            created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        ` as { id: string }[];
        if (!picked[0]) return null;
        const tid = picked[0].id;
        const updated = await tx`
          UPDATE cos_task_queue
          SET
            status = 'running',
            started_at = NOW(),
            updated_at = NOW()
          WHERE id = ${tid}::uuid
          RETURNING
            id::text,
            user_id::text,
            title,
            description,
            priority,
            status,
            document_ids,
            context,
            result,
            result_notion_page_id,
            result_draft_id,
            error_message,
            started_at,
            completed_at,
            created_at,
            updated_at
        ` as TaskQueueSqlRow[];
        return updated[0] ? mapTaskQueueRow(updated[0]) : null;
      });
    },

    async updateTaskStatus(
      id: string,
      status: string,
      params?: {
        started_at?: Date;
        completed_at?: Date;
        result?: string;
        result_notion_page_id?: string;
        result_draft_id?: string;
        error_message?: string;
      },
    ): Promise<void> {
      const cur = await sql`
        SELECT
          started_at,
          completed_at,
          result,
          result_notion_page_id,
          result_draft_id,
          error_message
        FROM cos_task_queue
        WHERE id = ${id}::uuid
        LIMIT 1
      ` as {
        started_at: Date | null;
        completed_at: Date | null;
        result: string | null;
        result_notion_page_id: string | null;
        result_draft_id: string | null;
        error_message: string | null;
      }[];
      if (!cur[0]) return;
      const c = cur[0];
      const p = params ?? {};
      const started_at = "started_at" in p ? p.started_at ?? null : c.started_at;
      const completed_at = "completed_at" in p
        ? p.completed_at ?? null
        : c.completed_at;
      const result = "result" in p ? p.result ?? null : c.result;
      const result_notion_page_id = "result_notion_page_id" in p
        ? p.result_notion_page_id ?? null
        : c.result_notion_page_id;
      const result_draft_id = "result_draft_id" in p
        ? p.result_draft_id ?? null
        : c.result_draft_id;
      const error_message = "error_message" in p
        ? p.error_message ?? null
        : c.error_message;
      await sql`
        UPDATE cos_task_queue
        SET
          status = ${status},
          started_at = ${started_at},
          completed_at = ${completed_at},
          result = ${result},
          result_notion_page_id = ${result_notion_page_id},
          result_draft_id = ${result_draft_id},
          error_message = ${error_message},
          updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    },

    async cancelTask(
      id: string,
      userId: string,
    ): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_pending" }> {
      const updated = await sql`
        UPDATE cos_task_queue
        SET
          status = 'cancelled',
          updated_at = NOW()
        WHERE
          id = ${id}::uuid
          AND user_id = ${userId}::uuid
          AND status = 'pending'
        RETURNING id
      ` as { id: string }[];
      if (updated.length > 0) return { ok: true };
      const ex = await sql`
        SELECT status
        FROM cos_task_queue
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        LIMIT 1
      ` as { status: string }[];
      if (ex.length === 0) return { ok: false, reason: "not_found" };
      return { ok: false, reason: "not_pending" };
    },

    async getTenant(id: string): Promise<Tenant | null> {
      const rows = await sql`
        SELECT
          id::text,
          name,
          slug,
          slack_client_id,
          slack_client_secret_enc,
          google_client_id,
          google_client_secret_enc,
          notion_client_id,
          notion_client_secret_enc,
          plan,
          is_active,
          admin_email,
          created_at,
          updated_at
        FROM cos_tenants
        WHERE id = ${id}::uuid
        LIMIT 1
      ` as TenantSqlRow[];
      return rows[0] ? mapTenantRow(rows[0]) : null;
    },

    async getTenantBySlug(slug: string): Promise<Tenant | null> {
      const s = slug.trim();
      const rows = await sql`
        SELECT
          id::text,
          name,
          slug,
          slack_client_id,
          slack_client_secret_enc,
          google_client_id,
          google_client_secret_enc,
          notion_client_id,
          notion_client_secret_enc,
          plan,
          is_active,
          admin_email,
          created_at,
          updated_at
        FROM cos_tenants
        WHERE slug = ${s}
        LIMIT 1
      ` as TenantSqlRow[];
      return rows[0] ? mapTenantRow(rows[0]) : null;
    },

    async listTenants(): Promise<TenantListEntry[]> {
      const rows = await sql`
        SELECT
          t.id::text,
          t.name,
          t.slug,
          t.slack_client_id,
          t.slack_client_secret_enc,
          t.google_client_id,
          t.google_client_secret_enc,
          t.notion_client_id,
          t.notion_client_secret_enc,
          t.plan,
          t.is_active,
          t.admin_email,
          t.created_at,
          t.updated_at,
          (SELECT COUNT(*)::int FROM cos_users u WHERE u.tenant_id = t.id) AS user_count
        FROM cos_tenants t
        ORDER BY t.slug ASC
      ` as (TenantSqlRow & { user_count: number })[];
      return rows.map((r) => {
        const t = mapTenantRow(r);
        return {
          ...t,
          user_count: r.user_count,
          credentials_configured: {
            slack: Boolean(r.slack_client_id?.trim()),
            google: Boolean(r.google_client_id?.trim()),
            notion: Boolean(r.notion_client_id?.trim()),
          },
        };
      });
    },

    async insertTenant(params: {
      name: string;
      slug: string;
      plan?: string;
      admin_email?: string;
    }): Promise<Tenant> {
      const plan = params.plan?.trim() || "starter";
      const slug = params.slug.trim();
      const name = params.name.trim();
      try {
        const rows = await sql`
          INSERT INTO cos_tenants (name, slug, plan, admin_email)
          VALUES (${name}, ${slug}, ${plan}, ${params.admin_email?.trim() ?? null})
          RETURNING
            id::text,
            name,
            slug,
            slack_client_id,
            slack_client_secret_enc,
            google_client_id,
            google_client_secret_enc,
            notion_client_id,
            notion_client_secret_enc,
            plan,
            is_active,
            admin_email,
            created_at,
            updated_at
        ` as TenantSqlRow[];
        return mapTenantRow(rows[0]!);
      } catch (e) {
        if (isPgUniqueViolation(e)) throw new SlugTakenError();
        throw e;
      }
    },

    async updateTenant(
      id: string,
      params: {
        name?: string;
        plan?: string;
        is_active?: boolean;
        admin_email?: string | null;
      },
    ): Promise<Tenant> {
      const cur = await sql`
        SELECT
          id::text,
          name,
          slug,
          slack_client_id,
          slack_client_secret_enc,
          google_client_id,
          google_client_secret_enc,
          notion_client_id,
          notion_client_secret_enc,
          plan,
          is_active,
          admin_email,
          created_at,
          updated_at
        FROM cos_tenants
        WHERE id = ${id}::uuid
        LIMIT 1
      ` as TenantSqlRow[];
      if (!cur[0]) throw new Error("Tenant nicht gefunden.");
      const c = cur[0];
      const name = params.name !== undefined ? params.name.trim() : c.name;
      const plan = params.plan !== undefined ? params.plan.trim() : c.plan;
      const is_active = params.is_active !== undefined ? params.is_active : c.is_active;
      const admin_email = params.admin_email !== undefined
        ? (params.admin_email?.trim() || null)
        : c.admin_email;
      const rows = await sql`
        UPDATE cos_tenants
        SET
          name = ${name},
          plan = ${plan},
          is_active = ${is_active},
          admin_email = ${admin_email},
          updated_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING
          id::text,
          name,
          slug,
          slack_client_id,
          slack_client_secret_enc,
          google_client_id,
          google_client_secret_enc,
          notion_client_id,
          notion_client_secret_enc,
          plan,
          is_active,
          admin_email,
          created_at,
          updated_at
      ` as TenantSqlRow[];
      return mapTenantRow(rows[0]!);
    },

    async updateTenantCredentials(
      id: string,
      credentials: {
        slack_client_id?: string | null;
        slack_client_secret_enc?: string | null;
        google_client_id?: string | null;
        google_client_secret_enc?: string | null;
        notion_client_id?: string | null;
        notion_client_secret_enc?: string | null;
      },
    ): Promise<void> {
      const cur = await sql`
        SELECT
          slack_client_id,
          slack_client_secret_enc,
          google_client_id,
          google_client_secret_enc,
          notion_client_id,
          notion_client_secret_enc
        FROM cos_tenants
        WHERE id = ${id}::uuid
        LIMIT 1
      ` as {
        slack_client_id: string | null;
        slack_client_secret_enc: string | null;
        google_client_id: string | null;
        google_client_secret_enc: string | null;
        notion_client_id: string | null;
        notion_client_secret_enc: string | null;
      }[];
      if (!cur[0]) throw new Error("Tenant nicht gefunden.");
      const c = cur[0];
      const slack_client_id = "slack_client_id" in credentials
        ? credentials.slack_client_id ?? null
        : c.slack_client_id;
      const slack_client_secret_enc = "slack_client_secret_enc" in credentials
        ? credentials.slack_client_secret_enc ?? null
        : c.slack_client_secret_enc;
      const google_client_id = "google_client_id" in credentials
        ? credentials.google_client_id ?? null
        : c.google_client_id;
      const google_client_secret_enc = "google_client_secret_enc" in credentials
        ? credentials.google_client_secret_enc ?? null
        : c.google_client_secret_enc;
      const notion_client_id = "notion_client_id" in credentials
        ? credentials.notion_client_id ?? null
        : c.notion_client_id;
      const notion_client_secret_enc = "notion_client_secret_enc" in credentials
        ? credentials.notion_client_secret_enc ?? null
        : c.notion_client_secret_enc;
      await sql`
        UPDATE cos_tenants
        SET
          slack_client_id = ${slack_client_id},
          slack_client_secret_enc = ${slack_client_secret_enc},
          google_client_id = ${google_client_id},
          google_client_secret_enc = ${google_client_secret_enc},
          notion_client_id = ${notion_client_id},
          notion_client_secret_enc = ${notion_client_secret_enc},
          updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    },

    async getTenantForUser(userId: string): Promise<Tenant | null> {
      const rows = await sql`
        SELECT
          t.id::text,
          t.name,
          t.slug,
          t.slack_client_id,
          t.slack_client_secret_enc,
          t.google_client_id,
          t.google_client_secret_enc,
          t.notion_client_id,
          t.notion_client_secret_enc,
          t.plan,
          t.is_active,
          t.admin_email,
          t.created_at,
          t.updated_at
        FROM cos_tenants t
        INNER JOIN cos_users u ON u.tenant_id = t.id
        WHERE u.id = ${userId}::uuid
        LIMIT 1
      ` as TenantSqlRow[];
      return rows[0] ? mapTenantRow(rows[0]) : null;
    },
  };
}
