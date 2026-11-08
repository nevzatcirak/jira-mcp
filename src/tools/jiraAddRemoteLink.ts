import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

/** Body for POST /issue/{key}/remotelink (exported for tests). */
export function remoteLinkBody(url: string, title?: string): Record<string, unknown> {
  const object: Record<string, unknown> = { url };
  if (title !== undefined) object.title = title;
  return { object };
}

/**
 * POST /rest/api/2/issue/{key}/remotelink — attach an external URL to an
 * issue. No application link required. Response: {id, self}.
 */
export function registerJiraAddRemoteLink(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_add_remote_link",
    {
      title: "Add remote link",
      description:
        "Attach an external URL (with optional title) to an issue as a " +
        "remote link. Returns {id, self}.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        url: z.string().min(1).describe("Target URL of the remote resource"),
        title: z.string().min(1).optional().describe("Display title for the link"),
      },
    },
    async (args) => {
      try {
        const created = asRecord(
          await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/remotelink`, {
            method: "POST",
            body: remoteLinkBody(args.url, args.title),
          }),
        );
        const result = {
          id: asString(created?.id) ?? null,
          self: asString(created?.self),
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
