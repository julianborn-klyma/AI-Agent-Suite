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
}

type PgSql = ReturnType<typeof postgres>;

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
  };
}
