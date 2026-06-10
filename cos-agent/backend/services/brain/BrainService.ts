import { parseJsonObject } from "../../agents/jsonUtils.ts";
import { MODEL_IDS } from "../../agents/modelSelector.ts";
import type { DatabaseClient } from "../../db/databaseClient.ts";
import {
  BrainForbiddenError,
  BrainNotFoundError,
} from "../../db/databaseClient.ts";
import type { LlmClient } from "../llm/llmTypes.ts";
import type { EmbeddingClient } from "../llm/llmTypes.ts";
import type {
  BrainConflict,
  BrainEntry,
  BrainMemberRole,
  BrainMemberWithUser,
  BrainProject,
  BrainProjectMember,
  BrainProjectWithStats,
  CreateEntryInput,
  CreateProjectInput,
  UpdateEntryInput,
  UpdateProjectInput,
} from "./types.ts";

export class BrainService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly embedder?: EmbeddingClient,
  ) {}

  private async getMemberRole(
    projectId: string,
    userId: string,
  ): Promise<BrainMemberRole | null> {
    const m = await this.db.getBrainProjectMember(projectId, userId);
    return m?.role ?? null;
  }

  private async assertCanRead(projectId: string, userId: string): Promise<void> {
    const role = await this.getMemberRole(projectId, userId);
    if (!role) throw new BrainForbiddenError();
  }

  private async assertCanWrite(
    projectId: string,
    userId: string,
  ): Promise<void> {
    const role = await this.getMemberRole(projectId, userId);
    if (role !== "owner" && role !== "knowledge_owner") {
      throw new BrainForbiddenError(
        "Schreib-Recht erforderlich (owner oder knowledge_owner).",
      );
    }
  }

  private async assertIsOwner(
    projectId: string,
    userId: string,
  ): Promise<void> {
    const role = await this.getMemberRole(projectId, userId);
    if (role !== "owner") {
      throw new BrainForbiddenError(
        "Nur Projekt-Owner dürfen diese Aktion ausführen.",
      );
    }
  }

  private async computeEmbedding(text: string): Promise<number[] | null> {
    if (!this.embedder) return null;
    try {
      return await this.embedder.embed(text);
    } catch {
      return null;
    }
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  async createProject(
    tenantId: string,
    userId: string,
    input: CreateProjectInput,
  ): Promise<BrainProject> {
    const project = await this.db.insertBrainProject({
      tenantId,
      ownerId: userId,
      name: input.name,
      description: input.description,
      color: input.color,
    });
    await this.db.insertBrainProjectMember({
      projectId: project.id,
      userId,
      role: "owner",
      invitedBy: null,
    });
    return project;
  }

  async getProjectsForUser(
    userId: string,
    tenantId: string,
  ): Promise<BrainProjectWithStats[]> {
    const projects = await this.db.getBrainProjectsForUser(userId, tenantId);
    const out: BrainProjectWithStats[] = [];
    for (const p of projects) {
      const [members, entries, myMembership] = await Promise.all([
        this.db.getBrainProjectMembers(p.id),
        this.db.getBrainEntriesForProject(p.id, { activeOnly: true }),
        this.db.getBrainProjectMember(p.id, userId),
      ]);
      out.push({
        ...p,
        member_count: members.length,
        entry_count: entries.length,
        my_role: myMembership!.role,
      });
    }
    return out;
  }

  async getProjectById(projectId: string, userId: string): Promise<BrainProject> {
    await this.assertCanRead(projectId, userId);
    const project = await this.db.getBrainProjectById(projectId);
    if (!project) throw new BrainNotFoundError("Projekt nicht gefunden.");
    return project;
  }

  async updateProject(
    projectId: string,
    userId: string,
    input: UpdateProjectInput,
  ): Promise<BrainProject> {
    await this.assertIsOwner(projectId, userId);
    return await this.db.updateBrainProject(projectId, {
      name: input.name,
      description: input.description,
      color: input.color,
    });
  }

  async deleteProject(projectId: string, userId: string): Promise<void> {
    await this.assertIsOwner(projectId, userId);
    await this.db.updateBrainProject(projectId, { is_active: false });
  }

  // ── Members ───────────────────────────────────────────────────────────────

  async getProjectMembers(
    projectId: string,
    userId: string,
  ): Promise<BrainMemberWithUser[]> {
    await this.assertCanRead(projectId, userId);
    return await this.db.getBrainProjectMembers(projectId);
  }

  async inviteMember(
    projectId: string,
    targetUserId: string,
    role: "knowledge_owner" | "member",
    invitedBy: string,
  ): Promise<BrainProjectMember> {
    await this.assertIsOwner(projectId, invitedBy);
    const existing = await this.db.getBrainProjectMember(
      projectId,
      targetUserId,
    );
    if (existing) {
      if (existing.role === "owner") {
        throw new BrainForbiddenError("Owner-Rolle kann nicht geändert werden.");
      }
      await this.db.updateBrainProjectMemberRole(projectId, targetUserId, role);
      return { ...existing, role };
    }
    return await this.db.insertBrainProjectMember({
      projectId,
      userId: targetUserId,
      role,
      invitedBy,
    });
  }

  async setMemberRole(
    projectId: string,
    targetUserId: string,
    newRole: "knowledge_owner" | "member",
    changedBy: string,
  ): Promise<void> {
    await this.assertIsOwner(projectId, changedBy);
    const target = await this.db.getBrainProjectMember(projectId, targetUserId);
    if (!target) throw new BrainNotFoundError("Member nicht gefunden.");
    if (target.role === "owner") {
      throw new BrainForbiddenError("Owner-Rolle kann nicht geändert werden.");
    }
    await this.db.updateBrainProjectMemberRole(projectId, targetUserId, newRole);
  }

  async removeMember(
    projectId: string,
    targetUserId: string,
    removedBy: string,
  ): Promise<void> {
    const removerRole = await this.getMemberRole(projectId, removedBy);
    if (!removerRole) throw new BrainForbiddenError();
    if (removedBy !== targetUserId && removerRole !== "owner") {
      throw new BrainForbiddenError("Nur Owner können andere Members entfernen.");
    }
    const target = await this.db.getBrainProjectMember(projectId, targetUserId);
    if (!target) throw new BrainNotFoundError("Member nicht gefunden.");
    if (target.role === "owner") {
      throw new BrainForbiddenError(
        "Owner kann nicht entfernt werden. Zuerst Eigentümerschaft übertragen.",
      );
    }
    await this.db.removeBrainProjectMember(projectId, targetUserId);
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  async addEntry(
    projectId: string,
    userId: string,
    input: CreateEntryInput,
  ): Promise<{ entry: BrainEntry; conflicts: BrainConflict[] }> {
    await this.assertCanWrite(projectId, userId);

    const project = await this.db.getBrainProjectById(projectId);
    if (!project) throw new BrainNotFoundError("Projekt nicht gefunden.");

    const embedding = await this.computeEmbedding(input.content);

    const entry = await this.db.insertBrainEntry({
      projectId,
      tenantId: project.tenant_id,
      createdBy: userId,
      type: input.type,
      content: input.content,
      source: input.source,
      confidence: input.confidence,
      tags: input.tags,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
      embedding,
    });

    const conflicts = embedding
      ? await this.detectConflictsForEntry(
        projectId,
        entry.id,
        embedding,
        entry.content,
        userId,
      )
      : [];

    return { entry, conflicts };
  }

  async updateEntry(
    entryId: string,
    userId: string,
    input: UpdateEntryInput,
  ): Promise<BrainEntry> {
    const entry = await this.db.getBrainEntryById(entryId);
    if (!entry) throw new BrainNotFoundError();
    await this.assertCanWrite(entry.project_id, userId);

    const embedding = input.content
      ? await this.computeEmbedding(input.content)
      : undefined;

    return await this.db.updateBrainEntry(entryId, {
      content: input.content,
      source: input.source,
      confidence: input.confidence,
      tags: input.tags,
      expiresAt: input.expires_at ? new Date(input.expires_at) : undefined,
      embedding,
    });
  }

  async deleteEntry(entryId: string, userId: string): Promise<void> {
    const entry = await this.db.getBrainEntryById(entryId);
    if (!entry) throw new BrainNotFoundError();
    await this.assertCanWrite(entry.project_id, userId);
    await this.db.updateBrainEntry(entryId, { is_active: false });
  }

  async getEntries(
    projectId: string,
    userId: string,
    options?: { type?: BrainEntry["type"]; limit?: number },
  ): Promise<BrainEntry[]> {
    await this.assertCanRead(projectId, userId);
    return await this.db.getBrainEntriesForProject(projectId, {
      type: options?.type,
      activeOnly: true,
      limit: options?.limit,
    });
  }

  /** Read-only access for the agent — combines all requested projects. */
  async getContextForAgent(
    projectIds: string[],
    userId: string,
    query: string,
    limit = 10,
  ): Promise<BrainEntry[]> {
    for (const pid of projectIds) {
      await this.assertCanRead(pid, userId);
    }

    const embedding = await this.computeEmbedding(query);
    const perProject = Math.ceil(limit / Math.max(1, projectIds.length));
    const results: BrainEntry[] = [];

    for (const pid of projectIds) {
      const entries = await this.db.searchBrainEntries({
        projectId: pid,
        query,
        embedding,
        limit: perProject,
      });
      results.push(...entries);
    }

    return results.slice(0, limit);
  }

  // ── Conflicts ─────────────────────────────────────────────────────────────

  async getConflicts(projectId: string, userId: string): Promise<BrainConflict[]> {
    await this.assertCanRead(projectId, userId);
    return await this.db.getBrainConflictsForProject(projectId, false);
  }

  async resolveConflict(
    conflictId: string,
    userId: string,
  ): Promise<void> {
    const conflict = await this.db.getBrainConflictById(conflictId);
    if (!conflict) throw new BrainNotFoundError("Konflikt nicht gefunden.");
    await this.assertCanWrite(conflict.project_id, userId);
    await this.db.resolveBrainConflict(conflictId, userId);
  }

  private async detectConflictsForEntry(
    projectId: string,
    entryId: string,
    embedding: number[],
    content: string,
    userId: string,
  ): Promise<BrainConflict[]> {
    const candidates = await this.db.findSimilarBrainEntries({
      projectId,
      embedding,
      threshold: 0.8,
      limit: 10,
    });

    const conflicts: BrainConflict[] = [];

    for (const candidate of candidates) {
      if (candidate.id === entryId) continue;

      const alreadyExists = await this.db.conflictExistsBetween(
        entryId,
        candidate.id,
      );
      if (alreadyExists) continue;

      const check = await this.checkConflictWithLlm(
        content,
        candidate.content,
        userId,
      );

      if (check.conflict) {
        const conflict = await this.db.insertBrainConflict({
          projectId,
          entryAId: entryId,
          entryBId: candidate.id,
          conflictDescription: check.reason,
        });
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  private async checkConflictWithLlm(
    contentA: string,
    contentB: string,
    userId: string,
  ): Promise<{ conflict: boolean; reason: string }> {
    try {
      const response = await this.llm.chat({
        model: MODEL_IDS.haiku,
        system:
          "Prüfe ob die zwei Aussagen sich inhaltlich widersprechen. " +
          'Antworte NUR mit JSON (kein Markdown): {"conflict": true/false, "reason": "Kurze Begründung"}',
        messages: [
          {
            role: "user",
            content: `Aussage A: ${contentA}\n\nAussage B: ${contentB}`,
          },
        ],
        metadata: { user_id: userId, source: "brain-conflict-detection" },
      });

      const parsed = parseJsonObject(response.content ?? "");
      if (!parsed) return { conflict: false, reason: "" };
      return {
        conflict: Boolean(parsed.conflict),
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    } catch {
      return { conflict: false, reason: "" };
    }
  }
}
