import postgres from "postgres";

export type Sql = postgres.Sql;

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

export type UserContextRow = {
  key: string;
  value: string;
  updated_at: string;
};

export type AdminConfigRow = {
  id: number;
  name: string;
  system_prompt: string;
  tools_enabled: string[];
  is_template: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminScheduleRow = {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  cron_expression: string;
  delivery_channel: string;
  delivery_target: string;
  is_active: boolean;
  last_run: string | null;
  last_run_status: string | null;
};

export type CostBreakdownRow = {
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  total_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type CostTotals = {
  total_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export async function isAdminUser(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 AS ok
    FROM cos_users
    WHERE id = ${userId}::uuid
      AND role = 'admin'
      AND is_active = true
    LIMIT 1
  ` as { ok: number }[];
  return rows.length > 0;
}

function mapUser(r: {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: Date;
}): AdminUser {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    is_active: r.is_active,
    created_at: r.created_at.toISOString(),
  };
}

export async function listUsers(sql: Sql): Promise<AdminUser[]> {
  const rows = await sql`
    SELECT id::text, email, name, role, is_active, created_at
    FROM cos_users
    ORDER BY created_at DESC
  ` as {
    id: string;
    email: string;
    name: string;
    role: string;
    is_active: boolean;
    created_at: Date;
  }[];
  return rows.map(mapUser);
}

export async function createUser(
  sql: Sql,
  params: { email: string; name: string; role: string },
): Promise<AdminUser | "duplicate_email"> {
  try {
    const rows = await sql`
      INSERT INTO cos_users (email, name, role)
      VALUES (${params.email.trim()}, ${params.name.trim()}, ${params.role})
      RETURNING id::text, email, name, role, is_active, created_at
    ` as {
      id: string;
      email: string;
      name: string;
      role: string;
      is_active: boolean;
      created_at: Date;
    }[];
    return mapUser(rows[0]!);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "23505") return "duplicate_email";
    throw e;
  }
}

export async function getUserById(
  sql: Sql,
  id: string,
): Promise<AdminUser | null> {
  const rows = await sql`
    SELECT id::text, email, name, role, is_active, created_at
    FROM cos_users
    WHERE id = ${id}::uuid
    LIMIT 1
  ` as {
    id: string;
    email: string;
    name: string;
    role: string;
    is_active: boolean;
    created_at: Date;
  }[];
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function updateUser(
  sql: Sql,
  id: string,
  patch: { name?: string; role?: string; is_active?: boolean },
): Promise<AdminUser | null> {
  const current = await getUserById(sql, id);
  if (!current) return null;
  if (
    patch.name === undefined &&
    patch.role === undefined &&
    patch.is_active === undefined
  ) {
    return current;
  }
  const name = patch.name !== undefined ? patch.name : current.name;
  const role = patch.role !== undefined ? patch.role : current.role;
  const is_active = patch.is_active !== undefined
    ? patch.is_active
    : current.is_active;
  const rows = await sql`
    UPDATE cos_users
    SET
      name = ${name},
      role = ${role},
      is_active = ${is_active},
      updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id::text, email, name, role, is_active, created_at
  ` as {
    id: string;
    email: string;
    name: string;
    role: string;
    is_active: boolean;
    created_at: Date;
  }[];
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function deactivateUser(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE cos_users
    SET is_active = false, updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id
  ` as { id: string }[];
  return rows.length > 0;
}

export async function getUserContext(
  sql: Sql,
  userId: string,
): Promise<UserContextRow[]> {
  const rows = await sql`
    SELECT key, value, updated_at
    FROM cos_user_contexts
    WHERE user_id = ${userId}::uuid
    ORDER BY key ASC
  ` as { key: string; value: string; updated_at: Date }[];
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    updated_at: r.updated_at.toISOString(),
  }));
}

export async function upsertUserContext(
  sql: Sql,
  userId: string,
  entries: { key: string; value: string }[],
): Promise<number> {
  let n = 0;
  for (const { key, value } of entries) {
    await sql`
      INSERT INTO cos_user_contexts (user_id, key, value, updated_at)
      VALUES (${userId}::uuid, ${key}, ${value}, NOW())
      ON CONFLICT (user_id, key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    `;
    n++;
  }
  return n;
}

