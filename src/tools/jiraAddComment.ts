import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";
import { commentBody } from "./writeFields.js";

/**
 * POST /rest/api/2/issue/{key}/comment — plain string body on Server/DC,
 * ADF document on Cloud (see writeFields.commentBody).
 */
export function registerJiraAddComment(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_add_comment",
    {
      title: "Add Jira comment",
      description:
        "Add a comment to an issue. Returns {id, created}. The body format " +
        "(wiki string vs ADF) is chosen automatically per deployment.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        comment: z.string().min(1).describe("Comment text"),
      },
    },
    async (args) => {
      try {
        const created = asRecord(
          await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/comment`, {
            method: "POST",
            body: { body: await commentBody(ctx, args.comment) },
          }),
        );
        const body = {
          id: asString(created?.id) ?? null,
          created: asString(created?.created),
        };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
