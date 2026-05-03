import type { DatabaseClient } from "../../db/databaseClient.ts";
import { decrypt, getCredential } from "./credentialHelper.ts";
import type { Tool, ToolResult } from "./types.ts";

const SLACK_API = "https://slack.com/api";

const NOT_CONNECTED = "Slack nicht verbunden.";

export type SlackAction =
  | { action: "list_channels" }
  | { action: "get_channel_history"; channel_id: string; limit?: number }
  | { action: "get_my_messages"; limit?: number }
  | { action: "search_messages"; query: string; limit?: number }
  | { action: "get_thread"; channel_id: string; thread_ts: string };

type LearningCand = {
  kind?: string;
  category?: string;
  summary?: string;
  content?: string;
  source?: string;
  confidence?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function slackPost(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<
  { ok: true; data: Record<string, unknown> } | {
    ok: false;
    httpStatus: number;
    slackError?: string;
  }
> {
  const url = `${SLACK_API}/${method}`;
  const doFetch = () =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });

  let res = await doFetch();
  if (res.status === 429) {
    const ra = res.headers.get("Retry-After");
    const sec = ra ? Math.min(Math.max(parseInt(ra, 10) || 1, 1), 60) : 1;
    await sleep(sec * 1000);
    res = await doFetch();
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    return { ok: false, httpStatus: res.status, slackError: "invalid_json" };
  }

  if (!res.ok) {
    return {
      ok: false,
      httpStatus: res.status,
      slackError: String(json.error ?? res.status),
    };
  }

  if (json.ok === false) {
    const err = String(json.error ?? "unknown_error");
    return { ok: false, httpStatus: res.status, slackError: err };
  }

  return { ok: true, data: json };
}

async function getSlackToken(
  db: DatabaseClient,
  userId: string,
): Promise<string | null> {
  const enc = await getCredential(db, userId, "slack_access_token");
  if (!enc) return null;
  try {
    return await decrypt(enc);
  } catch {
    return null;
  }
}

function parseParams(raw: unknown): SlackAction | { error: string } {
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
  if (action === "list_channels") {
    return { action: "list_channels" };
  }
  if (action === "get_channel_history") {
    if (typeof o.channel_id !== "string" || !o.channel_id) {
      return { error: "channel_id fehlt." };
    }
    let limit = 50;
    if (o.limit !== undefined) {
      const n = Number(o.limit);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        return { error: "limit muss 1–200 sein." };
      }
      limit = n;
    }
    return {
      action: "get_channel_history",
      channel_id: o.channel_id,
      limit,
    };
  }
  if (action === "get_my_messages") {
    let limit = 50;
    if (o.limit !== undefined) {
      const n = Number(o.limit);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        return { error: "limit muss 1–200 sein." };
      }
      limit = n;
    }
    return { action: "get_my_messages", limit };
  }
  if (action === "search_messages") {
    if (typeof o.query !== "string" || !o.query.trim()) {
      return { error: "query fehlt." };
    }
    let limit = 20;
    if (o.limit !== undefined) {
      const n = Number(o.limit);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return { error: "limit muss 1–100 sein." };
      }
      limit = n;
    }
    return {
      action: "search_messages",
      query: o.query.trim(),
      limit,
    };
  }
  if (action === "get_thread") {
    if (typeof o.channel_id !== "string" || !o.channel_id) {
      return { error: "channel_id fehlt." };
    }
    if (typeof o.thread_ts !== "string" || !o.thread_ts) {
      return { error: "thread_ts fehlt." };
    }
    return {
      action: "get_thread",
      channel_id: o.channel_id,
      thread_ts: o.thread_ts,
    };
  }
  return { error: `Unbekannte action: ${String(action)}` };
}

function buildLearningFromMyMessages(
  messages: {
    channel_id: string;
    channel_name?: string;
    text: string;
    ts: string;
  }[],
  myUserId: string,
): LearningCand[] {
  const out: LearningCand[] = [];
  const dmPartners = new Map<string, number>();
  for (const m of messages) {
    if (m.channel_id.startsWith("D") || m.channel_name?.startsWith("direct")) {
      dmPartners.set(m.channel_id, (dmPartners.get(m.channel_id) ?? 0) + 1);
    }
    if (m.text.length > 200) {
      out.push({
        kind: "decision_pattern",
        category: "decision_pattern",
        summary: `Lange Slack-Nachricht (${m.text.length} Zeichen) — mögliche Entscheidung/Detail.`,
        content: m.text.slice(0, 500),
        source: "slack_get_my_messages",
        confidence: 0.55,
      });
    }
  }
  for (const [ch, n] of dmPartners) {
    if (n >= 2) {
      out.push({
        kind: "relationship",
        category: "relationship",
        summary:
          `Häufiger Slack-DM-Kanal ${ch} (${n} eigene Nachrichten) — Beziehungskandidat.`,
        source: "slack_get_my_messages",
        confidence: 0.5,
      });
    }
  }
  void myUserId;
  return out;
}

async function runListChannels(
  token: string,
): Promise<ToolResult> {
  const r = await slackPost(token, "conversations.list", {
    types: "public_channel,private_channel",
    exclude_archived: true,
    limit: 200,
  });
  if (!r.ok) {
    return {
      success: false,
      error: r.slackError
        ? `Slack API Fehler: ${r.slackError}`
        : `Slack API Fehler: ${r.httpStatus}`,
    };
  }
  const channels = (r.data.channels as unknown[] ?? []).map((c) => {
    if (!c || typeof c !== "object") return c;
    const o = c as Record<string, unknown>;
    return {
      id: o.id,
      name: o.name,
      is_private: o.is_private,
    };
  });
  return { success: true, data: { channels } };
}

