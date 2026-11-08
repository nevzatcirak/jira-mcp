import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mergeFields } from "../projection/issueCard.js";
import { projectIssueDetail } from "../projection/issueDetail.js";
import { toMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";

const inputSchema = {
  issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
  fields: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe(
      "Extra Jira field names merged into the card field set. Pass ['*all'] to get the " +
        "raw, unfiltered Jira payload (a size warning is prepended).",
    ),
  maxDescriptionChars: z
    .number()
    .int()
    .min(0)
    .max(20_000)
    .default(500)
    .describe("Maximum number of characters returned for the description"),
  includeComments: z
    .boolean()
    .default(false)
    .describe("Include paginated comments (each comment body truncated to 500 chars)"),
  includeWorklogs: z
    .boolean()
    .default(false)
    .describe("Include paginated worklogs (each comment body truncated to 500 chars)"),
};

/**
 * GET /rest/api/2/issue/{key}?fields=<card fields + description + extras>,
 * with optional paginated comment/worklog sub-calls.
 */
export function registerJiraGetIssue(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_get_issue",
    {
      title: "Get Jira issue",
      description:
        "Fetch one issue as compact card fields plus a truncated description; " +
        "optionally include paginated comments and worklogs. Use fields=['*all'] " +
        "for the raw Jira payload (not recommended).",
      inputSchema,
    },
    async (args) => {
      try {
        const issueKey = args.issueKey;
        const extraFields = args.fields ?? [];

        // Explicit raw pass-through, behind a size warning.
        if (extraFields.includes("*all")) {
          const raw = await ctx.client.request(`api/2/issue/${encodeURIComponent(issueKey)}`, {
            query: { fields: "*all" },
          });
          return {
            content: [
              {
                type: "text",
                text:
                  "WARNING: unfiltered Jira payload, this may be very large\n" +
                  JSON.stringify(raw),
              },
            ],
          };
        }

        // ["description", ...card fields, ...extras] — deduplicated by mergeFields.
        const fields = ["description", ...mergeFields(extraFields)];
        const data = await ctx.client.request(`api/2/issue/${encodeURIComponent(issueKey)}`, {
          query: { fields: fields.join(",") },
        });

        const detail = await projectIssueDetail(data, {
          maxDescriptionChars: args.maxDescriptionChars,
          includeComments: args.includeComments,
          includeWorklogs: args.includeWorklogs,
          fetchPage: (path) => ctx.client.request(path),
        });
        return { content: [{ type: "text", text: JSON.stringify(detail) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
