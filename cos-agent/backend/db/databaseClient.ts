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
    }
    | null
  >;

  findUserProfileById(
    userId: string,
  ): Promise<
    { id: string; name: string; email: string; role: string } | null
  >;

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
    userId: string;
    provider: string;
  }): Promise<void>;

  consumeOauthState(
    state: string,
  ): Promise<{ userId: string; provider: string } | null>;

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
      }
      | null
    > {
      const rows = await sql`
        SELECT id::text, name, email, role, is_active
        FROM cos_users
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(${email}))
        LIMIT 1
      ` as {
        id: string;
        name: string;
        email: string;
        role: string;
        is_active: boolean;
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
      userId: string;
      provider: string;
    }): Promise<void> {
      await sql`
        INSERT INTO cos_oauth_states (state, user_id, provider)
        VALUES (${params.state}, ${params.userId}::uuid, ${params.provider})
      `;
    },

    async consumeOauthState(
      state: string,
    ): Promise<{ userId: string; provider: string } | null> {
      const rows = await sql`
        DELETE FROM cos_oauth_states
        WHERE state = ${state} AND expires_at > NOW()
        RETURNING user_id::text AS user_id, provider
      ` as { user_id: string; provider: string }[];
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
  };
}