async function runChannelHistory(
  token: string,
  channelId: string,
  limit: number,
): Promise<ToolResult> {
  const r = await slackPost(token, "conversations.history", {
    channel: channelId,
    limit,
  });
  if (!r.ok) {
    return {
      success: false,
      error: r.slackError
        ? `Slack API Fehler: ${r.slackError}`
        : `Slack API Fehler: ${r.httpStatus}`,
    };
  }
  const msgs = (r.data.messages as unknown[] ?? []).map((m) => {
    if (!m || typeof m !== "object") return m;
    const o = m as Record<string, unknown>;
    return {
      user: o.user,
      text: o.text,
      ts: o.ts,
      thread_ts: o.thread_ts,
    };
  });
  return { success: true, data: { messages: msgs } };
}

async function runGetMyMessages(
  token: string,
  maxMessages: number,
): Promise<ToolResult> {
  const auth = await slackPost(token, "auth.test", {});
  if (!auth.ok) {
    return {
      success: false,
      error: auth.slackError
        ? `Slack API Fehler: ${auth.slackError}`
        : `Slack API Fehler: ${auth.httpStatus}`,
    };
  }
  const userId = String((auth.data as { user_id?: string }).user_id ?? "");
  if (!userId) {
    return { success: false, error: "Slack API Fehler: missing_user" };
  }

  const list = await slackPost(token, "conversations.list", {
    types: "public_channel,private_channel,im,mpim",
    exclude_archived: true,
    limit: 25,
  });
  if (!list.ok) {
    return {
      success: false,
      error: list.slackError
        ? `Slack API Fehler: ${list.slackError}`
        : `Slack API Fehler: ${list.httpStatus}`,
    };
  }
  const channels = (list.data.channels as Record<string, unknown>[] ?? []);
  const collected: {
    channel_id: string;
    channel_name?: string;
    text: string;
    ts: string;
  }[] = [];

  for (const ch of channels) {
    const id = String(ch.id ?? "");
    if (!id) continue;
    const name = typeof ch.name === "string" ? ch.name : undefined;
    const hist = await slackPost(token, "conversations.history", {
      channel: id,
      limit: 40,
    });
    if (!hist.ok) continue;
    const msgs = hist.data.messages as Record<string, unknown>[] ?? [];
    for (const m of msgs) {
      if (String(m.user ?? "") !== userId) continue;
      const text = String(m.text ?? "").trim();
      if (!text) continue;
      collected.push({
        channel_id: id,
        channel_name: name,
        text,
        ts: String(m.ts ?? ""),
      });
      if (collected.length >= maxMessages) break;
    }
    if (collected.length >= maxMessages) break;
  }

  const learningCandidates = buildLearningFromMyMessages(collected, userId);
  return {
    success: true,
    data: {
      user_id: userId,
      messages: collected,
      learningCandidates,
    },
  };
}

async function runSearchMessages(
  token: string,
  query: string,
  limit: number,
): Promise<ToolResult> {
  const r = await slackPost(token, "search.messages", {
    query,
    count: limit,
  });
  if (!r.ok) {
    return {
      success: false,
      error: r.slackError
        ? `Slack API Fehler: ${r.slackError}`
        : `Slack API Fehler: ${r.httpStatus}`,
    };
  }
  const matches = ((r.data as { messages?: { matches?: unknown[] } })
    .messages?.matches ?? []) as Record<string, unknown>[];
  const slim = matches.map((x) => ({
    channel: x.channel,
    text: x.text,
    ts: x.ts,
    permalink: x.permalink,
  }));
  return { success: true, data: { matches: slim } };
}

async function runGetThread(
  token: string,
  channelId: string,
  threadTs: string,
): Promise<ToolResult> {
  const r = await slackPost(token, "conversations.replies", {
    channel: channelId,
    ts: threadTs,
  });
  if (!r.ok) {
    return {
      success: false,
      error: r.slackError
        ? `Slack API Fehler: ${r.slackError}`
        : `Slack API Fehler: ${r.httpStatus}`,
    };
  }
  const msgs = (r.data.messages as unknown[] ?? []).map((m) => {
    if (!m || typeof m !== "object") return m;
    const o = m as Record<string, unknown>;
    return { user: o.user, text: o.text, ts: o.ts };
  });
  return { success: true, data: { messages: msgs } };
}

export const slackTool: Tool = {
  definition: {
    name: "slack",
    description:
      "Slack: Kanäle listen, Verlauf, eigene Nachrichten, Suche, Thread.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list_channels",
            "get_channel_history",
            "get_my_messages",
            "search_messages",
            "get_thread",
          ],
        },
        channel_id: { type: "string" },
        thread_ts: { type: "string" },
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
    const token = await getSlackToken(db, userId);
    if (!token) {
      return { success: false, error: NOT_CONNECTED };
    }
    const parsed = parseParams(params);
    if ("error" in parsed) {
      return { success: false, error: parsed.error };
    }

    switch (parsed.action) {
      case "list_channels":
        return await runListChannels(token);
      case "get_channel_history":
        return await runChannelHistory(
          token,
          parsed.channel_id,
          parsed.limit ?? 50,
        );
      case "get_my_messages":
        return await runGetMyMessages(token, parsed.limit ?? 50);
      case "search_messages":
        return await runSearchMessages(token, parsed.query, parsed.limit ?? 20);
      case "get_thread":
        return await runGetThread(token, parsed.channel_id, parsed.thread_ts);
    }
  },
};
