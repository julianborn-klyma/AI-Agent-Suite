import type postgres from "postgres";
import { setAppTenantSession } from "../db/appTenantSession.ts";

type Tx = postgres.TransactionSql;

export async function resolveUserTenantId(
  sql: postgres.Sql,
  userId: string,
): Promise<string | null> {
  const rows = await sql`
    SELECT tenant_id::text AS tid
    FROM public.cos_users
    WHERE id = ${userId}::uuid
      AND tenant_id IS NOT NULL
    LIMIT 1
  ` as { tid: string }[];
  return rows[0]?.tid ?? null;
}

export async function withWorkspaceTx<T>(
  sql: postgres.Sql,
  userId: string,
  fn: (tx: Tx, tenantId: string) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; status: number; message: string }> {
  const tenantId = await resolveUserTenantId(sql, userId);
  if (!tenantId) {
    return { ok: false, status: 403, message: "Kein Tenant für diesen Benutzer." };
  }
  const value = await sql.begin(async (tx) => {
    await setAppTenantSession(tx, tenantId, true);
    return await fn(tx, tenantId);
  }) as T;
  return { ok: true, value };
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(s);
}

export async function listTeams(tx: Tx): Promise<
  { id: string; name: string; created_at: string }[]
> {
  const rows = await tx`
    SELECT id::text, name, created_at
    FROM app.teams
    ORDER BY name ASC
  ` as { id: string; name: string; created_at: Date }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    created_at: r.created_at.toISOString(),
  }));
}

export async function createTeam(
  tx: Tx,
  tenantId: string,
  name: string,
): Promise<{ id: string; name: string; created_at: string }> {
  const rows = await tx`
    INSERT INTO app.teams (tenant_id, name)
    VALUES (${tenantId}::uuid, ${name})
    RETURNING id::text, name, created_at
  ` as { id: string; name: string; created_at: Date }[];
  const r = rows[0]!;
  return { ...r, created_at: r.created_at.toISOString() };
}

export async function patchTeam(
  tx: Tx,
  teamId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  if (!isUuid(teamId)) return null;
  const rows = await tx`
    UPDATE app.teams
    SET name = ${name}, updated_at = NOW()
    WHERE id = ${teamId}::uuid
    RETURNING id::text, name
  ` as { id: string; name: string }[];
  return rows[0] ?? null;
}

export async function listProjects(tx: Tx): Promise<
  { id: string; name: string; description: string | null; created_at: string }[]
> {
  const rows = await tx`
    SELECT id::text, name, description, created_at
    FROM app.projects
    ORDER BY name ASC
  ` as {
    id: string;
    name: string;
    description: string | null;
    created_at: Date;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    created_at: r.created_at.toISOString(),
  }));
}

export async function createProject(
  tx: Tx,
  tenantId: string,
  name: string,
  description: string | null,
): Promise<
  { id: string; name: string; description: string | null; created_at: string }
> {
  const rows = await tx`
    INSERT INTO app.projects (tenant_id, name, description)
    VALUES (${tenantId}::uuid, ${name}, ${description})
    RETURNING id::text, name, description, created_at
  ` as {
    id: string;
    name: string;
    description: string | null;
    created_at: Date;
  }[];
  const r = rows[0]!;
  return { ...r, created_at: r.created_at.toISOString() };
}

export async function patchProject(
  tx: Tx,
  projectId: string,
  patch: { name?: string; description?: string | null },
): Promise<{ id: string; name: string; description: string | null } | null> {
  if (!isUuid(projectId)) return null;
  const cur = await tx`
    SELECT id::text, name, description
    FROM app.projects
    WHERE id = ${projectId}::uuid
  ` as { id: string; name: string; description: string | null }[];
  const row = cur[0];
  if (!row) return null;
  const name = patch.name !== undefined ? patch.name.trim() : row.name;
  const description = patch.description !== undefined ? patch.description : row.description;
  if (!name) return null;
  const rows = await tx`
    UPDATE app.projects
    SET name = ${name}, description = ${description}, updated_at = NOW()
    WHERE id = ${projectId}::uuid
    RETURNING id::text, name, description
  ` as { id: string; name: string; description: string | null }[];
  return rows[0] ?? null;
}

