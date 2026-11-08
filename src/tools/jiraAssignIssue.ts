import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";
import { resolveUserFieldValue, unassignBody } from "./writeFields.js";

/**
 * PUT /rest/api/2/issue/{key}/assignee — assign or unassign ("-none-").
 * Permission failures (e.g. missing Assign Issue permission, HTTP 403)
 * propagate as structured JIRA_403 errors untouched.
 */
export function registerJiraAssignIssue(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_assign_issue",
    {
      title: "Assign Jira issue",
      description:
        "Assign an issue to a user (username on Server/DC; accountId or user name " +
        "on Cloud — names are resolved via user search) or unassign with '-none-'.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        assignee: z
          .string()
          .min(1)
          .describe("Username (Server/DC), accountId (Cloud), or '-none-' to unassign"),
      },
    },
    async (args) => {
      try {
        let body: Record<string, unknown>;
        let assignee: string | null;
        if (args.assignee.trim() === "-none-") {
          body = await unassignBody(ctx);
          assignee = null;
        } else {
          body = await resolveUserFieldValue(ctx, args.assignee);
          assignee = args.assignee;
        }
        await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/assignee`, {
          method: "PUT",
          body,
        });
        const result = { key: args.issueKey, assignee };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
