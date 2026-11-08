import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

/**
 * GET /rest/api/2/myself — the authenticated user. Cloud: accountId (name/key
 * are empty legacy strings); Server/DC: name/key. emailAddress is the user's
 * own address (visibility rules of others do not apply here).
 */
export function registerJiraGetMyself(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_get_myself",
    {
      title: "Get current user",
      description:
        "Return the authenticated Jira user: accountId, name (Server/DC), " +
        "displayName, emailAddress, active, timeZone.",
      inputSchema: {},
    },
    async () => {
      try {
        const raw = asRecord(await ctx.client.request("api/2/myself")) ?? {};
        const nonEmpty = (v: unknown): string | null => {
          const s = asString(v);
          return s && s.length > 0 ? s : null;
        };
        const body = {
          accountId: nonEmpty(raw?.accountId),
          name: nonEmpty(raw?.name),
          displayName: nonEmpty(raw?.displayName),
          emailAddress: nonEmpty(raw?.emailAddress),
          active: raw?.active === true,
          timeZone: nonEmpty(raw?.timeZone),
        };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