export type WorkTaskRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assignee_user_ids: string[];
  team_ids: string[];
};

export async function listWorkTasks(
  tx: Tx,
  filters: { project_id: string | null; status: string | null },
): Promise<WorkTaskRow[]> {
  const projectId = filters.project_id && isUuid(filters.project_id)
    ? filters.project_id
    : null;
  const status = filters.status &&
      ["open", "in_progress", "done", "cancelled"].includes(filters.status)
    ? filters.status
    : null;

  const rows = await tx`
    SELECT
      t.id::text,
      t.tenant_id::text,
      t.project_id::text,
      p.name AS project_name,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.due_at,
      t.created_by::text,
      t.created_at,
      t.updated_at,
      COALESCE(
        (
          SELECT json_agg(a.user_id::text ORDER BY a.user_id)
          FROM app.task_assignees a
          WHERE a.task_id = t.id
        ),
        '[]'::json
      ) AS assignee_user_ids,
      COALESCE(
        (
          SELECT json_agg(tt.team_id::text ORDER BY tt.team_id)
          FROM app.task_teams tt
          WHERE tt.task_id = t.id
        ),
        '[]'::json
      ) AS team_ids
    FROM app.tasks t
    INNER JOIN app.projects p ON p.id = t.project_id
    WHERE (${projectId}::uuid IS NULL OR t.project_id = ${projectId}::uuid)
      AND (${status}::text IS NULL OR t.status = ${status})
    ORDER BY t.updated_at DESC
    LIMIT 200
  ` as {
    id: string;
    tenant_id: string;
    project_id: string;
    project_name: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_at: Date | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
    assignee_user_ids: string[];
    team_ids: string[];
  }[];

  return rows.map((r) => ({
    ...r,
    due_at: r.due_at?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    assignee_user_ids: Array.isArray(r.assignee_user_ids) ? r.assignee_user_ids : [],
    team_ids: Array.isArray(r.team_ids) ? r.team_ids : [],
  }));
}

export async function getWorkTask(
  tx: Tx,
  taskId: string,
): Promise<WorkTaskRow | null> {
  if (!isUuid(taskId)) return null;
  const rows = await tx`
    SELECT
      t.id::text,
      t.tenant_id::text,
      t.project_id::text,
      p.name AS project_name,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.due_at,
      t.created_by::text,
      t.created_at,
      t.updated_at,
      COALESCE(
        (
          SELECT json_agg(a.user_id::text ORDER BY a.user_id)
          FROM app.task_assignees a
          WHERE a.task_id = t.id
        ),
        '[]'::json
      ) AS assignee_user_ids,
      COALESCE(
        (
          SELECT json_agg(tt.team_id::text ORDER BY tt.team_id)
          FROM app.task_teams tt
          WHERE tt.task_id = t.id
        ),
        '[]'::json
      ) AS team_ids
    FROM app.tasks t
    INNER JOIN app.projects p ON p.id = t.project_id
    WHERE t.id = ${taskId}::uuid
    LIMIT 1
  ` as {
    id: string;
    tenant_id: string;
    project_id: string;
    project_name: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_at: Date | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
    assignee_user_ids: string[];
    team_ids: string[];
  }[];
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    due_at: r.due_at?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    assignee_user_ids: Array.isArray(r.assignee_user_ids) ? r.assignee_user_ids : [],
    team_ids: Array.isArray(r.team_ids) ? r.team_ids : [],
  };
}

async function assertUsersInTenant(
  tx: Tx,
  tenantId: string,
  userIds: string[],
): Promise<boolean> {
  if (userIds.length === 0) return true;
  const uniq = [...new Set(userIds)];
  const rows = await tx`
    SELECT count(*)::int AS c
    FROM public.cos_users
    WHERE tenant_id = ${tenantId}::uuid
      AND id IN ${tx(uniq)}
  ` as { c: number }[];
  return (rows[0]?.c ?? 0) === uniq.length;
}

async function assertTeamsInTenant(
  tx: Tx,
  tenantId: string,
  teamIds: string[],
): Promise<boolean> {
  if (teamIds.length === 0) return true;
  const uniq = [...new Set(teamIds)];
  const rows = await tx`
    SELECT count(*)::int AS c
    FROM app.teams
    WHERE tenant_id = ${tenantId}::uuid
      AND id IN ${tx(uniq)}
  ` as { c: number }[];
  return (rows[0]?.c ?? 0) === uniq.length;
}

