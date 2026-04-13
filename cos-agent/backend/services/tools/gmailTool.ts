import { requireGmailOAuthForTool } from "../../config/env.ts";
import type { DatabaseClient } from "../../db/databaseClient.ts";
import { decrypt, encrypt, getCredential } from "./credentialHelper.ts";
import type { Tool, ToolResult } from "./types.ts";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

const AUTH_EXPIRED =
  "Gmail-Auth abgelaufen. Bitte neu verbinden.";

type GmailAction =
  | { action: "list_unread"; max_results?: number }
  | { action: "summarize_thread"; thread_id: string }
  | {
    action: "create_draft";
    to: string;
    subject: string;
    body: string;
  }
  | { action: "flag_email"; message_id: string; label_ids?: string[] };

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function headerMap(
  headers: { name?: string; value?: string }[] | undefined,
): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of headers ?? []) {
    if (h.name) m[h.name.toLowerCase()] = h.value ?? "";
  }
  return m;
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!res.ok || !j.access_token) {
    throw new Error("refresh_failed");
  }
  return j.access_token;
}

async function gmailFetch(
  db: DatabaseClient,
  userId: string,
  path: string,
  init: RequestInit,
  oauth: { clientId: string; clientSecret: string },
): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  const url = `${GMAIL_API}/${path}`;

  const doFetch = async (bearer: string): Promise<Response> => {
    return await fetch(url, {
      ...init,
      headers: {
        ...flatHeaders(init.headers),
        Authorization: `Bearer ${bearer}`,
      },
    });
  };

  const accessEnc = await getCredential(db, userId, "gmail_access_token");
  if (!accessEnc) {
    return { ok: false, status: 401 };
  }

  let bearer: string;
  try {
    bearer = await decrypt(accessEnc);
  } catch {
    return { ok: false, status: 401 };
  }

  let res = await doFetch(bearer);
  if (res.status === 401) {
    const rtEnc = await getCredential(db, userId, "gmail_refresh_token");
    if (!rtEnc) {
      return { ok: false, status: 401 };
    }
    let rt: string;
    try {
      rt = await decrypt(rtEnc);
    } catch {
      return { ok: false, status: 401 };
    }
    try {
      bearer = await refreshAccessToken(rt, oauth.clientId, oauth.clientSecret);
    } catch {
      return { ok: false, status: 401 };
    }
    const newEnc = await encrypt(bearer);
    await db.upsertUserContext({
      userId,
      key: "gmail_access_token",
      value: newEnc,
    });
    res = await doFetch(bearer);
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  try {
    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, status: res.status };
  }
}

function flatHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const o: Record<string, string> = {};
    h.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }
  if (Array.isArray(h)) {
    return Object.fromEntries(h);
  }
  return { ...h };
}

function parseParams(raw: unknown): GmailAction | { error: string } {
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
  if (action === "list_unread") {
    let max_results = 10;
    if (o.max_results !== undefined) {
      const n = Number(o.max_results);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        return { error: "max_results muss 1–50 sein." };
      }
      max_results = n;
    }
    return { action: "list_unread", max_results };
  }
  if (action === "summarize_thread") {
    if (typeof o.thread_id !== "string" || !o.thread_id) {
      return { error: "thread_id fehlt." };
    }
    return { action: "summarize_thread", thread_id: o.thread_id };
  }
  if (action === "create_draft") {
    if (typeof o.to !== "string" || !o.to) return { error: "to fehlt." };
    if (typeof o.subject !== "string") return { error: "subject fehlt." };
    if (typeof o.body !== "string") return { error: "body fehlt." };
    return {
      action: "create_draft",
      to: o.to,
      subject: o.subject,
      body: o.body,
    };
  }
  if (action === "flag_email") {
    if (typeof o.message_id !== "string" || !o.message_id) {
      return { error: "message_id fehlt." };
    }
    const lids = Array.isArray(o.label_ids)
      ? o.label_ids.filter((x): x is string => typeof x === "string")
      : undefined;
    return {
      action: "flag_email",
      message_id: o.message_id,
      label_ids: lids,
    };
  }
  return { error: `Unbekannte action: ${String(action)}` };
}

