import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import type { ToolContext } from "./registry.js";

/**
 * Map a JIRA_400 from the sprint-move endpoint onto the errors list
 * (exported for tests).
 */
export function errorsFromJira400(err: JiraMcpError): string[] {
  const je = err.body.jiraErrors;
  return [
    ...(je?.errorMessages ?? []),
    ...Object.entries(je?.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
  ];
}

/**
 * POST /rest/agile/1.0/sprint/{sprintId}/issue — move issues into a sprint.
 * The operation is all-or-nothing on the Jira side: any failure returns 400,
 * which we surface as {moved: 0, errors: [...]} instead of a hard error.
 */
export function registerJiraMoveIssuesToSprint(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_move_issues_to_sprint",
    {
      title: "Move issues to sprint",
      description:
        "Move one or more issues into a sprint (max 50 per call). Issues must " +
        "belong to projects mapped to the sprint's board. Returns {moved, errors}.",
      inputSchema: {
        sprintId: z.number().int().min(1).describe("Sprint id (from jira_list_sprints)"),
        issueKeys: z
          .array(z.string().min(1))
          .min(1)
          .max(50)
          .describe("Issue keys to move, e.g. ['ABC-1', 'ABC-2'] (max 50)"),
      },
    },
    async (args) => {
      try {
        await ctx.agile.request(`sprint/${encodeURIComponent(String(args.sprintId))}/issue`, {
          method: "POST",
          body: { issues: args.issueKeys },
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ moved: args.issueKeys.length, errors: [] }),
            },
          ],
        };
      } catch (err) {
        // All-or-nothing endpoint: a 400 means nothing moved; surface the
        // Jira error messages as data instead of failing the tool.
        if (err instanceof JiraMcpError && err.code === "JIRA_400") {
          return {
            content: [
              { type: "text", text: JSON.stringify({ moved: 0, errors: errorsFromJira400(err) }) },
            ],
          };
        }
        return toMcpError(err);
      }
    },
  );
}
