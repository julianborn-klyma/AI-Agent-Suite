import type { DatabaseClient } from "../../db/databaseClient.ts";
import { decrypt, encrypt, getCredential } from "./credentialHelper.ts";

export async function refreshGoogleAccessToken(
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

/**
 * Authentifizierter Fetch gegen eine Google-API-Base (z. B. Drive v3, Calendar v3).
 * Token-Refresh wie gmailTool.
 */
export async function googleApiFetch(
  db: DatabaseClient,
  userId: string,
  baseUrl: string,
  path: string,
  init: RequestInit,
  oauth: { clientId: string; clientSecret: string },
): Promise<
  { ok: true; data: unknown; response: Response } | {
    ok: false;
    status: number;
    response: Response;
  }
> {
  const url = `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

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
    return { ok: false, status: 401, response: new Response("", { status: 401 }) };
  }

  let bearer: string;
  try {
    bearer = await decrypt(accessEnc);
  } catch {
    return { ok: false, status: 401, response: new Response("", { status: 401 }) };
  }

  let res = await doFetch(bearer);
  if (res.status === 401) {
    const rtEnc = await getCredential(db, userId, "gmail_refresh_token");
    if (!rtEnc) {
      return { ok: false, status: 401, response: res };
    }
    let rt: string;
    try {
      rt = await decrypt(rtEnc);
    } catch {
      return { ok: false, status: 401, response: res };
    }
    try {
      bearer = await refreshGoogleAccessToken(
        rt,
        oauth.clientId,
        oauth.clientSecret,
      );
    } catch {
      return { ok: false, status: 401, response: res };
    }
    const newEnc = await encrypt(bearer);
    await db.upsertUserContext({
      userId,
      key: "gmail_access_token",
      value: newEnc,
    });
    res = await doFetch(bearer);
  }

  if (!res.ok) {
    try {
      await res.text();
    } catch {
      /* Body bereits verbraucht oder nicht lesbar */
    }
    return { ok: false, status: res.status, response: res };
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const text = await res.text();
    try {
      return {
        ok: true,
        data: text ? JSON.parse(text) : {},
        response: res,
      };
    } catch {
      return { ok: false, status: res.status, response: res };
    }
  }
  if (
    ct.startsWith("text/") || ct.includes("csv") ||
    ct.includes("javascript") || ct.includes("xml")
  ) {
    const text = await res.text();
    return { ok: true, data: text, response: res };
  }
  const buf = await res.arrayBuffer();
  return { ok: true, data: buf, response: res };
}
