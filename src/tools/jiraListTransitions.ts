import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

/**
 * GET /rest/api/2/issue/{key}/transitions — prerequisite card list for
 * jira_transition_issue: {id, name, toStatus}.
 */
export function registerJiraListTransitions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_list_transitions",
    {
      title: "List issue transitions",
      description:
        "List the workflow transitions currently available for an issue " +
        "(id, name, target status). Use before jira_transition_issue.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
      },
    },
    async (args) => {
      try {
        const payload = asRecord(
          await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/transitions`),
        );
        const list = Array.isArray(payload?.transitions) ? payload.transitions : [];
        const transitions = list.map((t) => {
          const record = asRecord(t);
          return {
            id: asString(record?.id),
            name: asString(record?.name),
            toStatus: asString(asRecord(record?.to)?.name),
          };
        });
        const body = { issueKey: args.issueKey, transitions };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