async function runListUnread(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  maxResults: number,
): Promise<ToolResult> {
  const list = await gmailFetch(
    db,
    userId,
    `users/me/messages?q=is:unread&maxResults=${maxResults}`,
    { method: "GET" },
    oauth,
  );
  if (!list.ok) {
    if (list.status === 401) {
      return { success: false, error: AUTH_EXPIRED };
    }
    return { success: false, error: `Gmail API Fehler: ${list.status}` };
  }
  const data = list.data as { messages?: { id: string }[] };
  const ids = (data.messages ?? []).map((m) => m.id).filter(Boolean);
  const out: {
    id: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
  }[] = [];

  for (const id of ids) {
    const msg = await gmailFetch(
      db,
      userId,
      `users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { method: "GET" },
      oauth,
    );
    if (!msg.ok) continue;
    const m = msg.data as {
      id?: string;
      snippet?: string;
      payload?: { headers?: { name?: string; value?: string }[] };
    };
    const hm = headerMap(m.payload?.headers);
    out.push({
      id: m.id ?? id,
      subject: hm["subject"] ?? "",
      from: hm["from"] ?? "",
      date: hm["date"] ?? "",
      snippet: m.snippet ?? "",
    });
  }
  return { success: true, data: out };
}

async function runSummarizeThread(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  threadId: string,
): Promise<ToolResult> {
  const r = await gmailFetch(
    db,
    userId,
    `users/me/threads/${threadId}?format=full`,
    { method: "GET" },
    oauth,
  );
  if (!r.ok) {
    if (r.status === 401) return { success: false, error: AUTH_EXPIRED };
    return { success: false, error: `Gmail API Fehler: ${r.status}` };
  }
  const t = r.data as {
    messages?: {
      snippet?: string;
      payload?: { headers?: { name?: string; value?: string }[] };
    }[];
  };
  const msgs = t.messages ?? [];
  const participants = new Set<string>();
  let subject = "";
  for (const m of msgs) {
    const hm = headerMap(m.payload?.headers);
    if (hm["subject"] && !subject) subject = hm["subject"];
    if (hm["from"]) participants.add(hm["from"]);
    if (hm["to"]) participants.add(hm["to"]);
  }
  const latest = msgs[msgs.length - 1];
  return {
    success: true,
    data: {
      subject,
      participants: [...participants],
      message_count: msgs.length,
      latest_snippet: latest?.snippet ?? "",
    },
  };
}

async function runCreateDraft(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  to: string,
  subject: string,
  body: string,
): Promise<ToolResult> {
  const rfc = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const raw = bytesToBase64Url(new TextEncoder().encode(rfc));
  const r = await gmailFetch(db, userId, "users/me/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  }, oauth);
  if (!r.ok) {
    if (r.status === 401) return { success: false, error: AUTH_EXPIRED };
    return { success: false, error: `Gmail API Fehler: ${r.status}` };
  }
  return {
    success: true,
    data: { id: (r.data as { id?: string }).id, message: (r.data as { message?: unknown }).message },
  };
}

async function runFlagEmail(
  db: DatabaseClient,
  userId: string,
  oauth: { clientId: string; clientSecret: string },
  messageId: string,
  labelIds: string[],
): Promise<ToolResult> {
  const r = await gmailFetch(
    db,
    userId,
    `users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: labelIds }),
    },
    oauth,
  );
  if (!r.ok) {
    if (r.status === 401) return { success: false, error: AUTH_EXPIRED };
    return { success: false, error: `Gmail API Fehler: ${r.status}` };
  }
  return { success: true, data: { ok: true } };
}

export const gmailTool: Tool = {
  definition: {
    name: "gmail",
    description:
      "Gmail: ungelesene Mails, Thread-Zusammenfassung, Entwurf (RFC2822-Rohinhalt intern), Label setzen.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_unread", "summarize_thread", "create_draft", "flag_email"],
        },
        thread_id: { type: "string" },
        max_results: { type: "number" },
        message_id: { type: "string" },
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        label_ids: { type: "array", items: { type: "string" } },
      },
      required: ["action"],
    },
  },

  async execute(
    params: unknown,
    userId: string,
    db: DatabaseClient,
  ): Promise<ToolResult> {
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
        case "list_unread":
          return await runListUnread(
            db,
            userId,
            oauth,
            parsed.max_results ?? 10,
          );
        case "summarize_thread":
          return await runSummarizeThread(db, userId, oauth, parsed.thread_id);
        case "create_draft":
          return await runCreateDraft(
            db,
            userId,
            oauth,
            parsed.to,
            parsed.subject,
            parsed.body,
          );
        case "flag_email": {
          const lids = parsed.label_ids?.length
            ? parsed.label_ids
            : ["STARRED"];
          return await runFlagEmail(
            db,
            userId,
            oauth,
            parsed.message_id,
            lids,
          );
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "refresh_failed" || msg.includes("decrypt")) {
        return { success: false, error: AUTH_EXPIRED };
      }
      return { success: false, error: msg };
    }
  },
};
