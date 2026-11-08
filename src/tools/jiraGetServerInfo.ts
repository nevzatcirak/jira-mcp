import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

/**
 * GET /rest/api/2/serverInfo -> trimmed info. Also warms the InstanceProfile
 * cache so subsequent calls skip deployment-type detection.
 */
export function registerJiraGetServerInfo(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_get_server_info",
    {
      title: "Get Jira server info",
      description:
        "Returns trimmed information about the connected Jira instance: version, " +
        "deploymentType, buildNumber, serverTitle, scmInfo. Also caches the " +
        "deployment type used for authentication.",
      inputSchema: {},
    },
    async () => {
      try {
        const raw = asRecord(await ctx.client.request("api/2/serverInfo")) ?? {};
        ctx.profile.cacheServerInfo(raw);
        const body = {
          version: asString(raw.version),
          deploymentType: asString(raw.deploymentType),
          buildNumber: raw.buildNumber ?? null,
          serverTitle: asString(raw.serverTitle),
          scmInfo: asString(raw.scmInfo),
        };
        return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
