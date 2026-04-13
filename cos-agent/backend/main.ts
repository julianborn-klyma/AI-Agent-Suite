import { createRequestHandler } from "./app.ts";
import { loadEnv } from "./config/env.ts";
import { createPostgresDatabaseClient } from "./db/databaseClient.ts";
import { registerCronJobs, startAllCrons } from "./cron/index.ts";
import { AgentService } from "./services/agentService.ts";
import { AnthropicClient } from "./services/llm/anthropicClient.ts";
import { OAuthService } from "./services/oauthService.ts";
import { ToolExecutor } from "./services/tools/toolExecutor.ts";
import postgres from "postgres";

const env = await loadEnv();
registerCronJobs(env);

const sql = postgres(env.databaseUrl, { max: 10 });
const db = createPostgresDatabaseClient(sql);
const llm = new AnthropicClient(env.anthropicApiKey);
const toolExecutor = new ToolExecutor();
const agentService = new AgentService(db, llm, toolExecutor);
const oauthService = new OAuthService(db, env);

const deps = { db, agentService, sql, llm, toolExecutor, oauthService };

console.log(`cos-agent backend listening on :${env.port}`);
Deno.serve({ hostname: "0.0.0.0", port: env.port }, createRequestHandler(env, deps));
startAllCrons(deps, env);
