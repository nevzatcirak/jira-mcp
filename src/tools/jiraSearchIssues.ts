import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mergeFields, projectIssueCards } from "../projection/issueCard.js";
import { toMcpError } from "../util/errors.js";
import { asRecord, type JiraJson } from "../util/json.js";
import type { ToolContext } from "./registry.js";

const inputSchema = {
  jql: z
    .string()
    .min(1)
    .describe("JQL query, e.g. 'project = ABC AND status != Done ORDER BY updated DESC'"),
  startAt: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Index of the first issue to return (pagination offset)"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum number of issues to return (hard cap: 100)"),
  fields: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe(
      "Extra Jira field names merged into the compact card field set. " +
        "Raw JSON pass-through (e.g. '*all') is not supported on search.",
    ),
};

/**
 * POST /rest/api/2/search with only the card fields (plus extras), returning
 * { total, startAt, maxResults, hasMore, nextStartAt, issues: [card...] }.
 */
export function registerJiraSearchIssues(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_search_issues",
    {
      title: "Search Jira issues",
      description:
        "Search issues with JQL and return compact issue cards (key, summary, type, " +
        "status, assignee, priority, labels, parent, updated). Use startAt/maxResults " +
        "to paginate.",
      inputSchema,
    },
    async (args) => {
      try {
        const fields = mergeFields(args.fields);
        const payload = asRecord(
          await ctx.client.request<JiraJson>("api/2/search", {
            method: "POST",
            body: {
              jql: args.jql,
              startAt: args.startAt,
              maxResults: args.maxResults,
              fields,
            },
          }),
        );

        const issues = Array.isArray(payload?.issues) ? payload.issues : [];
        const total = typeof payload?.total === "number" ? payload.total : issues.length;
        const startAt = typeof payload?.startAt === "number" ? payload.startAt : args.startAt;
        const maxResults =
          typeof payload?.maxResults === "number" ? payload.maxResults : args.maxResults;
        const returned = issues.length;
        const hasMore = startAt + returned < total;
        const nextStartAt = hasMore ? startAt + returned : null;

        const body = {
          total,
          startAt,
          maxResults,
          hasMore,
          nextStartAt,
          issues: projectIssueCards(issues),
        };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
