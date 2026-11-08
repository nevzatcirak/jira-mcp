import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";

/**
 * POST /rest/api/2/issueLink — link two issues with a named link type.
 * Jira requires type + inwardIssue + outwardIssue (201, empty body).
 */
export function registerJiraLinkIssues(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_link_issues",
    {
      title: "Link Jira issues",
      description:
        "Create a link between two issues (e.g. type 'Relates', 'Blocks', " +
        "'Duplicates'). Jira's issueLink endpoint requires BOTH inwardIssue and " +
        "outwardIssue keys plus the link type name.",
      inputSchema: {
        linkType: z
          .string()
          .min(1)
          .describe("Link type name, e.g. 'Relates', 'Blocks', 'Duplicates'"),
        inwardIssueKey: z
          .string()
          .min(1)
          .optional()
          .describe("The inward side of the link (e.g. the blocked issue for 'Blocks')"),
        outwardIssueKey: z
          .string()
          .min(1)
          .optional()
          .describe("The outward side of the link (e.g. the blocking issue)"),
      },
    },
    async (args) => {
      try {
        if (!args.inwardIssueKey && !args.outwardIssueKey) {
          throw new JiraMcpError({
            code: "INVALID_ARGUMENT",
            message: "At least one of inwardIssueKey / outwardIssueKey must be provided",
            hint: "Jira's issueLink endpoint actually requires BOTH issue keys; fetch the other side first.",
          });
        }
        const body: Record<string, unknown> = { type: { name: args.linkType } };
        if (args.inwardIssueKey) body.inwardIssue = { key: args.inwardIssueKey };
        if (args.outwardIssueKey) body.outwardIssue = { key: args.outwardIssueKey };
        await ctx.client.request("api/2/issueLink", { method: "POST", body });
        const text =
          args.inwardIssueKey && args.outwardIssueKey
            ? `Linked ${args.inwardIssueKey} -> ${args.outwardIssueKey} (type: ${args.linkType})`
            : `Created link (type: ${args.linkType}, inward: ${args.inwardIssueKey ?? "-"}, outward: ${args.outwardIssueKey ?? "-"})`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
