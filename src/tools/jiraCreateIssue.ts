import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";
import { browseUrl, resolveUserFieldValue, withParentHint } from "./writeFields.js";

const inputSchema = {
  project: z
    .string()
    .min(1)
    .describe("Target project: key (e.g. 'ABC') or numeric project id"),
  issueType: z
    .string()
    .min(1)
    .describe("Issue type name, e.g. 'Bug', 'Task', 'Story'"),
  summary: z.string().min(1).describe("Issue summary/title"),
  description: z.string().optional().describe("Issue description (wiki markup)"),
  assignee: z
    .string()
    .optional()
    .describe(
      "Assignee: username on Server/DC, accountId or user name on Cloud " +
        "(names are resolved via user search)",
    ),
  priority: z.string().min(1).optional().describe("Priority name, e.g. 'High'"),
  labels: z.array(z.string().min(1)).max(50).optional().describe("Initial labels"),
  components: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe("Component names"),
  parentKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Parent issue key (subtasks, or epic children on classic-managed projects)",
    ),
  fixVersions: z.array(z.string().min(1)).max(50).optional().describe("Fix version names"),
  duedate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Due date in YYYY-MM-DD format"),
};

/**
 * POST /rest/api/2/issue — creates an issue and returns only {key, id, url}.
 */
export function registerJiraCreateIssue(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_create_issue",
    {
      title: "Create Jira issue",
      description:
        "Create an issue in any project. Returns {key, id, url}. " +
        "Note: parentKey is rejected by Cloud team-managed projects for some " +
        "hierarchy levels.",
      inputSchema,
    },
    async (args) => {
      try {
        const fields: Record<string, unknown> = {
          summary: args.summary,
          issuetype: { name: args.issueType },
          project: /^\d+$/.test(args.project) ? { id: args.project } : { key: args.project },
        };
        if (args.description !== undefined) fields.description = args.description;
        if (args.assignee !== undefined) {
          fields.assignee = await resolveUserFieldValue(ctx, args.assignee);
        }
        if (args.priority !== undefined) fields.priority = { name: args.priority };
        if (args.labels !== undefined) fields.labels = args.labels;
        if (args.components !== undefined) {
          fields.components = args.components.map((name) => ({ name }));
        }
        if (args.fixVersions !== undefined) {
          fields.fixVersions = args.fixVersions.map((name) => ({ name }));
        }
        if (args.duedate !== undefined) fields.duedate = args.duedate;
        if (args.parentKey !== undefined) fields.parent = { key: args.parentKey };

        const created = asRecord(
          await ctx.client.request("api/2/issue", { method: "POST", body: { fields } }),
        );
        const key = asString(created?.key) ?? "";
        const id =
          asString(created?.id) ??
          (typeof created?.id === "number" ? String(created.id) : null);
        return {
          content: [{ type: "text", text: JSON.stringify({ key, id, url: browseUrl(ctx, key) }) }],
        };
      } catch (err) {
        return toMcpError(withParentHint(err, args.parentKey));
      }
    },
  );
}
