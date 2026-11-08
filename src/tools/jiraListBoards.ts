import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pageMeta, extractItems, asEnvelope } from "../agile/agileClient.js";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

const inputSchema = {
  startAt: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Index of the first board to return (pagination offset)"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum number of boards to return"),
  projectKeyOrId: z
    .string()
    .min(1)
    .optional()
    .describe("Limit results to boards of one project (project key or numeric id)"),
  type: z
    .string()
    .min(1)
    .optional()
    .describe("Filter by board type: 'scrum' or 'kanban'"),
  name: z.string().min(1).optional().describe("Filter boards by (partial) name"),
};

/**
 * GET /rest/agile/1.0/board — deployment-agnostic board discovery. Boards are
 * discovered by name/type/project; nothing about boards is hardcoded.
 */
export function registerJiraListBoards(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_list_boards",
    {
      title: "List Jira boards",
      description:
        "List Agile boards, optionally filtered by project, type (scrum/kanban) or name. " +
        "Returns compact board cards with pagination metadata.",
      inputSchema,
    },
    async (args) => {
      try {
        const payload = asEnvelope(
          await ctx.agile.request("board", {
            query: {
              startAt: args.startAt,
              maxResults: args.maxResults,
              projectKeyOrId: args.projectKeyOrId,
              type: args.type,
              name: args.name,
            },
          }),
        );
        const values = extractItems(payload, ["values", "issues"]);
        const meta = pageMeta(payload, args.startAt, args.maxResults, values.length);
        const body = { ...meta, boards: values.map(projectBoard) };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}

function projectBoard(board: unknown): Record<string, unknown> {
  const record = asRecord(board);
  const location = asRecord(record?.location);
  const out: Record<string, unknown> = {
    id: typeof record?.id === "number" ? record.id : null,
    name: asString(record?.name),
    type: asString(record?.type),
  };
  // `location` exists on Jira Software 7.x+/Cloud; absent on very old versions.
  if (location) {
    out.location = {
      projectKey: asString(location.projectKey),
      projectName: asString(location.projectName),
    };
  }
  return out;
}
