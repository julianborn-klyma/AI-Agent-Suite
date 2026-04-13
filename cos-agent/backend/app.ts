import type { AppEnv } from "./config/env.ts";
import type { AppDependencies } from "./app_deps.ts";
import { corsHeaders, preflightResponse } from "./middleware/cors.ts";
import {
  handleChatHistoryGet,
  handleChatPost,
  handleChatSessionDelete,
  handleChatSessionsGet,
} from "./routes/chat.ts";
import {
  handleAdminConfigAssign,
  handleAdminConfigDelete,
  handleAdminConfigPatch,
  handleAdminConfigsCreate,
  handleAdminConfigsList,
} from "./routes/admin/configs.ts";
import { handleAdminCostsGet } from "./routes/admin/costs.ts";
import {
  handleAdminSchedulesList,
  handleAdminUserSchedulePut,
} from "./routes/admin/schedules.ts";
import {
  handleAdminUserContextGet,
  handleAdminUserContextKeyDelete,
  handleAdminUserContextPut,
  handleAdminUserDelete,
  handleAdminUserPatch,
  handleAdminUsersCreate,
  handleAdminUsersList,
} from "./routes/admin/users.ts";
import { handleAuthLogin } from "./routes/auth.ts";
import {
  handleConnectionsDelete,
  handleConnectionsGet,
  handleGoogleAuthStart,
  handleGoogleCallback,
  handleNotionConnectPut,
} from "./routes/connections.ts";
import { handleHealth } from "./routes/health.ts";
import { handleMe } from "./routes/me.ts";
import { jsonResponse } from "./routes/json.ts";

function withCors(req: Request, env: AppEnv, res: Response): Response {
  const extra = corsHeaders(req, env);
  if (extra === null) {
    return new Response("CORS nicht erlaubt", { status: 403 });
  }
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

function missingDepsResponse(): Response {
  return jsonResponse(
    { error: "Server-Konfiguration: Agent-Dependencies fehlen." },
    { status: 503 },
  );
}

async function dispatchAdmin(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  pathname: string,
): Promise<Response | null> {
  const ctxKey = pathname.match(
    /^\/api\/admin\/users\/([^/]+)\/context\/([^/]+)$/,
  );
  if (ctxKey && req.method === "DELETE") {
    return handleAdminUserContextKeyDelete(
      req,
      env,
      deps,
      ctxKey[1],
      decodeURIComponent(ctxKey[2]),
    );
  }

  const ctx = pathname.match(/^\/api\/admin\/users\/([^/]+)\/context$/);
  if (ctx) {
    if (req.method === "GET") {
      return handleAdminUserContextGet(req, env, deps, ctx[1]);
    }
    if (req.method === "PUT") {
      return handleAdminUserContextPut(req, env, deps, ctx[1]);
    }
  }

  const sched = pathname.match(/^\/api\/admin\/users\/([^/]+)\/schedule$/);
  if (sched && req.method === "PUT") {
    return handleAdminUserSchedulePut(req, env, deps, sched[1]);
  }

  const userPath = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userPath) {
    if (req.method === "PATCH") {
      return handleAdminUserPatch(req, env, deps, userPath[1]);
    }
    if (req.method === "DELETE") {
      return handleAdminUserDelete(req, env, deps, userPath[1]);
    }
  }

  if (pathname === "/api/admin/users") {
    if (req.method === "GET") return handleAdminUsersList(req, env, deps);
    if (req.method === "POST") return handleAdminUsersCreate(req, env, deps);
  }

  const assign = pathname.match(
    /^\/api\/admin\/configs\/([^/]+)\/assign\/([^/]+)$/,
  );
  if (assign && req.method === "POST") {
    return handleAdminConfigAssign(req, env, deps, assign[1], assign[2]);
  }

  const cfgPath = pathname.match(/^\/api\/admin\/configs\/([^/]+)$/);
  if (cfgPath) {
    if (req.method === "PATCH") {
      return handleAdminConfigPatch(req, env, deps, cfgPath[1]);
    }
    if (req.method === "DELETE") {
      return handleAdminConfigDelete(req, env, deps, cfgPath[1]);
    }
  }

  if (pathname === "/api/admin/configs") {
    if (req.method === "GET") return handleAdminConfigsList(req, env, deps);
    if (req.method === "POST") return handleAdminConfigsCreate(req, env, deps);
  }

  if (pathname === "/api/admin/schedules" && req.method === "GET") {
    return handleAdminSchedulesList(req, env, deps);
  }

  if (pathname === "/api/admin/costs" && req.method === "GET") {
    return handleAdminCostsGet(req, env, deps);
  }

  return null;
}

export function createRequestHandler(
  env: AppEnv,
  deps?: AppDependencies,
) {
  return async (req: Request): Promise<Response> => {
    const pre = preflightResponse(req, env);
    if (pre) return pre;

    const url = new URL(req.url);
    let res: Response;

    const sessionDelete = url.pathname.match(
      /^\/api\/chat\/sessions\/([^/]+)$/,
    );

    if (url.pathname === "/health") {
      res = await handleHealth(req, env);
    } else if (url.pathname === "/api/auth/login" && req.method === "POST") {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleAuthLogin(req, env, deps);
      }
    } else if (url.pathname === "/api/me") {
      res = await handleMe(req, env, deps);
    } else if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleChatPost(req, env, deps);
      }
    } else if (url.pathname === "/api/chat/history" && req.method === "GET") {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleChatHistoryGet(req, env, deps);
      }
    } else if (url.pathname === "/api/chat/sessions" && req.method === "GET") {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleChatSessionsGet(req, env, deps);
      }
    } else if (sessionDelete && req.method === "DELETE") {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleChatSessionDelete(
          req,
          env,
          deps,
          sessionDelete[1] as string,
        );
      }
    } else if (
      url.pathname === "/api/auth/google/callback" && req.method === "GET"
    ) {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleGoogleCallback(req, env, deps);
      }
    } else if (url.pathname === "/api/auth/google" && req.method === "GET") {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleGoogleAuthStart(req, env, deps);
      }
    } else if (
      url.pathname === "/api/connections/notion" && req.method === "PUT"
    ) {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleNotionConnectPut(req, env, deps);
      }
    } else if (
      url.pathname.match(/^\/api\/connections\/([^/]+)$/) &&
      req.method === "DELETE"
    ) {
      const connDel = url.pathname.match(/^\/api\/connections\/([^/]+)$/);
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleConnectionsDelete(
          req,
          env,
          deps,
          decodeURIComponent(connDel![1]!),
        );
      }
    } else if (url.pathname === "/api/connections" && req.method === "GET") {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        res = await handleConnectionsGet(req, env, deps);
      }
    } else if (url.pathname.startsWith("/api/admin/")) {
      if (!deps) {
        res = missingDepsResponse();
      } else {
        const adminRes = await dispatchAdmin(req, env, deps, url.pathname);
        res = adminRes ?? new Response("Not Found", { status: 404 });
      }
    } else {
      res = new Response("Not Found", { status: 404 });
    }
    return withCors(req, env, res);
  };
}
