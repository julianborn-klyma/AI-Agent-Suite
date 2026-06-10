import type {
  BrainConflict,
  BrainEntry,
  BrainEntryType,
  BrainMemberRole,
  BrainProject,
  BrainProjectMember,
  FirmInsight,
  FirmInsightCategory,
} from "../../db/databaseClient.ts";

export type {
  BrainConflict,
  BrainEntry,
  BrainEntryType,
  BrainMemberRole,
  BrainProject,
  BrainProjectMember,
  FirmInsight,
  FirmInsightCategory,
};

export type { BrainForbiddenError, BrainNotFoundError } from "../../db/databaseClient.ts";

export type CreateProjectInput = {
  name: string;
  description?: string | null;
  color?: string;
};

export type UpdateProjectInput = {
  name?: string;
  description?: string | null;
  color?: string;
};

export type CreateEntryInput = {
  type: BrainEntryType;
  content: string;
  source?: string | null;
  confidence?: number;
  tags?: string[];
  expires_at?: string | null;
};

export type UpdateEntryInput = {
  content?: string;
  source?: string | null;
  confidence?: number;
  tags?: string[];
  expires_at?: string | null;
};

export type BrainProjectWithStats = BrainProject & {
  member_count: number;
  entry_count: number;
  my_role: BrainMemberRole;
};

export type BrainMemberWithUser = BrainProjectMember & {
  user_name: string;
  user_email: string;
};

export type BrainEntryWithAuthor = BrainEntry & {
  author_name: string;
};
