import type { DatabaseClient } from "../../db/databaseClient.ts";
import type postgres from "postgres";
import { calendarTool } from "./calendarTool.ts";
import { driveTool } from "./driveTool.ts";
import { gmailTool } from "./gmailTool.ts";
import { notionTool } from "./notionTool.ts";
import { slackTool } from "./slackTool.ts";
import type { ToolResult, LlmToolDefinition, Tool } from "./types.ts";
import { workspaceTasksTool } from "./workspaceTasksTool.ts";
import { workspaceWikiTool } from "./workspaceWikiTool.ts";

export class ToolExecutor {
  constructor(private readonly workspaceSql?: postgres.Sql) {}

  private tools: Map<string, Tool> = new Map([
    ["notion", notionTool],
    ["gmail", gmailTool],
    ["slack", slackTool],
    ["drive", driveTool],
    ["calendar", calendarTool],
    ["workspace_wiki", workspaceWikiTool],
    ["workspace_tasks", workspaceTasksTool],
  ]);

  async execute(
    toolName: string,
    params: unknown,
    userId: string,
    db: DatabaseClient,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool nicht gefunden: ${toolName}`,
      };
    }
    return await tool.execute(params, userId, db, { sql: this.workspaceSql });
  }

  getToolDefinitions(enabledTools: string[]): LlmToolDefinition[] {
    const out: LlmToolDefinition[] = [];
    for (const name of enabledTools) {
      const tool = this.tools.get(name);
      if (tool) {
        out.push(tool.definition);
      }
    }
    return out;
  }
}
