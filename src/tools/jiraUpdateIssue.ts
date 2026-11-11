import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";
import { DURATION_PATTERN, resolveUserFieldValue, timeTrackingFieldValue, withParentHint } from "./writeFields.js";

/**
 * PUT /rest/api/2/issue/{key} — partial update: only fields explicitly passed
 * are sent; undefined fields are untouched. Returns a one-line confirmation
 * listing the changed fields. labels REPLACE the whole set (Jira semantics);
 * description="" clears the description.
 */
export function registerJiraUpdateIssue(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_update_issue",
    {
      title: "Update Jira issue",
      description:
        "Update fields of an existing issue. Only provided fields are changed. " +
        "labels REPLACES the whole label set — include existing labels you want " +
        "to keep. description='' clears the description.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        issueType: z.string().min(1).optional().describe("New issue type name"),
        summary: z.string().min(1).optional().describe("New summary/title"),
        description: z
          .string()
          .optional()
          .describe("New description (wiki markup); an empty string clears it"),
        assignee: z
          .string()
          .optional()
          .describe("Assignee: username on Server/DC, accountId or user name on Cloud"),
        priority: z.string().min(1).optional().describe("Priority name"),
        labels: z
          .array(z.string().min(1))
          .max(50)
          .optional()
          .describe("REPLACES the entire label set with this list (Jira semantics)"),
        components: z.array(z.string().min(1)).max(50).optional().describe("Component names (replaces set)"),
        parentKey: z
          .string()
          .min(1)
          .optional()
          .describe("New parent issue key (subtasks / epic children)"),
        fixVersions: z.array(z.string().min(1)).max(50).optional().describe("Fix version names (replaces set)"),
        duedate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Due date in YYYY-MM-DD format"),
        originalEstimate: z
          .string()
          .regex(DURATION_PATTERN)
          .optional()
          .describe(
            "New original estimate in Jira duration format, e.g. '2h', '1d 4h' " +
              "(units depend on the instance's time tracking settings)",
          ),
        remainingEstimate: z
          .string()
          .regex(DURATION_PATTERN)
          .optional()
          .describe("New remaining estimate in Jira duration format, e.g. '1d', '3h 30m'"),
      },
    },
    async (args) => {
      try {
        const fields: Record<string, unknown> = {};
        if (args.issueType !== undefined) fields.issuetype = { name: args.issueType };
        if (args.summary !== undefined) fields.summary = args.summary;
        if (args.description !== undefined) fields.description = args.description;
        if (args.assignee !== undefined) {
          fields.assignee = await resolveUserFieldValue(ctx, args.assignee);
        }
        if (args.priority !== undefined) fields.priority = { name: args.priority };
        if (args.labels !== undefined) fields.labels = args.labels;
        if (args.components !== undefined) {
          fields.components = args.components.map((name) => ({ name }));
        }
        if (args.parentKey !== undefined) fields.parent = { key: args.parentKey };
        if (args.fixVersions !== undefined) {
          fields.fixVersions = args.fixVersions.map((name) => ({ name }));
        }
        if (args.duedate !== undefined) fields.duedate = args.duedate;
        const timetracking = timeTrackingFieldValue(args.originalEstimate, args.remainingEstimate);
        if (timetracking !== undefined) fields.timetracking = timetracking;

        const changed = Object.keys(fields);
        if (changed.length === 0) {
          throw new JiraMcpError({
            code: "INVALID_ARGUMENT",
            message: "No fields to update were provided",
            hint: "Pass at least one updatable field (summary, description, labels, ...).",
          });
        }

        await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}`, {
          method: "PUT",
          body: { fields },
        });
        return {
          content: [
            { type: "text", text: `Updated ${args.issueKey} (fields: ${changed.join(", ")})` },
          ],
        };
      } catch (err) {
        return toMcpError(withParentHint(err, args.parentKey));
      }
    },
  );
}
