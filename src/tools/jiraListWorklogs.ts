import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { pageMeta, asEnvelope } from "../agile/agileClient.js";
import { truncateText } from "../projection/issueDetail.js";
import { toMcpError } from "../util/errors.js";
import { asRecord, asString } from "../util/json.js";
import type { ToolContext } from "./registry.js";

const COMMENT_TRUNCATE_CHARS = 300;

/**
 * GET /rest/api/2/issue/{key}/worklog — paginated worklog cards:
 * {id, author, timeSpent, started, comment(truncated to 300 chars)}.
 */
export function registerJiraListWorklogs(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "jira_list_worklogs",
    {
      title: "List worklogs",
      description:
        "List the worklogs of an issue (author, timeSpent, started, truncated " +
        "comment). Pagination via startAt/maxResults.",
      inputSchema: {
        issueKey: z.string().min(1).describe("Issue key, e.g. 'ABC-123'"),
        startAt: z.number().int().min(0).default(0).describe("Pagination offset"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum worklogs per page (hard cap: 100)"),
      },
    },
    async (args) => {
      try {
        const payload = asEnvelope(
          await ctx.client.request(
            `api/2/issue/${encodeURIComponent(args.issueKey)}/worklog`,
            { query: { startAt: args.startAt, maxResults: args.maxResults } },
          ),
        );
        const items = extractWorklogs(payload);
        const meta = pageMeta(payload, args.startAt, args.maxResults, items.length);
        const body = {
          issueKey: args.issueKey,
          ...meta,
          worklogs: items.map(projectWorklogCard),
        };
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (err) {
        return toMcpError(err);
      }
    },
  );
}

function extractWorklogs(payload: Record<string, unknown> | null): unknown[] {
  if (Array.isArray(payload?.worklogs)) return payload.worklogs;
  if (Array.isArray(payload)) return payload; // very old servers: bare array
  return [];
}

function projectWorklogCard(worklog: unknown): Record<string, unknown> {
  const record = asRecord(worklog);
  const comment = asString(record?.comment) ?? "";
  const view = truncateText(comment, COMMENT_TRUNCATE_CHARS);
  return {
    id: asString(record?.id),
    author: asString(asRecord(record?.author)?.displayName),
    timeSpent: asString(record?.timeSpent),
    started: asString(record?.started),
    comment: view.text,
    truncated: view.truncated,
    totalLength: comment.length,
  };
}
