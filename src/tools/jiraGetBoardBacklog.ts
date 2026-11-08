import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pageMeta, extractItems, asEnvelope } from "../agile/agileClient.js";
import { mergeFields, projectIssueCards } from "../projection/issueCard.js";
import { JiraMcpError, toMcpError } from "../util/errors.js";
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
    .describe("Maximum number of backlog issues to return (hard cap: 100)"),
  jql: z
    .string()
    .min(1)
    .optional()
    .describe("Optional JQL filter ANDed with the board's saved filter"),
};

/**
 * GET /rest/agile/1.0/board/{boardId}/backlog — every issue projected through
 * issueCard; `expand` is never sent; only the card fields are requested.
 *
 * Some Jira versions reject the `jql` param on this endpoint with a 400; that
 * is surfaced as a structured error with an explicit hint (no client-side
 * filtering fallback).
 */
export function registerJiraGetBoardBacklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_get_board_backlog",
    {
      title: "Get board backlog",
      description:
        "List the backlog of an Agile board as compact issue cards, optionally " +
        "filtered with JQL. Pagination via startAt/maxResults.",
      inputSchema,
    },
    async (args) => {
      try {
        const payload = asEnvelope(
          await ctx.agile.request(`board/${encodeURIComponent(String(args.boardId))}/backlog`, {
            query: {
              startAt: args.startAt,
              maxResults: args.maxResults,
              jql: args.jql,
              fields: mergeFields().join(","),
            },
          }),
        );
        const issues = extractItems(payload, ["issues", "values"]);
        const meta = pageMeta(payload, args.startAt, args.maxResults, issues.length);
        const body = { boardId: args.boardId, ...meta, issues: projectIssueCards(issues) };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        // Some Jira versions do not support jql on the backlog endpoint: a 400
        // there is reported with an explicit hint instead of silent filtering.
        if (args.jql && err instanceof JiraMcpError && err.code === "JIRA_400") {
          return toMcpError(
            new JiraMcpError({
              code: "JIRA_400",
              message: err.message,
              hint:
                "jql not supported on backlog endpoint: this Jira version rejects the " +
                "'jql' parameter on /board/{boardId}/backlog. Retry without the jql parameter.",
              jiraErrors: err.body.jiraErrors,
            }),
          );
        }
        return toMcpError(err);
      }
    },
  );
}