export async function createWorkTask(
  tx: Tx,
  tenantId: string,
  userId: string,
  body: {
    project_id: string;
    title: string;
    description?: string | null;
    status?: string;
    priority?: string;
    due_at?: string | null;
    assignee_user_ids?: string[];
    team_ids?: string[];
  },
): Promise<WorkTaskRow | { error: string }> {
  if (!isUuid(body.project_id)) return { error: "project_id ungültig" };
  const title = body.title.trim();
  if (!title) return { error: "title fehlt" };
  if (title.length > 500) return { error: "title zu lang" };
  const status = body.status && ["open", "in_progress", "done", "cancelled"].includes(body.status)
    ? body.status
    : "open";
  const priority = body.priority &&
      ["low", "medium", "high", "urgent"].includes(body.priority)
    ? body.priority
    : "medium";
  const assignees = (body.assignee_user_ids ?? []).filter(isUuid);
  const teams = (body.team_ids ?? []).filter(isUuid);
  if (!(await assertUsersInTenant(tx, tenantId, assignees))) {
    return { error: "assignee_user_ids nicht im Tenant" };
  }
  if (!(await assertTeamsInTenant(tx, tenantId, teams))) {
    return { error: "team_ids nicht im Tenant" };
  }

  const dueAt = body.due_at && body.due_at.trim() !== ""
    ? new Date(body.due_at)
    : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return { error: "due_at ungültig" };

  const inserted = await tx`
    INSERT INTO app.tasks (
      tenant_id,
      project_id,
      title,
      description,
      status,
      priority,
      due_at,
      created_by
    )
    VALUES (
      ${tenantId}::uuid,
      ${body.project_id}::uuid,
      ${title},
      ${body.description ?? null},
      ${status},
      ${priority},
      ${dueAt},
      ${userId}::uuid
    )
    RETURNING id::text
  ` as { id: string }[];
  const taskId = inserted[0]!.id;

  for (const uid of assignees) {
    await tx`
      INSERT INTO app.task_assignees (tenant_id, task_id, user_id)
      VALUES (${tenantId}::uuid, ${taskId}::uuid, ${uid}::uuid)
    `;
  }
  for (const tid of teams) {
    await tx`
      INSERT INTO app.task_teams (tenant_id, task_id, team_id)
      VALUES (${tenantId}::uuid, ${taskId}::uuid, ${tid}::uuid)
    `;
  }

  return await getWorkTask(tx, taskId) as WorkTaskRow;
}

