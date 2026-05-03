import { requireGmailOAuthForTool } from "../../config/env.ts";
import type { DatabaseClient } from "../../db/databaseClient.ts";
import { getCredential } from "./credentialHelper.ts";
import { googleApiFetch } from "./googleApiClient.ts";
import type { Tool, ToolResult } from "./types.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const MAX_TEXT = 50_000;

const NOT_CONNECTED = "Google Drive nicht verbunden.";

export type DriveAction =
  | { action: "list_files"; folder_id?: string; limit?: number }
  | { action: "get_file_content"; file_id: string }
  | { action: "list_new_files"; since: string }
  | { action: "search_files"; query: string };

function escapeDriveQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function truncateText(s: string): string {
  if (s.length <= MAX_TEXT) return s;
  return s.slice(0, MAX_TEXT) + "\n… (gekürzt)";
}

async function assertGoogleDrive(
  db: DatabaseClient,
  userId: string,
): Promise<ToolResult | null> {
  const flag = await getCredential(db, userId, "google_connected");
  if (flag !== "true") {
    return { success: false, error: NOT_CONNECTED };
  }
  const tok = await getCredential(db, userId, "gmail_access_token");
  if (!tok) {
    return { success: false, error: NOT_CONNECTED };
  }
  return null;
}

function parseParams(raw: unknown): DriveAction | { error: string } {
  let p = raw;
  if (typeof p === "string") {
    try {
      p = JSON.parse(p);
    } catch {
      return { error: "Ungültiges JSON." };
    }
  }
  if (p === null || typeof p !== "object") {
    return { error: "Parameter müssen ein Objekt sein." };
  }
  const o = p as Record<string, unknown>;
  const action = o.action;
  if (action === "list_files") {
    let limit = 50;
    if (o.limit !== undefined) {
      const n = Number(o.limit);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return { error: "limit muss 1–100 sein." };
      }
      limit = n;
    }
    return {
      action: "list_files",
      folder_id: typeof o.folder_id === "string" ? o.folder_id : undefined,
      limit,
    };
  }
  if (action === "get_file_content") {
    if (typeof o.file_id !== "string" || !o.file_id) {
      return { error: "file_id fehlt." };
    }
    return { action: "get_file_content", file_id: o.file_id };
  }
  if (action === "list_new_files") {
    if (typeof o.since !== "string" || !o.since.trim()) {
      return { error: "since fehlt (ISO-Datum)." };
    }
    return { action: "list_new_files", since: o.since.trim() };
  }
  if (action === "search_files") {
    if (typeof o.query !== "string" || !o.query.trim()) {
      return { error: "query fehlt." };
    }
    return { action: "search_files", query: o.query.trim() };
  }
  return { error: `Unbekannte action: ${String(action)}` };
}

async function runListFiles(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  folderId: string,
  limit: number,
): Promise<ToolResult> {
  const q = `'${escapeDriveQuery(folderId)}' in parents and trashed=false`;
  const fields = encodeURIComponent(
    "nextPageToken,files(id,name,mimeType,modifiedTime)",
  );
  const path =
    `files?q=${encodeURIComponent(q)}&pageSize=${limit}&fields=${fields}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await googleApiFetch(db, userId, DRIVE_API, path, { method: "GET" }, oauth);
  if (!r.ok) {
    if (r.status === 401) {
      return { success: false, error: NOT_CONNECTED };
    }
    return { success: false, error: `Drive API Fehler: ${r.status}` };
  }
  return { success: true, data: r.data };
}

async function runGetFileContent(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  fileId: string,
): Promise<ToolResult> {
  const metaPath =
    `files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&supportsAllDrives=true`;
  const meta = await googleApiFetch(
    db,
    userId,
    DRIVE_API,
    metaPath,
    { method: "GET" },
    oauth,
  );
  if (!meta.ok) {
    if (meta.status === 401) {
      return { success: false, error: NOT_CONNECTED };
    }
    return { success: false, error: `Drive API Fehler: ${meta.status}` };
  }
  const m = meta.data as { mimeType?: string; name?: string };
  const mime = m.mimeType ?? "";

  if (mime === "application/vnd.google-apps.document") {
    const expPath =
      `files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`;
    const exp = await googleApiFetch(
      db,
      userId,
      DRIVE_API,
      expPath,
      { method: "GET" },
      oauth,
    );
    if (!exp.ok) {
      return {
        success: false,
        error: `Drive Export Fehler: ${exp.status}`,
      };
    }
    const text = typeof exp.data === "string"
      ? exp.data
      : new TextDecoder().decode(
        new Uint8Array(exp.data as ArrayBuffer),
      );
    return {
      success: true,
      data: {
        name: m.name,
        mimeType: mime,
        content: truncateText(text),
      },
    };
  }

  if (mime === "application/vnd.google-apps.spreadsheet") {
    const expPath =
      `files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fcsv`;
    const exp = await googleApiFetch(
      db,
      userId,
      DRIVE_API,
      expPath,
      { method: "GET" },
      oauth,
    );
    if (!exp.ok) {
      return {
        success: false,
        error: `Drive Export Fehler: ${exp.status}`,
      };
    }
    const text = typeof exp.data === "string"
      ? exp.data
      : new TextDecoder().decode(
        new Uint8Array(exp.data as ArrayBuffer),
      );
    return {
      success: true,
      data: {
        name: m.name,
        mimeType: mime,
        content: truncateText(text),
      },
    };
  }

  const mediaPath =
    `files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const media = await googleApiFetch(
    db,
    userId,
    DRIVE_API,
    mediaPath,
    { method: "GET" },
    oauth,
  );
  if (!media.ok) {
    if (media.status === 401) {
      return { success: false, error: NOT_CONNECTED };
    }
    return { success: false, error: `Drive Download Fehler: ${media.status}` };
  }
  const raw = media.response;
  const ct = raw.headers.get("content-type") ?? "";
  if (ct.includes("text/") || mime.includes("text/") || mime === "application/json") {
    const text = typeof media.data === "string"
      ? media.data
      : new TextDecoder().decode(media.data as ArrayBuffer);
    return {
      success: true,
      data: {
        name: m.name,
        mimeType: mime || ct,
        content: truncateText(text),
      },
    };
  }
  const buf = typeof media.data === "string"
    ? new TextEncoder().encode(media.data)
    : new Uint8Array(media.data as ArrayBuffer);
  let asText = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (!asText.trim()) {
    asText = "[Binärdatei — keine lesbare Textdarstellung.]";
  }
  return {
    success: true,
    data: {
      name: m.name,
      mimeType: mime || ct,
      content: truncateText(asText),
    },
  };
}

