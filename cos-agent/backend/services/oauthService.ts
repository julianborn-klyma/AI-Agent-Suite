import type { AppEnv } from "../config/env.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import { encrypt } from "./tools/credentialHelper.ts";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const NOTION_ME = "https://api.notion.com/v1/users/me";
const NOTION_VERSION = "2022-06-28";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

export class OAuthService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly env: AppEnv,
  ) {}

  async createState(userId: string, provider: string): Promise<string> {
    const state = crypto.randomUUID();
    await this.db.insertOauthState({ state, userId, provider });
    return state;
  }

  async consumeState(
    state: string,
  ): Promise<{ userId: string; provider: string } | null> {
    return await this.db.consumeOauthState(state);
  }

  buildGoogleAuthUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.env.googleClientId,
      redirect_uri: this.env.googleRedirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${GOOGLE_AUTH}?${p.toString()}`;
  }

  async exchangeGoogleCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date;
  }> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.env.googleClientId,
      client_secret: this.env.googleClientSecret,
      redirect_uri: this.env.googleRedirectUri,
    });
    const res = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    let j: Record<string, unknown> = {};
    try {
      j = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      throw new Error(`Google Token-Antwort ungültig: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(
        `Google Token-Austausch fehlgeschlagen: HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
    const accessToken = typeof j.access_token === "string"
      ? j.access_token
      : "";
    if (!accessToken) {
      throw new Error("Google Token-Antwort ohne access_token.");
    }
    const refreshToken = typeof j.refresh_token === "string"
      ? j.refresh_token
      : null;
    const expSec = Number(j.expires_in ?? 3600);
    const expiresAt = new Date(
      Date.now() + (Number.isFinite(expSec) ? expSec : 3600) * 1000,
    );
    return { accessToken, refreshToken, expiresAt };
  }

  async saveGoogleTokens(
    userId: string,
    tokens: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date;
    },
  ): Promise<void> {
    const encAccess = await encrypt(tokens.accessToken);
    await this.db.upsertUserContext({
      userId,
      key: "gmail_access_token",
      value: encAccess,
    });
    if (tokens.refreshToken) {
      const encRt = await encrypt(tokens.refreshToken);
      await this.db.upsertUserContext({
        userId,
        key: "gmail_refresh_token",
        value: encRt,
      });
    }
    await this.db.upsertUserContext({
      userId,
      key: "gmail_token_expires_at",
      value: tokens.expiresAt.toISOString(),
    });
    await this.db.upsertUserContext({
      userId,
      key: "google_connected",
      value: "true",
    });
  }

  private async validateNotionToken(token: string): Promise<{ name: string }> {
    const res = await fetch(NOTION_ME, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    const text = await res.text();
    if (res.status === 401) {
      throw new Error("Ungültiger Notion Token");
    }
    if (!res.ok) {
      throw new Error(`Notion API Fehler: HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    let j: Record<string, unknown> = {};
    try {
      j = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      throw new Error("Notion-Antwort ungültig.");
    }
    const name = typeof j.name === "string" && j.name.trim()
      ? j.name.trim()
      : "Integration";
    return { name };
  }

  async saveNotionToken(userId: string, token: string): Promise<void> {
    const { name } = await this.validateNotionToken(token.trim());
    const enc = await encrypt(token.trim());
    await this.db.upsertUserContext({
      userId,
      key: "notion_token",
      value: enc,
    });
    await this.db.upsertUserContext({
      userId,
      key: "notion_connected",
      value: "true",
    });
    await this.db.upsertUserContext({
      userId,
      key: "notion_workspace_user",
      value: name,
    });
  }

  async getConnectionStatus(userId: string): Promise<{
    google: boolean;
    notion: boolean;
    notionWorkspaceUser?: string;
  }> {
    const rows = await this.db.listUserContexts(userId);
    const m = new Map(rows.map((r) => [r.key, r.value]));
    const google = m.get("google_connected") === "true";
    const notion = m.get("notion_connected") === "true";
    const notionWorkspaceUser = m.get("notion_workspace_user")?.trim() ||
      undefined;
    return { google, notion, notionWorkspaceUser };
  }

  async disconnectProvider(
    userId: string,
    provider: "google" | "notion",
  ): Promise<void> {
    if (provider === "google") {
      await this.db.deleteUserContextsByKeys(userId, [
        "gmail_access_token",
        "gmail_refresh_token",
        "gmail_token_expires_at",
        "google_connected",
      ]);
      return;
    }
    await this.db.deleteUserContextsByKeys(userId, [
      "notion_token",
      "notion_connected",
      "notion_workspace_user",
    ]);
  }
}