export async function patchWorkTask(
  tx: Tx,
  tenantId: string,
  taskId: string,
  body: {
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    due_at?: string | null;
    project_id?: string;
    assignee_user_ids?: string[] | null;
    team_ids?: string[] | null;
  },
): Promise<WorkTaskRow | { error: string } | null> {
  if (!isUuid(taskId)) return null;
  const cur = await getWorkTask(tx, taskId);
  if (!cur) return null;

  const title = body.title !== undefined ? body.title.trim() : cur.title;
  if (!title) return { error: "title leer" };
  if (title.length > 500) return { error: "title zu lang" };

  const status = body.status !== undefined
    ? (["open", "in_progress", "done", "cancelled"].includes(body.status)
      ? body.status
      : null)
    : cur.status;
  if (body.status !== undefined && status === null) return { error: "status ungültig" };

  const priority = body.priority !== undefined
    ? (["low", "medium", "high", "urgent"].includes(body.priority) ? body.priority : null)
    : cur.priority;
  if (body.priority !== undefined && priority === null) return { error: "priority ungültig" };

  let projectId = cur.project_id;
  if (body.project_id !== undefined) {
    if (!isUuid(body.project_id)) return { error: "project_id ungültig" };
    projectId = body.project_id;
  }

  let dueAt: Date | null = cur.due_at ? new Date(cur.due_at) : null;
  if (body.due_at !== undefined) {
    if (body.due_at === null || body.due_at === "") dueAt = null;
    else {
      const d = new Date(body.due_at);
      if (Number.isNaN(d.getTime())) return { error: "due_at ungültig" };
      dueAt = d;
    }
  }

  const desc = body.description !== undefined ? body.description : cur.description;

  await tx`
    UPDATE app.tasks
    SET
      project_id = ${projectId}::uuid,
      title = ${title},
      description = ${desc},
      status = ${status},
      priority = ${priority},
      due_at = ${dueAt},
      updated_at = NOW()
    WHERE id = ${taskId}::uuid
      AND tenant_id = ${tenantId}::uuid
  `;

  if (body.assignee_user_ids !== undefined && body.assignee_user_ids !== null) {
    const assignees = body.assignee_user_ids.filter(isUuid);
    if (!(await assertUsersInTenant(tx, tenantId, assignees))) {
      return { error: "assignee_user_ids nicht im Tenant" };
    }
    await tx`DELETE FROM app.task_assignees WHERE task_id = ${taskId}::uuid`;
    for (const uid of assignees) {
      await tx`
        INSERT INTO app.task_assignees (tenant_id, task_id, user_id)
        VALUES (${tenantId}::uuid, ${taskId}::uuid, ${uid}::uuid)
      `;
    }
  }

  if (body.team_ids !== undefined && body.team_ids !== null) {
    const teams = body.team_ids.filter(isUuid);
    if (!(await assertTeamsInTenant(tx, tenantId, teams))) {
      return { error: "team_ids nicht im Tenant" };
    }
    await tx`DELETE FROM app.task_teams WHERE task_id = ${taskId}::uuid`;
    for (const tid of teams) {
      await tx`
        INSERT INTO app.task_teams (tenant_id, task_id, team_id)
        VALUES (${tenantId}::uuid, ${taskId}::uuid, ${tid}::uuid)
      `;
    }
  }

  return await getWorkTask(tx, taskId) as WorkTaskRow;
}

export async function deleteWorkTask(
  tx: Tx,
  tenantId: string,
  taskId: string,
): Promise<boolean> {
  if (!isUuid(taskId)) return false;
  const rows = await tx`
    DELETE FROM app.tasks
    WHERE id = ${taskId}::uuid
      AND tenant_id = ${tenantId}::uuid
    RETURNING id
  ` as { id: string }[];
  return rows.length > 0;
}

export async function listTenantUsers(
  tx: Tx,
  tenantId: string,
): Promise<{ id: string; name: string; email: string }[]> {
  const rows = await tx`
    SELECT id::text, name, email
    FROM public.cos_users
    WHERE tenant_id = ${tenantId}::uuid
      AND COALESCE(is_active, true) = true
    ORDER BY name ASC
  ` as { id: string; name: string; email: string }[];
  return rows;
}

export async function addTeamMember(
  tx: Tx,
  tenantId: string,
  teamId: string,
  memberUserId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(teamId) || !isUuid(memberUserId)) return { error: "uuid ungültig" };
  if (!(await assertUsersInTenant(tx, tenantId, [memberUserId]))) {
    return { error: "user nicht im Tenant" };
  }
  await tx`
    INSERT INTO app.team_members (tenant_id, team_id, user_id)
    VALUES (${tenantId}::uuid, ${teamId}::uuid, ${memberUserId}::uuid)
    ON CONFLICT (team_id, user_id) DO NOTHING
  `;
  return { ok: true };
}

export async function removeTeamMember(
  tx: Tx,
  teamId: string,
  memberUserId: string,
): Promise<boolean> {
  if (!isUuid(teamId) || !isUuid(memberUserId)) return false;
  await tx`
    DELETE FROM app.team_members
    WHERE team_id = ${teamId}::uuid
      AND user_id = ${memberUserId}::uuid
  `;
  return true;
}

export async function listTeamMembers(
  tx: Tx,
  teamId: string,
): Promise<{ user_id: string; name: string; email: string }[]> {
  if (!isUuid(teamId)) return [];
  const rows = await tx`
    SELECT m.user_id::text, u.name, u.email
    FROM app.team_members m
    INNER JOIN public.cos_users u ON u.id = m.user_id
    WHERE m.team_id = ${teamId}::uuid
    ORDER BY u.name ASC
  ` as { user_id: string; name: string; email: string }[];
  return rows;
}
