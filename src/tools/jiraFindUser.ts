import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";
import { projectUserCard, searchUsers } from "./writeFields.js";

/**
 * GET /rest/api/2/user/search?query=... — user lookup across deployments
 * (Server/DC receives `username=`, Cloud receives `query=`; both are sent).
 */
export function registerJiraFindUser(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_find_user",
    {
      title: "Find Jira users",
      description:
        "Search users by username or display name. Returns compact user cards " +
        "{accountId, name, displayName, email, active}. Use to resolve assignees " +
        "before jira_create_issue / jira_update_issue / jira_assign_issue.",
      inputSchema: {
        query: z.string().min(1).describe("Username or (partial) display name to search for"),
        maxResults: z.number().int().min(1).max(1000).default(10).describe("Maximum users to return"),
        startAt: z.number().int().min(0).default(0).describe("Pagination offset"),
      },
    },
    async (args) => {
      try {
        const users = await searchUsers(ctx, args.query, args.maxResults, args.startAt);
        const body = {
          query: args.query,
          startAt: args.startAt,
          total: users.length,
          users: users.map((u) => projectUserCard(u)),
        };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
