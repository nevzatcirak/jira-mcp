import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pageMeta, extractItems, asEnvelope } from "../agile/agileClient.js";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

const inputSchema = {
  boardId: z.number().int().min(1).describe("Agile board id (from jira_list_boards)"),
  startAt: z.number().int().min(0).default(0).describe("Pagination offset"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum number of sprints to return (hard cap: 100)"),
  state: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Comma-separated sprint states to filter by: future, active, closed " +
        "(e.g. 'active,future')",
    ),
};

/**
 * GET /rest/agile/1.0/board/{boardId}/sprint — compact sprint cards.
 * Sprint cards: { id, name, state, startDate, endDate, goal } (goal may be
 * null; dates may be null for future sprints).
 */
export function registerJiraListSprints(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_list_sprints",
    {
      title: "List board sprints",
      description:
        "List sprints of an Agile board, optionally filtered by state " +
        "(future/active/closed). Pagination via startAt/maxResults.",
      inputSchema,
    },
    async (args) => {
      try {
        const payload = asEnvelope(
          await ctx.agile.request(
            `board/${encodeURIComponent(String(args.boardId))}/sprint`,
            {
              query: {
                startAt: args.startAt,
                maxResults: args.maxResults,
                state: args.state,
              },
            },
          ),
        );
        const values = extractItems(payload, ["values", "issues"]);
        const meta = pageMeta(payload, args.startAt, args.maxResults, values.length);
        const body = { boardId: args.boardId, ...meta, sprints: values.map(projectSprint) };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}

function projectSprint(sprint: unknown): Record<string, unknown> {
  const record = asRecord(sprint);
  return {
    id: typeof record?.id === "number" ? record.id : null,
    name: asString(record?.name),
    state: asString(record?.state),
    startDate: asString(record?.startDate),
    endDate: asString(record?.endDate),
    goal: asString(record?.goal),
  };
}