async function runListNewFiles(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  since: string,
): Promise<ToolResult> {
  const sinceIso = since.includes("T") ? since : `${since}T00:00:00Z`;
  const q =
    `modifiedTime > '${escapeDriveQuery(sinceIso)}' and trashed=false`;
  const fields = encodeURIComponent(
    "nextPageToken,files(id,name,mimeType,modifiedTime)",
  );
  const path =
    `files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=50&fields=${fields}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await googleApiFetch(db, userId, DRIVE_API, path, { method: "GET" }, oauth);
  if (!r.ok) {
    if (r.status === 401) {
      return { success: false, error: NOT_CONNECTED };
    }
    return { success: false, error: `Drive API Fehler: ${r.status}` };
  }
  return { success: true, data: r.data };
}

async function runSearchFiles(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  query: string,
): Promise<ToolResult> {
  const q = `fullText contains '${escapeDriveQuery(query)}' and trashed=false`;
  const fields = encodeURIComponent(
    "nextPageToken,files(id,name,mimeType,modifiedTime)",
  );
  const path =
    `files?q=${encodeURIComponent(q)}&pageSize=30&fields=${fields}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await googleApiFetch(db, userId, DRIVE_API, path, { method: "GET" }, oauth);
  if (!r.ok) {
    if (r.status === 401) {
      return { success: false, error: NOT_CONNECTED };
    }
    return { success: false, error: `Drive API Fehler: ${r.status}` };
  }
  return { success: true, data: r.data };
}

export const driveTool: Tool = {
  definition: {
    name: "drive",
    description:
      "Google Drive: Dateien in Ordner listen, Inhalt (Text/Csv/Export), neu seit Datum, Volltextsuche.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_files", "get_file_content", "list_new_files", "search_files"],
        },
        folder_id: { type: "string" },
        file_id: { type: "string" },
        since: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["action"],
    },
  },

  async execute(
    params: unknown,
    userId: string,
    db: DatabaseClient,
    _ctx?: unknown,
  ): Promise<ToolResult> {
    const gate = await assertGoogleDrive(db, userId);
    if (gate) return gate;

    let oauth: { clientId: string; clientSecret: string };
    try {
      oauth = requireGmailOAuthForTool();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }

    const parsed = parseParams(params);
    if ("error" in parsed) {
      return { success: false, error: parsed.error };
    }

    try {
      switch (parsed.action) {
        case "list_files": {
          const defFolder = await getCredential(db, userId, "drive_folder_id");
          const folder = (parsed.folder_id?.trim() || defFolder?.trim() || "root");
          return await runListFiles(
            db,
            userId,
            oauth,
            folder,
            parsed.limit ?? 50,
          );
        }
        case "get_file_content":
          return await runGetFileContent(db, userId, oauth, parsed.file_id);
        case "list_new_files":
          return await runListNewFiles(db, userId, oauth, parsed.since);
        case "search_files":
          return await runSearchFiles(db, userId, oauth, parsed.query);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "refresh_failed" || msg.includes("decrypt")) {
        return { success: false, error: NOT_CONNECTED };
      }
      return { success: false, error: msg };
    }
  },
};
