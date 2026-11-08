import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pageMeta, extractItems, asEnvelope } from "../agile/agileClient.js";
import { mergeFields, projectIssueCards } from "../projection/issueCard.js";
import { toMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";

const inputSchema = {
  boardId: z.number().int().min(1).describe("Agile board id (from jira_list_boards)"),
  sprintId: z.number().int().min(1).describe("Sprint id (from jira_list_sprints)"),
  startAt: z.number().int().min(0).default(0).describe("Pagination offset"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum number of issues to return (hard cap: 100)"),
  jql: z
    .string()
    .min(1)
    .optional()
    .describe("Optional JQL filter (overrides the default rank ordering when it has ORDER BY)"),
};

/**
 * GET /rest/agile/1.0/board/{boardId}/sprint/{sprintId}/issue — issues of one
 * sprint, projected as cards.
 */
export function registerJiraGetSprintIssues(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_get_sprint_issues",
    {
      title: "Get sprint issues",
      description:
        "List the issues of one sprint on a board as compact issue cards, " +
        "optionally filtered with JQL. Pagination via startAt/maxResults.",
      inputSchema,
    },
    async (args) => {
      try {
        const payload = asEnvelope(
          await ctx.agile.request(
            `board/${encodeURIComponent(String(args.boardId))}/sprint/` +
              `${encodeURIComponent(String(args.sprintId))}/issue`,
            {
              query: {
                startAt: args.startAt,
                maxResults: args.maxResults,
                jql: args.jql,
                fields: mergeFields().join(","),
              },
            },
          ),
        );
        const issues = extractItems(payload, ["issues", "values"]);
        const meta = pageMeta(payload, args.startAt, args.maxResults, issues.length);
        const body = {
          boardId: args.boardId,
          sprintId: args.sprintId,
          ...meta,
          issues: projectIssueCards(issues),
        };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
