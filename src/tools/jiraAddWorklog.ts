import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraMcpError, toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";
import { commentBody } from "./writeFields.js";

export type Deployment = "cloud" | "server";

export interface WorklogArgs {
  timeSpent: string | number;
  started?: string;
  comment?: string;
  adjustEstimate: "auto" | "leave" | "new" | "manual";
  newValue?: string;
}

/**
 * Pure builder for the worklog POST: body ({timeSpent|timeSpentSeconds,
 * started, comment}) + query (adjustEstimate with per-deployment companion
 * param: Server `reduceEstimateBy`, Cloud `reduceBy`).
 */
export function buildWorklogRequest(
  args: WorklogArgs,
  deployment: Deployment,
  commentBodyValue: unknown,
): { body: Record<string, unknown>; query: Record<string, string> } {
  if (args.adjustEstimate === "new" || args.adjustEstimate === "manual") {
    if (!args.newValue) {
      throw new JiraMcpError({
        code: "INVALID_ARGUMENT",
        message: `adjustEstimate='${args.adjustEstimate}' requires 'newValue'`,
        hint: "new: pass the new total estimate (e.g. '1d 2h'); manual: pass the amount to subtract (e.g. '2h').",
      });
    }
  }
  const body: Record<string, unknown> =
    typeof args.timeSpent === "number"
      ? { timeSpentSeconds: args.timeSpent }
      : { timeSpent: args.timeSpent };
  if (args.started !== undefined) body.started = args.started;
  if (args.comment !== undefined) body.comment = commentBodyValue;

  const query: Record<string, string> = {};
  if (args.adjustEstimate === "leave") {
    query.adjustEstimate = "leave";
  } else if (args.adjustEstimate === "new") {
    query.adjustEstimate = "new";
    query.newEstimate = args.newValue as string;
  } else if (args.adjustEstimate === "manual") {
    query.adjustEstimate = "manual";
    // Same semantics, different param name per deployment (documented quirk).
    if (deployment === "cloud") query.reduceBy = args.newValue as string;
    else query.reduceEstimateBy = args.newValue as string;
  }
  return { body, query };
}

/**
 * POST /rest/api/2/issue/{key}/worklog — {timeSpent ("3h 30m") or
 * timeSpentSeconds, started (ISO 8601 with offset), comment}; estimate
 * adjustment via query params. Response: {id, timeSpent, created}.
 */
export function registerJiraAddWorklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_add_worklog",
    {
      title: "Add worklog",
      description:
        "Log work time on an issue. timeSpent is a Jira duration string " +
        "('3h 30m') or seconds. adjustEstimate controls how the remaining " +
        "estimate is updated (auto/leave/new/manual; new+manual need newValue).",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        timeSpent: z
          .union([z.string().min(1), z.number().int().min(1)])
          .describe("Jira duration ('3h 30m') or seconds (12600)"),
        started: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
          .optional()
          .describe("Work start time, ISO 8601 with optional timezone offset, e.g. '2026-01-14T10:33:00.000+0000'"),
        comment: z.string().min(1).optional().describe("Optional worklog comment"),
        adjustEstimate: z
          .enum(["auto", "leave", "new", "manual"])
          .default("auto")
          .describe(
            "auto: reduce remaining estimate by logged time; leave: keep; " +
              "new: set a new total (needs newValue); manual: subtract newValue",
          ),
        newValue: z
          .string()
          .optional()
          .describe("Estimate string required for adjustEstimate='new'|'manual' (e.g. '1d 2h')"),
      },
    },
    async (args) => {
      try {
        const { type } = await ctx.profile.resolve();
        const { body, query } = buildWorklogRequest(
          args,
          type,
          args.comment !== undefined ? await commentBody(ctx, args.comment) : undefined,
        );
        const created = asRecord(
          await ctx.client.request(`api/2/issue/${encodeURIComponent(args.issueKey)}/worklog`, {
            method: "POST",
            body,
            query,
          }),
        );
        const result = {
          id: asString(created?.id) ?? null,
          timeSpent: asString(created?.timeSpent),
          created: asString(created?.created),
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}
