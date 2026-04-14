import type {
  DatabaseClient,
  Document,
  DocumentChunk,
  Schedule,
} from "./databaseClient.ts";

/** Standard-Noops für `DatabaseClient`-Fakes ohne Dokument-Features. */
export const documentTestStubs: Pick<
  DatabaseClient,
  | "insertDocument"
  | "getDocuments"
  | "getDocument"
  | "updateDocumentProcessed"
  | "deleteDocument"
  | "insertChunks"
  | "searchChunks"
  | "getChunks"
> = {
  async insertDocument(): Promise<Document> {
    throw new Error("insertDocument: Test-Fake nicht konfiguriert");
  },
  async getDocuments(): Promise<Document[]> {
    return [];
  },
  async getDocument(): Promise<Document | null> {
    return null;
  },
  async updateDocumentProcessed(): Promise<void> {},
  async deleteDocument(): Promise<void> {},
  async insertChunks(): Promise<void> {},
  async searchChunks(): Promise<DocumentChunk[]> {
    return [];
  },
  async getChunks(): Promise<DocumentChunk[]> {
    return [];
  },
};

export const scheduleTestStubs: Pick<
  DatabaseClient,
  | "getUserSchedules"
  | "upsertJobSchedule"
  | "toggleJobSchedule"
  | "initDefaultSchedules"
  | "listConversationMessagesForUserSince"
  | "purgeUserContextSummariesOlderThan"
  | "purgeUserConversationsOlderThan"
  | "recordScheduleRun"
> = {
  async getUserSchedules(): Promise<Schedule[]> {
    return [];
  },
  async upsertJobSchedule(): Promise<Schedule> {
    throw new Error("upsertJobSchedule: Test-Fake nicht konfiguriert");
  },
  async toggleJobSchedule(): Promise<void> {},
  async initDefaultSchedules(): Promise<void> {},
  async listConversationMessagesForUserSince(): Promise<
    { role: string; content: string; created_at: Date }[]
  > {
    return [];
  },
  async purgeUserContextSummariesOlderThan(): Promise<void> {},
  async purgeUserConversationsOlderThan(): Promise<void> {},
  async recordScheduleRun(): Promise<void> {},
};