export async function deleteUserContextKey(
  sql: Sql,
  userId: string,
  key: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM cos_user_contexts
    WHERE user_id = ${userId}::uuid AND key = ${key}
    RETURNING id
  ` as { id: string }[];
  return rows.length > 0;
}

function mapConfig(r: {
  id: number;
  agent_key: string;
  system_prompt: string;
  tools_enabled: string[];
  is_template: boolean;
  user_id: string | null;
  created_at: Date;
  updated_at: Date;
}): AdminConfigRow {
  return {
    id: r.id,
    name: r.agent_key,
    system_prompt: r.system_prompt,
    tools_enabled: r.tools_enabled ?? [],
    is_template: Boolean(r.is_template),
    user_id: r.user_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function listConfigs(sql: Sql): Promise<AdminConfigRow[]> {
  const rows = await sql`
    SELECT
      id,
      agent_key,
      system_prompt,
      tools_enabled,
      COALESCE(is_template, false) AS is_template,
      user_id::text AS user_id,
      created_at,
      updated_at
    FROM agent_configs
    ORDER BY id ASC
  ` as {
    id: number;
    agent_key: string;
    system_prompt: string;
    tools_enabled: string[];
    is_template: boolean;
    user_id: string | null;
    created_at: Date;
    updated_at: Date;
  }[];
  return rows.map(mapConfig);
}

export async function createConfig(
  sql: Sql,
  params: {
    name: string;
    system_prompt: string;
    tools_enabled: string[];
    is_template: boolean;
  },
): Promise<AdminConfigRow> {
  const rows = await sql`
    INSERT INTO agent_configs (
      agent_key,
      system_prompt,
      tools_enabled,
      is_template,
      user_id
    )
    VALUES (
      ${params.name.trim()},
      ${params.system_prompt},
      ${sql.array(params.tools_enabled)},
      ${params.is_template},
      NULL
    )
    RETURNING
      id,
      agent_key,
      system_prompt,
      tools_enabled,
      COALESCE(is_template, false) AS is_template,
      user_id::text AS user_id,
      created_at,
      updated_at
  ` as {
    id: number;
    agent_key: string;
    system_prompt: string;
    tools_enabled: string[];
    is_template: boolean;
    user_id: string | null;
    created_at: Date;
    updated_at: Date;
  }[];
  return mapConfig(rows[0]!);
}

export async function getConfigById(
  sql: Sql,
  id: number,
): Promise<AdminConfigRow | null> {
  const rows = await sql`
    SELECT
      id,
      agent_key,
      system_prompt,
      tools_enabled,
      COALESCE(is_template, false) AS is_template,
      user_id::text AS user_id,
      created_at,
      updated_at
    FROM agent_configs
    WHERE id = ${id}
    LIMIT 1
  ` as {
    id: number;
    agent_key: string;
    system_prompt: string;
    tools_enabled: string[];
    is_template: boolean;
    user_id: string | null;
    created_at: Date;
    updated_at: Date;
  }[];
  return rows[0] ? mapConfig(rows[0]) : null;
}

export async function updateConfig(
  sql: Sql,
  id: number,
  patch: { name?: string; system_prompt?: string; tools_enabled?: string[] },
): Promise<AdminConfigRow | null> {
  const current = await getConfigById(sql, id);
  if (!current) return null;
  if (
    patch.name === undefined &&
    patch.system_prompt === undefined &&
    patch.tools_enabled === undefined
  ) {
    return current;
  }
  const agent_key = patch.name !== undefined ? patch.name : current.name;
  const system_prompt = patch.system_prompt !== undefined
    ? patch.system_prompt
    : current.system_prompt;
  const tools_enabled = patch.tools_enabled !== undefined
    ? patch.tools_enabled
    : current.tools_enabled;
  const rows = await sql`
    UPDATE agent_configs
    SET
      agent_key = ${agent_key},
      system_prompt = ${system_prompt},
      tools_enabled = ${sql.array(tools_enabled)},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id,
      agent_key,
      system_prompt,
      tools_enabled,
      COALESCE(is_template, false) AS is_template,
      user_id::text AS user_id,
      created_at,
      updated_at
  ` as {
    id: number;
    agent_key: string;
    system_prompt: string;
    tools_enabled: string[];
    is_template: boolean;
    user_id: string | null;
    created_at: Date;
    updated_at: Date;
  }[];
  return rows[0] ? mapConfig(rows[0]) : null;
}

export async function deleteConfig(sql: Sql, id: number): Promise<boolean> {
  const rows = await sql`
    DELETE FROM agent_configs
    WHERE id = ${id}
    RETURNING id
  ` as { id: number }[];
  return rows.length > 0;
}

export async function assignConfigFromTemplate(
  sql: Sql,
  templateConfigId: number,
  targetUserId: string,
): Promise<string | null> {
  const src = await sql`
    SELECT agent_key, system_prompt, tools_enabled
    FROM agent_configs
    WHERE id = ${templateConfigId}
      AND COALESCE(is_template, false) = true
    LIMIT 1
  ` as {
    agent_key: string;
    system_prompt: string;
    tools_enabled: string[];
  }[];
  if (!src[0]) return null;
  const newKey = `${src[0].agent_key}__user__${targetUserId}`;
  try {
    const ins = await sql`
      INSERT INTO agent_configs (
        agent_key,
        system_prompt,
        tools_enabled,
        is_template,
        user_id
      )
      VALUES (
        ${newKey},
        ${src[0].system_prompt},
        ${sql.array(src[0].tools_enabled ?? [])},
        false,
        ${targetUserId}::uuid
      )
      RETURNING id
    ` as { id: number }[];
    return String(ins[0]!.id);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "23505") {
      const ins2 = await sql`
        INSERT INTO agent_configs (
          agent_key,
          system_prompt,
          tools_enabled,
          is_template,
          user_id
        )
        VALUES (
          ${newKey + "__" + crypto.randomUUID()},
          ${src[0].system_prompt},
          ${sql.array(src[0].tools_enabled ?? [])},
          false,
          ${targetUserId}::uuid
        )
        RETURNING id
      ` as { id: number }[];
      return String(ins2[0]!.id);
    }
    throw e;
  }
}

export async function listSchedules(sql: Sql): Promise<AdminScheduleRow[]> {
  const rows = await sql`
    SELECT
      s.id::text,
      s.user_id::text,
      u.name AS user_name,
      u.email AS user_email,
      s.cron_expression,
      s.delivery_channel,
      s.delivery_target,
      s.is_active,
      s.last_run,
      s.last_run_status
    FROM cos_schedules s
    INNER JOIN cos_users u ON u.id = s.user_id
    ORDER BY s.created_at DESC
  ` as {
    id: string;
    user_id: string;
    user_name: string;
    user_email: string;
    cron_expression: string;
    delivery_channel: string;
    delivery_target: string;
    is_active: boolean;
    last_run: Date | null;
    last_run_status: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name,
    user_email: r.user_email,
    cron_expression: r.cron_expression,
    delivery_channel: r.delivery_channel,
    delivery_target: r.delivery_target,
    is_active: r.is_active,
    last_run: r.last_run ? r.last_run.toISOString() : null,
    last_run_status: r.last_run_status,
  }));
}

/** Für Cron: nur aktive Schedules inkl. aktive User. */
export type ActiveBriefingScheduleRow = {
  user_id: string;
  cron_expression: string;
  delivery_channel: string;
  delivery_target: string;
  last_run: Date | null;
  last_run_status: string | null;
};

export async function listActiveBriefingSchedules(
  sql: Sql,
): Promise<ActiveBriefingScheduleRow[]> {
  const rows = await sql`
    SELECT
      s.user_id::text AS user_id,
      s.cron_expression,
      s.delivery_channel,
      s.delivery_target,
      s.last_run,
      s.last_run_status
    FROM cos_schedules s
    INNER JOIN cos_users u ON u.id = s.user_id
    WHERE s.is_active = true AND u.is_active = true
  ` as {
    user_id: string;
    cron_expression: string;
    delivery_channel: string;
    delivery_target: string;
    last_run: Date | null;
    last_run_status: string | null;
  }[];
  return rows.map((r) => ({
    user_id: r.user_id,
    cron_expression: r.cron_expression,
    delivery_channel: r.delivery_channel,
    delivery_target: r.delivery_target,
    last_run: r.last_run,
    last_run_status: r.last_run_status,
  }));
}

export async function updateScheduleBriefingRun(
  sql: Sql,
  userId: string,
  status: "success" | "error",
): Promise<void> {
  await sql`
    UPDATE cos_schedules
    SET last_run = NOW(), last_run_status = ${status}
    WHERE user_id = ${userId}::uuid
  `;
}

export async function upsertSchedule(
  sql: Sql,
  userId: string,
  body: {
    cron_expression: string;
    delivery_channel: string;
    delivery_target: string;
    is_active?: boolean;
  },
): Promise<AdminScheduleRow> {
  const prev = await sql`
    SELECT is_active FROM cos_schedules WHERE user_id = ${userId}::uuid LIMIT 1
  ` as { is_active: boolean }[];
  const mergedActive = body.is_active !== undefined
    ? body.is_active
    : (prev[0]?.is_active ?? true);

  const rows = await sql`
    INSERT INTO cos_schedules (
      user_id,
      cron_expression,
      delivery_channel,
      delivery_target,
      is_active
    )
    VALUES (
      ${userId}::uuid,
      ${body.cron_expression},
      ${body.delivery_channel},
      ${body.delivery_target},
      ${mergedActive}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      cron_expression = EXCLUDED.cron_expression,
      delivery_channel = EXCLUDED.delivery_channel,
      delivery_target = EXCLUDED.delivery_target,
      is_active = EXCLUDED.is_active
    RETURNING
      id::text,
      user_id::text,
      cron_expression,
      delivery_channel,
      delivery_target,
      is_active,
      last_run,
      last_run_status
  ` as {
    id: string;
    user_id: string;
    cron_expression: string;
    delivery_channel: string;
    delivery_target: string;
    is_active: boolean;
    last_run: Date | null;
    last_run_status: string | null;
  }[];

  const u = await sql`
    SELECT name, email FROM cos_users WHERE id = ${userId}::uuid LIMIT 1
  ` as { name: string; email: string }[];

  const r = rows[0]!;
  return {
    id: r.id,
    user_id: r.user_id,
    user_name: u[0]?.name ?? "",
    user_email: u[0]?.email ?? "",
    cron_expression: r.cron_expression,
    delivery_channel: r.delivery_channel,
    delivery_target: r.delivery_target,
    is_active: r.is_active,
    last_run: r.last_run ? r.last_run.toISOString() : null,
    last_run_status: r.last_run_status,
  };
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v);
}

export async function getCosts(
  sql: Sql,
  from: Date,
  to: Date,
): Promise<{ by_user: CostBreakdownRow[]; totals: CostTotals }> {
  const rows = await sql`
    SELECT
      c.user_id::text AS user_id,
      u.name AS user_name,
      u.email AS user_email,
      COUNT(*)::int AS total_calls,
      COALESCE(SUM(c.input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(c.output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(c.cost_usd), 0) AS cost_usd
    FROM cos_llm_calls c
    LEFT JOIN cos_users u ON u.id = c.user_id
    WHERE c.created_at >= ${from} AND c.created_at <= ${to}
    GROUP BY c.user_id, u.name, u.email
    ORDER BY user_id
  ` as {
    user_id: string;
    user_name: string | null;
    user_email: string | null;
    total_calls: number;
    input_tokens: bigint;
    output_tokens: bigint;
    cost_usd: string;
  }[];

  const by_user: CostBreakdownRow[] = rows.map((r) => ({
    user_id: r.user_id,
    user_name: r.user_name,
    user_email: r.user_email,
    total_calls: r.total_calls,
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    cost_usd: num(r.cost_usd),
  }));

  const totals: CostTotals = by_user.reduce(
    (acc, r) => ({
      total_calls: acc.total_calls + r.total_calls,
      input_tokens: acc.input_tokens + r.input_tokens,
      output_tokens: acc.output_tokens + r.output_tokens,
      cost_usd: acc.cost_usd + r.cost_usd,
    }),
    {
      total_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    },
  );

  return { by_user, totals };
}
